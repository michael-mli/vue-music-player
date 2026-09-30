import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ROOM_LIFETIME_MS = 12 * 60 * 60 * 1000
const MAX_MEMBERS = 20

class RoomError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function fail(status, code, message) { throw new RoomError(status, code, message) }

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

function snapshot(db, roomId, userId, key) {
  const room = activeRoom(db, roomId)
  const self = currentMember(db, roomId, userId)
  if (!self || ['removed', 'rejected'].includes(self.admission)) {
    fail(403, 'NOT_ADMITTED', 'Room access is not available')
  }
  const result = {
    room: {
      id: room.id, name: room.name, approvalRequired: Boolean(room.approval_required),
      locked: Boolean(room.locked), revision: room.revision, expiresAt: room.expires_at,
    },
    self: { id: self.id, displayName: self.display_name, role: self.role, admission: self.admission },
  }
  if (self.admission === 'pending') return result

  result.members = db.prepare(`SELECT id, display_name, role, admission FROM ktv_members
    WHERE room_id = ? AND admission IN ('admitted', 'pending')
    ORDER BY CASE WHEN role = 'host' THEN 0 ELSE 1 END, joined_at, id`).all(roomId)
    .filter((row) => self.role === 'host' || row.admission === 'admitted')
    .map((row) => ({ id: row.id, displayName: row.display_name, role: row.role, admission: row.admission }))
  if (self.role === 'host') {
    const invite = db.prepare(`SELECT * FROM ktv_invitations WHERE room_id = ? AND revoked_at IS NULL
      ORDER BY rowid DESC LIMIT 1`).get(roomId)
    result.invitationCode = invite ? decryptCode(invite, key) : null
  }
  return result
}

