import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'
import { ref, nextTick } from 'vue'

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const source = await fs.readFile(new URL('../src/composables/usePartyMedia.ts', import.meta.url), 'utf8')
const vueModule = dataModule(`import * as Vue from ${JSON.stringify(import.meta.resolve('vue'))};
  export const { computed, ref, shallowRef, watch } = Vue;
  export const onUnmounted = work => globalThis.__partyMediaLifecycle.cleanups.push(work);`)
const stubs = {
  '@/services/partyApi': 'export const partyApi = new Proxy({}, {get: (_, key) => (...args) => globalThis.__partyMediaLifecycle.api[key](...args)});',
  '@/services/partyMediaTransport': 'export const createPartyMediaTransport = (...args) => globalThis.__partyMediaLifecycle.transport(...args);',
  '@/services/partyPublishGraph': 'export class PartyPublishGraph { constructor(...args) { return globalThis.__partyMediaLifecycle.publishGraph(...args) } }',
  '@/services/partyLyricCapture': 'export class PartyLyricCapture { constructor(...args) { return globalThis.__partyMediaLifecycle.lyricCapture(...args) } }',
  '@/services/partyAudioEngine': 'export class PartyAudioEngine { constructor() { return globalThis.__partyMediaLifecycle.audioEngine(); } }',
  './useMicDevices': 'export const getMicStream = () => globalThis.__partyMediaLifecycle.mic(); export const releaseMicStream = stream => {for (const track of stream?.getTracks() || []) track.stop();};',
}
let compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
compiled = compiled.replace("'vue'", JSON.stringify(vueModule))
for (const [name, module] of Object.entries(stubs)) compiled = compiled.replace(JSON.stringify(name), JSON.stringify(dataModule(module))).replace(`'${name}'`, JSON.stringify(dataModule(module)))
const { usePartyMedia, partyMediaFailureCode } = await import(dataModule(compiled))

test('media failures provide actionable message keys without exposing provider URLs or tokens', () => {
  assert.equal(partyMediaFailureCode({ code: 'MEDIA_CLIENT_UPDATE' }), 'mediaErrorUpdate')
  assert.equal(partyMediaFailureCode(new Error('wss://provider/rtc?access_token=private')), 'mediaErrorUnavailable')
  assert.equal(partyMediaFailureCode(Object.assign(new Error('private-body'), { code: 'MEDIA_REVOKED' })), 'mediaErrorPermission')
  assert.equal(partyMediaFailureCode({ code: 'MEDIA_FORBIDDEN' }), 'mediaErrorPermission')
  assert.equal(partyMediaFailureCode(Object.assign(new Error('private-label'), { name: 'NotAllowedError' })), 'mediaErrorMicPermission')
  assert.equal(partyMediaFailureCode(new Error('MEDIA_HEADPHONES_CHANGED')), 'mediaErrorHeadphonesChanged')
  assert.equal(partyMediaFailureCode(null), 'mediaErrorUnavailable')
})
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function stream() {
  const track = Object.assign(new EventTarget(), { readyState: 'live', stop() { this.readyState = 'ended' } })
  return { getAudioTracks: () => [track], getTracks: () => [track] }
}
function fixture(t) {
  const previous = { window: globalThis.window, document: globalThis.document, state: globalThis.__partyMediaLifecycle }
  const retryTimers = new Map()
  const timers = new Map(), micRequests = [], removals = [], cleanups = []
  const window = Object.assign(new EventTarget(), { setInterval(fn) { timers.set(timers.size + 1, fn); return timers.size }, clearInterval(id) { timers.delete(id) }, setTimeout(fn) { retryTimers.set(retryTimers.size + 1, fn); return retryTimers.size }, clearTimeout(id) { retryTimers.delete(id) } })
  const document = Object.assign(new EventTarget(), { hidden: false, createElement() { return { style: {}, remove() {} } } })
  globalThis.window = window; globalThis.document = document
  const engines = []
  const state = { cleanups, api: { async mediaStatus() { return { available: true } }, async mediaOutput() { return { permit: null } }, async mediaRevoke(...args) { removals.push(args) } },
    audioEngine() {
      const ready = deferred()
      const engine = { ready, prepared: 0, closed: false, enable: () => ready.promise,
        syncCalls: [], sync(...args) { this.syncCalls.push(args) }, async prepare() { this.prepared++ }, stop() {}, async close() { this.closed = true }, setVolume() {} }
      engines.push(engine); return engine
    },
    mic() { const request = deferred(); micRequests.push(request); return request.promise }, transport() { throw new Error('Unexpected transport creation') } }
  globalThis.__partyMediaLifecycle = state
  const party = ref({ room: { id: 'first-room', performanceMode: 'online', mediaConfigured: true }, self: { id: 'singer', role: 'member', admission: 'admitted' },
    readiness: { performanceId: 'first-performance', singerMemberId: 'singer' }, playback: { state: 'idle', performanceId: null, assets: null } })
  const connected = ref(true), clock = ref({ status: 'healthy', clockId: 'clock', offsetMs: 0, uncertaintyMs: 10 })
  let disabled = 0
  const audio = { deviceId: 'device', enabled: ref(false), healthy: ref(true), blocked: ref(false), prepared: ref(false), assignedHere: ref(false), volume: ref(.7), lines: ref([]), outputLease: ref(null),
    async enable() { this.enabled.value = true }, disable() { disabled++; this.enabled.value = false }, createPublisherTap() { throw new Error('Unexpected tap') }, renderPosition() { return null } }
  const media = usePartyMedia(party, connected, clock, audio); media.headphones.value = true
  t.after(async () => {
    await media.stop()
    for (const cleanup of cleanups) cleanup()
    await nextTick()
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.__partyMediaLifecycle = previous.state
  })
  return { retryTimers, media, party, connected, clock, audio, document, window, timers, micRequests, state, removals, engines, get disabled() { return disabled } }
}
async function permissionRequested(f) {
  for (let attempt = 0; attempt < 10 && !f.micRequests.length; attempt++) await nextTick()
  assert.equal(f.micRequests.length, 1)
}

