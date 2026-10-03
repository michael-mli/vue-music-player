import test from 'node:test'
import assert from 'node:assert/strict'
import { analyseCodecQuality, analyseCaptureCadence } from './party-av-codec-quality.mjs'

test('periodic keyframes require measured cadence and reject missing, reset or ineffective counters', () => {
  const rows = fixture()
  rows.forEach((row, index) => { row.source.reports[0].keyFramesEncoded = 1 + index * 10 })
  const result = analyseCodecQuality(rows, 'impaired', 'vp9', 500)
  assert.deepEqual(result.errors, [])
  assert.equal(result.keyframesEncoded, 20)
  assert.equal(result.keyframesPerSecond, 2)
  for (const change of [
    items => { delete items[1].source.reports[0].keyFramesEncoded },
    items => { items[2].source.reports[0].keyFramesEncoded = 1 },
    items => items.forEach(row => { row.source.reports[0].keyFramesEncoded = 1 }),
  ]) {
    const invalid = structuredClone(rows); change(invalid)
    assert.ok(analyseCodecQuality(invalid, 'impaired', 'vp9', 500).errors.length)
  }
  assert.ok(analyseCodecQuality(rows, 'impaired', 'vp9', 0).errors.includes('invalid-keyframe-policy'))
})

function fixture() {
  return [0, 5000, 10000].map((time, index) => ({ phase: 'impaired',
    source: { time, reports: [{ type: 'outbound-rtp', kind: 'video', ssrc: 1,
      codec: { mimeType: 'video/VP9' }, frameWidth: 1280, frameHeight: 720, framesEncoded: index * 125 }],
      senderParameters: [{ kind: 'video', contentHint: 'motion', degradationPreference: 'maintain-resolution',
        encodings: [{ maxBitrate: 350000, maxFramerate: 25, scalabilityMode: 'L1T3' }] }] },
    receiver: { time: time + 10, reports: [{ type: 'inbound-rtp', kind: 'video', ssrc: 2,
      codec: { mimeType: 'video/VP9' }, frameWidth: 1280, frameHeight: 720, framesDecoded: index * 110 }] },
  }))
}
test('nominal codec comparison uses measured encode/decode deltas and retains actual SDK hints', () => {
  const result = analyseCodecQuality(fixture(), 'impaired', 'vp9')
  assert.deepEqual(result.errors, [])
  assert.equal(result.sourceFps, 25); assert.equal(result.receiverFps, 22)
  assert.deepEqual(result.contentHints, ['motion']); assert.deepEqual(result.scalabilityModes, ['L1T3'])
})
test('slow, downscaled or fallback decoding cannot pass through requested nominal settings', () => {
  for (const change of [
    rows => rows.forEach((row, index) => { row.source.reports[0].framesEncoded = index * 25 }),
    rows => rows.forEach((row, index) => { row.receiver.reports[0].framesDecoded = index * 30 }),
    rows => { rows[1].receiver.reports[0].frameWidth = 640 },
    rows => { rows[1].source.reports[0].codec.mimeType = 'video/VP8' },
    rows => { rows[1].source.senderParameters[0].encodings[0].maxBitrate = 120000 },
  ]) {
    const rows = fixture(); change(rows)
    assert.ok(analyseCodecQuality(rows, 'impaired', 'vp9').errors.length)
  }
})
test('counter reset, hidden sender replacement, missing counters and short observation remain failed evidence', () => {
  for (const change of [
    rows => { rows[2].source.reports[0].framesEncoded = 1 },
    rows => { rows[2].receiver.reports[0].ssrc = 5 },
    rows => { delete rows[1].receiver.reports[0].framesDecoded },
    rows => rows.forEach((row, index) => { row.source.time = index * 1000 }),
    rows => { rows[1].source.reports.push({ ...rows[1].source.reports[0], ssrc: 3 }) },
  ]) {
    const rows = fixture(); change(rows)
    assert.ok(analyseCodecQuality(rows, 'impaired', 'vp9').errors.length)
  }
})

test('native capture cadence is distinct from encoding and keeps diagnostic output bounded', () => {
  const rows = fixture()
  rows.forEach((row, index) => {
    row.source.reports[0].framesEncoded = index * 65
    row.source.reports.push({ type: 'media-source', kind: 'video', frames: index * 125,
      width: 1280, height: 720, trackIdentifier: 'private-track', secret: 'secret' })
  })
  const result = analyseCaptureCadence(rows, 'impaired')
  assert.deepEqual(result.errors, [])
  assert.equal(result.captureFps, 25); assert.equal(result.encodedFps, 13)
  assert.equal(result.captureFrames, 250); assert.equal(result.encodedFrames, 130)
  assert.equal(/private-track|secret|ssrc/.test(JSON.stringify(result)), false)
  for (const change of [
    items => { items[1].source.reports.pop() },
    items => { items[2].source.reports[1].frames = 1 },
    items => { items[2].source.reports[0].ssrc = 99 },
    items => { items[1].source.reports[1].width = 640 },
    items => { items[1].source.time = items[0].source.time },
    items => { items[1].source.reports.push({ ...items[1].source.reports[1] }) },
  ]) {
    const invalid = structuredClone(rows); change(invalid)
    assert.ok(analyseCaptureCadence(invalid, 'impaired').errors.length)
  }
})

test('declared smaller bitrate caps retain nominal cadence, resolution and the original ceiling', () => {
  const rows = fixture()
  rows.forEach(row => { row.source.senderParameters[0].encodings[0].maxBitrate = 175000 })
  assert.deepEqual(analyseCodecQuality(rows, 'impaired', 'vp9', null, 175000).errors, [])
  assert.ok(analyseCodecQuality(rows, 'impaired', 'vp9').errors.includes('encoding-policy-changed'))
  rows.forEach(row => { row.source.senderParameters[0].encodings[0].maxBitrate = 500000 })
  assert.ok(analyseCodecQuality(rows, 'impaired', 'vp9', null, 500000).errors.includes('invalid-bitrate-cap'))
  rows.forEach((row, index) => {
    row.source.senderParameters[0].encodings[0].maxBitrate = 175000
    row.source.reports[0].framesEncoded = index * 50
  })
  assert.ok(analyseCodecQuality(rows, 'impaired', 'vp9', null, 175000).errors.includes('sourceFps-outside-nominal-range'))
})
