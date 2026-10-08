// Private capability observation on cloned tracks. No renderer, PCM payload,
// output authority or changes to the original performance tracks.
export async function probeDecodedTracks(stream, peers) {
  const results = []
  for (const kind of ['video', 'audio']) {
    const original = stream.getTracks().find(track => track.kind === kind)
    const result = { kind, status: 'unsupported', records: [], sourceSamples: [] }
    results.push(result)
    if (!original || typeof MediaStreamTrackProcessor !== 'function') continue
    const track = original.clone()
    let reader, timer, timedOut = false
    try {
      let processor
      try { processor = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 }) }
      catch (error) {
        if (error?.name !== 'TypeError' && error?.name !== 'NotSupportedError') throw error
        continue
      }
      reader = processor.readable.getReader()
      const receiver = peers.flatMap(peer => peer.getReceivers()).find(item => item.track === original)
      // Both kinds finish within the fixture's CDP request bound, including a
      // processor whose next frame never arrives.
      timer = setTimeout(() => { timedOut = true; reader.cancel().catch(() => {}) }, 4000)
      while (result.records.length < 8) {
        const { value: frame, done } = await reader.read()
        if (done) break
        try {
          const row = {}
          for (const key of ['timestamp', 'duration', 'codedWidth', 'codedHeight', 'sampleRate', 'numberOfChannels', 'numberOfFrames']) {
            if (Number.isFinite(frame[key])) row[key] = frame[key]
          }
          const metadata = typeof frame.metadata === 'function' ? frame.metadata() : {}
          for (const key of ['rtpTimestamp', 'captureTime', 'receiveTime']) {
            if (Number.isFinite(metadata[key])) row[key] = metadata[key]
          }
          result.records.push(row)
          const sources = receiver?.getSynchronizationSources?.() || []
          result.sourceSamples.push(sources.slice(0, 2).map(source => {
            const value = {}
            for (const key of ['timestamp', 'rtpTimestamp', 'captureTimestamp', 'senderCaptureTimeOffset']) {
              if (Number.isFinite(source[key])) value[key] = source[key]
            }
            return value
          }))
        } finally { frame.close() }
      }
      result.status = result.records.length === 8 ? 'complete' : timedOut ? 'timeout' : 'ended'
    } finally {
      clearTimeout(timer)
      if (reader) { try { await reader.cancel() } finally { reader.releaseLock() } }
      track.stop()
    }
  }
  return results
}
