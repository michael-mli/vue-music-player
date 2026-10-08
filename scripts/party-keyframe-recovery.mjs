// Private recovery hypothesis, using native RTP progress only. Never supply
// marker IDs, marker skew, lyric state, decoded pixels or source test transitions.
export function keyframeRecoveryStep(time, audio, video, previous, owned=null) {
  const numbers = [time, audio?.timestamp, video?.timestamp, audio?.ssrc, video?.ssrc,
    video?.framesDecoded, video?.keyFramesDecoded]
  if (!numbers.every(Number.isFinite) || time < 0 || video.framesDecoded < 0 || video.keyFramesDecoded < 0 ||
    Math.abs(audio.timestamp - video.timestamp) > 100) return { valid: false, request: false }
  const state = { time, audioSsrc: audio.ssrc, videoSsrc: video.ssrc, framesDecoded: video.framesDecoded,
    keyFramesDecoded: video.keyFramesDecoded, lastRequestMs: previous?.lastRequestMs ?? null }
  if(owned!==null){
    if(owned.closed||!owned.configured||!Number.isSafeInteger(owned.worker)||owned.worker<1||
      !Number.isSafeInteger(owned.lateFrames)||owned.lateFrames<0)return {valid:false,request:false}
    state.ownedWorker=owned.worker;state.lateFrames=owned.lateFrames
    if(previous&&(previous.ownedWorker!==owned.worker||!Number.isSafeInteger(previous.lateFrames)||
      owned.lateFrames<previous.lateFrames))return {valid:false,request:false}
  }
  if (!previous) return { valid: true, request: false, state }
  const elapsedMs = time - previous.time
  if (![previous.time, previous.audioSsrc, previous.videoSsrc, previous.framesDecoded, previous.keyFramesDecoded].every(Number.isFinite) ||
    elapsedMs < 500 || elapsedMs > 2500 || audio.ssrc !== previous.audioSsrc || video.ssrc !== previous.videoSsrc ||
    video.framesDecoded < previous.framesDecoded || video.keyFramesDecoded < previous.keyFramesDecoded ||
    state.lastRequestMs !== null && (!Number.isFinite(state.lastRequestMs) || state.lastRequestMs > time))
    return { valid: false, request: false }
  const aheadMs = [audio.estimatedPlayoutTimestamp, video.estimatedPlayoutTimestamp].every(Number.isFinite)
    ? video.estimatedPlayoutTimestamp - audio.estimatedPlayoutTimestamp - (video.timestamp - audio.timestamp) : null
  const reason = owned!==null&&owned.lateFrames>previous.lateFrames?'late-reference':
    video.framesDecoded === previous.framesDecoded ? 'frame-stalled' :
    aheadMs !== null && aheadMs >= -2000 && aheadMs < -150 ? 'video-behind' : null
  // A decoded keyframe already represents recent recovery work. Do not send a
  // further request on that sample or within five seconds of our last request.
  const request = reason !== null && video.keyFramesDecoded === previous.keyFramesDecoded &&
    (state.lastRequestMs === null || time - state.lastRequestMs >= 5000)
  if (request) state.lastRequestMs = time
  return { valid: true, request, reason: request ? reason : null, aheadMs, state }
}
