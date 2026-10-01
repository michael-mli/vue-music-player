import type { PartyMediaGrant } from './partyApi'

export async function createPartyMediaTransport(grant: PartyMediaGrant, callbacks: {
  attached: (element: HTMLMediaElement) => void
  detached: (element: HTMLMediaElement) => void
  ended: () => void
  playbackBlocked?: () => void
}) {
  // Load WebRTC only when someone explicitly enables an online media role.
  const { Room, RoomEvent, Track } = await import('livekit-client')
  const room = new Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true,
    reconnectPolicy: { nextRetryDelayInMs: () => null } })
  const received = new Map<string, { participant: string; element: HTMLVideoElement; track: import('livekit-client').RemoteTrack; publication: import('livekit-client').RemoteTrackPublication }>()
  let stopped = false
  room.on(RoomEvent.AudioPlaybackStatusChanged, allowed => { if (!allowed && !stopped) callbacks.playbackBlocked?.() })
  room.on(RoomEvent.VideoPlaybackStatusChanged, allowed => { if (!allowed && !stopped) callbacks.playbackBlocked?.() })
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    const source = track.kind === Track.Kind.Audio ? Track.Source.Microphone : Track.Source.Camera
    // Receive one performance mix and one captured lyric track. A second audio
    // publication must never become a competing instrumental or vocal guide.
    if (grant.scope !== 'audience' || publication.source !== source ||
      publication.trackName !== (track.kind === Track.Kind.Audio ? 'performance-mix' : 'performance-lyrics')) {
      publication.setSubscribed(false); return
    }
    if ([...received.values()].some(item => item.participant !== participant.identity)) {
      // A new authorized nonce replaces any delayed old-track UI events. Remove
      // its entire old media stream before attaching the replacement.
      for (const item of received.values()) { item.publication.setSubscribed(false); item.track.detach(); item.element.pause(); item.element.remove(); callbacks.detached(item.element) }
      received.clear()
    }
    if (received.has(track.kind)) { publication.setSubscribed(false); return }
    const element = received.values().next().value?.element || document.createElement('video')
    element.autoplay = true; element.playsInline = true; element.style.width = '100%'; element.style.borderRadius = '12px'
    // Attach audio and video to one MediaStream on one element, preserving the
    // receiver's A/V synchronization rather than starting independent players.
    track.attach(element)
    received.set(track.kind, { participant: participant.identity, element, track, publication }); callbacks.attached(element)
  })
  room.on(RoomEvent.TrackUnsubscribed, track => {
    const current = received.get(track.kind)
    if (current?.track === track) received.delete(track.kind)
    for (const element of track.detach()) {
      if ([...received.values()].some(item => item.element === element)) callbacks.attached(element)
      else { element.pause(); element.remove(); callbacks.detached(element) }
    }
  })
  room.on(RoomEvent.Disconnected, () => { if (!stopped) callbacks.ended() })
  const server = new URL(grant.serverUrl, window.location.origin)
  server.protocol = server.protocol === 'https:' ? 'wss:' : 'ws:'
  return {
    async connect() { await room.connect(server.toString(), grant.token, { autoSubscribe: grant.scope === 'audience' }) },
    async publish(audio: MediaStream, video: MediaStream) {
      const mix = audio.getAudioTracks()[0], lyrics = video.getVideoTracks()[0]
      if (!mix || !lyrics || stopped) throw new Error('MEDIA_CAPTURE_UNAVAILABLE')
      await room.localParticipant.publishTrack(mix, { name: 'performance-mix', stream: 'performance', source: Track.Source.Microphone,
        audioPreset: { maxBitrate: 64000 }, dtx: false, red: true })
      if (stopped) throw new Error('MEDIA_CAPTURE_UNAVAILABLE')
      await room.localParticipant.publishTrack(lyrics, { name: 'performance-lyrics', stream: 'performance', source: Track.Source.Camera,
        degradationPreference: 'maintain-resolution', simulcast: false, videoEncoding: { maxBitrate: 350000, maxFramerate: 25 } })
    },
    async enableAudio() {
      await room.startAudio()
      await Promise.all([...new Set([...received.values()].map(item => item.element))].map(element => element.play()))
    },
    async close() {
      stopped = true
      for (const item of received.values()) { item.element.pause(); item.element.remove(); callbacks.detached(item.element) }
      received.clear(); await room.disconnect(true)
    },
  }
}
