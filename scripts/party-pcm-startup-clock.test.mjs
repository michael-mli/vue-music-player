import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {waitForOwnedPcmClock} from './party-pcm-startup-clock.mjs'

function fixture(change=()=>{}){
  let now=0,wall=1000,steps=0,active=true
  const context={state:'running',currentTime:.1,getOutputTimestamp(){return {contextTime:this.currentTime-.03,performanceTime:now-10}}}
  const realm={Date:{now:()=>wall},performance:{now:()=>now},Number,Math,Promise,Error}
  const wait=vm.runInNewContext('('+waitForOwnedPcmClock.toString()+')',realm)
  const sleep=async()=>{now+=100;wall+=100;steps++;context.currentTime+=.1
    change({context,steps,reverseMono:()=>{now-=200},jumpWall:()=>{wall+=500},cancel:()=>{active=false},now})}
  return {context,run:()=>wait(context,()=>active,sleep),steps:()=>steps}
}
test('startup stalls do not contaminate the fixed anchor; three consecutive native intervals are required',async()=>{
  const f=fixture(({context,steps})=>{if(steps<=4)context.currentTime-=.1})
  const anchor=await f.run();assert.equal(f.steps(),7)
  assert.equal(anchor.wall,1700);assert.equal(anchor.frame,19200)
})
test('normal startup anchors the actual context and wall without estimating a device clock',async()=>{
  const f=fixture(),anchor=await f.run();assert.equal(f.steps(),3)
  assert.equal(anchor.wall,1300);assert.equal(anchor.frame,19200)
})
test('a stationary render clock and cumulative interval drift time out instead of passing resume alone',async()=>{
  for(const drift of [0,.02]){
    const f=fixture(({context})=>{context.currentTime-=drift===0?.1:.02})
    await assert.rejects(f.run(),/PLAYOUT_PCM_STARTUP_TIMEOUT/);assert.equal(f.steps(),80)
  }
})
test('invalid native output age or latency cannot establish startup readiness',async()=>{
  for(const invalid of ['age','latency','zero']){
    const f=fixture(({context,now})=>{context.getOutputTimestamp=()=>({
      contextTime:invalid==='zero'?0:context.currentTime-(invalid==='latency'?.25:.03),
      performanceTime:now-(invalid==='age'?250:10)})})
    await assert.rejects(f.run(),/PLAYOUT_PCM_STARTUP_TIMEOUT/)
  }
})
test('reversed clocks and inconsistent wall time terminate rather than restart a readiness window',async()=>{
  for(const action of ['reverseMono','jumpWall']){
    const f=fixture(step=>{if(step.steps===2)step[action]()})
    await assert.rejects(f.run(),/PLAYOUT_PCM_CLOCK/);assert.equal(f.steps(),2)
  }
  const reverse=fixture(({context,steps})=>{if(steps===2)context.currentTime=0})
  await assert.rejects(reverse.run(),/PLAYOUT_PCM_CLOCK/)
})
test('closure or suspension cancels the pending anchor before binding',async()=>{
  for(const kind of ['cancel','suspend']){
    const f=fixture(step=>{if(step.steps===2){if(kind==='cancel')step.cancel();else step.context.state='suspended'}})
    await assert.rejects(f.run(),/PLAYOUT_PCM_STARTUP_CANCELLED/);assert.equal(f.steps(),2)
  }
})
test('invalid initial clock values cannot evade the startup time bound',async()=>{
  const f=fixture();f.context.currentTime=NaN
  await assert.rejects(f.run(),/PLAYOUT_PCM_CLOCK/);assert.equal(f.steps(),0)
  for(const [performanceTime,wall] of [[NaN,1000],[0,NaN],[-1,1000]]){
    const realm={Date:{now:()=>wall},performance:{now:()=>performanceTime},Number,Math,Promise,Error}
    const wait=vm.runInNewContext('('+waitForOwnedPcmClock.toString()+')',realm)
    await assert.rejects(wait({currentTime:.1},()=>true,()=>{throw new Error('must not wait')}),/PLAYOUT_PCM_CLOCK/)
  }
})
