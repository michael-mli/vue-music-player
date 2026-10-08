import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { pathToFileURL } from 'node:url'
import { ref, nextTick, effectScope } from 'vue'
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const compile = (file, replace = x => x) => data(replace(ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText))
const { createPartyGuideSession } = await import(compile('../src/services/partyGuideSession.ts'))
function environment(t) {
  const saved = Object.fromEntries(['navigator', 'document', 'window', 'localStorage', 'MediaMetadata', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const handlers = new Map(), events = new Map(), timers = new Map()
  let wall = 1000, cleanup = () => {}
  const session = { metadata: null, playbackState: 'none', setActionHandler: (key, fn) => handlers.set(key, fn), setPositionState() {} }
  const nav = { mediaSession: session, audioSession: { type: 'auto' } }
  const doc = { hidden: false, addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key) }
  const values = { navigator: nav, document: doc, window: { setInterval: fn => { timers.set(1, fn); return 1 }, clearInterval: id => timers.delete(id) },
    localStorage: { getItem: () => null, setItem() {} }, MediaMetadata: class { constructor(props) { Object.assign(this, props) } },
    performance: { now: () => wall }, requestAnimationFrame: () => 1, cancelAnimationFrame() {} }
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value })
  t.after(() => { cleanup(); for (const [key, desc] of Object.entries(saved)) if (desc) Object.defineProperty(globalThis, key, desc); else delete globalThis[key] })
  return { nav, session, handlers, doc, events, timers, setCleanup: fn => { cleanup = fn }, advance: n => { wall += n } }
}
test('guide claims playback audio category and device-only media controls, then releases them', t => {
  const e = environment(t); let resume = 0, stop = 0
  const guide = createPartyGuideSession(() => resume++, () => stop++)
  guide.acquire(); guide.acquire(); assert.equal(e.nav.audioSession.type, 'playback')
  guide.update('Song', true, 2000, 60000)
  assert.equal(e.session.metadata.title, 'Song'); assert.equal(e.session.playbackState, 'playing')
  e.handlers.get('pause')(); e.handlers.get('play')(); assert.equal(stop, 1); assert.equal(resume, 1)
  guide.release(); assert.equal(e.nav.audioSession.type, 'auto'); assert.equal(e.session.metadata, null)
  assert.equal(e.session.playbackState, 'none'); assert.equal(e.handlers.get('play'), null)
})
test('background media hints are optional and do not manufacture playback', t => {
  const e = environment(t); delete e.nav.mediaSession; delete e.nav.audioSession
  const guide = createPartyGuideSession(() => {}, () => {})
  guide.acquire(); guide.update('Song', false, 0, 0); guide.release()
})
const engineModule = data(`export class PartyAudioEngine {
  constructor() { globalThis.__backgroundEngine = this; this.enabled = false; this.renderPositionMs = null; this.calls = []; this.durationMs = 60000; this.diagnostics = {}; }
  async enable() { this.enabled = true }
  cancelEnable() { this.enabled = false }
  resetRecovery() {} async prepare(asset) { this.preparedHash = asset.sha256 }
  releaseBuffer() { this.stop(); this.preparedHash = '' }
  stop() { this.renderPositionMs = null; this.calls.push('stop') }
  sync(playback, clock, lease) { this.calls.push({ playback, clock, lease }); this.renderPositionMs = ['playing','scheduled'].includes(playback.state) && lease.expiresServerMs > performance.now() ? 2000 : null }
  setVolume() {} async close() {} }`)
const vue = pathToFileURL(new URL('../node_modules/vue/dist/vue.runtime.esm-bundler.js', import.meta.url).pathname).href
const vueModule = data(`export {computed,ref,watch} from ${JSON.stringify(vue)}; export const onUnmounted = fn => { globalThis.__backgroundDispose = fn }`)
const controller = compile('../src/composables/usePartyPlayback.ts', source => source
  .replace("'vue'", JSON.stringify(vueModule)).replace("'@/services/partyAudioEngine'", JSON.stringify(engineModule))
  .replace("'@/services/partyOutputMonitor'", JSON.stringify(data('export const createPartyOutputMonitor = () => ({inspect: async()=>{},stop(){}})')))
  .replace("'@/services/partyGuideSession'", JSON.stringify(compile('../src/services/partyGuideSession.ts')))
  .replace("'@/utils/partyTimeline'", JSON.stringify(compile('../src/utils/partyTimeline.ts')))
  .replace("'@/utils/lyricsTiming'", JSON.stringify(data('export const parseLrc=()=>[]; export const singingGuideState=()=>null')))
  .replace("'../../server/ktv-media-protocol.js'", JSON.stringify(data('export const PARTY_MEDIA_PROTOCOL_VERSION=2'))))
