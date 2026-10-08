import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import express from 'express'
import WebSocket from 'ws'
import { initDb } from './db.js'
import { registerKtvRoutes } from './ktv-routes.js'
import { ktvPolicy } from './ktv-policy.js'
import { createKtvHttpGuard } from './ktv-http.js'
import { ktvFeatures, ktvFeaturesFromEnv } from './ktv-features.js'
import { createKtvMediaGrants } from './ktv-media-grants.js'

async function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ktv-test-'))
  let db = initDb(dir)
  for (const username of ['host', 'alex1', 'alex2', 'outsider']) {
    db.prepare("INSERT INTO users (username, kind, created_at) VALUES (?, 'guest', ?)")
      .run(username, new Date().toISOString())
  }
  const authMiddleware = (req, res, next) => {
    const id = Number(req.headers['x-test-user'])
    if (!Number.isInteger(id) || !id) return res.sendStatus(401)
    req.auth = { sub: id }
    next()
  }
  let realtime, server, base
  async function start() {
    const app = express()
    app.use(express.json())
    realtime = registerKtvRoutes(app, { db, authMiddleware, secret: 'test-only-secret', isKaraokeSong: (id) => id <= 10, ...options })
    server = app.listen(0, '127.0.0.1')
    realtime.attach(server)
    await new Promise((resolve) => server.once('listening', resolve))
    base = `http://127.0.0.1:${server.address().port}/api/ktv`
  }
  async function stop() {
    realtime.close()
    await new Promise((resolve) => server.close(resolve))
    db.close()
  }
  await start()
  t.after(async () => {
    await stop()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  async function request(method, route, actor, payload, headers = {}) {
    const response = await fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', ...(typeof actor === 'object'
        ? { Authorization: `KtvDevice ${actor.device}` }
        : { 'X-Test-User': String(actor) }), ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    return { status: response.status, body: await response.json(), headers: response.headers }
  }
  return {
    get db() { return db }, request, get realtime() { return realtime },
    get socketUrl() { return `ws://127.0.0.1:${server.address().port}/api/ktv/ws` },
    get origin() { return `http://127.0.0.1:${server.address().port}` },
    async restart() { await stop(); db = initDb(dir); await start() },
  }
}

test('feature flags use strict booleans, preserve defaults and disable dependent features', () => {
  assert.deepEqual(ktvFeaturesFromEnv({}), { rooms: true, guide: true, media: false })
  assert.deepEqual(ktvFeaturesFromEnv({ KTV_ROOMS_ENABLED: 'false', KTV_MEDIA_ENABLED: 'true' }),
    { rooms: false, guide: false, media: false })
  assert.deepEqual(ktvFeaturesFromEnv({ KTV_GUIDE_ENABLED: 'false', KTV_MEDIA_ENABLED: 'true' }),
    { rooms: true, guide: false, media: true })
  assert.ok(Object.isFrozen(ktvFeatures()))
  for (const value of ['TRUE', '1', '', 'flase', false]) {
    assert.throws(() => ktvFeaturesFromEnv({ KTV_ROOMS_ENABLED: value }), /Invalid KTV feature flag/)
  }
  assert.throws(() => ktvFeatures({ guide: 0 }), /Invalid KTV feature flag/)
  assert.throws(() => ktvFeatures({ unknown: true }), /Invalid KTV feature flag/)
})

test('disabled rooms expose only public flags and deny HTTP actions and actual socket upgrades', async t => {
  const f = await setup(t, { features: { rooms: false, media: true }, media: {} })
  const info = await f.request('GET', '/features', 0)
  assert.equal(info.status, 200)
  assert.equal(info.headers.get('cache-control'), 'no-store')
  assert.deepEqual(info.body.data, { rooms: false, guide: false, media: false })
  for (const [method, route] of [['GET', '/rooms'], ['POST', '/rooms'], ['POST', '/join'],
    ['POST', '/pairings/redeem'], ['GET', '/rooms/unknown'], ['POST', '/rooms/unknown/socket-ticket'],
    ['POST', '/rooms/unknown/media-token'], ['POST', '/rooms/unknown/playback/start']]) {
    const denied = await f.request(method, route, 1, method === 'POST' ? {} : undefined)
    assert.equal(denied.status, 503, route)
    assert.equal(denied.body.code, 'KTV_DISABLED', route)
    assert.equal(denied.headers.get('cache-control'), 'no-store')
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) total FROM ktv_rooms').get().total, 0)
  const ws = new WebSocket(f.socketUrl, { origin: f.origin })
  ws.on('error', () => {})
  const status = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('Disabled socket upgrade timeout')) }, 2000)
    ws.once('unexpected-response', (_req, response) => { clearTimeout(timer); response.resume(); ws.terminate(); resolve(response.statusCode) })
    ws.once('open', () => { clearTimeout(timer); ws.terminate(); reject(new Error('Disabled socket upgraded')) })
  })
  assert.equal(status, 503)
  assert.equal(f.realtime.media, undefined)
})

test('disabling media or all rooms persists pending revocation across reenablement', async t => {
  const options = { features: { rooms: true } }, f = await setup(t, options)
  const view = (await f.request('POST', '/rooms', 1, { name: 'Feature rollback', displayName: 'Host' })).body.data
  createKtvMediaGrants({ db: f.db, clock: { id: view.clock.clockId, nowMs: () => 0 },
    apiKey: 'feature-test', apiSecret: 'feature-test-secret'.repeat(3), getPlayback: () => null, getDevices: () => [] })
  const identity = `ktv-media-${randomUUID()}`
  f.db.prepare("UPDATE ktv_rooms SET performance_mode = 'online' WHERE id = ?").run(view.room.id)
  f.db.prepare(`INSERT INTO ktv_media_grants (identity, room_id, member_id, device_id, scope, expires_at, created_at)
    VALUES (?, ?, ?, ?, 'audience', ?, ?)`).run(identity, view.room.id, view.self.id, randomUUID(),
      new Date(Date.now() + 120000).toISOString(), new Date().toISOString())
  options.features = { rooms: false }
  await f.restart()
  assert.equal(f.db.prepare('SELECT state FROM ktv_media_grants WHERE identity = ?').get(identity).state, 'revoking')
  assert.equal(f.db.prepare('SELECT performance_mode FROM ktv_rooms WHERE id = ?').get(view.room.id).performance_mode, 'local')
  assert.equal((await f.request('GET', `/rooms/${view.room.id}`, 1)).body.code, 'KTV_DISABLED')
  const row = f.db.prepare('SELECT revision FROM ktv_rooms WHERE id = ?').get(view.room.id)
  f.realtime.playback.sweep()
  assert.deepEqual(f.db.prepare('SELECT revision FROM ktv_rooms WHERE id = ?').get(view.room.id), row)
  options.features = { rooms: true }
  await f.restart()
  assert.equal(f.db.prepare('SELECT state FROM ktv_media_grants WHERE identity = ?').get(identity).state, 'revoking')
  assert.equal((await f.request('GET', `/rooms/${view.room.id}`, 1)).status, 200)
  assert.equal(f.db.prepare('SELECT status FROM ktv_rooms WHERE id = ?').get(view.room.id).status, 'open')
})

test('guide flag redacts resolved assets and denies singer commands without disabling backing', async t => {
  const assets = { version: 'test-version', instrumental: { url: '/backing' }, original: { url: '/private-guide' },
    alignmentVerified: true, durationDifferenceMs: 10 }
  const f = await setup(t, { features: { guide: false }, resolveAssets: async () => assets })
  const view = (await f.request('POST', '/rooms', 1, { name: 'Backing only', displayName: 'Host' })).body.data
  const route = `/rooms/${view.room.id}`
  assert.deepEqual(view.features, { rooms: true, guide: false, media: false })
  const response = await f.request('GET', `${route}/assets/1`, 1)
  assert.equal(response.status, 200)
  assert.equal(response.body.data.original, null)
  assert.equal(response.body.data.alignmentVerified, false)
  assert.equal(assets.original.url, '/private-guide')
  const denied = await f.request('POST', `${route}/playback/guide`, 1, { commandId: randomUUID(), required: true })
  assert.equal(denied.status, 503)
  assert.equal(denied.body.code, 'GUIDE_DISABLED')
  assert.equal(view.playback.guideRequired, false)
})

test('only the host exposes an invitation on admitted common screens and can hide it again', async t => {
  const { request, db } = await setup(t)
  let view = (await request('POST', '/rooms', 1, { name: 'Stage invitations', displayName: 'Host' })).body.data
  const route = `/rooms/${view.room.id}`, code = view.invitationCode
  const joined = (await request('POST', '/join', 2, { code, displayName: 'Cohost' })).body.data
  const pairing = (await request('POST', `${route}/pairings`, 1, { scope: 'display' })).body.data
  const grant = (await request('POST', '/pairings/redeem', 1, { code: pairing.code })).body.data
  const display = { device: grant.credential }
  assert.equal((await request('GET', route, display)).body.data.stageInvitationCode, undefined)
  await request('POST', `${route}/members/${joined.self.id}/approve`, 1, {})
  await request('POST', `${route}/members/${joined.self.id}/role`, 1, { commandId: randomUUID(), role: 'cohost' })
  assert.equal((await request('POST', `${route}/settings`, 2, { stageInviteVisible: true })).body.code, 'FORBIDDEN')
  assert.equal((await request('POST', `${route}/settings`, display, { stageInviteVisible: true })).body.code, 'DEVICE_REVOKED')
  view = (await request('POST', `${route}/settings`, 1, { stageInviteVisible: true })).body.data
  assert.equal(view.room.stageInviteVisible, true)
  const publicStage = (await request('GET', route, display)).body.data
  assert.equal(publicStage.invitationCode, undefined)
  assert.equal(publicStage.stageInvitationCode, code)
  assert.deepEqual(publicStage.limits, { members: 20, queue: 100, singerRequests: 3 })
  await request('POST', `${route}/settings`, 2, { locked: true })
  assert.equal((await request('GET', route, display)).body.data.stageInvitationCode, undefined)
  await request('POST', `${route}/settings`, 2, { locked: false })
  assert.equal((await request('GET', route, display)).body.data.stageInvitationCode, code)
  const pending = (await request('POST', '/join', 3, { code, displayName: 'Waiting' })).body.data
  assert.equal(pending.stageInvitationCode, undefined)
  assert.equal(pending.limits, undefined)
  view = (await request('POST', `${route}/invitations/rotate`, 1, {})).body.data
  assert.notEqual(view.stageInvitationCode, code)
  assert.equal((await request('GET', route, display)).body.data.stageInvitationCode, view.stageInvitationCode)
  assert.equal(db.prepare('SELECT stage_invite_visible FROM ktv_rooms WHERE id = ?').get(view.room.id).stage_invite_visible, 1)
  await request('POST', `${route}/settings`, 1, { stageInviteVisible: false })
  assert.equal((await request('GET', route, display)).body.data.stageInvitationCode, undefined)
})

function nextSnapshot(ws, accepts = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('snapshot timeout')) }, 3000)
    function cleanup() { clearTimeout(timeout); ws.off('message', onMessage); ws.off('close', onClose) }
    function onMessage(raw) {
      const message = JSON.parse(raw.toString())
      if (message.type !== 'snapshot' || !accepts(message.data)) return
      cleanup()
      resolve(message.data)
    }
    function onClose(code) { cleanup(); reject(new Error(`socket closed ${code}`)) }
    ws.on('message', onMessage)
    ws.on('close', onClose)
  })
}

