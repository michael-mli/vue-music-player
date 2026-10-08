import test from 'node:test'
import assert from 'node:assert/strict'
import { readDecodedVideoMarker } from './party-decoded-marker-probe.mjs'

function frame(id, { format = 'I420', padded = false, corrupt = false, layout = [{ offset: 0, stride: 416 }] } = {}) {
  const bits = [1, 0, 1, 0, ...Array.from({ length: 8 }, (_, i) => id >> (7 - i) & 1)]
  bits.push(bits.slice(4).reduce((sum, bit) => sum ^ bit, 0))
  if (corrupt) bits[12] ^= 1
  return { format, codedWidth: padded ? 1344 : 1280, codedHeight: 720,
    visibleRect: { x: padded ? 16 : 0, y: 0, width: 1280, height: 720 }, closes: 0,
    close() { this.closes++ }, allocationSize: () => 19968,
    async copyTo(data, options) {
      assert.equal(data.byteLength, 19968)
      assert.deepEqual(options.rect, { x: padded ? 80 : 64, y: 360, width: 416, height: 32 })
      for (let i = 0; i < 13; i++) data[16 * 416 + i * 32 + 16] = bits[i] ? 235 : 16
      return layout
    } }
}
test('decoded YUV diagnostic reads only a bounded region and leaves borrowed frames open', async () => {
  for (const format of ['I420', 'NV12']) for (const padded of [false, true]) for (const id of [0, 1, 127, 255]) {
    const value = frame(id, { format, padded })
    assert.deepEqual(await readDecodedVideoMarker(value), { valid: true, id })
    assert.equal(value.closes, 0)
  }
  assert.deepEqual(await readDecodedVideoMarker(frame(42, { corrupt: true })), { valid: false })
})
test('unsupported frames, oversize regions and invalid copy layouts are explicit diagnostic failures', async () => {
  for (const changed of [null, { ...frame(0), format: 'RGBA' }, { ...frame(0), codedWidth: 100 },
    { ...frame(0), visibleRect: { x: -1, y: 0, width: 1280, height: 720 } }])
    await assert.rejects(readDecodedVideoMarker(changed), /^Error: VIDEO_MARKER_INPUT$/)
  for (const bytes of [13311, 32769, NaN, 19968.5])
    await assert.rejects(readDecodedVideoMarker({ ...frame(0), allocationSize: () => bytes }), /^Error: VIDEO_MARKER_BOUND$/)
  for (const layout of [null, [], [{ offset: -1, stride: 416 }], [{ offset: 0, stride: 415 }],
    [{ offset: 0, stride: 1025 }], [{ offset: 19968, stride: 416 }]])
    await assert.rejects(readDecodedVideoMarker(frame(0, { layout })), /^Error: VIDEO_MARKER_LAYOUT$/)
})