const { usePartyPlayback } = await import(controller)
async function setup(t) {
  const e = environment(t), scope = effectScope(), sent = []
  const playback = { clockId: 'clock', performanceId: 'performance', generation: 1, state: 'playing', positionMs: 0, anchorServerMs: 1000,
    durationMs: 60000, singerMemberId: 'singer', stageDeviceId: 'stage', assets: { version: 1, original: { sha256: 'hash' }, instrumental: { sha256: 'backing' }, lyrics: { mode: 'none' } },
    lease: { id: 'lease', clockId: 'clock', performanceId: 'performance', generation: 1, sequence: 1, deviceId: 'stage', expiresServerMs: 9000 } }
  const party = ref({ self: { id: 'singer' }, features: { guide: true }, playback }), connected = ref(true), clock = ref(null)
  const audio = scope.run(() => usePartyPlayback(party, connected, clock, msg => { sent.push(msg); return true }))
  clock.value = { clockId: 'clock', status: 'healthy', ageMs: 0, offsetMs: 0, uncertaintyMs: 1 }; await nextTick()
  audio.message({ type: 'lease', lease: playback.lease });
  await audio.enable('guide'); await nextTick(); await nextTick()
  e.setCleanup(() => { globalThis.__backgroundDispose(); scope.stop(); delete globalThis.__backgroundDispose; delete globalThis.__backgroundEngine })
  return { ...e, audio, party, connected, clock, sent, engine: globalThis.__backgroundEngine }
}
test('hidden guide sends honest status/heartbeats and renews leases without animation frames', async t => {
  const e = await setup(t); e.doc.hidden = true; e.events.get('visibilitychange')()
  e.engine.calls.length = 0; e.advance(2000); e.timers.get(1)()
  assert.equal(e.sent.at(-1).type, 'device.heartbeat'); assert.equal(e.sent.filter(x=>x.type==='device.status').at(-1).audioEnabled, true)
  e.audio.message({ type: 'lease', lease: { ...e.party.value.playback.lease, sequence: 2, expiresServerMs: 15000 } })
  assert.equal(e.engine.calls.at(-1).lease.expiresServerMs, 15000); assert.equal(e.audio.outputLease.value.sequence, 2)
  e.doc.hidden = false; e.events.get('visibilitychange')(); assert.equal(e.audio.outputLease.value.sequence, 2)
})
test('host pause remains authoritative while guide is hidden', async t => {
  const e = await setup(t); e.doc.hidden = true; e.events.get('visibilitychange')()
  e.party.value.playback.state = 'paused'; await nextTick()
  assert.equal(e.engine.renderPositionMs, null); assert.equal(e.engine.calls.at(-1).playback.state, 'paused')
})
test('background guide stops when its clock becomes stale or connection is lost', async t => {
  const e = await setup(t); e.doc.hidden = true; e.advance(31000); e.timers.get(1)()
  assert.equal(e.engine.calls.at(-1), 'stop'); assert.equal(e.sent.filter(x=>x.type==='device.status').at(-1).clockHealthy, false)
  e.connected.value = false; await nextTick(); assert.equal(e.audio.outputLease.value, null)
})
test('actual OS audio suspension stays unavailable after visibility returns', async t => {
  const e = await setup(t); e.doc.hidden = true; e.engine.enabled = false; e.engine.onSuspended()
  assert.equal(e.audio.enabled.value, false); assert.equal(e.audio.failure.value, 'audioSuspended')
  e.doc.hidden = false; e.events.get('visibilitychange')()
  assert.equal(e.engine.calls.at(-1), 'stop'); assert.equal(e.sent.filter(x=>x.type==='device.status').at(-1).audioEnabled, false)
})
test('background continuation does not authorize a former singer or a hidden stage', async t => {
  const e = await setup(t); e.doc.hidden = true
  e.party.value.playback.singerMemberId = 'next-singer'; await nextTick(); e.timers.get(1)()
  assert.equal(e.engine.calls.at(-1), 'stop')
  e.doc.hidden = false; e.party.value.playback.stageDeviceId = e.audio.deviceId
  await e.audio.enable('stage'); await nextTick()
  e.doc.hidden = true; e.events.get('visibilitychange')()
  assert.equal(e.engine.calls.at(-1), 'stop')
  assert.equal(e.sent.filter(x=>x.type==='device.status').at(-1).audioEnabled, false)
})
