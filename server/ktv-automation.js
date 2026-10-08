import { readinessSnapshot } from './ktv-readiness.js'
import { RoomError } from './ktv-errors.js'

// Room-owned automation: one asset lookup per room, followed by the same
// playback commands and readiness/lease guards as explicit moderator actions.
export function createKtvAutomation({ db, clock, playback, resolveAssets, transaction, event, broadcast }) {
  const jobs = new Map(), failures = new Map(), signatures = new Map()
  let closed = false
  function context(roomId) {
    const room = db.prepare('SELECT * FROM ktv_rooms WHERE id = ?').get(roomId)
    const human = readinessSnapshot(db, roomId, clock)
    const current = playback.snapshot(roomId), presence = playback.presence(roomId)
    const key = JSON.stringify([human.clockId, human.performanceId, human.generation, human.entryId, current.stageDeviceId])
    const entry = human.entryId && db.prepare(`SELECT q.state, q.accepted_at, m.admission, m.blocked_at
      FROM ktv_queue_entries q JOIN ktv_members m ON m.id = q.singer_member_id WHERE q.id = ? AND q.room_id = ?`).get(human.entryId, roomId)
    const eligible = !closed && playback.features.rooms && room?.status === 'open' &&
      Date.parse(room.expires_at) > Date.now() && room.automatic_playback === 1 && human.state === 'ready' &&
      entry?.state === 'queued' && entry.accepted_at && entry.admission === 'admitted' && !entry.blocked_at
    const stage = presence.devices.find(device => device.id === current.stageDeviceId && device.connected &&
      device.purpose === 'stage' && device.audioEnabled && device.clockHealthy)
    return { room, human, current, presence, key, eligible, stage }
  }
  function snapshot(roomId) {
    const c = context(roomId)
    if (!c.room?.automatic_playback || !playback.features.rooms) return { state: 'off' }
    if (['scheduled', 'playing'].includes(c.current.state)) return { state: 'playing' }
    if (['paused', 'recovering'].includes(c.current.state)) return { state: 'attention' }
    if (!c.eligible) return { state: 'waiting-singer' }
    if (failures.get(roomId)?.key === c.key && c.current.state === 'idle') return { state: 'attention' }
    if (!c.presence.host.controlAvailable) return { state: 'waiting-host' }
    if (!c.stage) return { state: 'waiting-stage' }
    if (c.current.state === 'idle') return { state: 'preparing' }
    if (c.current.performanceId !== c.human.performanceId || c.current.entryId !== c.human.entryId) return { state: 'attention' }
    if (!c.stage.ready || c.stage.readyGeneration !== c.current.generation) return { state: 'waiting-audio' }
    if (c.current.guideRequired && !c.current.guidePrepared) return { state: 'waiting-guide' }
    if (clock.nowMs() < Math.max(c.current.restartSafeAfterMs, c.current.lease?.safeAfterServerMs || 0)) return { state: 'waiting-output' }
    const failedStart = failures.get(roomId)
    if (failedStart?.key === c.key && failedStart.generation === c.current.generation) {
      if (failedStart.code === 'DEVICE_NOT_READY') return { state: 'waiting-audio' }
      if (failedStart.code === 'HOST_UNAVAILABLE') return { state: 'waiting-host' }
      if (failedStart.code === 'GUIDE_NOT_READY') return { state: 'waiting-guide' }
      if (failedStart.code === 'OUTPUT_STOPPING') return { state: 'waiting-output' }
      return { state: 'attention' }
    }
    return { state: 'waiting-audio' }
  }
  function notify(roomId) {
    if (closed) return
    const next = JSON.stringify(snapshot(roomId))
    if (next !== signatures.get(roomId)) { signatures.set(roomId, next); broadcast(roomId) }
  }
  function prepare(c) {
    const roomId = c.room.id
    const job = { key: c.key, generation: c.current.generation, stageDeviceId: c.current.stageDeviceId }
    jobs.set(roomId, job)
    job.promise = Promise.resolve().then(() => {
      if (closed) return null
      if (!resolveAssets) throw new RoomError(503, 'ASSETS_UNCONFIGURED', 'Audio assets unavailable')
      return resolveAssets(c.human.songId)
    }).then(assets => {
      if (closed) return
      const changed = transaction(db, () => {
        const latest = context(roomId)
        // Recheck authority after asynchronous I/O: a cancelled turn, changed
        // speaker, host toggle, service shutdown or manual preparation wins.
        if (!latest.eligible || latest.key !== job.key || !latest.stage || !latest.presence.host.controlAvailable ||
          latest.current.state !== 'idle' || latest.current.generation !== job.generation) return
        playback.prepare(roomId, latest.human, assets)
        failures.delete(roomId)
        event(db, roomId, null, 'automation.prepared', latest.human.entryId)
        return true
      })
      if (changed) broadcast(roomId)
    }).catch(error => {
      if (closed) return
      const latest = context(roomId)
      if (latest.eligible && latest.key === job.key && latest.current.state === 'idle' && latest.current.generation === job.generation) {
        failures.set(roomId, { key: job.key, code: error instanceof RoomError ? error.code : 'ASSET_ERROR' })
      }
    }).finally(() => {
      if (jobs.get(roomId) === job) jobs.delete(roomId)
      notify(roomId)
    })
  }
  function sweep() {
    if (closed || !playback.features.rooms) return
    const open = db.prepare("SELECT id FROM ktv_rooms WHERE status = 'open' AND expires_at > ?").all(new Date().toISOString())
    const openIds = new Set(open.map(room => room.id))
    for (const map of [failures, signatures]) for (const id of map.keys()) if (!openIds.has(id)) map.delete(id)
    for (const room of open) {
      const c = context(room.id)
      if (!c.room.automatic_playback) failures.delete(room.id)
      if (c.eligible && c.stage && c.presence.host.controlAvailable) {
        if (c.current.state === 'idle' && !jobs.has(room.id) && failures.get(room.id)?.key !== c.key) prepare(c)
        else if (c.current.state === 'preparing' && c.current.performanceId === c.human.performanceId && c.current.entryId === c.human.entryId) {
          try {
            transaction(db, () => {
              playback.start(room.id)
              event(db, room.id, null, 'automation.started', c.human.entryId)
            })
            failures.delete(room.id); broadcast(room.id)
          } catch (error) {
            if (!(error instanceof RoomError)) throw error
            failures.set(room.id, { key: c.key, generation: c.current.generation, code: error.code })
          }
        }
      }
      notify(room.id)
    }
  }
  const timer = setInterval(sweep, 250)
  timer.unref()
  return { snapshot, sweep, pending: roomId => jobs.get(roomId)?.promise,
    close() { closed = true; clearInterval(timer); failures.clear(); signatures.clear() } }
}
