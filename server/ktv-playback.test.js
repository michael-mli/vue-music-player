import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { initDb } from './db.js'
import { createKtvPlayback } from './ktv-playback.js'
import { createKtvMediaGrants } from './ktv-media-grants.js'
import { createKtvAssets } from './ktv-assets.js'
import { orderQueue } from './ktv-queue.js'
import { timelinePosition, effectiveTimeline } from './ktv-timeline.js'

function fixture(t, settings = {}) {
  const directory = fsSync.mkdtempSync(path.join(os.tmpdir(), 'ktv-playback-'))
  const db = initDb(directory)
  const roomId = randomUUID(), memberId = randomUUID(), entryId = randomUUID(), performanceId = randomUUID()
  let nowMs = 0
  const clock = { id: randomUUID(), nowMs: () => nowMs }
  db.prepare("INSERT INTO users (username, kind, created_at) VALUES ('host', 'guest', ?)").run(new Date().toISOString())
  db.prepare('INSERT INTO ktv_rooms (id, name, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(roomId, 'Room', new Date().toISOString(), new Date(Date.now() + 60000).toISOString())
  db.prepare(`INSERT INTO ktv_members (id, room_id, user_id, display_name, role, admission, joined_at, updated_at)
    VALUES (?, ?, 1, 'Host', 'host', 'admitted', ?, ?)`)
    .run(memberId, roomId, new Date().toISOString(), new Date().toISOString())
  db.prepare(`INSERT INTO ktv_queue_entries (id, room_id, song_id, title, requester_member_id, singer_member_id, accepted_at, created_at, updated_at)
    VALUES (?, ?, 1, 'Song', ?, ?, ?, ?, ?)`)
    .run(entryId, roomId, memberId, memberId, new Date().toISOString(), new Date().toISOString(), new Date().toISOString())
  db.prepare(`INSERT INTO ktv_readiness (room_id, entry_id, performance_id, generation, clock_id, state, updated_at)
    VALUES (?, ?, ?, 1, ?, 'ready', ?)`)
    .run(roomId, entryId, performanceId, clock.id, new Date().toISOString())
  const transaction = (database, work) => {
    database.exec('BEGIN IMMEDIATE')
    try { const result = work(); database.exec('COMMIT'); return result }
    catch (error) { database.exec('ROLLBACK'); throw error }
  }
  const events = [], packets = []
  const options = { db, clock, transaction, bump: (database, room) => database.prepare('UPDATE ktv_rooms SET revision = revision + 1 WHERE id = ?').run(room),
    event: (...args) => events.push(args), broadcast: () => {}, ...settings }
  let service = createKtvPlayback(options)
  const ws = { clientDeviceId: randomUUID(), roomId, principal: {}, readyState: 1, send: raw => packets.push(JSON.parse(raw)) }
  const authorized = { self: { id: memberId, admission: 'admitted' } }
  function message(body) { return service.deviceMessage(ws, { protocolVersion: 1, ...body }, authorized) }
  function status() { return message({ type: 'device.status', purpose: 'stage', label: 'Stage', audioEnabled: true, clockHealthy: true }) }
  const assets = { songId: 1, version: 'fixture-version', durationMs: 60_000,
    instrumental: { durationMs: 60_000 }, original: { durationMs: 60_000 }, lyrics: { mode: 'missing', text: null } }
  const human = { state: 'ready', entryId, performanceId }
  function ready(generation = service.snapshot(roomId).generation) {
    message({ type: 'device.ready', clockId: clock.id, performanceId, generation, assetVersion: assets.version, durationMs: assets.durationMs })
  }
  function prepare() {
    status(); transaction(db, () => service.assign(roomId, ws.clientDeviceId))
    transaction(db, () => service.prepare(roomId, human, assets)); ready()
  }
  function member(name, cohostAt = null) {
    const id = randomUUID(), now = new Date().toISOString()
    const userId = db.prepare("INSERT INTO users (username, kind, created_at) VALUES (?, 'guest', ?)").run(name, now).lastInsertRowid
    db.prepare(`INSERT INTO ktv_members (id, room_id, user_id, display_name, role, cohost_at, admission, joined_at, updated_at)
      VALUES (?, ?, ?, ?, 'member', ?, 'admitted', ?, ?)`).run(id, roomId, userId, name, cohostAt, now, now)
    return id
  }
  function enqueue(singerId, { accepted = true, state = 'queued', priority = false } = {}) {
    const id = randomUUID(), now = new Date().toISOString()
    db.prepare(`INSERT INTO ktv_queue_entries (id, room_id, song_id, title, requester_member_id, singer_member_id,
      accepted_at, state, priority_approved, created_at, updated_at) VALUES (?, ?, 1, 'Song', ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, roomId, memberId, singerId, accepted ? now : null, state, Number(priority), now, now)
    return id
  }
  function device(singerId = memberId, purpose = 'guide', scope = 'controller') {
    const socket = { ...ws, clientDeviceId: randomUUID() }
    const access = { self: { id: singerId, admission: 'admitted' }, deviceScope: scope }
    const send = body => service.deviceMessage(socket, { protocolVersion: 1, ...body }, access)
    const status = (audioEnabled = true, clockHealthy = true) => send({ type: 'device.status', purpose,
      label: 'Fixture device', audioEnabled, clockHealthy })
    status()
    return { ws: socket, send, status, ready: (generation = service.snapshot(roomId).generation) => send({ type: 'device.ready',
      clockId: clock.id, performanceId: service.snapshot(roomId).performanceId, generation, assetVersion: assets.version,
      durationMs: purpose === 'guide' ? assets.original.durationMs : assets.durationMs }) }
  }
  t.after(() => { service.close(); db.close(); fsSync.rmSync(directory, { recursive: true, force: true }) })
  return { db, roomId, memberId, entryId, performanceId, clock, ws, assets, packets, events, transaction,
    get service() { return service }, status, message, ready, prepare, member, enqueue, device,
    time: value => { nowMs = value }, advance: amount => { nowMs += amount },
    restart: (updated = {}) => { service.close(); clock.id = randomUUID(); Object.assign(options, updated); service = createKtvPlayback(options); return service } }
}

test('scheduled timeline holds before its boundary and preserves the old segment before a pause/seek', () => {
  const timeline = { state: 'scheduled', positionMs: 1000, anchorServerMs: 2000, durationMs: 10000,
    generation: 4, pendingTransition: { state: 'paused', positionMs: 4000, anchorServerMs: 5000, effectiveServerMs: 5000, generation: 5 } }
  assert.equal(timelinePosition(timeline, 1000), 1000)
  assert.equal(timelinePosition(timeline, 4000), 3000)
  assert.equal(timelinePosition(timeline, 7000), 4000)
  assert.equal(effectiveTimeline(timeline, 4999).generation, 4)
  assert.equal(effectiveTimeline(timeline, 5000).generation, 5)
  timeline.pendingTransition = { state: 'playing', positionMs: 7000, anchorServerMs: 5000, effectiveServerMs: 5000, generation: 5 }
  assert.equal(timelinePosition(timeline, 5500), 7500)
  assert.equal(timelinePosition(timeline, 12000), 10000)
})

test('stage readiness and startup silence are required; leases renew only for the current live generation', t => {
  const f = fixture(t)
  f.prepare()
  assert.throws(() => f.service.start(f.roomId), error => error.code === 'OUTPUT_STOPPING')
  f.time(9000); f.status(); f.service.start(f.roomId); f.service.sweep()
  const start = f.service.snapshot(f.roomId)
  assert.equal(start.state, 'scheduled')
  assert.equal(start.anchorServerMs, 11000)
  assert.equal(start.lease.deviceId, f.ws.clientDeviceId)
  const heartbeat = { type: 'device.heartbeat', clockId: f.clock.id, leaseId: start.lease.id,
    performanceId: f.performanceId, generation: start.generation }
  f.advance(2000)
  const renewal = f.message(heartbeat)
  assert.equal(renewal.type, 'lease')
  assert.ok(renewal.lease.sequence > start.lease.sequence)
  const deadline = renewal.lease.expiresServerMs
  f.message({ ...heartbeat, generation: heartbeat.generation - 1 })
  assert.equal(f.service.snapshot(f.roomId).lease.expiresServerMs, deadline)
  f.service.sweep()
  assert.equal(f.service.snapshot(f.roomId).state, 'playing')
  f.time(deadline + 1); f.service.sweep()
  assert.equal(f.service.snapshot(f.roomId).state, 'recovering')
  assert.equal(f.service.snapshot(f.roomId).positionMs, 8001)
  assert.notEqual(f.service.snapshot(f.roomId).generation, heartbeat.generation)
  assert.notEqual(f.message(heartbeat).type, 'lease')
})

test('configured preparation/start/lease/transition timing is enforced at exact boundaries', t => {
  const f = fixture(t, { timing: { playbackLeadMs: 1500, onlineLeadMs: 4000, outputLeaseMs: 6000,
    outputMarginMs: 1000, prepareTimeoutMs: 12000 } })
  f.time(10000); f.prepare(); f.service.start(f.roomId); f.service.sweep()
  let view = f.service.snapshot(f.roomId)
  assert.equal(view.anchorServerMs, 11500)
  assert.equal(view.lease.expiresServerMs, 16000); assert.equal(view.lease.safeAfterServerMs, 17000)
  f.time(11500); f.message({ type: 'device.heartbeat' }); f.service.sweep()
  f.service.transition(f.roomId, 'pause'); f.service.sweep()
  view = f.service.snapshot(f.roomId)
  assert.equal(view.pendingTransition.effectiveServerMs, 13000)
  assert.equal(view.lease.expiresServerMs, 13000); assert.equal(view.lease.safeAfterServerMs, 14000)
  f.ready(view.pendingTransition.generation)
  f.time(12999); f.service.sweep(); assert.equal(f.service.snapshot(f.roomId).state, 'playing')
  f.time(13000); f.service.sweep(); assert.equal(f.service.snapshot(f.roomId).state, 'paused')
})

test('configured preparation timeout recovers at its deadline and online lead changes only the scheduled anchor', t => {
  const f = fixture(t, { timing: { prepareTimeoutMs: 12000, onlineLeadMs: 5000 } })
  f.time(10000); f.prepare()
  assert.equal(f.service.snapshot(f.roomId).prepareDeadlineMs, 22000)
  f.time(21999); f.status(); f.service.sweep(); assert.equal(f.service.snapshot(f.roomId).state, 'preparing')
  f.time(22000); f.service.sweep(); assert.equal(f.service.snapshot(f.roomId).recoveryReason, 'playback.prepare_timeout')
  f.prepare()
  createKtvMediaGrants({ db: f.db, clock: f.clock, getPlayback: id => f.service.snapshot(id), getDevices: () => [],
    apiKey: 'timing-test', apiSecret: 'timing-test-only-secret-more-than-thirty-two-bytes' })
  f.db.prepare("UPDATE ktv_rooms SET performance_mode = 'online' WHERE id = ?").run(f.roomId)
  f.service.media = { grants: { publisherReady: () => true } }
  f.message({ type: 'device.status', purpose: 'stage', label: 'Singer', audioEnabled: true, clockHealthy: true, mediaProtocol: 1 })
  f.service.start(f.roomId); f.service.sweep()
  assert.equal(f.service.snapshot(f.roomId).anchorServerMs, 27000)
})

test('decreasing lease settings and repeated restarts cannot shorten an older output silence boundary', t => {
  const f = fixture(t, { timing: { outputLeaseMs: 15000, outputMarginMs: 2000 } })
  f.time(20000); f.prepare(); f.service.start(f.roomId); f.service.sweep()
  assert.equal(f.service.snapshot(f.roomId).lease.safeAfterServerMs, 37000)
  f.time(0); f.restart({ timing: { outputLeaseMs: 8000, outputMarginMs: 500 } })
  assert.equal(f.service.snapshot(f.roomId).restartSafeAfterMs, 17000)
  f.time(0); f.restart({ timing: { outputLeaseMs: 6000, onlineLeadMs: 4000 } })
  assert.equal(f.service.snapshot(f.roomId).restartSafeAfterMs, 17000)
  f.prepare(); f.time(16999); f.status()
  assert.throws(() => f.service.start(f.roomId), error => error.code === 'OUTPUT_STOPPING')
  f.time(17000); f.status(); f.service.start(f.roomId); f.service.sweep()
  assert.equal(f.service.snapshot(f.roomId).lease.expiresServerMs, 23000)
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
})

test('pause and seek preserve effective boundaries and reject obsolete completion', t => {
  const f = fixture(t)
  f.prepare(); f.time(9000); f.status(); f.service.start(f.roomId); f.service.sweep()
  f.time(11000); f.message({ type: 'device.heartbeat' }); f.service.sweep()
  f.service.transition(f.roomId, 'seek', 20000)
  let view = f.service.snapshot(f.roomId)
  assert.equal(timelinePosition(view, 12000), 1000)
  assert.equal(timelinePosition(view, 13500), 20500)
  f.ready(view.pendingTransition.generation)
  f.service.sweep()
  assert.equal(f.service.snapshot(f.roomId).lease.nextGeneration, view.pendingTransition.generation)
  f.time(13000); f.service.sweep()
  view = f.service.snapshot(f.roomId)
  assert.equal(view.state, 'playing'); assert.equal(view.positionMs, 20000)
  assert.equal(view.lease.generation, view.generation)
  assert.throws(() => f.message({ type: 'playback.ended', clockId: f.clock.id, leaseId: view.lease.id,
    performanceId: f.performanceId, generation: view.generation, entryId: f.entryId }), error => error.code === 'EARLY_COMPLETION')
  f.service.transition(f.roomId, 'pause')
  f.service.sweep()
  view = f.service.snapshot(f.roomId)
  assert.equal(view.pendingTransition.effectiveServerMs, 15000)
  assert.equal(view.lease.expiresServerMs, 15000)
  f.time(15000); f.service.sweep()
  assert.equal(f.service.snapshot(f.roomId).state, 'paused')
  assert.equal(f.service.snapshot(f.roomId).positionMs, 22000)
  f.time(15501); f.status(); f.ready(); f.service.start(f.roomId); f.service.sweep()
  const resumed = f.service.snapshot(f.roomId)
  assert.equal(resumed.state, 'scheduled')
  assert.ok(resumed.lease.expiresServerMs > 15501)
})

test('replacement cannot overlap a disconnected stage lease and requires new decoding readiness', t => {
  const f = fixture(t)
  f.prepare(); f.time(9000); f.status(); f.service.start(f.roomId); f.service.sweep()
  const old = f.service.snapshot(f.roomId)
  f.time(10000); f.service.disconnected(f.ws)
  assert.equal(f.service.snapshot(f.roomId).state, 'recovering')
  const second = { ...f.ws, clientDeviceId: randomUUID() }
  const authorized = { self: { id: f.memberId, admission: 'admitted' } }
  f.service.deviceMessage(second, { type: 'device.status', purpose: 'stage', label: 'Replacement', audioEnabled: true, clockHealthy: true }, authorized)
  f.service.assign(f.roomId, second.clientDeviceId)
  const next = f.service.snapshot(f.roomId)
  assert.throws(() => f.service.start(f.roomId), error => error.code === 'DEVICE_NOT_READY')
  const ready = { type: 'device.ready', clockId: f.clock.id, performanceId: f.performanceId, generation: next.generation,
    assetVersion: f.assets.version, durationMs: f.assets.durationMs }
  f.service.deviceMessage(second, ready, authorized)
  assert.throws(() => f.service.start(f.roomId), error => error.code === 'OUTPUT_STOPPING')
  f.time(old.lease.safeAfterServerMs + 1)
  f.service.deviceMessage(second, { type: 'device.heartbeat' }, authorized)
  f.service.start(f.roomId); f.service.sweep()
  assert.equal(f.service.snapshot(f.roomId).lease.deviceId, second.clientDeviceId)
  assert.notEqual(f.service.snapshot(f.roomId).lease.id, old.lease.id)
})

test('completion applies once to a unique queue entry and durable history survives cancel/re-add fairness', t => {
  const f = fixture(t)
  f.prepare(); f.time(9000); f.status(); f.service.start(f.roomId); f.service.sweep()
  f.time(71000)
  // Preserve a healthy lease at the end, without extrapolating a disconnected
  // device across the entire song.
  const lease = f.service.snapshot(f.roomId).lease
  f.service.finish(f.roomId, 'finished')
  assert.equal(f.service.snapshot(f.roomId).state, 'idle')
  assert.equal(f.db.prepare('SELECT COUNT(*) total FROM ktv_turn_history').get().total, 1)
  assert.equal(f.db.prepare('SELECT outcome FROM ktv_turn_history').get().outcome, 'finished')
  assert.throws(() => f.message({ type: 'playback.ended', clockId: f.clock.id, leaseId: lease.id,
    performanceId: f.performanceId, generation: lease.generation, entryId: f.entryId }), error => error.code === 'STALE_GENERATION')
  const entries = [{ id: 'repeat', singerMemberId: f.memberId, state: 'queued' },
    { id: 'new-singer', singerMemberId: 'other', state: 'queued' },
    { id: 'priority', singerMemberId: f.memberId, state: 'queued', priorityApproved: true }]
  assert.deepEqual(orderQueue(entries, [f.memberId]).map(entry => entry.id), ['priority', 'new-singer', 'repeat'])
})

test('restart restores only the durable checkpoint, drops designation and creates a new clock generation', t => {
  const f = fixture(t)
  f.prepare(); f.time(9000); f.status(); f.service.start(f.roomId); f.service.sweep()
  const before = f.service.snapshot(f.roomId)
  f.db.prepare('UPDATE ktv_playback SET checkpoint_ms = 1234 WHERE room_id = ?').run(f.roomId)
  f.restart()
  const after = f.service.snapshot(f.roomId)
  assert.equal(after.state, 'paused'); assert.equal(after.positionMs, 1234)
  assert.ok(after.generation > before.generation); assert.notEqual(after.clockId, before.clockId)
  assert.equal(after.stageDeviceId, null); assert.equal(after.lease, null)
})

test('required guide gates start, validates its own duration, and interrupted guidance preserves the turn', t => {
  const f = fixture(t)
  f.assets.original.durationMs = 61_700
  f.prepare()
  const phone = f.device()
  f.service.guide(f.roomId, f.memberId, true, phone.ws.clientDeviceId)
  const preparing = f.service.snapshot(f.roomId)
  phone.status(false, false)
  f.message({ type: 'device.status', purpose: 'stage', label: 'Stage', audioEnabled: false, clockHealthy: false })
  assert.equal(f.service.snapshot(f.roomId).state, 'preparing')
  assert.equal(f.service.snapshot(f.roomId).generation, preparing.generation)
  f.time(9000); f.status(); phone.status()
  f.ready()
  assert.throws(() => f.service.start(f.roomId), error => error.code === 'GUIDE_NOT_READY')
  phone.ready()
  assert.equal(f.service.snapshot(f.roomId).guidePrepared, true)
  f.service.start(f.roomId); f.service.sweep()
  const before = f.service.snapshot(f.roomId)
  f.time(11_000)
  phone.status(false)
  const recovered = f.service.snapshot(f.roomId)
  assert.equal(recovered.state, 'recovering'); assert.equal(recovered.recoveryReason, 'guide.unavailable')
  assert.equal(recovered.entryId, f.entryId); assert.equal(recovered.positionMs, 0)
  assert.ok(recovered.generation > before.generation)
  assert.equal(f.db.prepare('SELECT COUNT(*) total FROM ktv_turn_history').get().total, 0)
  f.service.guide(f.roomId, f.memberId, false)
  f.status(); f.ready()
  assert.throws(() => f.service.start(f.roomId), error => error.code === 'OUTPUT_STOPPING')
  f.message({ type: 'device.stopped', leaseId: before.lease.id, clockId: f.clock.id, generation: before.generation })
  f.advance(501); f.status(); f.service.start(f.roomId); f.service.sweep()
  assert.equal(f.service.snapshot(f.roomId).state, 'scheduled')
  assert.equal(f.service.snapshot(f.roomId).guideRequired, false)
})

test('optional guide failures do not pause backing; only the selected singer can bind a separate controller guide', t => {
  const f = fixture(t)
  f.prepare(); f.time(9000); f.status()
  const other = f.member('other-singer'), strangerPhone = f.device(other)
  const display = f.device(f.memberId, 'viewer', 'display')
  assert.throws(() => f.service.guide(f.roomId, other, true, strangerPhone.ws.clientDeviceId), error => error.code === 'FORBIDDEN')
  for (const id of [strangerPhone.ws.clientDeviceId, display.ws.clientDeviceId, f.ws.clientDeviceId]) {
    assert.throws(() => f.service.guide(f.roomId, f.memberId, true, id), error => error.code === 'FORBIDDEN')
  }
  assert.throws(() => strangerPhone.ready(), error => error.code === 'FORBIDDEN')
  const phone = f.device(); phone.ready()
  f.service.start(f.roomId); f.service.sweep()
  phone.status(false)
  assert.equal(f.service.snapshot(f.roomId).state, 'scheduled')
  f.service.disconnected(phone.ws)
  assert.equal(f.service.snapshot(f.roomId).state, 'scheduled')
})

test('required guide heartbeats are generation-bound and ready responses promote at the seek boundary', t => {
  const f = fixture(t)
  f.prepare(); f.time(9000); f.status()
  const phone = f.device(); phone.ready(); f.service.guide(f.roomId, f.memberId, true, phone.ws.clientDeviceId)
  f.service.start(f.roomId); f.service.sweep()
  f.time(11000); f.status()
  const heartbeat = generation => phone.send({ type: 'device.heartbeat', clockId: f.clock.id,
    performanceId: f.performanceId, generation })
  heartbeat(f.service.snapshot(f.roomId).generation)
  f.service.transition(f.roomId, 'seek', 20_000)
  const pending = f.service.snapshot(f.roomId).pendingTransition
  f.ready(pending.generation); phone.ready(pending.generation)
  f.service.sweep(); f.time(pending.effectiveServerMs); f.service.sweep()
  assert.equal(f.service.snapshot(f.roomId).state, 'playing')
  assert.equal(f.service.snapshot(f.roomId).guidePrepared, true)
  f.time(15001); f.status(); phone.status()
  heartbeat(pending.generation - 1)
  f.service.sweep()
  assert.equal(f.service.snapshot(f.roomId).state, 'recovering')
  assert.equal(f.service.snapshot(f.roomId).recoveryReason, 'guide.unavailable')
})

test('guide loss at an effective seek boundary recovers instead of extending stage authority', t => {
  const f = fixture(t)
  f.prepare(); f.time(9000); f.status()
  const phone = f.device(); phone.ready(); f.service.guide(f.roomId, f.memberId, true, phone.ws.clientDeviceId)
  f.service.start(f.roomId); f.service.sweep()
  f.service.transition(f.roomId, 'seek', 10000)
  const pending = f.service.snapshot(f.roomId).pendingTransition
  f.ready(pending.generation)
  f.time(pending.effectiveServerMs); f.service.sweep()
  assert.equal(f.service.snapshot(f.roomId).state, 'recovering')
  assert.equal(f.service.snapshot(f.roomId).positionMs, 10000)
})

test('restart preserves required-guide preference but cannot restore an old guide device or ready state', t => {
  const f = fixture(t)
  f.prepare()
  const phone = f.device(); phone.ready()
  f.service.guide(f.roomId, f.memberId, true, phone.ws.clientDeviceId)
  f.restart()
  const after = f.service.snapshot(f.roomId)
  assert.equal(after.guideRequired, true); assert.equal(after.guideDeviceId, null)
  assert.equal(after.guidePrepared, false); assert.equal(after.recoveryReason, 'service.restarted')
})

test('validated stage drift and required-guide output faults enter generation-safe room recovery', t => {
  const f = fixture(t)
  f.prepare(); f.time(9000); f.status(); f.service.start(f.roomId); f.service.sweep()
  const before = f.service.snapshot(f.roomId)
  const status = { type: 'device.status', purpose: 'stage', label: 'Stage', audioEnabled: false, clockHealthy: true, audioIssue: 'drift' }
  f.message(status)
  assert.equal(f.service.snapshot(f.roomId).recoveryReason, 'stage.drift')
  assert.ok(f.service.snapshot(f.roomId).generation > before.generation)
  assert.throws(() => f.message({ ...status, audioIssue: 'arbitrary.event' }), error => error.code === 'INVALID_DEVICE_STATUS')
  f.message({ type: 'device.stopped', clockId: f.clock.id, leaseId: before.lease.id, generation: before.generation })
  f.advance(501); f.status(); f.ready(); f.service.start(f.roomId); f.service.sweep()
  const phone = f.device(); phone.ready(); f.service.guide(f.roomId, f.memberId, true, phone.ws.clientDeviceId)
  phone.send({ type: 'device.status', purpose: 'guide', label: 'Guide', audioEnabled: false, clockHealthy: true, audioIssue: 'output' })
  assert.equal(f.service.snapshot(f.roomId).recoveryReason, 'guide.output')
  assert.equal(f.service.snapshot(f.roomId).entryId, f.entryId)
  assert.equal(f.db.prepare('SELECT COUNT(*) total FROM ktv_turn_history').get().total, 0)
})

test('automatic turn selection honors a visible host override and resumes the fair round after it', t => {
  const f = fixture(t), other = f.member('other')
  const fair = f.enqueue(other), moved = f.enqueue(f.memberId)
  f.db.prepare('UPDATE ktv_queue_entries SET host_order = -1 WHERE id = ?').run(moved)
  f.prepare()
  f.transaction(f.db, () => f.service.finish(f.roomId, 'finished'))
  assert.equal(f.db.prepare('SELECT entry_id FROM ktv_readiness WHERE room_id = ?').get(f.roomId).entry_id, moved)
  f.transaction(f.db, () => f.service.decline(f.roomId, f.db.prepare('SELECT * FROM ktv_queue_entries WHERE id = ?').get(moved)))
  assert.equal(f.db.prepare('SELECT entry_id FROM ktv_readiness WHERE room_id = ?').get(f.roomId).entry_id, fair)
})

test('completion and decline automatically select fair accepted turns once, leaving held and unaccepted entries alone', t => {
  const f = fixture(t)
  const other = f.member('other')
  const repeat = f.enqueue(f.memberId), next = f.enqueue(other)
  const held = f.enqueue(other, { state: 'held' }), nomination = f.enqueue(other, { accepted: false })
  f.prepare()
  f.transaction(f.db, () => f.service.finish(f.roomId, 'finished'))
  let human = f.db.prepare('SELECT * FROM ktv_readiness WHERE room_id = ?').get(f.roomId)
  assert.equal(human.entry_id, next); assert.equal(human.state, 'awaiting-singer')
  assert.notEqual(human.performance_id, f.performanceId)
  assert.equal(f.service.snapshot(f.roomId).state, 'idle')
  f.transaction(f.db, () => f.service.decline(f.roomId, f.db.prepare('SELECT * FROM ktv_queue_entries WHERE id = ?').get(next)))
  human = f.db.prepare('SELECT * FROM ktv_readiness WHERE room_id = ?').get(f.roomId)
  assert.equal(human.entry_id, repeat)
  assert.equal(f.db.prepare('SELECT COUNT(*) total FROM ktv_turn_history WHERE round = 1').get().total, 2)
  assert.equal(f.db.prepare('SELECT outcome FROM ktv_turn_history WHERE entry_id = ?').get(next).outcome, 'declined')
  assert.equal(f.db.prepare('SELECT state FROM ktv_queue_entries WHERE id = ?').get(held).state, 'held')
  assert.equal(f.db.prepare('SELECT accepted_at FROM ktv_queue_entries WHERE id = ?').get(nomination).accepted_at, null)
  assert.throws(() => f.service.finish(f.roomId, 'finished'), error => error.code === 'INVALID_PLAYBACK')
  assert.equal(f.db.prepare('SELECT COUNT(*) total FROM ktv_turn_history').get().total, 2)
})

test('host loss preserves a completed queue until a controller returns; paired displays and ordinary guests cannot inherit ownership', t => {
  const f = fixture(t, { hostGraceMs: 1000 })
  const guest = f.member('guest'), next = f.enqueue(guest)
  f.prepare()
  const display = f.device(f.memberId, 'stage', 'display'), guestPhone = f.device(guest, 'viewer')
  f.service.disconnected(f.ws); f.service.sweep()
  f.transaction(f.db, () => f.service.finish(f.roomId, 'skipped'))
  assert.equal(f.db.prepare('SELECT advance_pending FROM ktv_readiness').get().advance_pending, 1)
  f.time(1001); display.status(); guestPhone.status(); f.service.sweep()
  assert.equal(f.db.prepare("SELECT id FROM ktv_members WHERE role = 'host'").get().id, f.memberId)
  assert.equal(f.db.prepare('SELECT state FROM ktv_readiness').get().state, 'idle')
  f.restart()
  assert.equal(f.db.prepare('SELECT advance_pending FROM ktv_readiness').get().advance_pending, 1)
  f.status(); f.service.sweep()
  assert.equal(f.db.prepare('SELECT entry_id FROM ktv_readiness').get().entry_id, next)
  assert.equal(f.db.prepare('SELECT clock_id FROM ktv_readiness').get().clock_id, f.clock.id)
  assert.equal(f.service.presence(f.roomId).host.connected, true)
})

test('host loss transfers atomically to the earliest connected appointed co-host after grace and never interrupts healthy backing', t => {
  const f = fixture(t, { hostGraceMs: 1000 })
  const first = f.member('first-cohost', '2026-01-01T00:00:00Z')
  const second = f.member('second-cohost', '2026-02-01T00:00:00Z')
  f.prepare(); f.time(9000); f.status(); f.service.start(f.roomId); f.service.sweep()
  const alternate = f.device(f.memberId, 'viewer')
  const firstPhone = f.device(first, 'viewer'), secondPhone = f.device(second, 'viewer')
  // A second host controller keeps ownership while a paired display carries backing.
  f.service.disconnected(alternate.ws)
  const stage = f.device(f.memberId, 'stage', 'display')
  f.service.assign(f.roomId, stage.ws.clientDeviceId); stage.ready()
  const previous = f.service.snapshot(f.roomId).lease
  f.message({ type: 'device.stopped', clockId: f.clock.id, leaseId: previous.id, generation: previous.generation })
  f.advance(501); f.status(); f.service.start(f.roomId); f.service.sweep()
  f.service.disconnected(f.ws); f.service.sweep()
  const before = f.service.snapshot(f.roomId)
  f.advance(999); stage.status(); firstPhone.status(); secondPhone.status(); f.service.sweep()
  assert.equal(f.db.prepare("SELECT id FROM ktv_members WHERE role = 'host'").get().id, f.memberId)
  f.advance(2); f.service.sweep()
  assert.equal(f.db.prepare("SELECT id FROM ktv_members WHERE role = 'host'").get().id, first)
  assert.equal(f.db.prepare("SELECT COUNT(*) total FROM ktv_members WHERE role = 'host'").get().total, 1)
  assert.equal(f.db.prepare('SELECT cohost_at FROM ktv_members WHERE id = ?').get(f.memberId).cohost_at, null)
  assert.equal(f.service.snapshot(f.roomId).generation, before.generation)
  assert.equal(f.service.snapshot(f.roomId).lease.id, before.lease.id)
})

test('host returns cancel the grace deadline across multiple controllers and transfer failures roll back both roles', t => {
  const f = fixture(t, { hostGraceMs: 1000 })
  const cohost = f.member('cohost', '2026-01-01T00:00:00Z')
  f.status(); const otherHost = f.device(f.memberId, 'viewer'), cohostPhone = f.device(cohost, 'viewer')
  f.service.disconnected(f.ws); f.service.sweep(); f.time(1001); otherHost.status(); cohostPhone.status(); f.service.sweep()
  assert.equal(f.service.presence(f.roomId).host.graceDeadlineMs, null)
  f.service.disconnected(otherHost.ws); f.service.sweep()
  const deadline = f.service.presence(f.roomId).host.graceDeadlineMs
  f.time(deadline - 1); f.status(); f.service.sweep()
  assert.equal(f.service.presence(f.roomId).host.graceDeadlineMs, null)
  f.service.disconnected(f.ws); f.service.sweep(); f.advance(1001); cohostPhone.status()
  f.db.exec(`CREATE TRIGGER reject_automatic_host BEFORE UPDATE OF role ON ktv_members
    WHEN NEW.role = 'host' AND NEW.id = '${cohost}' BEGIN SELECT RAISE(ABORT, 'injected transfer failure'); END;`)
  assert.throws(() => f.service.sweep(), /injected transfer failure/)
  assert.equal(f.db.prepare("SELECT id FROM ktv_members WHERE role = 'host'").get().id, f.memberId)
  assert.ok(f.db.prepare('SELECT cohost_at FROM ktv_members WHERE id = ?').get(cohost).cohost_at)
  f.db.exec('DROP TRIGGER reject_automatic_host'); f.service.sweep()
  assert.equal(f.db.prepare("SELECT id FROM ktv_members WHERE role = 'host'").get().id, cohost)
})

function wav(seconds = 2) {
  const sampleRate = 8000, dataSize = seconds * sampleRate * 2
  const bytes = Buffer.alloc(44 + dataSize)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + dataSize, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(dataSize, 40)
  return bytes
}

test('asset descriptors pin real audio/lyrics hashes, refresh changed files and support imported originals', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-assets-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  for (const folder of ['data', 'karaoke', 'import', 'synced', 'lyrics', 'import/lyrics']) await fs.mkdir(path.join(root, folder), { recursive: true })
  const resolve = createKtvAssets({ musicRoot: path.join(root, 'data'), karaokeRoot: path.join(root, 'karaoke'),
    importRoot: path.join(root, 'import'), syncedRoot: path.join(root, 'synced'), lyricsRoot: path.join(root, 'lyrics') })
  await fs.writeFile(path.join(root, 'karaoke/link.1.instrumental.mp3'), wav())
  await fs.writeFile(path.join(root, 'data/link.1.mp3'), wav())
  await fs.writeFile(path.join(root, 'synced/link.1.lrc'), '[00:00]Hello')
  const first = await resolve(1)
  assert.equal(first.durationMs, 2000); assert.equal(first.lyrics.mode, 'synced')
  assert.match(first.instrumental.sha256, /^[a-f0-9]{64}$/); assert.equal(first.alignmentVerified, false)
  assert.equal((await resolve(1)).version, first.version)
  await fs.writeFile(path.join(root, 'synced/link.1.lrc'), '[00:00]Updated lyrics')
  assert.notEqual((await resolve(1)).version, first.version)
  await fs.writeFile(path.join(root, 'karaoke/link.2.instrumental.mp3'), wav())
  await fs.writeFile(path.join(root, 'import/link.2.mp3'), wav())
  await fs.writeFile(path.join(root, 'import/lyrics/link.2.mp3.l'), '<plain manual lyrics>')
  const imported = await resolve(2)
  assert.match(imported.original.url, /^\/api\/dig\/files\/link\.2\.mp3\?ktvAsset=[a-f0-9]{64}$/)
  assert.equal(imported.lyrics.mode, 'plain'); assert.equal(imported.lyrics.text, '<plain manual lyrics>')
  await assert.rejects(resolve(3), error => error.code === 'ASSET_UNAVAILABLE')
  await assert.rejects(resolve('../etc/passwd'), error => error.code === 'INVALID_SONG')
})
