import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { encodedTimingWorker } from './party-encoded-timing-observer.mjs'

function fixture(videoProbe=null) {
  const allMessages = [], realm = { Number, performance: { timeOrigin: 1000, now: () => 7 },
    TransformStream: class { constructor(transformer) { this.transformer = transformer } },
    postMessage: message => allMessages.push(message),videoProbe }
  realm.self = realm
  vm.runInNewContext('('+encodedTimingWorker.toString()+')(null,null,null,videoProbe)', realm)
  return { realm, get messages(){return allMessages.filter(message=>message.type==='encoded-timing')}, stream: (original,kind='audio') => {realm.__encodedTimingKind=kind;return new realm.TransformStream(original)} }
}
test('timing observation preserves frame identity and delivery without touching encoded payload', () => {
  const f = fixture(), frame = { constructor: { name: 'RTCEncodedVideoFrame' }, timestamp: 1234, type: 'key',
    get data() { throw new Error('Encoded payload must remain unread') },
    getMetadata: () => ({ timestamp: 2345, captureTime: 10, width: 1280, height: 720,
      mimeType: 'video/VP8', privateCredential: 'excluded', dependencies: ['excluded'] }) }
  let delivered
  f.stream({ transform(item, controller) { controller.enqueue(item) } },'video').transformer.transform(frame,
    { enqueue: item => { delivered = item } })
  assert.equal(delivered, frame)
  assert.equal(f.messages[0].values.captureTime, 10)
  assert.equal(f.messages[0].mimeType, 'video/VP8')
  assert.ok(!JSON.stringify(f.messages).includes('excluded'))
})
test('an unsupported or failed metadata read cannot interrupt the original frame transform', () => {
  const f = fixture(), received = []
  const stream = f.stream({ transform(frame, controller) { controller.enqueue(frame) } })
  for (const getMetadata of [() => { throw new Error('Unavailable') }, () => undefined]) {
    const frame = { constructor: { name: 'RTCEncodedAudioFrame' }, getMetadata }
    stream.transformer.transform(frame, { enqueue: item => received.push(item) })
    assert.equal(received.at(-1), frame)
  }
  assert.equal(f.messages.length,2)
  assert.equal(f.messages[0].metadataSupported,false)
  assert.equal(f.messages[1].metadataSupported,true)
})
test('long streams have a fixed metadata message ceiling and forward every frame', () => {
  const f = fixture(), frame = { constructor: { name: 'RTCEncodedAudioFrame' }, timestamp: 1, getMetadata: () => ({}) }
  let delivered = 0
  const stream = f.stream({ transform(frame, controller) { controller.enqueue(frame) } })
  for (let i = 0; i < 5000; i++) stream.transformer.transform(frame, { enqueue: () => delivered++ })
  assert.equal(delivered, 5000)
  assert.equal(f.messages.length, 48)
})

test('a bound copied PCM receiver keeps observing after the sparse timing ceiling without altering forwarded frames',()=>{
  const f=fixture(),frame={timestamp:1,getMetadata:()=>({captureTime:1})}
  let copied=0,forwarded=0
  f.realm.__encodedTimingDirection='receive';f.realm.__observeOwnedPcm=received=>{assert.equal(received,frame);copied++}
  const stream=f.stream({transform(received,controller){controller.enqueue(received)}})
  for(let i=0;i<5000;i++)stream.transformer.transform(frame,{enqueue:received=>{assert.equal(received,frame);forwarded++}})
  assert.equal(copied,5000);assert.equal(forwarded,5000);assert.equal(f.messages.length,48)
})
test('explicit received video capability observation does not stop at sparse metadata sampling or run on senders',()=>{
  let created=0,observed=0,forwarded=0
  const f=fixture(()=>{created++;return {observe(){observed++}}})
  f.realm.__encodedTimingDirection='receive'
  const frame={timestamp:1,getMetadata:()=>({captureTime:1})},stream=f.stream({},'video')
  for(let i=0;i<5000;i++)stream.transformer.transform(frame,{enqueue:()=>forwarded++})
  assert.equal(created,1);assert.equal(observed,5000);assert.equal(forwarded,5000)
  f.realm.__encodedTimingDirection='send';stream.transformer.transform(frame,{enqueue:()=>forwarded++})
  assert.equal(observed,5000);assert.equal(forwarded,5001)
})

import { installEncodedTimingProbe } from './party-encoded-timing-observer.mjs'

