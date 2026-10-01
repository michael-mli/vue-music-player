import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { timelinePosition } from '../server/ktv-timeline.js'

function compile(filename, replace = value => value) {
  const source = fs.readFileSync(new URL(filename, import.meta.url), 'utf8')
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } })
  return `data:text/javascript;base64,${Buffer.from(replace(result.outputText)).toString('base64')}`
}
const timingModule = compile('../src/utils/partyTimeline.ts')
const { partyPosition, serverToAudioTime, partyOutputClock } = await import(timingModule)
const { partyOutputSignature } = await import(compile('../src/services/partyOutputMonitor.ts'))
const { PartyAudioEngine, waitForPartyAudioClock } = await import(compile('../src/services/partyAudioEngine.ts', source => source.replace("'@/utils/partyTimeline'", JSON.stringify(timingModule))))

test('output readiness waits through a running context with a stalled startup clock', async t => {
  const original = globalThis.performance
  let wall = 0, polls = 0
  globalThis.performance = { now: () => wall }
  t.after(() => { globalThis.performance = original })
  const context = { state: 'running', currentTime: 0 }
  await waitForPartyAudioClock(context, () => true, async () => {
    wall += 100; polls++
    if (polls > 20) context.currentTime += .1
  })
  assert.equal(polls, 23)
})

test('output readiness rejects a stalled, suspended or cancelled clock', async t => {
  const original = globalThis.performance
  let wall = 0
  globalThis.performance = { now: () => wall }
  t.after(() => { globalThis.performance = original })
  const context = { state: 'running', currentTime: 0 }
  const sleep = async () => { wall += 100 }
  await assert.rejects(waitForPartyAudioClock(context, () => true, sleep), /AUDIO_OUTPUT_NOT_READY/)
  await assert.rejects(waitForPartyAudioClock(context, () => false, sleep), /AUDIO_ENABLE_CANCELLED/)
  context.state = 'suspended'
  await assert.rejects(waitForPartyAudioClock(context, () => true, sleep), /AUDIO_ENABLE_CANCELLED/)
})

test('output readiness restarts its stable window after a render clock jump', async t => {
  const original = globalThis.performance
  let wall = 0, polls = 0
  globalThis.performance = { now: () => wall }
  t.after(() => { globalThis.performance = original })
  const context = { state: 'running', currentTime: 0 }
  await waitForPartyAudioClock(context, () => true, async () => {
    wall += 100; polls++; context.currentTime += polls === 3 ? .3 : .1
  })
  assert.equal(polls, 6)
})

test('output readiness rejects a clock running consistently slower than wall time', async t => {
  const original = globalThis.performance
  let wall = 0
  globalThis.performance = { now: () => wall }
  t.after(() => { globalThis.performance = original })
  const context = { state: 'running', currentTime: 0 }
  await assert.rejects(waitForPartyAudioClock(context, () => true, async () => {
    wall += 100; context.currentTime += .09
  }), /AUDIO_OUTPUT_NOT_READY/)
})

test('browser and room timelines agree before and after a scheduled seek/pause', () => {
  for (const state of ['scheduled', 'playing', 'paused']) {
    const timeline = { state, positionMs: 1000, anchorServerMs: 5000, durationMs: 20000, generation: 1,
      pendingTransition: { state: 'paused', positionMs: 5000, anchorServerMs: 9000, effectiveServerMs: 9000, generation: 2 } }
    for (const nowMs of [1000, 5000, 6500, 8999, 9000, 30000]) assert.equal(partyPosition(timeline, nowMs), timelinePosition(timeline, nowMs))
  }
})

test('output timestamp mapping accounts for local output delay once and has an explicit fallback', () => {
  const context = { currentTime: 10, outputLatency: 0.1, baseLatency: 0.02,
    getOutputTimestamp: () => ({ contextTime: 9.9, performanceTime: 1000 }) }
  assert.equal(serverToAudioTime(context, 8000, 5000, 1000), 11.9)
  context.getOutputTimestamp = () => ({ contextTime: 0, performanceTime: 0 })
  assert.equal(serverToAudioTime(context, 8000, 5000, 1000), 11.9)
})

