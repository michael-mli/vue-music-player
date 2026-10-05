import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { setImmediate as tick } from 'node:timers/promises'
import { createOpusPcmStream } from './party-opus-pcm-stream.mjs'
import { primaryOpusPayload, opusPacketFrames } from './party-opus-decode-probe.mjs'
import { CapturePcmQueue } from './party-capture-pcm-queue.mjs'

function fixture({delayed=false,invalid=false,reorderMs=0,batchPackets=1,frames=960,values=null}={}) {
  const messages=[],packets=[],outputs=[],waiting=[]
  let now=0,timerId=0
  const timers=new Map()
  let decoder
  class Decoder {
    static async isConfigSupported(config) {return {supported:true,config}}
    constructor(callbacks) {this.callbacks=callbacks;this.state='configured';decoder=this}
    configure() {}
    decode(chunk) {
      const value=values?.[outputs.length]??.25
      const frame={sampleRate:48000,timestamp:chunk.timestamp,numberOfFrames:frames,numberOfChannels:2,
        duration:frames/48000*1000000,closes:0,close(){this.closes++},copyTo(plane,{planeIndex,format}) {
          assert.equal(format,'f32-planar');plane.fill(invalid?NaN:planeIndex?-value:value)
        }}
      outputs.push(frame)
      if(delayed)waiting.push(frame);else this.callbacks.output(frame)
    }
    close(){this.state='closed'}
  }
  const realm={Number,ArrayBuffer,Float32Array,Uint8Array,Map,Array,performance:{timeOrigin:1000,now:()=>now},
    setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,at:now+delay});return id},
    clearTimeout(id){timers.delete(id)},reorderMs,batchPackets,
    AudioDecoder:Decoder,EncodedAudioChunk:class{constructor(config){Object.assign(this,config)}},
    __encodedTimingCodecs:[{payloadType:111,mimeType:'audio/opus'},{payloadType:63,mimeType:'audio/red'}],deliver:packet=>packets.push(packet),report:row=>messages.push(row)}
  realm.self=realm
  const frameParser=frames===960?opusPacketFrames.toString():`()=>${frames}`
  const stream=vm.runInNewContext(`(${createOpusPcmStream.toString()})(${primaryOpusPayload.toString()},${frameParser},deliver,report,{reorderMs,batchPackets})`,realm)
  const send=(rtp,captureTime=rtp/48)=>stream.observe({timestamp:rtp>>>0,data:new Uint8Array([1]).buffer},{captureTime,payloadType:111})
  return {stream,send,packets,messages,outputs,waiting,timers,
    advance(value){now=value;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback()}},
    flush(){while(waiting.length)decoder.callbacks.output(waiting.shift())}}
}

function red(offsets){return new Uint8Array([...offsets.flatMap(offset=>[239,offset>>6,(offset&63)<<2,1]),111,
  ...offsets.map(()=>1),1])}
