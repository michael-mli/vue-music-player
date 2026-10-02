// This processor never authorizes playback. The engine supplies an already
// validated, short-lived deadline. Expiry and clock discontinuities latch silence
// on the rendering thread, including the first quantum after context suspension.
class PartyLeaseGuard extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.alive = true
    this.sequence = 0
    this.wall = Date.now()
    this.render = currentTime
    this.expiry = options.processorOptions?.expiry
    if (!Number.isFinite(this.wall) || !Number.isFinite(this.render)) throw new Error('LEASE_CLOCK_UNAVAILABLE')
    if (options.processorOptions?.preflight) {
      this.alive = false
      this.port.postMessage({ type: 'ready' })
      return
    }
    if (!Number.isFinite(this.expiry) || this.expiry - this.wall > 15000) this.fail('invalid')
    else if (this.expiry <= this.wall) this.fail('expired')
    this.port.onmessage = ({ data }) => {
      if (!this.checkClock()) return
      if (data?.type === 'stop') { this.alive = false; return }
      if (data?.type !== 'renew' || !Number.isSafeInteger(data.sequence) || data.sequence <= this.sequence ||
        !Number.isFinite(data.expiry) || data.expiry <= this.wall || data.expiry - this.wall > 15000) {
        this.fail('invalid'); return
      }
      this.sequence = data.sequence
      this.expiry = data.expiry
    }
  }
  fail(reason) {
    if (this.alive) this.port.postMessage({ type: 'silent', reason })
    this.alive = false
    return false
  }
  checkClock() {
    if (!this.alive) return false
    const wall = Date.now(), render = currentTime
    if (!Number.isFinite(wall) || !Number.isFinite(render) || wall < this.wall || render < this.render ||
      Math.abs((wall - this.wall) - (render - this.render) * 1000) > 250) return this.fail('clock')
    this.wall = wall; this.render = render
    if (wall >= this.expiry) return this.fail('expired')
    return true
  }
  process(inputs, outputs) {
    if (!this.checkClock()) return false
    const input = inputs[0] || []
    for (let channel = 0; channel < outputs[0].length; channel++) {
      const samples = input[channel]
      if (samples) outputs[0][channel].set(samples)
    }
    return true
  }
}
registerProcessor('party-lease-guard', PartyLeaseGuard)
