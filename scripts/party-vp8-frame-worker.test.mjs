import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {setImmediate as tick} from 'node:timers/promises'
import {installVp8FrameWorker} from './party-vp8-frame-worker.mjs'

function fixture({recover=false,nativeRequest=true,recoveryMs=5000,dependencyAware=false,recoveryWaitMs=350}={}){
  let wall=1000,mono=0,listener,timer,delivered,decoded=0,lateFrames=0,requests=0,streamClosed=false,committedGaps=0,referenceMisses=0,missingReferenceWaitMs=0
  const reports=[]
  class Port{constructor(){this.messages=[]}postMessage(packet){this.messages.push(packet)}start(){}close(){this.closed=true}}
  const port=new Port()
  const createStream=(deliver,report)=>{delivered=deliver;return {observe(frame){decoded++;if(frame.late)lateFrames++;if(frame.gap)committedGaps++;if(frame.missing)referenceMisses++},snapshot:()=>({closed:streamClosed,decoded,lateFrames,committedGaps,referenceMisses,missingReferenceWaitMs,duplicates:0}),
    close(reason){if(streamClosed)return;streamClosed=true;report({reason})}}}
  const realm={MessagePort:Port,Date:{now:()=>wall},performance:{now:()=>mono},
    __encodedTimingDirection:'receive',addEventListener:(name,callback)=>{listener=callback},
    setInterval:callback=>{timer=callback;return 1},clearInterval:()=>{timer=null},postMessage:row=>reports.push(row),createStream}
  if(nativeRequest)realm.__requestOwnedVideoKeyframe=async()=>{requests++}
  realm.self=realm;realm.recover=recover;realm.recoveryMs=recoveryMs;realm.dependencyAware=dependencyAware;realm.recoveryWaitMs=recoveryWaitMs
  vm.runInNewContext(`(${installVp8FrameWorker.toString()})(createStream,80,recover,recoveryMs,dependencyAware,dependencyAware?'vp9':'vp8',dependencyAware,null,recoveryWaitMs)`,realm)
  const message=data=>listener({data})
  return {realm,port,reports,message,bind(){message({type:'video-bind',port,expiryUnixMs:10000})},
    send(id,late=false,type='delta',gap=false,missing=false){realm.__observeOwnedVideo({late,type,gap,missing},{});return delivered?.({},{id,bytes:1,captureUnixMs:wall})},
    advance(ms){wall+=ms;mono+=ms;timer?.()},waiting(ms){missingReferenceWaitMs=ms},get decoded(){return decoded},get requests(){return requests}}
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

test('persistent declared-reference waits request bounded native recovery before discard without needing new input',async()=>{
  const f=fixture({recover:true,dependencyAware:true,recoveryMs:1000});f.bind();f.send(1,false,'key')
  f.advance(1500);f.waiting(349);f.advance(100);await tick();assert.equal(f.requests,0)
  f.waiting(350);f.advance(100);await tick();assert.equal(f.requests,1)
  f.advance(500);await tick();assert.equal(f.requests,1)
  f.waiting(0);f.advance(500);await tick();assert.equal(f.requests,1)
  f.waiting(400);f.advance(100);await tick();assert.equal(f.requests,2)
  f.advance(100);assert.equal(f.reports.at(-1).keyframeEarlyRequests,2)
  f.send(2,false,'key');f.advance(500);await tick();assert.equal(f.requests,2)
  f.message({type:'video-stop'});f.advance(1000);await tick();assert.equal(f.requests,2)
  const disabled=fixture({dependencyAware:true});disabled.bind();disabled.waiting(700);disabled.advance(1500)
  await tick();assert.equal(disabled.requests,0)
  const spacing=fixture({recover:true});spacing.bind();spacing.waiting(700);spacing.advance(1500)
  await tick();assert.equal(spacing.requests,0)
})

test('explicit earlier reference feedback preserves recent-key suppression, cooldown and terminal closure',async()=>{
  const f=fixture({recover:true,dependencyAware:true,recoveryMs:1000,recoveryWaitMs:100});f.bind();f.send(1,false,'key')
  f.waiting(99);f.advance(1500);await tick();assert.equal(f.requests,0)
  f.waiting(100);f.advance(100);await tick();assert.equal(f.requests,1)
  f.advance(100);assert.equal(f.reports.at(-1).recoveryWaitMs,100)
  f.advance(800);await tick();assert.equal(f.requests,1)
  f.send(2,false,'key');f.advance(900);await tick();assert.equal(f.requests,1)
  f.advance(100);await tick();assert.equal(f.requests,2)
  f.message({type:'video-stop'});f.advance(2000);await tick();assert.equal(f.requests,2)
})
test('earlier reference feedback rejects unsupported thresholds or an unrelated decoder/recovery policy',()=>{
  for(const recoveryWaitMs of [99,101,351,NaN])
    assert.throws(()=>fixture({recover:true,dependencyAware:true,recoveryWaitMs}),/VIDEO_RECOVERY_CONFIG/)
  assert.throws(()=>fixture({recoveryWaitMs:100,dependencyAware:true}),/VIDEO_RECOVERY_CONFIG/)
  assert.throws(()=>fixture({recoveryWaitMs:100,recover:true}),/VIDEO_RECOVERY_CONFIG/)
})
