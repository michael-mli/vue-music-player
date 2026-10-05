import { computed, onUnmounted, ref, watch, type Ref } from 'vue'
import { PartyAudioEngine } from '@/services/partyAudioEngine'
import { createPartyOutputMonitor } from '@/services/partyOutputMonitor'
import { createPartyGuideSession } from '@/services/partyGuideSession'
import type { PartySnapshot, PartyLease } from '@/services/partyApi'
import type { PartyClockEstimate } from '@/utils/partyClock'
import { partyPosition, partySegment } from '@/utils/partyTimeline'
import { parseLrc, singingGuideState } from '@/utils/lyricsTiming'
import { PARTY_MEDIA_PROTOCOL_VERSION } from '../../server/ktv-media-protocol.js'

export function usePartyPlayback(party: Ref<PartySnapshot | null>, connected: Ref<boolean>, clock: Ref<PartyClockEstimate | null>,
  send: (message: Record<string, unknown>) => boolean) {
  const deviceId = crypto.randomUUID()
  const engine = new PartyAudioEngine()
  const guideSession = createPartyGuideSession(() => { void enable('guide') }, disable)
  const purpose = ref<'viewer' | 'stage' | 'guide'>('viewer')
  const enabled = ref(false), enabling = ref(false), preparing = ref(false), prepared = ref(false), failure = ref('')
  const blocked = ref(false), calibrationInvalidated = ref(false), diagnostics = ref(engine.diagnostics)
  const audioIssue = ref<'drift' | 'output' | 'decode' | 'suspended' | null>(null)
  const volume = ref(0.7), guideAdvanceMs = ref(Number(localStorage.getItem('party-guide-advance-ms')) || 0)
  const nowMs = ref(performance.now())
  const lease = ref<PartyLease | null>(null)
  const readyKeys = new Set<string>()
  let clockReceivedMs = 0, failedKey = '', loadingKey = '', loadAttempt = 0
  let lastStatusMs = -Infinity, lastHeartbeatMs = -Infinity, disposed = false, enableAttempt = 0
  let lastStoppedLease = ''
  let animation = 0
  let lastDiagnosticsMs = -Infinity
  const outputs = createPartyOutputMonitor(() => {
    guideAdvanceMs.value = 0; calibrationInvalidated.value = true
    if (enabled.value) engine.outputChanged()
  })
  const playback = computed(() => party.value?.playback)
  const serverNowMs = computed(() => nowMs.value + (clock.value?.offsetMs || 0))
  const positionMs = computed(() => playback.value && clock.value?.clockId === playback.value.clockId ? partyPosition(playback.value, serverNowMs.value) : playback.value?.positionMs || 0)
  const segment = computed(() => playback.value ? partySegment(playback.value, serverNowMs.value) : null)
  const countdown = computed(() => segment.value?.state === 'scheduled' ? Math.max(0, Math.ceil((segment.value.anchorServerMs - serverNowMs.value) / 1000)) : 0)
  const lines = computed(() => playback.value?.assets?.lyrics.mode === 'synced' ? parseLrc(playback.value.assets.lyrics.text || '') : [])
  const lyricGuide = computed(() => singingGuideState(lines.value, positionMs.value / 1000,
    (playback.value?.durationMs || 0) / 1000, (playback.value?.lyricOffsetMs || 0) / 1000))
  const canGuide = computed(() => party.value?.features?.guide !== false && playback.value?.singerMemberId === party.value?.self.id && party.value?.deviceScope !== 'display' && playback.value?.stageDeviceId !== deviceId)
  const assignedHere = computed(() => playback.value?.stageDeviceId === deviceId)
  const startSafe = computed(() => !!clock.value && serverNowMs.value >= Math.max(playback.value?.restartSafeAfterMs || 0,
    lease.value?.clockId === clock.value.clockId ? lease.value.safeAfterServerMs : playback.value?.lease?.safeAfterServerMs || 0))
  const healthy = computed(() => connected.value && clock.value?.status === 'healthy' &&
    nowMs.value - clockReceivedMs + (clock.value?.ageMs || 0) <= 30_000)
  const foregroundAllowed = () => !document.hidden || purpose.value === 'guide' && canGuide.value

  function status() {
    nowMs.value = performance.now()
    if (!connected.value) return
    if (!healthy.value || !foregroundAllowed() || blocked.value) readyKeys.clear()
    send({ type: 'device.status', label: purpose.value === 'stage' ? 'Stage' : purpose.value === 'guide' ? 'Singer phone' : 'Controller',
      purpose: purpose.value, audioEnabled: foregroundAllowed() && !blocked.value && enabled.value && engine.enabled,
      mediaProtocol: typeof RTCPeerConnection === 'function' ? PARTY_MEDIA_PROTOCOL_VERSION : 0,
      clockHealthy: foregroundAllowed() && healthy.value, audioIssue: audioIssue.value })
    lastStatusMs = performance.now()
  }
  async function enable(role: 'stage' | 'guide') {
    failure.value = ''; blocked.value = false; audioIssue.value = null; engine.resetRecovery()
    if (role === 'guide' && (!canGuide.value || assignedHere.value)) return
    purpose.value = role
    if (role === 'guide') guideSession.acquire()
    else guideSession.release()
    const attempt = ++enableAttempt
    enabling.value = true; enabled.value = false
    try {
      await engine.enable()
      if (disposed || attempt !== enableAttempt || !foregroundAllowed()) return
      enabled.value = engine.enabled; failedKey = ''; readyKeys.clear(); status(); void outputs.inspect(); void prepare()
    } catch {
      if (disposed || attempt !== enableAttempt) return
      failure.value = 'audioEnableFailed'; enabled.value = false; status()
    } finally { if (attempt === enableAttempt) enabling.value = false }
  }
  function disable() {
    guideSession.release()
    enableAttempt++; engine.cancelEnable()
    enabling.value = false
    loadAttempt++; engine.releaseBuffer(); enabled.value = false; prepared.value = false; preparing.value = false
    acknowledgeStop()
    purpose.value = 'viewer'; loadingKey = ''; readyKeys.clear(); failedKey = ''; audioIssue.value = null; status()
  }
  function acknowledgeStop() {
    if (lease.value?.deviceId !== deviceId) return
    const key = `${lease.value.id}:${lease.value.generation}`
    if (lastStoppedLease === key) return
    if (send({ type: 'device.stopped', leaseId: lease.value.id, clockId: lease.value.clockId, generation: lease.value.generation })) lastStoppedLease = key
  }
  async function prepare() {
    const current = playback.value
    const eligible = foregroundAllowed() && !blocked.value && enabled.value && healthy.value && current?.assets && current.state !== 'idle' &&
      (purpose.value === 'stage' ? assignedHere.value : purpose.value === 'guide' && canGuide.value)
    if (!eligible || !current?.assets) return
    const asset = purpose.value === 'stage' ? current.assets.instrumental : current.assets.original
    if (!asset) { failure.value = 'guideUnavailable'; return }
    const key = `${current.clockId}:${current.performanceId}:${current.generation}:${asset.sha256}`
    if (failedKey === key || loadingKey === key) return
    loadingKey = key
    const attempt = ++loadAttempt
    preparing.value = true; prepared.value = false
    try {
      await engine.prepare(asset, purpose.value === 'guide' ? 'original' : 'instrumental')
      if (disposed || attempt !== loadAttempt || engine.preparedHash !== asset.sha256) return
      prepared.value = true; failure.value = ''
      sendReady(current.generation)
      if (current.pendingTransition) sendReady(current.pendingTransition.generation)
    } catch (reason) {
      if (attempt !== loadAttempt || disposed) return
      failure.value = String((reason as Error).message) === 'AUDIO_MEMORY_LIMIT' ? 'audioMemoryLimit' : 'audioPrepareFailed'
      blocked.value = true; audioIssue.value = 'decode'; failedKey = key; engine.stop()
      // A stage that failed decode must no longer look ready to the room.
      send({ type: 'device.status', label: purpose.value === 'stage' ? 'Stage' : 'Singer phone', purpose: purpose.value,
        audioEnabled: false, clockHealthy: healthy.value, audioIssue: audioIssue.value })
    } finally { if (attempt === loadAttempt) { preparing.value = false; loadingKey = '' } }
  }
  function sendReady(generation: number) {
    const current = playback.value
    if (blocked.value || !current?.assets || !prepared.value || !healthy.value) return
    const key = `${current.clockId}:${current.performanceId}:${generation}:${current.assets.version}`
    if (readyKeys.has(key)) return
    status()
    if (send({ type: 'device.ready', clockId: current.clockId, performanceId: current.performanceId, generation,
      assetVersion: current.assets.version, durationMs: engine.durationMs })) readyKeys.add(key)
  }
  function message(packet: Record<string, any>) {
    if (packet.type === 'lease') acceptLease(packet.lease)
    else if (packet.type === 'error' && packet.messageType?.startsWith('device.')) {
      if (!['STALE_GENERATION', 'NOT_ADMITTED'].includes(packet.code)) failure.value = 'audioDeviceRejected'
      readyKeys.clear()
    }
  }
  function acceptLease(next: PartyLease | null | undefined) {
    if (!next || next.clockId !== playback.value?.clockId || next.performanceId !== playback.value?.performanceId) return
    if (lease.value && lease.value.id === next.id && lease.value.sequence >= next.sequence) return
    lease.value = next
    // Lease packets continue arriving when animation frames are suspended.
    // Renew the native deadline immediately instead of waiting for a UI frame.
    synchronize()
  }
  engine.onSuspended = () => {
    loadAttempt++; loadingKey = ''; preparing.value = false; engine.releaseBuffer()
    enabled.value = false; prepared.value = false; readyKeys.clear(); failure.value = 'audioSuspended'; audioIssue.value = 'suspended'; status()
  }
  engine.onRecovery = reason => {
    // A late decode response must not clear the fault or mark the old output
    // ready after recovery has already begun.
    loadAttempt++; loadingKey = ''; preparing.value = false
    blocked.value = true; prepared.value = false; readyKeys.clear()
    audioIssue.value = reason; failure.value = reason === 'output' ? 'audioOutputChanged' : 'audioDriftRecovery'
    if (reason === 'output') { guideAdvanceMs.value = 0; calibrationInvalidated.value = true }
    acknowledgeStop(); status(); diagnostics.value = engine.diagnostics
  }
  engine.onEnded = generation => {
    const current = playback.value, grant = lease.value
    if (!current || !grant || !healthy.value) return
    const position = partyPosition(current, performance.now() + clock.value!.offsetMs)
    if (purpose.value === 'guide') {
      // A calibrated guide can naturally finish before the backing. Compare
      // against its own decoded timeline, including the singer's advance.
      const guidePosition = position + guideAdvanceMs.value + (current.assets?.original?.alignmentOffsetMs || 0)
      if (generation === segment.value?.generation && ['playing', 'scheduled'].includes(segment.value.state) && guidePosition < engine.durationMs - 250) {
        enabled.value = false; prepared.value = false; readyKeys.clear(); failure.value = 'guideEndedEarly'; status()
      }
      return
    }
    if (purpose.value !== 'stage' || !assignedHere.value) return
    if (position < current.durationMs - 250) return
    send({ type: 'playback.ended', clockId: current.clockId, performanceId: current.performanceId,
      generation, entryId: current.entryId, leaseId: grant.id })
  }
  watch(clock, () => { clockReceivedMs = performance.now(); status(); void prepare(); synchronize() })
  watch(connected, online => {
    readyKeys.clear(); lease.value = null
    if (!online) { engine.stop(); prepared.value = false }
    else { status(); void prepare() }
  })
  watch([() => playback.value?.clockId, () => playback.value?.generation, () => playback.value?.performanceId,
    () => playback.value?.stageDeviceId, () => playback.value?.pendingTransition?.generation, () => playback.value?.assets?.version, canGuide], () => {
    acceptLease(playback.value?.lease)
    if (!playback.value || playback.value.state === 'idle' || (purpose.value === 'guide' && !canGuide.value)) {
      engine.releaseBuffer(); prepared.value = false; readyKeys.clear(); loadingKey = ''; loadAttempt++
      acknowledgeStop()
    } else {
      readyKeys.clear(); void prepare()
      if (prepared.value && playback.value.pendingTransition) sendReady(playback.value.pendingTransition.generation)
    }
  })
  watch(() => playback.value?.lease?.sequence, () => acceptLease(playback.value?.lease))
  watch([() => playback.value?.state, () => playback.value?.pendingTransition, () => playback.value?.generation], synchronize)
  watch(() => party.value?.features?.guide, available => {
    if (available === false && purpose.value === 'guide') disable()
  }, { flush: 'sync' })
  watch(volume, value => engine.setVolume(value))
  watch(guideAdvanceMs, value => { guideAdvanceMs.value = Math.max(-2000, Math.min(2000, value)); localStorage.setItem('party-guide-advance-ms', String(guideAdvanceMs.value)); engine.stop() })
  function synchronize() {
    if (disposed) return
    nowMs.value = performance.now()
    const current = playback.value
    if (nowMs.value - lastStatusMs >= 2000) status()
    if (foregroundAllowed() && enabled.value && engine.enabled && !blocked.value && current && current.state !== 'idle' && healthy.value) {
      if (nowMs.value - lastHeartbeatMs >= 2000) {
        const grant = lease.value
        send({ type: 'device.heartbeat', clockId: current.clockId, performanceId: current.performanceId,
          generation: segment.value?.generation, leaseId: grant?.id })
        lastHeartbeatMs = nowMs.value
      }
      const grant = lease.value
      if (purpose.value === 'guide' && canGuide.value || (purpose.value === 'stage' && assignedHere.value && grant?.deviceId === deviceId)) {
        engine.sync(current, healthy.value ? clock.value : null, grant, purpose.value === 'guide' ? 'guide' : 'stage',
          purpose.value === 'guide' ? guideAdvanceMs.value : 0)
        if (segment.value?.state === 'paused' && nowMs.value - lastHeartbeatMs < 20) acknowledgeStop()
        if (current.state === 'recovering') acknowledgeStop()
      } else engine.stop()
    } else engine.stop()
    if (nowMs.value - lastDiagnosticsMs >= 1000) {
      diagnostics.value = engine.diagnostics; lastDiagnosticsMs = nowMs.value
      guideSession.update(current?.title || 'KTV', engine.renderPositionMs !== null && healthy.value,
        (engine.renderPositionMs ?? positionMs.value), engine.durationMs)
    }
  }
  function tick() {
    synchronize()
    animation = requestAnimationFrame(tick)
  }
  function foreground() {
    // A hidden singer can keep playing while their real output, clock and lease
    // remain healthy. Actual suspension still requires explicit audio enablement.
    if (!foregroundAllowed()) { engine.stop(); acknowledgeStop(); readyKeys.clear() }
    status(); synchronize(); void prepare()
  }
  function retry() {
    blocked.value = false; audioIssue.value = null; failure.value = ''; engine.resetRecovery()
    failedKey = ''; readyKeys.clear()
    // Output changes invalidate engine readiness. Retrying preparation alone
    // cannot restore the output clock or its silent warmup path.
    if (!engine.enabled && purpose.value !== 'viewer') { void enable(purpose.value); return }
    status(); void prepare()
  }
  document.addEventListener('visibilitychange', foreground)
  const statusTimer = window.setInterval(() => {
    // Background pages have no rAF. Keep heartbeats and native lease deadlines
    // current without extending authority if the OS freezes the page entirely.
    synchronize()
  }, 1000)
  animation = requestAnimationFrame(tick)
  onUnmounted(() => {
    disposed = true; cancelAnimationFrame(animation); window.clearInterval(statusTimer)
    document.removeEventListener('visibilitychange', foreground)
    outputs.stop()
    guideSession.release()
    if (lease.value?.deviceId === deviceId) send({ type: 'device.stopped', leaseId: lease.value.id,
      clockId: lease.value.clockId, generation: lease.value.generation })
    void engine.close()
  })
  return { deviceId, purpose, enabled, enabling, preparing, prepared, failure, volume, guideAdvanceMs, positionMs,
    createPublisherTap: (hash: string, generation: number) => engine.createPublisherTap(hash, generation), renderPosition: () => engine.renderPositionMs,
    outputLease: computed(() => lease.value),
    segment, countdown, lines, lyricGuide, canGuide, assignedHere, startSafe, healthy, serverNowMs, blocked, diagnostics,
    calibrationInvalidated, resetOutput: () => engine.outputChanged(), enable, disable, message,
    retry }
}
