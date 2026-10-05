// The singer owns this session while their private guide is enabled. Lock-screen
// controls affect only this device; they never issue room playback commands.
export function createPartyGuideSession(resume: () => void, stop: () => void) {
  let owned = false, title = '', previousType: string | undefined
  const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  function acquire() {
    if (owned) return
    owned = true
    if (audioSession) {
      previousType = audioSession.type
      try { audioSession.type = 'playback' } catch { /* Browser does not support this category. */ }
    }
    if (!navigator.mediaSession) return
    for (const [action, handler] of [['play', resume], ['pause', stop], ['stop', stop]] as const) {
      try { navigator.mediaSession.setActionHandler(action, handler) } catch { /* Unsupported action. */ }
    }
  }
  function update(song: string, playing: boolean, positionMs: number, durationMs: number) {
    if (!owned || !navigator.mediaSession) return
    const session = navigator.mediaSession
    if (title !== song && typeof MediaMetadata === 'function') {
      title = song
      session.metadata = new MediaMetadata({ title: song, artist: 'KTV · Private vocal guide' })
    }
    session.playbackState = playing ? 'playing' : 'paused'
    try {
      if (durationMs > 0) session.setPositionState({ duration: durationMs / 1000, playbackRate: 1,
        position: Math.max(0, Math.min(durationMs, positionMs)) / 1000 })
      else session.setPositionState()
    } catch { /* Position reporting is optional. */ }
  }
  function release() {
    if (!owned) return
    owned = false; title = ''
    if (navigator.mediaSession) {
      for (const action of ['play', 'pause', 'stop'] as const) {
        try { navigator.mediaSession.setActionHandler(action, null) } catch { /* Unsupported action. */ }
      }
      navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'
      try { navigator.mediaSession.setPositionState() } catch { /* Optional API. */ }
    }
    if (audioSession?.type === 'playback') {
      try { audioSession.type = previousType || 'auto' } catch { /* Optional API. */ }
    }
  }
  return { acquire, update, release }
}
