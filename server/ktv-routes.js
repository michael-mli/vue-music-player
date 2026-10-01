import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { orderQueue } from './ktv-queue.js'
import { createKtvRealtime } from './ktv-realtime.js'
import { createKtvClock } from './ktv-clock.js'
import { RoomError, fail } from './ktv-errors.js'
import { invalidateReadiness, readinessSnapshot, recoverReadiness } from './ktv-readiness.js'
import { createKtvPlayback } from './ktv-playback.js'
import { ktvPolicy } from './ktv-policy.js'
import { createKtvLifecycle } from './ktv-lifecycle.js'
import { createKtvHttpGuard } from './ktv-http.js'
import { identityCommand, resultCommand, payloadHash, assertSamePayload, sealResult, openResult } from './ktv-receipts.js'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PAIR_LIFETIME_MS = 2 * 60 * 1000

function requireText(value, label, limit) {
  if (typeof value !== 'string') fail(400, 'INVALID_INPUT', `${label} is required`)
  const text = value.trim().replace(/\s+/g, ' ')
  if (!text || [...text].length > limit || /[\u0000-\u001f\u007f]/.test(text)) {
    fail(400, 'INVALID_INPUT', `${label} must be 1–${limit} characters`)
  }
  return text
}

function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function freshCode() {
  return [...randomBytes(8)].map((byte) => ALPHABET[byte & 31]).join('')
}

function hashCode(code, key) {
  return createHmac('sha256', key).update(code).digest('hex')
}

function encryptCode(code, key) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  return {
    cipher: Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]).toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

