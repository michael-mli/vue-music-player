import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { encodedTimingWorker } from './party-encoded-timing-observer.mjs'
import { createVideoReferenceEnvelope } from './party-video-reference-envelope.mjs'

function fixture(videoProbe=null,createReferences=null) {
  const allMessages = [], realm = { Number, performance: { timeOrigin: 1000, now: () => 7 },
    TransformStream: class { constructor(transformer) { this.transformer = transformer } },
    postMessage: message => allMessages.push(message),videoProbe,createReferences }
  realm.self = realm
  vm.runInNewContext('('+encodedTimingWorker.toString()+')(null,null,null,videoProbe,createReferences)', realm)
  return { realm, allMessages,get messages(){return allMessages.filter(message=>message.type==='encoded-timing')}, stream: (original,kind='audio') => {realm.__encodedTimingKind=kind;return new realm.TransformStream(original)} }
}
test('explicit source envelopes round trip before lease/native delivery without claiming native receiver references',()=>{
  const send=fixture(null,createVideoReferenceEnvelope),receive=fixture(null,createVideoReferenceEnvelope)
  send.realm.__encodedTimingDirection='send';receive.realm.__encodedTimingDirection='receive'
  const body=new Uint8Array([0,0,0,0x9d,1,0x2a,0,5,0xd0,2,5,6])
  const frame={type:'key',timestamp:1,data:body.slice().buffer,getMetadata:()=>({frameId:1,dependencies:[],captureTime:5})}
  let encoded,decoded,owned
  send.stream({},'video').transformer.transform(frame,{enqueue:f=>{encoded=f.data.byteLength}})
  assert.equal(encoded,body.byteLength+30)
  frame.getMetadata=()=>({captureTime:6,payloadType:96})
  receive.realm.__observeOwnedVideo=(f,metadata)=>{owned=metadata;assert.deepEqual(new Uint8Array(f.data),body)}
  receive.stream({},'video').transformer.transform(frame,{enqueue:f=>{decoded=f.data.byteLength}})
  assert.equal(decoded,body.byteLength);assert.equal(owned.sourceReferences,true)
  assert.equal(owned.frameId,1);assert.equal(owned.captureTime,6)
  assert.equal(receive.messages[0].values.frameIdPresent,0)
  const state=receive.allMessages.find(row=>row.type==='video-reference-state')
  assert.equal(state.unwrapped,1);assert.equal(state.wireBytes,state.payloadBytes+state.overheadBytes)
})
test('invalid explicit envelopes close the stream and owned decoder without forwarding malformed bytes or secrets',()=>{
  const f=fixture(null,createVideoReferenceEnvelope);f.realm.__encodedTimingDirection='receive'
  let forwarded=0,closed=0,error
  f.realm.__failOwnedVideoReference=()=>closed++
  const frame={type:'key',data:new Uint8Array(20).buffer,getMetadata:()=>({secret:'secret-token'})}
  const stream=f.stream({},'video'),controller={enqueue:()=>forwarded++,error:e=>{error=e.message}}
  stream.transformer.transform(frame,controller);stream.transformer.transform(frame,controller)
  assert.equal(forwarded,0);assert.equal(closed,1);assert.equal(error,'VIDEO_ENVELOPE_INPUT')
  assert.equal(JSON.stringify(f.allMessages).includes('secret-token'),false)
})
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