test('a scheduled snapshot waits for its matching output lease before requesting publisher authority', async t => {
  const f = fixture(t), capture = f.media.prepareCapture(), issued = deferred()
  await permissionRequested(f)
  const input = stream(); f.micRequests[0].resolve(input); await capture
  let requests = 0
  f.state.api.mediaGrant = () => { requests++; return issued.promise }
  f.audio.prepared.value = true; f.audio.assignedHere.value = true
  f.party.value.playback = { state: 'scheduled', performanceId: 'first-performance', singerMemberId: 'singer',
    clockId: 'clock', generation: 4, stageDeviceId: 'device', assets: { instrumental: { sha256: 'backing' } }, lease: null }
  const lease = { id: 'lease', deviceId: 'device', clockId: 'clock', performanceId: 'first-performance', generation: 4,
    expiresServerMs: performance.now() + 8000 }
  for (const candidate of [null, { ...lease, deviceId: 'other' }, { ...lease, clockId: 'old-clock' },
    { ...lease, performanceId: 'old-performance' }, { ...lease, generation: 3 }, { ...lease, expiresServerMs: performance.now() }]) {
    f.audio.outputLease.value = candidate
    for (const tick of f.timers.values()) tick()
    await nextTick()
    assert.equal(requests, 0)
    assert.equal(input.getAudioTracks()[0].readyState, 'live')
    assert.equal(f.media.status.value, 'ready')
  }
  f.audio.outputLease.value = lease
  for (const tick of f.timers.values()) tick()
  await nextTick()
  assert.equal(requests, 1)
  assert.equal(f.media.status.value, 'connecting')
  for (const tick of f.timers.values()) tick()
  assert.equal(requests, 1)
  await f.media.stop()
  issued.resolve({ identity: 'late-publisher', scope: 'publisher', room: 'ktv-first-room' })
  for (let attempt = 0; attempt < 10 && !f.removals.length; attempt++) await nextTick()
  assert.deepEqual(f.removals, [['first-room', 'late-publisher']])
  assert.equal(input.getAudioTracks()[0].readyState, 'ended')
})

