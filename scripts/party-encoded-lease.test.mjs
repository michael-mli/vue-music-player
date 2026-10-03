import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

const source = await fs.readFile('src/services/partyEncodedLease.worker.js', 'utf8')
const identity = { clockId: 'clock', performanceId: 'performance', generation: 4 }
function fixture() {
  let wall = 1000, monotonic = 50, timer
  const messages = [], self = { postMessage: message => messages.push(message) }
  const scope = { self, Date: { now: () => wall }, performance: { now: () => monotonic }, TransformStream,
    setInterval: work => { timer = work } }
  vm.runInNewContext(source, scope)
  const send = data => self.onmessage({ data })
  send({ type: 'init', identity })
  return { self, send, messages, tick: () => timer(),
    step(delta, monotonicDelta = delta) { wall += delta; monotonic += monotonicDelta },
    renew(expiry = 5000, sequence = 1, owner = identity) { send({ type: 'renew', identity: owner, sequence, expiry }) },
    async stream(kind, frames) {
      const output = []
      const readable = new ReadableStream({ start(controller) { for (const frame of frames) controller.enqueue(frame); controller.close() } })
      let done
      const finished = new Promise(resolve => { done = resolve })
      const writable = new WritableStream({ write: frame => { output.push(frame) }, close: done })
      send({ type: 'attach', kind, readable, writable })
      await finished
      return output
    } }
}
test('unarmed encoded streams drop frames; valid permits preserve audio and lyric frames without buffering', async () => {
  const closed = fixture()
  assert.deepEqual(await closed.stream('audio', [1, 2]), [])
  assert.deepEqual(closed.messages.map(item => item.type), ['ready'])
  const f = fixture(); f.renew()
  assert.deepEqual(await f.stream('audio', ['audio-1', 'audio-2']), ['audio-1', 'audio-2'])
  assert.deepEqual(await f.stream('video', ['lyric-1', 'lyric-2']), ['lyric-1', 'lyric-2'])
})
test('worker timer permanently closes an expired permit even with no incoming frames or page messages', async () => {
  const f = fixture(); f.renew(); f.step(4000); f.tick()
  f.renew(9000, 2)
  assert.deepEqual(await f.stream('audio', ['queued-after-resume']), [])
  assert.deepEqual(await f.stream('video', ['old-lyric']), [])
  assert.deepEqual(f.messages.map(item => item.reason).filter(Boolean), ['expired'])
})
test('first frame checks expiry even if the worker timer has not run', async () => {
  const f = fixture(); f.renew(); f.step(4000)
  assert.deepEqual(await f.stream('audio', ['late-frame']), [])
  assert.equal(f.messages.at(-1).reason, 'expired')
})
test('bounded timely renewal extends a live permit; replay or owner change permanently closes both streams', async () => {
  const live = fixture(); live.renew(); live.step(3000); live.renew(8000, 2); live.step(2000)
  assert.deepEqual(await live.stream('audio', [1]), [1])
  for (const bad of [ { sequence: 1, owner: identity }, { sequence: 2, owner: { ...identity, generation: 5 } },
    { sequence: 2, owner: { ...identity, clockId: 'old' } }, { sequence: 2, owner: { ...identity, performanceId: 'other' } } ]) {
    const f = fixture(); f.renew(); f.renew(6000, bad.sequence, bad.owner)
    assert.deepEqual(await f.stream('audio', [1]), [])
    assert.deepEqual(await f.stream('video', [2]), [])
    assert.equal(f.messages.at(-1).reason, 'invalid')
  }
})
test('invalid deadlines, stop and wall-clock discontinuities cannot be renewed back into publication', async () => {
  for (const expiry of [NaN, Infinity, 1000, 11001]) {
    const f = fixture(); f.renew(expiry); f.renew(5000, 2)
    assert.deepEqual(await f.stream('audio', [1]), [])
  }
  for (const [wallDelta, monotonicDelta] of [[-1, 1], [1000, 0], [100, -1]]) {
    const f = fixture(); f.renew(); f.step(wallDelta, monotonicDelta); f.tick()
    assert.equal(f.messages.at(-1).reason, 'clock')
    assert.deepEqual(await f.stream('audio', [1]), [])
  }
  const stopped = fixture(); stopped.renew(); stopped.send({ type: 'stop' }); stopped.renew(6000, 2)
  assert.deepEqual(await stopped.stream('audio', [1]), [])
})
test('the standard transform event installs the same expiry gate as transferred legacy streams', async () => {
  const f = fixture(); f.renew(); f.step(4000)
  const output = []
  let finish
  const finished = new Promise(resolve => { finish = resolve })
  f.self.onrtctransform({ transformer: { options: { kind: 'audio' },
    readable: new ReadableStream({ start(controller) { controller.enqueue('late'); controller.close() } }),
    writable: new WritableStream({ write: frame => output.push(frame), close: finish }) } })
  await finished
  assert.deepEqual(output, [])
})

