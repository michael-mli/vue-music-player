import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { analyseAvObservations } from './party-av-observer.mjs'

test('actual output detector passes PCM edge timing and interrupted-input tests', async () => {
  const {stderr}=await promisify(execFile)('python3',['scripts/party-av-pulse-capture.test.py'],{timeout:10000})
  assert.match(stderr,/Ran 3 tests/);assert.match(stderr,/OK/)
})

test('measurement pairs matching states within one clock domain and reports signed skew', () => {
  const video = [1, 2, 3].map(id => ({ id, phase: 'baseline', on: id % 2 === 0, time: 2000 * id + 100, callbackLagMs: 16 }))
  const audio = [1, 2, 3].map(id => ({ phase: 'baseline', on: id % 2 === 0, time: 2000 * id + (id === 1 ? 120 : 50), analysisWindowMs: 23.2 }))
  const sources = [1, 2, 3].map(id => ({ id, time: 2000 * id }))
  const result = analyseAvObservations({ video, audio, sources }, 'baseline')
  assert.equal(result.count, 3)
  assert.deepEqual(result.pairs.map(item => item.skewMs), [-20, 50, 50])
  assert.deepEqual(result.absoluteSkewMs, { p50: 50, p95: 50, max: 50 })
  assert.deepEqual(result.videoDelayMs, { p50: 100, p95: 100, max: 100 })
  assert.deepEqual(result.audioObservationDelayMs, { p50: 50, p95: 120, max: 120 })
  assert.equal(result.unmatchedAudio, 0); assert.deepEqual(result.unmatchedVideo, [])
})

test('wrong states, missing source markers and unmatched cycles remain visible', () => {
  const video = [{ id: 1, on: false, phase: 'impaired', time: 2100 }, { id: 2, on: true, phase: 'impaired', time: 4100 }]
  const audio = [{ on: true, phase: 'impaired', time: 2100 }, { on: true, phase: 'impaired', time: 4100 }]
  const result = analyseAvObservations({ video, audio, sources: [{ id: 1, time: 2000 }] }, 'impaired')
  assert.equal(result.count, 0)
  assert.deepEqual(result.unmatchedVideo, [1, 2]); assert.equal(result.unmatchedAudio, 2)
  assert.equal(result.absoluteSkewMs.p95, null)
})
