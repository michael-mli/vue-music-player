import test from 'node:test'
import assert from 'node:assert/strict'
import { RtpCaptureClock, analyseCaptureClocks } from './party-rtp-capture-clock.mjs'

test('two real clock anchors enable audio/video projection across RTP rollover', () => {
  for (const rate of [48000, 90000]) {
    const clock = new RtpCaptureClock(rate), initial = 0xfffff000
    assert.equal(clock.estimate(initial, 0), null)
    assert.equal(clock.observe(initial, -100, 1), true)
    assert.equal(clock.estimate(initial, 2), null)
    assert.equal(clock.observe((initial + rate) >>> 0, 900, 1001), true)
    assert.equal(clock.estimate((initial + rate * 2) >>> 0, 2001), 1900)
    assert.equal(clock.estimate(initial, 2002), -100)
    assert.equal(clock.snapshot(2002).status, 'ready')
  }
})
test('duplicates and late repair headers cannot refresh old capture-clock authority', () => {
  const clock = new RtpCaptureClock(48000)
  clock.observe(0, 0, 0); clock.observe(48000, 1000, 1000)
  assert.equal(clock.observe(48000, 1000, 5900), false)
  assert.equal(clock.observe(0, 0, 6000), false)
  assert.equal(clock.estimate(48000, 6001), null)
  assert.equal(clock.snapshot(6001).anchors, 2)
  assert.equal(clock.snapshot(6001).status, 'stale')
})
test('an inconsistent capture clock or reversed observation time is permanently lost', () => {
  const clock = new RtpCaptureClock(90000)
  clock.observe(0, 0, 0); clock.observe(90000, 1000, 1000)
  assert.equal(clock.observe(180000, 2081, 2000), false)
  assert.equal(clock.estimate(180000, 2001), null)
  assert.equal(clock.observe(270000, 3000, 3000), false)
  assert.equal(clock.snapshot(3000).maximumResidualMs, 81)
  assert.equal(clock.snapshot(3000).status, 'lost')
  const reversed = new RtpCaptureClock(48000)
  reversed.observe(0, 0, 100); reversed.observe(48000, 1000, 1100)
  assert.equal(reversed.estimate(48000, 1099), null)
  assert.equal(reversed.snapshot(1100).status, 'lost')
})
test('missing/non-numeric fields and extrapolation beyond the bound cannot fabricate a capture time', () => {
  assert.throws(() => new RtpCaptureClock(44100), /CAPTURE_CLOCK_RATE/)
  const clock = new RtpCaptureClock(48000)
  for (const capture of [undefined, null, '1', NaN, Infinity]) assert.equal(clock.observe(0, capture, 0), false)
  for (const rtp of [-1, 0x100000000, 1.5, undefined]) assert.equal(clock.observe(rtp, 0, 0), false)
  clock.observe(0, 0, 0); clock.observe(48000, 1000, 1000)
  assert.equal(clock.estimate(48000 + 48000 * 6, 1001), null)
  assert.equal(clock.snapshot(1001).anchors, 2)
})
test('analysis keeps each receiver worker and media clock separate and emits no payload/identity data', () => {
  const rows = []
  for (const worker of [1, 2]) for (const kind of ['audio', 'video']) for (let index = 0; index < 2; index++) {
    rows.push({ worker, kind, direction: 'receive', time: 1000 + index * 1000,
      rtpTimestamp: index * (kind === 'audio' ? 48000 : 90000), values: { captureTime: index * 1000 },
      privateIdentity: 'excluded', data: 'excluded' })
  }
  rows.push({ direction: 'send', worker: 1, kind: 'audio', values: {} })
  const result = analyseCaptureClocks(rows)
  assert.equal(result.length, 4)
  assert.ok(result.every(row => row.status === 'ready' && row.anchors === 2 && row.maximumResidualMs === 0))
  assert.ok(!JSON.stringify(result).includes('excluded'))
})
