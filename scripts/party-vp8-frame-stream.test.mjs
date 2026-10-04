import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {setImmediate as tick} from 'node:timers/promises'
import {createVp8FrameStream} from './party-vp8-frame-stream.mjs'

async function fixture({hold=false,accept=true}={}){
  const delivered=[],frames=[],reports=[],waiting=[]
  let now=1000,decoder
  class Decoder{
    static async isConfigSupported(config){return {supported:true,config}}
    constructor(callbacks){this.callbacks=callbacks;this.state='configured';decoder=this}
    configure(){}close(){this.state='closed'}
    decode(chunk){const frame={timestamp:chunk.timestamp,codedWidth:1280,codedHeight:720,displayWidth:1280,displayHeight:720,
      closes:0,allocationSize:()=>1280*720*3/2,close(){this.closes++}}
      frames.push(frame);if(hold)waiting.push(frame);else this.callbacks.output(frame)}
  }
  const realm={ArrayBuffer,performance:{timeOrigin:10000,now:()=>now},VideoDecoder:Decoder,
    EncodedVideoChunk:class{constructor(config){Object.assign(this,config)}},
    __encodedTimingCodecs:[{payloadType:96,mimeType:'video/vp8'}],deliver:(frame,packet)=>{if(accept)delivered.push({frame,...packet});return accept},report:row=>reports.push(row)}
  realm.self=realm
  const stream=vm.runInNewContext(`(${createVp8FrameStream.toString()})(deliver,report)`,realm)
  await tick()
  const send=(rtp,captureTime=rtp/90,type=frames.length?'delta':'key')=>stream.observe(
    {timestamp:rtp>>>0,type,data:new Uint8Array([7]).buffer},{captureTime,payloadType:96})
  return {stream,send,delivered,frames,reports,waiting,advance(value){now=value},
    flush(){while(waiting.length)decoder.callbacks.output(waiting.shift())}}
}
test('continuous VP8 warms its decoder without capture headers then transfers associated bounded frames across RTP wrap',async()=>{
  const f=await fixture();const start=0xfffffe00
  f.send(start,NaN);assert.equal(f.frames[0].closes,1);assert.equal(f.delivered.length,0)
  f.send((start+3600)>>>0,40);assert.equal(f.delivered[0].captureUnixMs,10040)
  assert.equal(f.delivered[0].frame.closes,0);f.delivered[0].frame.close()
  f.send((start+7200)>>>0,80);f.delivered[1].frame.close()
  assert.equal(f.stream.snapshot().decoded,3);assert.equal(f.stream.snapshot().discarded,1)
  assert.equal(f.stream.snapshot().encodedBytes,0);f.stream.close()
})
test('a full transfer port can drop presentation while decoding every input and closing untransferred frames',async()=>{
  const f=await fixture({accept:false})
  for(let i=0;i<100;i++)f.send(i*3600)
  assert.equal(f.stream.snapshot().decoded,100);assert.equal(f.stream.snapshot().discarded,100)
  assert.ok(f.frames.every(frame=>frame.closes===1));assert.equal(f.stream.snapshot().maximumPending,1)
  f.stream.close()
})
test('stalled native decoding has at most four pending frames and fails closed without resurrection',async()=>{
  const f=await fixture({hold:true});for(let i=0;i<5;i++)f.send(i*3600)
  assert.equal(f.reports[0].reason,'VIDEO_BOUND');assert.equal(f.stream.snapshot().maximumPending,4)
  assert.equal(f.stream.snapshot().encodedBytes,0);f.flush()
  assert.ok(f.frames.every(frame=>frame.closes===1));f.send(18000);assert.equal(f.frames.length,4)
})
test('late duplicates do not read payload or refresh capture evidence; clock jumps and stale capture fail safely',async()=>{
  const f=await fixture({accept:false});f.send(0)
  f.stream.observe({timestamp:0,type:'delta',get data(){throw new Error('duplicate read')}},{payloadType:96,captureTime:500})
  assert.equal(f.stream.snapshot().closed,false)
  f.advance(7001);f.send(3600,NaN);assert.equal(f.stream.snapshot().discarded,3)
  f.send(7200,161);assert.equal(f.reports[0].reason,'VIDEO_CLOCK')
})
