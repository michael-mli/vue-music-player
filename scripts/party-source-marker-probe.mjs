// Private read-only diagnostic. Clones only the exact current publisher video;
// no additional publication, camera request, output, grant or media mutation.
export function installSourceMarkerProbe(readYuv, role = 'publisher') {
  if (!['publisher', 'native-receiver'].includes(role)) throw new Error('SOURCE_MARKER_ROLE')
  const key = role === 'publisher' ? '__sourceMarkerProbe' : '__nativeReceiverMarkerProbe'
  const senders = window.__peers.flatMap(peer => role === 'publisher' ? peer.getSenders() : peer.getReceivers())
    .filter(sender => sender.track?.kind === 'video' && sender.track.readyState === 'live')
  if (senders.length !== 1 || typeof MediaStreamTrackProcessor !== 'function' || typeof readYuv !== 'function') throw new Error('SOURCE_MARKER_TRACK')
  const original = senders[0].track
  if (window[key]?.sameSource(original) && !window[key].snapshot().closed) return
  window[key]?.close()
  const clone = original.clone()
  let reader
  try { reader = new MediaStreamTrackProcessor({ track: clone, maxBufferSize: 1 }).readable.getReader() }
  catch { clone.stop(); throw new Error('SOURCE_MARKER_PROCESSOR') }
  let closed = false, error = null, held = null, reads = 0, invalid = 0, transitions = 0, regressions = 0, last = null, maximumCopyBytes = 0
  function close(code = null) {
    if (closed) return
    closed = true; error = code
    held?.close(); held = null; clone.stop()
    void reader.cancel().catch(() => {})
  }
  async function sample(frame) {
    if (['I420', 'NV12'].includes(frame.format)) {
      const rect=frame.visibleRect, bytes=frame.allocationSize({rect:{x:rect.x+64,y:rect.y+360,width:416,height:32}})
      const marker=await readYuv(frame);maximumCopyBytes=Math.max(maximumCopyBytes,bytes);return marker
    }
    const rect = frame.visibleRect
    if (!['RGBA', 'RGBX', 'BGRA', 'BGRX'].includes(frame.format) || !rect || rect.width !== 1280 || rect.height !== 720 ||
      !Number.isSafeInteger(rect.x) || !Number.isSafeInteger(rect.y) || rect.x < 0 || rect.y < 0 ||
      !Number.isSafeInteger(frame.codedWidth) || !Number.isSafeInteger(frame.codedHeight) ||
      rect.x + 1280 > frame.codedWidth || rect.y + 720 > frame.codedHeight) throw new Error('SOURCE_MARKER_FORMAT')
    const region = { rect: { x: rect.x + 64, y: rect.y + 360, width: 416, height: 32 } }, bytes = frame.allocationSize(region)
    if (!Number.isSafeInteger(bytes) || bytes < 53248 || bytes > 65536) throw new Error('SOURCE_MARKER_BOUND')
    maximumCopyBytes = Math.max(maximumCopyBytes, bytes)
    const data = new Uint8Array(bytes), layout = await frame.copyTo(data, region), plane = layout?.[0]
    if (!plane || !Number.isSafeInteger(plane.offset) || plane.offset < 0 || !Number.isSafeInteger(plane.stride) ||
      plane.stride < 1664 || plane.stride > 2048 || plane.offset + 31 * plane.stride + 1663 >= data.length)
      throw new Error('SOURCE_MARKER_LAYOUT')
    const bits = Array.from({ length: 13 }, (_, index) => data[plane.offset + 16 * plane.stride + (index * 32 + 16) * 4] > 128 ? 1 : 0)
    const valid = bits.slice(0, 4).join('') === '1010' && bits.slice(4, 12).reduce((sum, bit) => sum ^ bit, 0) === bits[12]
    return valid ? { valid: true, id: bits.slice(4, 12).reduce((value, bit) => value * 2 + bit, 0) } : { valid: false }
  }
  window[key] = { sameSource: track => track === original, close,
    snapshot: () => ({ closed, error, reads, invalid, transitions, regressions, maximumCopyBytes }) }
  void (async () => {
    try {
      while (!closed) {
        const { value, done } = await reader.read()
        if (done) break
        if (closed) { value.close(); break }
        held = value
        let marker
        try { marker = await sample(value) }
        finally { if (held === value) { held = null; value.close() } }
        if (closed) break
        if (typeof marker?.valid !== 'boolean' || marker.valid && (!Number.isInteger(marker.id) || marker.id < 0 || marker.id > 255)) throw new Error('SOURCE_MARKER_RESULT')
        reads++
        if (!marker.valid) invalid++
        else {
          if (last !== null && marker.id !== last) transitions++
          if (last !== null && marker.id < last) regressions++
          last = marker.id
        }
      }
      close()
    } catch { close('SOURCE_MARKER_READ') }
    finally { reader.releaseLock() }
  })()
}
