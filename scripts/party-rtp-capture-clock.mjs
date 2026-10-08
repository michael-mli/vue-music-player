// Private timing study. Capture time remains in the reporting worker's clock
// domain. This projection does not grant output authority or schedule playback.
export class RtpCaptureClock {
  #rate
  #anchor = null
  #samples = 0
  #lastObserved = -Infinity
  #lost = false
  #maximumResidual = 0
  #residual = null
  constructor(clockRate) {
    if (![48000, 90000].includes(clockRate)) throw new Error('CAPTURE_CLOCK_RATE')
    this.#rate = clockRate
  }
  #validRtp(value) { return Number.isInteger(value) && value >= 0 && value <= 0xffffffff }
  #delta(value, anchor) { return ((value - anchor + 0x80000000) >>> 0) - 0x80000000 }
  #time(now) {
    if (!Number.isFinite(now) || now < this.#lastObserved) { this.#lost = true; return false }
    this.#lastObserved = now
    return !this.#lost
  }
  observe(rtpTimestamp, captureTime, now) {
    if (!this.#validRtp(rtpTimestamp) || !this.#time(now) || !Number.isFinite(captureTime)) return false
    if (this.#anchor) {
      const delta = this.#delta(rtpTimestamp, this.#anchor.rtpTimestamp)
      const residual = captureTime - (this.#anchor.captureTime + delta / this.#rate * 1000)
      this.#residual = residual
      this.#maximumResidual = Math.max(this.#maximumResidual, Math.abs(residual))
      if (Math.abs(residual) > 80) { this.#lost = true; return false }
      // Late repairs and duplicate headers can be checked but cannot refresh
      // the mapping's age or count as independent clock evidence.
      if (delta <= 0) return false
    }
    this.#anchor = { rtpTimestamp, captureTime, observedAt: now }
    this.#samples++
    return true
  }
  estimate(rtpTimestamp, now) {
    if (!this.#validRtp(rtpTimestamp) || !this.#time(now) || this.#samples < 2 || !this.#anchor ||
      now - this.#anchor.observedAt > 5000) return null
    const deltaMs = this.#delta(rtpTimestamp, this.#anchor.rtpTimestamp) / this.#rate * 1000
    if (Math.abs(deltaMs) > 5000) return null
    return this.#anchor.captureTime + deltaMs
  }
  snapshot(now) {
    const ageMs = this.#anchor ? now - this.#anchor.observedAt : null
    return { status: this.#lost ? 'lost' : this.#samples < 2 ? 'waiting' : ageMs > 5000 ? 'stale' : 'ready',
      anchors: this.#samples, ageMs, maximumResidualMs: this.#maximumResidual, residualMs: this.#residual }
  }
}

export function analyseCaptureClocks(records) {
  const clocks = new Map()
  for (const row of records) {
    if (row.direction !== 'receive' || !['audio', 'video'].includes(row.kind)) continue
    const key = `${row.worker}:${row.kind}`
    let item = clocks.get(key)
    if (!item) { item = { worker: row.worker, kind: row.kind,
      clock: new RtpCaptureClock(row.kind === 'audio' ? 48000 : 90000), observed: 0, captureSamples: 0, time: row.time }; clocks.set(key, item) }
    item.observed++; item.time = row.time
    if (Number.isFinite(row.values.captureTime)) {
      item.captureSamples++
      item.clock.observe(row.rtpTimestamp, row.values.captureTime, row.time)
    }
  }
  return [...clocks.values()].map(item => ({ worker: item.worker, kind: item.kind,
    observed: item.observed, captureSamples: item.captureSamples, ...item.clock.snapshot(item.time) }))
}
