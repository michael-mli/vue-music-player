import type { PartyMediaGrant } from './partyApi'
import type { PartyClockEstimate } from '@/utils/partyClock'
import type { PartyPublishPermit } from './partyPublishGraph'
import { PartyEncodedLease, partyEncodedRTCConfiguration } from './partyEncodedLease'
import { PartyReceiveGraph, type PartyReceivePermit } from './partyReceiveGraph'
import { installPartyLeaseGuard } from './partyLeaseGuard'

export async function createPartyMediaTransport(grant: PartyMediaGrant, callbacks: {
  attached: (element: HTMLMediaElement) => void
  detached: (element: HTMLMediaElement) => void
  ended: (recoverable: boolean) => void
  playbackBlocked?: () => void
}) {
  // Load WebRTC only when someone explicitly enables an online media role.
  const { Room, RoomEvent, Track, DisconnectReason } = await import('livekit-client')
  const room = new Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true,
    reconnectPolicy: { nextRetryDelayInMs: () => null } })
  const rtcConfig = grant.scope === 'publisher' ? partyEncodedRTCConfiguration() : undefined
  const received = new Map<string, { participant: string; element: HTMLVideoElement; track: import('livekit-client').RemoteTrack; publication: import('livekit-client').RemoteTrackPublication }>()
  let stopped = false, terminalNotified = false
  let encodedLease: PartyEncodedLease | null = null
  let receivePermit: PartyReceivePermit | null = null, receiveClock: PartyClockEstimate | null = null
  let receiveContext: AudioContext | null = null, receiveGraph: PartyReceiveGraph | null = null
  let receiveAudioReady = false
  let enabling: Promise<void> | null = null
  function closeReceiveGraph() { receiveGraph?.close(); receiveGraph = null }
  function removeElement(element: HTMLMediaElement) {
    element.pause(); element.srcObject = null; element.remove(); callbacks.detached(element)
  }
  function clearReceived() {
    closeReceiveGraph()
    const previous = [...received.values()]
    received.clear()
    for (const item of previous) { item.publication.setSubscribed(false); item.track.detach() }
    for (const element of new Set(previous.map(item => item.element))) removeElement(element)
  }
  function outputFailed() {
    if (stopped || terminalNotified) return
    terminalNotified = true; closeReceiveGraph()
    for (const element of new Set([...received.values()].map(item => item.element))) element.pause()
    callbacks.ended(true)
  }
  function applyReceiveOutput(): boolean {
    const audio = received.get(Track.Kind.Audio)
    if (!receiveAudioReady || !receiveContext || !receivePermit || !receiveClock || !audio) return true
    if (!receiveGraph) receiveGraph = new PartyReceiveGraph(receiveContext,
      new MediaStream([audio.track.mediaStreamTrack]), receivePermit, outputFailed)
    return receiveGraph.renew(receivePermit, receiveClock)
  }
  function syncReceiveSubscriptions() {
    if (grant.scope !== 'audience' || stopped || terminalNotified) return
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        const expected = publication.kind === Track.Kind.Audio
          ? publication.source === Track.Source.Microphone && publication.trackName === 'performance-mix'
          : publication.source === Track.Source.ScreenShare && publication.trackName === 'performance-lyrics'
        const desired = Boolean(receivePermit && participant.identity === receivePermit.publisherIdentity && expected)
        if (publication.isDesired !== desired) publication.setSubscribed(desired)
      }
    }
  }
  room.on(RoomEvent.TrackPublished, syncReceiveSubscriptions)
  room.on(RoomEvent.AudioPlaybackStatusChanged, allowed => { if (!allowed && !stopped) callbacks.playbackBlocked?.() })
  room.on(RoomEvent.VideoPlaybackStatusChanged, allowed => { if (!allowed && !stopped) callbacks.playbackBlocked?.() })
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    const source = track.kind === Track.Kind.Audio ? Track.Source.Microphone : Track.Source.ScreenShare
    // Receive one performance mix and one captured lyric track. A second audio
    // publication must never become a competing instrumental or vocal guide.
    if (stopped || terminalNotified || grant.scope !== 'audience' || !receivePermit || participant.identity !== receivePermit.publisherIdentity || publication.source !== source ||
      publication.trackName !== (track.kind === Track.Kind.Audio ? 'performance-mix' : 'performance-lyrics')) {
      publication.setSubscribed(false); return
    }
    if (received.has(track.kind)) { publication.setSubscribed(false); return }
    const element = received.values().next().value?.element || document.createElement('video')
    element.autoplay = true; element.playsInline = true; element.style.width = '100%'; element.style.borderRadius = '12px'
    // Own this always-muted element ourselves. SDK attach/startAudio unmute raw
    // received audio, bypassing the post-buffer deadline guard. Retain both tracks
    // in the common native stream; the sole audible path is the guarded graph.
    element.muted = true
    const stream = element.srcObject instanceof MediaStream ? element.srcObject : new MediaStream()
    stream.addTrack(track.mediaStreamTrack); element.srcObject = stream
    received.set(track.kind, { participant: participant.identity, element, track, publication }); callbacks.attached(element)
    void element.play().catch((error: unknown) => {
      if (!stopped && !terminalNotified && (error as { name?: unknown } | null)?.name !== 'AbortError' &&
        [...received.values()].some(item => item.element === element)) callbacks.playbackBlocked?.()
    })
    try { applyReceiveOutput() } catch { outputFailed() }
  })
  room.on(RoomEvent.TrackUnsubscribed, track => {
    const current = received.get(track.kind)
    if (current?.track === track) {
      if (track.kind === Track.Kind.Audio) closeReceiveGraph()
      if (current.element.srcObject instanceof MediaStream) current.element.srcObject.removeTrack(track.mediaStreamTrack)
      received.delete(track.kind)
    }
    // LiveKit may detach the media element before emitting TrackUnsubscribed,
    // so detach() can return []. Our own record still owns the stale UI node.
    const detached = new Set<HTMLMediaElement>(track.detach())
    if (current?.track === track) detached.add(current.element)
    for (const element of detached) {
      if ([...received.values()].some(item => item.element === element)) callbacks.attached(element)
      else removeElement(element)
    }
  })
  room.on(RoomEvent.Disconnected, reason => {
    if (stopped || terminalNotified) return
    terminalNotified = true
    encodedLease?.close()
    closeReceiveGraph()
    for (const element of new Set([...received.values()].map(item => item.element))) element.pause()
    // Gateway disconnects revoke this nonce. Recovery must obtain a fresh grant;
    // provider removals, room close and explicit leave must remain terminal.
    const recoverable = grant.scope === 'audience' && (reason === undefined ||
      reason === DisconnectReason.UNKNOWN_REASON || reason === DisconnectReason.SIGNAL_CLOSE)
    callbacks.ended(recoverable)
  })
  const server = new URL(grant.serverUrl, window.location.origin)
  server.protocol = server.protocol === 'https:' ? 'wss:' : 'ws:'
  return {
    async connect() {
      await room.connect(server.toString(), grant.token, { autoSubscribe: false, rtcConfig })
      syncReceiveSubscriptions()
    },
    async publish(audio: MediaStream, video: MediaStream) {
      const mix = audio.getAudioTracks()[0], lyrics = video.getVideoTracks()[0]
      if (!mix || !lyrics || stopped || encodedLease || grant.scope !== 'publisher' || !grant.permit) throw new Error('MEDIA_CAPTURE_UNAVAILABLE')
      encodedLease = new PartyEncodedLease(grant.permit, () => {
        if (stopped || terminalNotified) return
        terminalNotified = true; callbacks.ended(false)
      })
      const audioPublication = await room.localParticipant.publishTrack(mix, { name: 'performance-mix', stream: 'performance', source: Track.Source.Microphone,
        audioPreset: { maxBitrate: 64000 }, dtx: false, red: true })
      if (stopped) throw new Error('MEDIA_CAPTURE_UNAVAILABLE')
      encodedLease.attach(audioPublication.track?.sender, 'audio')
      // Captured lyrics are screen content. Camera classification causes the SFU
      // to apply a jitter-driven video delay to low-rate canvas traffic.
      const videoPublication = await room.localParticipant.publishTrack(lyrics, { name: 'performance-lyrics', stream: 'performance', source: Track.Source.ScreenShare,
        degradationPreference: 'maintain-resolution', simulcast: false, screenShareEncoding: { maxBitrate: 350000, maxFramerate: 25 } })
      if (stopped) throw new Error('MEDIA_CAPTURE_UNAVAILABLE')
      encodedLease.attach(videoPublication.track?.sender, 'video')
    },
    renewPublishPermit(permit: PartyPublishPermit, clock: PartyClockEstimate) {
      return !stopped && !terminalNotified && !!encodedLease && encodedLease.renew(permit, clock)
    },
    renewReceivePermit(permit: PartyReceivePermit | null, clock: PartyClockEstimate | null) {
      if (stopped || terminalNotified || grant.scope !== 'audience') return false
      if (!permit) { receivePermit = null; receiveClock = null; clearReceived(); syncReceiveSubscriptions(); return true }
      const duration = permit.expiresServerMs - performance.now() - (clock?.offsetMs ?? NaN) - (clock?.uncertaintyMs ?? NaN) - 100
      if (!clock || clock.status !== 'healthy' || clock.clockId !== permit.clockId || !permit.publisherIdentity ||
        !permit.performanceId || !Number.isSafeInteger(permit.generation) || permit.generation < 1 ||
        !Number.isFinite(clock.uncertaintyMs) || clock.uncertaintyMs < 0 || clock.uncertaintyMs > 80 ||
        !Number.isFinite(duration) || duration <= 0 || duration > 10000) { outputFailed(); return false }
      if (receivePermit && (receivePermit.publisherIdentity !== permit.publisherIdentity || receivePermit.clockId !== permit.clockId ||
        receivePermit.performanceId !== permit.performanceId || receivePermit.generation !== permit.generation)) clearReceived()
      receivePermit = { ...permit }; receiveClock = { ...clock }
      syncReceiveSubscriptions()
      try { return applyReceiveOutput() } catch { outputFailed(); return false }
    },
    async enableAudio() {
      if (stopped || terminalNotified) return
      if (grant.scope !== 'audience') { await room.startAudio(); return }
      if (!enabling) {
        const context = receiveContext ||= new AudioContext({ latencyHint: 'interactive' })
        enabling = (async () => {
          await context.resume(); await installPartyLeaseGuard(context)
          if (stopped || terminalNotified) return
          if (context.state !== 'running') throw new Error('AUDIO_OUTPUT_NOT_READY')
          receiveAudioReady = true
          if (!applyReceiveOutput()) throw new Error('MEDIA_PERMISSION')
          for (const element of new Set([...received.values()].map(item => item.element))) {
            if (stopped || terminalNotified) return
            element.muted = true; await element.play()
          }
        })()
      }
      try { await enabling } finally { enabling = null }
    },
    async close() {
      stopped = true
      encodedLease?.close()
      clearReceived()
      const context = receiveContext; receiveContext = null
      receiveAudioReady = false
      await Promise.all([context?.close(), room.disconnect(true)])
    },
  }
}