function fixture(t) {
  const originalContext = globalThis.AudioContext, originalWindow = globalThis.window, originalFetch = globalThis.fetch
  const originalPerformance = globalThis.performance
  let nowMs = 1000, context
  globalThis.performance = { now: () => nowMs }
  const nodes = [], gains = []
  class Context {
    state = 'suspended'; currentTime = 100; sampleRate = 44100; baseLatency = 0.01; outputLatency = 0.05; destination = {}
    constructor() { context = this }
    resume() { this.state = 'running'; return Promise.resolve() }
    close() { this.state = 'closed'; return Promise.resolve() }
    getOutputTimestamp() { return { contextTime: this.currentTime - 0.05, performanceTime: performance.now() } }
    decodeAudioData() { return Promise.resolve({ duration: 60, length: 60 * 44100, numberOfChannels: 2 }) }
    createGain() {
      const outputs = new Set(), gain = { value: 1, setValueAtTime(value) { this.value = value }, linearRampToValueAtTime(value) { this.value = value },
        cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value } }
      const node = { context: this, gain, outputs, connect(target) { outputs.add(target) }, disconnect(target) { if (target) outputs.delete(target); else outputs.clear() } }
      gains.push(node); return node
    }
    createBufferSource() {
      const outputs = new Set()
      const node = { starts: [], stops: [], outputs, onended: null, connect(target) { outputs.add(target) }, disconnect(target) { if (target) outputs.delete(target); else outputs.clear() },
        start(...args) { this.starts.push(args) }, stop(...args) { this.stops.push(args) } }
      nodes.push(node); return node
    }
  }
  globalThis.AudioContext = Context
  globalThis.window = { setTimeout: (work, delay) => {
    if (delay === 100) return setTimeout(() => { nowMs += delay; context.currentTime += delay / 1000; work() }, 0)
    return setTimeout(work, delay)
  }, clearTimeout }
  const bytes = Buffer.from([1, 2, 3, 4])
  globalThis.fetch = async () => new Response(bytes)
  const asset = { url: '/test.mp3', bytes: 4, sha256: createHash('sha256').update(bytes).digest('hex'), durationMs: 60000,
    sampleRate: 44100, channels: 2, alignmentOffsetMs: 0 }
  const engine = new PartyAudioEngine()
  const now = performance.now() + 5000
  const clock = { clockId: 'clock', status: 'healthy', offsetMs: 5000, uncertaintyMs: 10 }
  const playback = { state: 'scheduled', generation: 1, clockId: 'clock', performanceId: 'performance', entryId: 'entry',
    positionMs: 0, anchorServerMs: now + 2000, durationMs: 60000, pendingTransition: null, assets: { instrumental: asset, original: asset } }
  const lease = { id: 'lease', generation: 1, clockId: 'clock', performanceId: 'performance', expiresServerMs: now + 8000, sequence: 1 }
  t.after(async () => { await engine.close(); globalThis.AudioContext = originalContext; globalThis.window = originalWindow; globalThis.fetch = originalFetch; globalThis.performance = originalPerformance })
  return { engine, nodes, gains, asset, playback, clock, lease, get context() { return context },
    advance: ms => { nowMs += ms; context.currentTime += ms / 1000 } }
}

test('decoded audio is hashed, bounded and remains silent without a current output lease', async t => {
  const f = fixture(t)
  await f.engine.enable(); await f.engine.prepare(f.asset)
  assert.equal(f.engine.preparedHash, f.asset.sha256)
  assert.equal(f.engine.decodedBytes, 60 * 44100 * 2 * 4)
  f.engine.sync(f.playback, f.clock, null, 'stage')
  assert.equal(f.nodes.length, 0)
  f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  assert.equal(f.nodes.length, 1); assert.ok(f.nodes[0].starts[0][0] > 101.8)
  const deadline = f.nodes[0].stops.at(-1)[0]
  f.engine.sync(f.playback, f.clock, { ...f.lease, expiresServerMs: f.lease.expiresServerMs + 2000 }, 'stage')
  assert.ok(f.nodes[0].stops.at(-1)[0] > deadline + 1.9)
  f.engine.sync(f.playback, { ...f.clock, clockId: 'old-clock' }, f.lease, 'stage')
  assert.equal(f.nodes[0].stops.at(-1)[0], f.context.currentTime)
  await assert.rejects(f.engine.prepare({ ...f.asset, sha256: 'wrong-hash' }), /AUDIO_ASSET_CHANGED/)
  await assert.rejects(f.engine.prepare({ ...f.asset, durationMs: 10000000 }), /AUDIO_MEMORY_LIMIT/)
})

test('seek prepares one next source and adopts it when the committed generation changes', async t => {
  const f = fixture(t)
  await f.engine.enable(); await f.engine.prepare(f.asset)
  f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  const boundary = performance.now() + f.clock.offsetMs + 1500
  const pending = { state: 'playing', generation: 2, positionMs: 20000, anchorServerMs: boundary, effectiveServerMs: boundary }
  f.engine.sync({ ...f.playback, pendingTransition: pending }, f.clock, { ...f.lease, nextGeneration: 2 }, 'stage')
  assert.equal(f.nodes.length, 2)
  assert.equal(f.nodes[1].starts[0][1], 20)
  f.engine.sync({ ...f.playback, ...pending, pendingTransition: null }, f.clock, { ...f.lease, generation: 2 }, 'stage')
  assert.equal(f.nodes.length, 2)
})

