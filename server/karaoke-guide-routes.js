import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'

// Standalone karaoke pairing: no KTV rooms, media server, or WebSocket proxy needed.
export function registerKaraokeGuideRoutes(app, {
  authMiddleware, now = () => performance.now(), lifetimeMs = 12 * 60 * 60 * 1000,
  idleMs = 120_000, staleMs = 3000, maxSessions = 1000,
}) {
  const sessions = new Map()
  const base = '/api/karaoke-guide/sessions'
  const secret = () => randomBytes(24).toString('base64url')
  const fail = (res, status, code) => res.status(status).json({ success: false, code })
  const bearer = req => req.headers.authorization?.replace(/^Bearer /, '')
  function sweep() {
    const time = now()
    for (const [id, session] of sessions) {
      if (time >= session.expiresAt || time - session.updatedAt > idleMs) sessions.delete(id)
    }
  }
  const cleanup = setInterval(sweep, 30_000)
  cleanup.unref()
  app.use(base, (req, res, next) => {
    req.guideReceivedAt = now()
    res.set('Cache-Control', 'no-store, private')
    next()
  })
  const reply = (req, res, data) => res.json({ success: true, data: {
    ...data, serverReceivedAt: req.guideReceivedAt, serverNow: now(),
  } })
  function find(req, res, hostOnly = false) {
    sweep()
    const session = sessions.get(req.params.id)
    if (!session) { fail(res, 410, 'expired'); return null }
    const token = bearer(req)
    if (token !== session.hostToken && (hostOnly || token !== session.guideToken)) {
      fail(res, 403, 'invalidPair'); return null
    }
    return session
  }
  function connected(session) {
    for (const [device, seen] of session.devices) {
      if (now() - seen > 5000) session.devices.delete(device)
    }
    return session.devices.size
  }
  app.post(base, authMiddleware, (req, res) => {
    sweep()
    for (const [id, session] of sessions) {
      if (session.owner === req.auth.sub) sessions.delete(id)
    }
    if (sessions.size >= maxSessions) return fail(res, 503, 'unavailable')
    const id = secret(), hostToken = secret(), guideToken = secret(), time = now()
    sessions.set(id, { owner: req.auth.sub, hostToken, guideToken, updatedAt: time,
      expiresAt: time + lifetimeMs, state: null, devices: new Map() })
    reply(req, res, { id, hostToken, guideToken })
  })
  app.put(`${base}/:id`, (req, res) => {
    const session = find(req, res, true)
    if (!session) return
    const state = req.body
    if (!state || typeof state.playing !== 'boolean' ||
      ![state.position, state.duration, state.rate, state.sampledAt].every(Number.isFinite) ||
      state.position < 0 || state.duration < 0 || state.duration > 86400 || state.position > 86400 ||
      state.rate < 0.25 || state.rate > 4 || Math.abs(state.sampledAt - now()) > 10_000) {
      return fail(res, 400, 'invalidState')
    }
    let song = null
    if (state.song !== null) {
      const value = state.song
      if (!value || !Number.isSafeInteger(value.id) || value.id <= 0 ||
        typeof value.title !== 'string' || value.title.length > 500 ||
        typeof value.url !== 'string' || value.url.length > 2048) return fail(res, 400, 'invalidState')
      try {
        const url = new URL(value.url)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
          !url.pathname.endsWith(`/link.${value.id}.mp3`)) return fail(res, 400, 'invalidState')
      } catch { return fail(res, 400, 'invalidState') }
      song = { id: value.id, title: value.title, url: value.url }
    }
    session.state = { song, playing: !!song && state.playing,
      position: state.duration > 0 ? Math.min(state.position, state.duration) : state.position,
      duration: state.duration, rate: state.rate, sampledAt: state.sampledAt }
    session.updatedAt = now()
    reply(req, res, { connectedDevices: connected(session) })
  })
  app.get(`${base}/:id`, (req, res) => {
    const session = find(req, res)
    if (!session) return
    const device = req.query.device
    if (bearer(req) === session.guideToken && typeof device === 'string' && /^[\w-]{1,64}$/.test(device)) {
      connected(session)
      if (session.devices.has(device) || session.devices.size < 10) session.devices.set(device, now())
    }
    reply(req, res, { state: session.state, hostOnline: now() - session.updatedAt <= staleMs })
  })
  app.delete(`${base}/:id`, (req, res) => {
    if (!find(req, res, true)) return
    sessions.delete(req.params.id)
    reply(req, res, {})
  })
  return { close() { clearInterval(cleanup); sessions.clear() } }
}
