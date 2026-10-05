import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {setImmediate as tick} from 'node:timers/promises'
import {createOwnedPcmReceiver} from './party-owned-pcm-receiver.mjs'

async function fixture({pendingModule=false,deviceClock=false,driverFailure=false,batchPackets=1}={}){
  let now=1000,interval,finishModule,renderer
  const nodes=[],contexts=[],messages=[],drivers=[],captured={stops:0,stop(){this.stops++}},original={stops:0,stop(){this.stops++}}
  class Node{constructor(){this.connections=[];this.gain={value:0};this.port={postMessage:data=>messages.push(data)}}
    connect(node){this.connections.push(node);return node}disconnect(){this.connections=[]}}
  class Context{constructor(){this.currentTime=.2;this.sampleRate=48000;this.closes=0;contexts.push(this)
    this.destination=new Node()
    this.audioWorklet={addModule:()=>pendingModule?new Promise(resolve=>{finishModule=resolve}):Promise.resolve()}}
    async resume(){} async close(){this.closes++}
    createConstantSource(){const node=new Node();node.offset={value:1};node.starts=0;node.stops=0
      node.start=()=>{if(driverFailure)throw new Error('private-device-detail');node.starts++}
      node.stop=()=>{node.stops++};drivers.push(node);return node}
    createMediaStreamDestination(){const node=new Node();node.stream={getTracks:()=>[captured]};return node}}
  const output={currentTime:1,sampleRate:44100,closes:0,createGain(){const node=new Node();nodes.push(node);return node},
    getOutputTimestamp(){return {contextTime:.95,performanceTime:now-10}}}
  const worker={postMessage:data=>messages.push(data)}
  const states=[{worker:7,configured:true,closed:false,decoded:10,observedAt:now,lastCaptureUnixMs:now,maximumResidualMs:3}]
  const realm={Date:{now:()=>now},performance:{now:()=>now},AudioContext:Context,
    AudioWorkletNode:class extends Node{constructor(){super();renderer=this}},MessageChannel:class{constructor(){this.port1={};this.port2={}}},Blob,
    URL:{createObjectURL:()=> 'blob:owned',revokeObjectURL(){}},setInterval:callback=>{interval=callback;return 1},clearInterval:()=>{interval=null},
    window:{__encodedTimingProbe:{receiverWorker:track=>track===original?worker:null,workerId:()=>7,pcmStates:states}}}
  const factory=vm.runInNewContext(`(${createOwnedPcmReceiver.toString()})`,realm)
  const receiver=factory(class{},()=>{},output,original,function(){const node=new Node();nodes.push(node);return node},200,{deviceClock,batchPackets})
  await tick()
  return {receiver,contexts,drivers,renderer,output,original,captured,nodes,messages,states,advance(value){now=value;states[0].observedAt=value;states[0].lastCaptureUnixMs=value},
    renew(){interval?.()},moduleReady(){finishModule?.()},queueState(data){renderer.port.onmessage({data:{type:'queue-state',renderFrame:0,...data}})}}
}
test('owned PCM connects through a captured stream into the caller graph and closes only its resources',async()=>{
  const f=await fixture();assert.equal(f.receiver.snapshot().ready,true)
  assert.equal(f.receiver.snapshot().pcmRate,48000);assert.equal(f.receiver.snapshot().outputRate,44100)
  assert.equal(f.receiver.node.gain.value,1);assert.equal(f.messages.find(row=>row.type==='pcm-bind').configuration.delayMs,200)
  f.renew();assert.equal(f.messages.at(-1).type,'pcm-renew')
  f.receiver.close();f.receiver.close()
  assert.equal(f.receiver.node.gain.value,0);assert.equal(f.captured.stops,1);assert.equal(f.original.stops,0)
  assert.equal(f.contexts[0].closes,1);assert.equal(f.output.closes,0)
})
test('private device clock connects only constant zero to hardware while PCM keeps its sole guarded route',async()=>{
  const f=await fixture({deviceClock:true}),driver=f.drivers[0]
  assert.equal(driver.offset.value,0);assert.equal(driver.starts,1)
  assert.equal(driver.connections.length,1);assert.equal(driver.connections[0],f.contexts[0].destination)
  assert.equal(f.renderer.connections.length,1)
  assert.notEqual(f.renderer.connections[0],f.contexts[0].destination)
  assert.notEqual(f.renderer.connections[0],driver)
  assert.equal(f.renderer.connections[0].stream.getTracks()[0],f.captured)
  assert.equal(f.receiver.snapshot().deviceClock.running,true)
  f.receiver.close();f.receiver.close()
  assert.equal(driver.stops,1);assert.equal(driver.connections.length,0)
  assert.equal(f.receiver.snapshot().deviceClock.running,false)
  assert.equal(f.original.stops,0);assert.equal(f.output.closes,0)
})
test('private device clock startup failure and close during module load cannot create PCM output',async()=>{
  const failed=await fixture({deviceClock:true,driverFailure:true})
  assert.equal(failed.receiver.snapshot().error,'PLAYOUT_PCM_CREATE')
  assert.equal(failed.drivers[0].connections.length,0)
  assert.equal(failed.messages.filter(row=>row.type==='pcm-bind').length,0)
  assert.equal(failed.receiver.node.gain.value,0)
  const pending=await fixture({deviceClock:true,pendingModule:true})
  pending.receiver.close();pending.moduleReady();await tick()
  assert.equal(pending.drivers[0].stops,1)
  assert.equal(pending.receiver.snapshot().closed,true)
  assert.equal(pending.messages.filter(row=>row.type==='pcm-bind').length,0)
})
test('grouping changes only decoder transfer policy and rejects unsupported group sizes before binding',async()=>{
  const f=await fixture({batchPackets:2}),config=f.messages.find(row=>row.type==='pcm-bind').configuration
  assert.equal(config.batchPackets,2);assert.equal(config.delayMs,200);assert.equal(config.expiryUnixMs,10000)
  assert.equal(f.drivers.length,0);assert.equal(f.renderer.connections.length,1)
  assert.equal(f.receiver.node.gain.value,1);f.receiver.close()
  await assert.rejects(fixture({batchPackets:3}),/PLAYOUT_PCM_BATCH_CONFIG/)
})
test('capture cursor uses output position and accepts the established 20-ms forward timestamp tolerance',async()=>{
  const f=await fixture();assert.ok(Math.abs(f.receiver.captureCursor()-750)<.00001)
  f.advance(2000);f.contexts[0].currentTime=1.2
  assert.ok(Math.abs(f.receiver.captureCursor()-1750)<.00001)
  f.output.getOutputTimestamp=()=>({contextTime:.95,performanceTime:2015})
  assert.ok(Number.isFinite(f.receiver.captureCursor()))
  f.output.getOutputTimestamp=()=>({contextTime:.95,performanceTime:2021})
  assert.equal(f.receiver.captureCursor(),null);assert.equal(f.receiver.node.gain.value,0)
  f.advance(2050);f.output.getOutputTimestamp=()=>({contextTime:.95,performanceTime:2071})
  assert.equal(f.receiver.captureCursor(),null);assert.equal(f.receiver.snapshot().error,'PLAYOUT_PCM_OUTPUT_AGE')
})
test('video cursor follows the capture phase of audible PCM rather than a newer queued packet',async()=>{
  const f=await fixture()
  f.states.push({worker:7,scheduledCaptureUnixMs:700,captureOffsetMs:12},
    {worker:7,scheduledCaptureUnixMs:900,captureOffsetMs:65,
      configured:true,closed:false,decoded:10,observedAt:1000,lastCaptureUnixMs:965})
  assert.equal(f.receiver.captureCursor(),762)
  f.advance(2000);f.contexts[0].currentTime=1.2
  assert.ok(Math.abs(f.receiver.captureCursor()-1815)<.00001)
  f.states.at(-1).captureOffsetMs=201
  assert.equal(f.receiver.captureCursor(),null)
  assert.equal(f.receiver.snapshot().error,'PLAYOUT_PCM_CLOCK')
})
test('renderer reports retain only bounded sample counts and cannot repopulate diagnostics after closure',async()=>{
  const f=await fixture()
  f.queueState({queued:30,bytes:230400,bufferedFrames:28500})
  assert.equal(f.receiver.snapshot().queue.bufferedFrames,28500)
  assert.equal(f.receiver.snapshot().queue.observedAt,1000)
  f.queueState({queued:49,bytes:230400,bufferedFrames:28500})
  assert.equal(f.receiver.snapshot().error,'PLAYOUT_PCM_RENDER')
  assert.equal(f.receiver.snapshot().queue,null)
  f.queueState({queued:30,bytes:230400,bufferedFrames:28500})
  assert.equal(f.receiver.snapshot().queue,null)
})
test('read-only render clocks distinguish the context frame from the actual reported quantum and reject invalid reports',async()=>{
  const f=await fixture();f.queueState({queued:30,bytes:230400,bufferedFrames:28500,renderFrame:8192,secret:'private'})
  const first=f.receiver.snapshot().renderClock
  assert.equal(first.contextFrame,9600);assert.equal(first.reportedFrame,8192)
  assert.equal(first.anchorFrame,9600);assert.equal(first.anchorWallUnixMs,1000)
  assert.equal('secret' in f.receiver.snapshot().queue,false)
  f.advance(1100);f.contexts[0].currentTime=.3
  const second=f.receiver.snapshot().renderClock
  assert.equal(second.wallUnixMs,1100);assert.equal(second.contextFrame,14400)
  assert.equal(second.reportedFrame,8192);assert.equal(second.reportedAt,1000)
  assert.equal(f.messages.filter(row=>row.type==='pcm-bind').length,1)
  f.queueState({queued:30,bytes:230400,bufferedFrames:28500,renderFrame:NaN})
  assert.equal(f.receiver.snapshot().error,'PLAYOUT_PCM_RENDER');assert.equal(f.receiver.node.gain.value,0)
})
test('closing during module startup cannot later bind a decoder or revive output',async()=>{
  const f=await fixture({pendingModule:true});f.receiver.close();f.moduleReady();await tick()
  assert.equal(f.receiver.snapshot().closed,true);assert.equal(f.receiver.snapshot().ready,false)
  assert.equal(f.messages.filter(row=>row.type==='pcm-bind').length,0);assert.equal(f.original.stops,0)
})

