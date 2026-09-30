import { randomUUID } from 'node:crypto'
import { fail } from './ktv-errors.js'
import { invalidateReadiness } from './ktv-readiness.js'
import { effectiveTimeline, timelinePosition, OUTPUT_LEASE_MS, OUTPUT_MARGIN_MS, PLAYBACK_LEAD_MS, PREPARE_TIMEOUT_MS } from './ktv-timeline.js'

const stamp = () => new Date().toISOString()

export function createKtvPlayback({ db, clock, transaction, bump, event, broadcast, broadcastLease = () => {} }) {
  const devices = new Map()
  const leases = new Map()
  let presenceSequence = 0
  let closed = false
  // A previous process may have renewed a lease immediately before restart.
  // The new epoch cannot shorten that device's already-scheduled silence deadline.
  const restartSafeAfterMs = clock.nowMs() + OUTPUT_LEASE_MS + OUTPUT_MARGIN_MS
  const restarted = db.prepare("SELECT * FROM ktv_playback WHERE state != 'idle'").all()
  if (restarted.length) transaction(db, () => {
    for (const row of restarted) {
      const selection = db.prepare('SELECT * FROM ktv_readiness WHERE room_id = ?').get(row.room_id)
      db.prepare(`UPDATE ktv_playback SET state = 'paused', generation = generation + 1, clock_id = ?, performance_id = ?,
        position_ms = checkpoint_ms, anchor_server_ms = 0, pending_json = NULL,
        stage_device_id = NULL, stage_member_id = NULL, prepare_deadline_ms = NULL, updated_at = ? WHERE room_id = ?`)
        .run(clock.id, selection?.entry_id === row.entry_id ? selection.performance_id : row.performance_id, stamp(), row.room_id)
      bump(db, row.room_id)
      event(db, row.room_id, null, 'playback.recovered', row.entry_id)
    }
  })

  function read(roomId) { return db.prepare('SELECT * FROM ktv_playback WHERE room_id = ?').get(roomId) }
  function view(row) {
    if (!row) return { state: 'idle', clockId: clock.id, generation: 0, entryId: null, performanceId: null,
      positionMs: 0, anchorServerMs: 0, durationMs: 0, pendingTransition: null, assets: null,
      stageDeviceId: null, stageMemberId: null, lyricOffsetMs: 0, prepareDeadlineMs: null }
    const entry = row.entry_id && db.prepare(`SELECT q.title, q.singer_member_id, m.display_name FROM ktv_queue_entries q
      JOIN ktv_members m ON m.id = q.singer_member_id WHERE q.id = ?`).get(row.entry_id)
    return { state: row.state, clockId: row.clock_id, generation: row.generation, entryId: row.entry_id,
      performanceId: row.performance_id, positionMs: row.position_ms, anchorServerMs: row.anchor_server_ms,
      durationMs: row.duration_ms, pendingTransition: row.pending_json ? JSON.parse(row.pending_json) : null,
      assets: row.assets_json ? JSON.parse(row.assets_json) : null, stageDeviceId: row.stage_device_id,
      stageMemberId: row.stage_member_id, lyricOffsetMs: row.lyric_offset_ms, prepareDeadlineMs: row.prepare_deadline_ms,
      title: entry?.title || null, singerMemberId: entry?.singer_member_id || null, singerName: entry?.display_name || null }
  }
  function snapshot(roomId) {
    const playback = view(read(roomId))
    const lease = leases.get(roomId)
    return { ...playback, lease: lease ? publicLease(lease) : null, restartSafeAfterMs }
  }
  function publicLease(lease) {
    const { id, deviceId, clockId, performanceId, generation, sequence, expiresServerMs, safeAfterServerMs, nextGeneration, effectiveServerMs } = lease
    return { id, deviceId, clockId, performanceId, generation, sequence, expiresServerMs, safeAfterServerMs, nextGeneration, effectiveServerMs }
  }
  function presence(roomId) {
    return { sequence: presenceSequence, devices: [...devices.values()].filter(device => device.roomId === roomId)
      .map(device => ({ id: device.id, memberId: device.memberId, label: device.label, purpose: device.purpose,
        audioEnabled: device.audioEnabled, clockHealthy: device.clockHealthy, ready: Boolean(device.ready),
        readyGeneration: device.ready?.generation ?? null, connected: device.ws.readyState === 1 })) }
  }
  function connected(ws, authorized) {
    if (closed) return
    if (authorized.self.admission !== 'admitted') return
    const prior = devices.get(ws.clientDeviceId)
    if (prior && (prior.memberId !== authorized.self.id || prior.ws !== ws)) {
      fail(409, 'DEVICE_IN_USE', 'This device connection is already in use')
    }
    if (!prior) {
      devices.set(ws.clientDeviceId, { id: ws.clientDeviceId, roomId: ws.roomId, memberId: authorized.self.id,
        grantId: ws.principal.grantId || null, scope: authorized.deviceScope || 'controller', ws,
        label: 'Device', purpose: 'viewer', audioEnabled: false, clockHealthy: false, lastSeenMs: clock.nowMs(), ready: null })
      presenceSequence++
    }
  }
  function requireDevice(roomId, deviceId) {
    const device = devices.get(deviceId)
    const member = device && db.prepare('SELECT admission FROM ktv_members WHERE id = ? AND room_id = ?').get(device.memberId, roomId)
    const grant = device?.grantId && db.prepare('SELECT revoked_at, expires_at FROM ktv_device_grants WHERE id = ?').get(device.grantId)
    if (!device || device.roomId !== roomId || device.ws.readyState !== 1 || member?.admission !== 'admitted' ||
      (device.grantId && (!grant || grant.revoked_at || Date.parse(grant.expires_at) <= Date.now())) ||
      clock.nowMs() - device.lastSeenMs > OUTPUT_LEASE_MS) fail(409, 'DEVICE_NOT_READY', 'The stage device is not connected')
    return device
  }
  function current(req, row, checkRevision, room) {
    if (req.body?.clockId !== clock.id) fail(409, 'STALE_CLOCK', 'Room timing changed. Refresh and try again')
    if (!row || req.body?.performanceId !== row.performance_id || req.body?.generation !== row.generation || row.clock_id !== clock.id) {
      fail(409, 'STALE_GENERATION', 'Playback changed. Review it and try again')
    }
    checkRevision(req, room)
  }
  function activeLease(roomId) {
    const lease = leases.get(roomId)
    return lease && clock.nowMs() < lease.safeAfterServerMs ? lease : null
  }
  function ready(device, row) {
    return device.purpose === 'stage' && device.audioEnabled && device.clockHealthy && clock.nowMs() - device.lastSeenMs <= 4000 &&
      device.ready?.performanceId === row.performance_id && device.ready?.generation === row.generation &&
      device.ready?.clockId === clock.id && device.ready?.assetVersion === JSON.parse(row.assets_json).version
  }
  function ensureRow(roomId) {
    db.prepare(`INSERT OR IGNORE INTO ktv_playback (room_id, clock_id, updated_at) VALUES (?, ?, ?)`).run(roomId, clock.id, stamp())
    return read(roomId)
  }
  function assign(roomId, deviceId) {
    const device = requireDevice(roomId, deviceId)
    if (device.purpose !== 'stage' || !device.audioEnabled || !device.clockHealthy) fail(409, 'DEVICE_NOT_READY', 'Enable audio on that stage first')
    const row = ensureRow(roomId)
    const prior = view(row)
    const position = timelinePosition(prior, clock.nowMs())
    db.prepare(`UPDATE ktv_playback SET stage_device_id = ?, stage_member_id = ?, clock_id = ?, generation = generation + 1,
      state = ?, position_ms = ?, checkpoint_ms = ?, pending_json = NULL, anchor_server_ms = 0,
      prepare_deadline_ms = NULL, updated_at = ? WHERE room_id = ?`)
      .run(device.id, device.memberId, clock.id, row.entry_id ? 'paused' : 'idle', position, position, stamp(), roomId)
    bump(db, roomId)
    event(db, roomId, null, 'stage.assigned', device.id)
  }
  function prepare(roomId, readiness, assets) {
    const row = ensureRow(roomId)
    requireDevice(roomId, row.stage_device_id)
    if (['playing', 'scheduled'].includes(row.state) || row.pending_json) fail(409, 'PLAYBACK_ACTIVE', 'Pause or skip the active song first')
    if (readiness.state !== 'ready') fail(409, 'SINGER_NOT_READY', 'The singer must confirm readiness first')
    db.prepare(`UPDATE ktv_playback SET entry_id = ?, performance_id = ?, generation = generation + 1, clock_id = ?,
      state = 'preparing', position_ms = 0, checkpoint_ms = 0, duration_ms = ?, assets_json = ?, pending_json = NULL,
      anchor_server_ms = 0, prepare_deadline_ms = ?, updated_at = ? WHERE room_id = ?`)
      .run(readiness.entryId, readiness.performanceId, clock.id, assets.durationMs, JSON.stringify(assets),
        clock.nowMs() + PREPARE_TIMEOUT_MS, stamp(), roomId)
    bump(db, roomId)
    event(db, roomId, null, 'playback.preparing', readiness.entryId)
  }
  function start(roomId) {
    const row = read(roomId)
    if (!row || !['preparing', 'paused', 'recovering'].includes(row.state) || row.pending_json) fail(409, 'INVALID_PLAYBACK', 'Playback cannot start now')
    const human = db.prepare('SELECT * FROM ktv_readiness WHERE room_id = ?').get(roomId)
    if (human?.state !== 'ready' || human.performance_id !== row.performance_id || human.entry_id !== row.entry_id) {
      fail(409, 'SINGER_NOT_READY', 'The singer must confirm readiness for this performance')
    }
    const device = requireDevice(roomId, row.stage_device_id)
    if (!ready(device, row)) fail(409, 'DEVICE_NOT_READY', 'The designated stage is still preparing audio')
    const old = activeLease(roomId)
    if (old) fail(409, 'OUTPUT_STOPPING', 'Wait for the previous stage output to become silent')
    if (clock.nowMs() < restartSafeAfterMs) fail(409, 'OUTPUT_STOPPING', 'Wait for the previous service output lease to expire')
    // A paused generation may match the expired lease generation. Its terminal
    // record must not be mistaken for a newly granted lease when resuming.
    leases.delete(roomId)
    // The prepared generation is the scheduled generation. Requiring another
    // ready response after changing it would create an unnecessary race.
    const anchor = clock.nowMs() + PLAYBACK_LEAD_MS
    db.prepare(`UPDATE ktv_playback SET state = 'scheduled', anchor_server_ms = ?, prepare_deadline_ms = NULL,
      updated_at = ? WHERE room_id = ?`).run(anchor, stamp(), roomId)
    bump(db, roomId)
    event(db, roomId, null, 'playback.scheduled', row.entry_id)
    // Materialize the grant after commit through sweep(); avoid issuing a lease
    // for a transaction that could still roll back.
  }
  function transition(roomId, action, positionMs) {
    const row = read(roomId)
    if (!row || row.state === 'idle' || row.state === 'preparing' || row.pending_json) fail(409, 'INVALID_PLAYBACK', 'Playback cannot change now')
    const nowMs = clock.nowMs()
    if (action === 'pause' && !['playing', 'scheduled'].includes(row.state)) fail(409, 'INVALID_PLAYBACK', 'Playback is already paused')
    if (action === 'seek' && (!Number.isFinite(positionMs) || positionMs < 0 || positionMs >= row.duration_ms)) {
      fail(400, 'INVALID_POSITION', 'Choose a position inside the song')
    }
    const effectiveServerMs = nowMs + PLAYBACK_LEAD_MS
    const state = action === 'pause' || !['playing', 'scheduled'].includes(row.state) ? 'paused' : 'playing'
    const pending = { state, generation: row.generation + 1, effectiveServerMs, anchorServerMs: effectiveServerMs,
      positionMs: action === 'seek' ? positionMs : timelinePosition(view(row), effectiveServerMs) }
    db.prepare('UPDATE ktv_playback SET pending_json = ?, updated_at = ? WHERE room_id = ?')
      .run(JSON.stringify(pending), stamp(), roomId)
    bump(db, roomId)
    event(db, roomId, null, `playback.${action}_scheduled`, row.entry_id)
  }
  function invalidate(roomId, filter = {}) {
    const row = read(roomId)
    if (!row?.entry_id || row.state === 'idle') return false
    const entry = db.prepare('SELECT singer_member_id FROM ktv_queue_entries WHERE id = ?').get(row.entry_id)
    if ((filter.entryId && filter.entryId !== row.entry_id) ||
      (filter.memberId && filter.memberId !== entry?.singer_member_id && filter.memberId !== row.stage_member_id)) return false
    db.prepare(`UPDATE ktv_playback SET state = 'idle', entry_id = NULL, performance_id = NULL, generation = generation + 1,
      position_ms = 0, checkpoint_ms = 0, anchor_server_ms = 0, duration_ms = 0, assets_json = NULL,
      pending_json = NULL, prepare_deadline_ms = NULL, updated_at = ? WHERE room_id = ?`).run(stamp(), roomId)
    return true
  }
  function finish(roomId, outcome) {
    const row = read(roomId)
    if (!row?.entry_id || row.state === 'idle') fail(409, 'INVALID_PLAYBACK', 'No current performance')
    const entry = db.prepare('SELECT * FROM ktv_queue_entries WHERE id = ?').get(row.entry_id)
    const latestRound = db.prepare('SELECT COALESCE(MAX(round), 1) AS round FROM ktv_turn_history WHERE room_id = ?').get(roomId).round
    const served = new Set(db.prepare('SELECT singer_member_id FROM ktv_turn_history WHERE room_id = ? AND round = ?')
      .all(roomId, latestRound).map(turn => turn.singer_member_id))
    const eligible = db.prepare(`SELECT DISTINCT singer_member_id FROM ktv_queue_entries
      WHERE room_id = ? AND state = 'queued' AND accepted_at IS NOT NULL`).all(roomId)
    const nextRound = eligible.every(singer => served.has(singer.singer_member_id)) && served.size > 0
    db.prepare(`INSERT OR IGNORE INTO ktv_turn_history (room_id, entry_id, singer_member_id, outcome, round, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(roomId, entry.id, entry.singer_member_id, outcome, latestRound + Number(nextRound), stamp())
    // Keep the original queue CHECK constraint for additive compatibility. The
    // history row distinguishes finished/skipped from an unperformed cancellation.
    db.prepare("UPDATE ktv_queue_entries SET state = 'cancelled', updated_at = ? WHERE id = ?").run(stamp(), entry.id)
    invalidateReadiness(db, roomId, clock)
    invalidate(roomId)
    bump(db, roomId)
    event(db, roomId, null, `playback.${outcome}`, entry.id)
  }
  function recover(roomId, reason) {
    const row = read(roomId)
    if (!row || !['playing', 'scheduled', 'preparing'].includes(row.state)) return false
    const position = timelinePosition(view(row), clock.nowMs())
    db.prepare(`UPDATE ktv_playback SET state = 'recovering', generation = generation + 1, position_ms = ?, checkpoint_ms = ?,
      anchor_server_ms = 0, pending_json = NULL, prepare_deadline_ms = NULL, updated_at = ? WHERE room_id = ?`)
      .run(position, position, stamp(), roomId)
    bump(db, roomId)
    event(db, roomId, null, reason, row.entry_id)
    return true
  }
  function issueLease(row) {
    const lease = { id: randomUUID(), roomId: row.room_id, deviceId: row.stage_device_id, clockId: clock.id,
      performanceId: row.performance_id, generation: row.generation, sequence: 1,
      expiresServerMs: clock.nowMs() + OUTPUT_LEASE_MS, safeAfterServerMs: clock.nowMs() + OUTPUT_LEASE_MS + OUTPUT_MARGIN_MS }
    leases.set(row.room_id, lease)
    return lease
  }
  function deviceMessage(ws, message, authorized) {
    connected(ws, authorized)
    const device = devices.get(ws.clientDeviceId)
    if (!device || device.ws !== ws) fail(403, 'NOT_ADMITTED', 'Room device access is unavailable')
    const nowMs = clock.nowMs()
    device.lastSeenMs = nowMs
    if (message.type === 'device.status') {
      if (!['viewer', 'stage', 'guide'].includes(message.purpose) || typeof message.audioEnabled !== 'boolean' ||
        typeof message.clockHealthy !== 'boolean' || typeof message.label !== 'string' || message.label.length > 40 ||
        /[\u0000-\u001f]/.test(message.label)) fail(400, 'INVALID_DEVICE_STATUS', 'Invalid device status')
      if (device.scope === 'display' && message.purpose === 'guide') fail(403, 'FORBIDDEN', 'Display access cannot use a singer guide')
      const changed = device.purpose !== message.purpose || device.label !== (message.label.trim() || 'Device') ||
        device.audioEnabled !== message.audioEnabled || device.clockHealthy !== message.clockHealthy
      device.purpose = message.purpose; device.label = message.label.trim() || 'Device'
      device.audioEnabled = message.audioEnabled; device.clockHealthy = message.clockHealthy
      if (!device.audioEnabled || !device.clockHealthy || (read(ws.roomId)?.stage_device_id === device.id && device.purpose !== 'stage')) {
        device.ready = null
        if (read(ws.roomId)?.stage_device_id === device.id) transaction(db, () => recover(ws.roomId, 'stage.unavailable'))
      }
      if (changed) { presenceSequence++; broadcast(ws.roomId) }
    } else if (message.type === 'device.ready') {
      const row = read(ws.roomId)
      const assets = row?.assets_json && JSON.parse(row.assets_json)
      const pending = row?.pending_json && JSON.parse(row.pending_json)
      if (!row?.entry_id || message.clockId !== clock.id || message.performanceId !== row.performance_id ||
        (message.generation !== row.generation && message.generation !== pending?.generation) || message.assetVersion !== assets?.version) fail(409, 'STALE_GENERATION', 'Audio preparation changed')
      if (!device.audioEnabled || !device.clockHealthy || !Number.isFinite(message.durationMs) ||
        Math.abs(message.durationMs - row.duration_ms) > 250) fail(409, 'DEVICE_NOT_READY', 'Audio has not decoded to the expected duration')
      if (device.purpose === 'guide' && db.prepare('SELECT singer_member_id FROM ktv_queue_entries WHERE id = ?').get(row.entry_id).singer_member_id !== device.memberId) {
        fail(403, 'FORBIDDEN', 'Only the selected singer can prepare a private guide')
      }
      if (device.purpose !== 'guide' && device.id !== row.stage_device_id) fail(403, 'FORBIDDEN', 'Only the designated stage can prepare backing')
      const prepared = { clockId: clock.id, performanceId: row.performance_id, generation: message.generation, assetVersion: assets.version }
      if (message.generation === row.generation) device.ready = prepared
      else device.nextReady = prepared
      presenceSequence++
      broadcast(ws.roomId)
    } else if (message.type === 'device.heartbeat') {
      const row = read(ws.roomId), lease = leases.get(ws.roomId)
      const pending = row?.pending_json && JSON.parse(row.pending_json)
      if (lease && lease.deviceId === device.id && lease.clockId === message.clockId && lease.id === message.leaseId &&
        lease.generation === message.generation && lease.performanceId === message.performanceId &&
        row?.generation === lease.generation && row.performance_id === lease.performanceId &&
        ['scheduled', 'playing'].includes(row.state) && nowMs < lease.expiresServerMs && ready(device, row)) {
        lease.sequence++; lease.expiresServerMs = pending?.state === 'paused' ? Math.min(nowMs + OUTPUT_LEASE_MS, pending.effectiveServerMs) : nowMs + OUTPUT_LEASE_MS
        lease.safeAfterServerMs = lease.expiresServerMs + OUTPUT_MARGIN_MS
        lease.nextGeneration = pending?.generation; lease.effectiveServerMs = pending?.effectiveServerMs
        broadcastLease(ws.roomId, publicLease(lease))
        return { type: 'lease', lease: publicLease(lease) }
      }
    } else if (message.type === 'device.stopped') {
      const lease = leases.get(ws.roomId)
      if (lease && lease.deviceId === device.id && message.leaseId === lease.id && message.generation === lease.generation &&
        message.clockId === lease.clockId) {
        lease.expiresServerMs = Math.min(lease.expiresServerMs, nowMs)
        lease.safeAfterServerMs = Math.min(lease.safeAfterServerMs, nowMs + OUTPUT_MARGIN_MS)
        lease.sequence++
        broadcastLease(ws.roomId, publicLease(lease))
      }
    } else if (message.type === 'playback.ended') {
      const row = read(ws.roomId), lease = leases.get(ws.roomId)
      if (!row || row.state === 'idle' || row.pending_json || message.clockId !== clock.id || message.performanceId !== row.performance_id ||
        message.generation !== row.generation || message.entryId !== row.entry_id || lease?.id !== message.leaseId ||
        lease.deviceId !== device.id || nowMs >= lease.expiresServerMs) fail(409, 'STALE_GENERATION', 'Completion is obsolete')
      if (timelinePosition(view(row), nowMs) < row.duration_ms - 250) fail(409, 'EARLY_COMPLETION', 'The song is not finished yet')
      transaction(db, () => finish(ws.roomId, 'finished'))
      broadcast(ws.roomId)
    } else fail(400, 'PROTOCOL_UNSUPPORTED', 'Unsupported room device message')
    return { type: 'device.ack', messageType: message.type, deviceId: device.id }
  }
  function disconnected(ws) {
    if (closed) return
    const device = devices.get(ws.clientDeviceId)
    if (device?.ws !== ws) return
    devices.delete(device.id); presenceSequence++
    const row = read(device.roomId)
    if (row?.stage_device_id === device.id) transaction(db, () => recover(device.roomId, 'stage.disconnected'))
    broadcast(device.roomId)
  }
  function sweep() {
    if (closed) return
    const changed = new Set()
    const nowMs = clock.nowMs()
    for (const row of db.prepare("SELECT * FROM ktv_playback WHERE state != 'idle'").all()) {
      let needsLease = false
      transaction(db, () => {
        const room = db.prepare('SELECT status, expires_at FROM ktv_rooms WHERE id = ?').get(row.room_id)
        if (room.status !== 'open' || Date.parse(room.expires_at) <= Date.now()) {
          invalidate(row.room_id); changed.add(row.room_id); return
        }
        const pending = row.pending_json && JSON.parse(row.pending_json)
        const pendingLease = leases.get(row.room_id)
        if (pending && pendingLease && pendingLease.nextGeneration !== pending.generation) {
          pendingLease.nextGeneration = pending.generation; pendingLease.effectiveServerMs = pending.effectiveServerMs
          pendingLease.sequence++
          if (pending.state === 'paused') {
            pendingLease.expiresServerMs = Math.min(pendingLease.expiresServerMs, pending.effectiveServerMs)
            pendingLease.safeAfterServerMs = pendingLease.expiresServerMs + OUTPUT_MARGIN_MS
          }
          changed.add(row.room_id)
        }
        if (pending && nowMs >= pending.effectiveServerMs) {
          db.prepare(`UPDATE ktv_playback SET state = ?, generation = ?, position_ms = ?, checkpoint_ms = ?,
            anchor_server_ms = ?, pending_json = NULL, updated_at = ? WHERE room_id = ?`)
            .run(pending.state, pending.generation, pending.positionMs, pending.positionMs, pending.anchorServerMs, stamp(), row.room_id)
          const device = devices.get(row.stage_device_id)
          if (device) { device.ready = device.nextReady || null; device.nextReady = null }
          if (pendingLease) {
            pendingLease.generation = pending.generation; pendingLease.nextGeneration = undefined
            pendingLease.effectiveServerMs = undefined; pendingLease.sequence++
          }
          bump(db, row.room_id); changed.add(row.room_id); return
        }
        if (row.state === 'preparing' && nowMs >= row.prepare_deadline_ms) {
          recover(row.room_id, 'playback.prepare_timeout'); changed.add(row.room_id); return
        }
        if (['scheduled', 'playing'].includes(row.state)) {
          let device
          try { device = requireDevice(row.room_id, row.stage_device_id) } catch { /* recover below */ }
          const lease = leases.get(row.room_id)
          if (!device || !ready(device, row) || (lease?.generation === row.generation && nowMs >= lease.expiresServerMs)) {
            recover(row.room_id, 'stage.lease_expired'); changed.add(row.room_id); return
          }
          if (!lease || (lease.generation !== row.generation && nowMs >= lease.safeAfterServerMs)) {
            needsLease = true
            changed.add(row.room_id)
          }
          if (row.state === 'scheduled' && nowMs >= row.anchor_server_ms) {
            db.prepare("UPDATE ktv_playback SET state = 'playing', updated_at = ? WHERE room_id = ?").run(stamp(), row.room_id)
            bump(db, row.room_id); changed.add(row.room_id)
          }
          // A bounded checkpoint survives process loss. It never extrapolates
          // server downtime or writes the per-frame playhead.
          if (timelinePosition(view(row), nowMs) - row.checkpoint_ms >= 5000) {
            db.prepare('UPDATE ktv_playback SET checkpoint_ms = ? WHERE room_id = ?')
              .run(timelinePosition(view(row), nowMs), row.room_id)
          }
        }
      })
      if (needsLease) {
        const committed = read(row.room_id), device = devices.get(committed.stage_device_id)
        const nextLease = issueLease(committed)
        device.ws.send(JSON.stringify({ protocolVersion: 1, type: 'lease', roomId: row.room_id, lease: publicLease(nextLease) }))
      }
    }
    for (const [roomId, lease] of leases) if (nowMs >= lease.safeAfterServerMs && read(roomId)?.generation !== lease.generation) leases.delete(roomId)
    for (const roomId of changed) broadcast(roomId)
  }
  const timer = setInterval(sweep, 250)
  timer.unref()
  return { snapshot, presence, connected, disconnected, deviceMessage, current, assign, prepare, start,
    transition, invalidate, finish, read, sweep, close: () => { closed = true; clearInterval(timer) } }
}
