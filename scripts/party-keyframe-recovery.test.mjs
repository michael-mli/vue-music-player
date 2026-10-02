import test from 'node:test'
import assert from 'node:assert/strict'
import { keyframeRecoveryStep } from './party-keyframe-recovery.mjs'

const sample = (time = 1000, frames = 25, lag = 0, keys = 1) => ({ time,
  audio: { timestamp: time, ssrc: 1, estimatedPlayoutTimestamp: 4000000000000 + time },
  video: { timestamp: time, ssrc: 2, estimatedPlayoutTimestamp: 4000000000000 + time + lag,
    framesDecoded: frames, keyFramesDecoded: keys } })
const step = (row, state) => keyframeRecoveryStep(row.time, row.audio, row.video, state)
test('native delay recovery seeds evidence and requests only bounded lag or stalled decoded frames', () => {
  const first = step(sample())
  assert.equal(first.request, false)
  assert.equal(step(sample(2000, 50, -150), first.state).request, false)
  const delayed = step(sample(2000, 50, -200), first.state)
  assert.equal(delayed.request, true); assert.equal(delayed.reason, 'video-behind')
  const stalled = step(sample(2000, 25), first.state)
  assert.equal(stalled.request, true); assert.equal(stalled.reason, 'frame-stalled')
  assert.equal(step(sample(2000, 50, -2500), first.state).request, false)
})
test('native recovery suppresses recent decoded keyframes and enforces a five-second request interval', () => {
  let state = step(sample()).state
  assert.equal(step(sample(2000, 50, -200, 2), state).request, false)
  state = step(sample(2000, 50, -200), state).state
  for (let time = 3000; time < 7000; time += 1000) {
    const next = step(sample(time, time / 40, -200), state)
    assert.equal(next.request, false); state = next.state
  }
  assert.equal(step(sample(7000, 175, -200), state).request, true)
})
test('missing estimates remain missing and changed paths, reset counters or stale observations fail validation', () => {
  const state = step(sample()).state
  assert.equal(step(sample(2000, 50, -200), { ...state, time: undefined }).valid, false)
  const noEstimate = sample(2000, 50); delete noEstimate.video.estimatedPlayoutTimestamp
  assert.equal(step(noEstimate, state).request, false)
  assert.equal(step({ ...noEstimate, video: { ...noEstimate.video, framesDecoded: 25 } }, state).request, true)
  for (const change of [
    row => { row.video.ssrc = 9 }, row => { row.video.framesDecoded = 1 },
    row => { row.video.keyFramesDecoded = 0 }, row => { row.video.timestamp += 200 },
    row => { delete row.video.framesDecoded }, row => { row.time = 5000 },
  ]) {
    const row = sample(2000, 50, -200); change(row)
    assert.equal(step(row, state).valid, false)
    assert.equal(step(row, state).request, false)
  }
})
