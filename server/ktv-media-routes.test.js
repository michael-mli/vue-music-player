import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import express from 'express'
import { TrackSource, TrackType } from 'livekit-server-sdk'
import { WebSocket, WebSocketServer } from 'ws'
import { initDb } from './db.js'
import { registerKtvRoutes } from './ktv-routes.js'
import { createKtvMediaWorker } from './ktv-media-worker.js'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function wait(work) {
  for (let count = 0; count < 100; count++) { const result = await work(); if (result) return result; await delay(20) }
  throw new Error('Media condition timed out')
}
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ktv-media-http-')), db = initDb(root)
  const now = new Date().toISOString()
  for (const name of ['Host', 'Singer', 'Listener']) db.prepare("INSERT INTO users (username, kind, created_at) VALUES (?, 'guest', ?)").run(name, now)
  const apiKey = 'media-http-tests', apiSecret = 'test-only-media-secret-with-more-than-thirty-two-bytes'
  const controlSecret = 'test-only-control-secret-with-more-than-thirty-two-bytes'
  const app = express(); app.use(express.json())
  const backend = app.listen(0, '127.0.0.1'); await once(backend, 'listening')
  const base = `http://127.0.0.1:${backend.address().port}`, removed = [], sockets = []
  const sfu = http.createServer((req, res) => { res.writeHead(200); res.end('ok') })
  const upstreamSockets = new WebSocketServer({ server: sfu })
  upstreamSockets.on('connection', ws => ws.on('message', (data, binary) => ws.send(data, { binary })))
  sfu.listen(0, '127.0.0.1'); await once(sfu, 'listening')
  let stops = 0, removal = async () => {}, serverClosed = false, tracks = []
  const worker = createKtvMediaWorker({ backendUrl: base, upstreamUrl: `http://127.0.0.1:${sfu.address().port}`,
    apiKey, apiSecret, controlSecret, origins: [base], pollMs: 20, timeoutMs: 1000,
    provider: { async removeParticipant(room, identity) { removed.push({ room, identity }); await removal() },
      async getParticipant(room, identity) { return { identity, tracks } } },
    stopSfu: async () => { stops++; for (const ws of upstreamSockets.clients) ws.terminate() } })
  worker.server.listen(0, '127.0.0.1'); await once(worker.server, 'listening')
  const workerUrl = `http://127.0.0.1:${worker.server.address().port}`
  let nowMs = 10000
  const clock = { id: randomUUID(), nowMs: () => nowMs }
  const realtime = registerKtvRoutes(app, { db, clock, secret: 'test-only-room-secret', isKaraokeSong: () => true,
    authMiddleware(req, res, next) { const id = Number(req.headers['x-test-user']); if (!id) return res.sendStatus(401); req.auth = { sub: id }; next() },
    media: { apiKey, apiSecret, controlSecret, workerUrl } })
  t.after(async () => {
    for (const socket of sockets) socket.terminate()
    await worker.close(); realtime.close()
    if (!serverClosed) await new Promise(resolve => { backend.close(resolve); backend.closeAllConnections() })
    for (const socket of upstreamSockets.clients) socket.terminate()
    upstreamSockets.close(); await new Promise(resolve => { sfu.close(resolve); sfu.closeAllConnections() })
    db.close(); fs.rmSync(root, { recursive: true, force: true })
  })
  async function request(method, route, actor = 1, body) {
    const response = await fetch(base + '/api/ktv' + route, { method,
      headers: { 'Content-Type': 'application/json', ...(typeof actor === 'object' ? { Authorization: `KtvDevice ${actor.credential}` } : { 'X-Test-User': String(actor) }) },
      body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, ...(await response.json()) }
  }
  let view = (await request('POST', '/rooms', 1, { commandId: randomUUID(), name: 'Online test room', displayName: 'Host', approvalRequired: false })).data
  const route = `/rooms/${view.room.id}`
  const views = [view]
  for (let user = 2; user <= 3; user++) views.push((await request('POST', '/join', user, { commandId: randomUUID(), code: view.invitationCode, displayName: `Person ${user}` })).data)
  function device(index, id = randomUUID(), scope = 'controller', grantId = null) {
    const ws = { clientDeviceId: id, roomId: view.room.id, principal: { grantId }, readyState: 1, send() {} }
    const access = { self: views[index].self, deviceScope: scope }
    realtime.playback.connected(ws, access)
    const message = body => realtime.playback.deviceMessage(ws, { protocolVersion: 1, ...body }, access)
    message({ type: 'device.status', purpose: 'viewer', label: 'Media device', audioEnabled: false, clockHealthy: true })
    return { id, ws, message }
  }
  const devices = views.map((_, index) => device(index))
  await worker.reconcile(); assert.equal(worker.ready, true)
  const mode = async (mode, commandId = randomUUID(), actor = 1) => {
    const current = (await request('GET', route)).data
    return request('POST', `${route}/media/mode`, actor, { commandId, mode, baseRevision: current.room.revision })
  }
  async function publish() {
    const entry = (await request('POST', `${route}/queue`, 2, { commandId: randomUUID(), songId: 1, title: 'Song', singerMemberId: views[1].self.id, requestNext: false })).data.queue[0]
    const performanceId = randomUUID()
    db.prepare(`INSERT INTO ktv_readiness (room_id, entry_id, performance_id, generation, clock_id, state, updated_at)
      VALUES (?, ?, ?, 1, ?, 'ready', ?) ON CONFLICT(room_id) DO UPDATE SET entry_id = excluded.entry_id,
      performance_id = excluded.performance_id, clock_id = excluded.clock_id, state = 'ready'`)
      .run(view.room.id, entry.id, performanceId, clock.id, now)
    devices[1].message({ type: 'device.status', purpose: 'stage', label: 'Singer', audioEnabled: true, clockHealthy: true, mediaProtocol: 1 })
    realtime.playback.assign(view.room.id, devices[1].id)
    const assets = { version: 'fixture', durationMs: 60000, instrumental: { durationMs: 60000 }, original: null }
    realtime.playback.prepare(view.room.id, { state: 'ready', entryId: entry.id, performanceId }, assets)
    const generation = realtime.playback.snapshot(view.room.id).generation
    devices[1].message({ type: 'device.ready', clockId: clock.id, performanceId, generation, assetVersion: assets.version, durationMs: assets.durationMs })
    nowMs = 20000
    devices[0].message({ type: 'device.heartbeat' }); devices[1].message({ type: 'device.heartbeat' })
    realtime.playback.start(view.room.id); realtime.playback.sweep()
    return request('POST', `${route}/media-token`, 2, { commandId: randomUUID(), deviceId: devices[1].id, scope: 'publisher' })
  }
  return { db, request, route, views, devices, device, mode, publish, worker, workerUrl, base, realtime, removed,
    controlSecret, get stops() { return stops }, setRemoval(work) { removal = work },
    setTracks(value) { tracks = value }, time(ms) { nowMs = ms; for (const device of devices) device.message({ type: 'device.heartbeat' }) },
    async join(token) { const ws = new WebSocket(workerUrl.replace('http:', 'ws:') + '/api/ktv/media/rtc?access_token=' + encodeURIComponent(token), { origin: base }); sockets.push(ws); ws.on('error', () => {}); await once(ws, 'open'); return ws },
    async stopBackend() { realtime.close(); serverClosed = true; await new Promise(resolve => { backend.close(resolve); backend.closeAllConnections() }) } }
}

