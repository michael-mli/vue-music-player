import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { fail } from './ktv-errors.js'

export const payloadHash = payload => createHash('sha256').update(JSON.stringify(payload)).digest('hex')

export function assertSamePayload(receipt, digest) {
  if (receipt.payload_hash !== digest) fail(409, 'COMMAND_CONFLICT', 'Command ID was already used')
}

// Call inside the mutation's SQLite transaction. The receipt and mutation commit
// together; a replay resolves current authorized state for this original room.
export function identityCommand(db, userId, commandId, payload, work) {
  const digest = payloadHash(payload)
  const prior = db.prepare('SELECT * FROM ktv_identity_receipts WHERE user_id = ? AND command_id = ?').get(userId, commandId)
  if (prior) { assertSamePayload(prior, digest); return prior.room_id }
  const roomId = work()
  db.prepare('INSERT INTO ktv_identity_receipts (user_id, command_id, payload_hash, room_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, commandId, digest, roomId, new Date().toISOString())
  return roomId
}

export function sealResult(value, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
  return { cipher: Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]).toString('base64'),
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}

export function openResult(row, key) {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.result_iv, 'base64'))
  decipher.setAuthTag(Buffer.from(row.result_tag, 'base64'))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(row.result_cipher, 'base64')), decipher.final()]).toString('utf8'))
}

export function resultCommand(db, roomId, memberId, commandId, payload, key, work) {
  const digest = payloadHash(payload)
  const prior = db.prepare('SELECT * FROM ktv_command_receipts WHERE room_id = ? AND actor_member_id = ? AND command_id = ?')
    .get(roomId, memberId, commandId)
  if (prior) { assertSamePayload(prior, digest); return openResult(prior, key) }
  const result = work(), sealed = sealResult(result, key)
  db.prepare(`INSERT INTO ktv_command_receipts
    (room_id, actor_member_id, command_id, payload_hash, result_cipher, result_iv, result_tag, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(roomId, memberId, commandId, digest, sealed.cipher, sealed.iv, sealed.tag, new Date().toISOString())
  return result
}
