// Durable outbox: library publication and its ingestion request share one
// transaction. One worker drains it; the shell pipeline also serializes manual
// runs with flock. Re-running an interrupted job is safe and keeps the same ID.
export function initDigIngestion(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS dig_ingestion (
    song_id INTEGER PRIMARY KEY REFERENCES imported_songs(id),
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    last_error TEXT
  )`)
}

export function createDigIngestionWorker({ db, run, now = Date.now, intervalMs = 5000, retryMs = 60000 }) {
  initDigIngestion(db)
  db.prepare("UPDATE dig_ingestion SET status = 'queued', next_attempt_at = 0 WHERE status = 'running'").run()
  let active = false
  let stopped = false
  let timer

  async function tick() {
    if (active || stopped) return
    active = true
    try {
      const job = db.prepare(`UPDATE dig_ingestion
        SET status = 'running', attempts = attempts + 1, updated_at = ?
        WHERE song_id = (SELECT song_id FROM dig_ingestion
          WHERE status IN ('queued', 'retry') AND next_attempt_at <= ?
          ORDER BY next_attempt_at, song_id LIMIT 1)
        RETURNING song_id, attempts`).get(now(), now())
      if (!job) return
      try {
        await run(job.song_id)
        db.prepare("UPDATE dig_ingestion SET status = 'complete', updated_at = ?, last_error = NULL WHERE song_id = ?")
          .run(now(), job.song_id)
      } catch (error) {
        const delay = Math.min(retryMs * 2 ** Math.min(job.attempts - 1, 10), 30 * 60000)
        db.prepare("UPDATE dig_ingestion SET status = 'retry', updated_at = ?, next_attempt_at = ?, last_error = ? WHERE song_id = ?")
          .run(now(), now() + delay, String(error?.message || error).slice(0, 2000), job.song_id)
      }
    } finally { active = false }
  }

  function start() {
    if (timer || stopped) return
    const poll = () => { void tick().catch(error => console.error('[dig ingestion]', error)) }
    timer = setInterval(poll, intervalMs)
    timer.unref()
    poll()
  }
  function stop() { stopped = true; clearInterval(timer) }
  return { tick, start, stop }
}
