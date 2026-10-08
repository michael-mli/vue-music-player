import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'

const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
const compile = text => ts.transpileModule(text, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
} }).outputText
const guard = moduleUrl(compile(await fs.readFile('src/services/partyLeaseGuard.ts', 'utf8'))
  .replace("import moduleUrl from './partyLeaseGuard.worklet.js?url';", "const moduleUrl = '/owned-guard.js';"))
const { PartyReceiveGraph } = await import(moduleUrl(compile(await fs.readFile('src/services/partyReceiveGraph.ts', 'utf8'))
  .replace("'./partyLeaseGuard'", JSON.stringify(guard))))

function fixture(t) {
  const previous = { worklet: globalThis.AudioWorkletNode, performance: globalThis.performance, date: Date.now }
  let now = 1000, wall = 10000, failures = 0
  globalThis.performance = { now: () => now }; Date.now = () => wall
  const nodes = []
  const context = Object.assign(new EventTarget(), { currentTime: 1, state: 'running',
    createMediaStreamSource() { return node() }, createGain() {
      return node({ gain: { value: 0, commands: [], cancelScheduledValues() {}, setValueAtTime(...args) { this.commands.push(args) } } })
    } })
  function node(extra = {}) {
    const value = { context, outputs: new Set(), connect(to) { this.outputs.add(to) },
      disconnect() { this.outputs.clear() }, ...extra }; nodes.push(value); return value
  }
  context.destination = node()
  globalThis.AudioWorkletNode = class {
    constructor() { return node({ port: { closed: false, messages: [], postMessage(message) { this.messages.push(message) }, close() { this.closed = true } } }) }
  }
  const track = Object.assign(new EventTarget(), { readyState: 'live', stop() { throw new Error('Receiver does not own the track') } })
  const stream = { getAudioTracks: () => [track] }
  const identity = { publisherIdentity: 'publisher-first', clockId: 'clock', performanceId: 'performance', generation: 1 }
  const clock = { status: 'healthy', clockId: 'clock', offsetMs: 5000, uncertaintyMs: 5 }
  const permit = { ...identity, expiresServerMs: 9500 }
  const graph = new PartyReceiveGraph(context, stream, permit, () => failures++)
  t.after(() => { graph.close(); globalThis.AudioWorkletNode = previous.worklet; globalThis.performance = previous.performance; Date.now = previous.date })
  return { nodes, context, graph, permit, clock, track, get failures() { return failures },
    step(ms, wallMs = ms) { now += ms; wall += wallMs } }
}

test('receiver audio has no destination path until the exact source deadline is accepted', t => {
  const f = fixture(t)
  assert.equal(f.nodes.some(node => node.outputs.has(f.context.destination)), false)
  assert.equal(f.graph.renew(f.permit, f.clock), true)
  const guard = f.nodes.find(node => node.port), gate = f.nodes.find(node => node.gain)
  assert.equal(gate.outputs.has(guard), true); assert.equal(guard.outputs.has(f.context.destination), true)
  assert.deepEqual(gate.gain.commands, [[1, 1], [0, 4.395]])
  f.step(1000)
  assert.equal(f.graph.renew({ ...f.permit, expiresServerMs: 10500 }, f.clock), true)
  assert.equal(f.nodes.filter(node => node.port).length, 1)
  assert.equal(guard.port.messages.at(-1).sequence, 1)
  f.graph.close(); assert.equal(f.track.readyState, 'live'); assert.equal(f.context.state, 'running')
  assert.equal(f.nodes.some(node => node.outputs.has(f.context.destination)), false)
})

test('a blocked callback cannot resurrect receiver output after the previous deadline', t => {
  const f = fixture(t); assert.equal(f.graph.renew(f.permit, f.clock), true)
  f.step(3395)
  assert.equal(f.graph.renew({ ...f.permit, expiresServerMs: 12000 }, f.clock), false)
  assert.equal(f.failures, 1)
  assert.equal(f.graph.renew({ ...f.permit, expiresServerMs: 15000 }, f.clock), false)
  assert.equal(f.nodes.filter(node => node.port).length, 1)
})

for (const [name, mutate] of [
  ['publisher', permit => ({ ...permit, publisherIdentity: 'publisher-replacement' })],
  ['performance', permit => ({ ...permit, performanceId: 'old-performance' })],
  ['generation', permit => ({ ...permit, generation: 2 })],
  ['shorter deadline', permit => ({ ...permit, expiresServerMs: 9400 })],
]) test(`receiver closes permanently on changed ${name}`, t => {
  const f = fixture(t); assert.equal(f.graph.renew(f.permit, f.clock), true)
  assert.equal(f.graph.renew(mutate(f.permit), f.clock), false)
  assert.equal(f.graph.renew(f.permit, f.clock), false); assert.equal(f.failures, 1)
})

for (const fault of ['suspended', 'ended', 'uncertain', 'processor', 'silent']) test(`receiver closes permanently on ${fault}`, t => {
    const f = fixture(t); assert.equal(f.graph.renew(f.permit, f.clock), true)
    if (fault === 'suspended') { f.context.state = 'suspended'; f.context.dispatchEvent(new Event('statechange')) }
    if (fault === 'ended') f.track.dispatchEvent(new Event('ended'))
    if (fault === 'uncertain') assert.equal(f.graph.renew(f.permit, { ...f.clock, uncertaintyMs: 81 }), false)
    if (fault === 'processor') f.nodes.find(node => node.port).onprocessorerror()
    if (fault === 'silent') f.nodes.find(node => node.port).port.onmessage({ data: { type: 'silent' } })
    assert.equal(f.failures, 1); assert.equal(f.graph.renew(f.permit, f.clock), false)
    assert.equal(f.nodes.some(node => node.outputs.has(f.context.destination)), false)
    f.graph.close()
})

test('wall-clock discontinuities cannot extend an already authorized receiver', t => {
  const f = fixture(t); assert.equal(f.graph.renew(f.permit, f.clock), true)
  f.step(100, -1)
  assert.equal(f.graph.renew({ ...f.permit, expiresServerMs: 11000 }, f.clock), false)
  assert.equal(f.failures, 1)
})