test('room media HTTP uses admitted actor/device scope and recovers an issuance reply without a second nonce', async t => {
  const f = await fixture(t)
  assert.equal((await f.mode('online')).status, 200)
  assert.equal((await f.mode('hybrid', randomUUID(), 2)).code, 'FORBIDDEN')
  const commandId = randomUUID(), body = { commandId, deviceId: f.devices[2].id, scope: 'audience', memberId: f.views[2].self.id }
  assert.equal((await f.request('POST', `${f.route}/media-token`, 2, body)).code, 'MEDIA_FORBIDDEN')
  const first = await f.request('POST', `${f.route}/media-token`, 3, body)
  assert.equal(first.status, 200)
  const retry = await f.request('POST', `${f.route}/media-token`, 3, body)
  assert.equal(retry.data.identity, first.data.identity)
  const socket = await f.join(first.data.token), reply = once(socket, 'message'); socket.send(Buffer.from([1, 255]))
  assert.deepEqual((await reply)[0], Buffer.from([1, 255]))
  assert.equal((await f.request('POST', `${f.route}/media/${first.data.identity}/renew`, 2, { deviceId: f.devices[2].id })).code, 'MEDIA_REVOKED')
  assert.equal((await f.request('POST', `${f.route}/media/${first.data.identity}/revoke`, 2, {})).code, 'FORBIDDEN')
  assert.equal((await f.request('POST', `${f.route}/media/${first.data.identity}/revoke`, 3, {})).status, 200)
  assert.equal(f.db.prepare('SELECT state FROM ktv_media_grants WHERE identity = ?').get(first.data.identity).state, 'revoked')
  assert.equal((await f.request('POST', `${f.route}/media/${first.data.identity}/renew`, 3, { deviceId: f.devices[2].id })).status, 403)
})

