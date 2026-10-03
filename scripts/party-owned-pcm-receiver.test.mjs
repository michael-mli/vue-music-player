import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {setImmediate as tick} from 'node:timers/promises'
import {createOwnedPcmReceiver} from './party-owned-pcm-receiver.mjs'

async function fixture({pendingModule=false}={}){
  let now=1000,interval,finishModule
  const nodes=[],contexts=[],messages=[],captured={stops:0,stop(){this.stops++}},original={stops:0,stop(){this.stops++}}
  class Node{constructor(){this.connections=[];this.gain={value:0};this.port={postMessage:data=>messages.push(data)}}
    connect(node){this.connections.push(node);return node}disconnect(){this.connections=[]}}
  class Context{constructor(){this.currentTime=.2;this.sampleRate=48000;this.closes=0;contexts.push(this)
    this.audioWorklet={addModule:()=>pendingModule?new Promise(resolve=>{finishModule=resolve}):Promise.resolve()}}
    async resume(){} async close(){this.closes++}
    createMediaStreamDestination(){const node=new Node();node.stream={getTracks:()=>[captured]};return node}}
  const output={currentTime:1,sampleRate:44100,closes:0,createGain(){const node=new Node();nodes.push(node);return node},
    getOutputTimestamp(){return {contextTime:.95,performanceTime:now-10}}}
  const worker={postMessage:data=>messages.push(data)}
  const states=[{worker:7,configured:true,closed:false,decoded:10,observedAt:now,lastCaptureUnixMs:now,maximumResidualMs:3}]
  const realm={Date:{now:()=>now},performance:{now:()=>now},AudioContext:Context,
    AudioWorkletNode:class extends Node{},MessageChannel:class{constructor(){this.port1={};this.port2={}}},Blob,
    URL:{createObjectURL:()=> 'blob:owned',revokeObjectURL(){}},setInterval:callback=>{interval=callback;return 1},clearInterval:()=>{interval=null},
    window:{__encodedTimingProbe:{receiverWorker:track=>track===original?worker:null,workerId:()=>7,pcmStates:states}}}
  const factory=vm.runInNewContext(`(${createOwnedPcmReceiver.toString()})`,realm)
  const receiver=factory(class{},()=>{},output,original,function(){const node=new Node();nodes.push(node);return node},200)
  await tick()
  return {receiver,contexts,output,original,captured,nodes,messages,states,advance(value){now=value;states[0].observedAt=value;states[0].lastCaptureUnixMs=value},
    renew(){interval?.()},moduleReady(){finishModule?.()}}
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
test('capture cursor uses output position and accepts the established 20-ms forward timestamp tolerance',async()=>{
  const f=await fixture();assert.ok(Math.abs(f.receiver.captureCursor()-750)<.00001)
  f.advance(2000);f.contexts[0].currentTime=1.2
  assert.ok(Math.abs(f.receiver.captureCursor()-1750)<.00001)
  f.output.getOutputTimestamp=()=>({contextTime:.95,performanceTime:2015})
  assert.ok(Number.isFinite(f.receiver.captureCursor()))
  f.output.getOutputTimestamp=()=>({contextTime:.95,performanceTime:2021})
  assert.equal(f.receiver.captureCursor(),null);assert.equal(f.receiver.snapshot().error,'PLAYOUT_PCM_OUTPUT_AGE')
})
test('closing during module startup cannot later bind a decoder or revive output',async()=>{
  const f=await fixture({pendingModule:true});f.receiver.close();f.moduleReady();await tick()
  assert.equal(f.receiver.snapshot().closed,true);assert.equal(f.receiver.snapshot().ready,false)
  assert.equal(f.messages.filter(row=>row.type==='pcm-bind').length,0);assert.equal(f.original.stops,0)
})