test('a microphone permission reply after the selected turn changes is released immediately', async t => {
  const f = fixture(t), pending = f.media.prepareCapture()
  await permissionRequested(f)
  f.party.value.readiness.performanceId = 'next-performance'
  const input = stream(); f.micRequests[0].resolve(input); await pending
  assert.equal(input.getAudioTracks()[0].readyState, 'ended')
  assert.equal(f.media.captureActive.value, false); assert.equal(f.media.status.value, 'off')
})

test('hiding the page cancels pending capture without accepting a later microphone reply', async t => {
  const f = fixture(t), pending = f.media.prepareCapture()
  await permissionRequested(f)
  f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange'))
  const input = stream(); f.micRequests[0].resolve(input); await pending
  assert.equal(input.getAudioTracks()[0].readyState, 'ended'); assert.equal(f.media.captureActive.value, false)
})

test('stopping capture during audio startup disables the pending output before a microphone request', async t => {
  const f = fixture(t), startup = deferred()
  f.audio.enable = () => startup.promise
  const pending = f.media.prepareCapture()
  for (let attempt = 0; attempt < 10 && f.media.status.value !== 'preparing'; attempt++) await nextTick()
  assert.equal(f.media.status.value, 'preparing')
  await f.media.stop()
  assert.equal(f.disabled, 1)
  assert.equal(f.media.captureActive.value, false)
  startup.resolve(); await pending
  assert.equal(f.micRequests.length, 0)
  assert.equal(f.media.status.value, 'off')
})

test('room connection loss releases an already acquired microphone before a network await', async t => {
  const f = fixture(t), pending = f.media.prepareCapture()
  await permissionRequested(f)
  const input = stream(); f.micRequests[0].resolve(input); await pending
  assert.equal(input.getAudioTracks()[0].readyState, 'live')
  f.connected.value = false
  assert.equal(input.getAudioTracks()[0].readyState, 'ended'); assert.equal(f.media.captureActive.value, false)
  assert.equal(f.disabled, 1)
})

test('a late audience token after navigation is revoked in its original room and never connected', async t => {
  const f = fixture(t), issued = deferred()
  f.state.api.mediaGrant = () => issued.promise
  const pending = f.media.listen(); await nextTick(); await nextTick()
  f.party.value.room.id = 'next-room'
  issued.resolve({ identity: 'old-nonce', scope: 'audience', room: 'ktv-first-room', token: 'test-only', serverUrl: '/api/ktv/media' })
  await pending
  assert.deepEqual(f.removals, [['first-room', 'old-nonce']]); assert.equal(f.media.isAudience.value, false)
})

test('paired displays cannot request microphone capture even when they represent the singer', async t => {
  const f = fixture(t)
  f.party.value.deviceScope = 'display'
  await f.media.prepareCapture()
  assert.equal(f.micRequests.length, 0); assert.equal(f.media.captureActive.value, false)
})

test('turning off a private guide while audio starts keeps the microphone and skips stale decode', async t => {
  const f = fixture(t), capture = f.media.prepareCapture()
  await permissionRequested(f)
  const input = stream(); f.micRequests[0].resolve(input); await capture
  f.party.value.playback.assets = { original: { sha256: 'guide' } }
  const pending = f.media.toggleOriginal()
  assert.equal(f.engines.length, 1)
  await f.media.toggleOriginal()
  f.engines[0].ready.resolve(); await pending
  assert.equal(f.engines[0].prepared, 0); assert.equal(f.engines[0].closed, true)
  assert.equal(f.media.originalEnabled.value, false)
  assert.equal(f.media.captureActive.value, true)
  assert.equal(input.getAudioTracks()[0].readyState, 'live')
  assert.equal(f.audio.volume.value, .7)
  assert.equal(f.media.failure.value, '')
})

