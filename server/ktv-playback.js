import { randomUUID } from 'node:crypto'
import { fail } from './ktv-errors.js'
import { invalidateReadiness } from './ktv-readiness.js'
import { recordTurn, requestNextTurn, offerNextTurn } from './ktv-turns.js'
import { timelinePosition } from './ktv-timeline.js'
import { ktvTiming, ktvRestartSilenceMs, KTV_MEDIA_OUTPUT_PERMIT_MS } from './ktv-timing.js'
import { ktvFeatures, ktvGuideAssets } from './ktv-features.js'
import { PARTY_MEDIA_PROTOCOL_VERSION, PARTY_LEGACY_MEDIA_PROTOCOL_VERSIONS } from './ktv-media-protocol.js'

const stamp = () => new Date().toISOString()

export function createKtvPlayback({ db, clock, transaction, bump, event, broadcast, broadcastLease = () => {}, hostGraceMs, timing: timingOptions, features: featureOptions }) {
  const features = ktvFeatures(featureOptions)
  const timing = ktvTiming({ ...timingOptions, ...(hostGraceMs === undefined ? {} : { hostGraceMs }) })
  hostGraceMs = timing.hostGraceMs
  const devices = new Map()
  const leases = new Map()
  const hostMissing = new Map()
  const hostSignatures = new Map()
  let presenceSequence = 0
  let closed = false
  // A previous process may have renewed a lease immediately before restart.
  // The new epoch cannot shorten that device's already-scheduled silence deadline.
  const restartSafeAfterMs = clock.nowMs() + transaction(db, () => ktvRestartSilenceMs(db, timing))
  const restarted = db.prepare("SELECT * FROM ktv_playback WHERE state != 'idle'").all()
  if (restarted.length) transaction(db, () => {
    for (const row of restarted) {
      const selection = db.prepare('SELECT * FROM ktv_readiness WHERE room_id = ?').get(row.room_id)
      db.prepare(`UPDATE ktv_playback SET state = 'paused', generation = generation + 1, clock_id = ?, performance_id = ?,
        position_ms = checkpoint_ms, anchor_server_ms = 0, pending_json = NULL,
        stage_device_id = NULL, stage_member_id = NULL, guide_device_id = NULL, recovery_reason = 'service.restarted',
        prepare_deadline_ms = NULL, updated_at = ? WHERE room_id = ?`)
        .run(clock.id, selection?.entry_id === row.entry_id ? selection.performance_id : row.performance_id, stamp(), row.room_id)
      bump(db, row.room_id)
      event(db, row.room_id, null, 'playback.recovered', row.entry_id)
    }
  })
  if (!features.guide) transaction(db, () => {
    for (const row of db.prepare('SELECT room_id FROM ktv_playback WHERE guide_required != 0 OR guide_device_id IS NOT NULL').all()) {
      db.prepare('UPDATE ktv_playback SET guide_required = 0, guide_device_id = NULL WHERE room_id = ?').run(row.room_id)
      bump(db, row.room_id)
      event(db, row.room_id, null, 'guide.disabled')
    }
  })

  function read(roomId) { return db.prepare('SELECT * FROM ktv_playback WHERE room_id = ?').get(roomId) }
  function view(row) {
    if (!row) return { state: 'idle', clockId: clock.id, generation: 0, entryId: null, performanceId: null,
      positionMs: 0, anchorServerMs: 0, durationMs: 0, pendingTransition: null, assets: null,
      stageDeviceId: null, stageMemberId: null, lyricOffsetMs: 0, prepareDeadlineMs: null,
      guideRequired: false, guideDeviceId: null, recoveryReason: null }
    const entry = row.entry_id && db.prepare(`SELECT q.title, q.singer_member_id, m.display_name FROM ktv_queue_entries q
      JOIN ktv_members m ON m.id = q.singer_member_id WHERE q.id = ?`).get(row.entry_id)
    return { state: row.state, clockId: row.clock_id, generation: row.generation, entryId: row.entry_id,
      performanceId: row.performance_id, positionMs: row.position_ms, anchorServerMs: row.anchor_server_ms,
      durationMs: row.duration_ms, pendingTransition: row.pending_json ? JSON.parse(row.pending_json) : null,
      assets: ktvGuideAssets(row.assets_json ? JSON.parse(row.assets_json) : null, features), stageDeviceId: row.stage_device_id,
      stageMemberId: row.stage_member_id, lyricOffsetMs: row.lyric_offset_ms, prepareDeadlineMs: row.prepare_deadline_ms,
      title: entry?.title || null, singerMemberId: entry?.singer_member_id || null, singerName: entry?.display_name || null,
      guideRequired: Boolean(row.guide_required), guideDeviceId: row.guide_device_id, recoveryReason: row.recovery_reason }
  }
  function snapshot(roomId) {
    const row = read(roomId), playback = view(row)
    const lease = leases.get(roomId)
    return { ...playback, lease: lease ? publicLease(lease) : null, restartSafeAfterMs,
      guidePrepared: row?.entry_id ? guideReady(row) : false }
  }
  function publicLease(lease) {
    const { id, deviceId, clockId, performanceId, generation, sequence, expiresServerMs, safeAfterServerMs, nextGeneration, effectiveServerMs } = lease
    return { id, deviceId, clockId, performanceId, generation, sequence, expiresServerMs, safeAfterServerMs, nextGeneration, effectiveServerMs }
  }
  function presence(roomId) {
    return { sequence: presenceSequence, host: hostPresence(roomId), devices: [...devices.values()].filter(device => device.roomId === roomId)
      .map(device => ({ id: device.id, memberId: device.memberId, scope: device.scope, deviceGrantId: device.grantId, mediaProtocol: device.mediaProtocol || 0, label: device.label, purpose: device.purpose,
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
        label: 'Device', purpose: 'viewer', audioEnabled: false, clockHealthy: false, audioIssue: null, lastSeenMs: clock.nowMs(), ready: null })
      presenceSequence++
    }
  }
  function requireDevice(roomId, deviceId) {
    const device = devices.get(deviceId)
    const member = device && db.prepare('SELECT admission FROM ktv_members WHERE id = ? AND room_id = ?').get(device.memberId, roomId)
    const grant = device?.grantId && db.prepare('SELECT revoked_at, expires_at FROM ktv_device_grants WHERE id = ?').get(device.grantId)
    if (!device || device.roomId !== roomId || device.ws.readyState !== 1 || member?.admission !== 'admitted' ||
      (device.grantId && (!grant || grant.revoked_at || Date.parse(grant.expires_at) <= Date.now())) ||
      clock.nowMs() - device.lastSeenMs > timing.outputLeaseMs) fail(409, 'DEVICE_NOT_READY', 'The stage device is not connected')
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
  // Receiver buffers outlive source shutdown. Reserve every deadline before it
  // leaves the server, so a source acknowledgment cannot authorize overlapping
  // replacement output while a listener's page tasks are stalled.
  function reserveReceiveOutput({ roomId, leaseId, clockId, performanceId, generation, expiresServerMs }) {
    if (closed) return false
    const row = read(roomId), lease = leases.get(roomId), nowMs = clock.nowMs()
    const pending = row?.pending_json && JSON.parse(row.pending_json)
    if (!row || !['scheduled', 'playing'].includes(row.state) || !lease ||
      lease.id !== leaseId || lease.deviceId !== row.stage_device_id ||
      clockId !== clock.id || row.clock_id !== clockId || lease.clockId !== clockId ||
      row.performance_id !== performanceId || lease.performanceId !== performanceId ||
      row.generation !== generation || lease.generation !== generation ||
      !Number.isFinite(expiresServerMs) || expiresServerMs <= nowMs ||
      expiresServerMs > nowMs + KTV_MEDIA_OUTPUT_PERMIT_MS || expiresServerMs > lease.expiresServerMs ||
      (pending && expiresServerMs > pending.effectiveServerMs)) return false
    // Five seconds is the publisher grant ceiling, below the minimum stage
    // lease. The durable restart silence bound therefore also covers receivers.
    lease.receiverDeadlineServerMs = Math.max(lease.receiverDeadlineServerMs || 0, expiresServerMs)
    lease.safeAfterServerMs = Math.max(lease.safeAfterServerMs, lease.receiverDeadlineServerMs + timing.outputMarginMs)
    return true
  }
  function receiverSafeAfter(lease) {
    return lease.receiverDeadlineServerMs === undefined ? 0 : lease.receiverDeadlineServerMs + timing.outputMarginMs
  }
  function ready(device, row, purpose = 'stage') {
    return device?.purpose === purpose && device.audioEnabled && device.clockHealthy && clock.nowMs() - device.lastSeenMs <= 4000 &&
      device.ready?.performanceId === row.performance_id && device.ready?.generation === row.generation &&
      device.ready?.clockId === clock.id && device.ready?.assetVersion === JSON.parse(row.assets_json).version &&
      (purpose !== 'guide' || clock.nowMs() - device.ready.atMs <= 4000)
  }
  function guideReady(row) {
    if (!features.guide) return false
    if (!row.guide_device_id || !row.assets_json || !JSON.parse(row.assets_json).original) return false
    try {
      const device = requireDevice(row.room_id, row.guide_device_id)
      const singer = db.prepare('SELECT singer_member_id FROM ktv_queue_entries WHERE id = ?').get(row.entry_id)
      return device.id !== row.stage_device_id && device.memberId === singer?.singer_member_id && ready(device, row, 'guide')
    } catch { return false }
  }
  function controllers(roomId) {
    const members = new Set()
    for (const device of devices.values()) if (device.roomId === roomId && device.scope === 'controller') {
      try { requireDevice(roomId, device.id); members.add(device.memberId) } catch { /* Stale or revoked device. */ }
    }
    return members
  }
  function hostPresence(roomId) {
    const members = controllers(roomId)
    const host = db.prepare("SELECT id FROM ktv_members WHERE room_id = ? AND role = 'host' AND admission = 'admitted'").get(roomId)
    const cohost = db.prepare(`SELECT id FROM ktv_members WHERE room_id = ? AND cohost_at IS NOT NULL AND admission = 'admitted'
      ORDER BY cohost_at, id`).all(roomId).find(member => members.has(member.id))
    const connected = Boolean(host && members.has(host.id))
    const missing = hostMissing.get(roomId)
    return { memberId: host?.id || null, connected, controlAvailable: connected || Boolean(cohost),
      graceDeadlineMs: !connected && missing?.memberId === host?.id ? missing.sinceMs + hostGraceMs : null,
      transferCandidateId: cohost?.id || null, graceMs: hostGraceMs }
  }
  function hostPolicy(roomId) {
    let state = hostPresence(roomId)
    if (state.connected || !state.memberId) hostMissing.delete(roomId)
    else {
      let missing = hostMissing.get(roomId)
      if (!missing || missing.memberId !== state.memberId) {
        missing = { memberId: state.memberId, sinceMs: clock.nowMs() }
        hostMissing.set(roomId, missing)
      }
      if (clock.nowMs() >= missing.sinceMs + hostGraceMs && state.transferCandidateId) {
        const now = stamp()
        // Both changes commit together, preserving the one-host unique index.
        db.prepare("UPDATE ktv_members SET role = 'member', cohost_at = NULL, updated_at = ? WHERE id = ?").run(now, state.memberId)
        db.prepare("UPDATE ktv_members SET role = 'host', cohost_at = NULL, updated_at = ? WHERE id = ?").run(now, state.transferCandidateId)
        bump(db, roomId); event(db, roomId, null, 'room.host_transferred_after_loss', state.transferCandidateId)
        hostMissing.delete(roomId)
      }
    }
    state = hostPresence(roomId)
    const signature = JSON.stringify(state)
    if (signature === hostSignatures.get(roomId)) return false
    hostSignatures.set(roomId, signature); presenceSequence++
    return true
  }
  function advance(roomId) {
    if (!hostPresence(roomId).controlAvailable) return false
    const entryId = offerNextTurn(db, roomId, clock)
    if (!entryId) return false
    bump(db, roomId); event(db, roomId, null, 'readiness.auto_offered', entryId)
    return true
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
      prepare_deadline_ms = NULL, recovery_reason = NULL, updated_at = ? WHERE room_id = ?`)
      .run(device.id, device.memberId, clock.id, row.entry_id ? 'paused' : 'idle', position, position, stamp(), roomId)
    bump(db, roomId)
    event(db, roomId, null, 'stage.assigned', device.id)
  }
  function prepare(roomId, readiness, assets) {
    assets = ktvGuideAssets(assets, features)
    const row = ensureRow(roomId)
    requireDevice(roomId, row.stage_device_id)
    if (['playing', 'scheduled'].includes(row.state) || row.pending_json) fail(409, 'PLAYBACK_ACTIVE', 'Pause or skip the active song first')
    if (readiness.state !== 'ready') fail(409, 'SINGER_NOT_READY', 'The singer must confirm readiness first')
    const samePerformance = row.performance_id === readiness.performanceId
    db.prepare(`UPDATE ktv_playback SET entry_id = ?, performance_id = ?, generation = generation + 1, clock_id = ?,
      state = 'preparing', position_ms = 0, checkpoint_ms = 0, duration_ms = ?, assets_json = ?, pending_json = NULL,
      anchor_server_ms = 0, guide_required = ?, guide_device_id = ?, recovery_reason = NULL, lyric_offset_ms = ?,
      prepare_deadline_ms = ?, updated_at = ? WHERE room_id = ?`)
      .run(readiness.entryId, readiness.performanceId, clock.id, assets.durationMs, JSON.stringify(assets),
        samePerformance ? row.guide_required : 0, samePerformance ? row.guide_device_id : null, samePerformance ? row.lyric_offset_ms : 0,
        clock.nowMs() + timing.prepareTimeoutMs, stamp(), roomId)
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
    const mode = db.prepare('SELECT * FROM ktv_rooms WHERE id = ?').get(roomId).performance_mode || 'local'
    if (mode !== 'local') {
      if (!api.media) fail(503, 'MEDIA_UNAVAILABLE', 'Online audio is not configured')
      if (device.mediaProtocol !== PARTY_MEDIA_PROTOCOL_VERSION) fail(409, 'MEDIA_CLIENT_UPDATE', 'Update the app and reopen this room before using online audio')
      const singer = db.prepare('SELECT singer_member_id FROM ktv_queue_entries WHERE id = ?').get(row.entry_id)?.singer_member_id
      const member = db.prepare('SELECT * FROM ktv_members WHERE id = ?').get(device.memberId)
      if (device.scope === 'display' || (device.memberId !== singer && !(mode === 'hybrid' && (member.role === 'host' || member.cohost_at)))) {
        fail(403, 'MEDIA_FORBIDDEN', 'Select the singer’s performing device or a hybrid host mixer')
      }
    }
    if (!ready(device, row)) fail(409, 'DEVICE_NOT_READY', 'The designated stage is still preparing audio')
    if (row.guide_required && !guideReady(row)) fail(409, 'GUIDE_NOT_READY', 'The singer requires a prepared vocal guide before starting')
    if (!hostPresence(roomId).controlAvailable) fail(409, 'HOST_UNAVAILABLE', 'Reconnect a host or co-host controller before starting')
    const old = activeLease(roomId)
    if (old) fail(409, 'OUTPUT_STOPPING', 'Wait for the previous stage output to become silent')
    if (clock.nowMs() < restartSafeAfterMs) fail(409, 'OUTPUT_STOPPING', 'Wait for the previous service output lease to expire')
    // A paused generation may match the expired lease generation. Its terminal
    // record must not be mistaken for a newly granted lease when resuming.
    leases.delete(roomId)
    // The prepared generation is the scheduled generation. Requiring another
    // ready response after changing it would create an unnecessary race.
    const anchor = clock.nowMs() + (mode === 'local' ? timing.playbackLeadMs : timing.onlineLeadMs)
    db.prepare(`UPDATE ktv_playback SET state = 'scheduled', anchor_server_ms = ?, prepare_deadline_ms = NULL, recovery_reason = NULL,
      updated_at = ? WHERE room_id = ?`).run(anchor, stamp(), roomId)
    bump(db, roomId)
    event(db, roomId, null, 'playback.scheduled', row.entry_id)
    // Materialize the grant after commit through sweep(); avoid issuing a lease
    // for a transaction that could still roll back.
  }
  function guide(roomId, memberId, required, deviceId) {
    if (!features.guide) fail(503, 'GUIDE_DISABLED', 'Private vocal guides are temporarily unavailable')
    const row = read(roomId)
    const singer = row?.entry_id && db.prepare('SELECT singer_member_id FROM ktv_queue_entries WHERE id = ?').get(row.entry_id)
    if (!row || row.state === 'idle' || singer?.singer_member_id !== memberId) fail(403, 'FORBIDDEN', 'Only the selected singer can choose required guidance')
    if (typeof required !== 'boolean') fail(400, 'INVALID_INPUT', 'Choose whether guidance is required')
    if (required) {
      if (!JSON.parse(row.assets_json).original) fail(409, 'GUIDE_UNAVAILABLE', 'Original audio is unavailable for this song')
      const device = requireDevice(roomId, deviceId)
      if (device.memberId !== memberId || device.scope !== 'controller' || device.id === row.stage_device_id) {
        fail(403, 'FORBIDDEN', 'Choose your own separate guide phone')
      }
    }
    db.prepare('UPDATE ktv_playback SET guide_required = ?, guide_device_id = ?, updated_at = ? WHERE room_id = ?')
      .run(Number(required), required ? deviceId : null, stamp(), roomId)
    const recovered = required && ['scheduled', 'playing'].includes(row.state) && !guideReady(read(roomId)) && recover(roomId, 'guide.unavailable')
    if (!recovered) bump(db, roomId)
    event(db, roomId, null, required ? 'guide.required' : 'guide.optional', required ? deviceId : null)
  }
  function transition(roomId, action, positionMs) {
    const row = read(roomId)
    if (!row || row.state === 'idle' || row.state === 'preparing' || row.pending_json) fail(409, 'INVALID_PLAYBACK', 'Playback cannot change now')
    const nowMs = clock.nowMs()
    if (action === 'pause' && !['playing', 'scheduled'].includes(row.state)) fail(409, 'INVALID_PLAYBACK', 'Playback is already paused')
    const mode = db.prepare('SELECT * FROM ktv_rooms WHERE id = ?').get(roomId)?.performance_mode || 'local'
    if (mode !== 'local' && action === 'seek' && ['playing', 'scheduled'].includes(row.state)) {
      fail(409, 'MEDIA_PAUSE_REQUIRED', 'Pause the online performance before seeking, then prepare capture again')
    }
    if (action === 'seek' && (!Number.isFinite(positionMs) || positionMs < 0 || positionMs >= row.duration_ms)) {
      fail(400, 'INVALID_POSITION', 'Choose a position inside the song')
    }
    const effectiveServerMs = Math.max(nowMs + timing.playbackLeadMs, leases.get(roomId)?.receiverDeadlineServerMs || 0)
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
      pending_json = NULL, prepare_deadline_ms = NULL, guide_required = 0, guide_device_id = NULL,
      recovery_reason = NULL, updated_at = ? WHERE room_id = ?`).run(stamp(), roomId)
    return true
  }
  function finish(roomId, outcome) {
    const row = read(roomId)
    if (!row?.entry_id || row.state === 'idle') fail(409, 'INVALID_PLAYBACK', 'No current performance')
    const entry = db.prepare('SELECT * FROM ktv_queue_entries WHERE id = ?').get(row.entry_id)
    recordTurn(db, roomId, entry, outcome)
    // Keep the original queue CHECK constraint for additive compatibility. The
    // history row distinguishes finished/skipped from an unperformed cancellation.
    db.prepare("UPDATE ktv_queue_entries SET state = 'cancelled', updated_at = ? WHERE id = ?").run(stamp(), entry.id)
    invalidateReadiness(db, roomId, clock)
    invalidate(roomId)
    requestNextTurn(db, roomId)
    advance(roomId)
    bump(db, roomId)
    event(db, roomId, null, `playback.${outcome}`, entry.id)
  }
  function decline(roomId, entry) {
    recordTurn(db, roomId, entry, 'declined')
    db.prepare("UPDATE ktv_queue_entries SET state = 'cancelled', updated_at = ? WHERE id = ?").run(stamp(), entry.id)
    invalidateReadiness(db, roomId, clock); invalidate(roomId)
    requestNextTurn(db, roomId); advance(roomId)
  }
  function recover(roomId, reason) {
    const row = read(roomId)
    if (!row || !['playing', 'scheduled', 'preparing'].includes(row.state)) return false
    const position = timelinePosition(view(row), clock.nowMs())
    db.prepare(`UPDATE ktv_playback SET state = 'recovering', generation = generation + 1, position_ms = ?, checkpoint_ms = ?,
      anchor_server_ms = 0, pending_json = NULL, prepare_deadline_ms = NULL, recovery_reason = ?, updated_at = ? WHERE room_id = ?`)
      .run(position, position, reason, stamp(), roomId)
    bump(db, roomId)
    event(db, roomId, null, reason, row.entry_id)
    return true
  }
  function issueLease(row) {
    const lease = { id: randomUUID(), roomId: row.room_id, deviceId: row.stage_device_id, clockId: clock.id,
      performanceId: row.performance_id, generation: row.generation, sequence: 1,
      expiresServerMs: clock.nowMs() + timing.outputLeaseMs, safeAfterServerMs: clock.nowMs() + timing.outputLeaseMs + timing.outputMarginMs }
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
        /[\u0000-\u001f]/.test(message.label) ||
        (message.mediaProtocol !== undefined && ![...PARTY_LEGACY_MEDIA_PROTOCOL_VERSIONS, PARTY_MEDIA_PROTOCOL_VERSION].includes(message.mediaProtocol)) ||
        (message.audioIssue != null && !['drift', 'output', 'decode', 'suspended'].includes(message.audioIssue))) fail(400, 'INVALID_DEVICE_STATUS', 'Invalid device status')
      if (device.scope === 'display' && message.purpose === 'guide') fail(403, 'FORBIDDEN', 'Display access cannot use a singer guide')
      if (!features.guide && message.purpose === 'guide') fail(503, 'GUIDE_DISABLED', 'Private vocal guides are temporarily unavailable')
      const changed = device.purpose !== message.purpose || device.label !== (message.label.trim() || 'Device') ||
        device.audioEnabled !== message.audioEnabled || device.clockHealthy !== message.clockHealthy || device.audioIssue !== (message.audioIssue || null) || device.mediaProtocol !== (message.mediaProtocol || 0)
      device.purpose = message.purpose; device.label = message.label.trim() || 'Device'
      device.audioEnabled = message.audioEnabled; device.clockHealthy = message.clockHealthy
      device.mediaProtocol = message.mediaProtocol || 0
      device.audioIssue = message.audioIssue || null
      const row = read(ws.roomId)
      const incompatibleStage = row?.stage_device_id === device.id && device.mediaProtocol !== PARTY_MEDIA_PROTOCOL_VERSION &&
        (db.prepare('SELECT * FROM ktv_rooms WHERE id = ?').get(ws.roomId)?.performance_mode || 'local') !== 'local'
      const shouldRecover = ['scheduled', 'playing'].includes(row?.state) || Boolean(device.audioIssue)
      if (!device.audioEnabled || !device.clockHealthy || (row?.stage_device_id === device.id && device.purpose !== 'stage') ||
        (row?.guide_device_id === device.id && device.purpose !== 'guide') || incompatibleStage) {
        device.ready = null; device.nextReady = null
        if (shouldRecover && row?.stage_device_id === device.id) transaction(db, () => recover(ws.roomId, `stage.${device.audioIssue || 'unavailable'}`))
        else if (shouldRecover && row?.guide_required && row.guide_device_id === device.id) transaction(db, () => recover(ws.roomId, `guide.${device.audioIssue || 'unavailable'}`))
      }
      if (changed) { presenceSequence++; broadcast(ws.roomId) }
    } else if (message.type === 'device.ready') {
      const row = read(ws.roomId)
      const assets = row?.assets_json && JSON.parse(row.assets_json)
      const pending = row?.pending_json && JSON.parse(row.pending_json)
      if (!row?.entry_id || message.clockId !== clock.id || message.performanceId !== row.performance_id ||
        (message.generation !== row.generation && message.generation !== pending?.generation) || message.assetVersion !== assets?.version) fail(409, 'STALE_GENERATION', 'Audio preparation changed')
      const expectedDuration = device.purpose === 'guide' ? assets?.original?.durationMs : assets?.instrumental?.durationMs
      if (!device.audioEnabled || !device.clockHealthy || !Number.isFinite(message.durationMs) || !Number.isFinite(expectedDuration) ||
        Math.abs(message.durationMs - expectedDuration) > 250) fail(409, 'DEVICE_NOT_READY', 'Audio has not decoded to the expected duration')
      if (device.purpose === 'guide' && db.prepare('SELECT singer_member_id FROM ktv_queue_entries WHERE id = ?').get(row.entry_id).singer_member_id !== device.memberId) {
        fail(403, 'FORBIDDEN', 'Only the selected singer can prepare a private guide')
      }
      if (device.purpose !== 'guide' && (device.purpose !== 'stage' || device.id !== row.stage_device_id)) fail(403, 'FORBIDDEN', 'Only the designated stage can prepare backing')
      const prepared = { clockId: clock.id, performanceId: row.performance_id, generation: message.generation, assetVersion: assets.version, atMs: nowMs }
      if (message.generation === row.generation) device.ready = prepared
      else device.nextReady = prepared
      presenceSequence++
      broadcast(ws.roomId)
    } else if (message.type === 'device.heartbeat') {
      const row = read(ws.roomId), lease = leases.get(ws.roomId)
      const pending = row?.pending_json && JSON.parse(row.pending_json)
      if (row && device.purpose === 'guide' && message.clockId === clock.id && message.performanceId === row.performance_id &&
        message.generation === row.generation && device.ready?.generation === row.generation &&
        device.ready.performanceId === row.performance_id) device.ready.atMs = nowMs
      if (lease && lease.deviceId === device.id && lease.clockId === message.clockId && lease.id === message.leaseId &&
        lease.generation === message.generation && lease.performanceId === message.performanceId &&
        row?.generation === lease.generation && row.performance_id === lease.performanceId &&
        ['scheduled', 'playing'].includes(row.state) && nowMs < lease.expiresServerMs && ready(device, row) &&
        (!row.guide_required || guideReady(row))) {
        lease.sequence++; lease.expiresServerMs = pending?.state === 'paused' ? Math.min(nowMs + timing.outputLeaseMs, pending.effectiveServerMs) : nowMs + timing.outputLeaseMs
        lease.safeAfterServerMs = Math.max(lease.expiresServerMs + timing.outputMarginMs, receiverSafeAfter(lease))
        lease.nextGeneration = pending?.generation; lease.effectiveServerMs = pending?.effectiveServerMs
        broadcastLease(ws.roomId, publicLease(lease))
        return { type: 'lease', lease: publicLease(lease) }
      }
    } else if (message.type === 'device.stopped') {
      const lease = leases.get(ws.roomId)
      if (lease && lease.deviceId === device.id && message.leaseId === lease.id && message.generation === lease.generation &&
        message.clockId === lease.clockId) {
        lease.expiresServerMs = Math.min(lease.expiresServerMs, nowMs)
        lease.safeAfterServerMs = Math.max(receiverSafeAfter(lease), Math.min(lease.safeAfterServerMs, nowMs + timing.outputMarginMs))
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
    else if (row?.guide_required && row.guide_device_id === device.id) transaction(db, () => recover(device.roomId, 'guide.disconnected'))
    broadcast(device.roomId)
  }
  function sweep() {
    if (closed || !features.rooms) return
    const changed = new Set()
    const nowMs = clock.nowMs()
    const openRooms = db.prepare("SELECT id FROM ktv_rooms WHERE status = 'open' AND expires_at > ?").all(stamp())
    const openIds = new Set(openRooms.map(room => room.id))
    for (const room of openRooms) transaction(db, () => {
      if (hostPolicy(room.id)) changed.add(room.id)
      if (advance(room.id)) changed.add(room.id)
    })
    for (const roomId of hostSignatures.keys()) if (!openIds.has(roomId)) { hostMissing.delete(roomId); hostSignatures.delete(roomId) }
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
            pendingLease.safeAfterServerMs = Math.max(pendingLease.expiresServerMs + timing.outputMarginMs, receiverSafeAfter(pendingLease))
          }
          changed.add(row.room_id)
        }
        if (pending && nowMs >= pending.effectiveServerMs) {
          db.prepare(`UPDATE ktv_playback SET state = ?, generation = ?, position_ms = ?, checkpoint_ms = ?,
            anchor_server_ms = ?, pending_json = NULL, updated_at = ? WHERE room_id = ?`)
            .run(pending.state, pending.generation, pending.positionMs, pending.positionMs, pending.anchorServerMs, stamp(), row.room_id)
          for (const device of devices.values()) if (device.roomId === row.room_id &&
            (device.id === row.stage_device_id || device.purpose === 'guide')) {
            device.ready = device.nextReady?.generation === pending.generation ? device.nextReady : null
            device.nextReady = null
          }
          if (pendingLease) {
            pendingLease.generation = pending.generation; pendingLease.nextGeneration = undefined
            pendingLease.effectiveServerMs = undefined; pendingLease.sequence++
          }
          bump(db, row.room_id)
          const committed = read(row.room_id)
          if (pending.state === 'playing' && committed.guide_required && !guideReady(committed)) recover(row.room_id, 'guide.unavailable')
          changed.add(row.room_id); return
        }
        if (row.state === 'preparing' && nowMs >= row.prepare_deadline_ms) {
          recover(row.room_id, 'playback.prepare_timeout'); changed.add(row.room_id); return
        }
        if (['scheduled', 'playing'].includes(row.state)) {
          if (row.guide_required && !guideReady(row)) {
            recover(row.room_id, 'guide.unavailable'); changed.add(row.room_id); return
          }
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
            const mode = db.prepare('SELECT * FROM ktv_rooms WHERE id = ?').get(row.room_id)?.performance_mode || 'local'
            if (mode !== 'local' && !api.media?.grants.publisherReady(row.room_id)) {
              recover(row.room_id, 'media.not_ready'); changed.add(row.room_id); return
            }
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
  function mediaFailed(roomId, performanceId, generation) {
    const row = read(roomId)
    if (!row || row.performance_id !== performanceId || row.generation !== generation) return false
    const changed = transaction(db, () => recover(roomId, 'media.disconnected'))
    if (changed) broadcast(roomId)
    return changed
  }
  const api = { timing, snapshot, presence, connected, disconnected, deviceMessage, current, assign, prepare, start,
    transition, guide, invalidate, finish, decline, read, sweep, mediaFailed, reserveReceiveOutput, features, close: () => { closed = true; clearInterval(timer) } }
  return api
}
