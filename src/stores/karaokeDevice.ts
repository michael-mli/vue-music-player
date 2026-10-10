import { computed, markRaw, ref } from 'vue'
import { defineStore } from 'pinia'
import { guideRequest, KaraokeGuideError, karaokeRequestId, type KaraokeDeviceGrant,
  type KaraokeDeviceReply, type KaraokePairedDevice, type KaraokeCommandResult,
  type KaraokeRemoteAction, type KaraokeCatalogReply } from '@/services/karaokeGuideApi'
import { KaraokeGuideClock, type KaraokeGuideState } from '@/utils/karaokeGuideSync'

const storageKey = 'karaoke-device-pair', invitationKey = 'karaoke-device-invitation'
const validSecret = (value: unknown) => typeof value === 'string' && /^[\w-]{32}$/.test(value)
function savedGrant(): KaraokeDeviceGrant | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (value && validSecret(value.sessionId) && validSecret(value.token) && validSecret(value.deviceId) && value.expiresAt > Date.now()) return value
    localStorage.removeItem(storageKey)
  } catch { /* Storage may be unavailable. Pairing still works in this tab. */ }
  return null
}

// App owns this store so navigating away keeps the grant, without keeping audio on.
export const useKaraokeDeviceStore = defineStore('karaokeDevice', () => {
  const grant = ref<KaraokeDeviceGrant | null>(savedGrant())
  const snapshot = ref<KaraokeGuideState | null>(null), device = ref<KaraokePairedDevice | null>(null)
  const hostOnline = ref(false), controlsAvailable = ref(false), inGuide = ref(false), listening = ref(false)
  const error = ref(''), commandError = ref(''), commandNotice = ref(''), joining = ref(false)
  const queue = ref<{ id: number; title: string }[]>([]), lastReply = ref(-Infinity)
  const catalog = ref<KaraokeCatalogReply | null>(null), searching = ref(false), searchError = ref('')
  const pending = ref<{ commandId: string; action: KaraokeRemoteAction; songId?: number; position?: number; createdAt: number } | null>(null)
  const clock = markRaw(new KaraokeGuideClock())
  const canControl = computed(() => !!grant.value && !!device.value?.canControl && hostOnline.value && controlsAvailable.value && !pending.value)
  let timer: number | undefined, polling = false, sending = false, running = false, needsActivity = false, searchGeneration = 0
  let retryAt = 0

  function save() {
    try { if (grant.value) localStorage.setItem(storageKey, JSON.stringify(grant.value)); else localStorage.removeItem(storageKey) }
    catch { /* Optional persistence. */ }
  }
  function clear(reason: string) {
    grant.value = null; device.value = null; hostOnline.value = false; controlsAvailable.value = false
    listening.value = false; pending.value = null; error.value = reason
    window.clearTimeout(timer); save()
  }
  function terminal(reason: unknown) {
    if (reason instanceof KaraokeGuideError && ['expired', 'invalidPair', 'removed', 'idleExpired'].includes(reason.code)) {
      clear(reason.code); return true
    }
    return false
  }
  function refreshDevice(value: KaraokePairedDevice) {
    device.value = value
    if (grant.value) {
      grant.value.name = value.name; grant.value.expiresAt = Date.now() + value.idleRemainingMs; save()
    }
  }
  function settle(result: KaraokeCommandResult) {
    if (result.id !== pending.value?.commandId || result.status === 'pending') return
    pending.value = null
    commandError.value = result.status === 'failed' ? result.code || 'commandFailed' : ''
    commandNotice.value = result.status === 'applied' ? 'commandApplied' : ''
  }
  function schedule(delay = inGuide.value ? 500 : 5000) {
    window.clearTimeout(timer)
    if (running && grant.value) timer = window.setTimeout(() => { void poll() }, delay)
  }
  async function poll() {
    const current = grant.value
    if (!current || polling || !running) return
    if (current.expiresAt <= Date.now()) { clear('idleExpired'); return }
    polling = true
    const active = inGuide.value && (needsActivity || (listening.value && !!snapshot.value?.playing && hostOnline.value))
    try {
      const result = await guideRequest<KaraokeDeviceReply>(clock,
        `/${current.sessionId}?mode=${inGuide.value ? 'guide' : 'away'}&active=${active ? 1 : 0}`, current.token)
      if (grant.value?.token !== current.token) return
      if (active) needsActivity = false
      snapshot.value = result.state; hostOnline.value = result.hostOnline
      controlsAvailable.value = result.controlsAvailable; queue.value = result.queue
      lastReply.value = performance.now(); refreshDevice(result.device); error.value = ''
      for (const receipt of result.commands) settle(receipt)
      if (pending.value && Date.now() - pending.value.createdAt >= 15_000) {
        pending.value = null; commandError.value = 'commandExpired'
      } else if (pending.value && Date.now() >= retryAt) void transmit()
    } catch (reason) {
      if (grant.value?.token !== current.token) return
      hostOnline.value = false
      if (!terminal(reason)) error.value = 'reconnecting'
    } finally { polling = false; schedule() }
  }
  function touch() { needsActivity = true }
  function setInGuide(value: boolean) {
    inGuide.value = value
    if (value) touch(); else listening.value = false
    schedule(0)
  }
  function start() { running = true; schedule(0) }
  function stop() { running = false; window.clearTimeout(timer) }
  function resume() { if (document.visibilityState === 'visible') schedule(0) }

  async function openPair() {
    error.value = ''; joining.value = true
    const url = new URL(window.location.href), params = new URLSearchParams(url.hash.slice(1))
    let invitation: { sessionId: string; token: string; joinKey: string; expiresAt: number } | null = null
    try {
      if (url.hash) {
        const sessionId = params.get('session'), token = params.get('token')
        url.hash = ''; window.history.replaceState(window.history.state, '', url.pathname + url.search)
        if (!validSecret(sessionId) || !validSecret(token)) { clear('invalidPair'); return }
        invitation = { sessionId: sessionId!, token: token!, joinKey: karaokeRequestId(), expiresAt: Date.now() + 300_000 }
        try { localStorage.setItem(invitationKey, JSON.stringify(invitation)) } catch { /* Optional. */ }
      } else {
        try { invitation = JSON.parse(localStorage.getItem(invitationKey) || 'null') } catch { /* Optional. */ }
        if (invitation && invitation.expiresAt <= Date.now()) invitation = null
      }
      if (invitation && grant.value?.sessionId === invitation.sessionId) {
        // A fresh QR can re-enrol a phone whose saved grant was just removed.
        // Reuse a still-valid grant rather than filling the host list on rescans.
        try {
          const result = await guideRequest<KaraokeDeviceReply>(clock,
            `/${grant.value.sessionId}?mode=guide&active=1`, grant.value.token)
          refreshDevice(result.device)
        } catch (reason) { if (!terminal(reason)) throw reason }
      }
      if (invitation && grant.value?.sessionId !== invitation.sessionId) {
        const name = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'Guide device'
        const result = await guideRequest<{ device: KaraokePairedDevice & { token: string } }>(clock,
          `/${invitation.sessionId}/devices`, invitation.token, 'POST', { joinKey: invitation.joinKey, name })
        grant.value = { sessionId: invitation.sessionId, token: result.device.token, deviceId: result.device.id,
          name: result.device.name, expiresAt: Date.now() + result.device.idleRemainingMs }
        refreshDevice(result.device); snapshot.value = null; queue.value = []; pending.value = null
      }
      if (grant.value) {
        error.value = ''
        try { localStorage.removeItem(invitationKey) } catch { /* Optional. */ }
        setInGuide(true); start()
      } else error.value = 'invalidPair'
    } catch (reason) {
      if (terminal(reason)) { try { localStorage.removeItem(invitationKey) } catch { /* Optional. */ } }
      else error.value = reason instanceof KaraokeGuideError ? reason.code : 'reconnecting'
    } finally { joining.value = false }
  }
  async function transmit() {
    const current = grant.value, command = pending.value
    if (!current || !command || sending) return
    sending = true; retryAt = Date.now() + 2500
    try {
      const result = await guideRequest<{ command: KaraokeCommandResult }>(clock,
        `/${current.sessionId}/commands`, current.token, 'POST', command)
      if (grant.value?.token === current.token) settle(result.command)
    } catch (reason) {
      if (grant.value?.token !== current.token) return
      if (!terminal(reason) && reason instanceof KaraokeGuideError && reason.status < 500) {
        pending.value = null; commandError.value = reason.code
      }
      // Transport failures retry the same ID; a lost response must not skip twice.
    } finally { sending = false; schedule(0) }
  }
  function command(action: KaraokeRemoteAction, values: { songId?: number; position?: number } = {}) {
    if (!canControl.value) return
    touch(); commandError.value = ''; commandNotice.value = ''
    pending.value = { commandId: karaokeRequestId(), action, ...values, createdAt: Date.now() }
    void transmit()
  }
  async function search(query = '', page = 1) {
    const current = grant.value, attempt = ++searchGeneration
    if (!current) return
    touch(); searching.value = true; searchError.value = ''
    try {
      const result = await guideRequest<KaraokeCatalogReply>(clock,
        `/${current.sessionId}/catalog?q=${encodeURIComponent(query.trim())}&page=${page}`, current.token)
      if (attempt === searchGeneration && grant.value?.token === current.token) catalog.value = result
    } catch (reason) {
      if (attempt === searchGeneration && grant.value?.token === current.token && !terminal(reason)) searchError.value = 'searchFailed'
    } finally { if (attempt === searchGeneration) searching.value = false }
  }
  async function rename(name: string) {
    const current = grant.value
    if (!current || !name.trim()) return
    touch()
    try {
      const result = await guideRequest<{ device: KaraokePairedDevice }>(clock,
        `/${current.sessionId}/device`, current.token, 'PATCH', { name: name.trim().slice(0, 40) })
      if (grant.value?.token === current.token) refreshDevice(result.device)
    } catch (reason) { if (!terminal(reason)) commandError.value = 'manageFailed' }
  }
  return { grant, snapshot, device, hostOnline, controlsAvailable, inGuide, listening, error, commandError, commandNotice,
    joining, queue, lastReply, catalog, searching, searchError, pending, clock, canControl,
    start, stop, resume, setInGuide, touch, openPair, command, search, rename }
})
