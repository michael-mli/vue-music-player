import { randomUUID } from 'node:crypto'

export function readinessSnapshot(db, roomId, clock) {
  const row = db.prepare(`SELECT r.*, q.song_id, q.title, q.singer_member_id, m.display_name
    FROM ktv_readiness r LEFT JOIN ktv_queue_entries q ON q.id = r.entry_id
    LEFT JOIN ktv_members m ON m.id = q.singer_member_id WHERE r.room_id = ?`).get(roomId)
  return {
    state: row?.state || 'idle', clockId: clock.id, generation: row?.generation || 0,
    performanceId: row?.performance_id || null, entryId: row?.entry_id || null,
    songId: row?.song_id || null, title: row?.title || null,
    singerMemberId: row?.singer_member_id || null, singerName: row?.display_name || null,
    advancePending: Boolean(row?.advance_pending),
  }
}

// Called within the mutation transaction. Cancellation/removal invalidates all
// observations for that turn; it never advances or starts another song.
export function invalidateReadiness(db, roomId, clock, { entryId, memberId } = {}) {
  const row = db.prepare(`SELECT r.*, q.singer_member_id FROM ktv_readiness r
    LEFT JOIN ktv_queue_entries q ON q.id = r.entry_id WHERE r.room_id = ?`).get(roomId)
  if (!row || row.state === 'idle' || (entryId && row.entry_id !== entryId) ||
    (memberId && row.singer_member_id !== memberId)) return false
  db.prepare(`UPDATE ktv_readiness SET state = 'idle', entry_id = NULL, performance_id = NULL,
    generation = generation + 1, clock_id = ?, ready_at = NULL, advance_pending = 0, updated_at = ? WHERE room_id = ?`)
    .run(clock.id, new Date().toISOString(), roomId)
  return true
}

export function recoverReadiness(db, clock) {
  const rows = db.prepare(`SELECT r.*, q.state AS queue_state, q.accepted_at, m.admission,
    room.status AS room_status, room.expires_at FROM ktv_readiness r
    LEFT JOIN ktv_queue_entries q ON q.id = r.entry_id
    LEFT JOIN ktv_members m ON m.id = q.singer_member_id
    JOIN ktv_rooms room ON room.id = r.room_id WHERE r.clock_id != ?`).all(clock.id)
  if (!rows.length) return
  db.exec('BEGIN IMMEDIATE')
  try {
    const now = new Date().toISOString()
    for (const row of rows) {
      const eligible = row.room_status === 'open' && row.expires_at > now && row.queue_state === 'queued' &&
        row.accepted_at && row.admission === 'admitted'
      db.prepare(`UPDATE ktv_readiness SET state = ?, entry_id = ?, performance_id = ?,
        generation = generation + 1, clock_id = ?, ready_at = NULL, updated_at = ? WHERE room_id = ?`)
        .run(eligible ? 'awaiting-singer' : 'idle', eligible ? row.entry_id : null,
          eligible ? randomUUID() : null, clock.id, now, row.room_id)
      if (row.state !== 'idle') {
        db.prepare('UPDATE ktv_rooms SET revision = revision + 1 WHERE id = ?').run(row.room_id)
        db.prepare(`INSERT INTO ktv_room_events (room_id, action, created_at)
          VALUES (?, 'readiness.recovered', ?)`).run(row.room_id, now)
      }
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
