import { createHash, randomUUID } from 'node:crypto'
import { AccessToken, TrackSource } from 'livekit-server-sdk'
import { fail } from './ktv-errors.js'
import { KTV_MEDIA_OUTPUT_PERMIT_MS } from './ktv-timing.js'

const stamp = () => new Date().toISOString()
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export const ktvMediaRoom = roomId => `ktv-${roomId}`

// Room authorization is re-read for every signaling join and watchdog check.
// Provider removal must be acknowledged before replacing a publisher. This
// service stores identities/receipts, never the SFU secret or a bearer JWT.
export function createKtvMediaGrants({ db, clock, getPlayback, getDevices, reserveReceiveOutput = () => false, apiKey, apiSecret, audienceLifetimeMs = 120000 }) {
  if (!apiKey || !apiSecret || apiSecret.length < 32 || !Number.isSafeInteger(audienceLifetimeMs) || audienceLifetimeMs < 30000 || audienceLifetimeMs > 120000) {
    throw new Error('Invalid KTV media configuration')
  }
  // Preserve the exact monotonic deadline delivered to the source. Recomputing
  // it from wall timestamps for every listener introduces rounding jitter and
  // could accidentally grant longer output than that source actually received.
  const publisherDeadlines = new Map()
  const columns = db.prepare('PRAGMA table_info(ktv_rooms)').all().map(column => column.name)
  if (!columns.includes('performance_mode')) db.exec("ALTER TABLE ktv_rooms ADD COLUMN performance_mode TEXT NOT NULL DEFAULT 'local' CHECK (performance_mode IN ('local', 'online', 'hybrid'))")
  db.exec(`CREATE TABLE IF NOT EXISTS ktv_media_grants (
    identity TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES ktv_rooms(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES ktv_members(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    device_grant_id TEXT REFERENCES ktv_device_grants(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('audience', 'publisher')),
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoking', 'revoked')),
    clock_id TEXT, performance_id TEXT, generation INTEGER, lease_id TEXT,
    expires_at TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT, ready_at TEXT,
    CHECK (scope != 'publisher' OR (clock_id IS NOT NULL AND performance_id IS NOT NULL AND generation IS NOT NULL AND lease_id IS NOT NULL))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ktv_one_media_publisher ON ktv_media_grants(room_id)
    WHERE scope = 'publisher' AND state != 'revoked';
  CREATE UNIQUE INDEX IF NOT EXISTS ktv_media_device_scope ON ktv_media_grants(room_id, device_id)
    WHERE state != 'revoked';
  CREATE INDEX IF NOT EXISTS ktv_media_member ON ktv_media_grants(room_id, member_id, state);
  CREATE INDEX IF NOT EXISTS ktv_media_expiry ON ktv_media_grants(state, expires_at);
  CREATE TABLE IF NOT EXISTS ktv_media_receipts (
    room_id TEXT NOT NULL REFERENCES ktv_rooms(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES ktv_members(id) ON DELETE CASCADE,
    command_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
    identity TEXT NOT NULL REFERENCES ktv_media_grants(identity) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(room_id, member_id, command_id)
  );
  CREATE TRIGGER IF NOT EXISTS ktv_media_member_revoked AFTER UPDATE OF admission, blocked_at, role, cohost_at ON ktv_members
  WHEN NEW.admission != 'admitted' OR NEW.blocked_at IS NOT NULL OR
    (OLD.role = 'host' AND NEW.role != 'host') OR (OLD.cohost_at IS NOT NULL AND NEW.cohost_at IS NULL)
  BEGIN
    UPDATE ktv_media_grants SET state = 'revoking' WHERE member_id = NEW.id AND state = 'active' AND
      (NEW.admission != 'admitted' OR NEW.blocked_at IS NOT NULL OR scope = 'publisher');
  END;
  CREATE TRIGGER IF NOT EXISTS ktv_media_parent_revoked AFTER UPDATE OF revoked_at, expires_at ON ktv_device_grants
  WHEN NEW.revoked_at IS NOT NULL OR julianday(NEW.expires_at) <= julianday('now')
  BEGIN UPDATE ktv_media_grants SET state = 'revoking' WHERE device_grant_id = NEW.id AND state = 'active'; END;
  CREATE TRIGGER IF NOT EXISTS ktv_media_room_revoked AFTER UPDATE OF status, performance_mode ON ktv_rooms
  WHEN NEW.status != 'open' OR NEW.performance_mode IS NOT OLD.performance_mode
  BEGIN
    UPDATE ktv_media_grants SET state = 'revoking' WHERE room_id = NEW.id AND state = 'active' AND
      (NEW.status != 'open' OR NEW.performance_mode = 'local' OR scope = 'publisher');
  END;
  CREATE TRIGGER IF NOT EXISTS ktv_media_performance_revoked AFTER UPDATE OF state, generation, clock_id, performance_id, stage_device_id, stage_member_id ON ktv_playback
  WHEN NEW.state NOT IN ('scheduled', 'playing') OR NEW.generation IS NOT OLD.generation OR
    NEW.clock_id IS NOT OLD.clock_id OR NEW.performance_id IS NOT OLD.performance_id OR
    NEW.stage_device_id IS NOT OLD.stage_device_id OR NEW.stage_member_id IS NOT OLD.stage_member_id
  BEGIN UPDATE ktv_media_grants SET state = 'revoking' WHERE room_id = NEW.room_id AND scope = 'publisher' AND state = 'active'; END;`)
  if (!db.prepare('PRAGMA table_info(ktv_media_grants)').all().some(column => column.name === 'ready_at')) {
    db.exec('ALTER TABLE ktv_media_grants ADD COLUMN ready_at TEXT')
  }

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE')
    try { const result = work(); db.exec('COMMIT'); return result } catch (error) { db.exec('ROLLBACK'); throw error }
  }
  function access(row) {
    const room = db.prepare('SELECT * FROM ktv_rooms WHERE id = ?').get(row.room_id)
    const member = db.prepare('SELECT * FROM ktv_members WHERE id = ? AND room_id = ?').get(row.member_id, row.room_id)
    if (!room || room.status !== 'open' || Date.parse(room.expires_at) <= Date.now() || !member || member.admission !== 'admitted' || member.blocked_at) return null
    if (room.performance_mode === 'local') return null
    if (row.device_grant_id) {
      const parent = db.prepare('SELECT * FROM ktv_device_grants WHERE id = ?').get(row.device_grant_id)
      if (!parent || parent.room_id !== row.room_id || parent.member_id !== row.member_id ||
        parent.revoked_at || Date.parse(parent.expires_at) <= Date.now() || (row.scope === 'publisher' && parent.scope !== 'controller')) return null
    }
    const device = getDevices(row.room_id).find(device => device.id === row.device_id && device.memberId === row.member_id && device.connected)
    if (!device || (row.device_grant_id && device.deviceGrantId !== row.device_grant_id)) return null
    const playback = getPlayback(row.room_id)
    if (row.scope === 'publisher') {
      if (device.scope === 'display' || device.mediaProtocol !== 1 || !device.clockHealthy || !device.audioEnabled || device.purpose !== 'stage' ||
        !playback || !['scheduled', 'playing'].includes(playback.state) || playback.stageDeviceId !== row.device_id ||
        playback.stageMemberId !== row.member_id || playback.clockId !== clock.id || !playback.lease ||
        playback.lease.deviceId !== row.device_id || playback.lease.expiresServerMs <= clock.nowMs()) return null
      const singer = playback.singerMemberId === row.member_id
      if (!singer && !(room.performance_mode === 'hybrid' && (member.role === 'host' || member.cohost_at))) return null
    }
    return { room, member, device, playback }
  }
  function valid(row) {
    if (!row || row.state !== 'active') return null
    const current = Date.parse(row.expires_at) > Date.now() ? access(row) : null
    if (!current || (row.scope === 'publisher' && (row.clock_id !== current.playback.clockId || row.performance_id !== current.playback.performanceId ||
      row.generation !== current.playback.generation || row.lease_id !== current.playback.lease.id))) {
      db.prepare("UPDATE ktv_media_grants SET state = 'revoking' WHERE identity = ? AND state = 'active'").run(row.identity)
      return null
    }
    return current
  }
  function expiry(scope, playback) {
    const remaining = scope === 'publisher' ? Math.min(KTV_MEDIA_OUTPUT_PERMIT_MS, playback.lease.expiresServerMs - clock.nowMs()) : audienceLifetimeMs
    if (!Number.isFinite(remaining) || remaining <= 100) fail(409, 'MEDIA_LEASE_EXPIRED', 'Prepare the current performance again')
    return new Date(Date.now() + remaining).toISOString()
  }
  async function signed(row) {
    if (!valid(row)) fail(403, 'MEDIA_REVOKED', 'Media access is unavailable')
    const access = new AccessToken(apiKey, apiSecret, { identity: row.identity, ttl: 120 })
    access.addGrant({ roomJoin: true, room: ktvMediaRoom(row.room_id), canPublish: row.scope === 'publisher',
      canSubscribe: row.scope === 'audience', canPublishData: false,
      canPublishSources: row.scope === 'publisher' ? [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE] : [] })
    const token = await access.toJwt()
    // Permission can change during asynchronous signing; never return a newly
    // signed credential for a revoked membership, lease or performance.
    const latest = db.prepare('SELECT * FROM ktv_media_grants WHERE identity = ?').get(row.identity)
    if (!valid(latest)) fail(403, 'MEDIA_REVOKED', 'Media access is unavailable')
    const permit = row.scope === 'publisher' ? { clockId: row.clock_id, performanceId: row.performance_id,
      generation: row.generation, expiresServerMs: Math.min(getPlayback(row.room_id).lease.expiresServerMs,
        clock.nowMs() + Math.max(0, Date.parse(latest.expires_at) - Date.now())) } : null
    if (permit) publisherDeadlines.set(row.identity, permit.expiresServerMs)
    return { identity: row.identity, scope: row.scope, room: ktvMediaRoom(row.room_id), token,
      expiresAt: latest.expires_at, ...(permit ? { permit } : {}) }
  }

  async function issue({ roomId, memberId, deviceId, deviceGrantId = null, scope, commandId }) {
    if (!uuid(commandId) || !uuid(deviceId) || !['audience', 'publisher'].includes(scope)) fail(400, 'INVALID_MEDIA_REQUEST', 'Choose a media action and device')
    const payloadHash = createHash('sha256').update(JSON.stringify([deviceId, deviceGrantId, scope])).digest('hex')
    const row = transaction(() => {
      const candidate = { room_id: roomId, member_id: memberId, device_id: deviceId, device_grant_id: deviceGrantId, scope }
      const current = access(candidate)
      if (!current) fail(403, 'MEDIA_FORBIDDEN', 'This device cannot use the requested media role')
      const receipt = db.prepare('SELECT * FROM ktv_media_receipts WHERE room_id = ? AND member_id = ? AND command_id = ?').get(roomId, memberId, commandId.toLowerCase())
      if (receipt) {
        if (receipt.payload_hash !== payloadHash) fail(409, 'COMMAND_CONFLICT', 'Command ID already belongs to another request')
        return db.prepare('SELECT * FROM ktv_media_grants WHERE identity = ?').get(receipt.identity)
      }
      const occupied = db.prepare("SELECT * FROM ktv_media_grants WHERE room_id = ? AND device_id = ? AND state != 'revoked'").get(roomId, deviceId)
      if (occupied && occupied.scope !== scope) fail(409, 'MEDIA_REVOCATION_PENDING', 'Stop this device’s previous media role first')
      let grant = db.prepare("SELECT * FROM ktv_media_grants WHERE room_id = ? AND device_id = ? AND scope = ? AND state != 'revoked'").get(roomId, deviceId, scope)
      if (grant && (!valid(grant) || grant.member_id !== memberId || grant.device_grant_id !== deviceGrantId)) fail(409, 'MEDIA_REVOCATION_PENDING', 'Wait for the previous media connection to stop')
      if (!grant) {
        if (scope === 'publisher' && db.prepare("SELECT 1 FROM ktv_media_grants WHERE room_id = ? AND scope = 'publisher' AND state != 'revoked'").get(roomId)) {
          fail(409, 'MEDIA_REVOCATION_PENDING', 'Wait for the previous performer to stop')
        }
        const count = db.prepare("SELECT COUNT(*) total FROM ktv_media_grants WHERE room_id = ? AND member_id = ? AND state != 'revoked'").get(roomId, memberId).total
        if (count >= 3) fail(409, 'MEDIA_DEVICE_LIMIT', 'This member already has three media connections')
        const identity = `ktv-media-${randomUUID()}`, playback = current.playback
        db.prepare(`INSERT INTO ktv_media_grants (identity, room_id, member_id, device_id, device_grant_id, scope,
          clock_id, performance_id, generation, lease_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(identity, roomId, memberId, deviceId, deviceGrantId, scope, scope === 'publisher' ? playback.clockId : null,
            scope === 'publisher' ? playback.performanceId : null, scope === 'publisher' ? playback.generation : null,
            scope === 'publisher' ? playback.lease.id : null, expiry(scope, playback), stamp())
        grant = db.prepare('SELECT * FROM ktv_media_grants WHERE identity = ?').get(identity)
      }
      db.prepare('INSERT INTO ktv_media_receipts VALUES (?, ?, ?, ?, ?, ?)').run(roomId, memberId, commandId.toLowerCase(), payloadHash, grant.identity, stamp())
      return grant
    })
    return signed(row)
  }
  async function renew(identity, memberId, deviceId) {
    const row = db.prepare('SELECT * FROM ktv_media_grants WHERE identity = ?').get(identity), current = valid(row)
    if (!current || row.member_id !== memberId || row.device_id !== deviceId) fail(403, 'MEDIA_REVOKED', 'Media access is unavailable')
    db.prepare('UPDATE ktv_media_grants SET expires_at = ? WHERE identity = ? AND state = ?')
      .run(expiry(row.scope, current.playback), identity, 'active')
    return signed(db.prepare('SELECT * FROM ktv_media_grants WHERE identity = ?').get(identity))
  }
  function receivePermit(identity, memberId, deviceId) {
    const audience = db.prepare('SELECT * FROM ktv_media_grants WHERE identity = ?').get(identity)
    if (!valid(audience) || audience.scope !== 'audience' || audience.member_id !== memberId || audience.device_id !== deviceId)
      fail(403, 'MEDIA_REVOKED', 'Media access is unavailable')
    const publisher = db.prepare("SELECT * FROM ktv_media_grants WHERE room_id = ? AND scope = 'publisher' AND state = 'active'").get(audience.room_id)
    const current = publisher?.ready_at && valid(publisher)
    const sourceDeadline = publisherDeadlines.get(publisher?.identity)
    if (!current || !Number.isFinite(sourceDeadline)) return null
    // A listener's two-minute grant cannot prolong a performer's short lease.
    // Return no tokens or member names; bind output to the exact provider nonce.
    const expiresServerMs = Math.min(sourceDeadline, current.playback.lease.expiresServerMs,
      current.playback.pendingTransition?.effectiveServerMs ?? Infinity,
      clock.nowMs() + Math.max(0, Date.parse(audience.expires_at) - Date.now()))
    if (!Number.isFinite(expiresServerMs) || expiresServerMs <= clock.nowMs() + 100) return null
    if (!reserveReceiveOutput({ roomId: audience.room_id, leaseId: publisher.lease_id, clockId: publisher.clock_id,
      performanceId: publisher.performance_id, generation: publisher.generation, expiresServerMs })) return null
    return { publisherIdentity: publisher.identity, clockId: publisher.clock_id,
      performanceId: publisher.performance_id, generation: publisher.generation, expiresServerMs }
  }
  function authorize(claims) {
    const row = db.prepare('SELECT * FROM ktv_media_grants WHERE identity = ?').get(claims.sub)
    if (!valid(row) || claims.video?.room !== ktvMediaRoom(row.room_id)) return null
    return { identity: row.identity, room: ktvMediaRoom(row.room_id), scope: row.scope }
  }
  function revoke({ roomId, memberId, identity } = {}) {
    if (!roomId && !memberId && !identity) throw new Error('A revocation scope is required')
    const where = [], args = []
    for (const [name, value] of [['room_id', roomId], ['member_id', memberId], ['identity', identity]]) if (value) { where.push(`${name} = ?`); args.push(value) }
    db.prepare(`UPDATE ktv_media_grants SET state = 'revoking' WHERE state = 'active' AND ${where.join(' AND ')}`).run(...args)
    return db.prepare(`SELECT identity, room_id FROM ktv_media_grants WHERE state = 'revoking' AND ${where.join(' AND ')}`).all(...args)
      .map(row => ({ identity: row.identity, room: ktvMediaRoom(row.room_id) }))
  }
  function acknowledgeRemoval(identity) {
    // Called only by the authenticated provider-control path after its removal ack.
    db.prepare("UPDATE ktv_media_grants SET state = 'revoked', revoked_at = ? WHERE identity = ? AND state != 'revoked'").run(stamp(), identity)
    publisherDeadlines.delete(identity)
  }
  function invalidGrants() {
    return db.prepare("SELECT * FROM ktv_media_grants WHERE state != 'revoked'").all().filter(row => !valid(row))
      .map(row => ({ identity: row.identity, room: ktvMediaRoom(row.room_id) })).slice(0, 100)
  }
  function prune(receiptCutoff) {
    db.prepare('DELETE FROM ktv_media_receipts WHERE created_at < ?').run(receiptCutoff)
    db.prepare("DELETE FROM ktv_media_grants WHERE state = 'revoked' AND revoked_at < ? AND identity NOT IN (SELECT identity FROM ktv_media_receipts)").run(receiptCutoff)
    for (const identity of publisherDeadlines.keys()) {
      if (!db.prepare("SELECT 1 FROM ktv_media_grants WHERE identity = ? AND state = 'active'").get(identity)) publisherDeadlines.delete(identity)
    }
  }
  function publisherReady(roomId) {
    const row = db.prepare("SELECT * FROM ktv_media_grants WHERE room_id = ? AND scope = 'publisher' AND state = 'active'").get(roomId)
    return Boolean(row?.ready_at && valid(row))
  }
  function acknowledgeReady(identity) {
    const row = db.prepare('SELECT * FROM ktv_media_grants WHERE identity = ?').get(identity)
    if (!valid(row) || row.scope !== 'publisher') fail(403, 'MEDIA_REVOKED', 'Media access is unavailable')
    db.prepare("UPDATE ktv_media_grants SET ready_at = ? WHERE identity = ? AND state = 'active'").run(stamp(), identity)
  }
  return { issue, renew, receivePermit, authorize, revoke, acknowledgeRemoval, invalidGrants, prune, publisherReady, acknowledgeReady }
}