test('room expiry atomically ends playback, revokes codes/devices, and closes connected sockets', async t => {
  const { request, db, realtime, socketUrl, origin } = await setup(t)
  const view = (await request('POST', '/rooms', 1, { name: 'Expiry', displayName: 'Host', approvalRequired: false })).body.data
  const route = `/rooms/${view.room.id}`
  const entry = (await request('POST', `${route}/queue`, 1, { commandId: randomUUID(), songId: 1, title: 'Expiry song', requestNext: false, singerMemberId: view.self.id })).body.data.queue[0]
  db.prepare(`INSERT INTO ktv_playback (room_id, entry_id, performance_id, generation, clock_id, state, updated_at)
    VALUES (?, ?, ?, 1, ?, 'preparing', ?)`).run(view.room.id, entry.id, randomUUID(), view.clock.clockId, new Date().toISOString())
  const pairing = (await request('POST', `${route}/pairings`, 1, { scope: 'display' })).body.data
  const grant = (await request('POST', '/pairings/redeem', 1, { code: pairing.code })).body.data
  const ticket = (await request('POST', `${route}/socket-ticket`, 1, {})).body.data.ticket
  const connected = await openSocket(socketUrl, origin, ticket); await connected.first
  const ended = new Promise(resolve => connected.ws.once('close', resolve))
  db.prepare('UPDATE ktv_rooms SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), view.room.id)
  realtime.lifecycle.sweep()
  assert.equal(await ended, 4410)
  assert.equal(db.prepare('SELECT status FROM ktv_rooms WHERE id = ?').get(view.room.id).status, 'closed')
  assert.equal(db.prepare('SELECT state FROM ktv_playback WHERE room_id = ?').get(view.room.id).state, 'idle')
  assert.ok(db.prepare('SELECT revoked_at FROM ktv_device_grants WHERE id = ?').get(grant.deviceId).revoked_at)
  assert.equal((await request('GET', route, 1)).body.code, 'ROOM_CLOSED')
  assert.equal((await request('GET', route, { device: grant.credential })).body.code, 'DEVICE_REVOKED')
  assert.equal((await request('POST', '/join', 2, { code: view.invitationCode, displayName: 'Late' })).body.code, 'INVALID_INVITATION')
  realtime.lifecycle.sweep()
  assert.equal(db.prepare("SELECT COUNT(*) total FROM ktv_room_events WHERE action = 'room.expired'").get().total, 1)
})

test('empty-room time persists across restart and an admitted connection resets the timeout', async t => {
  const fixture = await setup(t), { request } = fixture
  const view = (await request('POST', '/rooms', 1, { name: 'Empty room', displayName: 'Host' })).body.data
  const route = `/rooms/${view.room.id}`, empty = new Date(Date.now() - 29 * 60_000).toISOString()
  fixture.db.prepare('UPDATE ktv_rooms SET empty_since_at = ? WHERE id = ?').run(empty, view.room.id)
  await fixture.restart()
  assert.equal(fixture.db.prepare('SELECT empty_since_at FROM ktv_rooms WHERE id = ?').get(view.room.id).empty_since_at, empty)
  const ticket = (await request('POST', `${route}/socket-ticket`, 1, {})).body.data.ticket
  const connected = await openSocket(fixture.socketUrl, fixture.origin, ticket); await connected.first
  fixture.realtime.lifecycle.sweep()
  assert.equal(fixture.db.prepare('SELECT empty_since_at FROM ktv_rooms WHERE id = ?').get(view.room.id).empty_since_at, null)
  const disconnected = new Promise(resolve => connected.ws.once('close', resolve)); connected.ws.close(); await disconnected
  await new Promise(resolve => setTimeout(resolve, 20))
  fixture.realtime.lifecycle.sweep()
  assert.ok(fixture.db.prepare('SELECT empty_since_at FROM ktv_rooms WHERE id = ?').get(view.room.id).empty_since_at)
  fixture.db.prepare('UPDATE ktv_rooms SET empty_since_at = ? WHERE id = ?').run(new Date(Date.now() - 31 * 60_000).toISOString(), view.room.id)
  await fixture.restart()
  assert.equal((await request('GET', route, 1)).body.code, 'ROOM_CLOSED')
  assert.equal(fixture.db.prepare("SELECT COUNT(*) total FROM ktv_room_events WHERE action = 'room.empty_expired'").get().total, 1)
})

test('retention bounds audit history, keeps fresh retry receipts, and purges closed rooms with valid foreign keys', async t => {
  const { request, db, realtime } = await setup(t, { policy: { eventsPerRoom: 10 } })
  const view = (await request('POST', '/rooms', 1, { name: 'Retained', displayName: 'Host' })).body.data
  const route = `/rooms/${view.room.id}`
  await request('POST', `${route}/queue`, 1, { commandId: randomUUID(), songId: 1, title: 'Kept song', requestNext: false, singerMemberId: view.self.id })
  const oldReceipt = randomUUID()
  db.prepare('INSERT INTO ktv_identity_receipts (user_id, command_id, payload_hash, room_id, created_at) VALUES (1, ?, ?, ?, ?)')
    .run(oldReceipt, 'old', view.room.id, new Date(Date.now() - 25 * 60 * 60_000).toISOString())
  for (let index = 0; index < 15; index++) db.prepare('INSERT INTO ktv_room_events (room_id, action, subject_id, created_at) VALUES (?, ?, ?, ?)')
    .run(view.room.id, 'retention.test', String(index), new Date().toISOString())
  realtime.lifecycle.sweep()
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_room_events WHERE room_id = ?').get(view.room.id).total, 10)
  assert.equal(db.prepare('SELECT 1 FROM ktv_identity_receipts WHERE command_id = ?').get(oldReceipt), undefined)
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_identity_receipts WHERE room_id = ?').get(view.room.id).total, 1)
  await request('POST', `${route}/close`, 1, { commandId: randomUUID() })
  db.prepare('UPDATE ktv_rooms SET closed_at = ? WHERE id = ?').run(new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString(), view.room.id)
  const fresh = (await request('POST', '/rooms', 2, { name: 'Fresh', displayName: 'Alex' })).body.data
  realtime.lifecycle.sweep()
  assert.equal(db.prepare('SELECT 1 FROM ktv_rooms WHERE id = ?').get(view.room.id), undefined)
  assert.ok(db.prepare('SELECT 1 FROM ktv_rooms WHERE id = ?').get(fresh.room.id))
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_queue_entries').get().total, 0)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
})

test('configured member/song/device ceilings are enforced and unsafe policy values fail startup', async t => {
  assert.throws(() => ktvPolicy({ receiptRetentionMs: 1000 }), /Invalid KTV/)
  assert.throws(() => ktvPolicy({ historyRetentionMs: 24 * 60 * 60_000, receiptRetentionMs: 48 * 60 * 60_000 }), /retry window/)
  const { request } = await setup(t, { policy: { members: 2, singerRequests: 1, queue: 2, deviceGrants: 0 } })
  const view = (await request('POST', '/rooms', 1, { name: 'Limits', displayName: 'Host', approvalRequired: false })).body.data
  assert.deepEqual(view.limits, { members: 2, queue: 2, singerRequests: 1 })
  assert.equal((await request('POST', '/join', 2, { code: view.invitationCode, displayName: 'Alex' })).status, 200)
  assert.equal((await request('POST', '/join', 3, { code: view.invitationCode, displayName: 'Extra' })).body.code, 'ROOM_FULL')
  const route = `/rooms/${view.room.id}`
  assert.equal((await request('POST', `${route}/pairings`, 1, { scope: 'display' })).body.code, 'DEVICE_LIMIT')
  const song = { songId: 1, title: 'Limit song', requestNext: false, singerMemberId: view.self.id }
  assert.equal((await request('POST', `${route}/queue`, 1, { ...song, commandId: randomUUID() })).status, 200)
  assert.equal((await request('POST', `${route}/queue`, 1, { ...song, commandId: randomUUID() })).body.code, 'SINGER_QUEUE_FULL')
})

test('configured pairing/ticket policy is published only to admitted viewers and expiry stays within the room', async t => {
  const timing = { pairingLifetimeMs: 45000, ticketLifetimeMs: 10000, socketAuthTimeoutMs: 2000 }
  const f = await setup(t, { timing })
  const room = (await f.request('POST', '/rooms', 1, { name: 'Timed room', displayName: 'Host', approvalRequired: true })).body.data
  assert.equal(room.timing.pairingLifetimeMs, 45000); assert.equal(room.timing.outputLeaseMs, 8000)
  const route = `/rooms/${room.room.id}`
  const pairing = (await f.request('POST', `${route}/pairings`, 1, { scope: 'display' })).body.data
  const stored = f.db.prepare('SELECT created_at, expires_at FROM ktv_pairings WHERE room_id = ?').get(room.room.id)
  assert.equal(Date.parse(stored.expires_at) - Date.parse(stored.created_at), 45000)
  assert.equal(pairing.expiresAt, stored.expires_at)
  const ticket = (await f.request('POST', `${route}/socket-ticket`, 1)).body.data
  assert.ok(Math.abs(Date.parse(ticket.expiresAt) - Date.now() - 10000) < 500)
  const pending = (await f.request('POST', '/join', 2, { code: room.invitationCode, displayName: 'Pending' })).body.data
  assert.equal(pending.timing, undefined)
  f.db.prepare('UPDATE ktv_rooms SET expires_at = ? WHERE id = ?').run(new Date(Date.now() + 5000).toISOString(), room.room.id)
  const capped = (await f.request('POST', `${route}/pairings`, 1, { scope: 'display' })).body.data
  assert.equal(capped.expiresAt, f.db.prepare('SELECT expires_at FROM ktv_rooms WHERE id = ?').get(room.room.id).expires_at)
})

test('configured socket authentication deadline closes an unauthenticated real connection', async t => {
  const f = await setup(t, { timing: { socketAuthTimeoutMs: 1000 } })
  const socket = new WebSocket(f.socketUrl, { origin: f.origin })
  socket.on('error', () => {}); t.after(() => socket.terminate())
  const started = performance.now()
  const code = await new Promise(resolve => socket.once('close', resolve))
  assert.equal(code, 4401); assert.ok(performance.now() - started >= 900)
})

test('HTTP room guard rejects foreign origins and oversized bodies; rate buckets expire and ignore forwarded spoofing', async t => {
  const { request, origin } = await setup(t)
  assert.equal((await request('GET', '/rooms', 1, undefined, { Origin: 'https://foreign.example' })).body.code, 'ORIGIN_DENIED')
  assert.equal((await request('GET', '/rooms', 1, undefined, { Origin: origin })).status, 200)
  assert.equal((await request('POST', '/rooms', 1, { name: 'Huge', displayName: 'Host', padding: 'x'.repeat(17 * 1024) })).body.code, 'MESSAGE_TOO_LARGE')
  let timestamp = 1000, passed = 0, code, status, retry
  const guard = createKtvHttpGuard({ limit: 2, now: () => timestamp })
  const response = { set: (name, value) => { if (name === 'Retry-After') retry = value }, status: value => { status = value; return response }, json: value => { code = value.code } }
  for (let index = 0; index < 3; index++) guard({ headers: { host: 'room.example', 'x-real-ip': `spoof-${index}` }, socket: { remoteAddress: 'same-peer' } }, response, () => { passed++ })
  assert.equal(passed, 2); assert.equal(code, 'TOO_MANY_REQUESTS'); assert.equal(status, 429); assert.equal(retry, '60')
  timestamp += 60_000
  guard({ headers: { host: 'room.example' }, socket: { remoteAddress: 'same-peer' } }, response, () => { passed++ })
  assert.equal(passed, 3)
})

test('request cancellation, nomination decline and priority approval cannot interrupt an active performance', async t => {
  const { request, db } = await setup(t)
  const view = (await request('POST', '/rooms', 1, { name: 'Queue performance boundary', displayName: 'Host', approvalRequired: false })).body.data
  const singer = (await request('POST', '/join', 2, { code: view.invitationCode, displayName: 'Singer' })).body.data.self
  const route = `/rooms/${view.room.id}`
  const queued = (await request('POST', `${route}/queue`, 1, { commandId: randomUUID(), songId: 1, title: 'Current nomination', requestNext: true, singerMemberId: singer.id })).body.data.queue[0]
  await request('POST', `${route}/queue/${queued.id}/accept`, 2, { commandId: randomUUID() })
  db.prepare(`INSERT INTO ktv_playback (room_id, entry_id, performance_id, generation, clock_id, state, updated_at)
    VALUES (?, ?, ?, 1, ?, 'preparing', ?)`).run(view.room.id, queued.id, randomUUID(), view.clock.clockId, new Date().toISOString())
  for (const [action, actor] of [['cancel', 1], ['decline', 2], ['approve-next', 1]]) {
    const commandId = randomUUID()
    const denied = await request('POST', `${route}/queue/${queued.id}/${action}`, actor, { commandId })
    assert.equal(denied.status, 409); assert.equal(denied.body.code, 'PERFORMANCE_ACTIVE')
    assert.equal(db.prepare('SELECT 1 FROM ktv_command_receipts WHERE command_id = ?').get(commandId), undefined)
  }
  assert.equal(db.prepare('SELECT state FROM ktv_queue_entries WHERE id = ?').get(queued.id).state, 'queued')
  assert.equal(db.prepare('SELECT entry_id FROM ktv_playback WHERE room_id = ?').get(view.room.id).entry_id, queued.id)
  const pending = (await request('POST', `${route}/queue`, 2, { commandId: randomUUID(), songId: 2, title: 'Unstarted request', requestNext: false })).body.data.queue.find(entry => entry.id !== queued.id)
  assert.equal((await request('POST', `${route}/queue/${pending.id}/cancel`, 2, { commandId: randomUUID() })).status, 200)
  assert.equal(db.prepare('SELECT entry_id FROM ktv_playback WHERE room_id = ?').get(view.room.id).entry_id, queued.id)
})

test('host ordering is visible, revision-safe, idempotent and persistent while fair turns resume after an override', async t => {
  const fixture = await setup(t), { request } = fixture
  let view = (await request('POST', '/rooms', 1, { name: 'Queue ordering', displayName: 'Host', approvalRequired: false })).body.data
  const route = `/rooms/${view.room.id}`
  const alex = (await request('POST', '/join', 2, { code: view.invitationCode, displayName: 'Alex' })).body.data.self
  await request('POST', '/join', 3, { code: view.invitationCode, displayName: 'Casey' })
  await request('POST', `${route}/members/${alex.id}/role`, 1, { commandId: randomUUID(), role: 'cohost' })
  const entries = {}
  for (const [actor, title] of [[1, 'Host one'], [1, 'Host two'], [2, 'Alex one'], [3, 'Casey one']]) {
    view = (await request('POST', `${route}/queue`, actor, { commandId: randomUUID(), songId: 1, title, requestNext: false })).body.data
    entries[title] = view.queue.find(entry => entry.title === title).id
  }
  assert.deepEqual(view.queue.map(entry => entry.title), ['Host one', 'Alex one', 'Casey one', 'Host two'])
  const move = { commandId: randomUUID(), action: 'next', baseRevision: view.room.revision }
  assert.equal((await request('POST', `${route}/queue/${entries['Casey one']}/order`, 2, move)).body.code, 'FORBIDDEN')
  view = (await request('POST', `${route}/queue/${entries['Casey one']}/order`, 1, move)).body.data
  assert.equal(view.queue[0].title, 'Casey one'); assert.ok(view.queue[0].hostOrder < 0)
  assert.equal((await request('POST', `${route}/queue/${entries['Casey one']}/order`, 1, move)).body.data.room.revision, view.room.revision)
  assert.equal((await request('POST', `${route}/queue/${entries['Host two']}/order`, 1, { ...move, commandId: randomUUID() })).body.code, 'REVISION_CONFLICT')
  await fixture.restart()
  view = (await request('GET', route, 1)).body.data
  assert.equal(view.queue[0].title, 'Casey one')
  assert.equal((await request('POST', `${route}/queue/${entries['Casey one']}/order`, 1, move)).body.data.queue[0].title, 'Casey one')
  view = (await request('POST', `${route}/queue/${entries['Casey one']}/order`, 1, { commandId: randomUUID(), action: 'fair', baseRevision: view.room.revision })).body.data
  assert.deepEqual(view.queue.map(entry => entry.title), ['Host one', 'Alex one', 'Casey one', 'Host two'])
  const concurrent = await Promise.all(['Host two', 'Alex one'].map(title => request('POST', `${route}/queue/${entries[title]}/order`, 1,
    { commandId: randomUUID(), action: 'next', baseRevision: view.room.revision })))
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409])
  view = (await request('GET', route, 1)).body.data
  const first = view.queue[0]
  view = (await request('POST', `${route}/readiness/offer`, 1, { commandId: randomUUID(), entryId: first.id, clockId: view.clock.clockId, baseRevision: view.room.revision })).body.data
  assert.equal((await request('POST', `${route}/queue/${first.id}/order`, 1, { commandId: randomUUID(), action: 'fair', baseRevision: view.room.revision })).body.code, 'TURN_SELECTED')
  assert.equal((await request('GET', route, 1)).body.data.queue[0].id, first.id)
})

