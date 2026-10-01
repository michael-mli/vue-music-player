// Isolated 20-member room/socket/queue load probe. It never contacts the public
// site and reports measurements rather than treating a host-specific latency as
// a universal device support promise.
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import WebSocket from '../server/node_modules/ws/wrapper.mjs'

const child = fork(fileURLToPath(new URL('./party-load-server.mjs', import.meta.url)), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
const pending = new Map()
let nextId = 0
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Load fixture did not start')), 15000)
  child.on('message', message => {
    if (message.type === 'ready') { clearTimeout(timeout); resolve(message.base) }
    else if (pending.has(message.id)) { pending.get(message.id)(message.data); pending.delete(message.id) }
  })
  child.once('error', error => { clearTimeout(timeout); reject(error) })
  child.once('exit', code => { clearTimeout(timeout); reject(new Error(`load fixture exited before ready: ${code}`)) })
})
function measure(roomId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Load fixture measurement timed out')) }, 15000)
    pending.set(id, data => { clearTimeout(timeout); resolve(data) })
    child.send({ type: 'measure', id, roomId })
  })
}
const clients = []
const mb = bytes => Math.round(bytes / 1024 / 1024 * 10) / 10
const percentile = (samples, fraction) => samples[Math.ceil(samples.length * fraction) - 1]
async function poll(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out: ${label}`)
}

try {
  const base = await ready
  async function api(method, route, actor, payload) {
    const response = await fetch(`${base}/api/ktv${route}`, { method,
      headers: { 'Content-Type': 'application/json', 'X-Test-User': String(actor) },
      body: payload === undefined ? undefined : JSON.stringify(payload) })
    const result = await response.json()
    assert.ok(response.ok && result.success, `${route}: ${result.code || response.status}`)
    return result.data
  }
  async function denied(route, actor, payload, code) {
    const response = await fetch(`${base}/api/ktv${route}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-User': String(actor) }, body: JSON.stringify(payload) })
    const result = await response.json()
    assert.equal(response.status, 409); assert.equal(result.code, code)
  }
  const initial = await api('POST', '/rooms', 1, { commandId: randomUUID(), name: 'Twenty member load', displayName: 'Host', approvalRequired: false })
  const roomId = initial.room.id, route = `/rooms/${roomId}`
  for (let actor = 2; actor <= 20; actor++) {
    const joined = await api('POST', '/join', actor, { commandId: randomUUID(), code: initial.invitationCode, displayName: `Guest ${actor}` })
    assert.equal(joined.self.admission, 'admitted')
  }
  const beforeSockets = (await measure(roomId)).memory
  const socketUrl = base.replace('http:', 'ws:') + '/api/ktv/ws'
  async function connect(actor) {
    const { ticket } = await api('POST', `${route}/socket-ticket`, actor, { deviceId: randomUUID() })
    const ws = new WebSocket(socketUrl, { headers: { Origin: base } })
    const client = { ws, snapshots: 0, lastRevision: 0, lastQueueLength: 0, bytes: 0 }
    clients.push(client)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`member ${actor} socket timeout`)), 10000)
      ws.on('message', raw => {
        const message = JSON.parse(raw.toString())
        if (message.type !== 'snapshot') return
        client.snapshots++; client.lastRevision = message.data.room.revision
        client.lastQueueLength = message.data.queue?.length || 0; client.bytes += raw.length
        if (client.snapshots === 1) { clearTimeout(timeout); resolve() }
      })
      ws.once('error', error => { clearTimeout(timeout); reject(error) })
      ws.once('close', code => { if (!client.snapshots) { clearTimeout(timeout); reject(new Error(`member ${actor} socket closed ${code}`)) } })
      ws.once('open', () => ws.send(JSON.stringify({ type: 'authenticate', ticket })))
    })
  }
  for (let actor = 1; actor <= 20; actor++) await connect(actor)
  console.log('PASS 20 admitted members hold distinct live room sockets')
  const withSockets = (await measure(roomId)).memory
  const beforeCounts = clients.map(client => client.snapshots)
  const beforeBytes = clients.map(client => client.bytes)
  const latencies = []
  const views = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
    const actor = index + 1, start = performance.now()
    const view = await api('POST', `${route}/queue`, actor, { commandId: randomUUID(), songId: actor,
      title: `Load song ${actor}`, requestNext: false })
    latencies.push(performance.now() - start)
    return view
  }))
  const revision = Math.max(...views.map(view => view.room.revision))
  await poll(() => clients.every(client => client.lastRevision >= revision && client.lastQueueLength === 20), 'final queue at all 20 sockets')
  const fanout = clients.reduce((sum, client, index) => sum + client.snapshots - beforeCounts[index], 0)
  const view = await api('GET', route, 1)
  assert.equal(view.queue.length, 20)
  const state = await measure(roomId)
  assert.equal(state.queue, 20)
  assert.equal(state.foreignKeyErrors, 0)
  assert.ok(fanout >= 20 && fanout < 400, `expected coalesced delivery to all 20 sockets, got ${fanout}`)
  console.log('PASS 20 concurrent queue commands reach all 20 sockets and persist once')
  latencies.sort((a, b) => a - b)
  const afterQueue = state.memory
  console.log('MEASURE', JSON.stringify({ members: 20, sockets: clients.length, queue: view.queue.length,
    queueCommandMs: { p50: Math.round(percentile(latencies, .5)), p95: Math.round(percentile(latencies, .95)), max: Math.round(latencies.at(-1)) },
    queueBroadcastSnapshots: fanout, queueBroadcastBytes: clients.reduce((sum, client, index) => sum + client.bytes - beforeBytes[index], 0),
    serverMemoryMiB: { beforeSocketsRss: mb(beforeSockets.rss), withSocketsRss: mb(withSockets.rss), afterQueueRss: mb(afterQueue.rss),
      beforeSocketsHeap: mb(beforeSockets.heapUsed), withSocketsHeap: mb(withSockets.heapUsed), afterQueueHeap: mb(afterQueue.heapUsed) } }))
  await denied('/join', 21, { commandId: randomUUID(), code: initial.invitationCode, displayName: 'Over cap' }, 'ROOM_FULL')
  console.log('PASS a twenty-first member is rejected without changing the room')
  for (let round = 0; round < 2; round++) for (let actor = 1; actor <= 20; actor++) await connect(actor)
  const atSocketCap = await measure(roomId)
  const { ticket } = await api('POST', `${route}/socket-ticket`, 1, { deviceId: randomUUID() })
  const overflow = new WebSocket(socketUrl, { headers: { Origin: base } })
  const closeCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { overflow.terminate(); reject(new Error('socket limit was not enforced')) }, 10000)
    overflow.once('open', () => overflow.send(JSON.stringify({ type: 'authenticate', ticket })))
    overflow.once('close', code => { clearTimeout(timeout); resolve(code) })
    overflow.once('error', error => { clearTimeout(timeout); reject(error) })
  })
  assert.equal(closeCode, 4429)
  console.log('PASS 60 sockets stay connected and the next connection is rejected')
  await api('POST', `${route}/settings`, 1, { commandId: randomUUID(), singerRequests: 5 })
  const capCounts = clients.map(client => client.snapshots), capBytes = clients.map(client => client.bytes)
  const capLatencies = []
  for (let round = 1; round <= 4; round++) {
    const added = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
      const actor = index + 1, start = performance.now()
      const next = await api('POST', `${route}/queue`, actor, { commandId: randomUUID(), songId: actor + round * 20,
        title: `Capacity song ${round}/${actor}`, requestNext: false })
      capLatencies.push(performance.now() - start)
      return next
    }))
    const expectedRevision = Math.max(...added.map(next => next.room.revision))
    await poll(() => clients.every(client => client.lastRevision >= expectedRevision && client.lastQueueLength === 20 + round * 20), 'capacity queue reaches every socket', 45000)
  }
  await api('POST', `${route}/settings`, 1, { commandId: randomUUID(), singerRequests: 6 })
  await denied(`${route}/queue`, 1, { commandId: randomUUID(), songId: 999, title: 'Over queue cap', requestNext: false }, 'QUEUE_FULL')
  const atQueueCap = await measure(roomId)
  assert.equal(atQueueCap.members, 20); assert.equal(atQueueCap.queue, 100); assert.equal(atQueueCap.foreignKeyErrors, 0)
  assert.ok(clients.every(client => client.ws.readyState === WebSocket.OPEN && client.lastQueueLength === 100))
  console.log('PASS 100 queued songs persist and reach every socket; the next song is rejected')
  capLatencies.sort((a, b) => a - b)
  console.log('CAPACITY', JSON.stringify({ members: atQueueCap.members, sockets: clients.length, queue: atQueueCap.queue,
    commandSamples: capLatencies.length, burstSize: 20,
    queueCommandMs: { p50: Math.round(percentile(capLatencies, .5)), p95: Math.round(percentile(capLatencies, .95)), max: Math.round(capLatencies.at(-1)) },
    queueBroadcastSnapshots: clients.reduce((sum, client, index) => sum + client.snapshots - capCounts[index], 0),
    queueBroadcastBytes: clients.reduce((sum, client, index) => sum + client.bytes - capBytes[index], 0),
    serverMemoryMiB: { at60SocketsRss: mb(atSocketCap.memory.rss), at60SocketsHeap: mb(atSocketCap.memory.heapUsed),
      at100QueueRss: mb(atQueueCap.memory.rss), at100QueueHeap: mb(atQueueCap.memory.heapUsed) },
    dbAndWalBytes: atQueueCap.dbAndWalBytes, receipts: atQueueCap.receipts, events: atQueueCap.events }))
} finally {
  for (const client of clients) client.ws.terminate()
  if (child.pid && child.exitCode === null) {
    await new Promise(resolve => {
      const timeout = setTimeout(() => { child.kill('SIGKILL') }, 5000)
      child.once('exit', () => { clearTimeout(timeout); resolve() })
      if (child.connected) child.send({ type: 'stop' })
      else child.kill('SIGTERM')
    })
  }
}
