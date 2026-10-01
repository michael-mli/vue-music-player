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
  '@/services/partyPublishGraph': 'export class PartyPublishGraph {}',
  '@/services/partyLyricCapture': 'export class PartyLyricCapture {}',
  '@/services/partyAudioEngine': 'export class PartyAudioEngine {}',
  './useMicDevices': 'export const getMicStream = () => globalThis.__partyMediaLifecycle.mic(); export const releaseMicStream = stream => {for (const track of stream?.getTracks() || []) track.stop();};',
}
let compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
compiled = compiled.replace("'vue'", JSON.stringify(vueModule))
for (const [name, module] of Object.entries(stubs)) compiled = compiled.replace(JSON.stringify(name), JSON.stringify(dataModule(module))).replace(`'${name}'`, JSON.stringify(dataModule(module)))
const { usePartyMedia } = await import(dataModule(compiled))
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function stream() {
  const track = Object.assign(new EventTarget(), { readyState: 'live', stop() { this.readyState = 'ended' } })
  return { getAudioTracks: () => [track], getTracks: () => [track] }
}
function fixture(t) {
  const previous = { window: globalThis.window, document: globalThis.document, state: globalThis.__partyMediaLifecycle }
  const timers = new Map(), micRequests = [], removals = [], cleanups = []
  const window = Object.assign(new EventTarget(), { setInterval(fn) { timers.set(timers.size + 1, fn); return timers.size }, clearInterval(id) { timers.delete(id) } })
  const document = Object.assign(new EventTarget(), { hidden: false })
  globalThis.window = window; globalThis.document = document
  const state = { cleanups, api: { async mediaStatus() { return { available: true } }, async mediaRevoke(...args) { removals.push(args) } },
    mic() { const request = deferred(); micRequests.push(request); return request.promise }, transport() { throw new Error('Unexpected transport creation') } }
  globalThis.__partyMediaLifecycle = state
  const party = ref({ room: { id: 'first-room', performanceMode: 'online', mediaConfigured: true }, self: { id: 'singer', role: 'member', admission: 'admitted' },
    readiness: { performanceId: 'first-performance', singerMemberId: 'singer' }, playback: { state: 'idle', performanceId: null, assets: null } })
  const connected = ref(true), clock = ref({ status: 'healthy', clockId: 'clock', offsetMs: 0, uncertaintyMs: 10 })
  let disabled = 0
  const audio = { deviceId: 'device', enabled: ref(false), healthy: ref(true), blocked: ref(false), prepared: ref(false), assignedHere: ref(false), volume: ref(.7), lines: ref([]),
    async enable() { this.enabled.value = true }, disable() { disabled++; this.enabled.value = false }, createPublisherTap() { throw new Error('Unexpected tap') }, renderPosition() { return null } }
  const media = usePartyMedia(party, connected, clock, audio); media.headphones.value = true
  t.after(async () => {
    for (const cleanup of cleanups) cleanup()
    await nextTick()
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.__partyMediaLifecycle = previous.state
  })
  return { media, party, connected, audio, document, window, micRequests, state, removals, get disabled() { return disabled } }
}
async function permissionRequested(f) {
  for (let attempt = 0; attempt < 10 && !f.micRequests.length; attempt++) await nextTick()
  assert.equal(f.micRequests.length, 1)
}

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