test('moderators reassign held requests without changing requester identity or reviving old acceptance/priority', async t => {
  const { request, db } = await setup(t)
  let view = (await request('POST', '/rooms', 1, { name: 'Held reassignment', displayName: 'Host', approvalRequired: false })).body.data
  const route = `/rooms/${view.room.id}`
  const departed = (await request('POST', '/join', 2, { code: view.invitationCode, displayName: 'Departed' })).body.data.self
  const recipient = (await request('POST', '/join', 3, { code: view.invitationCode, displayName: 'Recipient' })).body.data.self
  view = (await request('POST', `${route}/queue`, 2, { commandId: randomUUID(), songId: 1, title: 'Held song', requestNext: true })).body.data
  const entry = view.queue[0]
  await request('POST', `${route}/queue/${entry.id}/approve-next`, 1, { commandId: randomUUID() })
  view = (await request('POST', `${route}/members/${departed.id}/remove`, 1, {})).body.data
  assert.equal(view.queue[0].state, 'held')
  const reassign = { commandId: randomUUID(), singerMemberId: recipient.id, baseRevision: view.room.revision }
  assert.equal((await request('POST', `${route}/queue/${entry.id}/reassign`, 3, reassign)).body.code, 'FORBIDDEN')
  view = (await request('POST', `${route}/queue/${entry.id}/reassign`, 1, reassign)).body.data
  const reassigned = view.queue[0]
  assert.equal(reassigned.id, entry.id); assert.equal(reassigned.requesterMemberId, departed.id)
  assert.equal(reassigned.singerMemberId, recipient.id); assert.equal(reassigned.singerAccepted, false)
  assert.equal(reassigned.priorityRequested, false); assert.equal(reassigned.priorityApproved, false); assert.equal(reassigned.hostOrder, null)
  assert.equal((await request('POST', `${route}/queue/${entry.id}/reassign`, 1, reassign)).body.data.room.revision, view.room.revision)
  assert.equal((await request('POST', `${route}/readiness/offer`, 1, { commandId: randomUUID(), entryId: entry.id, clockId: view.clock.clockId, baseRevision: view.room.revision })).body.code, 'SINGER_NOT_ACCEPTED')
  view = (await request('POST', `${route}/queue/${entry.id}/accept`, 3, { commandId: randomUUID() })).body.data
  assert.equal(view.queue[0].singerAccepted, true)
  await request('POST', `${route}/members/${departed.id}/approve`, 1, {})
  view = (await request('GET', route, 1)).body.data
  view = (await request('POST', `${route}/queue/${entry.id}/reassign`, 1, { commandId: randomUUID(), singerMemberId: departed.id, baseRevision: view.room.revision })).body.data
  assert.equal(view.queue[0].requesterMemberId, view.queue[0].singerMemberId); assert.equal(view.queue[0].singerAccepted, false)
  view = (await request('POST', `${route}/queue/${entry.id}/accept`, 2, { commandId: randomUUID() })).body.data
  assert.equal(view.queue[0].singerAccepted, true)
  assert.equal(db.prepare("SELECT COUNT(*) total FROM ktv_room_events WHERE action = 'queue.reassigned'").get().total, 2)
})

test('only hosts set per-room singer caps; existing requests survive reductions and reassignment respects the cap', async t => {
  const fixture = await setup(t), { request } = fixture
  let view = (await request('POST', '/rooms', 1, { name: 'Room singer cap', displayName: 'Host', approvalRequired: false })).body.data
  const route = `/rooms/${view.room.id}`
  const alex = (await request('POST', '/join', 2, { code: view.invitationCode, displayName: 'Alex' })).body.data.self
  await request('POST', `${route}/members/${alex.id}/role`, 1, { commandId: randomUUID(), role: 'cohost' })
  assert.equal((await request('POST', `${route}/settings`, 2, { singerRequests: 1 })).body.code, 'FORBIDDEN')
  for (const value of [0, 11, '3', 1.5]) assert.equal((await request('POST', `${route}/settings`, 1, { singerRequests: value })).body.code, 'INVALID_INPUT')
  for (let index = 0; index < 2; index++) view = (await request('POST', `${route}/queue`, 2, { commandId: randomUUID(), songId: 1, title: `Alex ${index}`, requestNext: false })).body.data
  const setCap = { commandId: randomUUID(), singerRequests: 1 }
  view = (await request('POST', `${route}/settings`, 1, setCap)).body.data
  assert.equal(view.limits.singerRequests, 1); assert.equal(view.queue.length, 2)
  assert.equal((await request('POST', `${route}/settings`, 1, setCap)).body.data.room.revision, view.room.revision)
  assert.equal((await request('POST', `${route}/queue`, 2, { commandId: randomUUID(), songId: 1, title: 'Extra', requestNext: false })).body.code, 'SINGER_QUEUE_FULL')
  view = (await request('POST', `${route}/queue`, 1, { commandId: randomUUID(), songId: 1, title: 'Host request', requestNext: false })).body.data
  const own = view.queue.find(entry => entry.singerMemberId === view.self.id)
  assert.equal((await request('POST', `${route}/queue/${own.id}/reassign`, 1, { commandId: randomUUID(), singerMemberId: alex.id, baseRevision: view.room.revision })).body.code, 'SINGER_QUEUE_FULL')
  await fixture.restart()
  assert.equal((await request('GET', route, 1)).body.data.limits.singerRequests, 1)
})

test('identity receipts prevent duplicate rooms, survive invite rotation, and roll back with mutations', async t => {
  const { request, db } = await setup(t)
  const body = { commandId: randomUUID(), name: 'Receipt room', displayName: 'Host', approvalRequired: false }
  const created = await Promise.all([request('POST', '/rooms', 1, body), request('POST', '/rooms', 1, body)])
  assert.equal(created[0].body.data.room.id, created[1].body.data.room.id)
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_rooms').get().total, 1)
  assert.equal(db.prepare("SELECT COUNT(*) total FROM ktv_room_events WHERE action = 'room.created'").get().total, 1)
  assert.equal((await request('POST', '/rooms', 1, { ...body, name: 'Different room' })).body.code, 'COMMAND_CONFLICT')
  const view = created[0].body.data, route = `/rooms/${view.room.id}`
  const join = { commandId: randomUUID(), code: view.invitationCode, displayName: 'Alex' }
  const first = (await request('POST', '/join', 2, join)).body.data
  await request('POST', `${route}/invitations/rotate`, 1, { commandId: randomUUID() })
  const replay = await request('POST', '/join', 2, join)
  assert.equal(replay.status, 200)
  assert.equal(replay.body.data.self.id, first.self.id)
  assert.equal((await request('POST', '/join', 2, { ...join, displayName: 'Other name' })).body.code, 'COMMAND_CONFLICT')
  await request('POST', `${route}/members/${first.self.id}/remove`, 1, {})
  assert.equal((await request('POST', '/join', 2, join)).body.code, 'NOT_ADMITTED')
  db.exec(`CREATE TRIGGER fail_identity_receipt BEFORE INSERT ON ktv_identity_receipts BEGIN SELECT RAISE(ABORT, 'receipt failure'); END`)
  const failedId = randomUUID()
  assert.equal((await request('POST', '/rooms', 1, { ...body, commandId: failedId })).status, 500)
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_rooms').get().total, 1)
  assert.equal(db.prepare('SELECT 1 FROM ktv_identity_receipts WHERE command_id = ?').get(failedId), undefined)
  db.exec('DROP TRIGGER fail_identity_receipt')
})

test('settings, invitation rotation and closed-room replies apply once across bearer and paired control', async t => {
  const { request, db } = await setup(t)
  let view = (await request('POST', '/rooms', 1, { name: 'General receipts', displayName: 'Host', approvalRequired: false })).body.data
  const route = `/rooms/${view.room.id}`
  const setting = { commandId: randomUUID(), stageInviteVisible: true }
  view = (await request('POST', `${route}/settings`, 1, setting)).body.data
  assert.equal((await request('POST', `${route}/settings`, 1, setting)).body.data.room.revision, view.room.revision)
  assert.equal((await request('POST', `${route}/settings`, 1, { ...setting, stageInviteVisible: false })).body.code, 'COMMAND_CONFLICT')
  const rotate = { commandId: randomUUID() }
  view = (await request('POST', `${route}/invitations/rotate`, 1, rotate)).body.data
  const replay = (await request('POST', `${route}/invitations/rotate`, 1, rotate)).body.data
  assert.equal(replay.room.revision, view.room.revision); assert.equal(replay.invitationCode, view.invitationCode)
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_invitations WHERE room_id = ?').get(view.room.id).total, 2)
  const pairing = (await request('POST', `${route}/pairings`, 1, { scope: 'controller' })).body.data
  const grant = (await request('POST', '/pairings/redeem', 1, { code: pairing.code })).body.data
  const device = { device: grant.credential }, close = { commandId: randomUUID() }
  assert.equal((await request('POST', `${route}/close`, device, close)).status, 200)
  assert.equal((await request('POST', `${route}/close`, device, close)).status, 200)
  assert.equal((await request('POST', `${route}/close`, 1, close)).status, 200)
  assert.equal((await request('GET', route, device)).body.code, 'DEVICE_REVOKED')
  assert.equal((await request('POST', `${route}/close`, device, { commandId: randomUUID() })).body.code, 'DEVICE_REVOKED')
  assert.equal(db.prepare("SELECT COUNT(*) total FROM ktv_room_events WHERE room_id = ? AND action = 'room.closed'").get(view.room.id).total, 1)
})

test('pairing receipts recover the same encrypted credential without creating or restoring device grants', async t => {
  const { request, db } = await setup(t)
  const view = (await request('POST', '/rooms', 1, { name: 'Pair receipts', displayName: 'Host' })).body.data
  const route = `/rooms/${view.room.id}`, command = { commandId: randomUUID(), scope: 'display' }
  const pairing = (await request('POST', `${route}/pairings`, 1, command)).body.data
  assert.deepEqual((await request('POST', `${route}/pairings`, 1, command)).body.data, pairing)
  assert.equal((await request('POST', `${route}/pairings`, 1, { ...command, scope: 'controller' })).body.code, 'COMMAND_CONFLICT')
  const redeem = { commandId: randomUUID(), code: pairing.code }
  const grant = (await request('POST', '/pairings/redeem', 1, redeem)).body.data
  assert.deepEqual((await request('POST', '/pairings/redeem', 1, redeem)).body.data, grant)
  assert.equal((await request('POST', '/pairings/redeem', 1, { ...redeem, commandId: randomUUID() })).body.code, 'INVALID_PAIRING')
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_device_grants WHERE room_id = ?').get(view.room.id).total, 1)
  const stored = db.prepare('SELECT * FROM ktv_pairing_receipts WHERE command_id = ?').get(redeem.commandId)
  assert.ok(stored.result_cipher); assert.ok(!JSON.stringify(stored).includes(grant.credential))
  const revoke = { commandId: randomUUID() }
  assert.equal((await request('POST', `${route}/devices/${grant.deviceId}/revoke`, 1, revoke)).status, 200)
  assert.equal((await request('POST', `${route}/devices/${grant.deviceId}/revoke`, 1, revoke)).status, 200)
  assert.equal((await request('POST', '/pairings/redeem', 1, redeem)).body.code, 'DEVICE_REVOKED')
})

