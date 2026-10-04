import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { installControlledReceiver, analyseControlledReceiverQuality, hasSingleAudienceOutput } from './party-controlled-receiver.mjs'

function sample(presented, lastPresentation, extra = {}) {
  return { phase: 'impaired', receiver: { controlledReceiver: { active: {
    session: 1, ready: true, closed: false, error: null, width: 1280, height: 720,
    maximumBytes: 50000000, maximumQueued: 35, presented, lastPresentation, ...extra
  } } } }
}
test('actual presented frame counters establish nominal controlled output cadence', () => {
  const result = analyseControlledReceiverQuality([sample(10, 1000), sample(260, 11000)], 'impaired')
  assert.equal(result.fps, 25); assert.equal(result.durationMs, 10000); assert.deepEqual(result.errors, [])
})
test('native decoder cadence cannot substitute for missing or slow controlled presentation', () => {
  assert.ok(analyseControlledReceiverQuality([{ phase: 'impaired', receiver: {} }], 'impaired').errors.includes('PLAYOUT_NATIVE_EVIDENCE'))
  assert.ok(analyseControlledReceiverQuality([sample(10, 1000), sample(110, 11000)], 'impaired').errors.includes('PLAYOUT_NOMINAL_FPS'))
  for (const extra of [{ width: 640 }, { ready: false }, { error: 'PLAYOUT_AUDIO_CLOCK' }, { closed: true }]) {
    assert.ok(analyseControlledReceiverQuality([sample(10, 1000), sample(260, 11000, extra)], 'impaired').errors.includes('PLAYOUT_NATIVE_EVIDENCE'))
  }
})
test('a different controller session or exceeded frame/byte bound fails quality', () => {
  for (const extra of [{ session: 2 }, { maximumBytes: 64 * 1024 * 1024 + 1 }, { maximumQueued: 41 }]) {
    assert.ok(analyseControlledReceiverQuality([sample(10, 1000), sample(260, 11000, extra)], 'impaired').errors.length > 0)
  }
})
test('owned video requires its actual decoder and unique draws to meet nominal cadence within the redistributed budget',()=>{
  const owned=(count,time)=>sample(count,time,{drawn:count,maximumQueued:32,maximumBytes:42.5*1024*1024,
    ownedVideo:{closed:false,maximumInFlight:2,decoder:{worker:1,configured:true,closed:false,
      decoded:count,observedAt:time,maximumPending:4,maximumBytes:512*1024}}})
  const first=owned(10,1000),last=owned(260,11000)
  const good=analyseControlledReceiverQuality([first,last],'impaired')
  assert.equal(good.decodedFps,25);assert.equal(good.drawnFps,25);assert.deepEqual(good.errors,[])
  last.receiver.controlledReceiver.active.drawn=110
  assert.ok(analyseControlledReceiverQuality([first,last],'impaired').errors.includes('PLAYOUT_OWNED_VIDEO_FPS'))
  last.receiver.controlledReceiver.active.drawn=260
  last.receiver.controlledReceiver.active.ownedVideo.decoder.decoded=110
  assert.ok(analyseControlledReceiverQuality([first,last],'impaired').errors.includes('PLAYOUT_OWNED_VIDEO_FPS'))
  last.receiver.controlledReceiver.active.ownedVideo.decoder.decoded=260
  last.receiver.controlledReceiver.active.maximumQueued=33
  assert.ok(analyseControlledReceiverQuality([first,last],'impaired').errors.includes('PLAYOUT_OWNED_VIDEO_EVIDENCE'))
})

