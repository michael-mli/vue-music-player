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
export function partyOutputClock(context: AudioContext, nowMs = performance.now()): { contextTime: number; mode: 'timestamp' | 'estimate'; latencyMs: number } {
  const timestamp = context.getOutputTimestamp?.()
  if (timestamp && typeof timestamp.performanceTime === 'number' && typeof timestamp.contextTime === 'number' &&
    Number.isFinite(timestamp.performanceTime) && Number.isFinite(timestamp.contextTime) && timestamp.performanceTime > 0 && timestamp.contextTime >= 0 &&
    Math.abs(timestamp.performanceTime - nowMs) < 2000) {
    const contextTime = timestamp.contextTime + (nowMs - timestamp.performanceTime) / 1000
    return { contextTime, mode: 'timestamp', latencyMs: Math.max(0, (context.currentTime - contextTime) * 1000) }
  }
  const latency = Number.isFinite(context.outputLatency) && context.outputLatency > 0 ? context.outputLatency :
    Number.isFinite(context.baseLatency) && context.baseLatency > 0 ? context.baseLatency : 0
  return { contextTime: context.currentTime - latency, mode: 'estimate', latencyMs: latency * 1000 }
}
export function serverToAudioTime(context: AudioContext, targetServerMs: number, offsetMs: number, nowMs = performance.now()): number {
  return partyOutputClock(context, nowMs).contextTime + (targetServerMs - offsetMs - nowMs) / 1000
}