test('invitation resolution restores existing admission without adding or renaming new guests', async t => {
  const { request, db } = await setup(t)
  const view = (await request('POST', '/rooms', 1, { name: 'Returning guests', displayName: 'Host' })).body.data
  const resolve = actor => request('POST', '/invitations/resolve', actor, { code: view.invitationCode })
  assert.deepEqual((await resolve(2)).body.data, { membership: null })
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_members').get().total, 1)
  const pending = (await request('POST', '/join', 2, { code: view.invitationCode, displayName: 'Chosen name' })).body.data
  const recovered = (await resolve(2)).body.data.membership
  assert.equal(recovered.self.id, pending.self.id); assert.equal(recovered.self.displayName, 'Chosen name')
  assert.equal(recovered.self.admission, 'pending'); assert.equal(recovered.queue, undefined)
  const route = `/rooms/${view.room.id}`
  await request('POST', `${route}/members/${pending.self.id}/approve`, 1, {})
  await request('POST', `${route}/settings`, 1, { locked: true })
  assert.equal((await resolve(2)).body.data.membership.self.admission, 'admitted')
  assert.equal((await resolve(3)).body.code, 'ROOM_LOCKED')
  await request('POST', `${route}/members/${pending.self.id}/block`, 1, { commandId: randomUUID() })
  assert.equal((await resolve(2)).body.code, 'ROOM_BLOCKED')
  await request('POST', `${route}/members/${pending.self.id}/unblock`, 1, { commandId: randomUUID() })
  assert.equal((await resolve(2)).body.code, 'NOT_ADMITTED')
  await request('POST', `${route}/invitations/rotate`, 1, {})
  assert.equal((await resolve(1)).body.code, 'INVALID_INVITATION')
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_members').get().total, 2)
})

test('general receipts and encrypted device replies survive a full service/database restart', async t => {
  const fixture = await setup(t), { request } = fixture
  const create = { commandId: randomUUID(), name: 'Restart receipts', displayName: 'Host', approvalRequired: false }
  const view = (await request('POST', '/rooms', 1, create)).body.data, route = `/rooms/${view.room.id}`
  const join = { commandId: randomUUID(), code: view.invitationCode, displayName: 'Alex' }
  const member = (await request('POST', '/join', 2, join)).body.data.self
  const pair = { commandId: randomUUID(), scope: 'controller' }
  const pairing = (await request('POST', `${route}/pairings`, 2, pair)).body.data
  const redeem = { commandId: randomUUID(), code: pairing.code }
  const grant = (await request('POST', '/pairings/redeem', 2, redeem)).body.data
  const rotate = { commandId: randomUUID() }
  const rotated = (await request('POST', `${route}/invitations/rotate`, 1, rotate)).body.data
  await fixture.restart()
  assert.equal((await request('POST', '/rooms', 1, create)).body.data.room.id, view.room.id)
  assert.equal((await request('POST', '/join', 2, join)).body.data.self.id, member.id)
  assert.deepEqual((await request('POST', `${route}/pairings`, 2, pair)).body.data, pairing)
  assert.deepEqual((await request('POST', '/pairings/redeem', 2, redeem)).body.data, grant)
  assert.equal((await request('POST', `${route}/invitations/rotate`, 1, rotate)).body.data.invitationCode, rotated.invitationCode)
  assert.equal((await request('GET', route, { device: grant.credential })).status, 200)
  assert.equal(fixture.db.prepare('SELECT COUNT(*) total FROM ktv_rooms').get().total, 1)
  assert.deepEqual(fixture.db.prepare('PRAGMA foreign_key_check').all(), [])
})

test('a failed encrypted pairing receipt rolls back redemption and leaves its code usable', async t => {
  const { request, db } = await setup(t)
  const view = (await request('POST', '/rooms', 1, { name: 'Pair rollback', displayName: 'Host' })).body.data
  const pairing = (await request('POST', `/rooms/${view.room.id}/pairings`, 1, { commandId: randomUUID(), scope: 'display' })).body.data
  const redeem = { commandId: randomUUID(), code: pairing.code }
  db.exec("CREATE TRIGGER fail_pair_receipt BEFORE INSERT ON ktv_pairing_receipts BEGIN SELECT RAISE(ABORT, 'pair receipt failure'); END")
  assert.equal((await request('POST', '/pairings/redeem', 1, redeem)).status, 500)
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_device_grants').get().total, 0)
  assert.equal(db.prepare('SELECT redeemed_at FROM ktv_pairings').get().redeemed_at, null)
  assert.equal(db.prepare("SELECT COUNT(*) total FROM ktv_room_events WHERE action = 'device.paired'").get().total, 0)
  db.exec('DROP TRIGGER fail_pair_receipt')
  assert.equal((await request('POST', '/pairings/redeem', 1, redeem)).status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_device_grants').get().total, 1)
})

async function openSocket(url, origin, ticket) {
  const ws = new WebSocket(url, { origin })
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  const first = nextSnapshot(ws)
  ws.send(JSON.stringify({ type: 'authenticate', ticket }))
  return { ws, first }
}

function nextPacket(ws, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`packet timeout: ${type}`)) }, 3000)
    function cleanup() { clearTimeout(timeout); ws.off('message', receive); ws.off('close', closed) }
    function receive(raw) { const message = JSON.parse(raw.toString()); if (message.type === type) { cleanup(); resolve(message) } }
    function closed(code) { cleanup(); reject(new Error(`socket closed ${code}`)) }
    ws.on('message', receive); ws.once('close', closed)
  })
}

test('real room transports authorize stage preparation, scheduled controls, completion and durable retries', async t => {
  let nowMs = 0
  const clock = { id: randomUUID(), nowMs: () => nowMs }
  const assets = { songId: 1, version: 'transport-fixture', durationMs: 60_000,
    instrumental: { durationMs: 60_000 }, original: { durationMs: 60_000 }, lyrics: { mode: 'missing', text: null } }
  const { db, request, realtime, socketUrl, origin } = await setup(t, { clock, resolveAssets: async () => assets })
  let view = (await request('POST', '/rooms', 1, { name: 'Playback', displayName: 'Host', approvalRequired: false, automaticPlayback: false })).body.data
  const path = `/rooms/${view.room.id}`
  const guest = (await request('POST', '/join', 2, { code: view.invitationCode, displayName: 'Singer' })).body.data
  const pending = (await request('POST', '/rooms', 3, { name: 'Other', displayName: 'Other host' })).body.data
  assert.equal((await request('GET', `${path}/assets/1`, 4)).status, 403)
  assert.equal((await request('GET', `${path}/assets/1`, 2)).body.data.version, assets.version)
  const deviceId = randomUUID()
  const ticket = (await request('POST', `${path}/socket-ticket`, 1, { deviceId })).body.data.ticket
  const { ws, first } = await openSocket(socketUrl, origin, ticket)
  t.after(() => ws.terminate())
  await first
  async function send(body, type = 'device.ack') {
    const reply = nextPacket(ws, type)
    ws.send(JSON.stringify({ protocolVersion: 1, ...body }))
    return reply
  }
  await send({ type: 'device.status', purpose: 'stage', label: 'Transport stage', audioEnabled: true, clockHealthy: true })
  view = (await request('GET', path, 1)).body.data
  assert.equal(view.presence.devices[0].id, deviceId)
  let body = { commandId: randomUUID(), clockId: clock.id, baseRevision: view.room.revision, deviceId }
  assert.equal((await request('POST', `${path}/playback/assign-stage`, 2, body)).body.code, 'FORBIDDEN')
  view = (await request('POST', `${path}/playback/assign-stage`, 1, body)).body.data
  assert.equal(view.playback.stageDeviceId, deviceId)
  view = (await request('POST', `${path}/queue`, 2, { commandId: randomUUID(), songId: 1, title: 'Song', requestNext: false })).body.data
  const entryId = view.queue[0].id
  view = (await request('POST', `${path}/readiness/offer`, 1, { commandId: randomUUID(), entryId,
    clockId: clock.id, baseRevision: view.room.revision })).body.data
  function humanCommand() { return { commandId: randomUUID(), clockId: clock.id, baseRevision: view.room.revision,
    performanceId: view.readiness.performanceId, generation: view.readiness.generation } }
  view = (await request('POST', `${path}/readiness/respond`, 2, { ...humanCommand(), ready: true })).body.data
  const prepare = humanCommand()
  const prepared = await request('POST', `${path}/playback/prepare`, 1, prepare)
  assert.equal(prepared.status, 200)
  view = prepared.body.data
  assert.equal(view.playback.state, 'preparing')
  assert.equal((await request('POST', `${path}/playback/prepare`, 1, prepare)).body.data.room.revision, view.room.revision)
  function playbackCommand() { return { commandId: randomUUID(), clockId: clock.id, baseRevision: view.room.revision,
    performanceId: view.playback.performanceId, generation: view.playback.generation } }
  nowMs = 9000
  await send({ type: 'device.status', purpose: 'stage', label: 'Transport stage', audioEnabled: true, clockHealthy: true })
  assert.equal((await request('POST', `${path}/playback/start`, 1, playbackCommand())).body.code, 'DEVICE_NOT_READY')
  let ready = { type: 'device.ready', clockId: clock.id, performanceId: view.playback.performanceId,
    generation: view.playback.generation, assetVersion: assets.version, durationMs: assets.durationMs }
  assert.equal((await send({ ...ready, generation: ready.generation - 1 }, 'error')).code, 'STALE_GENERATION')
  await send(ready)
  const guideId = randomUUID()
  const guideTicket = (await request('POST', `${path}/socket-ticket`, 2, { deviceId: guideId })).body.data.ticket
  const guideSocket = await openSocket(socketUrl, origin, guideTicket)
  t.after(() => guideSocket.ws.terminate())
  await guideSocket.first
  async function guideSend(body) {
    const response = nextPacket(guideSocket.ws, 'device.ack')
    guideSocket.ws.send(JSON.stringify({ protocolVersion: 1, ...body }))
    return response
  }
  await guideSend({ type: 'device.status', purpose: 'guide', label: 'Transport guide', audioEnabled: true, clockHealthy: true })
  assert.equal((await request('POST', `${path}/playback/guide`, 1, { ...playbackCommand(), required: true, deviceId })).body.code, 'FORBIDDEN')
  const guideCommand = { ...playbackCommand(), required: true, deviceId: guideId }
  view = (await request('POST', `${path}/playback/guide`, 2, guideCommand)).body.data
  assert.equal(view.playback.guideRequired, true)
  assert.equal((await request('POST', `${path}/playback/guide`, 2, guideCommand)).body.data.room.revision, view.room.revision)
  assert.equal((await request('POST', `${path}/playback/guide`, 2, { ...guideCommand, required: false })).body.code, 'COMMAND_CONFLICT')
  assert.equal((await request('POST', `${path}/playback/start`, 1, playbackCommand())).body.code, 'GUIDE_NOT_READY')
  await guideSend(ready)
  const start = playbackCommand()
  view = (await request('POST', `${path}/playback/start`, 1, start)).body.data
  const leasePacket = nextPacket(ws, 'lease')
  realtime.playback.sweep()
  const { lease } = await leasePacket
  assert.equal(lease.deviceId, deviceId)
  assert.equal((await request('POST', `${path}/playback/start`, 1, start)).body.data.room.revision, view.room.revision)
  nowMs = 11000
  await send({ type: 'device.heartbeat', leaseId: lease.id, clockId: clock.id,
    performanceId: ready.performanceId, generation: ready.generation }, 'lease')
  await guideSend({ type: 'device.heartbeat', clockId: clock.id, performanceId: ready.performanceId, generation: ready.generation })
  realtime.playback.sweep()
  view = (await request('GET', path, 1)).body.data
  assert.equal(view.playback.state, 'playing')
  assert.equal((await request('POST', `${path}/playback/pause`, 2, playbackCommand())).body.code, 'FORBIDDEN')
  view = (await request('POST', `${path}/playback/seek`, 1, { ...playbackCommand(), positionMs: 30000 })).body.data
  assert.equal(view.playback.positionMs, 0)
  assert.equal(view.playback.pendingTransition.positionMs, 30000)
  await send({ ...ready, generation: view.playback.pendingTransition.generation })
  await guideSend({ ...ready, generation: view.playback.pendingTransition.generation })
  nowMs = 13000; realtime.playback.sweep()
  view = (await request('GET', path, 1)).body.data
  assert.equal(view.playback.positionMs, 30000)
  assert.equal((await send({ type: 'playback.ended', entryId, leaseId: lease.id, clockId: clock.id,
    performanceId: ready.performanceId, generation: ready.generation }, 'error')).code, 'STALE_GENERATION')
  assert.equal((await request('POST', `${path}/playback/pause`, 1, { ...playbackCommand(), baseRevision: 1 })).body.code, 'REVISION_CONFLICT')
  view = (await request('POST', `${path}/queue`, 1, { commandId: randomUUID(), songId: 2, title: 'Next song', requestNext: false })).body.data
  const nextEntry = view.queue.find(entry => entry.id !== entryId).id
  const skipCommand = playbackCommand()
  view = (await request('POST', `${path}/playback/skip`, 1, skipCommand)).body.data
  assert.equal(view.playback.state, 'idle')
  assert.equal(db.prepare('SELECT outcome FROM ktv_turn_history WHERE entry_id = ?').get(entryId).outcome, 'skipped')
  assert.equal(view.queue.length, 1)
  assert.equal(view.readiness.entryId, nextEntry)
  assert.equal(view.readiness.state, 'awaiting-singer')
  assert.equal((await request('POST', `${path}/playback/skip`, 1, skipCommand)).body.data.room.revision, view.room.revision)
  const declineCommand = { commandId: randomUUID(), clockId: clock.id, performanceId: view.readiness.performanceId,
    generation: view.readiness.generation, baseRevision: view.room.revision, ready: false }
  view = (await request('POST', `${path}/readiness/respond`, 1, declineCommand)).body.data
  assert.equal(db.prepare('SELECT outcome FROM ktv_turn_history WHERE entry_id = ?').get(nextEntry).outcome, 'declined')
  assert.equal((await request('POST', `${path}/readiness/respond`, 1, declineCommand)).body.data.room.revision, view.room.revision)
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_turn_history').get().total, 2)
  assert.equal(pending.room.id !== view.room.id && guest.self.id !== view.self.id, true)
})

