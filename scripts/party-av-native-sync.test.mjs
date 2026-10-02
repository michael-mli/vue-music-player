import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nativeSyncTargetStep, nativeNetworkTargetStep, installNativeSyncExperiment } from './party-av-native-sync.mjs'

const report = (offset = 0, timestamp = 1000) => ({ estimatedPlayoutTimestamp: 3999900000000 + offset, timestamp })
test('native hint experiment compares sender clocks at a common report time and bounds added delay', () => {
  const targets = { audio: 0, video: 0 }
  assert.deepEqual(nativeSyncTargetStep(report(), report(50, 1050), targets), { ...targets, aheadMs: 0 })
  assert.deepEqual(nativeSyncTargetStep(report(), report(300), targets), { audio: 0, video: 100, aheadMs: 300 })
  assert.deepEqual(nativeSyncTargetStep(report(), report(-300), targets), { audio: 100, video: 0, aheadMs: -300 })
  assert.equal(nativeSyncTargetStep(report(), report(900), { audio: 0, video: 480 }).video, 500)
  assert.equal(nativeSyncTargetStep(report(), report(-900), { audio: 480, video: 0 }).audio, 500)
  assert.deepEqual(nativeSyncTargetStep(report(), report(300), { audio: 80, video: 0 }), { audio: 0, video: 100, aheadMs: 300 })
  assert.equal(nativeSyncTargetStep(report(), report(2500), targets), null)
  assert.equal(nativeSyncTargetStep({}, report(), targets), null)
  assert.equal(nativeSyncTargetStep(report(), report(0, 2000), targets), null)
  assert.equal(nativeSyncTargetStep(report(), report(), { audio: -1, video: 0 }), null)
})

test('experiment controls only the actual player receivers and restores their original hints', t => {
  const previous = { window: globalThis.window, document: globalThis.document }
  t.after(() => { globalThis.window = previous.window; globalThis.document = previous.document })
  const audio = { track: { kind: 'audio', id: 'mix' }, jitterBufferTarget: null }
  const video = { track: { kind: 'video', id: 'lyrics' }, jitterBufferTarget: null }
  const unrelated = { track: { kind: 'video', id: 'other' }, jitterBufferTarget: 7 }
  let tracks = [audio.track, video.track]
  globalThis.window = { __peers: [{ getReceivers: () => [unrelated] }, { getReceivers: () => [audio, video] }] }
  globalThis.document = { querySelector: () => ({ srcObject: { getTracks: () => tracks } }) }
  installNativeSyncExperiment(nativeSyncTargetStep)
  const snapshot = { reports: [
    { ...report(), peer: 1, type: 'inbound-rtp', kind: 'audio' },
    { ...report(300), peer: 1, type: 'inbound-rtp', kind: 'video' },
    { ...report(900), peer: 0, type: 'inbound-rtp', kind: 'video' },
  ] }
  assert.deepEqual(window.__avNativeSync.sample(snapshot), { valid: true, audio: 0, video: 100, aheadMs: 300, networkMinimumMs: undefined })
  assert.equal(unrelated.jitterBufferTarget, 7)
  tracks = [audio.track]
  assert.throws(() => window.__avNativeSync.sample(snapshot), /PAIR_CHANGED/)
  window.__avNativeSync.close(); window.__avNativeSync.close()
  assert.equal(audio.jitterBufferTarget, null); assert.equal(video.jitterBufferTarget, null)
  assert.throws(() => window.__avNativeSync.sample(snapshot), /CLOSED/)
})

test('common native network hint uses interval minimum delay without AV-sync feedback and rejects reset counters', () => {
  const previous = { audio: { ssrc: 1, jitterBufferMinimumDelay: 10, jitterBufferEmittedCount: 100 },
    video: { ssrc: 2, jitterBufferMinimumDelay: 1, jitterBufferEmittedCount: 10 } }
  const audio = { ssrc: 1, jitterBufferMinimumDelay: 32, jitterBufferEmittedCount: 200 },
    video = { ssrc: 2, jitterBufferMinimumDelay: 1.7, jitterBufferEmittedCount: 20 }
  const result = nativeNetworkTargetStep(audio, video, {}, previous)
  assert.equal(result.audio, 220);assert.equal(result.video, 220)
  assert.equal(result.networkMinimumMs.audio, 220)
  assert.ok(Math.abs(result.networkMinimumMs.video - 70) < .001)
  assert.equal(nativeNetworkTargetStep({ ...audio, ssrc: 3 }, video, {}, previous), null)
  assert.equal(nativeNetworkTargetStep({ ...audio, jitterBufferEmittedCount: 100 }, video, {}, previous), null)
  assert.equal(nativeNetworkTargetStep({ ...audio, jitterBufferMinimumDelay: 2 }, video, {}, previous), null)
  assert.equal(nativeNetworkTargetStep({}, video, {}, previous), null)
  assert.equal(nativeNetworkTargetStep({ ...audio, jitterBufferMinimumDelay: 400 }, video, {}, previous).audio, 500)
})
