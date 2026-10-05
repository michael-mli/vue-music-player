// Read-only diagnostic for owned fixture markers before presentation. Never
// grants output permission or changes media, timing, ordering or admission.
export async function readDecodedVideoMarker(frame) {
  const rect = frame?.visibleRect
  if (!['I420', 'NV12'].includes(frame?.format) || !rect || rect.width !== 1280 || rect.height !== 720 ||
    !Number.isSafeInteger(rect.x) || !Number.isSafeInteger(rect.y) || rect.x < 0 || rect.y < 0 ||
    !Number.isSafeInteger(frame.codedWidth) || !Number.isSafeInteger(frame.codedHeight) ||
    rect.x + 1280 > frame.codedWidth || rect.y + 720 > frame.codedHeight ||
    typeof frame.copyTo !== 'function' || typeof frame.allocationSize !== 'function') throw new Error('VIDEO_MARKER_INPUT')
  const region = { rect: { x: rect.x + 64, y: rect.y + 360, width: 416, height: 32 } }
  const bytes = frame.allocationSize(region)
  if (!Number.isSafeInteger(bytes) || bytes < 13312 || bytes > 32768) throw new Error('VIDEO_MARKER_BOUND')
  const data = new Uint8Array(bytes), layout = await frame.copyTo(data, region), y = layout?.[0]
  if (!y || !Number.isSafeInteger(y.offset) || y.offset < 0 || !Number.isSafeInteger(y.stride) ||
    y.stride < 416 || y.stride > 1024 || y.offset + 31 * y.stride + 415 >= data.length)
    throw new Error('VIDEO_MARKER_LAYOUT')
  const bits = Array.from({ length: 13 }, (_, index) => data[y.offset + 16 * y.stride + index * 32 + 16] > 128 ? 1 : 0)
  const valid = bits.slice(0, 4).join('') === '1010' && bits.slice(4, 12).reduce((sum, bit) => sum ^ bit, 0) === bits[12]
  return valid ? { valid: true, id: bits.slice(4, 12).reduce((value, bit) => value * 2 + bit, 0) } : { valid: false }
}