test('output mapping rejects nonfinite/stale timestamps and identifies estimation without double latency', () => {
  const context = { currentTime: 10, outputLatency: .2, baseLatency: .01, getOutputTimestamp: () => ({ contextTime: Infinity, performanceTime: 1000 }) }
  assert.equal(partyOutputClock(context, 1000).mode, 'estimate')
  assert.equal(serverToAudioTime(context, 8000, 5000, 1000), 11.8)
  context.getOutputTimestamp = () => ({ contextTime: 9.8, performanceTime: 1000 })
  assert.equal(partyOutputClock(context, 4001).mode, 'estimate')
  assert.equal(partyOutputClock(context, 1000).mode, 'timestamp')
})

test('late attachment allows high browser output latency and still begins at the correct live sample', async t => {
  const f = fixture(t)
  await f.engine.enable(); await f.engine.prepare(f.asset)
  f.context.outputLatency = .4
  f.context.getOutputTimestamp = () => ({ contextTime: f.context.currentTime - .4, performanceTime: performance.now() })
  f.playback.anchorServerMs = performance.now() + f.clock.offsetMs - 10000; f.playback.state = 'playing'
  f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  assert.ok(f.nodes[0].starts[0][0] >= f.context.currentTime + .09)
  assert.ok(f.nodes[0].starts[0][1] >= 10.49)
  f.advance(1000); f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  assert.ok(Math.abs(f.engine.diagnostics.phaseErrorMs) < 1)
})

test('sustained rendered drift stops once, blocks stale lease output, and requires explicit fresh scheduling', async t => {
  const f = fixture(t), recoveries = []
  f.engine.onRecovery = reason => recoveries.push(reason)
  await f.engine.enable(); await f.engine.prepare(f.asset)
  f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  f.advance(3000); f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  assert.ok(Math.abs(f.engine.diagnostics.phaseErrorMs) < 1)
  f.clock.offsetMs += 100
  for (let sample = 0; sample < 3; sample++) { f.advance(1000); f.engine.sync(f.playback, f.clock, f.lease, 'stage') }
  assert.deepEqual(recoveries, ['drift'])
  assert.ok(f.engine.diagnostics.maxAbsPhaseErrorMs >= 99)
  f.engine.sync(f.playback, f.clock, { ...f.lease, expiresServerMs: f.lease.expiresServerMs + 8000 }, 'stage')
  assert.equal(f.nodes.length, 1)
  f.engine.resetRecovery(); await f.engine.prepare(f.asset); f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  assert.equal(f.nodes.length, 2)
})

test('output-latency change pauses the engine; timestamp-free estimates do not claim measured drift', async t => {
  const f = fixture(t), recoveries = []
  f.engine.onRecovery = reason => recoveries.push(reason)
  await f.engine.enable(); await f.engine.prepare(f.asset)
  f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  f.advance(3000); f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  f.context.outputLatency = .15
  f.advance(1000); f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  assert.deepEqual(recoveries, ['output'])
  f.engine.resetRecovery(); await f.engine.prepare(f.asset); f.context.getOutputTimestamp = () => ({ contextTime: 0, performanceTime: 0 })
  f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  f.clock.offsetMs += 300
  f.advance(1000); f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  assert.equal(f.engine.diagnostics.timingMode, 'estimate')
  assert.deepEqual(recoveries, ['output'])
})

test('headphone fingerprints ignore microphones/cameras and retain default-output order changes', () => {
  const speaker = { kind: 'audiooutput', deviceId: 'speaker', groupId: 'speaker-group' }
  const headphone = { kind: 'audiooutput', deviceId: 'headphone', groupId: 'headphone-group' }
  const devices = [speaker, { kind: 'audioinput', deviceId: 'mic', groupId: 'mic-group' }]
  assert.equal(partyOutputSignature(devices), partyOutputSignature([...devices, { kind: 'videoinput', deviceId: 'camera' }]))
  assert.notEqual(partyOutputSignature([speaker, headphone]), partyOutputSignature([headphone, speaker]))
})

test('a decode completing after an output fault cannot restore the old ready buffer', async t => {
  const f = fixture(t)
  await f.engine.enable()
  const originalDecode = f.context.decodeAudioData.bind(f.context)
  let finishDecode
  f.context.decodeAudioData = () => new Promise(resolve => { finishDecode = () => resolve({ duration: 60, length: 60 * 44100, numberOfChannels: 2 }) })
  const pending = f.engine.prepare(f.asset)
  for (let attempt = 0; attempt < 100 && !finishDecode; attempt++) await new Promise(resolve => setTimeout(resolve, 1))
  assert.equal(typeof finishDecode, 'function')
  f.engine.outputChanged(); finishDecode(); await pending
  assert.equal(f.engine.preparedHash, '')
  assert.equal(f.engine.diagnostics.recovery, 'output')
  f.context.decodeAudioData = originalDecode
  f.engine.resetRecovery(); await f.engine.enable(); await f.engine.prepare(f.asset)
  assert.equal(f.engine.preparedHash, f.asset.sha256)
})