test('invited guests enter names, retain random IDs, and wait for host approval', async (t) => {
  const { db, request } = await setup(t)
  const created = await request('POST', '/rooms', 1, { name: 'Friday songs', displayName: 'Host' })
  assert.equal(created.status, 200)
  assert.equal(created.headers.get('cache-control'), 'no-store')
  const { room, invitationCode, self } = created.body.data
  assert.match(room.id, /^[0-9a-f-]{36}$/)
  assert.match(self.id, /^[0-9a-f-]{36}$/)
  assert.equal(self.role, 'host')
  assert.match(invitationCode, /^[A-HJ-NP-Z2-9]{8}$/)
  assert.equal(await request('GET', `/rooms/${room.id}`, 4).then((r) => r.status), 403)

  const blank = await request('POST', '/join', 2, { code: invitationCode, displayName: '  ' })
  assert.equal(blank.status, 400)
  const first = await request('POST', '/join', 2, { code: invitationCode, displayName: 'Alex' })
  assert.equal(first.status, 200)
  assert.equal(first.body.data.self.admission, 'pending')
  assert.equal(first.body.data.members, undefined)
  assert.equal(first.body.data.invitationCode, undefined)
  const memberId = first.body.data.self.id
  const repeated = await request('POST', '/join', 2, { code: invitationCode })
  assert.equal(repeated.body.data.self.id, memberId)
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_members WHERE room_id = ?').get(room.id).total, 2)

  const second = await request('POST', '/join', 3, { code: invitationCode, displayName: 'Alex' })
  assert.equal(second.status, 200)
  assert.notEqual(second.body.data.self.id, memberId)
  const waiting = await request('GET', `/rooms/${room.id}`, 2)
  assert.equal(waiting.body.data.members, undefined)
  const hostView = await request('GET', `/rooms/${room.id}`, 1)
  assert.equal(hostView.body.data.members.filter((m) => m.admission === 'pending').length, 2)

  const forbidden = await request('POST', `/rooms/${room.id}/members/${memberId}/approve`, 3)
  assert.equal(forbidden.status, 403)
  const approved = await request('POST', `/rooms/${room.id}/members/${memberId}/approve`, 1)
  assert.equal(approved.status, 200)
  const admitted = await request('GET', `/rooms/${room.id}`, 2)
  assert.equal(admitted.body.data.self.id, memberId)
  assert.equal(admitted.body.data.members.length, 2)
  assert.equal(admitted.body.data.invitationCode, undefined)
  assert.equal(admitted.body.data.members.some((m) => m.admission === 'pending'), false)

  const removed = await request('POST', `/rooms/${room.id}/members/${memberId}/remove`, 1)
  assert.equal(removed.status, 200)
  assert.equal(await request('GET', `/rooms/${room.id}`, 2).then((r) => r.status), 403)
  assert.equal(await request('POST', '/join', 2, { code: invitationCode, displayName: 'Alex' }).then((r) => r.status), 403)
})

test('host can rotate invitations, lock joining, and close the room', async (t) => {
  const { request } = await setup(t)
  const created = await request('POST', '/rooms', 1, {
    name: 'Open stage', displayName: 'Host', approvalRequired: false,
  })
  const { room, invitationCode } = created.body.data
  const joined = await request('POST', '/join', 2, { code: invitationCode, displayName: 'Alex' })
  assert.equal(joined.body.data.self.admission, 'admitted')
  assert.equal(await request('POST', `/rooms/${room.id}/settings`, 2, { locked: true }).then((r) => r.status), 403)
  const locked = await request('POST', `/rooms/${room.id}/settings`, 1, { locked: true })
  assert.equal(locked.body.data.room.locked, true)
  assert.equal(await request('POST', '/join', 3, { code: invitationCode, displayName: 'Alex' }).then((r) => r.status), 403)
  const unlocked = await request('POST', `/rooms/${room.id}/settings`, 1, { locked: false })
  assert.equal(unlocked.body.data.room.locked, false)

  const rotated = await request('POST', `/rooms/${room.id}/invitations/rotate`, 1)
  const newCode = rotated.body.data.invitationCode
  assert.notEqual(newCode, invitationCode)
  assert.equal(await request('POST', '/join', 3, { code: invitationCode, displayName: 'Alex' }).then((r) => r.status), 400)
  assert.equal(await request('POST', '/join', 3, { code: newCode, displayName: 'Alex' }).then((r) => r.status), 200)

  const closed = await request('POST', `/rooms/${room.id}/close`, 1)
  assert.equal(closed.body.data.status, 'closed')
  assert.equal(await request('GET', `/rooms/${room.id}`, 1).then((r) => r.status), 410)
  assert.equal(await request('POST', '/join', 4, { code: newCode, displayName: 'Guest' }).then((r) => r.status), 400)
})

test('room schema is additive and persists after reopening the database', async (t) => {
  const { db, request } = await setup(t)
  const created = await request('POST', '/rooms', 1, { name: 'Persisted', displayName: 'Host' })
  const roomId = created.body.data.room.id
  const dbPath = db.prepare('PRAGMA database_list').all()[0].file
  const reopened = initDb(path.dirname(dbPath))
  t.after(() => reopened.close())
  assert.equal(reopened.prepare('SELECT name FROM ktv_rooms WHERE id = ?').get(roomId).name, 'Persisted')
  assert.equal(reopened.prepare('SELECT COUNT(*) count FROM users').get().count, 4)
})

test('queue requests survive retries, rotate singers fairly, and require host priority approval', async (t) => {
  const { db, request } = await setup(t)
  const created = await request('POST', '/rooms', 1, { name: 'Queue room', displayName: 'Host', approvalRequired: false })
  const { room, invitationCode } = created.body.data
  const alex = (await request('POST', '/join', 2, { code: invitationCode, displayName: 'Alex' })).body.data.self
  const sam = (await request('POST', '/join', 3, { code: invitationCode, displayName: 'Sam' })).body.data.self
  const queuePath = `/rooms/${room.id}/queue`
  async function add(actor, songId, requestNext = false, commandId = randomUUID()) {
    return request('POST', queuePath, actor, { songId, title: `Track ${songId}`, requestNext, commandId })
  }
  const commandId = randomUUID()
  const first = await add(2, 1, false, commandId)
  assert.equal(first.status, 200)
  assert.equal(first.body.data.queue.length, 1)
  const same = await add(2, 1, false, commandId)
  assert.equal(same.status, 200)
  assert.equal(same.body.data.queue.length, 1)
  assert.equal(await add(2, 2, false, commandId).then((r) => r.status), 409)
  assert.equal(await add(4, 2).then((r) => r.status), 403)
  assert.equal(await add(2, 99).then((r) => r.status), 409)
  const secondAlex = await add(2, 2)
  assert.equal(secondAlex.status, 200)
  const firstSam = await add(3, 3, true)
  assert.equal(firstSam.status, 200)
  const thirdAlex = await add(2, 4)
  assert.equal(thirdAlex.status, 200)
  assert.equal(await add(2, 5).then((r) => r.status), 409)
  let queue = (await request('GET', `/rooms/${room.id}`, 1)).body.data.queue
  assert.deepEqual(queue.map((entry) => entry.songId), [1, 3, 2, 4])
  assert.equal(queue[1].priorityRequested, true)
  assert.equal(queue[1].priorityApproved, false)
  assert.equal(queue[1].singerMemberId, sam.id)
  assert.equal(queue[0].singerMemberId, alex.id)
  const priorityPath = `${queuePath}/${queue[1].id}/approve-next`
  assert.equal(await request('POST', priorityPath, 2, { commandId: randomUUID() }).then((r) => r.status), 403)
  const approveId = randomUUID()
  assert.equal(await request('POST', priorityPath, 1, { commandId: approveId }).then((r) => r.status), 200)
  assert.equal(await request('POST', priorityPath, 1, { commandId: approveId }).then((r) => r.status), 200)
  queue = (await request('GET', `/rooms/${room.id}`, 2)).body.data.queue
  assert.deepEqual(queue.map((entry) => entry.songId), [3, 1, 2, 4])
  assert.equal(await request('POST', `${queuePath}/${queue[1].id}/cancel`, 3, { commandId: randomUUID() }).then((r) => r.status), 403)
  assert.equal(await request('POST', `${queuePath}/${queue[1].id}/cancel`, 2, { commandId: randomUUID() }).then((r) => r.status), 200)
  const left = (await request('POST', `/rooms/${room.id}/members/${sam.id}/remove`, 1)).body.data
  assert.equal(left.queue.at(-1).songId, 3)
  assert.equal(left.queue.at(-1).state, 'held')
  assert.equal(await request('GET', `/rooms/${room.id}`, 3).then((r) => r.status), 403)
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM ktv_queue_entries WHERE room_id = ? AND state = 'queued'").get(room.id).total, 2)
})

test('simultaneous same-song requests create distinct durable entries', async (t) => {
  const { db, request } = await setup(t)
  const created = await request('POST', '/rooms', 1, { name: 'Two singers', displayName: 'Host', approvalRequired: false })
  const { room, invitationCode } = created.body.data
  await request('POST', '/join', 2, { code: invitationCode, displayName: 'Alex' })
  await request('POST', '/join', 3, { code: invitationCode, displayName: 'Sam' })
  const queuePath = `/rooms/${room.id}/queue`
  const [first, second] = await Promise.all([2, 3].map((actor) =>
    request('POST', queuePath, actor, { songId: 1, title: 'Same song', requestNext: false, commandId: randomUUID() }),
  ))
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  const queue = (await request('GET', `/rooms/${room.id}`, 1)).body.data.queue
  assert.equal(queue.length, 2)
  assert.notEqual(queue[0].id, queue[1].id)
  assert.notEqual(queue[0].singerMemberId, queue[1].singerMemberId)
  const dbPath = db.prepare('PRAGMA database_list').all()[0].file
  const reopened = initDb(path.dirname(dbPath))
  t.after(() => reopened.close())
  assert.equal(reopened.prepare('SELECT COUNT(*) AS total FROM ktv_queue_entries WHERE room_id = ?').get(room.id).total, 2)
  assert.equal(reopened.prepare('SELECT COUNT(*) AS total FROM ktv_command_receipts WHERE room_id = ?').get(room.id).total, 2)
})

test('room sockets use one-use tickets, redact pending views, broadcast changes and revoke removal', async (t) => {
  const { request, socketUrl, origin } = await setup(t)
  const created = await request('POST', '/rooms', 1, { name: 'Live room', displayName: 'Host' })
  const { room, invitationCode } = created.body.data
  const joined = await request('POST', '/join', 2, { code: invitationCode, displayName: 'Alex' })
  const memberId = joined.body.data.self.id
  assert.equal(await request('POST', `/rooms/${room.id}/socket-ticket`, 4, {}).then((r) => r.status), 403)
  const hostTicket = (await request('POST', `/rooms/${room.id}/socket-ticket`, 1, {})).body.data.ticket
  const guestTicket = (await request('POST', `/rooms/${room.id}/socket-ticket`, 2, {})).body.data.ticket
  const host = await openSocket(socketUrl, origin, hostTicket)
  let guest = await openSocket(socketUrl, origin, guestTicket)
  assert.equal((await host.first).invitationCode, invitationCode)
  const pending = await guest.first
  assert.equal(pending.self.admission, 'pending')
  assert.equal(pending.members, undefined)
  assert.equal(pending.queue, undefined)
  const reused = new WebSocket(socketUrl, { origin })
  await new Promise((resolve, reject) => { reused.once('open', resolve); reused.once('error', reject) })
  const denied = new Promise((resolve) => reused.once('close', resolve))
  reused.send(JSON.stringify({ type: 'authenticate', ticket: guestTicket }))
  assert.equal(await denied, 4401)

  const hostApproval = nextSnapshot(host.ws, data => data.members.some(member => member.id === memberId && member.admission === 'admitted'))
  const guestApproval = nextSnapshot(guest.ws, data => data.self.admission === 'admitted')
  const approved = await request('POST', `/rooms/${room.id}/members/${memberId}/approve`, 1, {})
  assert.equal(approved.status, 200)
  assert.equal((await hostApproval).members.length, 2)
  assert.equal((await guestApproval).self.admission, 'admitted')

  guest.ws.terminate()
  const reconnectTicket = (await request('POST', `/rooms/${room.id}/socket-ticket`, 2, {})).body.data.ticket
  guest = await openSocket(socketUrl, origin, reconnectTicket)
  assert.equal((await guest.first).members.length, 2)

  const hostQueue = nextSnapshot(host.ws, data => data.queue.some(entry => entry.title === 'Live song'))
  const guestQueue = nextSnapshot(guest.ws, data => data.queue.some(entry => entry.title === 'Live song'))
  const song = await request('POST', `/rooms/${room.id}/queue`, 2, {
    songId: 1, title: 'Live song', requestNext: false, commandId: randomUUID(),
  })
  assert.equal(song.status, 200)
  assert.equal((await hostQueue).queue[0].title, 'Live song')
  assert.equal((await guestQueue).queue[0].title, 'Live song')

  const removedClose = new Promise((resolve) => guest.ws.once('close', resolve))
  const hostRemoval = nextSnapshot(host.ws, data => !data.members.some(member => member.id === memberId))
  await request('POST', `/rooms/${room.id}/members/${memberId}/remove`, 1, {})
  assert.equal(await removedClose, 4403)
  assert.equal((await hostRemoval).members.length, 1)
  assert.equal(await request('POST', `/rooms/${room.id}/socket-ticket`, 2, {}).then((r) => r.status), 403)

  const hostClosed = new Promise((resolve) => host.ws.once('close', resolve))
  await request('POST', `/rooms/${room.id}/close`, 1, {})
  assert.equal(await hostClosed, 4410)
})

