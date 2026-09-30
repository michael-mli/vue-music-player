import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { initDb } from './db.js'
import { createKtvPlayback } from './ktv-playback.js'
import { createKtvAssets } from './ktv-assets.js'
import { orderQueue } from './ktv-queue.js'
import { timelinePosition, effectiveTimeline } from './ktv-timeline.js'

function fixture(t) {
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
    event: (...args) => events.push(args), broadcast: () => {} }
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
  t.after(() => { service.close(); db.close(); fsSync.rmSync(directory, { recursive: true, force: true }) })
  return { db, roomId, memberId, entryId, performanceId, clock, ws, assets, packets, events, transaction,
    get service() { return service }, status, message, ready, prepare,
    time: value => { nowMs = value }, advance: amount => { nowMs += amount },
    restart: () => { service.close(); clock.id = randomUUID(); service = createKtvPlayback(options); return service } }
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
