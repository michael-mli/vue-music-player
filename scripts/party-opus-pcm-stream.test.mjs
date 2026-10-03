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
    __encodedTimingCodecs:[{payloadType:111,mimeType:'audio/opus'}],deliver:packet=>packets.push(packet),report:row=>messages.push(row)}
  realm.self=realm
  const stream=vm.runInNewContext(`(${createOpusPcmStream.toString()})(${primaryOpusPayload.toString()},${opusPacketFrames.toString()},deliver,report)`,realm)
  const send=(rtp,captureTime=rtp/48)=>stream.observe({timestamp:rtp>>>0,data:new Uint8Array([1]).buffer},{captureTime,payloadType:111})
  return {stream,send,packets,messages,outputs,waiting,flush(){while(waiting.length)decoder.callbacks.output(waiting.shift())}}
}
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
