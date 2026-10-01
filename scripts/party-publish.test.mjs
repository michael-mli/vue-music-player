import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'

const source = await fs.readFile(new URL('../src/services/partyPublishGraph.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { PartyPublishGraph } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

function fixture() {
  const param = () => ({ value: 0, commands: [], setTargetAtTime(...args) { this.commands.push(args); this.value = args[0] },
    setValueAtTime(...args) { this.commands.push(args); this.value = args[0] }, cancelScheduledValues() {} })
  const track = Object.assign(new EventTarget(), { readyState: 'live', stop() { this.readyState = 'ended' } })
  const micTrack = Object.assign(new EventTarget(), { readyState: 'live' })
  const nodes = []
  const context = Object.assign(new EventTarget(), { state: 'running', currentTime: 10, sampleRate: 48000,
    createGain() { return node({ gain: param() }) }, createDelay() { return node({ delayTime: param() }) },
    createDynamicsCompressor() { return node(Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(name => [name, param()]))) },
    createMediaStreamDestination() { return node({ stream: { getTracks: () => [track] } }) }, createMediaStreamSource() { return node() } })
  function node(extra = {}) {
    const item = { context, outputs: new Set(), connect(target) { this.outputs.add(target) }, disconnect(target) { if (target) this.outputs.delete(target); else this.outputs.clear() }, ...extra }
    nodes.push(item); return item
  }
  context.destination = node()
  const instrumental = node(), guide = node(), capture = { getAudioTracks: () => [micTrack] }
  const identity = { clockId: 'clock', performanceId: 'performance', generation: 1 }
  const clock = { clockId: 'clock', status: 'healthy', offsetMs: 0, uncertaintyMs: 10 }
  return { context, instrumental, guide, capture, identity, clock, nodes, track, micTrack }
}

test('monitor changes cannot change published backing/mic levels, and the guide has no publish path', () => {
  const f = fixture(), graph = new PartyPublishGraph(f.context, f.instrumental, f.capture, f.identity)
  const [monitor, backing] = [...f.instrumental.outputs]
  graph.setPublishLevels(0.5, 1.2); graph.setMonitorVolume(0)
  assert.equal(monitor.gain.value, 0); assert.equal(backing.gain.value, 0.5)
  assert.equal(f.guide.outputs.size, 0)
  assert.equal(monitor.outputs.has(f.context.destination), true)
  assert.equal(backing.outputs.has(f.context.destination), false)
  graph.close(); assert.equal(f.instrumental.outputs.size, 0); assert.equal(f.track.readyState, 'ended')
  assert.equal(f.micTrack.readyState, 'live') // Capture lease belongs to the caller.
})

test('venue-mix mode cannot publish a second copy of the instrumental', () => {
  const f = fixture(), graph = new PartyPublishGraph(f.context, f.instrumental, f.capture, f.identity, 'venue-mix')
  graph.setPublishLevels(1, 1)
  assert.equal([...f.instrumental.outputs][1].gain.value, 0)
  graph.close()
})

test('an engine-backed publisher does not create a second physical monitor branch', () => {
  const f = fixture(), graph = new PartyPublishGraph(f.context, f.instrumental, f.capture, f.identity, 'clean-mic', false)
  const monitor = [...f.instrumental.outputs][0]
  assert.equal(monitor.outputs.size, 0)
  assert.equal(f.nodes.filter(node => node.outputs.has(f.context.destination)).length, 0)
  graph.close()
})

test('publish permission expires in the audio render thread and rejects stale clock/generation', () => {
  const f = fixture(), graph = new PartyPublishGraph(f.context, f.instrumental, f.capture, f.identity)
  const gate = f.nodes.find(node => node.outputs.has(f.nodes.find(item => item.stream)))
  const expiresServerMs = performance.now() + 4000
  assert.equal(graph.renew({ ...f.identity, expiresServerMs }, f.clock), true)
  assert.equal(gate.gain.commands.at(-1)[0], 0); assert.ok(gate.gain.commands.at(-1)[1] < 14)
  assert.equal(graph.renew({ ...f.identity, generation: 2, expiresServerMs }, f.clock), false)
  assert.equal(gate.gain.value, 0)
  assert.equal(graph.renew({ ...f.identity, expiresServerMs }, { ...f.clock, clockId: 'obsolete' }), false)
  assert.equal(graph.renew({ ...f.identity, expiresServerMs: performance.now() + 60000 }, f.clock), false)
  graph.renew({ ...f.identity, expiresServerMs }, f.clock)
  f.context.state = 'suspended'; f.context.dispatchEvent(new Event('statechange'))
  assert.equal(gate.gain.value, 0)
  graph.close()
})

test('renewing a permit extends its expiry while retaining only clock/performance/generation identity', () => {
  const f = fixture(), first = { ...f.identity, expiresServerMs: performance.now() + 2000 }
  const graph = new PartyPublishGraph(f.context, f.instrumental, f.capture, first)
  assert.equal(graph.renew(first, f.clock), true)
  assert.equal(graph.renew({ ...first, expiresServerMs: performance.now() + 4000 }, f.clock), true)
  graph.close()
})

test('calibration changes silence publication and delays backing or mic in one direction only', () => {
  const f = fixture(), graph = new PartyPublishGraph(f.context, f.instrumental, f.capture, f.identity)
  graph.renew({ ...f.identity, expiresServerMs: performance.now() + 4000 }, f.clock)
  graph.setAlignment(75)
  assert.equal(graph.diagnostics.expiresServerMs, 0)
  assert.equal(graph.renew({ ...f.identity, expiresServerMs: performance.now() + 4000 }, f.clock), false)
  assert.equal(graph.diagnostics.requiresNewGeneration, true)
  const delays = f.nodes.filter(node => node.delayTime).map(node => node.delayTime.value)
  assert.deepEqual(delays, [0.075, 0])
  graph.setAlignment(-50)
  assert.deepEqual(f.nodes.filter(node => node.delayTime).map(node => node.delayTime.value), [0, 0.05])
  assert.throws(() => graph.setAlignment(501), /INVALID_PUBLISH_ALIGNMENT/)
  assert.equal(graph.diagnostics.physicalAlignmentMeasured, false)
  graph.close()
})
