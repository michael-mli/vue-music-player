import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { TokenVerifier } from 'livekit-server-sdk'
import { initDb } from './db.js'
import { createKtvMediaGrants, ktvMediaRoom } from './ktv-media-grants.js'

const code = expected => error => error.code === expected
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ktv-media-grants-')), roomId = randomUUID(), memberIds = [randomUUID(), randomUUID(), randomUUID()]
  let db = initDb(root), service
  const now = new Date().toISOString(), expiry = new Date(Date.now() + 3600000).toISOString()
  db.prepare('INSERT INTO ktv_rooms (id, name, created_at, expires_at) VALUES (?, ?, ?, ?)').run(roomId, 'Media test room', now, expiry)
  for (let index = 0; index < 3; index++) {
    const id = db.prepare("INSERT INTO users (username, kind, created_at) VALUES (?, 'guest', ?)").run(`media-test-${index}`, now).lastInsertRowid
    db.prepare('INSERT INTO ktv_members (id, room_id, user_id, display_name, role, admission, joined_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(memberIds[index], roomId, id, `Member ${index}`, index === 0 ? 'host' : 'member', 'admitted', now, now)
  }
  const devices = memberIds.map(memberId => ({ id: randomUUID(), memberId, connected: true, scope: 'controller', purpose: 'stage', clockHealthy: true, audioEnabled: true, mediaProtocol: 1 }))
  const clock = { id: randomUUID(), nowMs: () => 1000 }
  const playback = { state: 'scheduled', clockId: clock.id, performanceId: randomUUID(), generation: 1,
    singerMemberId: memberIds[1], stageMemberId: memberIds[1], stageDeviceId: devices[1].id,
    lease: { id: randomUUID(), deviceId: devices[1].id, expiresServerMs: 9000 } }
  const apiKey = 'grant-tests', apiSecret = 'test-only-grant-secret-with-more-than-thirty-two-bytes'
  const start = () => { service = createKtvMediaGrants({ db, clock, getPlayback: () => playback, getDevices: () => devices, apiKey, apiSecret }) }
  start(); db.prepare("UPDATE ktv_rooms SET performance_mode = 'online' WHERE id = ?").run(roomId)
  const issue = (index, scope, extra = {}) => service.issue({ roomId, memberId: memberIds[index], deviceId: devices[index].id, scope, commandId: randomUUID(), ...extra })
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }) })
  return { get db() { return db }, get service() { return service }, roomId, memberIds, devices, playback, clock, issue,
    verifier: new TokenVerifier(apiKey, apiSecret), restart() { db.close(); db = initDb(root); start() } }
}

test('room media grants recover lost issuance replies across restart without storing JWTs', async t => {
  const f = fixture(t), commandId = randomUUID(), first = await f.issue(1, 'publisher', { commandId })
  const claims = await f.verifier.verify(first.token)
  assert.equal(claims.sub, first.identity); assert.equal(claims.video.room, ktvMediaRoom(f.roomId))
  assert.equal(claims.video.canPublish, true); assert.equal(claims.video.canSubscribe, false); assert.equal(claims.video.canPublishData, false)
  assert.deepEqual(claims.video.canPublishSources, ['microphone', 'screen_share'])
  assert.ok(first.permit.expiresServerMs <= 6000)
  f.restart()
  const retry = await f.issue(1, 'publisher', { commandId })
  assert.equal(retry.identity, first.identity)
  assert.equal(f.db.prepare('SELECT COUNT(*) total FROM ktv_media_grants').get().total, 1)
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM ktv_media_grants').all()).includes(first.token))
  await assert.rejects(f.issue(1, 'audience', { commandId }), code('COMMAND_CONFLICT'))
})

