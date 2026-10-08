import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import express from 'express'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { initDb } from './db.js'
import { createKtvMetrics, registerKtvHealthRoute } from './ktv-observability.js'
import { createKtvRealtime } from './ktv-realtime.js'

test('metrics retain fixed labels, count completion once and expire the bounded recent window', () => {
  let at = 0
  const metrics = createKtvMetrics({ now: () => at, eventLoop: false })
  for (let index = 0; index < 10000; index++) {
    const res = Object.assign(new EventEmitter(), { statusCode: 503, writableFinished: true })
    metrics.middleware({ method: 'POST', path: `/rooms/secret-${index}/queue?token=private-${index}` }, res, () => {})
    at += 100
    res.emit('finish'); res.emit('close')
  }
  const snapshot = metrics.snapshot()
  assert.equal(snapshot.totals.command.count, 10000)
  assert.equal(snapshot.totals.command.errors, 10000)
  assert.equal(snapshot.inFlight, 0)
  assert.equal(snapshot.totals.command.p95Ms, 100)
  assert.ok(JSON.stringify(snapshot).length < 5000)
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|private|token|queue/)
  assert.ok(snapshot.alerts.includes('command.errors'))
  at += 300001
  assert.equal(metrics.snapshot().recent.command.count, 0)
  assert.equal(metrics.snapshot().totals.command.count, 10000)
  metrics.close()
})

test('latency alerts need enough samples, and aborted HTTP responses cannot masquerade as success', () => {
  let at = 0
  const metrics = createKtvMetrics({ now: () => at, eventLoop: false })
  for (let index = 0; index < 20; index++) {
    const res = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: false })
    metrics.middleware({ method: 'GET', path: '/rooms/example/media/status' }, res, () => {})
    at += 3000; res.emit('close')
    if (index < 19) assert.equal(metrics.snapshot().alerts.length, 0)
  }
  const snapshot = metrics.snapshot()
  assert.equal(snapshot.recent.media.aborted, 20)
  assert.equal(snapshot.recent.media.errors, 0)
  assert.equal(snapshot.recent.media.p95Ms, '>2500')
  assert.ok(snapshot.alerts.includes('media.latency'))
  metrics.close()
})

test('operational health requires admin, uses no-store, and reports media failures without private details', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-health-')), db = initDb(root)
  const app = express(), metrics = createKtvMetrics({ eventLoop: false })
  const realtime = createKtvRealtime({ getSnapshot() { throw new Error('unused') }, clock: { id: 'test', nowMs: () => 0 } })
  const requireAdmin = (req, res, next) => req.headers['x-role'] === 'admin' ? next() : res.sendStatus(403)
  const authMiddleware = (req, res, next) => req.headers['x-role'] ? next() : res.sendStatus(401)
  registerKtvHealthRoute(app, { db, authMiddleware, requireAdmin, metrics, realtime })
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => { realtime.close(); metrics.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections() }); db.close(); await fs.rm(root, { recursive: true, force: true }) })
  const url = `http://127.0.0.1:${server.address().port}/api/admin/ktv-health`
  assert.equal((await fetch(url)).status, 401)
  assert.equal((await fetch(url, { headers: { 'x-role': 'user' } })).status, 403)
  const response = await fetch(url, { headers: { 'x-role': 'admin' } })
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.json()
  assert.deepEqual(body.data.media, { configured: false, ready: false })
  assert.equal(body.data.sockets.connected, 0)
  realtime.media = { health: async () => { throw new Error('private-provider-secret') } }
  const failedMedia = await (await fetch(url, { headers: { 'x-role': 'admin' } })).json()
  assert.deepEqual(failedMedia.data.media, { configured: true, ready: false })
  assert.ok(failedMedia.data.http.alerts.includes('media.unavailable'))
  assert.doesNotMatch(JSON.stringify(failedMedia), /private-provider-secret/)
  realtime.media.health = async () => true
  assert.equal((await (await fetch(url, { headers: { 'x-role': 'admin' } })).json()).data.media.ready, true)
})
