// Lifecycle time uses persisted UTC timestamps, so expiry survives a service
// restart. Audio deadlines continue to use the separate monotonic room clock.
export function createKtvLifecycle({ db, policy, transaction, closeRoom, broadcast, occupied, cleanup = () => {} }) {
  let closed = false
  function sweep(now = Date.now()) {
    if (closed) return
    const timestamp = new Date(now).toISOString(), ended = []
    transaction(db, () => {
      for (const room of db.prepare("SELECT id, expires_at, empty_since_at FROM ktv_rooms WHERE status = 'open'").all()) {
        if (Date.parse(room.expires_at) <= now) {
          closeRoom(room.id, null, 'room.expired', timestamp); ended.push(room.id); continue
        }
        if (occupied(room.id)) {
          if (room.empty_since_at) db.prepare('UPDATE ktv_rooms SET empty_since_at = NULL WHERE id = ?').run(room.id)
        } else {
          const emptySince = room.empty_since_at || timestamp
          if (!room.empty_since_at) db.prepare('UPDATE ktv_rooms SET empty_since_at = ? WHERE id = ?').run(emptySince, room.id)
          if (now - Date.parse(emptySince) >= policy.emptyRoomMs) {
            closeRoom(room.id, null, 'room.empty_expired', timestamp); ended.push(room.id)
          }
        }
      }
      const receiptCutoff = new Date(now - policy.receiptRetentionMs).toISOString()
      cleanup(receiptCutoff)
      for (const table of ['ktv_command_receipts', 'ktv_identity_receipts', 'ktv_pairing_receipts']) {
        db.prepare(`DELETE FROM ${table} WHERE created_at < ?`).run(receiptCutoff)
      }
      // Keep redeemed pairings for the full response-recovery window.
      db.prepare('DELETE FROM ktv_pairings WHERE expires_at < ?').run(receiptCutoff)
      db.prepare('DELETE FROM ktv_device_grants WHERE expires_at < ?').run(receiptCutoff)
      for (const room of db.prepare('SELECT room_id FROM ktv_room_events GROUP BY room_id HAVING COUNT(*) > ?').all(policy.eventsPerRoom)) {
        db.prepare(`DELETE FROM ktv_room_events WHERE room_id = ? AND id NOT IN
          (SELECT id FROM ktv_room_events WHERE room_id = ? ORDER BY id DESC LIMIT ?)`)
          .run(room.room_id, room.room_id, policy.eventsPerRoom)
      }
      db.prepare("DELETE FROM ktv_rooms WHERE status = 'closed' AND closed_at < ?")
        .run(new Date(now - policy.historyRetentionMs).toISOString())
    })
    // No socket can observe an uncommitted expiry or keep an expired grant.
    for (const roomId of ended) broadcast(roomId)
  }
  sweep()
  const timer = setInterval(() => {
    try { sweep() } catch (error) { console.error('[ktv] lifecycle sweep failed', error) }
  }, 10_000)
  timer.unref()
  return { sweep, close: () => { closed = true; clearInterval(timer) } }
}