function browserFixture(legacy,api='native') {
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
  }, Blob, performance:{now:()=>7}, RTCRtpReceiver: Receiver, RTCRtpSender: class {},
  RTCRtpScriptTransform: class { constructor(worker, options) { this.worker = worker; this.options = options } },
  location: { href: 'https://owned.test/party', origin: 'https://owned.test' } }
  realm.window = { Worker, RTCPeerConnection: Peer }
  vm.runInNewContext('('+installEncodedTimingProbe.toString()+')("owned worker source",'+JSON.stringify(api)+')', realm)
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
test('explicit standard receiver selection avoids legacy streams when both native APIs exist',()=>{
  const f=browserFixture(true,'standard'),configuration={iceTransportPolicy:'relay'},
    peer=new f.realm.window.RTCPeerConnection(configuration),receiver=f.receiver()
  f.track(peer,receiver);f.track(peer,receiver)
  assert.equal(peer.configuration.encodedInsertableStreams,true);assert.equal(peer.configuration.iceTransportPolicy,'relay')
  assert.equal(receiver.streams,undefined)
  assert.equal(receiver.transform.worker,f.workers[0]);assert.equal(f.workers.length,1)
  assert.equal(f.realm.window.__encodedTimingProbe.features.receiverApi,'standard')
  f.realm.window.__encodedTimingProbe.close()
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

test('owned decoder state retains only declared codec enums and bounded numeric diagnostics',()=>{
  const f=browserFixture(true),peer=new f.realm.window.RTCPeerConnection(),receiver=f.receiver()
  f.track(peer,receiver)
  for(const codec of ['vp9','credential-url'])f.workers[0].dispatchEvent(new MessageEvent('message',{data:{
    type:'video-port-state',codec,configured:true,closed:false,decoded:25,reason:null,privatePayload:'excluded'}}))
  const rows=f.realm.window.__encodedTimingProbe.videoStates
  assert.equal(rows[0].codec,'vp9');assert.equal(rows[1].codec,undefined)
  assert.equal(rows[0].decoded,25);assert.ok(!/excluded|credential/.test(JSON.stringify(rows)))
  f.realm.window.__encodedTimingProbe.close()
})
test('owned marker and PCM pressure diagnostics retain only validated scalar counters',()=>{
  const f=browserFixture(true),peer=new f.realm.window.RTCPeerConnection(),receiver=f.receiver()
  f.track(peer,receiver)
  f.workers[0].dispatchEvent(new MessageEvent('message',{data:{type:'video-port-state',markerProbe:{
    reads:100,invalid:2,transitions:5,regressions:1,privatePixels:'excluded'},privatePayload:'excluded'}}))
  f.workers[0].dispatchEvent(new MessageEvent('message',{data:{type:'pcm-port-state',pressureDrains:3,privatePayload:'excluded'}}))
  const probe=f.realm.window.__encodedTimingProbe
  assert.deepEqual({...probe.videoStates[0].markerProbe},{reads:100,invalid:2,transitions:5,regressions:1})
  assert.equal(probe.pcmStates[0].pressureDrains,3)
  assert.equal(JSON.stringify([...probe.videoStates,...probe.pcmStates]).includes('excluded'),false)
  for(const markerProbe of [null,{}, {reads:3,invalid:4,transitions:0,regressions:0},
    {reads:3,invalid:0,transitions:4,regressions:0},{reads:3,invalid:0,transitions:2,regressions:3},
    {reads:3.5,invalid:0,transitions:0,regressions:0}])
    f.workers[0].dispatchEvent(new MessageEvent('message',{data:{type:'video-port-state',markerProbe}}))
  assert.equal(probe.videoStates.filter(row=>row.markerProbeError==='VIDEO_MARKER_DIAGNOSTIC').length,6)
  assert.equal(probe.errors,6);f.realm.window.__encodedTimingProbe.close()
})
test('PCM group diagnostics exclude payloads and reject impossible group bounds or accounting',()=>{
  const f=browserFixture(true),peer=new f.realm.window.RTCPeerConnection(),receiver=f.receiver()
  f.track(peer,receiver)
  const values={type:'pcm-port-state',decoded:10,batchPackets:2,groupedChunks:4,maximumGroupPackets:2,pendingGroupPackets:1,planes:'excluded'}
  const emit=data=>f.workers[0].dispatchEvent(new MessageEvent('message',{data}))
  emit(values)
  const probe=f.realm.window.__encodedTimingProbe
  assert.equal(probe.pcmStates[0].groupedChunks,4);assert.equal(probe.pcmStates[0].groupingError,undefined)
  assert.equal(JSON.stringify(probe.pcmStates).includes('excluded'),false)
  for(const change of [{batchPackets:3},{groupedChunks:6},{maximumGroupPackets:3},
    {pendingGroupPackets:2},{decoded:undefined},{batchPackets:1,maximumGroupPackets:1,pendingGroupPackets:0}])
    emit({...values,...change})
  assert.equal(probe.pcmStates.filter(row=>row.groupingError==='PCM_GROUP_DIAGNOSTIC').length,6)
  assert.equal(probe.errors,6);probe.close()
})

test('codec concealment diagnostics expose scalar bounds and reject impossible backend or gap accounting',()=>{
  const f=browserFixture(true),peer=new f.realm.window.RTCPeerConnection(),receiver=f.receiver();f.track(peer,receiver)
  const emit=data=>f.workers[0].dispatchEvent(new MessageEvent('message',{data}))
  const valid={type:'pcm-port-state',configured:true,closed:false,decoderBackend:'libopus',decoded:20,gaps:1920,
    concealedPackets:2,concealedSamples:1920,codecBytes:524288,privatePcm:'excluded'}
  emit(valid)
  const probe=f.realm.window.__encodedTimingProbe,row=probe.pcmStates[0]
  assert.equal(row.decoderBackend,'libopus');assert.equal(row.concealedSamples,1920)
  assert.equal(row.codecBytes,524288);assert.equal(row.concealmentError,undefined)
  for(const change of [{decoderBackend:'credential-url'},{codecBytes:1048576},{codecBytes:0},
    {concealedPackets:21},{concealedSamples:1921},{decoderBackend:'webcodecs'}])emit({...valid,...change})
  assert.equal(probe.pcmStates.filter(row=>row.concealmentError==='PCM_PLC_DIAGNOSTIC').length,6)
  assert.equal(JSON.stringify(probe.pcmStates).includes('excluded'),false)
  emit({...valid,closed:true,codecBytes:0});assert.equal(probe.pcmStates.at(-1).concealmentError,undefined)
  probe.close()
})

test('native-buffer copy diagnostics retain only the fixed scale/window/quota and reject invented reservations',()=>{
  const f=browserFixture(true),peer=new f.realm.window.RTCPeerConnection(),receiver=f.receiver();f.track(peer,receiver)
  const emit=data=>f.workers[0].dispatchEvent(new MessageEvent('message',{data}))
  const valid={type:'pcm-port-state',creditScale:2,copyReservationBytes:46080,pcmLimitBytes:1002496,groupCopyFallbacks:3,
    pcmBytes:300000,maximumBytes:400000,privateBuffer:'excluded'}
  emit(valid);const probe=f.realm.window.__encodedTimingProbe
  assert.equal(probe.pcmStates[0].creditScale,2);assert.equal(probe.pcmStates[0].copyReservationError,undefined)
  assert.equal(probe.pcmStates[0].groupCopyFallbacks,3)
  for(const change of [{creditScale:3},{copyReservationBytes:0},{pcmLimitBytes:1048576},
    {pcmBytes:1002497},{maximumBytes:1048577}])emit({...valid,...change})
  assert.equal(probe.pcmStates.filter(row=>row.copyReservationError==='PCM_COPY_DIAGNOSTIC').length,5)
  assert.equal(JSON.stringify(probe.pcmStates).includes('excluded'),false);probe.close()
})

test('declared VP9 receiver codec parameters reach the worker without fmtp or unknown codec fields',()=>{
  for(const api of ['native','standard']){
    const f=browserFixture(true,api),peer=new f.realm.window.RTCPeerConnection(),receiver=f.receiver()
    receiver.track.kind='video';receiver.getParameters=()=>({codecs:[
      {payloadType:98,mimeType:'video/VP9',sdpFmtpLine:'private-secret'},
      {payloadType:99,mimeType:'video/unknown',privateKey:'excluded'}]})
    f.track(peer,receiver)
    const codecs=api==='standard'?receiver.transform.options.codecs:f.workers[0].packet.data.codecs
    assert.equal(codecs.length,1);assert.equal(codecs[0].mimeType,'video/vp9');assert.equal(codecs[0].payloadType,98)
    assert.ok(!/private|secret|excluded|unknown/.test(JSON.stringify(codecs)))
    f.realm.window.__encodedTimingProbe.close()
  }
})

test('video dependency capability reports bounded counts without retaining reference IDs',()=>{
  const f=fixture(),stream=f.stream({},'video')
  const frame={timestamp:1,type:'delta',getMetadata:()=>({frameId:900,dependencies:[700,800]})}
  stream.transformer.transform(frame,{enqueue(){}})
  assert.equal(f.messages[0].values.frameIdPresent,1);assert.equal(f.messages[0].values.dependencyCount,2)
  assert.ok(!/700|800|900/.test(JSON.stringify(f.messages)))
  frame.getMetadata=()=>({frameId:-1,dependencies:Array(9).fill(1)})
  stream.transformer.transform(frame,{enqueue(){}})
  assert.equal(f.messages[1].values.frameIdPresent,0);assert.equal(f.messages[1].values.dependencyCount,undefined)
})