const adapterSource = ts.transpileModule(await fs.readFile('src/services/partyEncodedLease.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText.replace("import workerUrl from './partyEncodedLease.worker.js?url';", "const workerUrl = '/owned-worker.js';")
const adapter = await import(`data:text/javascript;base64,${Buffer.from(adapterSource).toString('base64')}`)
function adapterFixture(t, modern, legacy = !modern) {
  const old = { Worker: globalThis.Worker, RTCRtpSender: globalThis.RTCRtpSender, RTCRtpScriptTransform: globalThis.RTCRtpScriptTransform }
  const workers = [], replaced = []
  globalThis.Worker = class {
    constructor() { this.messages = []; workers.push(this) }
    postMessage(data, transfers) { this.messages.push({ data, transfers }) }
    terminate() { this.terminated = true }
  }
  globalThis.RTCRtpSender = class {
    createEncodedStreams() { return this.streams = { readable: new ReadableStream(), writable: new WritableStream() } }
    async replaceTrack(track) { replaced.push(track) }
  }
  globalThis.RTCRtpScriptTransform = modern ? class {
    constructor(worker, options) { this.worker = worker; this.options = options }
  } : undefined
  if (!legacy) delete RTCRtpSender.prototype.createEncodedStreams
  t.after(() => { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value } })
  return { workers, replaced, sender: () => new RTCRtpSender() }
}
for (const modern of [true, false]) test(`${modern ? 'standard' : 'legacy'} adapter gates both senders and fails closed on worker failure`, t => {
  const f = adapterFixture(t, modern), configuration = adapter.partyEncodedRTCConfiguration()
  assert.deepEqual(configuration, modern ? {} : { encodedInsertableStreams: true })
  let failed = 0
  const lease = new adapter.PartyEncodedLease(identity, () => { failed++ }), audio = f.sender(), video = f.sender()
  lease.attach(audio, 'audio'); lease.attach(video, 'video')
  const worker = f.workers[0]
  if (modern) {
    assert.equal(audio.transform.worker, worker); assert.equal(video.transform.worker, worker)
    assert.deepEqual([audio.transform.options.kind, video.transform.options.kind], ['audio', 'video'])
  } else {
    assert.deepEqual(worker.messages.slice(1).map(item => item.data.kind), ['audio', 'video'])
    assert.deepEqual(worker.messages[1].transfers, [audio.streams.readable, audio.streams.writable])
  }
  const clock = { clockId: identity.clockId, status: 'healthy', offsetMs: 0, uncertaintyMs: 5 }
  const permit = { ...identity, expiresServerMs: performance.now() + 5000 }, before = Date.now()
  assert.equal(lease.renew(permit, clock), true)
  const renewal = worker.messages.at(-1).data
  assert.equal(renewal.sequence, 1); assert.ok(renewal.expiry <= before + 5000 && renewal.expiry > before + 4900)
  worker.onmessage({ data: { type: 'silent', reason: 'expired' } }); worker.onerror()
  assert.equal(failed, 1); assert.deepEqual(f.replaced, [null, null])
  assert.equal(lease.renew(permit, clock), false); assert.equal(worker.terminated, true)
})
test('a browser exposing both APIs reserves the encoded gate before publication', t => {
  const f = adapterFixture(t, true, true)
  assert.deepEqual(adapter.partyEncodedRTCConfiguration(), { encodedInsertableStreams: true })
  const lease = new adapter.PartyEncodedLease(identity, () => {}), sender = f.sender()
  lease.attach(sender, 'audio')
  assert.equal(sender.transform, undefined)
  assert.deepEqual(f.workers[0].messages[1].transfers, [sender.streams.readable, sender.streams.writable])
  // Losing the selected API cannot silently switch to a late standard gate.
  const second = f.sender()
  delete RTCRtpSender.prototype.createEncodedStreams
  assert.throws(() => lease.attach(second, 'video'), /MEDIA_CAPTURE_UNAVAILABLE/)
  assert.equal(second.transform, undefined)
  assert.equal(f.workers[0].messages.length, 2)
})
test('unsupported publishing and mismatched clock permits cannot bypass the encoded gate', t => {
  const f = adapterFixture(t, false)
  delete RTCRtpSender.prototype.createEncodedStreams
  assert.throws(() => adapter.partyEncodedRTCConfiguration(), /MEDIA_CAPTURE_UNAVAILABLE/)
  const lease = new adapter.PartyEncodedLease(identity, () => {})
  assert.equal(lease.renew({ ...identity, expiresServerMs: performance.now() + 5000 },
    { clockId: 'old', status: 'healthy', offsetMs: 0, uncertaintyMs: 5 }), false)
  assert.equal(f.workers[0].terminated, true)
  assert.deepEqual(f.workers[0].messages.map(item => item.data.type), ['init'])
})