test('disabling audio while its clock settles cannot enable a stale request', async t => {
  const f = fixture(t), pending = f.engine.enable()
  assert.equal(f.engine.enabled, false)
  f.engine.cancelEnable()
  await assert.rejects(pending, /AUDIO_ENABLE_CANCELLED/)
  assert.equal(f.engine.enabled, false)
})

test('loss of previously available output timestamps recovers an active device instead of inventing ongoing rendered samples', async t => {
  const f = fixture(t), recoveries = []
  f.engine.onRecovery = reason => recoveries.push(reason)
  await f.engine.enable(); await f.engine.prepare(f.asset)
  f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  f.advance(3000); f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  assert.equal(f.engine.diagnostics.timingMode, 'timestamp')
  f.context.getOutputTimestamp = () => ({ contextTime: 0, performanceTime: 0 })
  f.advance(1000); f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  assert.deepEqual(recoveries, ['output'])
})

test('publisher capture reads the rendered source position rather than the physical-output wall clock', async t => {
  const f = fixture(t)
  await f.engine.enable(); await f.engine.prepare(f.asset)
  assert.equal(f.engine.renderPositionMs, null)
  f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  assert.equal(f.engine.renderPositionMs, null)
  f.advance(2100)
  const [when, offset] = f.nodes[0].starts[0]
  assert.ok(Math.abs(f.engine.renderPositionMs - (offset + f.context.currentTime - when) * 1000) < 0.01)
  f.engine.stop(); assert.equal(f.engine.renderPositionMs, null)
})

test('the integrated backing tap is independent of monitor volume and shares the source’s lease stop', async t => {
  const f = fixture(t)
  await f.engine.enable(); await f.engine.prepare(f.asset)
  const tap = f.engine.createPublisherTap(f.asset.sha256, 1)
  assert.equal(tap.active, true); assert.throws(() => f.engine.createPublisherTap(f.asset.sha256, 1), /PUBLISH_BACKING_IN_USE/)
  f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  const [monitor, publish] = [...f.nodes[0].outputs]
  assert.equal(monitor.outputs.has(f.context.destination), true); assert.equal(publish.outputs.has(tap.instrumental), true)
  f.engine.setVolume(0)
  assert.equal(monitor.gain.value, 0); assert.equal(publish.gain.value, 1)
  f.advance(9000)
  // Even a delayed onended callback cannot report a still-rendering lyric frame.
  assert.equal(f.engine.renderPositionMs, null)
  f.engine.releaseBuffer(); assert.equal(tap.active, false); assert.equal(publish.outputs.size, 0)
})

test('an original guide cannot obtain a backing tap or be scheduled as an instrumental', async t => {
  const f = fixture(t)
  await f.engine.enable(); await f.engine.prepare(f.asset, 'original')
  assert.throws(() => f.engine.createPublisherTap(f.asset.sha256, 1), /PUBLISH_BACKING_UNAVAILABLE/)
  f.engine.sync(f.playback, f.clock, f.lease, 'stage'); assert.equal(f.nodes.length, 0)
  f.engine.sync(f.playback, f.clock, f.lease, 'guide'); assert.equal(f.nodes.length, 1)
  await f.engine.prepare(f.asset, 'instrumental')
  assert.equal(f.engine.createPublisherTap(f.asset.sha256, 1).active, true)
})

test('a publisher tap never adopts a future seek generation under an old permit', async t => {
  const f = fixture(t)
  await f.engine.enable(); await f.engine.prepare(f.asset)
  const tap = f.engine.createPublisherTap(f.asset.sha256, 1)
  f.engine.sync(f.playback, f.clock, f.lease, 'stage')
  const boundary = performance.now() + f.clock.offsetMs + 1500
  const pending = { state: 'playing', generation: 2, positionMs: 20000, anchorServerMs: boundary, effectiveServerMs: boundary }
  f.engine.sync({ ...f.playback, pendingTransition: pending }, f.clock, { ...f.lease, nextGeneration: 2 }, 'stage')
  assert.equal(f.nodes[0].outputs.size, 2); assert.equal(f.nodes[1].outputs.size, 1)
  tap.close()
  assert.equal(f.nodes[0].outputs.size, 1) // Personal monitor remains attached.
})
