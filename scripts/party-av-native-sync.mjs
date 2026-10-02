// Owned fixture experiment only. Keep the native audio/video renderer and media
// clocks; vary receiver buffering hints from same-source sender NTP estimates.
export function nativeSyncTargetStep(audio, video, targets) {
  if (![audio?.estimatedPlayoutTimestamp, video?.estimatedPlayoutTimestamp,
    audio?.timestamp, video?.timestamp, targets.audio, targets.video].every(Number.isFinite) ||
    Math.abs(audio.timestamp - video.timestamp) > 100 ||
    targets.audio < 0 || targets.audio > 500 || targets.video < 0 || targets.video > 500) return null
  // Both estimates are in sender NTP time. Align their report times before
  // subtracting; never compare the sender epoch to the observer's wall clock.
  const aheadMs = (video.estimatedPlayoutTimestamp - audio.estimatedPlayoutTimestamp) -
    (video.timestamp - audio.timestamp)
  if (Math.abs(aheadMs) > 2000) return null
  if (Math.abs(aheadMs) <= 40) return { ...targets, aheadMs }
  const correction = Math.sign(aheadMs) * Math.min(100, (Math.abs(aheadMs) - 40) / 2)
  let audioTarget = Math.max(0, Math.min(500, targets.audio - correction))
  let videoTarget = Math.max(0, Math.min(500, targets.video + correction))
  // Do not accumulate common delay: only the leading track needs an extra hint.
  const common = Math.min(audioTarget, videoTarget)
  audioTarget -= common; videoTarget -= common
  return { audio: audioTarget, video: videoTarget, aheadMs }
}

export function nativeNetworkTargetStep(audio, video, targets, previous) {
  const minima = {}
  for (const [kind, current] of [['audio', audio], ['video', video]]) {
    const before = previous?.[kind]
    if (![current?.jitterBufferMinimumDelay, current?.jitterBufferEmittedCount].every(Number.isFinite) ||
      before && (current.ssrc !== before.ssrc ||
        ![before.jitterBufferMinimumDelay, before.jitterBufferEmittedCount].every(Number.isFinite))) return null
    const delay = current.jitterBufferMinimumDelay - (before?.jitterBufferMinimumDelay || 0)
    const count = current.jitterBufferEmittedCount - (before?.jitterBufferEmittedCount || 0)
    if (delay < 0 || count <= 0) return null
    minima[kind] = delay * 1000 / count
  }
  const target = Math.min(500, Math.ceil(Math.max(minima.audio, minima.video) / 5) * 5)
  return { audio: target, video: target, networkMinimumMs: minima }
}

export function installNativeSyncExperiment(step) {
  const element = document.querySelector('[data-party-media-screen] video')
  const tracks = element?.srcObject?.getTracks() || []
  const receivers = window.__peers.flatMap((peer, index) => peer.getReceivers()
    .filter(receiver => tracks.some(track => track.id === receiver.track?.id))
    .map(receiver => ({ receiver, peer: index })))
  if (receivers.length !== 2 || new Set(receivers.map(item => item.receiver.track.kind)).size !== 2 ||
    receivers.some(item => !('jitterBufferTarget' in item.receiver))) throw new Error('AV_NATIVE_SYNC_UNSUPPORTED')
  const originals = receivers.map(item => item.receiver.jitterBufferTarget)
  let targets = { audio: 0, video: 0 }, previous, closed = false
  window.__avNativeSync = {
    sample(snapshot) {
      if (closed) throw new Error('AV_NATIVE_SYNC_CLOSED')
      const reports = {}
      for (const { receiver, peer } of receivers) {
        if (!element.srcObject?.getTracks().some(track => track.id === receiver.track.id)) throw new Error('AV_NATIVE_SYNC_PAIR_CHANGED')
        const rows = snapshot.reports.filter(row => row.peer === peer && row.type === 'inbound-rtp' && row.kind === receiver.track.kind)
        if (rows.length !== 1) throw new Error('AV_NATIVE_SYNC_AMBIGUOUS_STATS')
        reports[receiver.track.kind] = rows[0]
      }
      const next = step(reports.audio, reports.video, targets, previous)
      previous = reports
      if (!next) return { valid: false, ...targets }
      targets = { audio: next.audio, video: next.video }
      for (const { receiver } of receivers) {
        receiver.jitterBufferTarget = targets[receiver.track.kind]
        if (receiver.jitterBufferTarget !== targets[receiver.track.kind]) throw new Error('AV_NATIVE_SYNC_TARGET_REJECTED')
      }
      return { valid: true, ...targets, aheadMs: next.aheadMs, networkMinimumMs: next.networkMinimumMs }
    },
    close() {
      if (closed) return
      closed = true
      receivers.forEach((item, index) => { item.receiver.jitterBufferTarget = originals[index] })
    },
  }
  return receivers.map(item => ({ kind: item.receiver.track.kind, originalTarget: item.receiver.jitterBufferTarget }))
}
