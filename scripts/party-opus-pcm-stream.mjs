// Private streaming decoder. PCM ownership transfers to a bounded renderer;
// this module never connects an output or grants permission to play it.
export function createOpusPcmStream(primaryPayload, packetFrames, deliver, report = () => {}) {
  const pending = [], expected = [], credits = new Map()
  let decoder, configured = false, closed = false, sequence = 0
  let encodedBytes = 0, pcmBytes = 0, anchor = null, lastEnd = null
  let decoded = 0, gaps = 0, duplicates = 0, maximumChunks = 0, maximumBytes = 0
  let lastCaptureUnixMs=null,maximumResidualMs=0
  const delta = (value, previous) => ((value-previous+0x80000000)>>>0)-0x80000000
  function snapshot() { return { closed, configured, decoded, gaps, duplicates, chunks:credits.size,
    encodedBytes, pcmBytes, maximumChunks, maximumBytes,lastCaptureUnixMs,maximumResidualMs } }
  function close(reason = null) {
    if (closed) return
    closed = true; pending.length = 0; expected.length = 0; credits.clear(); encodedBytes = 0; pcmBytes = 0
    try { if (decoder?.state !== 'closed') decoder?.close() } catch {}
    report({ type:'closed', reason, ...snapshot() })
  }
  function output(frame) {
    try {
      if (closed) return
      const packet = expected.shift()
      if (!packet || frame.sampleRate !== 48000 || !Number.isSafeInteger(frame.timestamp) ||
        !Number.isInteger(frame.numberOfChannels) || frame.numberOfChannels < 1 || frame.numberOfChannels > 2 ||
        frame.numberOfFrames !== packet.frames || !Number.isFinite(frame.duration) ||
        Math.abs(frame.duration-packet.frames/48000*1000000)>1) throw new Error('PCM_OUTPUT')
      encodedBytes -= packet.data.byteLength
      const planes = Array.from({length:frame.numberOfChannels}, (_,planeIndex) => {
        const plane = new Float32Array(packet.frames)
        frame.copyTo(plane,{planeIndex,format:'f32-planar'})
        if (plane.some(value=>!Number.isFinite(value))) throw new Error('PCM_OUTPUT')
        return plane
      })
      const bytes = planes.reduce((sum,plane)=>sum+plane.byteLength,0)
      pcmBytes -= packet.reservedBytes-bytes
      credits.set(packet.id,{bytes,delivered:true})
      decoded++
      deliver({id:packet.id,rtpTimestamp:packet.rtpTimestamp,captureUnixMs:packet.captureUnixMs,
        observedCaptureUnixMs:packet.observedCaptureUnixMs,frames:packet.frames,planes})
    } catch { close('PCM_OUTPUT') }
    finally { frame.close() }
  }
  function decode(packet) {
    expected.push(packet)
    decoder.decode(new EncodedAudioChunk({type:'key',timestamp:packet.timestamp,data:packet.data}))
  }
  if (typeof AudioDecoder !== 'function' || typeof EncodedAudioChunk !== 'function') close('PCM_API')
  else void AudioDecoder.isConfigSupported({codec:'opus',sampleRate:48000,numberOfChannels:2}).then(result=>{
    if (closed) return
    if (!result.supported) { close('PCM_CONFIG'); return }
    decoder = new AudioDecoder({output,error:()=>close('PCM_DECODE')})
    decoder.configure(result.config); configured = true
    while (!closed && pending.length) decode(pending.shift())
  }).catch(()=>close('PCM_CONFIG'))
  return {
    observe(frame, metadata) {
      if (closed || !Number.isFinite(metadata?.captureTime)) return
      try {
        const rtp = frame.timestamp, capture = performance.timeOrigin+metadata.captureTime
        if (!Number.isInteger(rtp) || rtp<0 || rtp>0xffffffff || !Number.isFinite(capture)) throw new Error('PCM_CLOCK')
        // Late/duplicate packets cannot move the decoded sample timeline back.
        if (lastEnd !== null && delta(rtp,lastEnd)<0) { duplicates++; return }
        const data = frame.data
        if (!(data instanceof ArrayBuffer) || data.byteLength<1 || data.byteLength>65536) throw new Error('PCM_PACKET')
        const payload = primaryPayload(new Uint8Array(data),metadata.payloadType,self.__encodedTimingCodecs || [])
        const frames = packetFrames(payload.data), reservedBytes = frames*2*4
        if (credits.size>=48 || pcmBytes+reservedBytes>1024*1024 || encodedBytes+payload.data.byteLength>512*1024) throw new Error('PCM_BOUND')
        anchor ??= {rtp,capture}
        const captureUnixMs = anchor.capture+delta(rtp,anchor.rtp)/48
        maximumResidualMs=Math.max(maximumResidualMs,Math.abs(capture-captureUnixMs))
        if (Math.abs(capture-captureUnixMs)>80 || lastEnd!==null && delta(rtp,lastEnd)>240000) throw new Error('PCM_CLOCK')
        if (lastEnd!==null) gaps += delta(rtp,lastEnd)
        lastEnd = (rtp+frames)>>>0
        lastCaptureUnixMs=captureUnixMs
        const packet = {id:++sequence,rtpTimestamp:rtp,frames,reservedBytes,captureUnixMs,
          observedCaptureUnixMs:capture,timestamp:Math.round(metadata.captureTime*1000),data:payload.data.slice()}
        credits.set(packet.id,{bytes:reservedBytes,delivered:false})
        pcmBytes += reservedBytes; encodedBytes += packet.data.byteLength
        maximumChunks = Math.max(maximumChunks,credits.size); maximumBytes = Math.max(maximumBytes,pcmBytes)
        if (configured) decode(packet); else pending.push(packet)
      } catch (error) { close(['PCM_CLOCK','PCM_BOUND','PCM_PACKET'].includes(error.message)?error.message:'PCM_PACKET') }
    },
    consumed({id,bytes}) {
      if (closed) return
      const credit = credits.get(id)
      if (!credit?.delivered || !Number.isSafeInteger(bytes) || credit.bytes!==bytes) { close('PCM_CREDIT'); return }
      credits.delete(id); pcmBytes -= bytes
    }, close, snapshot
  }
}
