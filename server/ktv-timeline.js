export function timelinePosition(timeline, nowMs) {
  if (!timeline || timeline.state === 'idle') return 0
  const pending = timeline.pendingTransition
  if (pending && nowMs >= pending.effectiveServerMs) {
    return segmentPosition(pending, nowMs, timeline.durationMs)
  }
  return segmentPosition(timeline, nowMs, timeline.durationMs)
}

function segmentPosition(segment, nowMs, durationMs) {
  const advancing = segment.state === 'playing' || segment.state === 'scheduled'
  return Math.max(0, Math.min(durationMs || 0, segment.positionMs +
    (advancing ? Math.max(0, nowMs - segment.anchorServerMs) : 0)))
}

export function effectiveTimeline(timeline, nowMs) {
  const pending = timeline?.pendingTransition
  if (pending && nowMs >= pending.effectiveServerMs) {
    return { ...timeline, ...pending, pendingTransition: null }
  }
  return timeline
}
