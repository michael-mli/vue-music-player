import test from 'node:test'
import assert from 'node:assert/strict'
import { installEncodedLeaseObserver } from './party-encoded-lease-observer.mjs'

function fixture(t) {
  const previous = globalThis.window
  globalThis.window = { location: { href: 'https://fixture.test/party', origin: 'https://fixture.test' },
    Worker: class extends EventTarget {
      constructor(...args) { super(); this.args = args }
      postMessage(...args) { this.posted = args }
    } }
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous })
  installEncodedLeaseObserver()
  return { create: (url = '/assets/partyEncodedLease.worker-owned.js') => new window.Worker(url, { type: 'module' }),
    emit: (worker, data) => worker.dispatchEvent(new MessageEvent('message', { data })), events: window.__encodedLeaseEvents }
}
test('worker reasons remain bounded and native handlers and transfers receive original messages', t => {
  const f = fixture(t), worker = f.create(), packet = { type: 'silent', reason: 'expired', identity: 'private', token: 'secret' }
  let delivered
  worker.addEventListener('message', event => { delivered = event.data })
  f.emit(worker, { type: 'ready', identity: 'private' }); f.emit(worker, packet)
  assert.equal(delivered, packet)
  const buffer = new ArrayBuffer(4); worker.postMessage(packet, [buffer])
  assert.deepEqual(worker.posted, [packet, [buffer]])
  assert.deepEqual(f.events.map(({ worker, type, reason }) => ({ worker, type, reason })), [
    { worker: 1, type: 'ready', reason: undefined }, { worker: 1, type: 'silent', reason: 'expired' } ])
  assert.ok(!JSON.stringify(f.events).includes('private'))
  assert.ok(!JSON.stringify(f.events).includes('secret'))
})
test('unrelated workers are ignored and unknown payloads and error descriptions are excluded', t => {
  const f = fixture(t)
  for (const url of ['/assets/other-worker.js', 'https://elsewhere.test/assets/partyEncodedLease.worker-owned.js'])
    f.emit(f.create(url), { type: 'silent', reason: 'expired' })
  assert.deepEqual(f.events, [])
  const worker = f.create()
  f.emit(worker, { type: 'arbitrary', credential: 'secret' })
  f.emit(worker, { type: 'silent', reason: 'secret-grant' })
  worker.dispatchEvent(new Event('error')); worker.dispatchEvent(new Event('messageerror'))
  assert.deepEqual(f.events.map(item => [item.type, item.reason]), [['silent', 'unknown'], ['error', undefined], ['messageerror', undefined]])
  assert.ok(!JSON.stringify(f.events).includes('secret'))
})
test('worker history and worker count stay bounded', t => {
  const f = fixture(t), worker = f.create()
  for (let index = 0; index < 100; index++) f.emit(worker, { type: 'ready' })
  assert.equal(f.events.length, 64)
  for (let index = 0; index < 40; index++) f.emit(f.create(), { type: 'ready' })
  assert.equal(f.events.length, 64)
  assert.equal(f.events.at(-1).worker, 32)
})
