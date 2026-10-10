export interface KaraokeGuideState {
  song: { id: number; title: string; url: string } | null
  position: number
  duration: number
  playing: boolean
  rate: number
  sampledAt: number
}

// Map each device's monotonic clock to the server. Wall-clock/timezone differences
// cannot affect sync. Prefer low-latency samples and remove server processing time.
export class KaraokeGuideClock {
  private samples: { offset: number; rtt: number; at: number }[] = []
  add(sent: number, received: number, serverReceived: number, serverSent: number) {
    const rtt = received - sent - (serverSent - serverReceived)
    if (![sent, received, serverReceived, serverSent].every(Number.isFinite) ||
      received < sent || serverSent < serverReceived || rtt < 0 || rtt > 4000) return
    this.samples = this.samples.filter(sample => received - sample.at < 30_000)
    this.samples.push({ offset: ((serverReceived - sent) + (serverSent - received)) / 2, rtt, at: received })
    this.samples = this.samples.slice(-20)
  }
  serverNow(localNow: number) {
    const best = this.samples.reduce<typeof this.samples[number] | null>(
      (best, sample) => !best || sample.rtt < best.rtt ? sample : best, null)
    return localNow + (best?.offset || 0)
  }
}

export function guidePosition(state: KaraokeGuideState, serverNow: number, offsetMs = 0) {
  const elapsed = state.playing ? Math.max(0, serverNow - state.sampledAt) / 1000 * state.rate : 0
  const position = Math.max(0, state.position + elapsed + offsetMs / 1000)
  return state.duration > 0 ? Math.min(position, state.duration) : position
}

// Small drift is corrected gently; seeks, buffering recovery and pauses snap to
// the host's timeline. Positive offset plays the guide ahead (Bluetooth compensation).
export function guideCorrection(position: number, target: number, rate: number, playing: boolean) {
  const drift = target - position
  return { seek: Math.abs(drift) > (playing ? 0.3 : 0.06),
    rate: playing && Math.abs(drift) > 0.04 ? rate * (1 + Math.max(-0.04, Math.min(0.04, drift * 0.12))) : rate }
}