function decryptCode(row, key) {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.code_iv, 'base64'))
  decipher.setAuthTag(Buffer.from(row.code_tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(row.code_cipher, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

function activeRoom(db, id) {
  const room = db.prepare('SELECT * FROM ktv_rooms WHERE id = ?').get(id)
  if (!room) fail(404, 'ROOM_NOT_FOUND', 'Room not found')
  if (room.status !== 'open' || Date.parse(room.expires_at) <= Date.now()) {
    fail(410, 'ROOM_CLOSED', 'Room has closed')
  }
  return room
}

function currentMember(db, roomId, userId) {
  return db.prepare('SELECT * FROM ktv_members WHERE room_id = ? AND user_id = ?').get(roomId, userId)
}

function hostMember(db, roomId, userId) {
  const member = currentMember(db, roomId, userId)
  if (!member || member.admission !== 'admitted' || member.role !== 'host') {
    fail(403, 'FORBIDDEN', 'Host only')
  }
  return member
}

function isModerator(member) { return member.role === 'host' || Boolean(member.cohost_at) }

function moderatorMember(db, roomId, userId) {
  const member = admittedMember(db, roomId, userId)
  if (!isModerator(member)) fail(403, 'FORBIDDEN', 'Host or co-host only')
  return member
}

function publicMember(member) {
  return {
    id: member.id, displayName: member.display_name,
    role: member.role === 'host' ? 'host' : member.cohost_at ? 'cohost' : 'member',
    admission: member.admission,
  }
}

function admittedMember(db, roomId, userId) {
  const member = currentMember(db, roomId, userId)
  if (!member || member.admission !== 'admitted') fail(403, 'NOT_ADMITTED', 'Room access is not available')
  return member
}

function commandId(req) {
  const id = req.body?.commandId
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    fail(400, 'INVALID_COMMAND', 'A command ID is required')
  }
  return id.toLowerCase()
}

function memberCommandId(req) {
  // Older deployed clients send approve/remove without a command ID. Updated
  // clients send one so a retry can safely return the committed snapshot.
  return req.body?.commandId === undefined ? randomUUID() : commandId(req)
}

function applyCommand(db, roomId, memberId, id, payload, work) {
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  const prior = db.prepare(`SELECT payload_hash FROM ktv_command_receipts
    WHERE room_id = ? AND actor_member_id = ? AND command_id = ?`).get(roomId, memberId, id)
  if (prior) {
    if (prior.payload_hash !== digest) fail(409, 'COMMAND_CONFLICT', 'Command ID was already used')
    return false
  }
  work()
  db.prepare(`INSERT INTO ktv_command_receipts
    (room_id, actor_member_id, command_id, payload_hash, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      roomId, memberId, id, digest, new Date().toISOString(),
    )
  return true
}

function queueSnapshot(db, roomId) {
  const entries = db.prepare(`SELECT q.*, requester.display_name AS requester_name,
    singer.display_name AS singer_name FROM ktv_queue_entries q
    JOIN ktv_members requester ON requester.id = q.requester_member_id
    JOIN ktv_members singer ON singer.id = q.singer_member_id
    WHERE q.room_id = ? AND q.state IN ('queued', 'held') ORDER BY q.created_at, q.rowid`).all(roomId)
    .map((row) => ({
      id: row.id, songId: row.song_id, title: row.title,
      requesterMemberId: row.requester_member_id, requesterName: row.requester_name,
      singerMemberId: row.singer_member_id, singerName: row.singer_name,
      state: row.state, priorityRequested: Boolean(row.priority_requested),
      priorityApproved: Boolean(row.priority_approved),
      singerAccepted: Boolean(row.accepted_at),
    }))
  const round = db.prepare('SELECT COALESCE(MAX(round), 1) AS round FROM ktv_turn_history WHERE room_id = ?').get(roomId).round
  const served = db.prepare('SELECT singer_member_id FROM ktv_turn_history WHERE room_id = ? AND round = ?').all(roomId, round)
  const ordered = orderQueue(entries, served.map(row => row.singer_member_id))
  const offered = db.prepare('SELECT entry_id FROM ktv_readiness WHERE room_id = ?').get(roomId)?.entry_id
  return offered ? [...ordered.filter((entry) => entry.id === offered), ...ordered.filter((entry) => entry.id !== offered)] : ordered
}

function event(db, roomId, userId, action, subjectId = null) {
  db.prepare('INSERT INTO ktv_room_events (room_id, actor_user_id, action, subject_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(roomId, userId, action, subjectId, new Date().toISOString())
}

function bump(db, roomId) {
  db.prepare('UPDATE ktv_rooms SET revision = revision + 1 WHERE id = ?').run(roomId)
}

function addInvite(db, roomId, expiresAt, key) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = freshCode()
    const digest = hashCode(code, key)
    if (db.prepare('SELECT 1 FROM ktv_invitations WHERE code_hash = ?').get(digest)) continue
    const encrypted = encryptCode(code, key)
    db.prepare(`INSERT INTO ktv_invitations
      (id, room_id, code_hash, code_cipher, code_iv, code_tag, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), roomId, digest, encrypted.cipher, encrypted.iv, encrypted.tag, expiresAt,
    )
    return code
  }
  throw new Error('Could not allocate invitation code')
}

function snapshot(db, roomId, userId, key, clock, playback, policy) {
  const room = activeRoom(db, roomId)
  const self = currentMember(db, roomId, userId)
  if (!self || self.admission === 'removed' || self.blocked_at) {
    fail(403, 'NOT_ADMITTED', 'Room access is not available')
  }
  const result = {
    room: {
      id: room.id, name: room.name, approvalRequired: Boolean(room.approval_required),
      locked: Boolean(room.locked), stageInviteVisible: Boolean(room.stage_invite_visible), revision: room.revision, expiresAt: room.expires_at,
    },
    self: publicMember(self),
    clock: { clockId: clock.id, serverNowMs: clock.nowMs() },
  }
  if (self.admission !== 'admitted') return result

  result.limits = { members: policy.members, queue: policy.queue, singerRequests: policy.singerRequests }

  result.members = db.prepare(`SELECT id, display_name, role, cohost_at, admission FROM ktv_members
    WHERE room_id = ? AND admission IN ('admitted', 'pending')
    ORDER BY CASE WHEN role = 'host' THEN 0 ELSE 1 END, joined_at, id`).all(roomId)
    .filter((row) => isModerator(self) || row.admission === 'admitted')
    .map(publicMember)
  if (isModerator(self)) {
    result.excludedMembers = db.prepare(`SELECT id, display_name, role, cohost_at, admission, blocked_at
      FROM ktv_members WHERE room_id = ? AND admission IN ('removed', 'rejected')
      ORDER BY updated_at DESC, id LIMIT 100`).all(roomId)
      .map((row) => ({ ...publicMember(row), blocked: Boolean(row.blocked_at) }))
  }
  result.queue = queueSnapshot(db, roomId)
  result.readiness = readinessSnapshot(db, roomId, clock)
  if (playback) {
    result.playback = playback.snapshot(roomId)
    result.presence = playback.presence(roomId)
  }
  if (self.role === 'host' || room.stage_invite_visible) {
    const invite = db.prepare(`SELECT * FROM ktv_invitations WHERE room_id = ? AND revoked_at IS NULL
      ORDER BY rowid DESC LIMIT 1`).get(roomId)
    const code = invite ? decryptCode(invite, key) : null
    if (self.role === 'host') result.invitationCode = code
    if (room.stage_invite_visible && !room.locked) result.stageInvitationCode = code
  }
  return result
}

function grantSnapshot(db, roomId, grantId, key, clock, playback, policy) {
  const grant = db.prepare(`SELECT g.*, m.user_id, m.admission FROM ktv_device_grants g
    JOIN ktv_members m ON m.id = g.member_id WHERE g.id = ? AND g.room_id = ?`).get(grantId, roomId)
  if (!grant || grant.revoked_at || Date.parse(grant.expires_at) <= Date.now() || grant.admission !== 'admitted') {
    fail(403, 'DEVICE_REVOKED', 'Device access is unavailable')
  }
  const result = snapshot(db, roomId, grant.user_id, key, clock, playback, policy)
  if (grant.scope === 'display') {
    delete result.invitationCode
    delete result.excludedMembers
    result.members = result.members.filter((member) => member.admission === 'admitted')
  }
  result.deviceScope = grant.scope
  result.deviceId = grant.id
  return result
}

export function registerKtvRoutes(app, { db, authMiddleware, secret, isKaraokeSong, allowedOrigins, resolveAssets, clock = createKtvClock(), hostGraceMs, policy: policyOptions }) {
  const policy = ktvPolicy(policyOptions)
  app.use('/api/ktv', createKtvHttpGuard({ allowedOrigins }))
  recoverReadiness(db, clock)
  const key = createHash('sha256').update('ktv-invitation-v1\0').update(secret).digest()
  const pairKey = createHash('sha256').update('ktv-pairing-v1\0').update(secret).digest()
  const grantKey = createHash('sha256').update('ktv-grant-v1\0').update(secret).digest()
  const resultKey = createHash('sha256').update('ktv-command-result-v1\0').update(secret).digest()
  const joinHits = new Map()
  const redeemHits = new Map()
  let playback
  const realtime = createKtvRealtime({
    getSnapshot: (roomId, principal) => principal.kind === 'device'
      ? grantSnapshot(db, roomId, principal.grantId, key, clock, playback, policy)
      : snapshot(db, roomId, principal.userId, key, clock, playback, policy),
    allowedOrigins,
    clock,
    onConnected: (ws, view) => playback.connected(ws, view),
    onDisconnected: (ws) => playback.disconnected(ws),
    onDevice: (ws, message, view) => playback.deviceMessage(ws, message, view),
  })
  playback = createKtvPlayback({ db, clock, transaction, bump, event, broadcast: realtime.broadcast, broadcastLease: realtime.broadcastLease, hostGraceMs })
  function closeRoom(roomId, actorId, action, now = new Date().toISOString()) {
    invalidateReadiness(db, roomId, clock)
    playback.invalidate(roomId)
    db.prepare("UPDATE ktv_rooms SET status = 'closed', closed_at = ?, revision = revision + 1 WHERE id = ?")
      .run(now, roomId)
    for (const table of ['ktv_invitations', 'ktv_pairings', 'ktv_device_grants']) {
      db.prepare(`UPDATE ${table} SET revoked_at = ? WHERE room_id = ? AND revoked_at IS NULL`).run(now, roomId)
    }
    event(db, roomId, actorId, action)
  }
  const lifecycle = createKtvLifecycle({ db, policy, transaction, closeRoom, broadcast: realtime.broadcast,
    occupied: roomId => playback.presence(roomId).devices.some(device => device.connected) })
  const closeRealtime = realtime.close
  realtime.close = () => { lifecycle.close(); playback.close(); closeRealtime() }
  realtime.playback = playback
  realtime.lifecycle = lifecycle

  function handler(work, changed = false) {
    return (req, res) => {
      res.set('Cache-Control', 'no-store')
      try {
        const data = work(req)
        res.json({ success: true, data })
        if (changed) realtime.broadcast(req.params.id || data.room?.id || data.roomId || data.id)
      }
      catch (error) {
        if (!(error instanceof RoomError)) console.error('[ktv]', error)
        res.status(error.status || 500).json({
          success: false, code: error.code || 'ROOM_ERROR',
          message: error.status ? error.message : 'Room request failed',
        })
      }
    }
  }

  function user(req) {
    const found = db.prepare('SELECT id, name, username, kind FROM users WHERE id = ?').get(req.auth.sub)
    if (!found) fail(401, 'IDENTITY_UNAVAILABLE', 'User session no longer exists')
    return found
  }

  function displayName(req, actor) {
    return requireText(req.body?.displayName ?? (actor.kind === 'guest' ? null : actor.name || actor.username), 'Your name', 40)
  }

  function roomAccess(control = false, allowCloseReplay = false) {
    return (req, res, next) => {
      if (!req.headers.authorization?.startsWith('KtvDevice ')) return authMiddleware(req, res, next)
      res.set('Cache-Control', 'no-store')
      const credential = req.headers.authorization.slice('KtvDevice '.length)
      if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) {
        return res.status(401).json({ success: false, code: 'INVALID_DEVICE', message: 'Invalid device credential' })
      }
      const grant = db.prepare(`SELECT g.*, m.user_id, m.admission FROM ktv_device_grants g
        JOIN ktv_members m ON m.id = g.member_id WHERE g.secret_hash = ? AND g.room_id = ?`)
        .get(hashCode(credential, grantKey), req.params.id)
      const closeReplay = allowCloseReplay && grant?.scope === 'controller' && typeof req.body?.commandId === 'string' &&
        db.prepare(`SELECT c.payload_hash FROM ktv_command_receipts c JOIN ktv_rooms r ON r.id = c.room_id
          WHERE c.room_id = ? AND c.actor_member_id = ? AND c.command_id = ? AND r.status = 'closed'`)
          .get(req.params.id, grant.member_id, req.body.commandId.toLowerCase())?.payload_hash === payloadHash(['room.close'])
      if (!grant || (grant.revoked_at && !closeReplay) || Date.parse(grant.expires_at) <= Date.now() || grant.admission !== 'admitted' ||
        (control && grant.scope !== 'controller')) {
        return res.status(403).json({ success: false, code: 'DEVICE_REVOKED', message: 'Device access is unavailable' })
      }
      req.ktvGrant = grant
      req.auth = { sub: grant.user_id }
      next()
    }
  }

  function viewerSnapshot(req) {
    return req.ktvGrant
      ? grantSnapshot(db, req.params.id, req.ktvGrant.id, key, clock, playback, policy)
      : snapshot(db, req.params.id, user(req).id, key, clock, playback, policy)
  }

  app.post('/api/ktv/rooms', authMiddleware, handler((req) => {
    const actor = user(req)
    const id = memberCommandId(req)
    const name = requireText(req.body?.name, 'Room name', 80)
    const personName = displayName(req, actor)
    const approvalRequired = req.body?.approvalRequired !== false
    const roomId = randomUUID()
    const memberId = randomUUID()
    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + policy.roomLifetimeMs).toISOString()
    return transaction(db, () => {
      const originalRoomId = identityCommand(db, actor.id, id, ['room.create', name, personName, approvalRequired], () => {
        db.prepare(`INSERT INTO ktv_rooms (id, name, approval_required, created_at, expires_at, empty_since_at)
          VALUES (?, ?, ?, ?, ?, ?)`).run(roomId, name, Number(approvalRequired), createdAt, expiresAt, createdAt)
        db.prepare(`INSERT INTO ktv_members
          (id, room_id, user_id, display_name, role, admission, joined_at, updated_at)
          VALUES (?, ?, ?, ?, 'host', 'admitted', ?, ?)`).run(
          memberId, roomId, actor.id, personName, createdAt, createdAt,
        )
        addInvite(db, roomId, expiresAt, key)
        event(db, roomId, actor.id, 'room.created')
        return roomId
      })
      return snapshot(db, originalRoomId, actor.id, key, clock, playback, policy)
    })
  }, true))

  app.post('/api/ktv/join', authMiddleware, handler((req) => {
    const actor = user(req), id = memberCommandId(req)
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : ''
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) fail(400, 'INVALID_INVITATION', 'Invalid invitation code')
    const nameInput = typeof req.body?.displayName === 'string' ? req.body.displayName.trim().replace(/\s+/g, ' ') : null
    const recent = (joinHits.get(actor.id) || []).filter((time) => Date.now() - time < 60_000)
    if (recent.length >= 20) fail(429, 'TOO_MANY_ATTEMPTS', 'Please wait before trying another code')
    recent.push(Date.now()); joinHits.set(actor.id, recent)
    while (joinHits.size > 1000) joinHits.delete(joinHits.keys().next().value)
    return transaction(db, () => {
      const roomId = identityCommand(db, actor.id, id, ['room.join', hashCode(code, key), nameInput], () => {
        const invite = db.prepare('SELECT * FROM ktv_invitations WHERE code_hash = ?').get(hashCode(code, key))
        if (!invite || invite.revoked_at || Date.parse(invite.expires_at) <= Date.now()) {
          fail(400, 'INVALID_INVITATION', 'Invalid or expired invitation code')
        }
        const room = activeRoom(db, invite.room_id)
        const existing = currentMember(db, room.id, actor.id)
        if (existing?.admission === 'admitted' || existing?.admission === 'pending') return room.id
        if (existing?.blocked_at) fail(403, 'ROOM_BLOCKED', 'You are blocked from this room')
        if (existing) fail(403, 'NOT_ADMITTED', 'Ask a host or co-host to restore your room access')
        if (room.locked) fail(403, 'ROOM_LOCKED', 'Room is locked')
        const name = displayName(req, actor)
        const count = db.prepare(`SELECT COUNT(*) AS total FROM ktv_members
          WHERE room_id = ? AND admission IN ('admitted', 'pending')`).get(room.id).total
        if (count >= policy.members) fail(409, 'ROOM_FULL', 'Room is full')
        const now = new Date().toISOString()
        db.prepare(`INSERT INTO ktv_members
          (id, room_id, user_id, display_name, role, admission, joined_at, updated_at)
          VALUES (?, ?, ?, ?, 'member', ?, ?, ?)`).run(
          randomUUID(), room.id, actor.id, name, room.approval_required ? 'pending' : 'admitted', now, now,
        )
        bump(db, room.id); event(db, room.id, actor.id, 'member.joined')
        return room.id
      })
      return snapshot(db, roomId, actor.id, key, clock, playback, policy)
    })
  }, true))

  // Resolve an invitation without creating membership. Returning participants
  // retain their chosen name and admission; new guests still choose a name.
  app.post('/api/ktv/invitations/resolve', authMiddleware, handler((req) => {
    const actor = user(req)
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : ''
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) fail(400, 'INVALID_INVITATION', 'Invalid invitation code')
    const recent = (joinHits.get(actor.id) || []).filter(time => Date.now() - time < 60_000)
    if (recent.length >= 20) fail(429, 'TOO_MANY_ATTEMPTS', 'Please wait before trying another code')
    recent.push(Date.now()); joinHits.set(actor.id, recent)
    while (joinHits.size > 1000) joinHits.delete(joinHits.keys().next().value)
    const invite = db.prepare('SELECT * FROM ktv_invitations WHERE code_hash = ?').get(hashCode(code, key))
    if (!invite || invite.revoked_at || Date.parse(invite.expires_at) <= Date.now()) {
      fail(400, 'INVALID_INVITATION', 'Invalid or expired invitation code')
    }
    const room = activeRoom(db, invite.room_id), existing = currentMember(db, room.id, actor.id)
    if (existing?.admission === 'admitted' || existing?.admission === 'pending') {
      return { membership: snapshot(db, room.id, actor.id, key, clock, playback, policy) }
    }
    if (existing?.blocked_at) fail(403, 'ROOM_BLOCKED', 'You are blocked from this room')
    if (existing) fail(403, 'NOT_ADMITTED', 'Ask a host or co-host to restore your room access')
    if (room.locked) fail(403, 'ROOM_LOCKED', 'Room is locked')
    return { membership: null }
  }))

  app.get('/api/ktv/rooms', authMiddleware, handler((req) => {
    const actor = user(req)
    return db.prepare(`SELECT r.id, r.name, r.status, r.expires_at, m.display_name, m.admission
      FROM ktv_members m JOIN ktv_rooms r ON r.id = m.room_id
      WHERE m.user_id = ? AND m.admission IN ('admitted', 'pending')
      ORDER BY m.updated_at DESC LIMIT 30`).all(actor.id)
      .filter((row) => row.status === 'open' && Date.parse(row.expires_at) > Date.now())
      .map((row) => ({ id: row.id, name: row.name, displayName: row.display_name, admission: row.admission }))
  }))

  app.get('/api/ktv/rooms/:id', roomAccess(), handler((req) => {
    return viewerSnapshot(req)
  }))

  app.post('/api/ktv/rooms/:id/socket-ticket', roomAccess(), handler((req) => {
    const view = viewerSnapshot(req)
    const clientDeviceId = req.body?.deviceId ?? randomUUID()
    if (typeof clientDeviceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(clientDeviceId)) fail(400, 'INVALID_DEVICE', 'A device ID is required')
    return realtime.issueTicket(req.params.id, req.ktvGrant
      ? { kind: 'device', grantId: req.ktvGrant.id, memberId: view.self.id, clientDeviceId }
      : { kind: 'user', userId: req.auth.sub, memberId: view.self.id, clientDeviceId })
  }))

  app.post('/api/ktv/rooms/:id/pairings', authMiddleware, handler((req) => {
    const actor = user(req)
    const id = memberCommandId(req)
    const scope = req.body?.scope
    if (scope !== 'display' && scope !== 'controller') fail(400, 'INVALID_SCOPE', 'Choose a device scope')
    return transaction(db, () => {
      const room = activeRoom(db, req.params.id)
      const member = admittedMember(db, room.id, actor.id)
      return resultCommand(db, room.id, member.id, id, ['device.pairing.create', scope], resultKey, () => {
        const active = db.prepare(`SELECT COUNT(*) AS total FROM ktv_device_grants
          WHERE room_id = ? AND member_id = ? AND revoked_at IS NULL AND expires_at > ?`)
          .get(room.id, member.id, new Date().toISOString()).total
        if (active >= policy.deviceGrants) fail(409, 'DEVICE_LIMIT', 'Revoke a device before pairing another')
        const now = new Date().toISOString()
        db.prepare(`UPDATE ktv_pairings SET revoked_at = ?
          WHERE room_id = ? AND member_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL`)
          .run(now, room.id, member.id)
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = freshCode()
          const digest = hashCode(code, pairKey)
          if (db.prepare('SELECT 1 FROM ktv_pairings WHERE code_hash = ?').get(digest)) continue
          const expiresAt = new Date(Math.min(Date.now() + PAIR_LIFETIME_MS, Date.parse(room.expires_at))).toISOString()
          db.prepare(`INSERT INTO ktv_pairings
            (id, room_id, member_id, code_hash, scope, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), room.id, member.id, digest, scope, now, expiresAt)
          event(db, room.id, actor.id, 'device.pairing_created', member.id)
          return { code, scope, expiresAt }
        }
        throw new Error('Could not allocate pairing code')
      })
    })
  }))

  app.post('/api/ktv/pairings/redeem', handler((req) => {
    const id = memberCommandId(req)
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : ''
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) fail(400, 'INVALID_PAIRING', 'Invalid pairing code')
    const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.socket.remoteAddress || 'unknown').slice(0, 100)
    const nowMs = Date.now()
    const hits = (redeemHits.get(ip) || []).filter((time) => nowMs - time < 60_000)
    if (hits.length >= 20) fail(429, 'TOO_MANY_ATTEMPTS', 'Please wait before trying another code')
    hits.push(nowMs)
    redeemHits.set(ip, hits)
    if (redeemHits.size > 1000) {
      for (const [address, attempts] of redeemHits) {
        if (attempts.at(-1) < nowMs - 60_000) redeemHits.delete(address)
      }
      while (redeemHits.size > 1000) redeemHits.delete(redeemHits.keys().next().value)
    }
    return transaction(db, () => {
      const pairing = db.prepare('SELECT * FROM ktv_pairings WHERE code_hash = ?')
        .get(hashCode(code, pairKey))
      const digest = payloadHash(['device.pairing.redeem', hashCode(code, pairKey)])
      const prior = pairing && db.prepare('SELECT * FROM ktv_pairing_receipts WHERE pairing_id = ? AND command_id = ?').get(pairing.id, id)
      if (prior) {
        assertSamePayload(prior, digest)
        const grant = db.prepare(`SELECT g.*, m.admission FROM ktv_device_grants g JOIN ktv_members m ON m.id = g.member_id WHERE g.id = ?`).get(prior.grant_id)
        if (!grant || grant.revoked_at || grant.admission !== 'admitted' || Date.parse(grant.expires_at) <= Date.now()) {
          fail(403, 'DEVICE_REVOKED', 'Device access is unavailable')
        }
        activeRoom(db, grant.room_id)
        return openResult(prior, resultKey)
      }
      if (!pairing || pairing.redeemed_at || pairing.revoked_at || Date.parse(pairing.expires_at) <= Date.now()) {
        fail(400, 'INVALID_PAIRING', 'Invalid or expired pairing code')
      }
      const room = activeRoom(db, pairing.room_id)
      const member = db.prepare('SELECT * FROM ktv_members WHERE id = ? AND room_id = ?')
        .get(pairing.member_id, room.id)
      if (!member || member.admission !== 'admitted') fail(403, 'NOT_ADMITTED', 'Room access is unavailable')
      const active = db.prepare(`SELECT COUNT(*) AS total FROM ktv_device_grants
        WHERE room_id = ? AND member_id = ? AND revoked_at IS NULL AND expires_at > ?`)
        .get(room.id, member.id, new Date().toISOString()).total
      if (active >= policy.deviceGrants) fail(409, 'DEVICE_LIMIT', 'Device limit reached')
      const credential = randomBytes(32).toString('base64url')
      const deviceId = randomUUID()
      const now = new Date().toISOString()
      db.prepare(`INSERT INTO ktv_device_grants
        (id, room_id, member_id, scope, secret_hash, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          deviceId, room.id, member.id, pairing.scope, hashCode(credential, grantKey), now, room.expires_at,
        )
      db.prepare('UPDATE ktv_pairings SET redeemed_at = ? WHERE id = ?').run(now, pairing.id)
      event(db, room.id, member.user_id, 'device.paired', deviceId)
      const result = { roomId: room.id, memberId: member.id, deviceId, scope: pairing.scope,
        credential, expiresAt: room.expires_at }
      const sealed = sealResult(result, resultKey)
      db.prepare(`INSERT INTO ktv_pairing_receipts
        (pairing_id, command_id, grant_id, payload_hash, result_cipher, result_iv, result_tag, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(pairing.id, id, deviceId, digest, sealed.cipher, sealed.iv, sealed.tag, now)
      return result
    })
  }, true))

  app.get('/api/ktv/rooms/:id/devices', authMiddleware, handler((req) => {
    const actor = user(req)
    activeRoom(db, req.params.id)
    const member = admittedMember(db, req.params.id, actor.id)
    return db.prepare(`SELECT id, scope, created_at, expires_at FROM ktv_device_grants
      WHERE room_id = ? AND member_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC`).all(req.params.id, member.id, new Date().toISOString())
      .map((row) => ({ id: row.id, scope: row.scope, createdAt: row.created_at, expiresAt: row.expires_at }))
  }))

  app.post('/api/ktv/rooms/:id/devices/:deviceId/revoke', authMiddleware, handler((req) => {
    const actor = user(req)
    const id = memberCommandId(req)
    return transaction(db, () => {
      activeRoom(db, req.params.id)
      const member = admittedMember(db, req.params.id, actor.id)
      applyCommand(db, req.params.id, member.id, id, ['device.revoke', req.params.deviceId], () => {
        const grant = db.prepare('SELECT * FROM ktv_device_grants WHERE id = ? AND room_id = ?')
          .get(req.params.deviceId, req.params.id)
        if (!grant || grant.revoked_at || (grant.member_id !== member.id && member.role !== 'host')) {
          fail(403, 'FORBIDDEN', 'Cannot revoke this device')
        }
        db.prepare('UPDATE ktv_device_grants SET revoked_at = ? WHERE id = ?')
          .run(new Date().toISOString(), grant.id)
        event(db, req.params.id, actor.id, 'device.revoked', grant.id)
      })
      return { id: req.params.id, deviceId: req.params.deviceId, status: 'revoked' }
    })
  }, true))

  function changeMember(action) {
    app.post(`/api/ktv/rooms/:id/members/:memberId/${action}`, roomAccess(true), handler((req) => {
      const actor = user(req)
      const id = ['approve', 'remove'].includes(action) ? memberCommandId(req) : commandId(req)
      let revokedMemberId
      const result = transaction(db, () => {
        activeRoom(db, req.params.id)
        const member = admittedMember(db, req.params.id, actor.id)
        applyCommand(db, req.params.id, member.id, id, ['member.' + action, req.params.memberId], () => {
          moderatorMember(db, req.params.id, actor.id)
          const target = db.prepare('SELECT * FROM ktv_members WHERE room_id = ? AND id = ?')
            .get(req.params.id, req.params.memberId)
          if (!target || target.role === 'host' || target.id === member.id) {
            fail(409, 'INVALID_MEMBER_STATE', 'Member state cannot be changed')
          }
          if (member.role !== 'host' && target.cohost_at) fail(403, 'FORBIDDEN', 'Only the host can moderate a co-host')
          if ((action === 'approve' && (target.blocked_at || !['pending', 'removed', 'rejected'].includes(target.admission))) ||
              (action === 'reject' && target.admission !== 'pending') ||
              (action === 'remove' && !['pending', 'admitted'].includes(target.admission)) ||
              (action === 'block' && target.blocked_at) ||
              (action === 'unblock' && !target.blocked_at)) {
            fail(409, 'INVALID_MEMBER_STATE', 'Member state cannot be changed')
          }
          if (action === 'approve') {
            const count = db.prepare(`SELECT COUNT(*) AS total FROM ktv_members
              WHERE room_id = ? AND admission IN ('admitted', 'pending')`).get(req.params.id).total
            if (target.admission !== 'pending' && count >= policy.members) fail(409, 'ROOM_FULL', 'Room is full')
          }
          const now = new Date().toISOString()
          const nextState = action === 'approve' ? 'admitted' : action === 'reject' ? 'rejected' : 'removed'
          db.prepare(`UPDATE ktv_members SET admission = ?, blocked_at = ?, cohost_at = NULL,
            updated_at = ? WHERE id = ?`).run(nextState, action === 'block' ? now : null, now, target.id)
          if (action !== 'approve' && action !== 'unblock') {
            playback.invalidate(req.params.id, { memberId: target.id })
            invalidateReadiness(db, req.params.id, clock, { memberId: target.id })
            db.prepare(`UPDATE ktv_queue_entries SET state = 'held', updated_at = ?
              WHERE room_id = ? AND singer_member_id = ? AND state = 'queued'`)
              .run(now, req.params.id, target.id)
            db.prepare(`UPDATE ktv_pairings SET revoked_at = ?
              WHERE room_id = ? AND member_id = ? AND revoked_at IS NULL`).run(now, req.params.id, target.id)
            db.prepare(`UPDATE ktv_device_grants SET revoked_at = ?
              WHERE room_id = ? AND member_id = ? AND revoked_at IS NULL`).run(now, req.params.id, target.id)
            revokedMemberId = target.id
          }
          bump(db, req.params.id)
          event(db, req.params.id, actor.id, `member.${action}`, target.id)
        })
        return viewerSnapshot(req)
      })
      if (revokedMemberId) realtime.revokeMember(req.params.id, revokedMemberId)
      return result
    }, true))
  }
  for (const action of ['approve', 'reject', 'remove', 'block', 'unblock']) changeMember(action)

  app.post('/api/ktv/rooms/:id/members/:memberId/role', roomAccess(true), handler((req) => {
    const actor = user(req)
    const id = commandId(req)
    const role = req.body?.role
    if (role !== 'cohost' && role !== 'member') fail(400, 'INVALID_ROLE', 'Choose member or co-host')
    return transaction(db, () => {
      activeRoom(db, req.params.id)
      const member = admittedMember(db, req.params.id, actor.id)
      applyCommand(db, req.params.id, member.id, id, ['member.role', req.params.memberId, role], () => {
        hostMember(db, req.params.id, actor.id)
        const target = db.prepare('SELECT * FROM ktv_members WHERE room_id = ? AND id = ?')
          .get(req.params.id, req.params.memberId)
        if (!target || target.role === 'host' || target.admission !== 'admitted' || target.blocked_at) {
          fail(409, 'INVALID_MEMBER_STATE', 'Only an admitted member can change roles')
        }
        if (Boolean(target.cohost_at) === (role === 'cohost')) return
        const now = new Date().toISOString()
        db.prepare('UPDATE ktv_members SET cohost_at = ?, updated_at = ? WHERE id = ?')
          .run(role === 'cohost' ? now : null, now, target.id)
        bump(db, req.params.id)
        event(db, req.params.id, actor.id, `member.role.${role}`, target.id)
      })
      return viewerSnapshot(req)
    })
  }, true))

  app.post('/api/ktv/rooms/:id/members/:memberId/transfer-host', roomAccess(true), handler((req) => {
    const actor = user(req)
    const id = commandId(req)
    return transaction(db, () => {
      activeRoom(db, req.params.id)
      const member = admittedMember(db, req.params.id, actor.id)
      applyCommand(db, req.params.id, member.id, id, ['member.transfer-host', req.params.memberId], () => {
        hostMember(db, req.params.id, actor.id)
        const target = db.prepare('SELECT * FROM ktv_members WHERE room_id = ? AND id = ?')
          .get(req.params.id, req.params.memberId)
        if (!target || target.id === member.id || target.admission !== 'admitted' || target.blocked_at) {
          fail(409, 'INVALID_MEMBER_STATE', 'Choose another admitted member as host')
        }
        const now = new Date().toISOString()
        // Demote first to preserve the unique host index. Both updates, receipt,
        // audit event and revision commit atomically before any snapshot is sent.
        db.prepare("UPDATE ktv_members SET role = 'member', cohost_at = NULL, updated_at = ? WHERE id = ?")
          .run(now, member.id)
        db.prepare("UPDATE ktv_members SET role = 'host', cohost_at = NULL, updated_at = ? WHERE id = ?")
          .run(now, target.id)
        bump(db, req.params.id)
        event(db, req.params.id, actor.id, 'room.host_transferred', target.id)
      })
      return viewerSnapshot(req)
    })
  }, true))

  app.post('/api/ktv/rooms/:id/queue', roomAccess(true), handler((req) => {
    const actor = user(req)
    const id = commandId(req)
    const songId = req.body?.songId
    if (!Number.isSafeInteger(songId) || songId <= 0) fail(400, 'INVALID_SONG', 'Choose a valid song')
    const title = requireText(req.body?.title, 'Song title', 160)
    if (typeof req.body?.requestNext !== 'boolean') fail(400, 'INVALID_INPUT', 'Request type is required')
    const requestNext = req.body.requestNext
    return transaction(db, () => {
      activeRoom(db, req.params.id)
      const member = admittedMember(db, req.params.id, actor.id)
      const singerId = req.body?.singerMemberId ?? member.id
      const payload = ['queue.request', songId, title, requestNext]
      if (req.body?.singerMemberId !== undefined) payload.push(singerId)
      applyCommand(db, req.params.id, member.id, id, payload, () => {
        if (typeof singerId !== 'string') fail(400, 'INVALID_SINGER', 'Choose an admitted singer')
        const singer = db.prepare('SELECT * FROM ktv_members WHERE room_id = ? AND id = ?').get(req.params.id, singerId)
        if (!singer || singer.admission !== 'admitted') fail(409, 'INVALID_SINGER', 'Singer is not admitted to the room')
        if (!isKaraokeSong?.(songId)) fail(409, 'SONG_UNAVAILABLE', 'Karaoke backing is unavailable for this song')
        const pending = db.prepare(`SELECT COUNT(*) AS total FROM ktv_queue_entries
          WHERE room_id = ? AND singer_member_id = ? AND state = 'queued'`).get(req.params.id, singerId).total
        if (pending >= policy.singerRequests) fail(409, 'SINGER_QUEUE_FULL', `Singer already has ${policy.singerRequests} pending songs`)
        const total = db.prepare(`SELECT COUNT(*) AS total FROM ktv_queue_entries
          WHERE room_id = ? AND state IN ('queued', 'held')`).get(req.params.id).total
        if (total >= policy.queue) fail(409, 'QUEUE_FULL', 'Room queue is full')
        const now = new Date().toISOString()
        const entryId = randomUUID()
        db.prepare(`INSERT INTO ktv_queue_entries
          (id, room_id, song_id, title, requester_member_id, singer_member_id,
           accepted_at, priority_requested, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            entryId, req.params.id, songId, title, member.id, singerId,
            singerId === member.id ? now : null, Number(requestNext), now, now,
          )
        bump(db, req.params.id)
        event(db, req.params.id, actor.id, 'queue.requested', entryId)
      })
      return viewerSnapshot(req)
    })
  }, true))

  app.post('/api/ktv/rooms/:id/queue/:entryId/cancel', roomAccess(true), handler((req) => {
    const actor = user(req)
    const id = commandId(req)
    return transaction(db, () => {
      activeRoom(db, req.params.id)
      const member = admittedMember(db, req.params.id, actor.id)
      applyCommand(db, req.params.id, member.id, id, ['queue.cancel', req.params.entryId], () => {
        const entry = db.prepare('SELECT * FROM ktv_queue_entries WHERE room_id = ? AND id = ?')
          .get(req.params.id, req.params.entryId)
        if (!entry || !['queued', 'held'].includes(entry.state)) fail(409, 'INVALID_QUEUE_STATE', 'Song is not queued')
        if (!isModerator(member) && entry.requester_member_id !== member.id) fail(403, 'FORBIDDEN', 'Cannot remove this song')
        invalidateReadiness(db, req.params.id, clock, { entryId: entry.id })
        playback.invalidate(req.params.id, { entryId: entry.id })
        db.prepare("UPDATE ktv_queue_entries SET state = 'cancelled', updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), entry.id)
        bump(db, req.params.id)
        event(db, req.params.id, actor.id, 'queue.cancelled', entry.id)
      })
      return viewerSnapshot(req)
    })
  }, true))

  app.post('/api/ktv/rooms/:id/queue/:entryId/approve-next', roomAccess(true), handler((req) => {
    const actor = user(req)
    const id = commandId(req)
    return transaction(db, () => {
      activeRoom(db, req.params.id)
      const member = moderatorMember(db, req.params.id, actor.id)
      applyCommand(db, req.params.id, member.id, id, ['queue.approve-next', req.params.entryId], () => {
        const entry = db.prepare('SELECT * FROM ktv_queue_entries WHERE room_id = ? AND id = ?')
          .get(req.params.id, req.params.entryId)
        if (!entry || entry.state !== 'queued' || !entry.priority_requested || entry.priority_approved) {
          fail(409, 'INVALID_QUEUE_STATE', 'Priority request cannot be approved')
        }
        db.prepare('UPDATE ktv_queue_entries SET priority_approved = 1, updated_at = ? WHERE id = ?')
          .run(new Date().toISOString(), entry.id)
        bump(db, req.params.id)
        event(db, req.params.id, actor.id, 'queue.priority_approved', entry.id)
      })
      return viewerSnapshot(req)
    })
  }, true))

  for (const action of ['accept', 'decline']) {
    app.post(`/api/ktv/rooms/:id/queue/:entryId/${action}`, roomAccess(true), handler((req) => {
      const actor = user(req)
      const id = commandId(req)
      return transaction(db, () => {
        activeRoom(db, req.params.id)
        const member = admittedMember(db, req.params.id, actor.id)
        applyCommand(db, req.params.id, member.id, id, ['queue.' + action, req.params.entryId], () => {
          const entry = db.prepare('SELECT * FROM ktv_queue_entries WHERE room_id = ? AND id = ?')
            .get(req.params.id, req.params.entryId)
          if (!entry || entry.state !== 'queued') fail(409, 'INVALID_QUEUE_STATE', 'Song is not queued')
          if (entry.singer_member_id !== member.id) fail(403, 'FORBIDDEN', 'Only the nominated singer can respond')
          if (action === 'accept' && entry.accepted_at) return
          const now = new Date().toISOString()
          if (action === 'accept') {
            db.prepare('UPDATE ktv_queue_entries SET accepted_at = ?, updated_at = ? WHERE id = ?').run(now, now, entry.id)
          } else {
            const turn = db.prepare('SELECT entry_id, state FROM ktv_readiness WHERE room_id = ?').get(req.params.id)
            if (turn?.state !== 'idle' && turn?.entry_id === entry.id) playback.decline(req.params.id, entry)
            else db.prepare("UPDATE ktv_queue_entries SET state = 'cancelled', updated_at = ? WHERE id = ?").run(now, entry.id)
          }
          bump(db, req.params.id)
          event(db, req.params.id, actor.id, `queue.singer_${action}`, entry.id)
        })
        return viewerSnapshot(req)
      })
    }, true))
  }

  function checkClock(req) {
    if (req.body?.clockId !== clock.id) fail(409, 'STALE_CLOCK', 'Room timing changed. Refresh and try again')
  }
  function checkRevision(req, room) {
    if (!Number.isSafeInteger(req.body?.baseRevision) || req.body.baseRevision < 1) {
      fail(400, 'INVALID_REVISION', 'A room revision is required')
    }
    if (req.body.baseRevision !== room.revision) fail(409, 'REVISION_CONFLICT', 'Room changed. Review it and try again')
  }
  function currentTurn(req) {
    checkClock(req)
    const turn = db.prepare('SELECT * FROM ktv_readiness WHERE room_id = ?').get(req.params.id)
    if (!turn || turn.state === 'idle' || req.body?.performanceId !== turn.performance_id ||
      req.body?.generation !== turn.generation || turn.clock_id !== clock.id) {
      fail(409, 'STALE_GENERATION', 'Singer invitation changed. Review it and try again')
    }
    return turn
  }

  app.post('/api/ktv/rooms/:id/readiness/offer', roomAccess(true), handler((req) => {
    const actor = user(req)
    const id = commandId(req)
    const { entryId, clockId, baseRevision } = req.body || {}
    return transaction(db, () => {
      const room = activeRoom(db, req.params.id)
      const member = admittedMember(db, room.id, actor.id)
      applyCommand(db, room.id, member.id, id, ['readiness.offer', entryId, clockId, baseRevision], () => {
        moderatorMember(db, room.id, actor.id)
        checkClock(req); checkRevision(req, room)
        const entry = typeof entryId === 'string' && db.prepare(`SELECT q.*, m.admission FROM ktv_queue_entries q
          JOIN ktv_members m ON m.id = q.singer_member_id WHERE q.room_id = ? AND q.id = ?`).get(room.id, entryId)
        if (!entry || entry.state !== 'queued' || !entry.accepted_at || entry.admission !== 'admitted') {
          fail(409, 'SINGER_NOT_ACCEPTED', 'Choose a queued song accepted by its singer')
        }
        if (['playing', 'scheduled'].includes(playback.read(room.id)?.state)) {
          fail(409, 'PLAYBACK_ACTIVE', 'Pause or skip the current performance before choosing another singer')
        }
        playback.invalidate(room.id)
        const now = new Date().toISOString()
        db.prepare(`INSERT INTO ktv_readiness (room_id, entry_id, performance_id, generation, clock_id, state, updated_at)
          VALUES (?, ?, ?, 1, ?, 'awaiting-singer', ?) ON CONFLICT(room_id) DO UPDATE SET
          entry_id = excluded.entry_id, performance_id = excluded.performance_id,
          generation = ktv_readiness.generation + 1, clock_id = excluded.clock_id,
          state = 'awaiting-singer', ready_at = NULL, advance_pending = 0, updated_at = excluded.updated_at`)
          .run(room.id, entry.id, randomUUID(), clock.id, now)
        bump(db, room.id)
        event(db, room.id, actor.id, 'readiness.offered', entry.id)
      })
      return viewerSnapshot(req)
    })
  }, true))

  for (const action of ['respond', 'cancel']) {
    app.post(`/api/ktv/rooms/:id/readiness/${action}`, roomAccess(true), handler((req) => {
      const actor = user(req)
      const id = commandId(req)
      const { performanceId, generation, clockId, baseRevision, ready } = req.body || {}
      if (action === 'respond' && typeof ready !== 'boolean') fail(400, 'INVALID_INPUT', 'Singer readiness is required')
      return transaction(db, () => {
        const room = activeRoom(db, req.params.id)
        const member = admittedMember(db, room.id, actor.id)
        const payload = ['readiness.' + action, performanceId, generation, clockId, baseRevision]
        if (action === 'respond') payload.push(ready)
        applyCommand(db, room.id, member.id, id, payload, () => {
          const turn = currentTurn(req)
          const entry = db.prepare('SELECT * FROM ktv_queue_entries WHERE id = ? AND room_id = ?').get(turn.entry_id, room.id)
          if (action === 'cancel') moderatorMember(db, room.id, actor.id)
          else if (entry?.singer_member_id !== member.id) fail(403, 'FORBIDDEN', 'Only the selected singer can confirm readiness')
          checkRevision(req, room)
          if (action === 'respond' && (turn.state !== 'awaiting-singer' || entry.state !== 'queued' || !entry.accepted_at)) {
            fail(409, 'INVALID_READINESS', 'Singer invitation is no longer waiting')
          }
          const now = new Date().toISOString()
          if (action === 'respond' && ready) {
            db.prepare("UPDATE ktv_readiness SET state = 'ready', ready_at = ?, updated_at = ? WHERE room_id = ?")
              .run(now, now, room.id)
          } else if (action === 'respond') {
            playback.decline(room.id, entry)
          } else {
            playback.invalidate(room.id)
            invalidateReadiness(db, room.id, clock)
          }
          bump(db, room.id)
          event(db, room.id, actor.id, action === 'cancel' ? 'readiness.cancelled' : ready ? 'readiness.confirmed' : 'readiness.declined', entry.id)
        })
        return viewerSnapshot(req)
      })
    }, true))
  }

  app.post('/api/ktv/rooms/:id/invitations/rotate', roomAccess(true), handler((req) => {
    const actor = user(req)
    const id = memberCommandId(req)
    return transaction(db, () => {
      const room = activeRoom(db, req.params.id)
      const member = admittedMember(db, room.id, actor.id)
      applyCommand(db, room.id, member.id, id, ['invitation.rotate'], () => {
        hostMember(db, room.id, actor.id)
        db.prepare('UPDATE ktv_invitations SET revoked_at = ? WHERE room_id = ? AND revoked_at IS NULL')
          .run(new Date().toISOString(), room.id)
        addInvite(db, room.id, room.expires_at, key)
        bump(db, room.id)
        event(db, room.id, actor.id, 'invitation.rotated')
      })
      return viewerSnapshot(req)
    })
  }, true))

  app.post('/api/ktv/rooms/:id/settings', roomAccess(true), handler((req) => {
    const actor = user(req)
    const id = memberCommandId(req)
    const { locked, approvalRequired, stageInviteVisible } = req.body || {}
    if (typeof locked !== 'boolean' && typeof approvalRequired !== 'boolean' && typeof stageInviteVisible !== 'boolean') {
      fail(400, 'INVALID_INPUT', 'A room setting is required')
    }
    return transaction(db, () => {
      const room = activeRoom(db, req.params.id)
      const member = admittedMember(db, room.id, actor.id)
      applyCommand(db, room.id, member.id, id, ['room.settings', locked ?? null, approvalRequired ?? null, stageInviteVisible ?? null], () => {
        moderatorMember(db, room.id, actor.id)
        if (typeof stageInviteVisible === 'boolean') hostMember(db, room.id, actor.id)
        db.prepare('UPDATE ktv_rooms SET locked = ?, approval_required = ?, stage_invite_visible = ?, revision = revision + 1 WHERE id = ?')
          .run(Number(typeof locked === 'boolean' ? locked : room.locked),
            Number(typeof approvalRequired === 'boolean' ? approvalRequired : room.approval_required),
            Number(typeof stageInviteVisible === 'boolean' ? stageInviteVisible : room.stage_invite_visible), room.id)
        event(db, room.id, actor.id, 'room.settings')
      })
      return viewerSnapshot(req)
    })
  }, true))

  app.post('/api/ktv/rooms/:id/close', roomAccess(true, true), handler((req) => {
    const actor = user(req)
    const id = memberCommandId(req)
    return transaction(db, () => {
      const existing = db.prepare('SELECT * FROM ktv_rooms WHERE id = ?').get(req.params.id)
      if (!existing) fail(404, 'ROOM_NOT_FOUND', 'Room not found')
      const member = admittedMember(db, req.params.id, actor.id)
      if (existing.status === 'closed') {
        const prior = db.prepare('SELECT payload_hash FROM ktv_command_receipts WHERE room_id = ? AND actor_member_id = ? AND command_id = ?')
          .get(existing.id, member.id, id)
        if (!prior) fail(410, 'ROOM_CLOSED', 'Room has closed')
        assertSamePayload(prior, payloadHash(['room.close']))
        return { id: existing.id, status: 'closed' }
      }
      const room = activeRoom(db, req.params.id)
      applyCommand(db, room.id, member.id, id, ['room.close'], () => {
        hostMember(db, room.id, actor.id)
        closeRoom(room.id, actor.id, 'room.closed')
      })
      return { id: room.id, status: 'closed' }
    })
  }, true))
  // Asset resolution can invoke ffprobe and read files, so it happens outside the
  // SQLite mutation transaction. Authorization and revisions are rechecked after
  // resolving; a slow descriptor must never authorize an obsolete selection.
  app.get('/api/ktv/rooms/:id/assets/:songId', roomAccess(), async (req, res) => {
    res.set('Cache-Control', 'no-store')
    try {
      admittedMember(db, req.params.id, user(req).id); activeRoom(db, req.params.id)
      if (!resolveAssets) fail(503, 'ASSETS_UNCONFIGURED', 'Party audio assets are not configured')
      const assets = await resolveAssets(Number(req.params.songId))
      viewerSnapshot(req)
      res.json({ success: true, data: assets })
    } catch (error) { res.status(error.status || 500).json({ success: false, code: error.code || 'ASSET_ERROR', message: error.status ? error.message : 'Song preparation failed' }) }
  })
  app.post('/api/ktv/rooms/:id/playback/prepare', roomAccess(true), async (req, res) => {
    res.set('Cache-Control', 'no-store')
    try {
      const actor = user(req), id = commandId(req)
      const original = viewerSnapshot(req)
      const payload = ['playback.prepare', req.body?.clockId, req.body?.performanceId, req.body?.generation, req.body?.baseRevision]
      const receipt = db.prepare('SELECT payload_hash FROM ktv_command_receipts WHERE room_id = ? AND actor_member_id = ? AND command_id = ?')
        .get(req.params.id, original.self.id, id)
      if (receipt) {
        if (receipt.payload_hash !== createHash('sha256').update(JSON.stringify(payload)).digest('hex')) fail(409, 'COMMAND_CONFLICT', 'Command ID was already used')
        res.json({ success: true, data: original }); return
      }
      moderatorMember(db, req.params.id, actor.id)
      if (!resolveAssets) fail(503, 'ASSETS_UNCONFIGURED', 'Party audio assets are not configured')
      const assets = await resolveAssets(original.readiness?.songId)
      const data = transaction(db, () => {
        const room = activeRoom(db, req.params.id), member = admittedMember(db, room.id, actor.id)
        applyCommand(db, room.id, member.id, id, payload, () => {
          moderatorMember(db, room.id, actor.id)
          const current = currentTurn(req); checkRevision(req, room)
          if (current.entry_id !== original.readiness.entryId) fail(409, 'STALE_GENERATION', 'Selected singer changed')
          playback.prepare(room.id, readinessSnapshot(db, room.id, clock), assets)
        })
        return viewerSnapshot(req)
      })
      res.json({ success: true, data }); realtime.broadcast(req.params.id)
    } catch (error) { res.status(error.status || 500).json({ success: false, code: error.code || 'PLAYBACK_ERROR', message: error.status ? error.message : 'Song preparation failed' }) }
  })
  for (const action of ['assign-stage', 'start', 'pause', 'seek', 'skip', 'lyrics', 'guide']) {
    app.post(`/api/ktv/rooms/:id/playback/${action}`, roomAccess(true), handler((req) => {
      const actor = user(req), id = commandId(req)
      return transaction(db, () => {
        const room = activeRoom(db, req.params.id), member = admittedMember(db, room.id, actor.id)
        applyCommand(db, room.id, member.id, id, ['playback.' + action, req.body], () => {
          if (action !== 'guide') moderatorMember(db, room.id, actor.id)
          if (action === 'assign-stage') {
            checkClock(req); checkRevision(req, room)
            playback.assign(room.id, req.body.deviceId)
          } else {
            playback.current(req, playback.read(room.id), checkRevision, room)
            if (action === 'start') playback.start(room.id)
            else if (action === 'skip') playback.finish(room.id, 'skipped')
            else if (action === 'guide') playback.guide(room.id, member.id, req.body.required, req.body.deviceId)
            else if (action === 'lyrics') {
              if (!Number.isSafeInteger(req.body.lyricOffsetMs) || Math.abs(req.body.lyricOffsetMs) > 10_000) {
                fail(400, 'INVALID_OFFSET', 'Lyric correction must be within ten seconds')
              }
              db.prepare('UPDATE ktv_playback SET lyric_offset_ms = ?, updated_at = ? WHERE room_id = ?')
                .run(req.body.lyricOffsetMs, new Date().toISOString(), room.id)
              bump(db, room.id); event(db, room.id, actor.id, 'playback.lyric_offset')
            } else playback.transition(room.id, action, req.body.positionMs)
          }
        })
        return viewerSnapshot(req)
      })
    }, true))
  }
  return realtime
}
