// Codec experiments must retain nominal quality as well as passing marker skew.
// Average measured native counters across the entire phase; never select its
// fastest window or infer absent counters from the requested capture settings.
export function analyseCodecQuality(samples, phase, expectedCodec, keyframeMs = null, maxBitrate = 350000) {
  const errors = [], rows = samples.filter(item => item.phase === phase)
  const result = { phase, expectedCodec, samples: rows.length, errors }
  if (!Number.isInteger(maxBitrate) || maxBitrate < 64000 || maxBitrate > 350000) errors.push('invalid-bitrate-cap')
  if (rows.length < 2) { errors.push('insufficient-samples'); return result }
  const selected = rows.map(sample => ({ time: sample.source?.time, receiverTime: sample.receiver?.time,
    source: sample.source?.reports?.filter(row => row.type === 'outbound-rtp' && row.kind === 'video') || [],
    receiver: sample.receiver?.reports?.filter(row => row.type === 'inbound-rtp' && row.kind === 'video') || [],
    senders: sample.source?.senderParameters?.filter(row => row.kind === 'video') || [],
  }))
  if (selected.some(row => row.source.length !== 1 || row.receiver.length !== 1 || row.senders.length !== 1)) {
    errors.push('ambiguous-video-path'); return result
  }
  const first = selected[0], last = selected.at(-1)
  const duration = last.time - first.time, receiveDuration = last.receiverTime - first.receiverTime
  if (![duration, receiveDuration].every(value => Number.isFinite(value) && value >= 5000)) errors.push('insufficient-duration')
  const sourceId = first.source[0].ssrc, receiverId = first.receiver[0].ssrc
  if (selected.some(row => !Number.isFinite(row.source[0].ssrc) || !Number.isFinite(row.receiver[0].ssrc) ||
    row.source[0].ssrc !== sourceId || row.receiver[0].ssrc !== receiverId)) errors.push('video-path-changed')
  const mime = 'video/' + expectedCodec
  if (selected.some(row => row.source[0].codec?.mimeType?.toLowerCase() !== mime ||
    row.receiver[0].codec?.mimeType?.toLowerCase() !== mime)) errors.push('codec-mismatch')
  if (selected.some(row => row.source[0].frameWidth !== 1280 || row.source[0].frameHeight !== 720 ||
    row.receiver[0].frameWidth !== 1280 || row.receiver[0].frameHeight !== 720)) errors.push('resolution-changed')
  if (selected.some(row => row.senders[0].degradationPreference !== 'maintain-resolution' ||
    row.senders[0].encodings?.length !== 1 || row.senders[0].encodings[0].maxBitrate !== maxBitrate ||
    row.senders[0].encodings[0].maxFramerate !== 25)) errors.push('encoding-policy-changed')
  for (const [name, key, counter, elapsed] of [['sourceFps', 'source', 'framesEncoded', duration],
    ['receiverFps', 'receiver', 'framesDecoded', receiveDuration]]) {
    const counts = selected.map(row => row[key][0][counter])
    if (!counts.every(Number.isFinite) || counts.some((value, index) => index && value < counts[index - 1])) {
      errors.push('invalid-' + counter); continue
    }
    if (!(elapsed > 0)) continue
    result[name] = (counts.at(-1) - counts[0]) * 1000 / elapsed
    if (result[name] < 20 || result[name] > 30) errors.push(name + '-outside-nominal-range')
  }
  if (Number.isFinite(duration)) result.durationMs = duration
  if (Number.isFinite(receiveDuration)) result.receiverDurationMs = receiveDuration
  if (keyframeMs !== null) {
    const counts = selected.map(row => row.source[0].keyFramesEncoded)
    if (!Number.isInteger(keyframeMs) || keyframeMs < 250 || keyframeMs > 5000) errors.push('invalid-keyframe-policy')
    else if (!counts.every(value => Number.isInteger(value) && value >= 0) ||
      counts.some((value, index) => index && value < counts[index - 1])) errors.push('invalid-keyframe-counter')
    else if (Number.isFinite(duration) && duration > 0) {
      result.keyframeMs = keyframeMs
      result.keyframesEncoded = counts.at(-1) - counts[0]
      result.keyframesPerSecond = result.keyframesEncoded * 1000 / duration
      // Require measured encoding of at least 80% of periodic requests.
      // Successful API promises alone do not prove the recovery cadence.
      if (result.keyframesEncoded < Math.floor(duration / keyframeMs * 0.8)) errors.push('keyframe-cadence-not-established')
    }
  }
  result.contentHints = [...new Set(selected.map(row => row.senders[0].contentHint).filter(value=>typeof value==='string'))]
  result.scalabilityModes = [...new Set(selected.flatMap(row => row.senders[0].encodings?.map(item => item.scalabilityMode) || [])
    .filter(value=>typeof value==='string'))]
  return result
}

// Distinguish actual native capture from encoding. A steady capture source
// cannot establish encoder cadence; requested frame rates are not counters.
export function analyseCaptureCadence(samples, phase) {
  const errors = [], rows = samples.filter(item => item.phase === phase)
  const result = { phase, samples: rows.length, errors }
  if (rows.length < 2) { errors.push('insufficient-samples'); return result }
  const selected = rows.map(sample => ({ time: sample.source?.time,
    capture: sample.source?.reports?.filter(row => row.type === 'media-source' && row.kind === 'video') || [],
    encoded: sample.source?.reports?.filter(row => row.type === 'outbound-rtp' && row.kind === 'video') || [],
  }))
  if (selected.some(row => row.capture.length !== 1 || row.encoded.length !== 1)) {
    errors.push('ambiguous-capture-path'); return result
  }
  const duration = selected.at(-1).time - selected[0].time
  if (selected.some((row, index) => !Number.isFinite(row.time) || index && row.time <= selected[index - 1].time) ||
    !Number.isFinite(duration) || duration < 5000) { errors.push('invalid-observation-clock'); return result }
  if (selected.some(row => !Number.isFinite(row.encoded[0].ssrc) ||
    row.encoded[0].ssrc !== selected[0].encoded[0].ssrc)) errors.push('video-path-changed')
  if (selected.some(row => row.capture[0].width !== 1280 || row.capture[0].height !== 720)) errors.push('capture-resolution-changed')
  result.durationMs = duration
  for (const [name, field, counter] of [['capture', 'capture', 'frames'], ['encoded', 'encoded', 'framesEncoded']]) {
    const counts = selected.map(row => row[field][0][counter])
    if (!counts.every(value => Number.isSafeInteger(value) && value >= 0) ||
      counts.some((value, index) => index && value < counts[index - 1])) {
      errors.push('invalid-' + counter); continue
    }
    result[name + 'Frames'] = counts.at(-1) - counts[0]
    result[name + 'Fps'] = result[name + 'Frames'] * 1000 / duration
  }
  return result
}
