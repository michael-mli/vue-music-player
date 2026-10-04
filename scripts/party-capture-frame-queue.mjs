// A private receiver prototype owns native decoded frames until presentation.
// Missing clocks never become estimated presentation times.
export class CaptureFrameQueue {
  #frames = []
  #bytes = 0
  #lastCapture = -Infinity
  #closed = false
  #received = 0
  #dropped = 0
  #maxFrames
  #maxBytes
  #producer = null
  constructor(maxFrames = 40, maxBytes = 64 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxFrames) || maxFrames < 1 || maxFrames > 40 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) throw new Error('PLAYOUT_QUEUE_CONFIG')
    this.#maxFrames = maxFrames; this.#maxBytes = maxBytes
  }
  push(frame, captureTime) {
    let bytes
    try { bytes = frame.allocationSize() } catch { frame.close(); throw new Error('PLAYOUT_FRAME_SIZE') }
    if (this.#closed || !Number.isFinite(captureTime) || !Number.isSafeInteger(bytes) || bytes <= 0 ||
      frame.codedWidth !== 1280 || frame.codedHeight !== 720 || bytes > 1280 * 720 * 4 || captureTime <= this.#lastCapture) {
      frame.close(); throw new Error('PLAYOUT_FRAME_CLOCK')
    }
    if (this.#frames.length >= this.#maxFrames || this.#bytes + bytes > this.#maxBytes) {
      frame.close(); throw new Error('PLAYOUT_QUEUE_BOUND')
    }
    this.#lastCapture = captureTime; this.#received++; this.#bytes += bytes
    this.#frames.push({ frame, captureTime, bytes })
  }
  take(captureTime) {
    if (this.#closed || !Number.isFinite(captureTime)) return null
    let selected = null
    while (this.#frames[0]?.captureTime <= captureTime) {
      const item = this.#frames.shift(); this.#bytes -= item.bytes
      if (selected) { selected.frame.close(); this.#dropped++ }
      selected = item
    }
    this.#wakeProducer()
    return selected
  }
  waitForSpace(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > this.#maxBytes) throw new Error('PLAYOUT_FRAME_SIZE')
    if (this.#closed) return Promise.resolve(false)
    if (this.#producer) throw new Error('PLAYOUT_QUEUE_PRODUCER')
    if (this.#frames.length < this.#maxFrames && this.#bytes + bytes <= this.#maxBytes) return Promise.resolve(true)
    return new Promise(resolve => { this.#producer = { bytes, resolve } })
  }
  #wakeProducer() {
    const pending = this.#producer
    if (!pending || !this.#closed && (this.#frames.length >= this.#maxFrames || this.#bytes + pending.bytes > this.#maxBytes)) return
    this.#producer = null; pending.resolve(!this.#closed)
  }
  snapshot() { return { queued: this.#frames.length, bytes: this.#bytes, received: this.#received, dropped: this.#dropped } }
  discardPending() {
    for (const item of this.#frames) { item.frame.close(); this.#dropped++ }
    this.#frames.length = 0; this.#bytes = 0
    this.#wakeProducer()
  }
  close() {
    if (this.#closed) return
    this.#closed = true
    for (const item of this.#frames) item.frame.close()
    this.#frames.length = 0; this.#bytes = 0
    this.#wakeProducer()
  }
}