test('three room clients converge after concurrent edits, a missed update, and durable command replay after restart', async t => {
  const fixture = await setup(t), { request } = fixture
  const view = (await request('POST', '/rooms', 1, { commandId: randomUUID(), name: 'Convergence', displayName: 'Host', approvalRequired: false })).body.data
  const route = `/rooms/${view.room.id}`
  const joined = await Promise.all([2, 3].map(actor => request('POST', '/join', actor, { commandId: randomUUID(), code: view.invitationCode, displayName: `Singer ${actor}` })))
  assert.ok(joined.every(result => result.status === 200))
  const sockets = new Set()
  t.after(() => { for (const ws of sockets) ws.terminate() })
  async function connect(actor) {
    const ticket = (await request('POST', `${route}/socket-ticket`, actor, {})).body.data.ticket
    const client = await openSocket(fixture.socketUrl, fixture.origin, ticket)
    sockets.add(client.ws)
    return { ws: client.ws, snapshot: await client.first }
  }
  const clients = await Promise.all([1, 2, 3].map(connect))
  const queue = snapshot => snapshot.queue.map(entry => ({ id: entry.id, songId: entry.songId, requesterMemberId: entry.requesterMemberId, singerMemberId: entry.singerMemberId }))
  const broadcasts = clients.map(client => nextSnapshot(client.ws, snapshot => snapshot.queue?.length === 3))
  const commands = [1, 2, 3].map(() => ({ commandId: randomUUID(), songId: 1, title: 'Same song', requestNext: false }))
  const committed = await Promise.all(commands.map((body, index) => request('POST', `${route}/queue`, index + 1, body)))
  assert.ok(committed.every(result => result.status === 200))
  const canonical = (await request('GET', route, 1)).body.data
  assert.equal(new Set(canonical.queue.map(entry => entry.id)).size, 3)
  for (const snapshot of await Promise.all(broadcasts)) assert.deepEqual(queue(snapshot), queue(canonical))

  const disconnected = new Promise(resolve => clients[1].ws.once('close', resolve))
  clients[1].ws.terminate(); await disconnected
  const liveUpdates = [clients[0], clients[2]].map(client => nextSnapshot(client.ws, snapshot => snapshot.queue?.length === 4))
  assert.equal((await request('POST', `${route}/queue`, 3, { commandId: randomUUID(), songId: 2, title: 'While disconnected', requestNext: false })).status, 200)
  const updated = (await request('GET', route, 1)).body.data
  for (const snapshot of await Promise.all(liveUpdates)) assert.deepEqual(queue(snapshot), queue(updated))
  const reconnected = await connect(2)
  assert.deepEqual(queue(reconnected.snapshot), queue(updated))
  assert.ok(reconnected.snapshot.room.revision > clients[1].snapshot.room.revision)

  // The caller treats an already committed response as lost and reuses its
  // exact command after all server/socket/database instances have restarted.
  await fixture.restart()
  const replayed = await request('POST', `${route}/queue`, 2, commands[1])
  assert.equal(replayed.status, 200)
  assert.deepEqual(queue(replayed.body.data), queue(updated))
  assert.equal(fixture.db.prepare('SELECT COUNT(*) total FROM ktv_queue_entries WHERE room_id = ?').get(view.room.id).total, 4)
  const recovered = await Promise.all([1, 2, 3].map(connect))
  for (const client of recovered) {
    assert.deepEqual(queue(client.snapshot), queue(updated))
    assert.notEqual(client.snapshot.clock.clockId, clients[0].snapshot.clock.clockId)
  }
  assert.deepEqual(fixture.db.prepare('PRAGMA foreign_key_check').all(), [])
})

test('room socket rejects an untrusted browser origin before authentication', async (t) => {
  const { socketUrl } = await setup(t)
  const edgeOrigin = new WebSocket(socketUrl, { origin: socketUrl.replace('ws:', 'https:').replace('/api/ktv/ws', '') })
  await new Promise((resolve, reject) => { edgeOrigin.once('open', resolve); edgeOrigin.once('error', reject) })
  edgeOrigin.close()
  const ws = new WebSocket(socketUrl, { origin: 'https://untrusted.example' })
  ws.on('error', () => {})
  const status = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('upgrade timeout')), 3000)
    ws.once('unexpected-response', (_, response) => {
      clearTimeout(timeout)
      response.resume()
      resolve(response.statusCode)
    })
  })
  assert.equal(status, 403)
})

test('display pairing is one-use, room-scoped, read-only, and revocable on an open socket', async (t) => {
  const { db, request, socketUrl, origin } = await setup(t)
  const created = await request('POST', '/rooms', 1, { name: 'Paired stage', displayName: 'Host' })
  const { room, invitationCode } = created.body.data
  const issued = await request('POST', `/rooms/${room.id}/pairings`, 1, { scope: 'display' })
  assert.equal(issued.status, 200)
  const code = issued.body.data.code
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/)
  assert.notEqual(db.prepare('SELECT code_hash FROM ktv_pairings WHERE room_id = ?').get(room.id).code_hash, code)
  const redeemed = await request('POST', '/pairings/redeem', 4, { code })
  assert.equal(redeemed.status, 200)
  const { credential, deviceId, memberId, scope } = redeemed.body.data
  assert.equal(scope, 'display')
  assert.equal(memberId, created.body.data.self.id)
  assert.equal(await request('POST', '/pairings/redeem', 4, { code }).then((r) => r.status), 400)
  assert.notEqual(db.prepare('SELECT secret_hash FROM ktv_device_grants WHERE id = ?').get(deviceId).secret_hash, credential)
  const device = { device: credential }
  const view = await request('GET', `/rooms/${room.id}`, device)
  assert.equal(view.status, 200)
  assert.equal(view.body.data.deviceScope, 'display')
  assert.equal(view.body.data.invitationCode, undefined)
  assert.equal(view.body.data.members.length, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM ktv_members WHERE room_id = ?').get(room.id).total, 1)
  assert.equal(await request('GET', `/rooms/${randomUUID()}`, device).then((r) => r.status), 403)
  assert.equal(await request('POST', `/rooms/${room.id}/queue`, device, {
    songId: 1, title: 'No', requestNext: false, commandId: randomUUID(),
  }).then((r) => r.status), 403)
  const ticket = (await request('POST', `/rooms/${room.id}/socket-ticket`, device, {})).body.data.ticket
  const pairedSocket = await openSocket(socketUrl, origin, ticket)
  const first = await pairedSocket.first
  assert.equal(first.deviceScope, 'display')
  assert.equal(first.invitationCode, undefined)
  const changed = nextSnapshot(pairedSocket.ws, data => data.room.locked)
  await request('POST', `/rooms/${room.id}/settings`, 1, { locked: true })
  assert.equal((await changed).room.locked, true)
  const closed = new Promise((resolve) => pairedSocket.ws.once('close', resolve))
  await request('POST', `/rooms/${room.id}/devices/${deviceId}/revoke`, 1, {})
  assert.equal(await closed, 4403)
  assert.equal(await request('GET', `/rooms/${room.id}`, device).then((r) => r.status), 403)
  assert.equal(await request('POST', `/rooms/${room.id}/socket-ticket`, device, {}).then((r) => r.status), 403)
  assert.equal(invitationCode.length, 8)
})

test('controller pairing inherits current membership and is revoked when member leaves', async (t) => {
  const { request } = await setup(t)
  const created = await request('POST', '/rooms', 1, {
    name: 'Paired phone', displayName: 'Host', approvalRequired: false,
  })
  const { room, invitationCode } = created.body.data
  const joined = await request('POST', '/join', 2, { code: invitationCode, displayName: 'Alex' })
  const issued = await request('POST', `/rooms/${room.id}/pairings`, 2, { scope: 'controller' })
  const paired = await request('POST', '/pairings/redeem', 4, { code: issued.body.data.code })
  const device = { device: paired.body.data.credential }
  const added = await request('POST', `/rooms/${room.id}/queue`, device, {
    songId: 1, title: 'From phone', requestNext: true, commandId: randomUUID(),
  })
  assert.equal(added.status, 200)
  assert.equal(added.body.data.deviceScope, 'controller')
  assert.equal(added.body.data.queue[0].requesterMemberId, joined.body.data.self.id)
  assert.equal(await request('POST', `/rooms/${room.id}/settings`, device, { locked: true }).then((r) => r.status), 403)
  const spare = await request('POST', `/rooms/${room.id}/pairings`, 2, { scope: 'display' })
  await request('POST', `/rooms/${room.id}/members/${joined.body.data.self.id}/remove`, 1, {})
  assert.equal(await request('GET', `/rooms/${room.id}`, device).then((r) => r.status), 403)
  assert.equal(await request('POST', '/pairings/redeem', 4, { code: spare.body.data.code }).then((r) => r.status), 400)
})

test('pairing replaces pending codes and limits a membership to three devices', async (t) => {
  const { request } = await setup(t)
  const created = await request('POST', '/rooms', 1, { name: 'Device limit', displayName: 'Host' })
  const roomId = created.body.data.room.id
  const oldCode = (await request('POST', `/rooms/${roomId}/pairings`, 1, { scope: 'display' })).body.data.code
  const firstCode = (await request('POST', `/rooms/${roomId}/pairings`, 1, { scope: 'display' })).body.data.code
  assert.equal(await request('POST', '/pairings/redeem', 4, { code: oldCode }).then((r) => r.status), 400)
  const first = await request('POST', '/pairings/redeem', 4, { code: firstCode })
  assert.equal(first.status, 200)
  const secondCode = (await request('POST', `/rooms/${roomId}/pairings`, 1, { scope: 'controller' })).body.data.code
  assert.equal(await request('POST', '/pairings/redeem', 4, { code: secondCode }).then((r) => r.status), 200)
  assert.equal(await request('POST', `/rooms/${roomId}/pairings`, 1, { scope: 'display' }).then((r) => r.status), 409)
  const devices = await request('GET', `/rooms/${roomId}/devices`, 1)
  assert.equal(devices.body.data.length, 2)
  await request('POST', `/rooms/${roomId}/devices/${first.body.data.deviceId}/revoke`, 1, {})
  assert.equal(await request('POST', `/rooms/${roomId}/pairings`, 1, { scope: 'display' }).then((r) => r.status), 200)
})

