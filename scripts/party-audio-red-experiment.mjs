// Private comparison only. Keep the Opus target, DTX and all video/source guards.
export function audioRedComparisonSource(source, enabled = true) {
  if (typeof enabled !== 'boolean' || typeof source !== 'string') throw new Error('AUDIO_RED_POLICY')
  const needle = 'audioPreset: { maxBitrate: 64000 }, dtx: false, red: true'
  if (source.split(needle).length !== 2) throw new Error('AUDIO_RED_SOURCE')
  return enabled ? source : source.replace(needle, 'audioPreset: { maxBitrate: 64000 }, dtx: false, red: false')
}

// Actual encoded-frame MIME proves the selected policy; RTP codec stats can
// identify the primary Opus codec even when its payload is RED wrapped.
export function analyseAudioRedEvidence(records, enabled) {
  const result = { enabled, sent: 0, received: 0, errors: [] }
  if (typeof enabled !== 'boolean' || !Array.isArray(records) || records.length > 768) {
    result.errors.push('audio-red-evidence-bound'); return result
  }
  const expected = enabled ? 'audio/red' : 'audio/opus'
  for (const [direction, field] of [['send', 'sent'], ['receive', 'received']]) {
    const rows = records.filter(row => row.kind === 'audio' && row.direction === direction)
    result[field] = rows.length
    if (rows.length < 8 || rows.some(row => row.mimeType?.toLowerCase() !== expected))
      result.errors.push('audio-red-' + direction + '-policy-unverified')
  }
  return result
}
