// Real SQLite playback/grant authority for native output fault tests. The
// device calls use the domain service directly; this does not test HTTP or SFU.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { initDb } from '../server/db.js'
import { createKtvPlayback } from '../server/ktv-playback.js'
import { createKtvMediaGrants } from '../server/ktv-media-grants.js'

export async function createReceiverAuthorityFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-receiver-authority-'))
  const db = initDb(root), roomId = randomUUID(), entryId = randomUUID(), performanceId = randomUUID()
  const memberId = randomUUID(), listenerId = randomUUID(), clock = { id: randomUUID(), nowMs: () => performance.now() }
  let service, grants, publisher, audience
  try {
    const stamp = new Date().toISOString()
    db.prepare('INSERT INTO ktv_rooms (id, name, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(roomId, 'Owned native receiver fault fixture', stamp, new Date(Date.now() + 3600000).toISOString())
    for (const [id, name, role] of [[memberId, 'Host', 'host'], [listenerId, 'Listener', 'member']]) {
      const userId = db.prepare("INSERT INTO users (username, kind, created_at) VALUES (?, 'guest', ?)").run(name, stamp).lastInsertRowid
      db.prepare(`INSERT INTO ktv_members (id, room_id, user_id, display_name, role, admission, joined_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'admitted', ?, ?)`).run(id, roomId, userId, name, role, stamp, stamp)
    }
    db.prepare(`INSERT INTO ktv_queue_entries (id, room_id, song_id, title, requester_member_id, singer_member_id, accepted_at, created_at, updated_at)
      VALUES (?, ?, 1, 'Native test tone', ?, ?, ?, ?, ?)`).run(entryId, roomId, memberId, memberId, stamp, stamp, stamp)
    db.prepare(`INSERT INTO ktv_readiness (room_id, entry_id, performance_id, generation, clock_id, state, updated_at)
      VALUES (?, ?, ?, 1, ?, 'ready', ?)`).run(roomId, entryId, performanceId, clock.id, stamp)
    const transaction = (database, work) => {
      database.exec('BEGIN IMMEDIATE')
      try { const result = work(); database.exec('COMMIT'); return result }
      catch (error) { database.exec('ROLLBACK'); throw error }
    }
    service = createKtvPlayback({ db, clock, transaction,
      bump: (database, id) => database.prepare('UPDATE ktv_rooms SET revision = revision + 1 WHERE id = ?').run(id),
      event() {}, broadcast() {} })
    grants = createKtvMediaGrants({ db, clock, getPlayback: id => service.snapshot(id), getDevices: id => service.presence(id).devices,
      reserveReceiveOutput: permit => service.reserveReceiveOutput(permit),
      apiKey: 'owned-native-authority', apiSecret: 'test-only-native-authority-secret-more-than-thirty-two-bytes' })
    service.media = { grants }
    db.prepare("UPDATE ktv_rooms SET performance_mode = 'online' WHERE id = ?").run(roomId)
    const stage = { roomId, clientDeviceId: randomUUID(), principal: {}, readyState: 1, send() {} }
    const listener = { ...stage, clientDeviceId: randomUUID() }
    const message = body => service.deviceMessage(stage, { protocolVersion: 1, ...body }, { self: { id: memberId, admission: 'admitted' } })
    const status = () => message({ type: 'device.status', purpose: 'stage', label: 'Native publisher', audioEnabled: true, clockHealthy: true, mediaProtocol: 2 })
    const snapshot = () => service.snapshot(roomId)
    const ready = () => message({ type: 'device.ready', clockId: clock.id, performanceId, generation: snapshot().generation,
      assetVersion: 'owned-native-tone', durationMs: 60000 })
    status(); service.assign(roomId, stage.clientDeviceId)
    service.prepare(roomId, { state: 'ready', entryId, performanceId },
      { version: 'owned-native-tone', durationMs: 60000, instrumental: { durationMs: 60000 }, original: null })
    ready()
    service.deviceMessage(listener, { protocolVersion: 1, type: 'device.status', purpose: 'viewer', label: 'Blocked native receiver',
      audioEnabled: true, clockHealthy: true, mediaProtocol: 2 }, { self: { id: listenerId, admission: 'admitted' } })
    const issue = scope => grants.issue({ roomId, memberId: scope === 'publisher' ? memberId : listenerId,
      deviceId: scope === 'publisher' ? stage.clientDeviceId : listener.clientDeviceId, scope, commandId: randomUUID() })
    return {
      clock, snapshot, timing: service.timing,
      async start() {
        const remaining = snapshot().restartSafeAfterMs - clock.nowMs()
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining + 1))
        status(); ready(); service.start(roomId); service.sweep()
        publisher = await issue('publisher'); audience = await issue('audience')
        return { clockId: clock.id, performanceId, generation: snapshot().generation }
      },
      async authorize() {
        status()
        const playback = snapshot()
        message({ type: 'device.heartbeat', clockId: clock.id, performanceId, generation: playback.generation, leaseId: playback.lease.id })
        publisher = await grants.renew(publisher.identity, memberId, stage.clientDeviceId)
        grants.acknowledgeReady(publisher.identity)
        const permit = grants.receivePermit(audience.identity, listenerId, listener.clientDeviceId)
        if (!permit) throw new Error('Native fixture received no reserved output authority')
        return { publisher, permit, playback: snapshot() }
      },
      stop() {
        const before = snapshot()
        message({ type: 'device.stopped', clockId: clock.id, leaseId: before.lease.id, generation: before.generation })
        grants.revoke({ identity: publisher.identity }); grants.acknowledgeRemoval(publisher.identity)
        service.mediaFailed(roomId, before.performanceId, before.generation)
        return snapshot()
      },
      tryReplacement() { status(); ready(); service.start(roomId); service.sweep(); return snapshot() },
      async replacementPermit() {
        publisher = await issue('publisher'); grants.acknowledgeReady(publisher.identity); return publisher.permit
      },
      async renewReplacementPermit() {
        status()
        const playback = snapshot()
        message({ type: 'device.heartbeat', clockId: clock.id, performanceId, generation: playback.generation, leaseId: playback.lease.id })
        publisher = await grants.renew(publisher.identity, memberId, stage.clientDeviceId)
        return publisher.permit
      },
      async close() { service.close(); db.close(); await fs.rm(root, { recursive: true, force: true }) },
    }
  } catch (error) {
    service?.close(); db.close(); await fs.rm(root, { recursive: true, force: true }); throw error
  }
}
