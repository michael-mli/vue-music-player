import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {setImmediate as tick} from 'node:timers/promises'
import {createVp8DecodeProbe} from './party-vp8-decode-probe.mjs'

async function fixture({hold=false,wrongSize=false,pendingConfig=false}={}){
  const messages=[],chunks=[],frames=[],waiting=[]
  let decoder,resolveConfig,timer,creations=0
  class Decoder{
    static isConfigSupported(config){return pendingConfig?new Promise(resolve=>{resolveConfig=()=>resolve({supported:true,config})}):Promise.resolve({supported:true,config})}
    constructor(callbacks){creations++;decoder=this;this.callbacks=callbacks;this.state='configured'}
    configure(config){assert.equal(config.codec,'vp8');assert.equal(config.optimizeForLatency,true)}
    close(){this.state='closed'}
    decode(chunk){
      chunks.push(chunk)
      const frame={timestamp:chunk.timestamp,codedWidth:wrongSize?640:1280,codedHeight:720,displayWidth:1280,displayHeight:720,
        closes:0,allocationSize:()=>1280*720*3/2,close(){this.closes++}}
      frames.push(frame);if(hold)waiting.push(frame);else this.callbacks.output(frame)
    }
  }
  const realm={ArrayBuffer,performance:{timeOrigin:10000,now:()=>1000},VideoDecoder:Decoder,
    EncodedVideoChunk:class{constructor(configuration){Object.assign(this,configuration)}},
    setTimeout:callback=>{timer=callback;return 1},clearTimeout:()=>{timer=null},
    __encodedTimingCodecs:[{payloadType:96,mimeType:'video/vp8'}],postMessage:row=>messages.push(row)}
  realm.self=realm
  const probe=vm.runInNewContext(`(${createVp8DecodeProbe.toString()})()`,realm)
  await tick()
  const send=(index,{type=index?'delta':'key',payloadType=96,size=1,captureTime=index*40}={})=>{
    const bytes=new Uint8Array(size).fill(7)
    probe.observe({type,timestamp:index*3600,data:bytes.buffer},{payloadType,captureTime})
    assert.ok(bytes.every(value=>value===7))
  }
  return {probe,send,messages,chunks,frames,waiting,timeout(){timer?.()},configReady(){resolveConfig?.()},
    get creations(){return creations},output(frame){decoder.callbacks.output(frame)}}
}
test('eight received VP8 frames retain capture/RTP associations, preserve bytes and close every output',async()=>{
  const f=await fixture();for(let i=0;i<8;i++)f.send(i)
  const r=f.messages[0];assert.equal(r.status,'complete');assert.equal(r.inputCount,8);assert.equal(r.decodedCount,8)
  assert.deepEqual(Array.from(r.records,row=>row.rtpTimestamp),Array.from({length:8},(_,i)=>i*3600))
  assert.ok(r.records.every((row,i)=>row.captureUnixMs===10000+i*40&&row.width===1280&&row.height===720))
  assert.ok(f.frames.every(frame=>frame.closes===1))
  f.probe.observe({get data(){throw new Error('closed probe cannot read')}},{captureTime:400})
  assert.equal(f.messages.length,1)
})
test('output association follows exact native timestamps and rejects fabricated output without retaining frames',async()=>{
  const f=await fixture({hold:true});f.send(0);f.send(1)
  f.output(f.waiting[1]);f.output(f.waiting[0]);f.probe.close()
  assert.deepEqual(Array.from(f.messages[0].records,row=>row.rtpTimestamp),[3600,0])
  const bad=await fixture({hold:true});bad.send(0);bad.waiting[0].timestamp=1;bad.output(bad.waiting[0])
  assert.equal(bad.messages[0].reason,'OUTPUT');assert.equal(bad.frames[0].closes,1)
  const size=await fixture({wrongSize:true});size.send(0)
  assert.equal(size.messages[0].reason,'OUTPUT');assert.equal(size.frames[0].closes,1)
})
test('probe waits for a capture-bearing keyframe and validates negotiated codec and packet clock',async()=>{
  const f=await fixture();f.send(1)
  assert.equal(f.chunks.length,0);f.send(0);assert.equal(f.chunks.length,1)
  f.send(1,{payloadType:111});assert.equal(f.messages[0].reason,'CODEC')
  const clock=await fixture();clock.send(0,{captureTime:Number.MAX_VALUE})
  assert.equal(clock.messages[0].reason,'CLOCK')
  const duplicate=await fixture({hold:true});duplicate.send(0);duplicate.send(0)
  assert.equal(duplicate.messages[0].reason,'CLOCK')
})
test('pending configuration uses a shared encoded budget and cannot revive after overflow or timeout',async()=>{
  const f=await fixture({pendingConfig:true});f.send(0,{size:256*1024});f.send(1,{size:256*1024});f.send(2)
  assert.equal(f.messages[0].reason,'BOUND');assert.equal(f.messages[0].maximumBytes,512*1024)
  f.configReady();await tick();assert.equal(f.creations,0)
  const timeout=await fixture({pendingConfig:true});timeout.send(0);timeout.timeout();timeout.configReady();await tick()
  assert.equal(timeout.messages[0].status,'timeout');assert.equal(timeout.creations,0)
})
test('startup decoding precedes capture headers; two advancing anchors associate only bounded retained records',async()=>{
  const f=await fixture();for(let i=0;i<8;i++)f.send(i,{captureTime:NaN})
  assert.equal(f.messages.length,0);assert.equal(f.chunks.length,8)
  assert.ok(f.frames.every(frame=>frame.closes===1))
  const anchor=(index,captureTime)=>f.probe.observe({type:'delta',timestamp:index*3600,
    get data(){throw new Error('association cannot read another payload')}},{payloadType:96,captureTime})
  anchor(8,320);assert.equal(f.messages.length,0);anchor(9,360)
  const r=f.messages[0];assert.equal(r.status,'complete');assert.equal(r.captureMode,'rtp-projected')
  assert.equal(r.captureAnchors,2);assert.equal(r.maximumCaptureResidualMs,0)
  assert.ok(r.records.every((row,index)=>row.captureUnixMs===10000+index*40))
  const jump=await fixture();for(let i=0;i<8;i++)jump.send(i,{captureTime:NaN})
  jump.send(8,{captureTime:320});jump.send(9,{captureTime:441})
  assert.equal(jump.messages[0].reason,'CLOCK')
})
