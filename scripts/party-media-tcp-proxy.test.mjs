import assert from 'node:assert/strict'
import net from 'node:net'
import { once } from 'node:events'
import { test } from 'node:test'
import { createMediaTcpProxy } from './party-media-tcp-proxy.mjs'

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function fixture(t) {
  const sockets = new Set()
  const server = net.createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket))
    socket.on('data', data => socket.write(data))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const proxy = await createMediaTcpProxy({ listenPort: 0, upstreamPort: server.address().port })
  const client = net.connect({ host: '127.0.0.1', port: proxy.address().port })
  await once(client, 'connect')
  const received = []
  client.on('data', data => received.push(data))
  t.after(async () => {
    client.destroy(); await proxy.close()
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
  })
  async function bytes(length) {
    const deadline = performance.now() + 3000
    while (Buffer.concat(received).length < length && performance.now() < deadline) await sleep(10)
    assert.equal(Buffer.concat(received).length, length, 'all echoed bytes arrive')
    return Buffer.concat(received)
  }
  return { proxy, client, received, bytes }
}

test('TCP delay preserves encrypted byte order in both directions', async t => {
  const { proxy, client, received, bytes } = await fixture(t)
  proxy.profile({ delayMs: 80, jitterMs: 40 })
  const payload = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 251))
  const started = performance.now()
  for (let offset = 0; offset < payload.length; offset += 97) client.write(payload.subarray(offset, offset + 97))
  await sleep(70)
  assert.equal(received.length, 0, 'no round trip arrives before the minimum delay')
  assert.deepEqual(await bytes(payload.length), payload)
  assert.ok(performance.now() - started >= 150, 'delay applies in each direction')
  const circuit = proxy.snapshot().circuits[0]
  assert.equal(circuit.bytesToClient, payload.length)
  assert.equal(circuit.bytesToSfu, payload.length)
  assert.equal(circuit.overflow, false)
})

test('audience circuit stall resumes promptly and leaves another circuit active', async t => {
  const { proxy, client, received, bytes } = await fixture(t)
  const second = net.connect({ host: '127.0.0.1', port: proxy.address().port })
  await once(second, 'connect'); t.after(() => second.destroy())
  const response = once(second, 'data')
  proxy.pause([1], 2000)
  client.write('stalled'); second.write('active')
  assert.equal((await response)[0].toString(), 'active')
  await sleep(80); assert.equal(received.length, 0)
  const resumed = performance.now(); proxy.resume([1])
  assert.equal((await bytes(7)).toString(), 'stalled')
  assert.ok(performance.now() - resumed < 1000, 'resume cancels the old stall timer')
})

test('dropping an owned circuit closes its socket and discards queued delivery', async t => {
  const { proxy, client, received } = await fixture(t)
  proxy.pause([1], 2000); client.write('discard')
  client.on('error', error => assert.equal(error.code, 'ECONNRESET'))
  const closed = new Promise(resolve=>client.once('close',resolve)); proxy.drop([1]); await closed
  await sleep(50)
  assert.equal(received.length, 0)
  assert.equal(proxy.snapshot().circuits[0].alive, false)
})

test('TCP fixture rejects unbounded delays and stalls', async t => {
  const { proxy } = await fixture(t)
  assert.throws(() => proxy.profile({ delayMs: 501, jitterMs: 0 }))
  assert.throws(() => proxy.profile({ delayMs: 10, jitterMs: Infinity }))
  assert.throws(() => proxy.pause([1], 10001))
})
