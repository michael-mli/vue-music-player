import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { setImmediate as tick } from 'node:timers/promises'
import { createOpusPcmStream } from './party-opus-pcm-stream.mjs'
import { primaryOpusPayload, opusPacketFrames } from './party-opus-decode-probe.mjs'
import { CapturePcmQueue } from './party-capture-pcm-queue.mjs'

function fixture({delayed=false,invalid=false}={}) {
  const messages=[],packets=[],outputs=[],waiting=[]
  let decoder
  class Decoder {
    static async isConfigSupported(config) {return {supported:true,config}}
    constructor(callbacks) {this.callbacks=callbacks;this.state='configured';decoder=this}
    configure() {}
    decode(chunk) {
      const frame={sampleRate:48000,timestamp:chunk.timestamp,numberOfFrames:960,numberOfChannels:2,
        duration:20000,closes:0,close(){this.closes++},copyTo(plane,{planeIndex,format}) {
          assert.equal(format,'f32-planar');plane.fill(invalid?NaN:planeIndex?-.25:.25)
        }}
      outputs.push(frame)
      if(delayed)waiting.push(frame);else this.callbacks.output(frame)
    }
    close(){this.state='closed'}
  }
  const realm={Number,ArrayBuffer,Float32Array,Uint8Array,Map,Array,performance:{timeOrigin:1000},
    AudioDecoder:Decoder,EncodedAudioChunk:class{constructor(config){Object.assign(this,config)}},
    __encodedTimingCodecs:[{payloadType:111,mimeType:'audio/opus'},{payloadType:63,mimeType:'audio/red'}],deliver:packet=>packets.push(packet),report:row=>messages.push(row)}
  realm.self=realm
  const stream=vm.runInNewContext(`(${createOpusPcmStream.toString()})(${primaryOpusPayload.toString()},${opusPacketFrames.toString()},deliver,report)`,realm)
  const send=(rtp,captureTime=rtp/48)=>stream.observe({timestamp:rtp>>>0,data:new Uint8Array([1]).buffer},{captureTime,payloadType:111})
  return {stream,send,packets,messages,outputs,waiting,flush(){while(waiting.length)decoder.callbacks.output(waiting.shift())}}
}

function red(offsets){return new Uint8Array([...offsets.flatMap(offset=>[239,offset>>6,(offset&63)<<2,1]),111,
  ...offsets.map(()=>1),1])}
