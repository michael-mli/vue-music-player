// Isolated 20-member room/socket/queue load probe. It never contacts the public
// site and reports measurements rather than treating a host-specific latency as
// a universal device support promise.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import express from '../server/node_modules/express/index.js'
import WebSocket from '../server/node_modules/ws/wrapper.mjs'
import { initDb } from '../server/db.js'
import { registerKtvRoutes } from '../server/ktv-routes.js'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-load-'))
const db = initDb(root)
let realtime, server
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
  const now = new Date().toISOString()
  for (let id = 1; id <= 20; id++) db.prepare("INSERT INTO users (username, kind, created_at) VALUES (?, 'guest', ?)").run(`load-${id}`, now)
  const app = express()
  app.use(express.json())
  const authMiddleware = (req, res, next) => {
    const id = Number(req.headers['x-test-user'])
    if (!Number.isInteger(id) || id < 1 || id > 20) return res.sendStatus(401)
    req.auth = { sub: id }; next()
  }
  realtime = registerKtvRoutes(app, { db, authMiddleware, secret: 'isolated-load-only-secret', isKaraokeSong: id => id > 0 && id <= 20 })
  server = app.listen(0, '127.0.0.1')
  realtime.attach(server)
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  async function api(method, route, actor, payload) {
    const response = await fetch(`${base}/api/ktv${route}`, { method,
      headers: { 'Content-Type': 'application/json', 'X-Test-User': String(actor) },
      body: payload === undefined ? undefined : JSON.stringify(payload) })
    const result = await response.json()
    assert.ok(response.ok && result.success, `${route}: ${result.code || response.status}`)
    return result.data
  }
  const initial = await api('POST', '/rooms', 1, { commandId: randomUUID(), name: 'Twenty member load', displayName: 'Host', approvalRequired: false })
  const roomId = initial.room.id, route = `/rooms/${roomId}`
  for (let actor = 2; actor <= 20; actor++) {
    const joined = await api('POST', '/join', actor, { commandId: randomUUID(), code: initial.invitationCode, displayName: `Guest ${actor}` })
    assert.equal(joined.self.admission, 'admitted')
  }
  const beforeSockets = process.memoryUsage()
  const socketUrl = `ws://127.0.0.1:${server.address().port}/api/ktv/ws`
  for (let actor = 1; actor <= 20; actor++) {
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
  console.log('PASS 20 admitted members hold distinct live room sockets')
  const withSockets = process.memoryUsage()
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
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM ktv_queue_entries WHERE room_id = ?').get(roomId).total, 20)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.ok(fanout >= 20 && fanout < 400, `expected coalesced delivery to all 20 sockets, got ${fanout}`)
  console.log('PASS 20 concurrent queue commands reach all 20 sockets and persist once')
  latencies.sort((a, b) => a - b)
  const afterQueue = process.memoryUsage()
  console.log('MEASURE', JSON.stringify({ members: 20, sockets: clients.length, queue: view.queue.length,
    queueCommandMs: { p50: Math.round(percentile(latencies, .5)), p95: Math.round(percentile(latencies, .95)), max: Math.round(latencies.at(-1)) },
    queueBroadcastSnapshots: fanout, queueBroadcastBytes: clients.reduce((sum, client, index) => sum + client.bytes - beforeBytes[index], 0),
    processMemoryMiB: { beforeSocketsRss: mb(beforeSockets.rss), withSocketsRss: mb(withSockets.rss), afterQueueRss: mb(afterQueue.rss),
      beforeSocketsHeap: mb(beforeSockets.heapUsed), withSocketsHeap: mb(withSockets.heapUsed), afterQueueHeap: mb(afterQueue.heapUsed) } }))
} finally {
  realtime?.close()
  server?.closeAllConnections?.()
  if (server) await new Promise(resolve => server.close(resolve))
  db.close()
  await fs.rm(root, { recursive: true, force: true })
}
