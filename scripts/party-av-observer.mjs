export function installAvSourceMarkers() {
  window.__avSources = []
  const fillText = CanvasRenderingContext2D.prototype.fillText
  CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...rest) {
    const result = fillText.call(this, text, x, y, ...rest)
    const marker = /^AV(?:ON|OFF)(\d+)$/.exec(text)
    if (marker && y === 300 && this.canvas.width === 1280 && this.canvas.height === 720) {
      const id = Number(marker[1])
      if (id > 255) throw new Error('AV_MARKER_ID_LIMIT')
      const bits = [1, 0, 1, 0, ...Array.from({ length: 8 }, (_, index) => id >> (7 - index) & 1)]
      bits.push(bits.slice(4).reduce((value, bit) => value ^ bit, 0))
      this.save()
      for (let index = 0; index < bits.length; index++) {
        this.fillStyle = bits[index] ? '#ffffff' : '#000000'; this.fillRect(64 + index * 32, 360, 32, 32)
      }
      this.restore()
      if (window.__avSources.at(-1)?.id !== id) window.__avSources.push({ id, time: performance.timeOrigin + performance.now() })
    }
    return result
  }
}

// Observe the actual HTML player's presented video. Audio is captured from its
// private browser output server; no audio element/graph is replaced here.
export function installAvObserver() {
  const video = document.querySelector(window.__controlledReceiver ? '[data-party-controlled-video]' : '[data-party-media-screen] video')
  if (!video?.requestVideoFrameCallback) throw new Error('AV_FRAME_CALLBACK_UNAVAILABLE')
  const canvas = document.createElement('canvas'); canvas.width = 416; canvas.height = 32
  const pixels = canvas.getContext('2d', { willReadFrequently: true })
  const evidence = { video: [], invalidFrames: 0, ready: false }
  let phase = null, previousId = null, frameId, stopped = false
  function frame(now, metadata) {
    if (stopped) return
    pixels.drawImage(video, 64 * video.videoWidth / 1280, 360 * video.videoHeight / 720,
      416 * video.videoWidth / 1280, 32 * video.videoHeight / 720, 0, 0, 416, 32)
    const data = pixels.getImageData(0, 0, 416, 32).data
    const bits = Array.from({ length: 13 }, (_, index) => data[(16 * 416 + index * 32 + 16) * 4] > 128 ? 1 : 0)
    const valid = bits.slice(0, 4).join('') === '1010' && bits.slice(4, 12).reduce((sum, bit) => sum ^ bit, 0) === bits[12]
    if (!valid) evidence.invalidFrames++
    else {
      evidence.ready = true
      const id = bits.slice(4, 12).reduce((value, bit) => value * 2 + bit, 0)
      if (previousId !== null && id !== previousId && phase) {
        if (evidence.video.length >= 128) throw new Error('AV_VIDEO_EVIDENCE_LIMIT')
        evidence.video.push({ phase, id, on: id % 2 === 0, time: performance.timeOrigin + metadata.expectedDisplayTime,
          observedAt: performance.timeOrigin + now, callbackLagMs: now - metadata.expectedDisplayTime,
          rtpTimestamp: metadata.rtpTimestamp, mediaTime: metadata.mediaTime,
          ...Object.fromEntries(['captureTime', 'receiveTime', 'presentationTime', 'expectedDisplayTime', 'processingDuration', 'presentedFrames']
            .filter(key => Number.isFinite(metadata[key])).map(key => [key, metadata[key]])) })
      }
      previousId = id
    }
    frameId = video.requestVideoFrameCallback(frame)
  }
  frameId = video.requestVideoFrameCallback(frame)
  window.__avObserver = { evidence, begin(value) { phase = value; return performance.timeOrigin + performance.now() },
    stopRecording() { phase = null; stopped = true; video.cancelVideoFrameCallback(frameId) },
    close() { this.stopRecording() } }
}

// Failure progress carries only aggregate measurements, including incomplete
// matching. Exclude individual marker IDs, clocks, events and unknown fields.
export function summariseAvObservations(result) {
  const quantiles=value=>Object.fromEntries(['p50','p95','max'].map(key=>
    [key,Number.isFinite(value?.[key])?value[key]:null]))
  return {phase:['baseline','impaired','next-singer','venue-to-remote'].includes(result.phase)?result.phase:'unknown',
    count:result.count,unmatchedAudio:result.unmatchedAudio,unmatchedVideo:result.unmatchedVideo.length,
    absoluteSkewMs:quantiles(result.absoluteSkewMs),videoDelayMs:quantiles(result.videoDelayMs),
    audioObservationDelayMs:quantiles(result.audioObservationDelayMs)}
}

export function analyseAvObservations({ audio, video, sources }, phase) {
  const edges = audio.filter(item => item.phase === phase && Number.isFinite(item.time))
  const used = new Set(), pairs = [], unmatchedVideo = []
  for (const frame of video.filter(item => item.phase === phase)) {
    const candidates = edges.map((edge, index) => ({ edge, index })).filter(({ edge, index }) => !used.has(index) && edge.on === frame.on && Math.abs(edge.time - frame.time) < 750)
      .sort((a, b) => Math.abs(a.edge.time - frame.time) - Math.abs(b.edge.time - frame.time))
    // A new singer, seek or hybrid turn can reuse a marker ID. Match its latest
    // preceding capture event, never an old performance or a future redraw.
    const match = candidates[0], source = sources.findLast(item => item.id === frame.id && item.time <= frame.time)
    if (!match || !source) { unmatchedVideo.push(frame.id); continue }
    used.add(match.index)
    pairs.push({ id: frame.id, skewMs: frame.time - match.edge.time, videoDelayMs: frame.time - source.time,
      audioObservationDelayMs: match.edge.time - source.time,
      callbackLagMs: frame.callbackLagMs, audioWindowMs: match.edge.analysisWindowMs,
      captureQueueMs: match.edge.captureQueueMs, captureCallMs: match.edge.captureCallMs, fragmentMs: match.edge.fragmentMs })
  }
  const percentile = (values, fraction) => {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
  }
  return { phase, count: pairs.length, unmatchedVideo, unmatchedAudio: edges.length - used.size, pairs,
    absoluteSkewMs: { p50: percentile(pairs.map(item => Math.abs(item.skewMs)), .5), p95: percentile(pairs.map(item => Math.abs(item.skewMs)), .95), max: percentile(pairs.map(item => Math.abs(item.skewMs)), 1) },
    audioObservationDelayMs: { p50: percentile(pairs.map(item => item.audioObservationDelayMs), .5), p95: percentile(pairs.map(item => item.audioObservationDelayMs), .95), max: percentile(pairs.map(item => item.audioObservationDelayMs), 1) },
    videoDelayMs: { p50: percentile(pairs.map(item => item.videoDelayMs), .5), p95: percentile(pairs.map(item => item.videoDelayMs), .95), max: percentile(pairs.map(item => item.videoDelayMs), 1) } }
}