test('audience output route returns only current authority and denies foreign actor/device/room access', async t => {
  const f = await fixture(t); await f.mode('online')
  const audience = await f.request('POST', `${f.route}/media-token`, 3,
    { commandId: randomUUID(), deviceId: f.devices[2].id, scope: 'audience' })
  const endpoint = `${f.route}/media/${audience.data.identity}/output`
  assert.deepEqual((await f.request('POST', endpoint, 3, { deviceId: f.devices[2].id })).data, { permit: null })
  assert.equal((await f.request('POST', endpoint, 2, { deviceId: f.devices[2].id })).code, 'MEDIA_REVOKED')
  assert.equal((await f.request('POST', endpoint, 3, { deviceId: f.devices[1].id })).code, 'MEDIA_REVOKED')
  assert.equal((await f.request('POST', `/rooms/${randomUUID()}/media/${audience.data.identity}/output`, 3,
    { deviceId: f.devices[2].id })).status, 404)
  const publisher = await f.publish(); assert.equal(publisher.status, 200)
  f.setTracks([{ type: TrackType.AUDIO, source: TrackSource.MICROPHONE, name: 'performance-mix' },
    { type: TrackType.VIDEO, source: TrackSource.SCREEN_SHARE, name: 'performance-lyrics' }])
  const ready = await f.request('POST', `${f.route}/media/${publisher.data.identity}/ready`, 2, { deviceId: f.devices[1].id })
  assert.equal(ready.status, 200)
  const reply = await f.request('POST', endpoint, 3, { deviceId: f.devices[2].id })
  assert.equal(reply.data.permit.publisherIdentity, publisher.data.identity)
  assert.ok(!JSON.stringify(reply.data).includes(publisher.data.token))
  await f.request('POST', `${f.route}/media/${audience.data.identity}/revoke`, 3, {})
  assert.equal((await f.request('POST', endpoint, 3, { deviceId: f.devices[2].id })).status, 403)
})

test('mode changes wait for provider acknowledgment and replay without revoking a later listener', async t => {
  const f = await fixture(t)
  await f.mode('online')
  await f.request('POST', `${f.route}/media-token`, 3, { commandId: randomUUID(), deviceId: f.devices[2].id, scope: 'audience' })
  const before = (await f.request('GET', f.route)).data, body = { commandId: randomUUID(), mode: 'hybrid', baseRevision: before.room.revision }
  const changed = await f.request('POST', `${f.route}/media/mode`, 1, body)
  assert.equal(changed.status, 200); assert.equal(changed.data.room.performanceMode, 'hybrid'); assert.equal(f.removed.length, 1)
  const next = await f.request('POST', `${f.route}/media-token`, 3, { commandId: randomUUID(), deviceId: f.devices[2].id, scope: 'audience' })
  assert.equal(next.status, 200)
  const replay = await f.request('POST', `${f.route}/media/mode`, 1, body)
  assert.equal(replay.status, 200); assert.equal(f.removed.length, 1)
  assert.equal(f.db.prepare('SELECT state FROM ktv_media_grants WHERE identity = ?').get(next.data.identity).state, 'active')
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
})

test('removing a real active publisher invalidates playback and does not free the slot before acknowledgment', async t => {
  const f = await fixture(t); await f.mode('online')
  const publisher = await f.publish()
  assert.equal(publisher.status, 200)
  let release
  f.setRemoval(() => new Promise(resolve => { release = resolve }))
  const revoked = f.request('POST', `${f.route}/media/${publisher.data.identity}/revoke`, 2, {})
  await wait(() => release)
  assert.equal(f.db.prepare('SELECT state FROM ktv_media_grants WHERE identity = ?').get(publisher.data.identity).state, 'revoking')
  assert.equal((await f.request('POST', `${f.route}/media-token`, 2, { commandId: randomUUID(), deviceId: f.devices[1].id, scope: 'publisher' })).code, 'MEDIA_REVOCATION_PENDING')
  release(); assert.equal((await revoked).status, 200)
  assert.equal(f.realtime.playback.snapshot(f.views[0].room.id).state, 'recovering')
  assert.equal(f.realtime.playback.snapshot(f.views[0].room.id).recoveryReason, 'media.disconnected')
})

