// Pinned LiveKit v1.13.7 JSON diagnostics. Parse only after timing completes;
// no raw log, participant identity, track ID or arbitrary server field escapes.
const phases = new Set(['baseline', 'impaired', 'next-singer', 'venue-to-remote'])
const reasons = new Set(['opportunistic', 'optimal', 'cooperative', 'next-higher', 'pause'])
const pauses = new Set(['NONE', 'MUTED', 'PUB_MUTED', 'FEED_DRY', 'BANDWIDTH'])
export const sfuLogByteLimit = 16 * 1024 * 1024

// Observe only the opaque scope of this page's successful grant response.
// Tokens, permits and arbitrary response fields are never retained. The caller
// must still verify this identity against active room grants and SFU tracks.
export function installSfuGrantScopeProbe(){
  if(window.__sfuGrantScope)throw new Error('SFU_SCOPE_INSTALLED')
  const open=XMLHttpRequest.prototype.open
  let current=null
  XMLHttpRequest.prototype.open=function(method,url,...rest){
    const result=open.call(this,method,url,...rest)
    let parsed;try{parsed=new URL(url,location.href)}catch{return result}
    const match=/^\/api\/ktv\/rooms\/([^/]+)\/media-token$/.exec(parsed.pathname)
    if(String(method).toUpperCase()!=='POST'||parsed.origin!==location.origin||!match||match[1].length>512)return result
    this.addEventListener('load',()=>{
      current=null
      try{
        if(this.status!==200)return
        const body=this.responseType==='json'?this.response:JSON.parse(this.responseText),grant=body?.data
        if(!grant||!['audience','publisher'].includes(grant.scope)||
          typeof grant.identity!=='string'||!grant.identity||grant.identity.length>512||
          typeof grant.room!=='string'||grant.room!==`ktv-${match[1]}`)return
        current={identity:grant.identity,scope:grant.scope,roomId:match[1]}
      }catch{}
    },{once:true})
    return result
  }
  window.__sfuGrantScope={snapshot:()=>current?{...current}:null}
}

export function analyseSfuAllocationLogs(raw, windows) {
  const errors = new Set(), events = []
  const fail = code => errors.add(code)
  const output = () => { const result = windows.map(window => summarize(window)); return { errors: [...errors], phases: result } }
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > sfuLogByteLimit) return { errors: ['SFU_LOG_BOUND'], phases: [] }
  if (!Array.isArray(windows) || !windows.length || windows.length > 8 || windows.some((w, i) =>
    !w || !phases.has(w.phase) || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end <= w.start ||
    typeof w.identity !== 'string' || !w.identity || w.identity.length > 512 ||
    typeof w.track !== 'string' || !w.track || w.track.length > 512 || i && w.start < windows[i - 1].end))
    return { errors: ['SFU_SCOPE'], phases: [] }
  let previous = -Infinity
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    if (Buffer.byteLength(line) > 65536) { fail('SFU_LINE_BOUND'); break }
    let row
    try { row = JSON.parse(line) } catch { fail('SFU_LOG_JSON'); continue }
    if (!row || typeof row !== 'object' || Array.isArray(row)) { fail('SFU_LOG_JSON'); continue }
    if (!windows.some(w => row.participant === w.identity && row.trackID === w.track)) continue
    if (typeof row.msg !== 'string' || !row.msg.startsWith('stream allocation: ')) continue
    const reason = row.msg.slice('stream allocation: '.length), a = row.allocation
    const time = typeof row.ts === 'string' ? Date.parse(row.ts) : Number.isFinite(row.ts) ? row.ts * 1000 : NaN
    const layer = value => value && ['Spatial', 'Temporal'].every(k => Number.isInteger(value[k]) && value[k] >= -1 && value[k] <= 3)
    const rate = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000
    if (!reasons.has(reason) || !Number.isFinite(time) || !a || !layer(a.TargetLayer) || !layer(a.MaxLayer) ||
      !pauses.has(a.PauseReason) || typeof a.IsDeficient !== 'boolean' ||
      !rate(a.BandwidthRquested) || !rate(a.BandwidthNeeded)) { fail('SFU_ALLOCATION_SCHEMA'); continue }
    if (time < previous) { fail('SFU_ALLOCATION_ORDER'); continue }
    previous = time
    if (events.length >= 1024) { fail('SFU_ALLOCATION_BOUND'); break }
    // Opaque scope indices stay private. Retain only a bounded scalar record.
    events.push({ scopes: windows.flatMap((w, i) => row.participant === w.identity && row.trackID === w.track ? [i] : []),
      time, reason, spatial: a.TargetLayer.Spatial, temporal: a.TargetLayer.Temporal,
      maxSpatial: a.MaxLayer.Spatial, maxTemporal: a.MaxLayer.Temporal,
      pause: a.PauseReason, deficient: a.IsDeficient, requested: a.BandwidthRquested, needed: a.BandwidthNeeded })
  }
  return output()

  function summarize(window) {
    const index = windows.indexOf(window), scoped = events.filter(e => e.scopes.includes(index))
    let state = scoped.filter(e => e.time <= window.start).at(-1), cursor = window.start
    const duration = { unknownMs: 0, inactiveMs: 0, temporal0Ms: 0, temporal1Ms: 0, temporal2Ms: 0, temporal3Ms: 0,
      deficientMs: 0, bandwidthPausedMs: 0 }
    const accrue = end => {
      const elapsed = Math.max(0, end - cursor)
      if (!state) duration.unknownMs += elapsed
      else {
        duration[state.spatial < 0 || state.temporal < 0 ? 'inactiveMs' : `temporal${state.temporal}Ms`] += elapsed
        if (state.deficient) duration.deficientMs += elapsed
        if (state.pause === 'BANDWIDTH') duration.bandwidthPausedMs += elapsed
      }
      cursor = end
    }
    const changes = scoped.filter(e => e.time > window.start && e.time < window.end)
    for (const event of changes) { accrue(event.time); state = event }
    accrue(window.end)
    if (duration.unknownMs > 0) fail('SFU_INITIAL_STATE_MISSING')
    const states = [...scoped.filter(e => e.time <= window.start).slice(-1), ...changes]
    const range = key => states.length ? { min: Math.min(...states.map(e => e[key])), max: Math.max(...states.map(e => e[key])) } : null
    return { phase: window.phase, observedMs: window.end - window.start, allocationChanges: changes.length,
      duration, targetSpatial: range('spatial'), maximumTemporal: range('maxTemporal'),
      requestedBps: range('requested'), neededBps: range('needed'),
      reasons: Object.fromEntries([...reasons].map(reason => [reason, changes.filter(e => e.reason === reason).length])) }
  }
}