test('co-host permissions follow the room matrix and demotion updates paired controllers', async (t) => {
  const { request, socketUrl, origin } = await setup(t)
  const created = (await request('POST', '/rooms', 1, { name: 'Moderated room', displayName: 'Host' })).body.data
  const root = `/rooms/${created.room.id}`
  const members = {}
  for (const actor of [2, 3]) {
    members[actor] = (await request('POST', '/join', actor, { code: created.invitationCode, displayName: `Guest ${actor}` })).body.data.self.id
    await request('POST', `${root}/members/${members[actor]}/approve`, 1)
    const promoted = await request('POST', `${root}/members/${members[actor]}/role`, 1, { role: 'cohost', commandId: randomUUID() })
    assert.equal(promoted.status, 200)
    assert.equal(promoted.body.data.members.find((member) => member.id === members[actor]).role, 'cohost')
  }
  members[4] = (await request('POST', '/join', 4, { code: created.invitationCode, displayName: 'New guest' })).body.data.self.id
  const cohostView = (await request('GET', root, 2)).body.data
  assert.equal(cohostView.self.role, 'cohost')
  assert.equal(cohostView.members.find((member) => member.id === members[4]).admission, 'pending')
  assert.equal(cohostView.invitationCode, undefined)

  const code = (await request('POST', `${root}/pairings`, 2, { scope: 'controller' })).body.data.code
  const device = { device: (await request('POST', '/pairings/redeem', 4, { code })).body.data.credential }
  const displayCode = (await request('POST', `${root}/pairings`, 2, { scope: 'display' })).body.data.code
  const display = { device: (await request('POST', '/pairings/redeem', 4, { code: displayCode })).body.data.credential }
  const displayView = (await request('GET', root, display)).body.data
  assert.equal(displayView.members.length, 3)
  assert.equal(displayView.excludedMembers, undefined)
  assert.equal(displayView.invitationCode, undefined)

  assert.equal(await request('POST', `${root}/members/${members[4]}/approve`, device, { commandId: randomUUID() }).then((r) => r.status), 200)
  const song = (await request('POST', `${root}/queue`, 4, {
    songId: 1, title: 'Guest song', requestNext: true, commandId: randomUUID(),
  })).body.data.queue[0]
  assert.equal(await request('POST', `${root}/queue/${song.id}/approve-next`, device, { commandId: randomUUID() }).then((r) => r.status), 200)
  assert.equal(await request('POST', `${root}/queue/${song.id}/cancel`, 2, { commandId: randomUUID() }).then((r) => r.status), 200)
  assert.equal(await request('POST', `${root}/settings`, device, { locked: true }).then((r) => r.status), 200)
  assert.equal(await request('POST', `${root}/settings`, 4, { locked: false }).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/members/${members[3]}/remove`, 2).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/members/${members[3]}/block`, device, { commandId: randomUUID() }).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/members/${members[4]}/role`, 2, { role: 'cohost', commandId: randomUUID() }).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/members/${members[4]}/transfer-host`, device, { commandId: randomUUID() }).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/invitations/rotate`, 2).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/close`, device).then((r) => r.status), 403)

  const ticket = (await request('POST', `${root}/socket-ticket`, device, {})).body.data.ticket
  const connected = await openSocket(socketUrl, origin, ticket)
  assert.equal((await connected.first).self.role, 'cohost')
  const demoted = nextSnapshot(connected.ws, data => data.self.role === 'member')
  await request('POST', `${root}/members/${members[2]}/role`, 1, { role: 'member', commandId: randomUUID() })
  assert.equal((await demoted).self.role, 'member')
  assert.equal(await request('POST', `${root}/settings`, device, { locked: false }).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/members/${members[4]}/remove`, device).then((r) => r.status), 403)
  connected.ws.close()
})

test('rejection, block, unblock, and restore preserve identity without reviving old grants or tickets', async (t) => {
  const { db, request, socketUrl, origin } = await setup(t)
  const created = (await request('POST', '/rooms', 1, { name: 'Access lifecycle', displayName: 'Host' })).body.data
  const root = `/rooms/${created.room.id}`
  const joined = (await request('POST', '/join', 2, { code: created.invitationCode, displayName: 'Alex' })).body.data
  const memberId = joined.self.id
  const memberPath = `${root}/members/${memberId}`
  const rejectId = randomUUID()
  const rejected = await request('POST', `${memberPath}/reject`, 1, { commandId: rejectId })
  assert.equal(rejected.status, 200)
  assert.equal(rejected.body.data.excludedMembers[0].admission, 'rejected')
  assert.equal((await request('POST', `${memberPath}/reject`, 1, { commandId: rejectId })).body.data.room.revision, rejected.body.data.room.revision)
  const declinedView = (await request('GET', root, 2)).body.data
  assert.equal(declinedView.self.admission, 'rejected')
  assert.equal(declinedView.members, undefined)
  assert.equal(declinedView.queue, undefined)
  assert.equal(declinedView.excludedMembers, undefined)
  assert.equal(await request('POST', `${root}/settings`, 2, { locked: true }).then((r) => r.status), 403)
  await request('POST', `${memberPath}/approve`, 1, { commandId: randomUUID() })
  const originalTicket = (await request('POST', `${root}/socket-ticket`, 2, {})).body.data.ticket
  const code = (await request('POST', `${root}/pairings`, 2, { scope: 'display' })).body.data.code
  const device = { device: (await request('POST', '/pairings/redeem', 4, { code })).body.data.credential }
  const deviceTicket = (await request('POST', `${root}/socket-ticket`, device, {})).body.data.ticket
  const liveTicket = (await request('POST', `${root}/socket-ticket`, device, {})).body.data.ticket
  const connected = await openSocket(socketUrl, origin, liveTicket)
  await connected.first
  const disconnected = new Promise((resolve) => connected.ws.once('close', resolve))
  const blocked = await request('POST', `${memberPath}/block`, 1, { commandId: randomUUID() })
  assert.equal(blocked.status, 200)
  assert.equal(blocked.body.data.excludedMembers[0].blocked, true)
  assert.equal(await disconnected, 4403)
  assert.equal(await request('GET', root, 2).then((r) => r.status), 403)
  assert.equal(await request('GET', root, device).then((r) => r.status), 403)
  assert.equal((await request('POST', '/join', 2, { code: created.invitationCode, displayName: 'Alex' })).body.code, 'ROOM_BLOCKED')
  assert.equal(await request('POST', `${memberPath}/approve`, 1, { commandId: randomUUID() }).then((r) => r.status), 409)
  await request('POST', `${memberPath}/unblock`, 1, { commandId: randomUUID() })
  assert.equal(await request('GET', root, 2).then((r) => r.status), 403)
  const restored = await request('POST', `${memberPath}/approve`, 1, { commandId: randomUUID() })
  assert.equal(restored.status, 200)
  assert.equal((await request('GET', root, 2)).body.data.self.id, memberId)
  assert.equal(await request('GET', root, device).then((r) => r.status), 403)
  for (const ticket of [originalTicket, deviceTicket]) {
    const ws = new WebSocket(socketUrl, { origin })
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
    const denied = new Promise((resolve) => ws.once('close', resolve))
    ws.send(JSON.stringify({ type: 'authenticate', ticket }))
    assert.equal(await denied, 4401)
  }
  assert.equal(db.prepare('SELECT COUNT(*) total FROM ktv_members WHERE room_id = ?').get(created.room.id).total, 2)
})

test('host transfer rolls back failures, updates sockets and paired controls, and survives retries and races', async (t) => {
  const { db, request, socketUrl, origin } = await setup(t)
  const created = (await request('POST', '/rooms', 1, { name: 'Host transfer', displayName: 'Host', approvalRequired: false })).body.data
  const root = `/rooms/${created.room.id}`
  const next = (await request('POST', '/join', 2, { code: created.invitationCode, displayName: 'Next host' })).body.data.self.id
  const third = (await request('POST', '/join', 3, { code: created.invitationCode, displayName: 'Third' })).body.data.self.id
  const code = (await request('POST', `${root}/pairings`, 1, { scope: 'controller' })).body.data.code
  const device = { device: (await request('POST', '/pairings/redeem', 4, { code })).body.data.credential }
  const ticket = (await request('POST', `${root}/socket-ticket`, device, {})).body.data.ticket
  const oldHost = await openSocket(socketUrl, origin, ticket)
  assert.equal((await oldHost.first).invitationCode, created.invitationCode)
  const nextTicket = (await request('POST', `${root}/socket-ticket`, 2, {})).body.data.ticket
  const newHost = await openSocket(socketUrl, origin, nextTicket)
  await newHost.first
  const transferId = randomUUID()
  db.exec(`CREATE TRIGGER fail_transfer BEFORE UPDATE OF role ON ktv_members
    WHEN NEW.role = 'host' BEGIN SELECT RAISE(ABORT, 'test transfer failure'); END`)
  assert.equal(await request('POST', `${root}/members/${next}/transfer-host`, device, { commandId: transferId }).then((r) => r.status), 500)
  assert.equal(db.prepare("SELECT id FROM ktv_members WHERE room_id = ? AND role = 'host'").get(created.room.id).id, created.self.id)
  assert.equal(db.prepare('SELECT 1 FROM ktv_command_receipts WHERE command_id = ?').get(transferId), undefined)
  db.exec('DROP TRIGGER fail_transfer')
  const oldUpdate = nextSnapshot(oldHost.ws, data => data.self.role === 'member')
  const newUpdate = nextSnapshot(newHost.ws, data => data.self.role === 'host')
  const transferred = await request('POST', `${root}/members/${next}/transfer-host`, device, { commandId: transferId })
  assert.equal(transferred.status, 200)
  assert.equal(transferred.body.data.self.role, 'member')
  assert.equal(transferred.body.data.invitationCode, undefined)
  assert.equal((await oldUpdate).self.role, 'member')
  assert.equal((await newUpdate).invitationCode, created.invitationCode)
  assert.equal(await request('POST', `${root}/settings`, device, { locked: true }).then((r) => r.status), 403)
  assert.equal(await request('POST', `${root}/close`, 1).then((r) => r.status), 403)
  const replay = await request('POST', `${root}/members/${next}/transfer-host`, 1, { commandId: transferId })
  assert.equal(replay.status, 200)
  assert.equal(replay.body.data.room.revision, transferred.body.data.room.revision)
  assert.equal(await request('POST', `${root}/members/${third}/transfer-host`, 1, { commandId: transferId }).then((r) => r.status), 409)
  const raced = await Promise.all([created.self.id, third].map((memberId) =>
    request('POST', `${root}/members/${memberId}/transfer-host`, 2, { commandId: randomUUID() })))
  assert.deepEqual(raced.map((result) => result.status).sort(), [200, 403])
  assert.equal(db.prepare("SELECT COUNT(*) total FROM ktv_members WHERE room_id = ? AND role = 'host'").get(created.room.id).total, 1)
  oldHost.ws.close()
  newHost.ws.close()
})

test('existing membership tables migrate additively and retain co-host and block metadata on restart', async (t) => {
  const { db, request } = await setup(t)
  const created = (await request('POST', '/rooms', 1, { name: 'Migration', displayName: 'Host', approvalRequired: false })).body.data
  const root = `/rooms/${created.room.id}`
  const member = (await request('POST', '/join', 2, { code: created.invitationCode, displayName: 'Alex' })).body.data.self.id
  const other = (await request('POST', '/join', 3, { code: created.invitationCode, displayName: 'Sam' })).body.data.self.id
  const queued = (await request('POST', `${root}/queue`, 2, { songId: 1, title: 'Legacy self request',
    requestNext: false, commandId: randomUUID() })).body.data.queue[0]
  // Recreate the pre-moderation table shape while preserving existing rows/FKs.
  db.exec('ALTER TABLE ktv_members DROP COLUMN cohost_at; ALTER TABLE ktv_members DROP COLUMN blocked_at; ALTER TABLE ktv_queue_entries DROP COLUMN accepted_at')
  const dataDir = path.dirname(db.prepare('PRAGMA database_list').all()[0].file)
  let reopened = initDb(dataDir)
  reopened.close()
  assert.equal((await request('GET', root, 2)).body.data.self.id, member)
  assert.equal((await request('GET', root, 2)).body.data.queue.find(entry => entry.id === queued.id).singerAccepted, true)
  await request('POST', `${root}/members/${member}/role`, 1, { role: 'cohost', commandId: randomUUID() })
  await request('POST', `${root}/members/${other}/block`, 1, { commandId: randomUUID() })
  reopened = initDb(dataDir)
  t.after(() => reopened.close())
  assert.ok(reopened.prepare('SELECT cohost_at FROM ktv_members WHERE id = ?').get(member).cohost_at)
  assert.ok(reopened.prepare('SELECT blocked_at FROM ktv_members WHERE id = ?').get(other).blocked_at)
  assert.equal(reopened.prepare('PRAGMA foreign_key_check').all().length, 0)
  assert.equal(reopened.prepare('SELECT COUNT(*) total FROM users').get().total, 4)
})

test('room clock probes recheck admission, use a monotonic epoch, validate protocol and bound traffic', async (t) => {
  const { request, socketUrl, origin } = await setup(t)
  const created = (await request('POST', '/rooms', 1, { name: 'Clock room', displayName: 'Host' })).body.data
  const root = `/rooms/${created.room.id}`
  const member = (await request('POST', '/join', 2, { code: created.invitationCode, displayName: 'Singer' })).body.data.self.id
  const host = await openSocket(socketUrl, origin, (await request('POST', `${root}/socket-ticket`, 1, {})).body.data.ticket)
  await host.first
  const pending = await openSocket(socketUrl, origin, (await request('POST', `${root}/socket-ticket`, 2, {})).body.data.ticket)
  await pending.first
  const probe = { protocolVersion: 1, type: 'clock.probe', probeId: randomUUID(), clientSendMs: 123 }
  const waitingError = nextPacket(pending.ws, 'error')
  pending.ws.send(JSON.stringify(probe))
  assert.equal((await waitingError).code, 'NOT_ADMITTED')
  const replyPromise = nextPacket(host.ws, 'clock.reply')
  host.ws.send(JSON.stringify(probe))
  const reply = await replyPromise
  assert.equal(reply.probeId, probe.probeId)
  assert.equal(reply.clientSendMs, 123)
  assert.equal(reply.clockId, created.clock.clockId)
  assert.ok(reply.serverReceiveMs >= 0 && reply.serverSendMs >= reply.serverReceiveMs)
  assert.ok(reply.serverSendMs < Date.now() / 1000)
  assert.equal(reply.data, undefined)
  const versionError = nextPacket(host.ws, 'error')
  host.ws.send(JSON.stringify({ ...probe, protocolVersion: 2 }))
  assert.equal((await versionError).code, 'PROTOCOL_UNSUPPORTED')
  const admitted = nextSnapshot(pending.ws, data => data.self.admission === 'admitted')
  await request('POST', `${root}/members/${member}/approve`, 1)
  await admitted
  const admittedProbe = nextPacket(pending.ws, 'clock.reply')
  pending.ws.send(JSON.stringify({ ...probe, probeId: randomUUID() }))
  assert.equal((await admittedProbe).clockId, reply.clockId)
  const limited = new Promise((resolve) => host.ws.once('close', resolve))
  for (let i = 0; i < 20; i++) host.ws.send(JSON.stringify({ ...probe, probeId: randomUUID() }))
  assert.equal(await limited, 4429)
  pending.ws.close()
})

test('nominated singers accept songs and readiness rejects stale turns, wrong actors, and stale revisions', async (t) => {
  const { request } = await setup(t)
  const created = (await request('POST', '/rooms', 1, { name: 'Singer readiness', displayName: 'Host', approvalRequired: false })).body.data
  const root = `/rooms/${created.room.id}`
  const singer = (await request('POST', '/join', 2, { code: created.invitationCode, displayName: 'Singer' })).body.data.self.id
  await request('POST', '/join', 3, { code: created.invitationCode, displayName: 'Other singer' })
  const nominated = (await request('POST', `${root}/queue`, 1, {
    songId: 1, title: 'Nominated song', requestNext: false, singerMemberId: singer, commandId: randomUUID(),
  })).body.data.queue[0]
  assert.equal(nominated.singerAccepted, false)
  const own = (await request('POST', `${root}/queue`, 3, { songId: 2, title: 'Own song', requestNext: false, commandId: randomUUID() })).body.data
  assert.equal(own.queue[0].songId, 2)
  async function offer(entryId, actor = 1, revision) {
    const view = (await request('GET', root, actor)).body.data
    return request('POST', `${root}/readiness/offer`, actor, {
      entryId, commandId: randomUUID(), clockId: view.clock.clockId, baseRevision: revision ?? view.room.revision,
    })
  }
  assert.equal((await offer(nominated.id)).body.code, 'SINGER_NOT_ACCEPTED')
  assert.equal(await request('POST', `${root}/queue/${nominated.id}/accept`, 1, { commandId: randomUUID() }).then(r => r.status), 403)
  assert.equal(await request('POST', `${root}/queue/${nominated.id}/accept`, 3, { commandId: randomUUID() }).then(r => r.status), 403)
  const acceptId = randomUUID()
  const accepted = await request('POST', `${root}/queue/${nominated.id}/accept`, 2, { commandId: acceptId })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.data.queue.find(entry => entry.id === nominated.id).singerAccepted, true)
  assert.equal((await request('POST', `${root}/queue/${nominated.id}/accept`, 2, { commandId: acceptId })).body.data.room.revision, accepted.body.data.room.revision)
  assert.equal((await offer(nominated.id, 3)).status, 403)
  assert.equal((await offer(nominated.id, 1, 1)).body.code, 'REVISION_CONFLICT')
  const offered = (await offer(nominated.id)).body.data
  assert.equal(offered.readiness.state, 'awaiting-singer')
  assert.equal(offered.queue[0].id, nominated.id)
  const confirm = { ...offered.readiness, commandId: randomUUID(), baseRevision: offered.room.revision, ready: true }
  assert.equal(await request('POST', `${root}/readiness/respond`, 1, confirm).then(r => r.status), 403)
  const ready = await request('POST', `${root}/readiness/respond`, 2, confirm)
  assert.equal(ready.status, 200)
  assert.equal(ready.body.data.readiness.state, 'ready')
  assert.equal((await request('POST', `${root}/readiness/respond`, 2, confirm)).body.data.room.revision, ready.body.data.room.revision)
  const otherEntry = ready.body.data.queue.find(entry => entry.songId === 2).id
  const replaced = (await offer(otherEntry)).body.data
  assert.ok(replaced.readiness.generation > offered.readiness.generation)
  assert.notEqual(replaced.readiness.performanceId, offered.readiness.performanceId)
  const stale = await request('POST', `${root}/readiness/respond`, 2, { ...confirm, commandId: randomUUID() })
  assert.equal(stale.body.code, 'STALE_GENERATION')
  await request('POST', `${root}/queue/${otherEntry}/cancel`, 3, { commandId: randomUUID() })
  assert.equal((await request('GET', root, 1)).body.data.readiness.state, 'idle')
  const reoffered = (await offer(nominated.id)).body.data
  await request('POST', `${root}/members/${singer}/remove`, 1)
  const removed = (await request('GET', root, 1)).body.data
  assert.equal(removed.readiness.state, 'idle')
  assert.ok(removed.readiness.generation > reoffered.readiness.generation)
  assert.equal(removed.queue[0].state, 'held')
})

test('paired controllers can confirm their singer and displays stay read-only; declining ends only that turn', async (t) => {
  const { request } = await setup(t)
  const created = (await request('POST', '/rooms', 1, { name: 'Ready devices', displayName: 'Host', approvalRequired: false })).body.data
  const root = `/rooms/${created.room.id}`
  const singer = (await request('POST', '/join', 2, { code: created.invitationCode, displayName: 'Singer' })).body.data.self.id
  const devices = {}
  for (const scope of ['controller', 'display']) {
    const code = (await request('POST', `${root}/pairings`, 2, { scope })).body.data.code
    devices[scope] = { device: (await request('POST', '/pairings/redeem', 4, { code })).body.data.credential }
  }
  const queued = (await request('POST', `${root}/queue`, 2, { songId: 1, title: 'Song', requestNext: false, commandId: randomUUID() })).body.data
  const offered = (await request('POST', `${root}/readiness/offer`, 1, { entryId: queued.queue[0].id,
    clockId: queued.clock.clockId, baseRevision: queued.room.revision, commandId: randomUUID() })).body.data
  const payload = { ...offered.readiness, baseRevision: offered.room.revision, commandId: randomUUID(), ready: true }
  assert.equal(await request('POST', `${root}/readiness/respond`, devices.display, payload).then(r => r.status), 403)
  const confirmed = await request('POST', `${root}/readiness/respond`, devices.controller, payload)
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.body.data.readiness.singerMemberId, singer)
  const cancelled = (await request('POST', `${root}/readiness/cancel`, 1, { ...confirmed.body.data.readiness,
    baseRevision: confirmed.body.data.room.revision, commandId: randomUUID() })).body.data
  assert.equal(cancelled.readiness.state, 'idle')
  assert.equal(cancelled.queue.length, 1)
  const reoffered = (await request('POST', `${root}/readiness/offer`, 1, { entryId: cancelled.queue[0].id,
    clockId: cancelled.clock.clockId, baseRevision: cancelled.room.revision, commandId: randomUUID() })).body.data
  const declined = (await request('POST', `${root}/readiness/respond`, devices.controller, { ...reoffered.readiness,
    baseRevision: reoffered.room.revision, commandId: randomUUID(), ready: false })).body.data
  assert.equal(declined.readiness.state, 'idle')
  assert.equal(declined.queue.length, 0)
})

test('a fresh service clock requires singer confirmation again and invalidates pre-restart readiness', async (t) => {
  const { db, request } = await setup(t)
  const created = (await request('POST', '/rooms', 1, { name: 'Restart readiness', displayName: 'Host', approvalRequired: false })).body.data
  const root = `/rooms/${created.room.id}`
  await request('POST', '/join', 2, { code: created.invitationCode, displayName: 'Singer' })
  const queued = (await request('POST', `${root}/queue`, 2, { songId: 1, title: 'Restart song', requestNext: false, commandId: randomUUID() })).body.data
  const offered = (await request('POST', `${root}/readiness/offer`, 1, { entryId: queued.queue[0].id,
    commandId: randomUUID(), clockId: queued.clock.clockId, baseRevision: queued.room.revision })).body.data
  const oldCommand = { ...offered.readiness, commandId: randomUUID(), ready: true, baseRevision: offered.room.revision }
  const ready = (await request('POST', `${root}/readiness/respond`, 2, oldCommand)).body.data
  const app = express()
  app.use(express.json())
  const realtime = registerKtvRoutes(app, { db, secret: 'test-only-secret', isKaraokeSong: () => true,
    authMiddleware: (req, _res, next) => { req.auth = { sub: Number(req.headers['x-test-user']) }; next() } })
  const server = app.listen(0, '127.0.0.1')
  realtime.attach(server)
  await new Promise(resolve => server.once('listening', resolve))
  t.after(async () => { realtime.close(); await new Promise(resolve => server.close(resolve)) })
  const url = `http://127.0.0.1:${server.address().port}/api/ktv${root}`
  const recovered = (await fetch(url, { headers: { 'X-Test-User': '2' } }).then(response => response.json())).data
  assert.notEqual(recovered.clock.clockId, ready.clock.clockId)
  assert.equal(recovered.readiness.state, 'awaiting-singer')
  assert.ok(recovered.readiness.generation > ready.readiness.generation)
  assert.notEqual(recovered.readiness.performanceId, ready.readiness.performanceId)
  assert.ok(recovered.room.revision > ready.room.revision)
  const stale = await fetch(url + '/readiness/respond', { method: 'POST', headers: { 'X-Test-User': '2', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...oldCommand, commandId: randomUUID() }) })
  assert.equal((await stale.json()).code, 'STALE_CLOCK')
  const replay = await fetch(url + '/readiness/respond', { method: 'POST', headers: { 'X-Test-User': '2', 'Content-Type': 'application/json' },
    body: JSON.stringify(oldCommand) })
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).data.readiness.state, 'awaiting-singer')
  const fresh = await fetch(url + '/readiness/respond', { method: 'POST', headers: { 'X-Test-User': '2', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...recovered.readiness, baseRevision: recovered.room.revision, ready: true, commandId: randomUUID() }) })
  assert.equal(fresh.status, 200)
  assert.equal((await fresh.json()).data.readiness.state, 'ready')
})

