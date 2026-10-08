import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import { once } from 'node:events'
import { test } from 'node:test'
import { createMediaUdpProxy } from './party-media-udp-proxy.mjs'

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function fixture(t, random = Math.random) {
  const server = dgram.createSocket('udp4')
  server.on('message', (data, remote) => server.send(data, remote.port, remote.address))
  server.bind(0, '127.0.0.1'); await once(server, 'listening')
  const proxy = await createMediaUdpProxy({ listenPort: 0, upstreamPort: server.address().port, random })
  const client = dgram.createSocket('udp4'); client.bind(0, '127.0.0.1'); await once(client, 'listening')
  const received = []; client.on('message', data => received.push(data))
  t.after(async () => { client.close(); await proxy.close(); await new Promise(resolve=>server.close(resolve)) })
  const send = data => client.send(data, proxy.address().port, '127.0.0.1')
  return { proxy, client, received, send }
}

test('UDP delay preserves exact datagram payload and boundaries in both directions', async t => {
  const { proxy, client, received, send } = await fixture(t)
  proxy.profile({ delayMs: 80, jitterMs: 20, lossRate: 0 })
  const payload = Buffer.from(Array.from({ length: 1200 }, (_, index) => index % 251))
  const response = once(client, 'message'), started = performance.now(); send(payload)
  await sleep(70); assert.equal(received.length, 0)
  assert.deepEqual((await response)[0], payload)
  assert.ok(performance.now() - started >= 150)
  assert.equal(proxy.snapshot().circuits[0].bytesToClient, payload.length)
  assert.equal(proxy.snapshot().circuits[0].bytesToSfu, payload.length)
})

test('UDP loss drops actual datagrams instead of delaying their delivery', async t => {
  // Deterministic RNG tests the drop branch; real browser runs use Math.random.
  const { proxy, received, send } = await fixture(t, () => 0)
  proxy.profile({ delayMs: 0, jitterMs: 0, lossRate: 0.2 })
  send(Buffer.from('drop')); await sleep(80)
  assert.equal(received.length, 0)
  assert.equal(proxy.snapshot().circuits[0].droppedToSfu, 1)
  assert.equal(proxy.snapshot().circuits[0].bytesToSfu, 0)
})

test('UDP circuit outage discards media; resume forwards new packets only', async t => {
  const { proxy, client, received, send } = await fixture(t)
  let response = once(client, 'message'); send(Buffer.from('ready')); await response
  proxy.pause([1], 2000); send(Buffer.from('old')); await sleep(80)
  assert.equal(received.length, 1)
  assert.equal(proxy.snapshot().circuits[0].droppedToSfu, 1)
  proxy.resume([1]); response = once(client, 'message'); send(Buffer.from('new'))
  assert.equal((await response)[0].toString(), 'new')
  await sleep(50); assert.equal(received.length, 2)
})

test('UDP fixture rejects unbounded loss, delay and outage values', async t => {
  const { proxy } = await fixture(t)
  assert.throws(() => proxy.profile({ delayMs: 0, jitterMs: 0, lossRate: 0.21 }))
  assert.throws(() => proxy.profile({ delayMs: 0, jitterMs: 101, lossRate: 0 }))
  assert.throws(() => proxy.pause([], 10001))
})
