import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {installSenderPriorityExperiment} from './party-sender-priority-experiment.mjs'

function fixture({unsupported=false,reject=false,changed=false}={}){
  let tick,cleared=false,calls=0
  const audio={track:{kind:'audio',readyState:'live'},getParameters(){throw new Error('audio must remain untouched')}}
  const params={degradationPreference:'maintain-resolution',encodings:[{priority:unsupported?undefined:'low',
    networkPriority:'low',maxBitrate:350000,maxFramerate:25,active:true}]}
  const video={track:{kind:'video',readyState:'live'},getParameters:()=>structuredClone(params),
    async setParameters(next){calls++;if(reject)throw new Error('native rejection');Object.assign(params,next)
      if(changed)params.encodings[0].networkPriority='high'}}
  const realm={window:{__peers:[{getSenders:()=>[audio,video]}]},setInterval:f=>{tick=f;return 1},clearInterval:()=>{cleared=true}}
  vm.runInNewContext(`(${installSenderPriorityExperiment.toString()})()`,realm)
  return {params,video,realm,get calls(){return calls},get cleared(){return cleared},
    async step(){tick();await new Promise(resolve=>setImmediate(resolve))},snapshot:()=>realm.window.__avSenderPriority.snapshot()}
}
test('equal source allocation changes only video local priority and retains caps, network priority and audio',async()=>{
  const f=fixture();await f.step();assert.equal(f.calls,1);assert.equal(f.params.encodings[0].priority,'high')
  assert.equal(f.params.encodings[0].networkPriority,'low');assert.equal(f.params.encodings[0].maxBitrate,350000)
  assert.equal(f.params.encodings[0].maxFramerate,25);assert.equal(f.snapshot().applied,1)
  await f.step();assert.equal(f.calls,1)
  f.params.encodings[0].priority='low';await f.step();assert.equal(f.calls,2)
  f.realm.window.__avSenderPriority.close();f.params.encodings[0].priority='low';await f.step();assert.equal(f.calls,2)
})
test('unsupported, rejected and changed priority transactions stop permanently',async()=>{
  for(const [options,reason] of [[{unsupported:true},'SOURCE_PRIORITY_API'],[{reject:true},'SOURCE_PRIORITY_SETTER'],
    [{changed:true},'SOURCE_PRIORITY_READBACK']]){
    const f=fixture(options);await f.step();assert.equal(f.snapshot().failures[0],reason);assert.equal(f.cleared,true)
    const calls=f.calls;await f.step();assert.equal(f.calls,calls)
  }
})
test('allocation waits for the exact nominal profile and never touches another source encoding',async()=>{
  const f=fixture();f.params.encodings[0].maxBitrate=200000;await f.step();assert.equal(f.calls,0)
  f.params.encodings[0].maxBitrate=350000;f.params.encodings[0].maxFramerate=15;await f.step();assert.equal(f.calls,0)
  f.params.encodings[0].maxFramerate=25;await f.step();assert.equal(f.calls,1)
})