test('an audio-enable promise completing after user Stop cannot restore audience listening state', async t => {
  const f = fixture(t), pending = deferred()
  let enableWork = async () => {}
  f.state.api.mediaGrant = async () => ({identity:'audience',scope:'audience',room:'ktv-first-room',token:'test-only',serverUrl:'/api/ktv/media'})
  f.state.transport = async () => ({async connect() {}, renewReceivePermit() { return true }, enableAudio: () => enableWork(), async close() {}})
  await f.media.listen(); enableWork = () => pending.promise
  const enabling = f.media.enableAudio(); await f.media.stop(); pending.resolve(); await enabling
  assert.equal(f.media.status.value, 'off'); assert.equal(f.media.isAudience.value, false)
})

async function flush() { for (let index = 0; index < 16; index++) await Promise.resolve(); await nextTick() }
function audienceFixture(f) {
  const connections = []
  f.state.api.mediaGrant = async () => ({identity:'audience-'+connections.length,scope:'audience',room:'ktv-first-room',token:'test-only',serverUrl:'/api/ktv/media'})
  f.state.transport = async (grant, callbacks) => {
    const connection = { grant, callbacks, permits: [], renewReceivePermit(...args) { this.permits.push(args); return true }, async connect() {}, async enableAudio() {}, async close() {} }
    connections.push(connection); return connection
  }
  return connections
}

test('a source output reply after listener Stop cannot reauthorize an old transport', async t => {
  const f = fixture(t), connections = audienceFixture(f), reply = deferred()
  f.state.api.mediaOutput = () => reply.promise
  const listening = f.media.listen(); await flush()
  assert.equal(connections.length, 1)
  await f.media.stop()
  reply.resolve({ permit: { publisherIdentity: 'old-source', clockId: 'clock', performanceId: 'first-performance', generation: 1,
    expiresServerMs: performance.now() + 5000 } })
  await listening
  assert.equal(connections[0].permits.length, 0); assert.equal(f.media.status.value, 'off')
})

test('listener authority polling waits for the asynchronously loaded transport', async t => {
  const f = fixture(t), loaded = deferred()
  let requests = 0
  f.state.api.mediaGrant = async () => ({ identity: 'audience', scope: 'audience', room: 'ktv-first-room' })
  f.state.api.mediaOutput = async () => { requests++; return { permit: null } }
  f.state.transport = () => loaded.promise
  const listening = f.media.listen(); await flush()
  for (const tick of f.timers.values()) tick()
  await flush()
  assert.equal(requests, 0); assert.equal(f.media.status.value, 'connecting'); assert.equal(f.removals.length, 0)
  loaded.resolve({ renewReceivePermit() { return true }, async connect() {}, async enableAudio() {}, async close() {} })
  await listening
  assert.equal(requests, 1); assert.equal(f.media.status.value, 'listening')
})

test('listener output follows current performance authority and closes on a generation change', async t => {
  const f = fixture(t), connections = audienceFixture(f)
  const permit = { publisherIdentity: 'source', clockId: 'clock', performanceId: 'first-performance', generation: 1,
    expiresServerMs: performance.now() + 5000 }
  f.party.value.playback = { state: 'playing', clockId: 'clock', performanceId: 'first-performance', generation: 1 }
  f.state.api.mediaOutput = async () => ({ permit })
  await f.media.listen()
  assert.deepEqual(connections[0].permits[0][0], permit)
  const before = connections[0].permits.length
  f.party.value.playback.state = 'scheduled'
  f.party.value.playback.state = 'playing'
  assert.equal(connections[0].permits.length, before, 'countdown completion retains the same player and source authority')
  f.party.value.playback.generation = 2
  assert.deepEqual(connections[0].permits.at(-1), [null, null])
})

test('audience link loss revokes the previous nonce before connecting a newly authorized session', async t => {
  const f = fixture(t), connections = audienceFixture(f), removal = deferred()
  f.state.api.mediaRevoke = async (...args) => { f.removals.push(args); await removal.promise }
  await f.media.listen(); connections[0].callbacks.ended(true); await flush()
  assert.equal(f.media.status.value, 'reconnecting'); assert.equal(connections.length, 1)
  await f.media.enableAudio(); assert.equal(f.media.status.value, 'reconnecting')
  assert.deepEqual(f.removals, [['first-room','audience-0']])
  removal.resolve(); await flush()
  assert.equal(connections.length, 2); assert.equal(connections[1].grant.identity, 'audience-1')
  assert.equal(f.media.status.value, 'listening')
  connections[0].callbacks.ended(true); await flush(); assert.equal(connections.length, 2)
})

