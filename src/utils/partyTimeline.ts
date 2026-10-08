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

interface RateSegment { time: number; positionMs: number; from: number; to: number; end: number }

// Local media position follows the integral of the native playbackRate ramp.
// The authoritative room timeline remains at rate 1. Keeping recent segments
// also maps delayed output timestamps across a rate change without rewriting
// history or using wall-clock lyrics as the captured source position.
export class PartySourcePosition {
  private segments: RateSegment[]
  private errors: number[] = []
  constructor(when: number, offsetMs: number) {
    this.segments = [{ time: when, positionMs: offsetMs, from: 1, to: 1, end: when }]
  }
  private segment(time: number) {
    if (!Number.isFinite(time)) return undefined
    return [...this.segments].reverse().find(segment => segment.time <= time)
  }
  positionAt(time: number): number | null {
    const segment = this.segment(time)
    if (!segment) return null
    const ramp = segment.end - segment.time, elapsed = time - segment.time
    const during = Math.min(elapsed, ramp)
    const integral = ramp > 0 ? segment.from * during + (segment.to - segment.from) * during * during / (2 * ramp) : 0
    return segment.positionMs + (integral + Math.max(0, elapsed - ramp) * segment.to) * 1000
  }
  rateAt(time: number): number | null {
    const segment = this.segment(time)
    if (!segment) return null
    const ramp = segment.end - segment.time
    return ramp > 0 ? segment.from + (segment.to - segment.from) * Math.min(1, (time - segment.time) / ramp) : segment.to
  }
  correction(errorMs: number, uncertaintyMs: number): number {
    if (!Number.isFinite(errorMs) || !Number.isFinite(uncertaintyMs) || uncertaintyMs < 0 || uncertaintyMs > 25 || Math.abs(errorMs) > 80) {
      this.errors = []; return 1
    }
    this.errors.push(errorMs); this.errors = this.errors.slice(-3)
    // A single scheduling/timestamp sample is not persistent phase drift.
    if (this.errors.length < 3 || !this.errors.every(error => error > 15) && !this.errors.every(error => error < -15)) return 1
    const phase = [...this.errors].sort((a, b) => a - b)[1]!
    return 1 - Math.max(-.005, Math.min(.005, phase / 10000))
  }
  resetCorrection() { this.errors = [] }
  apply(param: AudioParam, time: number, target: number) {
    const positionMs = this.positionAt(time), from = this.rateAt(time)
    if (positionMs === null || from === null || !Number.isFinite(target) || target < .995 || target > 1.005) throw new Error('AUDIO_RATE_MAPPING_INVALID')
    const previous = this.segments[this.segments.length - 1]!
    // Limit each one-second feedback step to .05%, with a half-second ramp.
    const to = from + Math.max(-.0005, Math.min(.0005, target - from))
    if (Math.abs(to - previous.to) < .000001) return
    param.cancelScheduledValues(time)
    param.setValueAtTime(from, time)
    param.linearRampToValueAtTime(to, time + .5)
    this.segments.push({ time, positionMs, from, to, end: time + .5 })
    this.segments = this.segments.slice(-64)
  }
}