test('only the selected singer’s connected controller and live output lease can publish online', async t => {
  const f = fixture(t)
  await assert.rejects(f.issue(0, 'publisher'), code('MEDIA_FORBIDDEN'))
  await assert.rejects(f.issue(2, 'publisher'), code('MEDIA_FORBIDDEN'))
  f.devices[1].scope = 'display'
  await assert.rejects(f.issue(1, 'publisher'), code('MEDIA_FORBIDDEN'))
  f.devices[1].scope = 'controller'; f.devices[1].clockHealthy = false
  await assert.rejects(f.issue(1, 'publisher'), code('MEDIA_FORBIDDEN'))
  f.devices[1].clockHealthy = true; f.playback.lease.expiresServerMs = 900
  await assert.rejects(f.issue(1, 'publisher'), code('MEDIA_FORBIDDEN'))
  f.playback.lease.expiresServerMs = 9000; f.playback.state = 'preparing'
  await assert.rejects(f.issue(1, 'publisher'), code('MEDIA_FORBIDDEN'))
  f.playback.state = 'playing'
  assert.equal((await f.issue(1, 'publisher')).scope, 'publisher')
})

test('receiver permits bind a ready source nonce and never borrow the longer audience lifetime', async t => {
  const f = fixture(t), audience = await f.issue(2, 'audience')
  const output = () => f.service.receivePermit(audience.identity, f.memberIds[2], f.devices[2].id)
  assert.equal(output(), null)
  const publisher = await f.issue(1, 'publisher')
  assert.equal(output(), null)
  f.service.acknowledgeReady(publisher.identity)
  const permit = output()
  assert.deepEqual(Object.keys(permit).sort(), ['clockId', 'expiresServerMs', 'generation', 'performanceId', 'publisherIdentity'])
  assert.equal(permit.publisherIdentity, publisher.identity)
  assert.equal(permit.clockId, f.playback.clockId); assert.equal(permit.performanceId, f.playback.performanceId)
  assert.equal(permit.generation, f.playback.generation)
  assert.equal(permit.expiresServerMs, publisher.permit.expiresServerMs)
  f.playback.lease.expiresServerMs = 2500
  assert.equal(output().expiresServerMs, 2500)
  f.service.revoke({ identity: publisher.identity }); assert.equal(output(), null)
  f.service.acknowledgeRemoval(publisher.identity)
  const replacement = await f.issue(1, 'publisher'); f.service.acknowledgeReady(replacement.identity)
  assert.equal(output().publisherIdentity, replacement.identity)
  f.playback.generation++; assert.equal(output(), null)
})

test('a restarted service cannot invent a source deadline before returning a current source permit', async t => {
  const f = fixture(t), audience = await f.issue(2, 'audience'), publisher = await f.issue(1, 'publisher')
  f.service.acknowledgeReady(publisher.identity)
  assert.ok(f.service.receivePermit(audience.identity, f.memberIds[2], f.devices[2].id))
  f.restart()
  assert.equal(f.service.receivePermit(audience.identity, f.memberIds[2], f.devices[2].id), null)
  const renewed = await f.service.renew(publisher.identity, f.memberIds[1], f.devices[1].id)
  assert.equal(f.service.receivePermit(audience.identity, f.memberIds[2], f.devices[2].id).expiresServerMs, renewed.permit.expiresServerMs)
})

test('receiver authority cannot be read through another member/device, a publisher grant or a revoked listener', async t => {
  const f = fixture(t), audience = await f.issue(2, 'audience'), publisher = await f.issue(1, 'publisher')
  for (const args of [[audience.identity, f.memberIds[1], f.devices[2].id],
    [audience.identity, f.memberIds[2], f.devices[1].id], [publisher.identity, f.memberIds[1], f.devices[1].id]])
    assert.throws(() => f.service.receivePermit(...args), code('MEDIA_REVOKED'))
  f.service.revoke({ identity: audience.identity })
  assert.throws(() => f.service.receivePermit(audience.identity, f.memberIds[2], f.devices[2].id), code('MEDIA_REVOKED'))
})