test('user Stop during provider removal cancels audience recovery and any late grant', async t => {
  const f = fixture(t), connections = audienceFixture(f), removal = deferred()
  f.state.api.mediaRevoke = () => removal.promise
  await f.media.listen(); connections[0].callbacks.ended(true); await flush()
  await f.media.stop(); removal.resolve(); await flush()
  assert.equal(connections.length, 1); assert.equal(f.media.status.value, 'off')
})

test('audience recovery cannot restart after room loss or an explicit provider removal', async t => {
  const f = fixture(t), connections = audienceFixture(f)
  await f.media.listen(); connections[0].callbacks.ended(false); await flush()
  assert.equal(f.media.status.value, 'error'); assert.equal(connections.length, 1)
  await f.media.listen(); connections[1].callbacks.ended(true); f.connected.value = false; await flush()
  assert.equal(connections.length, 2); assert.equal(f.media.status.value, 'off')
})

test('transient grant errors retry with bounded fresh requests, but authorization denial is terminal', async t => {
  const f = fixture(t), connections = audienceFixture(f)
  await f.media.listen()
  let requests = 0
  f.state.api.mediaGrant = async () => { requests++; throw Object.assign(new Error('private-body'),{code: requests < 3 ? 'MEDIA_REVOCATION_PENDING' : 'MEDIA_FORBIDDEN'}) }
  connections[0].callbacks.ended(true); await flush()
  assert.equal(requests, 1); assert.equal(f.media.status.value, 'reconnecting')
  for (let index=0;index<2;index++) { for (const [id, tick] of [...f.retryTimers]) {f.retryTimers.delete(id); tick()} await flush() }
  assert.equal(requests, 3); assert.equal(f.media.status.value, 'error'); assert.equal(f.media.failure.value, 'mediaErrorPermission')
  assert.equal(f.retryTimers.size, 0)
})

test('a failed initial connect does not start nested recovery or bypass its retry limit', async t => {
  const f = fixture(t), connections = audienceFixture(f)
  await f.media.listen()
  f.state.transport = async (grant, callbacks) => ({async connect() {callbacks.ended(true); throw new Error('temporary network failure')},async close(){},async enableAudio(){}})
  connections[0].callbacks.ended(true); await flush()
  assert.equal(f.retryTimers.size, 1); assert.equal(f.media.status.value, 'reconnecting')
  await f.media.stop(); await flush(); assert.equal(f.retryTimers.size, 0); assert.equal(f.media.status.value, 'off')
})

test('an undocumented HTTP authorization denial stops audience recovery without retrying', async t => {
  const f = fixture(t), connections = audienceFixture(f)
  await f.media.listen(); let requests = 0
  f.state.api.mediaGrant = async () => {requests++; throw Object.assign(new Error('private provider body'), {status:403,code:'OTHER_DENIAL'})}
  connections[0].callbacks.ended(true); await flush()
  assert.equal(requests, 1); assert.equal(f.retryTimers.size, 0); assert.equal(f.media.status.value, 'error')
})

test('media version refusal stops audience recovery with an update message and no retry loop', async t => {
  const f = fixture(t), connections = audienceFixture(f)
  await f.media.listen(); let requests = 0
  f.state.api.mediaGrant = async () => { requests++; throw { status: 409, code: 'MEDIA_CLIENT_UPDATE' } }
  connections[0].callbacks.ended(true); await flush()
  assert.equal(requests, 1); assert.equal(f.retryTimers.size, 0)
  assert.equal(f.media.status.value, 'error'); assert.equal(f.media.failure.value, 'mediaErrorUpdate')
  assert.equal(f.media.isAudience.value, false)
})

