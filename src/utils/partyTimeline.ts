import type { PartyPlayback, PartySegment } from '@/services/partyApi'

export function partySegment(playback: PartyPlayback, nowMs: number): PartySegment {
  return playback.pendingTransition && nowMs >= playback.pendingTransition.effectiveServerMs ? playback.pendingTransition : playback
}
export function partyPosition(playback: PartyPlayback, nowMs: number): number {
  const segment = partySegment(playback, nowMs)
  const advancing = segment.state === 'scheduled' || segment.state === 'playing'
  return Math.max(0, Math.min(playback.durationMs, segment.positionMs +
    (advancing ? Math.max(0, nowMs - segment.anchorServerMs) : 0)))
}

// Timestamp mapping includes the browser's output path exactly once. The fallback
// estimates it from outputLatency/baseLatency; external TV/BT delay still needs
// measured calibration.
export function serverToAudioTime(context: AudioContext, targetServerMs: number, offsetMs: number, nowMs = performance.now()): number {
  const timestamp = context.getOutputTimestamp?.()
  if (timestamp && typeof timestamp.performanceTime === 'number' && typeof timestamp.contextTime === 'number' && timestamp.performanceTime > 0 && timestamp.contextTime >= 0 &&
    Math.abs(timestamp.performanceTime - nowMs) < 2000) {
    return timestamp.contextTime + (targetServerMs - offsetMs - timestamp.performanceTime) / 1000
  }
  const latency = Number.isFinite(context.outputLatency) && context.outputLatency > 0 ? context.outputLatency : context.baseLatency || 0
  return context.currentTime + (targetServerMs - offsetMs - nowMs) / 1000 - latency
}