test('two-packet transfer preserves every channel sample and the first capture clock across RTP wrap',async()=>{
  const f=fixture({batchPackets:2,values:[.125,.5]});await tick();const start=0xfffffe00
  f.send(start,0);assert.equal(f.packets.length,0);assert.equal(f.stream.snapshot().pendingGroupPackets,1)
  f.send((start+960)>>>0,26)
  assert.equal(f.packets.length,1)
  const packet=f.packets[0]
  assert.equal(packet.id,2);assert.equal(packet.rtpTimestamp,start)
  assert.equal(packet.captureUnixMs,1000);assert.equal(packet.observedCaptureUnixMs,1000)
  assert.equal(packet.frames,1920)
  for(const [channel,sign] of [[0,1],[1,-1]]){
    assert.ok(packet.planes[channel].slice(0,960).every(value=>value===sign*.125))
    assert.ok(packet.planes[channel].slice(960).every(value=>value===sign*.5))
  }
  assert.equal(f.stream.snapshot().chunks,1);assert.equal(f.stream.snapshot().pcmBytes,15360)
  assert.equal(f.stream.snapshot().maximumBytes,30720)
  assert.equal(f.stream.snapshot().groupedChunks,1);assert.equal(f.stream.snapshot().maximumGroupPackets,2)
  assert.ok(f.outputs.every(frame=>frame.closes===1));assert.equal(f.timers.size,0)
  f.stream.consumed({id:2,bytes:15360});assert.equal(f.stream.snapshot().pcmBytes,0);f.stream.close()
})
test('partial groups flush within forty milliseconds and terminal stop prevents a late transfer',async()=>{
  const f=fixture({batchPackets:2});await tick();f.send(0)
  f.advance(39);assert.equal(f.packets.length,0)
  f.advance(40);assert.equal(f.packets.length,1);assert.equal(f.packets[0].frames,960)
  f.stream.close()
  const stopped=fixture({batchPackets:2});await tick();stopped.send(0);stopped.stream.close();stopped.advance(100)
  assert.equal(stopped.packets.length,0);assert.equal(stopped.timers.size,0)
  assert.equal(stopped.stream.snapshot().pcmBytes,0);assert.equal(stopped.stream.snapshot().pendingGroupPackets,0)
})
test('grouping never crosses an unrepaired gap or fills it with synthetic PCM',async()=>{
  const f=fixture({batchPackets:2});await tick();f.send(0);f.send(1920);f.send(2880)
  assert.deepEqual(f.packets.map(packet=>[packet.rtpTimestamp,packet.frames]),[[0,960],[1920,1920]])
  assert.equal(f.stream.snapshot().gaps,960);assert.equal(f.stream.snapshot().groupedChunks,1)
  const queue=new CapturePcmQueue(48000,credit=>f.stream.consumed(credit))
  for(const packet of f.packets)queue.push({...packet,startFrame:packet.rtpTimestamp})
  const planes=[new Float32Array(3840),new Float32Array(3840)];queue.render(0,planes)
  assert.ok(planes[0].slice(960,1920).every(value=>value===0))
  assert.equal(f.stream.snapshot().chunks,0);f.stream.close()
})
test('group members, wrong byte counts and duplicate returns cannot forge renderer credits',async()=>{
  const held=fixture({batchPackets:2});await tick();held.send(0)
  held.stream.consumed({id:1,bytes:7680});assert.equal(held.stream.snapshot().reason,'PCM_CREDIT')
  held.advance(40);assert.equal(held.packets.length,0)
  for(const credit of [{id:1,bytes:7680},{id:2,bytes:15359}]){
    const f=fixture({batchPackets:2});await tick();f.send(0);f.send(960);f.stream.consumed(credit)
    assert.equal(f.stream.snapshot().reason,'PCM_CREDIT');assert.equal(f.stream.snapshot().pcmBytes,0)
  }
  const duplicate=fixture({batchPackets:2});await tick();duplicate.send(0);duplicate.send(960)
  duplicate.stream.consumed({id:2,bytes:15360});duplicate.stream.consumed({id:2,bytes:15360})
  assert.equal(duplicate.stream.snapshot().reason,'PCM_CREDIT')
})
test('grouped rendering and stalled native decoding keep the original credit, byte and reorder caps',async()=>{
  for(const delayed of [false,true]){
    const f=fixture({batchPackets:2,delayed});await tick()
    for(let i=0;i<110;i++)f.send(i*960)
    assert.equal(f.stream.snapshot().reason,'PCM_BOUND');assert.equal(f.stream.snapshot().maximumChunks,48)
    assert.ok(f.stream.snapshot().maximumBytes<=1024*1024);assert.equal(f.stream.snapshot().maximumHeld,8)
    const count=f.packets.length;f.flush();f.advance(100)
    assert.equal(f.packets.length,count);assert.ok(f.outputs.every(frame=>frame.closes===1))
    assert.equal(f.stream.snapshot().pcmBytes,0);assert.equal(f.stream.snapshot().encodedBytes,0)
  }
})
test('combined-copy reservation rejects transient PCM overflow before allocating or transferring',async()=>{
  const f=fixture({batchPackets:2,frames:2880});await tick()
  for(let i=0;i<44;i++)f.send(i*2880)
  assert.equal(f.stream.snapshot().reason,'PCM_BOUND')
  assert.equal(f.packets.length,21);assert.ok(f.packets.every(packet=>packet.frames===5760))
  assert.ok(f.stream.snapshot().maximumBytes<=1024*1024)
  assert.equal(f.stream.snapshot().pcmBytes,0);assert.ok(f.outputs.every(frame=>frame.closes===1))
})
test('grouping preserves the existing maximum renderer packet duration',async()=>{
  const f=fixture({batchPackets:2,frames:3840});await tick();f.send(0);f.send(3840);f.advance(40)
  assert.deepEqual(f.packets.map(packet=>packet.frames),[3840,3840])
  assert.equal(f.stream.snapshot().groupedChunks,0);assert.equal(f.stream.snapshot().maximumGroupPackets,1)
  f.stream.close()
})
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
test('RED recovery across RTP wrap preserves credits and resumes bounded repairs as render credits arrive',async()=>{
  const f=fixture();await tick();const start=0xfffffe00;f.send(start,0)
  f.stream.observe({timestamp:(start+1920)>>>0,data:red([960]).buffer},{captureTime:40,payloadType:63})
  assert.equal(f.stream.snapshot().recovered,1);assert.equal(f.stream.snapshot().gaps,0)
  assert.equal(f.packets[1].rtpTimestamp,(start+960)>>>0);f.stream.close()
  const bad=fixture();await tick();bad.send(0)
  bad.stream.observe({timestamp:1920,data:red([480]).buffer},{captureTime:40,payloadType:63})
  assert.equal(bad.messages[0].reason,'PCM_PACKET');assert.equal(bad.stream.snapshot().pcmBytes,0)
  const full=fixture();await tick();for(let i=0;i<47;i++)full.send(i*960)
  full.stream.observe({timestamp:49*960,data:red([1920,960]).buffer},{captureTime:980,payloadType:63})
  assert.equal(full.stream.snapshot().closed,false);assert.equal(full.stream.snapshot().chunks,48)
  assert.equal(full.stream.snapshot().heldPackets,1);assert.equal(full.stream.snapshot().recovered,1)
  full.stream.consumed({id:full.packets[0].id,bytes:7680})
  assert.equal(full.stream.snapshot().recovered,2);assert.equal(full.packets.length,49)
  full.stream.consumed({id:full.packets[1].id,bytes:7680})
  assert.equal(full.packets.length,50);assert.equal(full.stream.snapshot().gaps,0)
  assert.equal(full.stream.snapshot().heldPackets,0);full.stream.close()
})
test('bounded reordering admits an earlier primary without silence, handles wrap and cannot refresh capture authority',async()=>{
  const f=fixture({reorderMs:80});await tick();const start=0xfffffe00
  f.send(start,0);f.send((start+1920)>>>0,40)
  assert.equal(f.packets.length,1);assert.equal(f.stream.snapshot().heldPackets,1)
  f.advance(60);f.send((start+960)>>>0,20)
  assert.deepEqual(f.packets.map(packet=>packet.rtpTimestamp),[start,(start+960)>>>0,(start+1920)>>>0])
  assert.equal(f.stream.snapshot().gaps,0);assert.equal(f.stream.snapshot().reordered,1)
  assert.equal(f.stream.snapshot().lastCaptureUnixMs,1040)
  assert.equal(f.stream.snapshot().encodedBytes,0);assert.equal(f.timers.size,0);f.stream.close()
})
test('reorder wait expires once without extension; pressure commits a bounded oldest gap without extending the wait',async()=>{
  const f=fixture({reorderMs:80});await tick();f.send(0);f.send(1920)
  f.advance(60);f.send(2880);f.advance(79);assert.equal(f.packets.length,1)
  f.advance(80);assert.equal(f.packets.length,3);assert.equal(f.stream.snapshot().gaps,960)
  f.stream.close();assert.equal(f.timers.size,0)
  const full=fixture({reorderMs:80});await tick();full.send(0)
  for(let i=2;i<11;i++)full.send(i*960)
  assert.equal(full.stream.snapshot().closed,false);assert.equal(full.stream.snapshot().maximumHeld,8)
  assert.equal(full.stream.snapshot().pressureDrains,1);assert.equal(full.stream.snapshot().gaps,960)
  assert.equal(full.stream.snapshot().encodedBytes,0);assert.equal(full.timers.size,0)
  full.advance(100);assert.equal(full.packets.length,10)
  full.send(960);assert.equal(full.stream.snapshot().duplicates,1);assert.equal(full.packets.length,10)
  full.stream.close();assert.equal(full.timers.size,0)
})
test('a late contiguous primary repairs a full reorder queue before committing any gap',async()=>{
  const f=fixture({reorderMs:80});await tick();const start=0xfffffe00
  f.send(start,0)
  for(let i=2;i<10;i++)f.send((start+i*960)>>>0,i*20)
  assert.equal(f.stream.snapshot().heldPackets,8)
  f.send((start+960)>>>0,20)
  assert.equal(f.stream.snapshot().closed,false);assert.equal(f.stream.snapshot().gaps,0)
  assert.equal(f.stream.snapshot().pressureDrains,0);assert.equal(f.stream.snapshot().maximumHeld,8)
  assert.deepEqual(f.packets.map(packet=>packet.rtpTimestamp),Array.from({length:10},(_,i)=>(start+i*960)>>>0))
  assert.equal(f.stream.snapshot().lastCaptureUnixMs,1180);assert.equal(f.timers.size,0)
  f.stream.close()
})
test('earlier noncontiguous arrivals cannot postpone the first retained packet deadline',async()=>{
  const f=fixture({reorderMs:80});await tick();f.send(0);f.send(9600)
  f.advance(60);f.send(8640)
  assert.equal(f.packets.length,1)
  assert.equal([...f.timers.values()][0].at,80)
  f.advance(79);assert.equal(f.packets.length,1)
  f.advance(80)
  assert.deepEqual(f.packets.map(packet=>packet.rtpTimestamp),[0,8640,9600])
  assert.equal(f.stream.snapshot().gaps,7680);assert.equal(f.stream.snapshot().heldPackets,0)
  assert.equal(f.stream.snapshot().pressureDrains,0);assert.equal(f.timers.size,0);f.stream.close()
})
test('reorder pressure cannot bypass renderer credits or revive a terminal decoder',async()=>{
  const f=fixture({reorderMs:80});await tick()
  for(let i=0;i<48;i++)f.send(i*960)
  for(let i=49;i<58;i++)f.send(i*960)
  assert.equal(f.messages[0].reason,'PCM_BOUND');assert.equal(f.stream.snapshot().maximumChunks,48)
  assert.equal(f.stream.snapshot().maximumHeld,8);assert.equal(f.stream.snapshot().heldPackets,0)
  assert.equal(f.stream.snapshot().pcmBytes,0);assert.equal(f.stream.snapshot().encodedBytes,0)
  const count=f.packets.length;f.send(48*960);f.advance(100);assert.equal(f.packets.length,count)
})
test('pressured RED recovery retains ordered history and accounts for the actual unrepaired gap',async()=>{
  const f=fixture({reorderMs:80});await tick();f.send(0)
  f.stream.observe({timestamp:4800,data:red([1920,960]).buffer},{captureTime:100,payloadType:63})
  for(let i=6;i<14;i++)f.send(i*960)
  assert.equal(f.stream.snapshot().closed,false);assert.equal(f.stream.snapshot().maximumHeld,8)
  assert.equal(f.stream.snapshot().pressureDrains,1);assert.equal(f.stream.snapshot().recovered,2)
  assert.equal(f.stream.snapshot().gaps,1920)
  assert.deepEqual(f.packets.map(packet=>packet.rtpTimestamp),[0,...Array.from({length:11},(_,i)=>(i+3)*960)])
  assert.equal(f.stream.snapshot().encodedBytes,0);assert.equal(f.timers.size,0);f.stream.close()
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
    for(let i=0;i<57;i++)f.send(i*960)
    assert.equal(f.messages[0].reason,'PCM_BOUND')
    assert.equal(f.stream.snapshot().maximumChunks,48)
    assert.equal(f.stream.snapshot().pcmBytes,0);assert.equal(f.stream.snapshot().encodedBytes,0)
    f.flush();assert.ok(f.outputs.every(frame=>frame.closes===1))
    const count=f.packets.length;f.send(57*960);assert.equal(f.packets.length,count)
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