test('a brief invalid output timestamp stays silent and emits no cursor until an unchanged-bound sample validates',async()=>{
  const f=await fixture();assert.ok(Number.isFinite(f.receiver.captureCursor()))
  f.output.getOutputTimestamp=()=>({contextTime:.95,performanceTime:1021})
  assert.equal(f.receiver.captureCursor(),null);assert.equal(f.receiver.node.gain.value,0)
  assert.equal(f.receiver.snapshot().closed,false);assert.equal(f.receiver.snapshot().validatingOutput,true)
  f.advance(1016);f.contexts[0].currentTime=.216;f.output.getOutputTimestamp=()=>({contextTime:.95,performanceTime:1006})
  assert.ok(Number.isFinite(f.receiver.captureCursor()));assert.equal(f.receiver.node.gain.value,1)
  assert.equal(f.receiver.snapshot().validatingOutput,false)
  f.output.getOutputTimestamp=()=>({contextTime:.5,performanceTime:1006})
  assert.equal(f.receiver.captureCursor(),null);assert.equal(f.receiver.node.gain.value,0)
  f.advance(1066);assert.equal(f.receiver.captureCursor(),null)
  assert.equal(f.receiver.snapshot().error,'PLAYOUT_PCM_OUTPUT_LATENCY')
  f.output.getOutputTimestamp=()=>({contextTime:.95,performanceTime:1056})
  assert.equal(f.receiver.captureCursor(),null);assert.equal(f.receiver.node.gain.value,0)
})
test('a healthy timestamp after the bounded recheck cannot revive playback',async()=>{
  const f=await fixture();f.output.getOutputTimestamp=()=>({contextTime:0,performanceTime:0})
  assert.equal(f.receiver.captureCursor(),null);f.advance(1050)
  f.output.getOutputTimestamp=()=>({contextTime:.95,performanceTime:1040})
  assert.equal(f.receiver.captureCursor(),null);assert.equal(f.receiver.snapshot().closed,true)
  assert.equal(f.receiver.node.gain.value,0)
})