test('RED recovers two missing primary packets in RTP order and excludes pre-start or duplicate history',async()=>{
  const f=fixture();await tick();f.send(0)
  f.stream.observe({timestamp:2880,data:red([960,1920]).buffer},{captureTime:60,payloadType:63})
  assert.deepEqual(f.packets.map(packet=>packet.rtpTimestamp),[0,960,1920,2880])
  assert.equal(f.stream.snapshot().recovered,2);assert.equal(f.stream.snapshot().gaps,0)
  f.stream.observe({timestamp:3840,data:red([1920,960]).buffer},{captureTime:80,payloadType:63})
  assert.equal(f.packets.length,5);assert.equal(f.stream.snapshot().recovered,2)
  f.stream.close()
  const first=fixture();await tick()
  first.stream.observe({timestamp:1920,data:red([1920,960]).buffer},{captureTime:40,payloadType:63})
  assert.equal(first.packets.length,1);assert.equal(first.packets[0].rtpTimestamp,1920);first.stream.close()
})
test('RED recovery across RTP wrap preserves credits; overlapping repair or bounded overflow closes safely',async()=>{
  const f=fixture();await tick();const start=0xfffffe00;f.send(start,0)
  f.stream.observe({timestamp:(start+1920)>>>0,data:red([960]).buffer},{captureTime:40,payloadType:63})
  assert.equal(f.stream.snapshot().recovered,1);assert.equal(f.stream.snapshot().gaps,0)
  assert.equal(f.packets[1].rtpTimestamp,(start+960)>>>0);f.stream.close()
  const bad=fixture();await tick();bad.send(0)
  bad.stream.observe({timestamp:1920,data:red([480]).buffer},{captureTime:40,payloadType:63})
  assert.equal(bad.messages[0].reason,'PCM_PACKET');assert.equal(bad.stream.snapshot().pcmBytes,0)
  const full=fixture();await tick();for(let i=0;i<47;i++)full.send(i*960)
  full.stream.observe({timestamp:49*960,data:red([1920,960]).buffer},{captureTime:980,payloadType:63})
  assert.equal(full.messages[0].reason,'PCM_BOUND');assert.equal(full.stream.snapshot().pcmBytes,0)
})
test('decoded PCM retains an RTP sample clock despite jittery capture headers and closes every native frame',async()=>{
  const f=fixture();await tick()
  for(let i=0;i<10;i++)f.send(i*960,i*20+(i%2?6:0))
  assert.equal(f.packets.length,10)
  assert.equal(f.packets[1].captureUnixMs,1020);assert.equal(f.packets[1].observedCaptureUnixMs,1026)
  assert.equal(f.packets[1].planes[0][0],.25);assert.equal(f.packets[1].planes[1][0],-.25)
  assert.ok(f.outputs.every(frame=>frame.closes===1))
  for(const packet of f.packets)f.stream.consumed({id:packet.id,bytes:packet.planes.reduce((n,p)=>n+p.byteLength,0)})
  assert.equal(f.stream.snapshot().pcmBytes,0);assert.equal(f.stream.snapshot().encodedBytes,0)
  f.stream.close();assert.equal(f.messages.length,1)
})
test('capture continuity uses advancing anchors while continuous PCM retains a bounded independent schedule',async()=>{
  const f=fixture();await tick()
  for(let i=0;i<40;i++){
    f.send(i*960,i*20+i*3)
    const packet=f.packets.at(-1)
    assert.equal(packet.captureUnixMs,1000+i*20)
    f.stream.consumed({id:packet.id,bytes:7680})
  }
  assert.equal(f.stream.snapshot().closed,false)
  assert.equal(f.stream.snapshot().maximumResidualMs,3)
  assert.equal(f.stream.snapshot().captureOffsetMs,117)
  assert.equal(f.stream.snapshot().lastCaptureUnixMs,1897)
  f.send(40*960,800+117+81)
  assert.equal(f.messages[0].reason,'PCM_CLOCK')
  const drift=fixture();await tick()
  for(let i=0;i<70;i++){
    drift.send(i*960,i*23)
    const packet=drift.packets.at(-1)
    if(!drift.stream.snapshot().closed)drift.stream.consumed({id:packet.id,bytes:7680})
  }
  assert.equal(drift.messages[0].reason,'PCM_CLOCK')
  assert.equal(drift.stream.snapshot().maximumResidualMs,3)
  assert.equal(drift.stream.snapshot().maximumOffsetMs,201)
})
test('renderer consumes stream credits across RTP wrap and renders missing packets as silence',async()=>{
  const f=fixture();await tick()
  const initial=0xfffffe00
  f.send(initial,0);f.send((initial+1920)>>>0,40)
  const queue=new CapturePcmQueue(48000,credit=>f.stream.consumed(credit))
  for(const packet of f.packets)queue.push({id:packet.id,startFrame:Math.round((packet.captureUnixMs-1000)*48),planes:packet.planes})
  const planes=[new Float32Array(2880),new Float32Array(2880)]
  queue.render(0,planes)
  assert.ok(planes[0].slice(0,960).every(sample=>sample===.25))
  assert.ok(planes[0].slice(960,1920).every(sample=>sample===0))
  assert.ok(planes[1].slice(1920).every(sample=>sample===-.25))
  assert.equal(f.stream.snapshot().gaps,960);assert.equal(f.stream.snapshot().chunks,0)
  f.stream.close()
})
test('stalled decoding or rendering stays bounded and cannot reopen after overflow',async()=>{
  for(const delayed of [false,true]) {
    const f=fixture({delayed});await tick()
    for(let i=0;i<49;i++)f.send(i*960)
    assert.equal(f.messages[0].reason,'PCM_BOUND')
    assert.equal(f.stream.snapshot().maximumChunks,48)
    assert.equal(f.stream.snapshot().pcmBytes,0);assert.equal(f.stream.snapshot().encodedBytes,0)
    f.flush();assert.ok(f.outputs.every(frame=>frame.closes===1))
    const count=f.packets.length;f.send(49*960);assert.equal(f.packets.length,count)
  }
})
test('duplicate packets never read payload; invalid clocks, PCM and forged credits fail closed',async()=>{
  const f=fixture();await tick();f.send(960,0)
  f.stream.observe({timestamp:960,get data(){throw new Error('duplicate payload must not be read')}},{captureTime:0})
  assert.equal(f.stream.snapshot().duplicates,1)
  f.send(1920,101);assert.equal(f.messages[0].reason,'PCM_CLOCK')
  const malformed=fixture({invalid:true});await tick();malformed.send(0)
  assert.equal(malformed.messages[0].reason,'PCM_OUTPUT');assert.equal(malformed.outputs[0].closes,1)
  const credit=fixture();await tick();credit.send(0)
  credit.stream.consumed({id:1,bytes:1});assert.equal(credit.messages[0].reason,'PCM_CREDIT')
})
