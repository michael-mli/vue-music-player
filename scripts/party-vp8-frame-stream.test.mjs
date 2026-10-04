import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {setImmediate as tick} from 'node:timers/promises'
import {createVp8FrameStream} from './party-vp8-frame-stream.mjs'

async function fixture({hold=false,accept=true,reorderMs=0,format='I420',gapAware=false}={}){
  const delivered=[],frames=[],reports=[],waiting=[]
  let now=1000,decoder,timerId=0
  let acceptance=accept
  const timers=new Map()
  class Decoder{
    static async isConfigSupported(config){return {supported:true,config}}
    constructor(callbacks){this.callbacks=callbacks;this.state='configured';decoder=this}
    configure(){}close(){this.state='closed'}
    decode(chunk){const frame={timestamp:chunk.timestamp,codedWidth:1280,codedHeight:720,displayWidth:1280,displayHeight:720,
      format,closes:0,allocationSize:()=>1280*720*3/2,close(){this.closes++}}
      frames.push(frame);if(hold)waiting.push(frame);else this.callbacks.output(frame)}
  }
  const realm={ArrayBuffer,performance:{timeOrigin:10000,now:()=>now},VideoDecoder:Decoder,
    EncodedVideoChunk:class{constructor(config){Object.assign(this,config)}},
    __encodedTimingCodecs:[{payloadType:96,mimeType:'video/vp8'}],deliver:(frame,packet)=>{if(acceptance===true)delivered.push({frame,...packet});return acceptance},report:row=>reports.push(row),reorderMs,gapAware,
    setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,at:now+delay});return id},clearTimeout(id){timers.delete(id)}}
  realm.self=realm
  const stream=vm.runInNewContext(`(${createVp8FrameStream.toString()})(deliver,report,{reorderMs,gapAware})`,realm)
  await tick()
  const send=(rtp,captureTime=rtp/90,type=frames.length?'delta':'key')=>stream.observe(
    {timestamp:rtp>>>0,type,data:new Uint8Array([7]).buffer},{captureTime,payloadType:96})
  return {stream,send,delivered,frames,reports,waiting,timers,setAccept(value){acceptance=value},advance(value){now=value;for(const [id,timer]of[...timers])if(timer.at<=now){timers.delete(id);timer.callback()}},
    flush(){while(waiting.length)decoder.callbacks.output(waiting.shift())}}
}
test('gap-only repair decodes contiguous RTP immediately and drains repaired history before its fixed deadline',async()=>{
  const f=await fixture({gapAware:true,reorderMs:700,accept:false}),start=0xfffffe00
  f.send(start,0);f.send((start+3600)>>>0,40);assert.equal(f.stream.snapshot().decoded,2)
  f.send((start+10800)>>>0,120);f.advance(1600);assert.equal(f.stream.snapshot().decoded,2)
  f.send((start+7200)>>>0,80)
  assert.deepEqual(f.frames.map(frame=>frame.timestamp),[0,40000,80000,120000])
  assert.equal(f.stream.snapshot().committedGaps,0);assert.equal(f.timers.size,0);f.stream.close()
})
test('gap expiry commits once and later packets cannot extend its original deadline',async()=>{
  const f=await fixture({gapAware:true,reorderMs:700,accept:false});f.send(0);f.send(7200)
  f.advance(1699);f.send(10800);assert.equal(f.stream.snapshot().decoded,1)
  f.advance(1700);assert.equal(f.stream.snapshot().decoded,3)
  assert.equal(f.stream.snapshot().committedGaps,1);assert.equal(f.timers.size,0);f.stream.close()
})
test('transfer congestion parks at most four decoded frames in the existing reservation then resumes in RTP order',async()=>{
  const f=await fixture({accept:'wait',reorderMs:80});for(let i=0;i<5;i++)f.send(i*3600)
  f.advance(1080);assert.equal(f.stream.snapshot().pending,4);assert.equal(f.stream.snapshot().maximumReady,4)
  assert.equal(f.stream.snapshot().heldPackets,1);assert.equal(f.delivered.length,0)
  f.setAccept(true);f.stream.resume()
  assert.deepEqual(f.delivered.map(frame=>frame.rtpTimestamp),[0,3600,7200,10800,14400])
  assert.equal(f.stream.snapshot().pending,0);assert.equal(f.stream.snapshot().encodedBytes,0)
  for(const packet of f.delivered)packet.frame.close();f.stream.close()
  assert.ok(f.frames.every(frame=>frame.closes===1))
  const stopped=await fixture({accept:'wait',reorderMs:80});for(let i=0;i<4;i++)stopped.send(i*3600)
  stopped.advance(1080);stopped.stream.close();stopped.setAccept(true);stopped.stream.resume()
  assert.equal(stopped.delivered.length,0);assert.ok(stopped.frames.every(frame=>frame.closes===1))
})
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
test('owned decoder rejects larger or unknown frame formats before transferring ownership',async()=>{
  for(const format of ['RGBA',null]){
    const f=await fixture({format});f.send(0)
    assert.equal(f.reports[0].reason,'VIDEO_OUTPUT')
    assert.equal(f.delivered.length,0);assert.equal(f.frames[0].closes,1)
  }
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
test('video reorder window decodes earlier RTP first without extending the first arrival deadline',async()=>{
  const f=await fixture({reorderMs:80,accept:false});const start=0xfffffe00
  f.send(start,0);f.send((start+7200)>>>0,80)
  f.advance(1060);f.send((start+3600)>>>0,40)
  assert.equal(f.stream.snapshot().decoded,1);f.advance(1079);assert.equal(f.stream.snapshot().decoded,1)
  f.advance(1080);assert.equal(f.stream.snapshot().decoded,3)
  assert.equal(f.frames[1].timestamp,40000);assert.equal(f.frames[2].timestamp,80000)
  assert.equal(f.stream.snapshot().reordered,1);assert.equal(f.stream.snapshot().maximumHeld,2)
  assert.equal(f.stream.snapshot().encodedBytes,0);assert.equal(f.timers.size,0)
  f.stream.close()
})
test('reorder queue and shared encoded budget stay bounded, release on stop, and distinguish unseen late frames',async()=>{
  const f=await fixture({reorderMs:80,accept:false,hold:true});f.send(0)
  for(let i=1;i<13;i++)f.send(i*3600)
  assert.equal(f.reports[0].reason,'VIDEO_BOUND');assert.equal(f.stream.snapshot().maximumHeld,8)
  assert.equal(f.stream.snapshot().encodedBytes,0);assert.equal(f.timers.size,0)
  const late=await fixture({reorderMs:80,accept:false});late.send(0);late.send(7200)
  late.advance(1080);late.send(3600);late.send(3600)
  assert.equal(late.stream.snapshot().lateFrames,1);assert.equal(late.stream.snapshot().duplicates,1)
  late.send(10800);late.stream.close();late.advance(1200)
  assert.equal(late.stream.snapshot().decoded,2);assert.equal(late.timers.size,0)
})
test('a burst drains oldest RTP under pressure without a ninth retained copy or a later deadline',async()=>{
  const f=await fixture({reorderMs:240,accept:false});f.send(0)
  for(let i=1;i<=9;i++)f.send(i*3600)
  assert.equal(f.stream.snapshot().closed,false)
  assert.equal(f.stream.snapshot().maximumHeld,8)
  assert.equal(f.stream.snapshot().pressureDrains,1)
  assert.equal(f.frames[1].timestamp,40000)
  f.advance(1239);assert.equal(f.stream.snapshot().decoded,2)
  f.advance(1240);assert.equal(f.stream.snapshot().decoded,10)
  assert.equal(f.stream.snapshot().encodedBytes,0);assert.equal(f.timers.size,0)
  f.stream.close()
})
test('longer playout can retain 180-ms repairs without extending its 240-ms encoded window',async()=>{
  const f=await fixture({reorderMs:240,accept:false});f.send(0);f.send(18000)
  f.advance(1180);for(let i=1;i<5;i++)f.send(i*3600)
  f.advance(1239);assert.equal(f.stream.snapshot().decoded,1)
  f.advance(1240);assert.equal(f.stream.snapshot().decoded,6)
  assert.deepEqual(f.frames.map(frame=>frame.timestamp),[0,40000,80000,120000,160000,200000])
  assert.equal(f.stream.snapshot().lateFrames,0);assert.equal(f.stream.snapshot().maximumHeld,5)
  assert.equal(f.stream.snapshot().reorderMs,240);f.stream.close()
})
test('an extended repair window retains a 350-ms reordered burst within the same encoded byte budget',async()=>{
  const f=await fixture({reorderMs:500,accept:false});f.send(0);f.send(16*3600)
  f.advance(1350);for(let i=1;i<16;i++)f.send(i*3600)
  assert.equal(f.stream.snapshot().heldPackets,16);assert.equal(f.stream.snapshot().heldLimit,20)
  assert.equal(f.stream.snapshot().maximumBytes,16);assert.equal(f.stream.snapshot().pressureDrains,0)
  f.advance(1499);assert.equal(f.stream.snapshot().decoded,1)
  f.advance(1500);assert.equal(f.stream.snapshot().decoded,17)
  assert.deepEqual(f.frames.map(frame=>frame.timestamp),Array.from({length:17},(_,i)=>i*40000))
  assert.equal(f.stream.snapshot().lateFrames,0);assert.equal(f.stream.snapshot().encodedBytes,0);f.stream.close()
})
