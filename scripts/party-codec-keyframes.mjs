import assert from 'node:assert/strict'

export function periodicKeyframeWorker(source, periodMs) {
  assert.ok(Number.isInteger(periodMs) && periodMs >= 250 && periodMs <= 5000, 'Keyframe interval must be 250–5000 ms')
  const needle = 'self.onrtctransform = ({ transformer }) => attach(transformer.readable, transformer.writable, transformer.options.kind)'
  assert.equal(source.split(needle).length, 2, 'Inspect changed production worker before adding a private keyframe policy')
  return source.replace(needle, `self.onrtctransform = ({ transformer }) => {
  attach(transformer.readable, transformer.writable, transformer.options.kind)
  if (transformer.options.kind !== 'video') return
  if (typeof transformer.generateKeyFrame !== 'function') { lease.fail('keyframe-unsupported'); return }
  let pending = false
  setInterval(() => {
    if (pending || !lease.allows()) return
    pending = true
    transformer.generateKeyFrame().catch(() => lease.fail('keyframe')).finally(() => { pending = false })
  }, ${periodMs})
}`)
}