async function publisherFixture(f, ready = async () => ({}), expectedStatus = 'publishing') {
  const capture = f.media.prepareCapture()
  await permissionRequested(f)
  const input = stream(); f.micRequests[0].resolve(input); await capture
  const identity = {clockId:'clock',performanceId:'first-performance',generation:4}
  const snapshotLease = {id:'lease',deviceId:'device',...identity,sequence:1,expiresServerMs:performance.now()-1000}
  const renewedLease = {...snapshotLease,sequence:8,expiresServerMs:performance.now()+8000}
  f.party.value.playback = {state:'playing',...identity,singerMemberId:'singer',stageDeviceId:'device',lease:snapshotLease,
    assets:{instrumental:{sha256:'backing'},original:{sha256:'guide'}}}
  f.audio.outputLease.value = renewedLease
  f.audio.prepared.value = true; f.audio.assignedHere.value = true
  const graph = {stream:{},renewals:[],accepted:true,closed:false,setAlignment(){},setPublishLevels(){},
    renew(permit, clock) {this.renewals.push({permit,clock});return this.accepted},close(){this.closed=true}}
  f.state.publishGraph = () => graph
  f.state.lyricCapture = () => ({stream:{},close(){}})
  f.audio.createPublisherTap = () => ({context:{},instrumental:{},active:true,close(){}})
  f.state.api.mediaGrant = async () => ({identity:'publisher',scope:'publisher',room:'ktv-first-room',
    permit:{...identity,expiresServerMs:performance.now()+5000}})
  f.state.api.mediaReady = ready
  const encoded = {renewals:[],accepted:true}
  f.state.transport = async () => ({async connect(){},async publish(){},async close(){},
    renewPublishPermit(permit,clock) {encoded.renewals.push({permit,clock});return encoded.accepted}})
  for(const tick of f.timers.values()) tick()
  await flush()
  assert.equal(f.media.status.value,expectedStatus)
  return {graph,input,snapshotLease,renewedLease,encoded}
}

async function runRetry(f) {
  for(const [id,tick] of [...f.retryTimers]) {f.retryTimers.delete(id);tick()}
  await flush()
}
test('publisher waits for provider confirmation without issuing a second nonce or publishing early',async t=>{
  const f=fixture(t);let requests=0
  const {input,graph}=await publisherFixture(f,async()=>{if(++requests<3)throw {code:'MEDIA_NOT_READY',status:409}},'connecting')
  assert.equal(f.media.status.value,'connecting');assert.equal(requests,1)
  assert.equal(graph.renewals.length,0);assert.equal(input.getTracks()[0].readyState,'live')
  await runRetry(f);assert.equal(requests,2);assert.equal(f.media.status.value,'connecting')
  await runRetry(f);assert.equal(requests,3);assert.equal(f.media.status.value,'publishing')
  assert.equal(f.removals.length,0)
})
test('publisher pending confirmation has a finite attempt limit and then releases capture',async t=>{
  const f=fixture(t);let requests=0
  const {input,graph}=await publisherFixture(f,async()=>{requests++;throw {code:'MEDIA_NOT_READY',status:409}},'connecting')
  for(let n=0;n<3;n++)await runRetry(f)
  assert.equal(requests,4);assert.equal(f.media.status.value,'error');assert.equal(f.retryTimers.size,0)
  assert.equal(graph.closed,true);assert.equal(input.getTracks()[0].readyState,'ended')
  assert.deepEqual(f.removals,[['first-room','publisher']])
})
for(const code of ['MEDIA_UNAVAILABLE','MEDIA_REVOKED','MEDIA_FORBIDDEN']) {
  test(`publisher confirmation never retries ${code}`,async t=>{
    const f=fixture(t);let requests=0
    const {input}=await publisherFixture(f,async()=>{requests++;throw {code}},'error')
    assert.equal(requests,1);assert.equal(f.retryTimers.size,0);assert.equal(f.media.status.value,'error')
    assert.equal(input.getTracks()[0].readyState,'ended')
  })
}
test('Stop cancels a pending publisher confirmation without starting a new connection',async t=>{
  const f=fixture(t);let requests=0
  const {input}=await publisherFixture(f,async()=>{requests++;throw {code:'MEDIA_NOT_READY',status:409}},'connecting')
  assert.equal(f.retryTimers.size,1);await f.media.stop();await flush();await runRetry(f)
  assert.equal(requests,1);assert.equal(f.retryTimers.size,0);assert.equal(f.media.status.value,'off')
  assert.equal(input.getTracks()[0].readyState,'ended')
})
test('publisher pending confirmation cannot retry after its output lease expires',async t=>{
  const f=fixture(t);let requests=0
  const {input}=await publisherFixture(f,async()=>{requests++;throw {code:'MEDIA_NOT_READY',status:409}},'connecting')
  f.audio.outputLease.value={...f.audio.outputLease.value,expiresServerMs:performance.now()-1}
  await runRetry(f)
  assert.equal(requests,1);assert.equal(f.media.status.value,'error');assert.equal(f.media.failure.value,'mediaErrorPermission')
  assert.equal(input.getTracks()[0].readyState,'ended')
})
test('a publisher pending code on an authorization denial is terminal',async t=>{
  const f=fixture(t);let requests=0
  await publisherFixture(f,async()=>{requests++;throw {code:'MEDIA_NOT_READY',status:403}},'error')
  assert.equal(requests,1);assert.equal(f.retryTimers.size,0)
})

