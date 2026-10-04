import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {createOwnedVideoReceiver} from './party-owned-video-receiver.mjs'

function fixture(){
  const channels=[],messages=[]
  class Port{constructor(){this.messages=[]}postMessage(data){this.messages.push(data)}start(){}close(){this.closed=true}}
  class Frame{constructor(){this.codedWidth=1280;this.codedHeight=720;this.closes=0}allocationSize(){return 100}close(){this.closes++}}
  const worker={postMessage:packet=>messages.push(packet)},track={}
  const realm={ReadableStream,VideoFrame:Frame,Date:{now:()=>1000},
    MessageChannel:class{constructor(){this.port1=new Port();this.port2=new Port();channels.push(this)}},
    setInterval:()=>1,clearInterval(){},setTimeout:()=>2,clearTimeout(){},
    window:{__encodedTimingProbe:{receiverWorker:item=>item===track?worker:null,workerId:()=>1,videoStates:[]}},track}
  const adapter=vm.runInNewContext(`(${createOwnedVideoReceiver.toString()})(track)`,realm)
  const send=(id,frame=new Frame())=>{channels[0].port1.onmessage({data:{type:'video-frame',id,frame,bytes:100,captureUnixMs:1000+id*40,rtpTimestamp:id*3600}});return frame}
  return {adapter,send,channels,messages,Frame}
}
test('adapter transfers exact received frame ownership and credits only after the caller accepts the packet',async()=>{
  const f=fixture(),reader=f.adapter.readable.getReader(),frame=f.send(1)
  const {value}=await reader.read();assert.equal(value.frame,frame);assert.equal(frame.closes,0)
  assert.equal(f.channels[0].port1.messages.length,0)
  f.adapter.consumed(value);assert.equal(f.channels[0].port1.messages[0].type,'video-consumed')
  assert.equal(f.adapter.snapshot().inFlight,0);frame.close();await reader.cancel()
})
test('overflow closes every transferred frame, drains late arrivals and prevents revival after stop',()=>{
  const f=fixture(),frames=[f.send(1),f.send(2),f.send(3)]
  assert.equal(f.adapter.snapshot().error,'PLAYOUT_VIDEO_TRANSFER')
  assert.ok(frames.every(frame=>frame.closes===1));assert.equal(f.adapter.snapshot().inFlight,0)
  const late=f.send(4);assert.equal(late.closes,1)
  f.channels[0].port1.onmessage({data:{type:'video-stop'}})
  assert.equal(f.channels[0].port1.closed,true)
})