function browserFixture(legacy) {
  const workers = []
  class Worker extends EventTarget {
    constructor(url, options) { super(); this.url = url; this.options = options; workers.push(this) }
    postMessage(data, transfers) { this.packet = { data, transfers } }
    terminate() { this.terminated = true }
  }
  class Peer extends EventTarget {
    constructor(configuration) { super(); this.configuration = configuration }
    setConfiguration(configuration) { this.configuration = configuration }
  }
  class Receiver {
    constructor() { this.track = { kind: 'audio' } }
    createEncodedStreams() { return this.streams = { readable: {}, writable: {} } }
  }
  if (!legacy) delete Receiver.prototype.createEncodedStreams
  let nextUrl = 0
  const revoked = [], realm = { URL: class extends URL {
    static createObjectURL() { return 'blob:owned-'+(++nextUrl) }
    static revokeObjectURL(url) { revoked.push(url) }
  }, Blob, RTCRtpReceiver: Receiver, RTCRtpSender: class {},
  RTCRtpScriptTransform: class { constructor(worker, options) { this.worker = worker; this.options = options } },
  location: { href: 'https://owned.test/party', origin: 'https://owned.test' } }
  realm.window = { Worker, RTCPeerConnection: Peer }
  vm.runInNewContext('('+installEncodedTimingProbe.toString()+')("owned worker source")', realm)
  return { realm, workers, revoked, receiver: () => new Receiver(),
    track(peer, receiver) { const event = new Event('track'); event.receiver = receiver; peer.dispatchEvent(event) } }
}

test('dual API probe preserves legacy configuration across SDK updates and observes each receiver once', () => {
  const f = browserFixture(true), peer = new f.realm.window.RTCPeerConnection({ iceTransportPolicy: 'relay' }), receiver = f.receiver()
  assert.equal(peer.configuration.encodedInsertableStreams, true)
  peer.setConfiguration({ iceTransportPolicy: 'all' })
  assert.equal(peer.configuration.encodedInsertableStreams, true)
  assert.equal(peer.configuration.iceTransportPolicy, 'all')
  f.track(peer, receiver); f.track(peer, receiver)
  assert.equal(f.workers.length, 1)
  assert.equal(receiver.transform, undefined)
  assert.equal(f.workers[0].packet.data.readable, receiver.streams.readable)
  assert.deepEqual(Array.from(f.workers[0].packet.transfers), [receiver.streams.readable, receiver.streams.writable])
  assert.equal(f.realm.window.__encodedTimingProbe.errors, 0)
  f.realm.window.__encodedTimingProbe.close()
  assert.equal(f.workers[0].terminated, true)
  assert.deepEqual(f.revoked, ['blob:owned-1'])
})

test('standard-only probe retains native configuration and existing transforms cannot be overwritten', () => {
  const f = browserFixture(false), configuration = { iceTransportPolicy: 'relay' },
    peer = new f.realm.window.RTCPeerConnection(configuration), receiver = f.receiver()
  assert.equal(peer.configuration, configuration)
  f.track(peer, receiver)
  assert.equal(receiver.transform.worker, f.workers[0])
  assert.equal(receiver.transform.options.kind, 'audio')
  const occupied = f.receiver(), transform = {}
  occupied.transform = transform
  f.track(peer, occupied)
  assert.equal(occupied.transform, transform)
  assert.equal(f.realm.window.__encodedTimingProbe.failures.occupied, 1)
  assert.equal(f.workers.length, 1)
})
test('received video decoder diagnostics allowlist scalars and cap frames and generations',()=>{
  const f=browserFixture(true),peer=new f.realm.window.RTCPeerConnection(),receiver=f.receiver()
  f.track(peer,receiver)
  const records=Array.from({length:10},(_,timestamp)=>({timestamp,width:1280,height:720,privatePayload:'excluded'}))
  for(let i=0;i<10;i++)f.workers[0].dispatchEvent(new MessageEvent('message',{data:{type:'encoded-video-decode',
    status:'complete',reason:null,inputCount:8,decodedCount:8,maximumBytes:99,records,privateCredential:'excluded'}}))
  const rows=f.realm.window.__encodedTimingProbe.videoDecoders
  assert.equal(rows.length,8);assert.ok(rows.every(row=>row.records.length===8))
  assert.equal(rows[0].records[0].width,1280);assert.ok(!JSON.stringify(rows).includes('excluded'))
  f.realm.window.__encodedTimingProbe.close()
})


test('sparse capture timestamps receive a bounded sample window without reading payloads or dropping frames', () => {
  const f = fixture()
  let count = 0, delivered = 0
  const stream = f.stream({ transform(frame, controller) { controller.enqueue(frame) } })
  const frame = { timestamp: 1, get data() { throw new Error('Do not read payload') },
    getMetadata: () => (++count > 300 ? { captureTime: count } : {}) }
  for (let i = 0; i < 5000; i++) stream.transformer.transform(frame, { enqueue: () => delivered++ })
  assert.equal(delivered, 5000)
  assert.equal(f.messages.length, 56)
  assert.deepEqual(f.messages.filter(row => row.count > 300 && row.count < 400).map(row => row.values.captureTime),
    [301, 302, 303, 304, 305, 306, 307, 308])
})