test('paired read-only displays can receive but cannot revoke their host’s other media or impersonate a device', async t => {
  const f = await fixture(t); await f.mode('hybrid')
  const pairing = (await f.request('POST', `${f.route}/pairings`, 1, { commandId: randomUUID(), scope: 'display' })).data
  const grant = (await f.request('POST', '/pairings/redeem', 1, { commandId: randomUUID(), code: pairing.code })).data
  const display = f.device(0, randomUUID(), 'display', grant.deviceId)
  const first = await f.request('POST', `${f.route}/media-token`, grant, { commandId: randomUUID(), deviceId: display.id, scope: 'audience' })
  assert.equal(first.status, 200)
  const host = await f.request('POST', `${f.route}/media-token`, 1, { commandId: randomUUID(), deviceId: f.devices[0].id, scope: 'audience' })
  assert.equal(host.status, 200)
  assert.equal((await f.request('POST', `${f.route}/media/${first.data.identity}/output`, grant, { deviceId: display.id })).status, 200)
  assert.equal((await f.request('POST', `${f.route}/media/${host.data.identity}/output`, grant, { deviceId: f.devices[0].id })).status, 403)
  assert.equal((await f.request('POST', `${f.route}/media/${host.data.identity}/revoke`, grant, {})).status, 403)
  assert.equal((await f.request('POST', `${f.route}/media-token`, grant, { commandId: randomUUID(), deviceId: f.devices[0].id, scope: 'publisher' })).status, 403)
  assert.equal((await f.request('POST', `${f.route}/media-token`, 1, { commandId: randomUUID(), deviceId: display.id, scope: 'publisher' })).code, 'MEDIA_FORBIDDEN')
})

test('private controls reject unauthenticated access and backend failure latches SFU shutdown', async t => {
  const f = await fixture(t)
  assert.equal((await fetch(f.base + '/internal/ktv/media/reconcile', { method: 'POST' })).status, 403)
  assert.equal((await fetch(f.workerUrl + '/control/health', { method: 'POST' })).status, 403)
  assert.equal(f.worker.ready, true)
  await f.stopBackend(); await wait(() => f.worker.failed)
  assert.equal(f.worker.ready, false); assert.equal(f.stops, 1)
  await f.worker.reconcile(); assert.equal(f.stops, 1)
  const health = await fetch(f.workerUrl + '/control/health', { method: 'POST', headers: { Authorization: `Bearer ${f.controlSecret}` } })
  assert.equal((await health.json()).data.ready, false)
})

test('provider removal failure stops the SFU and keeps the persisted nonce unavailable', async t => {
  const f = await fixture(t); await f.mode('online')
  const listener = await f.request('POST', `${f.route}/media-token`, 3, { commandId: randomUUID(), deviceId: f.devices[2].id, scope: 'audience' })
  f.setRemoval(async () => { throw new Error('Simulated provider outage') })
  const result = await f.request('POST', `${f.route}/media/${listener.data.identity}/revoke`, 3, {})
  assert.equal(result.status, 503); assert.equal(f.worker.ready, false); assert.equal(f.stops, 1)
  assert.equal(f.db.prepare('SELECT state FROM ktv_media_grants WHERE identity = ?').get(listener.data.identity).state, 'revoking')
})

test('online startup requires provider-confirmed mix and lyrics before entering playing', async t => {
  const f = await fixture(t); await f.mode('online')
  const publisher = await f.publish(), path = `${f.route}/media/${publisher.data.identity}/ready`
  assert.equal((await f.request('POST', path, 1, { deviceId: f.devices[1].id })).status, 403)
  f.setTracks([{ type: TrackType.AUDIO, source: TrackSource.MICROPHONE, name: 'performance-mix' }])
  const pending = await f.request('POST', path, 2, { deviceId: f.devices[1].id })
  assert.equal(pending.status, 409); assert.equal(pending.code, 'MEDIA_NOT_READY')
  assert.equal(f.worker.ready, true)
  assert.equal(f.db.prepare('SELECT ready_at FROM ktv_media_grants WHERE identity = ?').get(publisher.data.identity).ready_at, null)
  f.setTracks([{ type: TrackType.AUDIO, source: TrackSource.MICROPHONE, name: 'performance-mix' },
    { type: TrackType.VIDEO, source: TrackSource.CAMERA, name: 'performance-lyrics' }])
  assert.equal((await f.request('POST', path, 2, { deviceId: f.devices[1].id })).status, 409)
  assert.equal(f.db.prepare('SELECT ready_at FROM ktv_media_grants WHERE identity = ?').get(publisher.data.identity).ready_at, null)
  f.setTracks([{ type: TrackType.AUDIO, source: TrackSource.MICROPHONE, name: 'performance-mix' },
    { type: TrackType.VIDEO, source: TrackSource.SCREEN_SHARE, name: 'performance-lyrics' }])
  assert.equal((await f.request('POST', path, 2, { deviceId: f.devices[1].id })).status, 200)
  f.time(26000); f.realtime.playback.sweep()
  assert.equal(f.realtime.playback.snapshot(f.views[0].room.id).state, 'playing')
})

test('a missed online media countdown recovers the room instead of beginning an unready stream', async t => {
  const f = await fixture(t); await f.mode('online'); await f.publish()
  f.time(26000); f.realtime.playback.sweep()
  const playback = f.realtime.playback.snapshot(f.views[0].room.id)
  assert.equal(playback.state, 'recovering'); assert.equal(playback.recoveryReason, 'media.not_ready')
})
