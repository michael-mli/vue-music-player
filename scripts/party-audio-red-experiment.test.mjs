import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { audioRedComparisonSource, analyseAudioRedEvidence } from './party-audio-red-experiment.mjs'

test('RED comparison changes only redundancy and refuses a changed or ambiguous production audio policy', () => {
  const source = readFileSync(new URL('../src/services/partyMediaTransport.ts', import.meta.url), 'utf8')
  assert.equal(audioRedComparisonSource(source), source)
  const compared = audioRedComparisonSource(source, false)
  assert.equal(compared.replace('dtx: false, red: false', 'dtx: false, red: true'), source)
  assert.ok(compared.includes('audioPreset: { maxBitrate: 64000 }, dtx: false, red: false'))
  for (const changed of [source.replace('red: true', 'red: false'), source.replace('maxBitrate: 64000', 'maxBitrate: 32000'), source + source])
    assert.throws(() => audioRedComparisonSource(changed, false), /AUDIO_RED_SOURCE/)
  assert.throws(() => audioRedComparisonSource(source, 'off'), /AUDIO_RED_POLICY/)
})

test('RED evidence requires eight actual selected MIME observations in each direction and excludes private fields', () => {
  const rows = ['send', 'receive'].flatMap(direction => Array.from({ length: 8 }, () => ({
    direction, kind: 'audio', mimeType: 'audio/opus', payload: 'private-payload', track: 'private-track',
  })))
  assert.deepEqual(analyseAudioRedEvidence(rows, false), { enabled: false, sent: 8, received: 8, errors: [] })
  assert.ok(analyseAudioRedEvidence(rows, true).errors.length)
  const red = rows.map(row => ({ ...row, mimeType: 'audio/red' }))
  assert.deepEqual(analyseAudioRedEvidence(red, true).errors, [])
  for (const changed of [rows.slice(1), rows.map((row, index) => index === 3 ? { ...row, mimeType: null } : row),
    rows.map((row, index) => index === 9 ? { ...row, mimeType: 'audio/red' } : row)])
    assert.ok(analyseAudioRedEvidence(changed, false).errors.length)
  assert.equal(/private-|payload|track/.test(JSON.stringify(analyseAudioRedEvidence(rows, false))), false)
  assert.deepEqual(analyseAudioRedEvidence(Array(769).fill(null), false).errors, ['audio-red-evidence-bound'])
})
