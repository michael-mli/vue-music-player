// Private playout primitive. It owns bounded PCM until its explicit render-frame
// deadline; output authority belongs to the existing downstream lease guard.
export class CapturePcmQueue {
  #queue = []
  #bytes = 0
  #closed = false
  #lastId = 0
  #lastEnd = -Infinity
  #maximumBytes = 0
  #maximumQueued = 0
  #onConsumed
  #lastRenderEnd = -Infinity
  constructor(outputRate, onConsumed = () => {}) {
    // Request a 48-kHz receive context and let the browser resample for its
    // device. Never introduce a lower-quality custom music resampler here.
    if (outputRate !== 48000) throw new Error('PLAYOUT_PCM_RATE')
    this.#onConsumed = onConsumed
  }
  push({ id, startFrame, planes }) {
    if (this.#closed || !Number.isSafeInteger(id) || id <= this.#lastId || !Number.isSafeInteger(startFrame) || startFrame < 0 ||
      startFrame < this.#lastEnd || !Array.isArray(planes) || planes.length < 1 || planes.length > 2) throw new Error('PLAYOUT_PCM_CLOCK')
    const frames = planes[0]?.length
    if (!Number.isInteger(frames) || frames < 1 || frames > 5760 || planes.some(plane =>
      !(plane instanceof Float32Array) || plane.length !== frames || plane.byteOffset !== 0 || plane.byteLength !== plane.buffer.byteLength ||
      plane.some(value => !Number.isFinite(value)))) throw new Error('PLAYOUT_PCM_FORMAT')
    const bytes = planes.reduce((sum, plane) => sum + plane.byteLength, 0)
    if (this.#queue.length >= 48 || this.#bytes + bytes > 1024*1024) throw new Error('PLAYOUT_PCM_BOUND')
    const endFrame = startFrame + frames
    if (!Number.isSafeInteger(endFrame)) throw new Error('PLAYOUT_PCM_CLOCK')
    this.#queue.push({ id,startFrame,endFrame,planes,bytes,frames }); this.#bytes += bytes
    this.#lastId = id; this.#lastEnd = endFrame
    this.#maximumBytes = Math.max(this.#maximumBytes,this.#bytes)
    this.#maximumQueued = Math.max(this.#maximumQueued,this.#queue.length)
  }
  render(startFrame, outputs) {
    if (!Number.isSafeInteger(startFrame) || startFrame < 0 || !Array.isArray(outputs) || outputs.length !== 2 ||
      outputs.some(plane=>!(plane instanceof Float32Array) || plane.length !== outputs[0].length)) throw new Error('PLAYOUT_PCM_RENDER')
    outputs.forEach(plane=>plane.fill(0))
    if (this.#closed) return
    if (startFrame < this.#lastRenderEnd) throw new Error('PLAYOUT_PCM_RENDER_CLOCK')
    this.#lastRenderEnd = startFrame+outputs[0].length
    for (let offset=0;offset<outputs[0].length;offset++) {
      const frame = startFrame+offset
      while (this.#queue[0]?.endFrame <= frame) this.#consume()
      const packet = this.#queue[0]
      if (!packet || frame < packet.startFrame) continue
      const index = frame-packet.startFrame
      for (let channel=0;channel<2;channel++) {
        const data = packet.planes[channel] || packet.planes[0]
        outputs[channel][offset] = data[index]
      }
    }
    while (this.#queue[0]?.endFrame <= startFrame+outputs[0].length) this.#consume()
  }
  #consume() {
    const packet = this.#queue.shift(); this.#bytes -= packet.bytes
    this.#onConsumed({ id:packet.id,bytes:packet.bytes })
  }
  snapshot() { return { queued:this.#queue.length,bytes:this.#bytes,maximumBytes:this.#maximumBytes,maximumQueued:this.#maximumQueued,closed:this.#closed } }
  close() { if (this.#closed) return; this.#closed = true; while (this.#queue.length) this.#consume() }
}

export function pcmSourceWorklet(Queue) {
  class Source extends AudioWorkletProcessor {
    constructor() {
      super(); this.alive = true
      this.dataPort = null
      this.queue = new Queue(sampleRate, packet=>(this.dataPort || this.port).postMessage({type:'consumed',...packet}))
      this.receive = ({data}) => {
        if (!this.alive) return
        try {
          if (data?.type === 'stop') { this.alive=false;this.queue.close();this.dataPort?.postMessage({type:'stop'});this.dataPort?.close() }
          else if (data?.type === 'pcm') this.queue.push(data)
          else throw new Error('PLAYOUT_PCM_MESSAGE')
        } catch { this.fail() }
      }
      this.port.onmessage = ({data}) => {
        if (!this.alive) return
        try {
          if (data?.type === 'bind' && !this.dataPort && data.port instanceof MessagePort) {
            this.dataPort=data.port;this.dataPort.onmessage=this.receive;this.dataPort.start()
          } else if (data?.type === 'stop' || !this.dataPort) this.receive({data})
          else throw new Error('PLAYOUT_PCM_MESSAGE')
        } catch { this.fail() }
      }
    }
    fail() { if(this.alive)this.port.postMessage({type:'silent'});this.alive=false;this.queue.close();this.dataPort?.postMessage({type:'stop'});this.dataPort?.close() }
    process(inputs,outputs) {
      try { this.queue.render(currentFrame,outputs[0]); }
      catch { this.fail();for(const output of outputs)for(const plane of output)plane.fill(0) }
      return this.alive
    }
  }
  registerProcessor('party-owned-pcm',Source)
}