test('valid output revalidation cannot restore gain when the capture phase is invalid',async()=>{
  const f=await fixture();assert.ok(Number.isFinite(f.receiver.captureCursor()))
  f.output.getOutputTimestamp=()=>({contextTime:.95,performanceTime:1021})
  assert.equal(f.receiver.captureCursor(),null);assert.equal(f.receiver.node.gain.value,0)
  f.advance(1016);f.contexts[0].currentTime=.216
  f.output.getOutputTimestamp=()=>({contextTime:.95,performanceTime:1006})
  f.states.push({worker:7,scheduledCaptureUnixMs:700,captureOffsetMs:201,
    configured:true,closed:false,decoded:11,observedAt:1016,lastCaptureUnixMs:1016})
  assert.equal(f.receiver.captureCursor(),null);assert.equal(f.receiver.snapshot().error,'PLAYOUT_PCM_CLOCK')
  assert.equal(f.receiver.snapshot().closed,true);assert.equal(f.receiver.node.gain.value,0)
})
test('a reversed observation clock during output revalidation closes without restoring gain',async()=>{
  const f=await fixture();f.output.getOutputTimestamp=()=>({contextTime:.95,performanceTime:1021})
  assert.equal(f.receiver.captureCursor(),null);f.advance(999)
  f.output.getOutputTimestamp=()=>({contextTime:.95,performanceTime:989})
  assert.equal(f.receiver.captureCursor(),null);assert.equal(f.receiver.snapshot().error,'PLAYOUT_PCM_OUTPUT_AGE')
  assert.equal(f.receiver.snapshot().closed,true);assert.equal(f.receiver.node.gain.value,0)
})
