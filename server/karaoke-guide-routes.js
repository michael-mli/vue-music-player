import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'

// The host owns playback. Each paired device gets a separately revocable grant.
export function registerKaraokeGuideRoutes(app, {
  authMiddleware, now = () => performance.now(), lifetimeMs = 12 * 60 * 60 * 1000,
  idleMs = 120_000, deviceIdleMs = 30 * 60 * 1000, staleMs = 3000, maxSessions = 1000,
}) {
  const sessions = new Map(), base = '/api/karaoke-guide/sessions'
  const secret = () => randomBytes(24).toString('base64url')
  const fail = (res, status, code) => res.status(status).json({ success: false, code })
  const bearer = req => req.headers.authorization?.replace(/^Bearer /, '')
  function revoke(session, device, reason) {
    session.devices.delete(device.id)
    session.revoked.set(device.token, reason)
    if (session.revoked.size > 100) session.revoked.delete(session.revoked.keys().next().value)
    for (const command of session.commands.values()) {
      if (command.deviceId === device.id && command.status === 'pending') {
        command.status = 'failed'; command.code = reason
      }
    }
    // Previously copied QR links cannot silently re-enrol a removed device.
    session.guideToken = secret()
  }
  function sweep() {
    const time = now()
    for (const [id, session] of sessions) {
      if (time >= session.expiresAt || time - session.updatedAt > idleMs) { sessions.delete(id); continue }
      for (const device of session.devices.values()) {
        if (time - device.lastActiveAt >= deviceIdleMs) revoke(session, device, 'idleExpired')
      }
      for (const [id, command] of session.commands) {
        if (command.status === 'pending' && time >= command.expiresAt) {
          command.status = 'failed'; command.code = 'commandExpired'
        }
        if (time - command.createdAt > 5 * 60_000) session.commands.delete(id)
      }
    }
  }
  const cleanup = setInterval(sweep, 30_000)
  cleanup.unref()
  app.use(base, (req, res, next) => {
    req.guideReceivedAt = now(); res.set('Cache-Control', 'no-store, private'); next()
  })
  const reply = (req, res, data) => res.json({ success: true, data: {
    ...data, serverReceivedAt: req.guideReceivedAt, serverNow: now(),
  } })
  function find(req, res, role = 'any') {
    sweep()
    const session = sessions.get(req.params.id)
    if (!session) { fail(res, 410, 'expired'); return null }
    const token = bearer(req)
    if (role === 'invite' && token === session.guideToken) return { session, device: null }
    if (role !== 'invite' && role !== 'device' && token === session.hostToken) return { session, device: null }
    if (role !== 'host' && role !== 'invite') {
      const device = [...session.devices.values()].find(device => device.token === token)
      if (device) return { session, device }
    }
    fail(res, 403, session.revoked.get(token) || 'invalidPair'); return null
  }
  function publicDevice(device) {
    return { id: device.id, name: device.name, canControl: device.canControl,
      status: now() - device.lastSeenAt < 5000 ? device.mode : 'offline',
      idleRemainingMs: Math.max(0, deviceIdleMs - (now() - device.lastActiveAt)) }
  }
  function hostView(session) {
    const devices = [...session.devices.values()].map(publicDevice)
    return { guideToken: session.guideToken, devices, deviceIdleMs,
      connectedDevices: devices.filter(device => device.status === 'guide').length,
      commands: [...session.commands.values()].filter(command => command.status === 'pending')
        .map(({ id, action, songId, position, expiresAt }) => ({ id, action, songId, position, expiresAt })) }
  }
  app.post(base, authMiddleware, (req, res) => {
    sweep()
    for (const [id, session] of sessions) if (session.owner === req.auth.sub) sessions.delete(id)
    if (sessions.size >= maxSessions) return fail(res, 503, 'unavailable')
    const id = secret(), hostToken = secret(), guideToken = secret(), time = now()
    sessions.set(id, { owner: req.auth.sub, hostToken, guideToken, updatedAt: time,
      expiresAt: time + lifetimeMs, state: null, devices: new Map(), revoked: new Map(),
      commands: new Map(), catalog: new Map(), staging: null, catalogReady: false, controlsAvailable: false, queue: [] })
    reply(req, res, { id, hostToken, guideToken })
  })
  app.post(`${base}/:id/devices`, (req, res) => {
    const context = find(req, res, 'invite')
    if (!context) return
    const { session } = context, { joinKey, name } = req.body || {}
    if (typeof joinKey !== 'string' || !/^[\w-]{16,64}$/.test(joinKey) ||
      typeof name !== 'string' || !name.trim() || name.length > 40) return fail(res, 400, 'invalidState')
    let device = [...session.devices.values()].find(device => device.joinKey === joinKey)
    if (!device) {
      if (session.devices.size >= 10) return fail(res, 409, 'deviceLimit')
      device = { id: secret(), token: secret(), joinKey, name: name.trim(), canControl: true,
        lastActiveAt: now(), lastSeenAt: now(), mode: 'guide', rateStart: now(), rateCount: 0 }
      session.devices.set(device.id, device)
    }
    reply(req, res, { device: { ...publicDevice(device), token: device.token }, deviceIdleMs })
  })
  app.patch(`${base}/:id/devices/:deviceId`, (req, res) => {
    const context = find(req, res, 'host')
    if (!context) return
    const device = context.session.devices.get(req.params.deviceId)
    if (!device) return fail(res, 404, 'removed')
    if (typeof req.body?.canControl !== 'boolean') return fail(res, 400, 'invalidState')
    device.canControl = req.body.canControl
    if (!device.canControl) for (const command of context.session.commands.values()) {
      if (command.deviceId === device.id && command.status === 'pending') { command.status = 'failed'; command.code = 'controlsDisabled' }
    }
    reply(req, res, hostView(context.session))
  })
  app.delete(`${base}/:id/devices/:deviceId`, (req, res) => {
    const context = find(req, res, 'host')
    if (!context) return
    const device = context.session.devices.get(req.params.deviceId)
    if (!device) return fail(res, 404, 'removed')
    revoke(context.session, device, 'removed')
    reply(req, res, hostView(context.session))
  })
  app.patch(`${base}/:id/device`, (req, res) => {
    const context = find(req, res, 'device')
    if (!context) return
    const name = req.body?.name
    if (typeof name !== 'string' || !name.trim() || name.length > 40) return fail(res, 400, 'invalidState')
    context.device.name = name.trim(); context.device.lastActiveAt = now()
    reply(req, res, { device: publicDevice(context.device) })
  })
  app.put(`${base}/:id`, (req, res) => {
    const context = find(req, res, 'host')
    if (!context) return
    const { session } = context, state = req.body
    if (!state || typeof state.playing !== 'boolean' ||
      ![state.position, state.duration, state.rate, state.sampledAt].every(Number.isFinite) ||
      state.position < 0 || state.duration < 0 || state.duration > 86400 || state.position > 86400 ||
      state.rate < 0.25 || state.rate > 4 || Math.abs(state.sampledAt - now()) > 10_000) return fail(res, 400, 'invalidState')
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
    if (state.acknowledgements !== undefined && (!Array.isArray(state.acknowledgements) || state.acknowledgements.length > 50 ||
      state.acknowledgements.some(ack => !ack || typeof ack.id !== 'string' || !['applied', 'failed'].includes(ack.status) ||
        (ack.code !== undefined && (typeof ack.code !== 'string' || ack.code.length > 40))))) return fail(res, 400, 'invalidState')
    if (state.queue !== undefined && (!Array.isArray(state.queue) || state.queue.length > 50 || state.queue.some(song =>
      !song || !Number.isSafeInteger(song.id) || song.id <= 0 || typeof song.title !== 'string' || song.title.length > 500))) return fail(res, 400, 'invalidState')
    session.state = { song, playing: !!song && state.playing,
      position: state.duration > 0 ? Math.min(state.position, state.duration) : state.position,
      duration: state.duration, rate: state.rate, sampledAt: state.sampledAt }
    session.controlsAvailable = state.controlsAvailable === true
    session.queue = (state.queue || []).map(({ id, title }) => ({ id, title }))
    session.updatedAt = now()
    for (const ack of state.acknowledgements || []) {
      const command = session.commands.get(ack.id)
      if (command?.status === 'pending') { command.status = ack.status; command.code = ack.code }
    }
    reply(req, res, hostView(session))
  })
  app.put(`${base}/:id/catalog`, (req, res) => {
    const context = find(req, res, 'host')
    if (!context) return
    const { session } = context, { revision, reset, done, songs } = req.body || {}
    if (typeof revision !== 'string' || revision.length > 64 || typeof reset !== 'boolean' || typeof done !== 'boolean' ||
      !Array.isArray(songs) || songs.length > 200 || songs.some(song => !song || !Number.isSafeInteger(song.id) || song.id <= 0 ||
        typeof song.title !== 'string' || song.title.length > 500 || typeof song.artist !== 'string' || song.artist.length > 200)) return fail(res, 400, 'invalidState')
    if (reset) session.staging = { revision, songs: new Map() }
    if (!session.staging || session.staging.revision !== revision) return fail(res, 409, 'catalogChanged')
    for (const song of songs) session.staging.songs.set(song.id, { id: song.id, title: song.title, artist: song.artist })
    if (session.staging.songs.size > 20_000) { session.staging = null; return fail(res, 400, 'catalogLimit') }
    if (done) { session.catalog = session.staging.songs; session.staging = null; session.catalogReady = true }
    reply(req, res, {})
  })
  app.get(`${base}/:id/catalog`, (req, res) => {
    const context = find(req, res, 'device')
    if (!context) return
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '', page = Number(req.query.page || 1)
    if (q.length > 160 || !Number.isInteger(page) || page < 1 || page > 1000) return fail(res, 400, 'invalidState')
    const words = q.split(/\s+/), { session, device } = context
    device.lastActiveAt = now()
    const songs = [...session.catalog.values()].filter(song => words.every(word => `${song.id} ${song.title} ${song.artist}`.toLowerCase().includes(word)))
    reply(req, res, { songs: songs.slice((page - 1) * 25, page * 25), total: songs.length, page, ready: session.catalogReady })
  })
  app.post(`${base}/:id/commands`, (req, res) => {
    const context = find(req, res, 'device')
    if (!context) return
    const { session, device } = context, { commandId, action, songId, position } = req.body || {}
    if (typeof commandId !== 'string' || !/^[\w-]{16,64}$/.test(commandId) ||
      !['play', 'pause', 'stop', 'skip', 'seek', 'enqueue', 'singNow', 'removeQueued'].includes(action) ||
      (['enqueue', 'singNow', 'removeQueued'].includes(action) && (!Number.isSafeInteger(songId) || songId <= 0)) ||
      (action === 'seek' && (!Number.isFinite(position) || position < 0 || position > 86400))) return fail(res, 400, 'invalidState')
    const fingerprint = JSON.stringify({ action, songId, position }), prior = session.commands.get(commandId)
    if (prior) {
      if (prior.deviceId !== device.id || prior.fingerprint !== fingerprint) return fail(res, 409, 'commandConflict')
      return reply(req, res, { command: { id: prior.id, status: prior.status, code: prior.code } })
    }
    if (!device.canControl) return fail(res, 403, 'controlsDisabled')
    if (now() - session.updatedAt > staleMs || !session.controlsAvailable) return fail(res, 409, 'hostOffline')
    if (['enqueue', 'singNow'].includes(action) && !session.catalog.has(songId)) return fail(res, 404, 'songUnavailable')
    if (now() - device.rateStart > 60_000) { device.rateStart = now(); device.rateCount = 0 }
    if (++device.rateCount > 60 || [...session.commands.values()].filter(command => command.status === 'pending').length >= 50 ||
      session.commands.size >= 1000) return fail(res, 429, 'commandBusy')
    device.lastActiveAt = now()
    const command = { id: commandId, deviceId: device.id, action, songId, position, fingerprint,
      status: 'pending', createdAt: now(), expiresAt: now() + 10_000 }
    session.commands.set(command.id, command)
    reply(req, res, { command: { id: command.id, status: command.status } })
  })
  app.get(`${base}/:id`, (req, res) => {
    const context = find(req, res)
    if (!context) return
    const { session, device } = context
    if (device) {
      device.lastSeenAt = now(); device.mode = req.query.mode === 'away' ? 'away' : 'guide'
      if (device.mode === 'guide' && req.query.active === '1') device.lastActiveAt = now()
    }
    reply(req, res, { state: session.state, hostOnline: now() - session.updatedAt <= staleMs,
      device: device ? publicDevice(device) : null, controlsAvailable: session.controlsAvailable,
      queue: session.queue, commands: device ? [...session.commands.values()].filter(command => command.deviceId === device.id)
        .slice(-50).map(({ id, status, code }) => ({ id, status, code })) : [] })
  })
  app.delete(`${base}/:id`, (req, res) => {
    if (!find(req, res, 'host')) return
    sessions.delete(req.params.id); reply(req, res, {})
  })
  return { close() { clearInterval(cleanup); sessions.clear() } }
}
