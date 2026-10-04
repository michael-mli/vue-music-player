import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {setImmediate as tick} from 'node:timers/promises'
import {installVp8FrameWorker} from './party-vp8-frame-worker.mjs'

function fixture({recover=false,nativeRequest=true,recoveryMs=5000,dependencyAware=false}={}){
  let wall=1000,mono=0,listener,timer,delivered,decoded=0,lateFrames=0,requests=0,streamClosed=false,committedGaps=0,referenceMisses=0
  const reports=[]
  class Port{constructor(){this.messages=[]}postMessage(packet){this.messages.push(packet)}start(){}close(){this.closed=true}}
  const port=new Port()
  const createStream=(deliver,report)=>{delivered=deliver;return {observe(frame){decoded++;if(frame.late)lateFrames++;if(frame.gap)committedGaps++;if(frame.missing)referenceMisses++},snapshot:()=>({closed:streamClosed,decoded,lateFrames,committedGaps,referenceMisses,duplicates:0}),
    close(reason){if(streamClosed)return;streamClosed=true;report({reason})}}}
  const realm={MessagePort:Port,Date:{now:()=>wall},performance:{now:()=>mono},
    __encodedTimingDirection:'receive',addEventListener:(name,callback)=>{listener=callback},
    setInterval:callback=>{timer=callback;return 1},clearInterval:()=>{timer=null},postMessage:row=>reports.push(row),createStream}
  if(nativeRequest)realm.__requestOwnedVideoKeyframe=async()=>{requests++}
  realm.self=realm;realm.recover=recover;realm.recoveryMs=recoveryMs;realm.dependencyAware=dependencyAware
  vm.runInNewContext(`(${installVp8FrameWorker.toString()})(createStream,80,recover,recoveryMs,dependencyAware,dependencyAware?'vp9':'vp8',dependencyAware)`,realm)
  const message=data=>listener({data})
  return {realm,port,reports,message,bind(){message({type:'video-bind',port,expiryUnixMs:10000})},
    send(id,late=false,type='delta',gap=false,missing=false){realm.__observeOwnedVideo({late,type,gap,missing},{});return delivered?.({},{id,bytes:1,captureUnixMs:wall})},
    advance(ms){wall+=ms;mono+=ms;timer?.()},get decoded(){return decoded},get requests(){return requests}}
}
test('native receiver recovery requests only new late references outside cooldown and stops permanently with the worker',async()=>{
  const f=fixture({recover:true});f.bind();f.send(1,false,'key');f.advance(500);f.send(2,true);await tick()
  assert.equal(f.requests,0);f.advance(1000);f.send(3,true);await tick();assert.equal(f.requests,1)
  f.advance(1000);f.send(4,true);await tick();assert.equal(f.requests,1)
  f.advance(4000);f.send(5,true);await tick();assert.equal(f.requests,2)
  f.advance(100);assert.equal(f.reports.at(-1).keyframeFulfilled,2)
  f.message({type:'video-stop'});f.send(6,true);await tick();assert.equal(f.requests,2)
})
test('recovery refuses a worker without the actual receiver request method',()=>{
  const f=fixture({recover:true,nativeRequest:false});f.bind();f.send(1,true)
  assert.equal(f.reports.at(-1).reason,'VIDEO_RECOVERY_API');assert.equal(f.requests,0)
})
test('bounded faster receiver recovery preserves recent-key suppression and closes on rejected requests',async()=>{
  const f=fixture({recover:true,recoveryMs:1000});f.bind();f.send(1,false,'key')
  f.advance(1000);f.send(2,true);await tick();assert.equal(f.requests,1)
  f.advance(500);f.send(3,true);await tick();assert.equal(f.requests,1)
  f.advance(500);f.send(4,true);await tick();assert.equal(f.requests,2)
  f.realm.__requestOwnedVideoKeyframe=async()=>{throw new Error('private rejection')}
  f.advance(1000);f.send(5,true);await tick()
  assert.equal(f.reports.at(-1).reason,'VIDEO_RECOVERY_REQUEST');assert.equal(f.port.closed,true)
})
test('worker decoding warms before binding and transfers at most two credited frames without pausing codec state',()=>{
  const f=fixture();assert.equal(f.send(1),false);f.bind()
  assert.equal(f.send(2),true);assert.equal(f.send(3),true);assert.equal(f.send(4),'wait')
  assert.equal(f.decoded,4);assert.equal(f.port.messages.filter(row=>row.type==='video-frame').length,2)
  f.port.onmessage({data:{type:'video-consumed',id:2,bytes:1}});assert.equal(f.send(5),true)
  f.message({type:'video-stop'});assert.equal(f.port.closed,true)
  assert.equal(f.reports.at(-1).closed,true);assert.equal(f.reports.at(-1).inFlight,0)
})
test('forged frame credits and expiry permanently close the port and cannot rebind or renew it',()=>{
  const f=fixture();f.bind();f.send(1)
  f.port.onmessage({data:{type:'video-consumed',id:1,bytes:2}})
  assert.equal(f.reports.at(-1).reason,'VIDEO_PORT_CREDIT');f.bind()
  assert.equal(f.reports.at(-1).type,'video-port-error')
  const expiry=fixture();expiry.bind();expiry.send(1);expiry.advance(9000)
  assert.equal(expiry.reports.at(-1).reason,'VIDEO_PORT_CLOCK')
  expiry.message({type:'video-renew',expiryUnixMs:20000});assert.equal(expiry.send(2),false)
})

test('encoder pacing gaps never request keyframes without a discarded received reference',async()=>{
  const f=fixture({recover:true});f.bind();f.send(1,false,'key');f.advance(1500)
  f.send(2,false,'delta',true);await tick();assert.equal(f.requests,0)
  f.advance(5000);f.send(3,false,'delta',true);await tick();assert.equal(f.requests,0)
  f.send(4,true);await tick();assert.equal(f.requests,1)
})

test('reference-aware native recovery ignores late unneeded frames and requests only newly missing declared references',async()=>{
  const f=fixture({recover:true,dependencyAware:true});f.bind();f.send(1,false,'key');f.advance(1500)
  f.send(2,true);await tick();assert.equal(f.requests,0)
  f.send(3,false,'delta',false,true);await tick();assert.equal(f.requests,1)
  f.advance(5000);f.send(4,true);await tick();assert.equal(f.requests,1)
})