export function registerKtvRoutes(app, { db, authMiddleware, secret }) {
  const key = createHash('sha256').update('ktv-invitation-v1\0').update(secret).digest()
  const joinHits = new Map()

  function handler(work) {
    return (req, res) => {
      res.set('Cache-Control', 'no-store')
      try { res.json({ success: true, data: work(req) }) }
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

  app.post('/api/ktv/rooms', authMiddleware, handler((req) => {
    const actor = user(req)
    const name = requireText(req.body?.name, 'Room name', 80)
    const personName = displayName(req, actor)
    const approvalRequired = req.body?.approvalRequired !== false
    const roomId = randomUUID()
    const memberId = randomUUID()
    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + ROOM_LIFETIME_MS).toISOString()
    return transaction(db, () => {
      db.prepare(`INSERT INTO ktv_rooms (id, name, approval_required, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)`).run(roomId, name, Number(approvalRequired), createdAt, expiresAt)
      db.prepare(`INSERT INTO ktv_members
        (id, room_id, user_id, display_name, role, admission, joined_at, updated_at)
        VALUES (?, ?, ?, ?, 'host', 'admitted', ?, ?)`).run(
        memberId, roomId, actor.id, personName, createdAt, createdAt,
      )
      addInvite(db, roomId, expiresAt, key)
      event(db, roomId, actor.id, 'room.created')
      return snapshot(db, roomId, actor.id, key)
    })
  }))

  app.post('/api/ktv/join', authMiddleware, handler((req) => {
    const actor = user(req)
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : ''
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) fail(400, 'INVALID_INVITATION', 'Invalid invitation code')
    const recent = (joinHits.get(actor.id) || []).filter((time) => Date.now() - time < 60_000)
    if (recent.length >= 20) fail(429, 'TOO_MANY_ATTEMPTS', 'Please wait before trying another code')
    recent.push(Date.now())
    joinHits.set(actor.id, recent)
    const invite = db.prepare('SELECT * FROM ktv_invitations WHERE code_hash = ?').get(hashCode(code, key))
    if (!invite || invite.revoked_at || Date.parse(invite.expires_at) <= Date.now()) {
      fail(400, 'INVALID_INVITATION', 'Invalid or expired invitation code')
    }
    const room = activeRoom(db, invite.room_id)
    const existing = currentMember(db, room.id, actor.id)
    if (existing?.admission === 'admitted' || existing?.admission === 'pending') {
      return snapshot(db, room.id, actor.id, key)
    }
    if (existing) fail(403, 'NOT_ADMITTED', 'You cannot rejoin this room')
    if (room.locked) fail(403, 'ROOM_LOCKED', 'Room is locked')
    const name = displayName(req, actor)
    return transaction(db, () => {
      const count = db.prepare(`SELECT COUNT(*) AS total FROM ktv_members
        WHERE room_id = ? AND admission IN ('admitted', 'pending')`).get(room.id).total
      if (count >= MAX_MEMBERS) fail(409, 'ROOM_FULL', 'Room is full')
      const now = new Date().toISOString()
      db.prepare(`INSERT INTO ktv_members
        (id, room_id, user_id, display_name, role, admission, joined_at, updated_at)
        VALUES (?, ?, ?, ?, 'member', ?, ?, ?)`).run(
        randomUUID(), room.id, actor.id, name,
        room.approval_required ? 'pending' : 'admitted', now, now,
      )
      bump(db, room.id)
      event(db, room.id, actor.id, 'member.joined')
      return snapshot(db, room.id, actor.id, key)
    })
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

  app.get('/api/ktv/rooms/:id', authMiddleware, handler((req) => {
    return snapshot(db, req.params.id, user(req).id, key)
  }))

  function changeMember(action, nextState) {
    app.post(`/api/ktv/rooms/:id/members/:memberId/${action}`, authMiddleware, handler((req) => {
      const actor = user(req)
      return transaction(db, () => {
        activeRoom(db, req.params.id)
        hostMember(db, req.params.id, actor.id)
        const target = db.prepare('SELECT * FROM ktv_members WHERE room_id = ? AND id = ?')
          .get(req.params.id, req.params.memberId)
        if (!target || target.role === 'host' ||
          (action === 'approve' && target.admission !== 'pending') ||
          (action === 'remove' && !['pending', 'admitted'].includes(target.admission))) {
          fail(409, 'INVALID_MEMBER_STATE', 'Member state cannot be changed')
        }
        db.prepare('UPDATE ktv_members SET admission = ?, updated_at = ? WHERE id = ?')
          .run(nextState, new Date().toISOString(), target.id)
        bump(db, req.params.id)
        event(db, req.params.id, actor.id, `member.${action}`, target.id)
        return snapshot(db, req.params.id, actor.id, key)
      })
    }))
  }
  changeMember('approve', 'admitted')
  changeMember('remove', 'removed')

  app.post('/api/ktv/rooms/:id/invitations/rotate', authMiddleware, handler((req) => {
    const actor = user(req)
    return transaction(db, () => {
      const room = activeRoom(db, req.params.id)
      hostMember(db, room.id, actor.id)
      db.prepare('UPDATE ktv_invitations SET revoked_at = ? WHERE room_id = ? AND revoked_at IS NULL')
        .run(new Date().toISOString(), room.id)
      addInvite(db, room.id, room.expires_at, key)
      bump(db, room.id)
      event(db, room.id, actor.id, 'invitation.rotated')
      return snapshot(db, room.id, actor.id, key)
    })
  }))

  app.post('/api/ktv/rooms/:id/settings', authMiddleware, handler((req) => {
    const actor = user(req)
    const { locked, approvalRequired } = req.body || {}
    if (typeof locked !== 'boolean' && typeof approvalRequired !== 'boolean') {
      fail(400, 'INVALID_INPUT', 'A room setting is required')
    }
    return transaction(db, () => {
      const room = activeRoom(db, req.params.id)
      hostMember(db, room.id, actor.id)
      db.prepare('UPDATE ktv_rooms SET locked = ?, approval_required = ?, revision = revision + 1 WHERE id = ?')
        .run(Number(typeof locked === 'boolean' ? locked : room.locked),
          Number(typeof approvalRequired === 'boolean' ? approvalRequired : room.approval_required), room.id)
      event(db, room.id, actor.id, 'room.settings')
      return snapshot(db, room.id, actor.id, key)
    })
  }))

  app.post('/api/ktv/rooms/:id/close', authMiddleware, handler((req) => {
    const actor = user(req)
    return transaction(db, () => {
      const room = activeRoom(db, req.params.id)
      hostMember(db, room.id, actor.id)
      const now = new Date().toISOString()
      db.prepare("UPDATE ktv_rooms SET status = 'closed', closed_at = ?, revision = revision + 1 WHERE id = ?")
        .run(now, room.id)
      db.prepare('UPDATE ktv_invitations SET revoked_at = ? WHERE room_id = ? AND revoked_at IS NULL')
        .run(now, room.id)
      event(db, room.id, actor.id, 'room.closed')
      return { id: room.id, status: 'closed' }
    })
  }))
}
