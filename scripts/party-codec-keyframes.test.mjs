import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { periodicKeyframeWorker } from './party-codec-keyframes.mjs'

const source = await fs.readFile('src/services/partyEncodedLease.worker.js', 'utf8')
const identity = { clockId: 'clock', performanceId: 'performance', generation: 4 }
function fixture(kind = 'video', generateKeyFrame) {
  let wall = 1000, monotonic = 50
  const timers = [], messages = [], self = { postMessage: message => messages.push(message) }
  vm.runInNewContext(periodicKeyframeWorker(source, 500), { self, TransformStream,
    Date: { now: () => wall }, performance: { now: () => monotonic },
    setInterval: (work, interval) => { timers.push({ work, interval }) } })
  self.onmessage({ data: { type: 'init', identity } })
  self.onrtctransform({ transformer: { options: { kind }, generateKeyFrame,
    readable: new ReadableStream(), writable: new WritableStream() } })
  return { timers, messages,
    renew: () => self.onmessage({ data: { type: 'renew', identity, sequence: 1, expiry: 5000 } }),
    expire() { wall += 4000; monotonic += 4000 },
    tick: () => timers.find(item => item.interval === 500)?.work() }
}
test('video keyframe requests respect unarmed and expired leases and serialize pending requests', async () => {
  let calls = 0, finish
  const f = fixture('video', () => { calls++; return new Promise(resolve => { finish = resolve }) })
  f.tick(); assert.equal(calls, 0)
  f.renew(); f.tick(); assert.equal(calls, 1)
  f.tick(); assert.equal(calls, 1)
  finish(); await new Promise(resolve => setImmediate(resolve))
  f.tick(); assert.equal(calls, 2)
  finish(); await new Promise(resolve => setImmediate(resolve))
  f.expire(); f.tick(); assert.equal(calls, 2)
  assert.equal(f.messages.at(-1).reason, 'expired')
})
test('audio has no keyframe timer and unsupported or rejected video requests fail closed', async () => {
  const audio = fixture('audio')
  assert.equal(audio.timers.some(item => item.interval === 500), false)
  assert.equal(audio.messages.some(item => item.type === 'silent'), false)
  const unsupported = fixture('video')
  assert.equal(unsupported.messages.at(-1).reason, 'keyframe-unsupported')
  const rejected = fixture('video', () => Promise.reject(new Error('encoder stopped')))
  rejected.renew(); rejected.tick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(rejected.messages.at(-1).reason, 'keyframe')
})
