import { randomUUID } from 'node:crypto'
import { orderQueue } from './ktv-queue.js'

// All helpers run inside the caller's room transaction. History survives queue
// cancellation and request retries, so a singer cannot reset their served turn.
export function servedRound(db, roomId) {
  const round = db.prepare('SELECT COALESCE(MAX(round), 1) AS round FROM ktv_turn_history WHERE room_id = ?').get(roomId).round
  const served = db.prepare('SELECT singer_member_id FROM ktv_turn_history WHERE room_id = ? AND round = ?')
    .all(roomId, round).map(turn => turn.singer_member_id)
  return { round, served }
}

export function recordTurn(db, roomId, entry, outcome) {
  const { round, served } = servedRound(db, roomId)
  const singers = db.prepare(`SELECT DISTINCT q.singer_member_id FROM ktv_queue_entries q
    JOIN ktv_members m ON m.id = q.singer_member_id
    WHERE q.room_id = ? AND q.state = 'queued' AND q.accepted_at IS NOT NULL AND m.admission = 'admitted'`).all(roomId)
  const nextRound = served.length > 0 && singers.every(singer => served.includes(singer.singer_member_id))
  return db.prepare(`INSERT OR IGNORE INTO ktv_turn_history (room_id, entry_id, singer_member_id, outcome, round, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(roomId, entry.id, entry.singer_member_id, outcome, round + Number(nextRound), new Date().toISOString()).changes > 0
}

export function requestNextTurn(db, roomId) {
  db.prepare('UPDATE ktv_readiness SET advance_pending = 1 WHERE room_id = ?').run(roomId)
}

export function offerNextTurn(db, roomId, clock) {
  const selection = db.prepare('SELECT * FROM ktv_readiness WHERE room_id = ?').get(roomId)
  if (selection?.state !== 'idle' || !selection.advance_pending) return null
  const entries = db.prepare(`SELECT q.* FROM ktv_queue_entries q JOIN ktv_members m ON m.id = q.singer_member_id
    WHERE q.room_id = ? AND q.state = 'queued' AND q.accepted_at IS NOT NULL AND m.admission = 'admitted'
    ORDER BY q.created_at, q.rowid`).all(roomId).map(entry => ({ ...entry, singerMemberId: entry.singer_member_id,
      hostOrder: entry.host_order,
      singerAccepted: true, priorityApproved: Boolean(entry.priority_approved) }))
  const next = orderQueue(entries, servedRound(db, roomId).served)[0]
  if (!next) return null
  db.prepare(`UPDATE ktv_readiness SET entry_id = ?, performance_id = ?, generation = generation + 1,
    clock_id = ?, state = 'awaiting-singer', ready_at = NULL, advance_pending = 0, updated_at = ? WHERE room_id = ?`)
    .run(next.id, randomUUID(), clock.id, new Date().toISOString(), roomId)
  return next.id
}
