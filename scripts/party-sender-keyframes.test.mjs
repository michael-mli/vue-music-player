import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { installSenderKeyframeExperiment } from './party-sender-keyframes.mjs'

function fixture(setParameters = () => Promise.resolve(), manual = false) {
  let tick, cleared = 0, transactions = 0
  const track = { kind: 'video', readyState: 'live' }, calls = []
  const sender = { track, getParameters: () => ({ transactionId: 'native-' + ++transactions,
    degradationPreference: 'maintain-resolution', encodings: [{ maxBitrate: 350000, maxFramerate: 25 }] }),
    setParameters(...args) { calls.push(args); return setParameters(...args) } }
  const window = { __peers: [{ getSenders: () => [sender] }] }
  vm.runInNewContext(`(${installSenderKeyframeExperiment.toString()})(500, ${manual})`, { window, Promise,
    setInterval: work => { tick = work; return 17 }, clearInterval: id => { assert.equal(id, 17); cleared++ } })
  return { sender, track, calls, tick: () => tick(), snapshot: () => window.__avSenderKeyframes.snapshot(),
    close: () => window.__avSenderKeyframes.close(), request: () => window.__avSenderKeyframes.request(),
    timerInstalled: () => typeof tick === 'function', cleared: () => cleared }
}
const settle = () => new Promise(resolve => setImmediate(resolve))
test('demand-driven requests have no timer and obey pending and closed states', async () => {
  let finish
  const f = fixture(() => new Promise(resolve => { finish = resolve }), true)
  assert.equal(f.timerInstalled(), false)
  assert.equal(f.request(), true); assert.equal(f.request(), false)
  finish(); await settle(); assert.equal(f.request(), true)
  finish(); await settle(); f.close(); f.close()
  assert.equal(f.request(), false); assert.equal(f.cleared(), 0)
  assert.equal(f.snapshot().fulfilled, 2)
})
test('native sender requests preserve fresh parameters and serialize pending encoder calls', async () => {
  let finish
  const f = fixture(() => new Promise(resolve => { finish = resolve }))
  f.tick(); f.tick()
  assert.equal(f.calls.length, 1)
  assert.equal(JSON.stringify(f.calls[0][1]), JSON.stringify({ encodingOptions: [{ keyFrame: true }] }))
  assert.equal(f.calls[0][0].transactionId, 'native-1')
  finish(); await settle(); f.tick()
  assert.equal(f.calls[1][0].transactionId, 'native-2')
  assert.equal(f.calls[1][0].encodings[0].maxBitrate, 350000)
  finish(); await settle(); f.close(); f.tick()
  assert.equal(f.calls.length, 2); assert.equal(f.snapshot().fulfilled, 2)
})
test('ended/replaced senders and changed nominal policy stop further requests', async () => {
  for (const change of [
    f => { f.track.readyState = 'ended' },
    f => { f.sender.track = { kind: 'video', readyState: 'live' } },
    f => { f.sender.getParameters = () => ({ encodings: [] }) },
  ]) {
    const f = fixture(); change(f); f.tick(); f.tick()
    assert.equal(f.calls.length, 0); assert.equal(f.cleared(), 1)
    assert.equal(f.snapshot().closed, true)
  }
})
test('rejected requests retain only fixed categories and stop the timer', async () => {
  for (const error of [Object.assign(new Error('private-signaling'), { name: 'OperationError' }), new Error('secret')]) {
    const f = fixture(() => Promise.reject(error)); f.tick(); await settle(); f.tick()
    assert.equal(f.calls.length, 1)
    assert.equal(f.snapshot().closed, true)
    assert.ok(['OperationError', 'request-rejected'].includes(f.snapshot().failure))
    assert.ok(!JSON.stringify(f.snapshot()).includes(error.message))
  }
  const thrown = fixture(() => { throw new Error('secret') }); thrown.tick(); thrown.tick()
  assert.equal(thrown.snapshot().failure, 'request-threw')
})