test('generation handover cannot issue a new publisher before provider removal acknowledgment', async t => {
  const f = fixture(t), first = await f.issue(1, 'publisher'), oldClaims = await f.verifier.verify(first.token)
  f.playback.generation++
  assert.equal(f.service.authorize(oldClaims), null)
  assert.equal(f.service.invalidGrants()[0].identity, first.identity)
  await assert.rejects(f.issue(1, 'publisher'), code('MEDIA_REVOCATION_PENDING'))
  f.service.revoke({ identity: first.identity })
  await assert.rejects(f.issue(1, 'publisher'), code('MEDIA_REVOCATION_PENDING'))
  f.service.acknowledgeRemoval(first.identity)
  const replacement = await f.issue(1, 'publisher')
  assert.notEqual(replacement.identity, first.identity); assert.equal(replacement.permit.generation, 2)
  assert.equal(f.service.authorize(oldClaims), null)
  assert.equal(f.db.prepare("SELECT COUNT(*) total FROM ktv_media_grants WHERE scope = 'publisher' AND state != 'revoked'").get().total, 1)
})

test('removed/blocked membership and room closure revoke media access despite an unexpired JWT', async t => {
  const f = fixture(t), audience = await f.issue(2, 'audience'), claims = await f.verifier.verify(audience.token)
  assert.ok(f.service.authorize(claims))
  f.db.prepare("UPDATE ktv_members SET admission = 'removed' WHERE id = ?").run(f.memberIds[2])
  assert.equal(f.service.authorize(claims), null)
  await assert.rejects(f.service.renew(audience.identity, f.memberIds[2], f.devices[2].id), code('MEDIA_REVOKED'))
  f.db.prepare("UPDATE ktv_members SET admission = 'admitted', blocked_at = ? WHERE id = ?").run(new Date().toISOString(), f.memberIds[2])
  assert.equal(f.service.authorize(claims), null)
  f.db.prepare('UPDATE ktv_members SET blocked_at = NULL WHERE id = ?').run(f.memberIds[2])
  f.db.prepare("UPDATE ktv_rooms SET status = 'closed' WHERE id = ?").run(f.roomId)
  assert.equal(f.service.authorize(claims), null)
})

test('hybrid capture allows host/co-host controllers and loses permission after co-host demotion', async t => {
  const f = fixture(t)
  f.db.prepare("UPDATE ktv_rooms SET performance_mode = 'hybrid' WHERE id = ?").run(f.roomId)
  f.playback.stageDeviceId = f.devices[2].id; f.playback.stageMemberId = f.memberIds[2]; f.playback.lease.deviceId = f.devices[2].id
  await assert.rejects(f.issue(2, 'publisher'), code('MEDIA_FORBIDDEN'))
  f.db.prepare('UPDATE ktv_members SET cohost_at = ? WHERE id = ?').run(new Date().toISOString(), f.memberIds[2])
  const grant = await f.issue(2, 'publisher'), claims = await f.verifier.verify(grant.token)
  assert.ok(f.service.authorize(claims))
  f.db.prepare('UPDATE ktv_members SET cohost_at = NULL WHERE id = ?').run(f.memberIds[2])
  assert.equal(f.service.authorize(claims), null)
  f.service.revoke({ identity: grant.identity }); f.service.acknowledgeRemoval(grant.identity)
  f.playback.stageDeviceId = f.devices[0].id; f.playback.stageMemberId = f.memberIds[0]; f.playback.lease.deviceId = f.devices[0].id
  assert.equal((await f.issue(0, 'publisher')).scope, 'publisher')
})

test('paired displays can subscribe but never capture; revoked parent grants cannot recover media', async t => {
  const f = fixture(t), parentId = randomUUID(), now = new Date().toISOString()
  f.db.prepare(`INSERT INTO ktv_device_grants (id, room_id, member_id, scope, secret_hash, created_at, expires_at)
    VALUES (?, ?, ?, 'display', ?, ?, ?)`).run(parentId, f.roomId, f.memberIds[1], randomUUID(), now, new Date(Date.now() + 60000).toISOString())
  f.devices[1].scope = 'display'; f.devices[1].deviceGrantId = parentId
  const commandId = randomUUID(), audience = await f.issue(1, 'audience', { deviceGrantId: parentId, commandId })
  const claims = await f.verifier.verify(audience.token)
  assert.equal(claims.video.canPublish, false); assert.deepEqual(claims.video.canPublishSources, [])
  await assert.rejects(f.issue(1, 'publisher', { deviceGrantId: parentId }), code('MEDIA_FORBIDDEN'))
  f.db.prepare('UPDATE ktv_device_grants SET revoked_at = ? WHERE id = ?').run(now, parentId)
  assert.equal(f.service.authorize(claims), null)
  await assert.rejects(f.issue(1, 'audience', { deviceGrantId: parentId, commandId }), code('MEDIA_FORBIDDEN'))
})

