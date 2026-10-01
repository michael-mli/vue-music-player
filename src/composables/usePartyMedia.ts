import { computed, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue'
import { partyApi, type PartyMediaGrant, type PartySnapshot } from '@/services/partyApi'
import { createPartyMediaTransport } from '@/services/partyMediaTransport'
import { PartyPublishGraph } from '@/services/partyPublishGraph'
import { PartyLyricCapture } from '@/services/partyLyricCapture'
import { PartyAudioEngine } from '@/services/partyAudioEngine'
import { getMicStream, releaseMicStream } from './useMicDevices'
import type { usePartyPlayback } from './usePartyPlayback'
import type { PartyClockEstimate } from '@/utils/partyClock'

type Transport = Awaited<ReturnType<typeof createPartyMediaTransport>>
const mediaErrors: Record<string, string> = {
  MEDIA_UNAVAILABLE: 'mediaErrorUnavailable', MEDIA_REVOKED: 'mediaErrorPermission', MEDIA_PERMISSION: 'mediaErrorPermission',
  AUDIO_GESTURE_REQUIRED: 'mediaErrorOutput', AUDIO_OUTPUT_NOT_READY: 'mediaErrorOutput', MEDIA_OUTPUT: 'mediaErrorOutput',
  MEDIA_MIC_DISCONNECTED: 'mediaErrorMicDisconnected', MEDIA_PERFORMER_ENDED: 'mediaErrorPerformerEnded',
  MEDIA_AUDIENCE_ENDED: 'mediaErrorAudienceEnded', MEDIA_HEADPHONES_PAUSED: 'mediaErrorHeadphonesPaused',
  MEDIA_HEADPHONES_CHANGED: 'mediaErrorHeadphonesChanged', MEDIA_CLOCK_LOST: 'mediaErrorClockLost',
  AUDIO_MEMORY_LIMIT: 'mediaErrorMemory', AUDIO_ASSET_UNAVAILABLE: 'mediaErrorAsset', AUDIO_ASSET_CHANGED: 'mediaErrorAsset',
  LYRIC_CAPTURE_UNSUPPORTED: 'mediaErrorVideo', MEDIA_CAPTURE_UNAVAILABLE: 'mediaErrorCapture',
  PUBLISH_BACKING_UNAVAILABLE: 'mediaErrorAsset',
}
export function partyMediaFailureCode(reason: unknown) {
  if (!reason || typeof reason !== 'object') return 'mediaErrorUnavailable'
  const error = reason as { code?: unknown; message?: unknown; name?: unknown }
  if (typeof error.code === 'string' && typeof mediaErrors[error.code] === 'string') return mediaErrors[error.code]
  if (typeof error.message === 'string' && typeof mediaErrors[error.message] === 'string') return mediaErrors[error.message]
  const names: Record<string, string> = { NotAllowedError: 'mediaErrorMicPermission', SecurityError: 'mediaErrorMicPermission',
    NotFoundError: 'mediaErrorMicMissing', NotReadableError: 'mediaErrorMicBusy', OverconstrainedError: 'mediaErrorMicConstraint' }
  return typeof error.name === 'string' && typeof names[error.name] === 'string' ? names[error.name] : 'mediaErrorUnavailable'
}
export function usePartyMedia(party: Ref<PartySnapshot | null>, connected: Ref<boolean>, clock: Ref<PartyClockEstimate | null>,
  audio: ReturnType<typeof usePartyPlayback>) {
  const available = ref(false), status = ref('off'), failure = ref(''), capture = shallowRef<MediaStream | null>(null)
  const elements = shallowRef<HTMLMediaElement[]>([]), grant = shallowRef<PartyMediaGrant | null>(null)
  const publishCanvas = shallowRef<HTMLCanvasElement | null>(null)
  const inputMode = ref<'clean-mic' | 'venue-mix'>('clean-mic'), alignmentMs = ref(0)
  const backingLevel = ref(.65), vocalLevel = ref(1), headphones = ref(false)
  const originalEnabled = ref(false), originalVolume = ref(.7)
  const mode = computed(() => party.value?.room.performanceMode || 'local')
  const online = computed(() => mode.value !== 'local' && Boolean(party.value?.room.mediaConfigured))
  const singerId = computed(() => party.value?.playback?.state !== 'idle' && party.value?.playback?.singerMemberId || party.value?.readiness?.singerMemberId)
  const canCapture = computed(() => online.value && party.value?.self.admission === 'admitted' && party.value.deviceScope !== 'display' &&
    (party.value.self.id === singerId.value || (mode.value === 'hybrid' && ['host', 'cohost'].includes(party.value.self.role))))
  const isAudience = computed(() => grant.value?.scope === 'audience')
  const captureActive = computed(() => Boolean(capture.value) || status.value === 'preparing')
  const hasVideo = computed(() => elements.value.some(element => element.srcObject instanceof MediaStream && element.srcObject.getVideoTracks().length > 0))
  let transport: Transport | null = null, graph: PartyPublishGraph | null = null, lyrics: PartyLyricCapture | null = null
  let tap: ReturnType<typeof audio.createPublisherTap> | null = null, original: PartyAudioEngine | null = null
  let originalReady = false, oldMonitorVolume = .7, captureBinding = '', epoch = 0, disposed = false
  let starting = false, renewing = false, publisherReady = false, lastRenewMs = 0, lastStatusMs = 0
  let captureSawActive = false

  function binding() {
    const view = party.value, playback = view?.playback
    const performanceId = playback && playback.state !== 'idle' ? playback.performanceId : view?.readiness?.performanceId
    return performanceId && view ? JSON.stringify([view.room.id, mode.value, performanceId, singerId.value, view.self.role]) : ''
  }
  function currentPermit() {
    const permit = grant.value?.permit, playback = party.value?.playback, estimate = clock.value
    return Boolean(permit && estimate?.status === 'healthy' && connected.value && !document.hidden && !audio.blocked.value &&
      playback && ['scheduled', 'playing'].includes(playback.state) && playback.stageDeviceId === audio.deviceId &&
      permit.clockId === playback.clockId && permit.performanceId === playback.performanceId && permit.generation === playback.generation &&
      permit.expiresServerMs > performance.now() + estimate.offsetMs + estimate.uncertaintyMs + 100)
  }
  async function stop() {
    const hadCapture = Boolean(capture.value || captureBinding)
    epoch++; starting = false; publisherReady = false; captureBinding = ''; originalReady = false; captureSawActive = false
    const previous = grant.value, previousRoomId = previous?.room.replace(/^ktv-/, ''), oldTransport = transport, oldOriginal = original
    grant.value = null; transport = null; original = null
    const mic = capture.value; capture.value = null
    // Release capture and render gates synchronously before any network await.
    graph?.close(); graph = null; lyrics?.close(); lyrics = null; tap?.close(); tap = null
    publishCanvas.value?.remove(); publishCanvas.value = null
    releaseMicStream(mic)
    if (originalEnabled.value) audio.volume.value = oldMonitorVolume
    originalEnabled.value = false
    oldOriginal?.stop(); if (oldOriginal) void oldOriginal.close()
    if (hadCapture) audio.disable()
    elements.value = []; status.value = 'off'
    await oldTransport?.close().catch(() => {})
    if (previous && previousRoomId) await partyApi.mediaRevoke(previousRoomId, previous.identity).catch(() => {})
  }
  function fail(reason: unknown) {
    void stop(); failure.value = partyMediaFailureCode(reason); status.value = 'error'
  }
  async function prepareCapture() {
    if (!canCapture.value || !connected.value || !audio.healthy.value || !binding() || (inputMode.value === 'clean-mic' && !headphones.value)) return
    const intended = binding()
    await stop(); failure.value = ''
    if (disposed || !canCapture.value || !connected.value || !audio.healthy.value || binding() !== intended) return
    const attempt = epoch, expected = binding()
    captureBinding = expected; status.value = 'preparing'
    try {
      await audio.enable('stage')
      if (disposed || epoch !== attempt) return
      if (!audio.enabled.value) throw new Error('MEDIA_OUTPUT')
      const stream = await getMicStream({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 })
      if (disposed || epoch !== attempt || !canCapture.value || binding() !== expected || document.hidden) { releaseMicStream(stream); return }
      capture.value = stream
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => { if (capture.value === stream) fail(new Error('MEDIA_MIC_DISCONNECTED')) }, { once: true })
      status.value = 'ready'
    } catch (error) { if (epoch === attempt && !disposed) fail(error) }
  }
  async function startPublisher() {
    if (starting || grant.value || !capture.value || !party.value?.playback?.assets || !audio.prepared.value || !audio.assignedHere.value) return
    const attempt = epoch, roomId = party.value.room.id
    starting = true; status.value = 'connecting'
    let issued: PartyMediaGrant | null = null, connection: Transport | null = null
    try {
      issued = await partyApi.mediaGrant(roomId, audio.deviceId, 'publisher')
      if (disposed || epoch !== attempt || !capture.value) { await partyApi.mediaRevoke(roomId, issued.identity); return }
      grant.value = issued; lastRenewMs = performance.now()
      if (!issued.permit) throw new Error('MEDIA_PERMISSION')
      tap = audio.createPublisherTap(party.value!.playback!.assets!.instrumental.sha256, issued.permit.generation)
      graph = new PartyPublishGraph(tap.context, tap.instrumental, capture.value, issued.permit, inputMode.value, false)
      graph.setAlignment(alignmentMs.value); graph.setPublishLevels(backingLevel.value, vocalLevel.value)
      const canvas = document.createElement('canvas')
      publishCanvas.value = canvas; canvas.style.width = '100%'; canvas.style.borderRadius = '12px'
      lyrics = new PartyLyricCapture(canvas, () => {
        const playback = party.value?.playback, position = audio.renderPosition()
        if (!publisherReady || !currentPermit() || !playback || position === null) return null
        return { title: playback.title || '', singer: playback.singerName || '', renderPositionMs: position,
          backingDelayMs: Math.max(0, alignmentMs.value), lyricOffsetMs: playback.lyricOffsetMs, lines: audio.lines.value }
      })
      connection = await createPartyMediaTransport(issued, { attached() {}, detached() {}, ended: () => { if (epoch === attempt) fail(new Error('MEDIA_PERFORMER_ENDED')) } })
      if (disposed || epoch !== attempt) { await connection.close(); return }
      transport = connection
      await connection.connect()
      if (epoch !== attempt || !graph || !lyrics) return
      await connection.publish(graph.stream, lyrics.stream)
      if (epoch !== attempt) return
      await partyApi.mediaReady(roomId, issued.identity, audio.deviceId)
      if (epoch !== attempt || !currentPermit()) return
      publisherReady = true; status.value = 'publishing'
    } catch (error) { if (epoch === attempt && !disposed) fail(error) }
    finally { if (epoch === attempt) starting = false }
  }
  async function listen() {
    if (!online.value || !connected.value || party.value?.self.admission !== 'admitted') return
    const intendedRoom = party.value.room.id
    await stop(); audio.disable(); failure.value = ''
    if (disposed || !online.value || !connected.value || party.value?.room.id !== intendedRoom) return
    const attempt = epoch, roomId = party.value!.room.id
    status.value = 'connecting'
    try {
      const issued = await partyApi.mediaGrant(roomId, audio.deviceId, 'audience')
      if (disposed || epoch !== attempt) { await partyApi.mediaRevoke(roomId, issued.identity); return }
      grant.value = issued; lastRenewMs = performance.now()
      const connection = await createPartyMediaTransport(issued, {
        attached: element => { if (epoch === attempt) elements.value = [...new Set([...elements.value, element])] },
        detached: element => { elements.value = elements.value.filter(item => item !== element) },
        playbackBlocked: () => { if (epoch === attempt) status.value = 'audio-blocked' },
        ended: () => { if (epoch === attempt) fail(new Error('MEDIA_AUDIENCE_ENDED')) },
      })
      if (disposed || epoch !== attempt) { await connection.close(); return }
      transport = connection; await connection.connect()
      if (epoch !== attempt) return
      status.value = 'listening'
      await enableAudio()
    } catch (error) { if (epoch === attempt && !disposed) fail(error) }
  }
  async function enableAudio() {
    try { await transport?.enableAudio(); if (isAudience.value) status.value = 'listening' }
    catch { status.value = 'audio-blocked' }
  }
  async function toggleOriginal() {
    if (originalEnabled.value) {
      originalEnabled.value = false; originalReady = false; original?.stop(); if (original) void original.close(); original = null
      audio.volume.value = oldMonitorVolume; return
    }
    const asset = party.value?.playback?.assets?.original
    if (!asset || !capture.value || party.value?.self.id !== singerId.value) return
    const attempt = epoch, engine = new PartyAudioEngine()
    original = engine; oldMonitorVolume = audio.volume.value; originalEnabled.value = true; audio.volume.value = 0
    engine.onSuspended = () => { if (epoch === attempt && original === engine) fail(new Error('MEDIA_HEADPHONES_PAUSED')) }
    engine.onRecovery = () => { if (epoch === attempt && original === engine) fail(new Error('MEDIA_HEADPHONES_CHANGED')) }
    try {
      await engine.enable()
      if (epoch !== attempt || original !== engine) { await engine.close(); return }
      await engine.prepare(asset, 'original')
      if (epoch === attempt && original === engine) { originalReady = true; engine.setVolume(originalVolume.value) }
      else await engine.close()
    } catch (error) { if (epoch === attempt && original === engine) fail(error) }
  }
  watch(originalVolume, value => original?.setVolume(value))
  watch([backingLevel, vocalLevel], () => graph?.setPublishLevels(backingLevel.value, vocalLevel.value))
  // Guard microphone promises, current capture and an established publisher on
  // turn/role/mode changes, suspension, membership loss or room disconnection.
  watch([binding, canCapture, connected, () => party.value?.self.admission, () => audio.blocked.value], () => {
    if (!connected.value || party.value?.self.admission !== 'admitted' || (captureBinding &&
      (!canCapture.value || binding() !== captureBinding || audio.blocked.value))) void stop()
  }, { flush: 'sync' })
  watch(() => party.value?.room.id, () => { void stop(); available.value = false; lastStatusMs = 0 }, { flush: 'sync' })
  async function refreshStatus() {
    const roomId = party.value?.room.id
    if (!roomId || !party.value?.room.mediaConfigured || !connected.value || document.hidden) return
    const attempt = epoch
    try { const result = await partyApi.mediaStatus(roomId); if (!disposed && party.value?.room.id === roomId) available.value = result.available }
    catch { if (epoch === attempt) available.value = false }
  }
  const timer = window.setInterval(() => {
    if (disposed || document.hidden) return
    const now = performance.now(), playback = party.value?.playback
    if (now - lastStatusMs >= 5000) { lastStatusMs = now; void refreshStatus() }
    if (capture.value && (!capture.value.getAudioTracks().some(track => track.readyState === 'live') || !audio.healthy.value)) { fail(new Error('MEDIA_CLOCK_LOST')); return }
    if (grant.value?.scope === 'publisher' && (!currentPermit() || !tap?.active)) { fail(new Error('MEDIA_PERMISSION')); return }
    if (capture.value && !grant.value && playback && ['scheduled', 'playing'].includes(playback.state)) void startPublisher()
    if (captureBinding && playback && ['scheduled', 'playing'].includes(playback.state)) captureSawActive = true
    else if (captureBinding && captureSawActive) { void stop(); return }
    if (publisherReady && graph && grant.value?.permit && clock.value) graph.renew({ ...grant.value.permit,
      expiresServerMs: Math.min(grant.value.permit.expiresServerMs, playback?.lease?.expiresServerMs || 0) }, clock.value)
    if (originalReady && original && publisherReady && playback && clock.value && currentPermit()) original.sync(playback, clock.value, playback.lease, 'guide')
    else original?.stop()
    const current = grant.value
    if (current && !renewing && now - lastRenewMs >= (current.scope === 'publisher' ? 1000 : 30000)) {
      const attempt = epoch, roomId = party.value!.room.id
      renewing = true; lastRenewMs = now
      void partyApi.mediaRenew(roomId, current.identity, audio.deviceId).then(next => {
        if (epoch === attempt && grant.value?.identity === next.identity) grant.value = next
      }).catch(error => { if (epoch === attempt) fail(error) }).finally(() => { renewing = false })
    }
  }, 100)
  const hidden = () => { if (document.hidden) void stop() }
  document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', stop)
  onUnmounted(() => { disposed = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', stop); void stop() })
  return { available, online, mode, status, failure, captureActive, canCapture, isAudience, hasVideo, elements, publishCanvas,
    inputMode, alignmentMs, backingLevel, vocalLevel, headphones, originalEnabled, originalVolume,
    prepareCapture, listen, enableAudio, toggleOriginal, stop, refreshStatus }
}