test('nominations respect the recipient cap and cannot assign pending or unknown singers', async (t) => {
  const { request } = await setup(t)
  const created = (await request('POST', '/rooms', 1, { name: 'Nominations', displayName: 'Host' })).body.data
  const root = `/rooms/${created.room.id}`
  const singer = (await request('POST', '/join', 2, { code: created.invitationCode, displayName: 'Singer' })).body.data.self.id
  const pending = (await request('POST', '/join', 3, { code: created.invitationCode, displayName: 'Pending' })).body.data.self.id
  await request('POST', `${root}/members/${singer}/approve`, 1)
  async function nominate(memberId) {
    return request('POST', `${root}/queue`, 1, { songId: 1, title: 'Nomination', requestNext: false,
      singerMemberId: memberId, commandId: randomUUID() })
  }
  assert.equal((await nominate(pending)).body.code, 'INVALID_SINGER')
  assert.equal((await nominate(randomUUID())).body.code, 'INVALID_SINGER')
  let first
  for (let i = 0; i < 3; i++) {
    const added = await nominate(singer)
    assert.equal(added.status, 200)
    first ??= added.body.data.queue[0].id
  }
  assert.equal((await nominate(singer)).body.code, 'SINGER_QUEUE_FULL')
  assert.equal(await request('POST', `${root}/queue/${first}/decline`, 2, { commandId: randomUUID() }).then(r => r.status), 200)
  assert.equal((await nominate(singer)).status, 200)
})

test('automatic playback defaults on, is host controlled, and persists with idempotent settings', async t => {
  const f = await setup(t)
  const created = await f.request('POST', '/rooms', 1, { name: 'Automatic default', displayName: 'Host', approvalRequired: false })
  const view = created.body.data, route = `/rooms/${view.room.id}`
  assert.equal(view.room.automaticPlayback, true)
  assert.equal(view.automation.state, 'waiting-singer')
  const joined = await f.request('POST', '/join', 2, { code: view.invitationCode, displayName: 'Singer' })
  assert.equal(joined.body.data.room.automaticPlayback, true)
  let denied = await f.request('POST', route + '/settings', 2, { automaticPlayback: false })
  assert.equal(denied.status, 403)
  assert.equal((await f.request('POST', route + `/members/${joined.body.data.self.id}/role`, 1, { commandId: randomUUID(), role: 'cohost' })).status, 200)
  denied = await f.request('POST', route + '/settings', 2, { automaticPlayback: false })
  assert.equal(denied.status, 403)
  const commandId = randomUUID(), payload = { commandId, automaticPlayback: false }
  const first = await f.request('POST', route + '/settings', 1, payload)
  assert.equal(first.status, 200); assert.equal(first.body.data.room.automaticPlayback, false)
  assert.equal(first.body.data.automation.state, 'off')
  const duplicate = await f.request('POST', route + '/settings', 1, payload)
  assert.equal(duplicate.status, 200); assert.equal(duplicate.body.data.room.revision, first.body.data.room.revision)
  const conflict = await f.request('POST', route + '/settings', 1, { commandId, automaticPlayback: true })
  assert.equal(conflict.status, 409)
  await f.restart()
  assert.equal((await f.request('GET', route, 1)).body.data.room.automaticPlayback, false)
  const invalid = await f.request('POST', route + '/settings', 1, { automaticPlayback: 'false' })
  assert.equal(invalid.status, 400)
})