test('expired publisher leases cannot be renewed or resurrected by replaying an issuance receipt', async t => {
  const f = fixture(t), commandId = randomUUID(), grant = await f.issue(1, 'publisher', { commandId })
  f.db.prepare('UPDATE ktv_media_grants SET expires_at = ? WHERE identity = ?').run(new Date(Date.now() - 1000).toISOString(), grant.identity)
  const claims = await f.verifier.verify(grant.token)
  assert.equal(f.service.authorize(claims), null)
  await assert.rejects(f.service.renew(grant.identity, f.memberIds[1], f.devices[1].id), code('MEDIA_REVOKED'))
  await assert.rejects(f.issue(1, 'publisher', { commandId }), code('MEDIA_REVOKED'))
})

test('pending/local/disconnected members receive no media grants and foreign keys stay intact', async t => {
  const f = fixture(t)
  f.db.prepare("UPDATE ktv_members SET admission = 'pending' WHERE id = ?").run(f.memberIds[2])
  await assert.rejects(f.issue(2, 'audience'), code('MEDIA_FORBIDDEN'))
  f.devices[0].connected = false
  await assert.rejects(f.issue(0, 'audience'), code('MEDIA_FORBIDDEN'))
  f.db.prepare("UPDATE ktv_rooms SET performance_mode = 'local' WHERE id = ?").run(f.roomId)
  await assert.rejects(f.issue(1, 'publisher'), code('MEDIA_FORBIDDEN'))
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length, 0)
})

test('atomic membership and timeline invalidation cannot restore an old nonce between watchdog polls', async t => {
  const f = fixture(t), audience = await f.issue(2, 'audience'), oldAudience = await f.verifier.verify(audience.token)
  f.db.prepare("UPDATE ktv_members SET admission = 'removed' WHERE id = ?").run(f.memberIds[2])
  f.db.prepare("UPDATE ktv_members SET admission = 'admitted' WHERE id = ?").run(f.memberIds[2])
  assert.equal(f.service.authorize(oldAudience), null)
  const publisher = await f.issue(1, 'publisher'), oldPublisher = await f.verifier.verify(publisher.token)
  f.db.prepare(`INSERT INTO ktv_playback (room_id, clock_id, generation, state, performance_id, stage_device_id, stage_member_id, updated_at)
    VALUES (?, ?, 1, 'playing', ?, ?, ?, ?)`).run(f.roomId, f.clock.id, f.playback.performanceId, f.devices[1].id, f.memberIds[1], new Date().toISOString())
  f.db.prepare('UPDATE ktv_playback SET generation = 2 WHERE room_id = ?').run(f.roomId)
  f.db.prepare('UPDATE ktv_playback SET generation = 1 WHERE room_id = ?').run(f.roomId)
  assert.equal(f.service.authorize(oldPublisher), null)
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length, 0)
})

test('one device cannot listen and publish simultaneously and changing role waits for provider acknowledgment', async t => {
  const f = fixture(t), listening = await f.issue(1, 'audience')
  await assert.rejects(f.issue(1, 'publisher'), code('MEDIA_REVOCATION_PENDING'))
  f.service.revoke({ identity: listening.identity })
  await assert.rejects(f.issue(1, 'publisher'), code('MEDIA_REVOCATION_PENDING'))
  f.service.acknowledgeRemoval(listening.identity)
  const publishing = await f.issue(1, 'publisher')
  await assert.rejects(f.issue(1, 'audience'), code('MEDIA_REVOCATION_PENDING'))
  assert.notEqual(publishing.identity, listening.identity)
})
