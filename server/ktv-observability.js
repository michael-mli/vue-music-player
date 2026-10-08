import { performance, monitorEventLoopDelay } from 'node:perf_hooks'

const bounds = [25, 50, 100, 250, 500, 1000, 2500, Infinity]
const groups = ['read', 'command', 'ticket', 'media', 'other']
const empty = () => Object.fromEntries(groups.map(group => [group, { count: 0, aborted: 0, errors: 0, latency: bounds.map(() => 0) }]))
const groupFor = req => req.path.includes('/media') ? 'media' : req.path.endsWith('/socket-ticket') ? 'ticket' :
  req.method === 'GET' ? 'read' : req.method === 'POST' ? 'command' : 'other'

// Fixed labels and histogram buckets: never retain URLs, identities, query
// strings, request bodies or credentials, even for malformed requests.
export function createKtvMetrics({ now = () => performance.now(), eventLoop = true } = {}) {
  const started = now(), totals = empty()
  let windowStarted = started, window = empty(), inFlight = 0
  const delay = eventLoop ? monitorEventLoopDelay({ resolution: 20 }) : null
  delay?.enable()
  const resetDelay = delay ? setInterval(() => delay.reset(), 60000) : null
  resetDelay?.unref()
  function currentWindow() {
    if (now() - windowStarted >= 300000) { windowStarted = now(); window = empty() }
    return window
  }
  function middleware(req, res, next) {
    const at = now(), group = groupFor(req)
    inFlight++
    let ended = false
    const finish = aborted => {
      if (ended) return
      ended = true; inFlight--
      const duration = Math.max(0, now() - at), bucket = bounds.findIndex(bound => duration <= bound)
      for (const data of [totals, currentWindow()]) {
        const row = data[group]
        row.count++; row.latency[bucket]++
        if (aborted) row.aborted++
        else if (res.statusCode >= 500) row.errors++
      }
    }
    res.once('finish', () => finish(false)); res.once('close', () => finish(!res.writableFinished))
    next()
  }
  function summarize(data) {
    return Object.fromEntries(groups.map(group => {
      const row = data[group]
      let total = 0, p95Ms = null
      if (row.count) for (let i = 0; i < bounds.length; i++) {
        total += row.latency[i]
        if (total >= Math.ceil(row.count * .95)) { p95Ms = Number.isFinite(bounds[i]) ? bounds[i] : '>2500'; break }
      }
      return [group, { ...row, latency: [...row.latency], p95Ms }]
    }))
  }
  function snapshot() {
    const recent = summarize(currentWindow()), alerts = []
    for (const group of groups) {
      const row = recent[group]
      if (row.count >= 20 && (row.p95Ms === '>2500' || row.p95Ms > 500)) alerts.push(`${group}.latency`)
      if (row.errors >= 5 && row.errors / row.count >= .05) alerts.push(`${group}.errors`)
    }
    const eventLoopP95Ms = delay?.count ? Math.round(delay.percentile(95) / 10000) / 100 : null
    if (eventLoopP95Ms > 100) alerts.push('eventLoop.delay')
    const memory = process.memoryUsage()
    return { uptimeMs: Math.round(now() - started), windowAgeMs: Math.round(now() - windowStarted), windowMs: 300000,
      inFlight, bucketUpperMs: bounds.map(bound => Number.isFinite(bound) ? bound : null), totals: summarize(totals), recent,
      eventLoopP95Ms, rssMiB: Math.round(memory.rss / 1024 / 1024), heapMiB: Math.round(memory.heapUsed / 1024 / 1024), alerts }
  }
  return { middleware, snapshot, close() { if (resetDelay) clearInterval(resetDelay); delay?.disable() } }
}

export function registerKtvHealthRoute(app, { db, authMiddleware, requireAdmin, metrics, realtime }) {
  app.get('/api/admin/ktv-health', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next() }, authMiddleware, requireAdmin, async (_req, res) => {
    try {
      const rooms = db.prepare("SELECT status, COUNT(*) AS count FROM ktv_rooms GROUP BY status").all()
      const playback = db.prepare(`SELECT p.state, COUNT(*) AS count FROM ktv_playback p JOIN ktv_rooms r ON r.id = p.room_id
        WHERE r.status = 'open' GROUP BY p.state`).all()
      const hasMediaSchema = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'ktv_media_grants'").get()
      const grants = hasMediaSchema ? db.prepare("SELECT state, COUNT(*) AS count FROM ktv_media_grants WHERE state != 'revoked' GROUP BY state").all() : []
      let mediaReady = false
      if (realtime.media) try { mediaReady = await realtime.media.health() } catch { /* Report readiness loss without private provider errors. */ }
      const http = metrics.snapshot()
      if (realtime.media && !mediaReady) http.alerts.push('media.unavailable')
      res.json({ success: true, data: { http, sockets: realtime.diagnostics(), rooms, playback, grants,
        media: { configured: Boolean(realtime.media), ready: mediaReady }, features: realtime.features } })
    } catch { res.status(503).json({ success: false, code: 'KTV_HEALTH_UNAVAILABLE' }) }
  })
}