test('the private decoder/player pair must have exactly one visible current stream with no raw audible path or stale players', () => {
  const element = controlled => ({ controlled, display: controlled ? 'block' : 'none', paused: false, muted: true,
    videoWidth: 1280, videoHeight: 720, hasAttribute: () => controlled,
    srcObject: { getAudioTracks: () => controlled ? [] : [{}], getVideoTracks: () => [{}] } })
  const native = element(false), output = element(true), elements = [native, output]
  const state = { sources: 1, active: { ready: true, error: null } }
  const check = vm.runInNewContext('('+hasSingleAudienceOutput.toString()+')', {
    document: { querySelectorAll: () => elements }, window: { __controlledReceiver: { snapshot: () => state } },
    getComputedStyle: value => ({ display: value.display }) })
  assert.equal(check(), true)
  elements.push(element(false)); assert.equal(check(), false); elements.pop()
  native.display = 'block'; assert.equal(check(), false); native.display = 'none'
  native.muted = false; assert.equal(check(), false); native.muted = true
  state.sources = 2; assert.equal(check(), false); state.sources = 1
  state.active.ready = false; assert.equal(check(), false); state.active.ready = true
  output.srcObject.getAudioTracks = () => [{}]; assert.equal(check(), false)
})

test('only the guarded receive graph claims delay; spectrum probes preserve their native path and teardown closes the inserted nodes', () => {
  class Node {
    constructor(type) { this.type = type; this.connections = [] }
    connect(destination) { this.connections.push(destination); return destination }
    disconnect() { this.connections.length = 0 }
  }
  class Gain extends Node { constructor() { super('gain'); this.gain = { value: 1 } } }
  class Context {
    createMediaStreamSource() { return new Node('source') }
    createDelay() { const node = new Node('delay'); node.delayTime = { value: 0 }; return node }
    createGain() { return new Gain() }
  }
  const original = Context.prototype.createMediaStreamSource, track = {}, stream = { getAudioTracks: () => [track] }
  let cleared = false
  const realm = { window: { AudioContext: Context, __peers: [{ getReceivers: () => [{ track }] }] },
    GainNode: Gain, setInterval: () => 1, clearInterval: () => { cleared = true } }
  vm.runInNewContext('('+installControlledReceiver.toString()+')(null,null,800)', realm)
  const context = new Context(), analyser = new Node('analyser')
  const spectrum = context.createMediaStreamSource(stream)
  assert.equal(spectrum.connect(analyser), analyser)
  assert.equal(realm.window.__controlledReceiver.snapshot().sources, 0)
  assert.equal(spectrum.connections[0], analyser)
  const guarded = context.createMediaStreamSource(stream), gate = new Gain()
  assert.equal(guarded.connect(gate), gate)
  const delay = guarded.connections[0], sync = delay.connections[0]
  assert.equal(delay.type, 'delay'); assert.equal(delay.delayTime.value, .8)
  assert.equal(sync.gain.value, 0); assert.equal(sync.connections[0], gate)
  assert.equal(realm.window.__controlledReceiver.snapshot().sources, 1)
  guarded.disconnect()
  assert.equal(sync.gain.value, 0); assert.equal(delay.connections.length, 0); assert.equal(sync.connections.length, 0)
  assert.equal(realm.window.__controlledReceiver.snapshot().sources, 0)
  realm.window.__controlledReceiver.close()
  assert.equal(Context.prototype.createMediaStreamSource, original); assert.equal(cleared, true)
})

test('owned PCM replaces only the guarded audible input and releases its adapter on graph teardown',()=>{
  class Node{constructor(){this.connections=[];this.gain={value:1}}connect(node){this.connections.push(node);return node}disconnect(){this.connections=[]}}
  class Context{createMediaStreamSource(){return new Node()}createGain(){return new Node()}}
  const track={},stream={getAudioTracks:()=>[track]},proxy=new Node()
  let closes=0
  const realm={window:{AudioContext:Context,__peers:[{getReceivers:()=>[{track}]}]},GainNode:Node,
    setInterval:()=>1,clearInterval:()=>{},factory:()=>({node:proxy,close:()=>{closes++}})}
  vm.runInNewContext(`(${installControlledReceiver.toString()})(null,null,200,factory,()=>[])`,realm)
  const context=new Context(),source=context.createMediaStreamSource(stream),gate=new Node()
  source.connect(gate)
  assert.equal(source.connections.length,0)
  assert.equal(proxy.connections[0].connections[0].connections[0],gate)
  assert.equal(realm.window.__controlledReceiver.snapshot().sources,1)
  source.disconnect();assert.equal(closes,1);assert.equal(realm.window.__controlledReceiver.snapshot().sources,0)
  realm.window.__controlledReceiver.close()
})
