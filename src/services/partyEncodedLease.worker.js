// This gate enforces an already validated permit between the encoder and RTP
// packetizer. It never grants room access. Server-side revocation remains required.
class PartyEncodedLease {
  constructor() {
    this.identity = null
    this.dead = false
    this.sequence = 0
    this.expiry = 0
    this.wall = Date.now()
    this.monotonic = performance.now()
  }
  fail(reason) {
    if (!this.dead) self.postMessage({ type: 'silent', reason })
    this.dead = true
    return false
  }
  check() {
    if (this.dead) return false
    const wall = Date.now(), monotonic = performance.now()
    if (!Number.isFinite(wall) || !Number.isFinite(monotonic) || wall < this.wall || monotonic < this.monotonic ||
      Math.abs((wall - this.wall) - (monotonic - this.monotonic)) > 250) return this.fail('clock')
    this.wall = wall; this.monotonic = monotonic
    if (this.expiry && wall >= this.expiry) return this.fail('expired')
    return true
  }
  message(data) {
    if (!this.check()) return
    if (data?.type === 'stop') { this.fail('stopped'); return }
    if (data?.type === 'init') {
      const identity = data.identity
      if (this.identity || typeof identity?.clockId !== 'string' || !identity.clockId ||
        typeof identity.performanceId !== 'string' || !identity.performanceId ||
        !Number.isSafeInteger(identity.generation) || identity.generation < 1) { this.fail('identity'); return }
      this.identity = { clockId: identity.clockId, performanceId: identity.performanceId, generation: identity.generation }
      self.postMessage({ type: 'ready' })
      return
    }
    if (data?.type !== 'renew' || !this.identity || !Number.isSafeInteger(data.sequence) || data.sequence <= this.sequence ||
      Object.entries(this.identity).some(([key, value]) => data.identity?.[key] !== value) ||
      !Number.isFinite(data.expiry) || data.expiry <= this.wall || data.expiry - this.wall > 10000) {
      this.fail('invalid'); return
    }
    this.sequence = data.sequence
    this.expiry = data.expiry
  }
  allows() { return this.check() && !!this.identity && this.expiry > this.wall }
}
const lease = new PartyEncodedLease()
const attached = new Set()
function attach(readable, writable, kind) {
  if (!['audio', 'video'].includes(kind) || attached.has(kind) || !readable || !writable) { lease.fail('stream'); return }
  attached.add(kind)
  readable.pipeThrough(new TransformStream({ transform(frame, controller) {
    if (lease.allows()) controller.enqueue(frame)
  } })).pipeTo(writable).catch(() => lease.fail('stream'))
}
self.onmessage = ({ data }) => {
  if (data?.type === 'attach') attach(data.readable, data.writable, data.kind)
  else lease.message(data)
}
self.onrtctransform = ({ transformer }) => attach(transformer.readable, transformer.writable, transformer.options.kind)
// Independent of the AudioContext and page task queue. Frame processing also
// checks the deadline so a delayed timer cannot permit a late encoded frame.
setInterval(() => lease.check(), 50)
