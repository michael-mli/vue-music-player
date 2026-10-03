// Owned receiver capability probe only. Eight packets, no PCM reading/output,
// no authority, and no changes to the original encoded or decoded media path.
export function primaryOpusPayload(bytes, payloadType, codecs) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 65536 ||
    !Number.isInteger(payloadType) || payloadType < 0 || payloadType > 127 || !Array.isArray(codecs)) throw new Error('PAYLOAD_SIZE')
  const codec = codecs.find(item => item.payloadType === payloadType)?.mimeType?.toLowerCase()
  if (codec === 'audio/opus') return { data: bytes, mode: 'opus', redundantBlocks: 0 }
  if (codec !== 'audio/red') throw new Error('PAYLOAD_TYPE')
  let offset = 0, redundantBytes = 0, redundantBlocks = 0
  while (bytes[offset] & 128) {
    if (offset + 4 >= bytes.length || ++redundantBlocks > 3) throw new Error('RED_PACKET')
    const pt = bytes[offset] & 127
    if (codecs.find(item => item.payloadType === pt)?.mimeType?.toLowerCase() !== 'audio/opus') throw new Error('PAYLOAD_TYPE')
    redundantBytes += ((bytes[offset + 2] & 3) << 8) | bytes[offset + 3]
    offset += 4
  }
  const primaryType = bytes[offset] & 127
  if (codecs.find(item => item.payloadType === primaryType)?.mimeType?.toLowerCase() !== 'audio/opus') throw new Error('PAYLOAD_TYPE')
  const start = offset + 1 + redundantBytes
  if (start >= bytes.length) throw new Error('RED_PACKET')
  return { data: bytes.subarray(start), mode: 'red', redundantBlocks }
}

export function opusPacketFrames(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('PAYLOAD_SIZE')
  const config = bytes[0] >> 3, code = bytes[0] & 3
  const durationMs = config < 12 ? [10,20,40,60][config & 3] : config < 16 ? [10,20][config & 1] : [2.5,5,10,20][config & 3]
  const count = code === 0 ? 1 : code < 3 ? 2 : bytes.length > 1 ? bytes[1] & 63 : 0
  if (!count || durationMs * count > 120) throw new Error('PAYLOAD_SIZE')
  return durationMs * count * 48
}

export function createOpusDecodeProbe(primaryPayload, packetFrames) {
  const records = [], pending = [], expected = [], modes = new Set()
  let decoder, configured = false, closed = false, inputCount = 0, maximumPacketBytes = 0
  let timer, maximumTimestampDifferenceUs = 0
  function finish(status, reason = null) {
    if (closed) return
    closed = true; clearTimeout(timer); pending.length = 0
    try { if (decoder?.state !== 'closed') decoder?.close() } catch {}
    self.postMessage({ type: 'encoded-audio-decode', status, reason, inputCount,
      decodedCount: records.length, maximumPacketBytes, maximumTimestampDifferenceUs, packetModes: [...modes], records })
  }
  function output(frame) {
    try {
      if (closed) return
      const packet = expected.shift()
      if (!packet || !Number.isSafeInteger(frame.timestamp) || frame.sampleRate !== 48000 ||
        !Number.isInteger(frame.numberOfChannels) || frame.numberOfChannels < 1 || frame.numberOfChannels > 2 ||
        !Number.isInteger(frame.numberOfFrames) || frame.numberOfFrames < 1 || frame.numberOfFrames > 5760 ||
        frame.numberOfFrames !== packet.frames || !Number.isFinite(frame.duration) || frame.duration <= 0 ||
        Math.abs(frame.duration-frame.numberOfFrames/48000*1000000)>1) throw new Error('OUTPUT')
      maximumTimestampDifferenceUs = Math.max(maximumTimestampDifferenceUs, Math.abs(frame.timestamp-packet.timestamp))
      records.push({ timestamp: frame.timestamp, duration: frame.duration, sampleRate: frame.sampleRate,
        numberOfChannels: frame.numberOfChannels, numberOfFrames: frame.numberOfFrames,
        captureTimestamp: packet.timestamp, rtpTimestamp: packet.rtpTimestamp,
        captureUnixMs: performance.timeOrigin + packet.timestamp / 1000 })
      if (records.length === 8) finish('complete')
    } catch { finish('error', 'OUTPUT') }
    finally { frame.close() }
  }
  function decode(packet) {
    // WebCodecs may produce a continuous PCM timestamp instead of preserving
    // jitter in each packet's capture header. Keep packet capture/RTP metadata
    // separately, and require each output's sample count to match its Opus TOC.
    expected.push({ timestamp: packet.timestamp, rtpTimestamp: packet.rtpTimestamp, frames: packet.frames })
    decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: packet.timestamp, data: packet.data }))
  }
  if (typeof AudioDecoder !== 'function' || typeof EncodedAudioChunk !== 'function') finish('unsupported', 'API')
  else {
    timer = setTimeout(() => finish('timeout', 'TIMEOUT'), 30000)
    void AudioDecoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 }).then(result => {
      if (closed) return
      if (!result.supported) { finish('unsupported', 'CONFIG'); return }
      decoder = new AudioDecoder({ output, error: () => finish('error', 'DECODE') })
      decoder.configure(result.config); configured = true
      while (pending.length) decode(pending.shift())
    }).catch(() => finish('error', 'CONFIG'))
  }
  return { observe(frame, metadata) {
    if (closed || inputCount >= 8 || !Number.isFinite(metadata.captureTime)) return
    try {
      const timestamp = Math.round(metadata.captureTime * 1000)
      if (!Number.isSafeInteger(timestamp) || !Number.isInteger(frame.timestamp) || frame.timestamp < 0 || frame.timestamp > 0xffffffff) throw new Error('TIMESTAMP')
      const data = frame.data
      if (!(data instanceof ArrayBuffer) || data.byteLength < 1 || data.byteLength > 65536) throw new Error('PAYLOAD_SIZE')
      const payload = primaryPayload(new Uint8Array(data), metadata.payloadType, self.__encodedTimingCodecs || [])
      maximumPacketBytes = Math.max(maximumPacketBytes, data.byteLength); modes.add(payload.mode)
      const packet = { timestamp, rtpTimestamp: frame.timestamp, frames: packetFrames(payload.data), data: payload.data.slice() }
      inputCount++
      if (configured) decode(packet)
      else pending.push(packet)
    } catch (error) {
      finish('error', ['PAYLOAD_SIZE','PAYLOAD_TYPE','RED_PACKET','TIMESTAMP'].includes(error.message) ? error.message : 'DECODE')
    }
  } }
}
