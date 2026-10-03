import { timingSafeEqual } from 'node:crypto'
import { createKtvMediaGrants } from './ktv-media-grants.js'
import { fail, RoomError } from './ktv-errors.js'
import { payloadHash, assertSamePayload } from './ktv-receipts.js'

// The backend owns admission and persisted nonces. A separate supervisor owns
// the SFU and its signaling gateway; its control port is loopback-only.
export function registerKtvMediaRoutes(app, { db, clock, playback, realtime, config,
  roomAccess, viewerSnapshot, hostMember, activeRoom, commandId, checkRevision,
  transaction, applyCommand, bump, event, invalidateReadiness }) {
  const worker = new URL(config.workerUrl)
  if (worker.protocol !== 'http:' || worker.hostname !== '127.0.0.1' || worker.username || worker.password ||
    worker.pathname !== '/' || worker.search || worker.hash || !config.controlSecret || config.controlSecret.length < 32) {
    throw new Error('KTV media control must use a private loopback URL and a strong shared secret')
  }
  const grants = createKtvMediaGrants({ db, clock, apiKey: config.apiKey, apiSecret: config.apiSecret,
    getPlayback: id => playback.snapshot(id), getDevices: id => playback.presence(id).devices,
    reserveReceiveOutput: permit => playback.reserveReceiveOutput(permit) })
  const expected = Buffer.from(`Bearer ${config.controlSecret}`)
  async function control(path, body) {
    try {
      const response = await fetch(new URL(path, worker), { method: 'POST',
        headers: { Authorization: expected.toString(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}), signal: AbortSignal.timeout(5000), redirect: 'error' })
      if (response.status === 409 && path === '/control/publisher-ready') {
        fail(409, 'MEDIA_NOT_READY', 'Wait for both performance tracks to connect')
      }
      if (!response.ok) throw new Error('Worker unavailable')
      const data = await response.json()
      if (data.success !== true) throw new Error('Worker unavailable')
      return data.data
    } catch (error) {
      if (error instanceof RoomError && error.code === 'MEDIA_NOT_READY') throw error
      fail(503, 'MEDIA_UNAVAILABLE', 'Online audio is temporarily unavailable')
    }
  }
  function trusted(req, res, next) {
    res.set('Cache-Control', 'no-store')
    const supplied = Buffer.from(req.headers.authorization || '')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.sendStatus(403)
    if (Buffer.byteLength(JSON.stringify(req.body || {})) > 16384) return res.sendStatus(413)
    next()
  }
  function handler(work, changed = false) {
    return async (req, res) => {
      res.set('Cache-Control', 'no-store')
      try {
        const data = await work(req)
        res.json({ success: true, data })
        if (changed) realtime.broadcast(req.params.id)
      } catch (error) {
        // Never log request bodies or JWTs on a media failure.
        if (!(error instanceof RoomError)) console.error('[ktv-media] request failed')
        res.status(error.status || 500).json({ success: false, code: error.code || 'MEDIA_ERROR',
          message: error.status ? error.message : 'Online audio request failed' })
      }
    }
  }
  function identity(req) {
    if (typeof req.params.identity !== 'string' || !/^ktv-media-[0-9a-f-]{36}$/.test(req.params.identity)) fail(400, 'INVALID_MEDIA_REQUEST', 'Invalid media connection')
    return req.params.identity
  }
  function device(req) {
    const id = req.body?.deviceId
    if (req.ktvGrant && !playback.presence(req.params.id).devices.some(device => device.id === id && device.deviceGrantId === req.ktvGrant.id)) {
      fail(403, 'MEDIA_FORBIDDEN', 'This credential belongs to another device')
    }
    return id
  }
  async function ready() {
    const health = await control('/control/health')
    if (!health?.ready) fail(503, 'MEDIA_UNAVAILABLE', 'Online audio is temporarily unavailable')
  }
  async function remove(targets) {
    for (const target of targets) await control('/control/revoke', target)
    // An HTTP acknowledgment alone must not free a publisher slot. The worker
    // sends a separate authenticated provider acknowledgment to the backend.
    for (const target of targets) if (db.prepare('SELECT state FROM ktv_media_grants WHERE identity = ?').get(target.identity)?.state !== 'revoked') {
      fail(503, 'MEDIA_REVOCATION_PENDING', 'Wait for the previous media connection to stop')
    }
  }

  app.post('/internal/ktv/media/authorize', trusted, handler(req => {
    const claims = req.body?.claims
    if (!claims || typeof claims.sub !== 'string') fail(400, 'INVALID_MEDIA_REQUEST', 'Invalid media authorization')
    return grants.authorize(claims)
  }))
  app.post('/internal/ktv/media/reconcile', trusted, handler(() => grants.invalidGrants()))
  app.post('/internal/ktv/media/removed', trusted, handler(req => {
    const row = db.prepare('SELECT * FROM ktv_media_grants WHERE identity = ?').get(req.body?.identity)
    if (!row || req.body?.room !== `ktv-${row.room_id}`) fail(404, 'MEDIA_NOT_FOUND', 'Media connection not found')
    // Removing a still-current publisher also invalidates its room output. An
    // old generation's acknowledgment cannot stop a replacement performance.
    grants.acknowledgeRemoval(row.identity)
    if (row.scope === 'publisher') playback.mediaFailed(row.room_id, row.performance_id, row.generation)
    return { removed: true }
  }))
  app.post('/internal/ktv/media/ready', trusted, handler(req => {
    const row = db.prepare('SELECT * FROM ktv_media_grants WHERE identity = ?').get(req.body?.identity)
    if (!row || req.body?.room !== `ktv-${row.room_id}`) fail(404, 'MEDIA_NOT_FOUND', 'Media connection not found')
    grants.acknowledgeReady(row.identity)
    return { ready: true }
  }))
  app.get('/api/ktv/rooms/:id/media/status', roomAccess(), handler(async req => {
    const view = viewerSnapshot(req)
    if (view.self.admission !== 'admitted') fail(403, 'NOT_ADMITTED', 'Room access is not available')
    let available = false
    try { await ready(); available = true } catch { /* Render an explicit unavailable state. */ }
    return { available, mode: view.room.performanceMode, serverUrl: '/api/ktv/media' }
  }))
  app.post('/api/ktv/rooms/:id/media-token', roomAccess(), handler(async req => {
    const view = viewerSnapshot(req), deviceId = device(req), id = commandId(req)
    await ready()
    // Membership comes from the authorized snapshot, never the request body.
    return { ...await grants.issue({ roomId: req.params.id, memberId: view.self.id, deviceId,
      deviceGrantId: req.ktvGrant?.id || null, scope: req.body?.scope, commandId: id }), serverUrl: '/api/ktv/media' }
  }))
  app.post('/api/ktv/rooms/:id/media/:identity/renew', roomAccess(), handler(async req => {
    const view = viewerSnapshot(req), deviceId = device(req), id = identity(req)
    const row = db.prepare('SELECT room_id FROM ktv_media_grants WHERE identity = ?').get(id)
    if (row?.room_id !== req.params.id) fail(403, 'MEDIA_REVOKED', 'Media access is unavailable')
    await ready()
    return { ...await grants.renew(id, view.self.id, deviceId), serverUrl: '/api/ktv/media' }
  }))
  app.post('/api/ktv/rooms/:id/media/:identity/output', roomAccess(), handler(async req => {
    const view = viewerSnapshot(req), deviceId = device(req), id = identity(req)
    const row = db.prepare('SELECT room_id FROM ktv_media_grants WHERE identity = ?').get(id)
    if (row?.room_id !== req.params.id) fail(403, 'MEDIA_REVOKED', 'Media access is unavailable')
    await ready()
    return { permit: grants.receivePermit(id, view.self.id, deviceId) }
  }))
  app.post('/api/ktv/rooms/:id/media/:identity/revoke', roomAccess(), handler(async req => {
    const view = viewerSnapshot(req), id = identity(req)
    const row = db.prepare('SELECT * FROM ktv_media_grants WHERE identity = ? AND room_id = ?').get(id, req.params.id)
    if (!row) fail(404, 'MEDIA_NOT_FOUND', 'Media connection not found')
    const own = row.member_id === view.self.id && (!req.ktvGrant || row.device_grant_id === req.ktvGrant.id)
    const moderator = !req.ktvGrant || req.ktvGrant.scope === 'controller'
    if (!own && !(moderator && ['host', 'cohost'].includes(view.self.role))) fail(403, 'FORBIDDEN', 'This media connection belongs to another member')
    await remove(grants.revoke({ roomId: req.params.id, identity: id }))
    return { identity: id, state: 'revoked' }
  }))
  app.post('/api/ktv/rooms/:id/media/:identity/ready', roomAccess(true), handler(async req => {
    const view = viewerSnapshot(req), id = identity(req), deviceId = device(req)
    const row = db.prepare('SELECT * FROM ktv_media_grants WHERE identity = ? AND room_id = ?').get(id, req.params.id)
    if (!row || row.member_id !== view.self.id || row.device_id !== deviceId || row.scope !== 'publisher' || row.state !== 'active') {
      fail(403, 'MEDIA_REVOKED', 'Media access is unavailable')
    }
    await control('/control/publisher-ready', { room: `ktv-${req.params.id}`, identity: id })
    if (!grants.publisherReady(req.params.id)) fail(409, 'MEDIA_NOT_READY', 'Wait for both performance tracks to connect')
    return { ready: true }
  }))
  app.post('/api/ktv/rooms/:id/media/mode', roomAccess(true), handler(async req => {
    const original = viewerSnapshot(req), id = commandId(req), mode = req.body?.mode
    if (!['local', 'online', 'hybrid'].includes(mode)) fail(400, 'INVALID_MEDIA_REQUEST', 'Choose a room performance mode')
    const payload = ['room.performance-mode', mode, req.body?.baseRevision]
    const prior = db.prepare('SELECT payload_hash FROM ktv_command_receipts WHERE room_id = ? AND actor_member_id = ? AND command_id = ?')
      .get(req.params.id, original.self.id, id)
    if (prior) { assertSamePayload(prior, payloadHash(payload)); return original }
    function check() {
      const room = activeRoom(db, req.params.id)
      hostMember(db, room.id, req.auth.sub); checkRevision(req, room)
      if (playback.snapshot(room.id).state !== 'idle') fail(409, 'PERFORMANCE_ACTIVE', 'Finish or cancel the current performance before changing mode')
      return room
    }
    check()
    await ready()
    await remove(grants.revoke({ roomId: req.params.id }))
    return transaction(db, () => {
      const receipt = db.prepare('SELECT payload_hash FROM ktv_command_receipts WHERE room_id = ? AND actor_member_id = ? AND command_id = ?')
        .get(req.params.id, original.self.id, id)
      if (receipt) { assertSamePayload(receipt, payloadHash(payload)); return viewerSnapshot(req) }
      const room = check(), view = viewerSnapshot(req)
      applyCommand(db, room.id, view.self.id, id, payload, () => {
        db.prepare('UPDATE ktv_rooms SET performance_mode = ? WHERE id = ?').run(mode, room.id)
        invalidateReadiness(db, room.id, clock); playback.invalidate(room.id)
        bump(db, room.id); event(db, room.id, req.auth.sub, 'room.performance_mode')
      })
      return viewerSnapshot(req)
    })
  }, true))
  return { grants, health: async () => (await control('/control/health')).ready === true }
}
