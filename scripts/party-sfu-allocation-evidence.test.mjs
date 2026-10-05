import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { analyseSfuAllocationLogs, installSfuGrantScopeProbe, sfuLogByteLimit } from './party-sfu-allocation-evidence.mjs'

const window = { phase: 'impaired', start: 2000, end: 10000, identity: 'private-listener', track: 'private-video' }
function scopeFixture(){
  const calls=[]
  class Request{
    open(...args){calls.push(args);return 42}
    addEventListener(name,callback,options){assert.equal(name,'load');assert.equal(options.once,true);this.loaded=callback}
    reply(data,{status=200,json=true}={}){
      this.status=status;this.responseType=json?'json':''
      this.response={data};this.responseText=JSON.stringify({data});this.loaded?.()
    }
  }
  const realm={window:{},XMLHttpRequest:Request,URL,location:{href:'https://fixture.test/party',origin:'https://fixture.test'}}
  vm.runInNewContext(`(${installSfuGrantScopeProbe.toString()})()`,realm)
  return {realm,calls,request:()=>new Request(),snapshot:()=>realm.window.__sfuGrantScope.snapshot()}
}
test('page grant scope records only its exact room identity and follows audience/publisher replacements',()=>{
  const f=scopeFixture(),one=f.request(),two=f.request()
  assert.equal(one.open('POST','/api/ktv/rooms/private-room/media-token',true),42)
  assert.deepEqual(f.calls[0],['POST','/api/ktv/rooms/private-room/media-token',true])
  one.reply({identity:'private-listener',scope:'audience',room:'ktv-private-room',token:'secret-token',permit:{secret:'secret-permit'}})
  assert.deepEqual(JSON.parse(JSON.stringify(f.snapshot())),{identity:'private-listener',scope:'audience',roomId:'private-room'})
  for(const secret of ['secret-token','secret-permit','permit','token'])assert.equal(JSON.stringify(f.snapshot()).includes(secret),false)
  const copy=f.snapshot();copy.identity='changed';assert.equal(f.snapshot().identity,'private-listener')
  two.open('post','/api/ktv/rooms/private-room/media-token');two.reply({identity:'new-publisher',scope:'publisher',room:'ktv-private-room'},{json:false})
  assert.equal(f.snapshot().scope,'publisher');assert.equal(f.snapshot().identity,'new-publisher')
  const replacement=f.request();replacement.open('POST','/api/ktv/rooms/private-room/media-token')
  replacement.reply({identity:'replacement-listener',scope:'audience',room:'ktv-private-room'})
  assert.equal(f.snapshot().identity,'replacement-listener')
  assert.throws(()=>vm.runInNewContext(`(${installSfuGrantScopeProbe.toString()})()`,f.realm),/SFU_SCOPE_INSTALLED/)
})
test('scope observation ignores other origins/endpoints and rejects failed, malformed or oversized bindings without a fallback',()=>{
  const f=scopeFixture()
  for(const [method,url] of [['GET','/api/ktv/rooms/private-room/media-token'],['POST','https://other.test/api/ktv/rooms/private-room/media-token'],['POST','/api/ktv/rooms/private-room/media/status'],[42,'/other']]){
    const r=f.request();assert.equal(r.open(method,url),42);assert.equal(r.loaded,undefined)
  }
  for(const grant of [null,{}, {identity:'x',scope:'audience',room:'ktv-wrong'},
    {identity:'x',scope:'admin',room:'ktv-private-room'},{identity:'x'.repeat(513),scope:'audience',room:'ktv-private-room'}]){
    const r=f.request();r.open('POST','/api/ktv/rooms/private-room/media-token');r.reply(grant);assert.equal(f.snapshot(),null)
  }
  const denied=f.request();denied.open('POST','/api/ktv/rooms/private-room/media-token')
  denied.reply({identity:'x',scope:'audience',room:'ktv-private-room'},{status:403});assert.equal(f.snapshot(),null)
  const broken=f.request();broken.open('POST','/api/ktv/rooms/private-room/media-token');broken.status=200;broken.responseType='';broken.responseText='{';broken.loaded();assert.equal(f.snapshot(),null)
})
function row(time, temporal = 2, changes = {}) {
  return JSON.stringify({ ts: time / 1000, msg: 'stream allocation: optimal', participant: window.identity,
    trackID: window.track, room: 'secret-room', arbitrary: 'secret-token', allocation: {
      TargetLayer: { Spatial: 0, Temporal: temporal }, MaxLayer: { Spatial: 0, Temporal: 2 },
      PauseReason: 'NONE', IsDeficient: false, BandwidthRquested: 350000, BandwidthNeeded: 350000 }, ...changes })
}
test('exact listener/track scope carries initial layer into phase and reports bounded durations without identifiers', () => {
  const raw = [row(1000), row(4000, 0), row(6000, 1), row(8000), row(3000, 0, { participant: 'other' }),
    row(9000, 0, { trackID: 'other' })].join('\n')
  const evidence = analyseSfuAllocationLogs(raw, [window]), phase = evidence.phases[0]
  assert.deepEqual(evidence.errors, [])
  assert.equal(phase.allocationChanges, 3)
  assert.equal(phase.duration.temporal2Ms, 4000)
  assert.equal(phase.duration.temporal0Ms, 2000)
  assert.equal(phase.duration.temporal1Ms, 2000)
  assert.equal(phase.duration.unknownMs, 0)
  assert.deepEqual(phase.requestedBps, { min: 350000, max: 350000 })
  for (const privateValue of ['private-listener', 'private-video', 'secret-room', 'secret-token', 'other'])
    assert.equal(JSON.stringify(evidence).includes(privateValue), false)
})
test('missing, malformed, reversed or oversized evidence remains explicit failure', () => {
  for (const [raw, code] of [
    ['', 'SFU_INITIAL_STATE_MISSING'], [row(4000), 'SFU_INITIAL_STATE_MISSING'],
    ['not-json\nnull', 'SFU_LOG_JSON'], [row(1000, 9), 'SFU_ALLOCATION_SCHEMA'],
    [row(1000, 2, { ts: 'secret-value' }), 'SFU_ALLOCATION_SCHEMA'],
    [row(1000, 2, { allocation: { TargetLayer: { Spatial: 0, Temporal: 2 } } }), 'SFU_ALLOCATION_SCHEMA'],
    [[row(1000), row(5000), row(4000)].join('\n'), 'SFU_ALLOCATION_ORDER'],
    ['x'.repeat(65537), 'SFU_LINE_BOUND'], ['x'.repeat(sfuLogByteLimit + 1), 'SFU_LOG_BOUND'],
    [Array.from({ length: 1025 }, (_, i) => row(i)).join('\n'), 'SFU_ALLOCATION_BOUND'],
  ]) assert.ok(analyseSfuAllocationLogs(raw, [window]).errors.includes(code), code)
  for (const invalid of [null, [], [null], [{ ...window, phase: 'secret' }], [{ ...window, end: 1000 }],
    [window, window], Array(9).fill(window)])
    assert.deepEqual(analyseSfuAllocationLogs('', invalid), { errors: ['SFU_SCOPE'], phases: [] })
})
test('ISO timestamps, terminal pause and fresh listener scope produce separate phase summaries', () => {
  const pause = JSON.parse(row(5000, -1)); pause.ts = new Date(5000).toISOString()
  pause.allocation.TargetLayer.Spatial = -1
  pause.allocation.PauseReason = 'BANDWIDTH'; pause.allocation.IsDeficient = true
  const replacement = { ...window, phase: 'next-singer', start: 11000, end: 15000, identity: 'new-listener', track: 'new-video' }
  const evidence = analyseSfuAllocationLogs([row(1000), JSON.stringify(pause),
    row(10500, 2, { participant: replacement.identity, trackID: replacement.track })].join('\n'), [window, replacement])
  assert.deepEqual(evidence.errors, [])
  assert.equal(evidence.phases[0].duration.inactiveMs, 5000)
  assert.equal(evidence.phases[0].duration.deficientMs, 5000)
  assert.equal(evidence.phases[0].duration.bandwidthPausedMs, 5000)
  assert.equal(evidence.phases[1].duration.temporal2Ms, 4000)
})