test('publisher and private guide follow renewed WebSocket leases after the snapshot lease expires', async t => {
  const f = fixture(t), {graph,snapshotLease,encoded} = await publisherFixture(f)
  const pending = f.media.toggleOriginal()
  f.engines[0].ready.resolve(); await pending
  for(let sequence=9;sequence<15;sequence++) {
    const next = {...f.audio.outputLease.value,sequence,expiresServerMs:performance.now()+2000+sequence*10}
    f.audio.outputLease.value = next
    for(const tick of f.timers.values()) tick()
    assert.equal(f.media.status.value,'publishing')
    assert.equal(graph.renewals.at(-1).permit.expiresServerMs,next.expiresServerMs)
    assert.equal(encoded.renewals.at(-1).permit.expiresServerMs,next.expiresServerMs)
    assert.equal(f.engines[0].syncCalls.at(-1)[2].sequence,sequence)
  }
  assert.ok(snapshotLease.expiresServerMs<performance.now())
  assert.equal(graph.closed,false)
})

test('encoded gate rejection tears down the publisher and microphone',async t=>{
  const f=fixture(t),{graph,input,encoded}=await publisherFixture(f)
  encoded.accepted=false
  for(const tick of f.timers.values())tick()
  assert.equal(f.media.status.value,'error')
  assert.equal(f.media.failure.value,'mediaErrorPermission')
  assert.equal(graph.closed,true)
  assert.equal(input.getAudioTracks()[0].readyState,'ended')
})

for(const [name,change] of [
  ['device',lease=>({...lease,deviceId:'other'})],
  ['clock',lease=>({...lease,clockId:'old-clock'})],
  ['performance',lease=>({...lease,performanceId:'old-performance'})],
  ['generation',lease=>({...lease,generation:3})],
  ['expiry',lease=>({...lease,expiresServerMs:performance.now()})],
  ['missing',()=>null],
]) test(`publisher fails closed when its current output lease has invalid ${name}`,async t=>{
  const f=fixture(t),{graph,input}=await publisherFixture(f)
  // A valid room snapshot must not mask a revoked or mismatched current lease.
  f.party.value.playback.lease={...f.audio.outputLease.value}
  f.audio.outputLease.value=change(f.audio.outputLease.value)
  for(const tick of f.timers.values()) tick()
  assert.equal(f.media.status.value,'error')
  assert.equal(f.media.failure.value,'mediaErrorPermission')
  assert.equal(graph.closed,true)
  assert.equal(input.getAudioTracks()[0].readyState,'ended')
})

test('render gate rejection tears down capture instead of leaving a silent publishing state',async t=>{
  const f=fixture(t),{graph,input}=await publisherFixture(f)
  graph.accepted=false
  for(const tick of f.timers.values()) tick()
  assert.equal(f.media.status.value,'error')
  assert.equal(graph.closed,true)
  assert.equal(input.getAudioTracks()[0].readyState,'ended')
})
