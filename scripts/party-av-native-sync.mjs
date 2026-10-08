// Owned fixture experiment only. Keep the native audio/video renderer and media
// clocks; vary receiver buffering hints from scoped native RTP/transport stats.
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

// Diagnostic hypothesis: budget one retransmission round trip on each lossy
// hop. Read only measured RTT and NACK progress, never marker IDs or A/V skew.
export function nativeRepairTargetStep(audio, video, targets, previous, context) {
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
  const before = previous?.context
  if (![context?.time, context?.publisherRoundTripMs, context?.receiverRoundTripMs,
    context?.sourceVideo?.nackCount, video?.nackCount].every(Number.isFinite) ||
    context.publisherRoundTripMs < 0 || context.publisherRoundTripMs > 1000 ||
    context.receiverRoundTripMs < 0 || context.receiverRoundTripMs > 1000 ||
    before && (context.time <= before.time || context.time - before.time > 3000 ||
      context.sourceVideo.ssrc !== before.sourceVideo.ssrc ||
      context.sourceVideo.nackCount < before.sourceVideo.nackCount || video.nackCount < previous.video.nackCount)) return null
  const old = previous?.repair || { sourceLossUntil: 0, receiverLossUntil: 0 }
  const sourceLossUntil = context.sourceVideo.nackCount > (before?.sourceVideo.nackCount ?? context.sourceVideo.nackCount)
    ? context.time + 10000 : old.sourceLossUntil
  const receiverLossUntil = video.nackCount > (previous?.video.nackCount ?? video.nackCount)
    ? context.time + 10000 : old.receiverLossUntil
  const repairMs = (sourceLossUntil > context.time ? context.publisherRoundTripMs : 0) +
    (receiverLossUntil > context.time ? context.receiverRoundTripMs : 0)
  const requested = Math.ceil((Math.max(minima.audio, minima.video) + repairMs) / 5) * 5
  // A high delay is a failed hypothesis, not a reason to evade the observation
  // bound. Decrease slowly after a ten-second loss-free window.
  if (requested > 1500) return null
  const elapsedSeconds = before ? (context.time - before.time) / 1000 : 0
  const target = Math.max(requested, Math.max(targets.audio, targets.video) - 50 * elapsedSeconds)
  return { audio: target, video: target, networkMinimumMs: minima, repairMs,
    repair: { sourceLossUntil, receiverLossUntil } }
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
    sample(snapshot, sourceSnapshot) {
      if (closed) throw new Error('AV_NATIVE_SYNC_CLOSED')
      const reports = {}
      for (const { receiver, peer } of receivers) {
        if (!element.srcObject?.getTracks().some(track => track.id === receiver.track.id)) throw new Error('AV_NATIVE_SYNC_PAIR_CHANGED')
        const rows = snapshot.reports.filter(row => row.peer === peer && row.type === 'inbound-rtp' && row.kind === receiver.track.kind)
        if (rows.length !== 1) throw new Error('AV_NATIVE_SYNC_AMBIGUOUS_STATS')
        reports[receiver.track.kind] = rows[0]
      }
      let context
      if (sourceSnapshot) {
        const sourceVideos = sourceSnapshot.reports.filter(row => row.type === 'outbound-rtp' && row.kind === 'video')
        if (sourceVideos.length !== 1 || Math.abs(sourceSnapshot.time - snapshot.time) > 250) throw new Error('AV_NATIVE_SYNC_SOURCE_STATS')
        const sourceVideo = sourceVideos[0]
        const sourceTransports = sourceSnapshot.reports.filter(row => row.type === 'selected-transport' && row.peer === sourceVideo.peer)
        const receiverTransports = snapshot.reports.filter(row => row.type === 'selected-transport' && row.peer === receivers[0].peer)
        if (sourceTransports.length !== 1 || receiverTransports.length !== 1) throw new Error('AV_NATIVE_SYNC_TRANSPORT_STATS')
        context = { time: snapshot.time, sourceVideo,
          publisherRoundTripMs: sourceTransports[0].currentRoundTripTime * 1000,
          receiverRoundTripMs: receiverTransports[0].currentRoundTripTime * 1000 }
      }
      const next = step(reports.audio, reports.video, targets, previous, context)
      previous = { ...reports, context, repair: next?.repair || previous?.repair }
      if (!next) return { valid: false, ...targets }
      targets = { audio: next.audio, video: next.video }
      for (const { receiver } of receivers) {
        receiver.jitterBufferTarget = targets[receiver.track.kind]
        if (receiver.jitterBufferTarget !== targets[receiver.track.kind]) throw new Error('AV_NATIVE_SYNC_TARGET_REJECTED')
      }
      return { valid: true, ...targets, aheadMs: next.aheadMs, networkMinimumMs: next.networkMinimumMs,
        ...(context ? { repairMs: next.repairMs, context } : {}) }
    },
    close() {
      if (closed) return
      closed = true
      receivers.forEach((item, index) => { item.receiver.jitterBufferTarget = originals[index] })
    },
  }
  return receivers.map(item => ({ kind: item.receiver.track.kind, originalTarget: item.receiver.jitterBufferTarget }))
}
