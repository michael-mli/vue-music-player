import test from 'node:test'
import assert from 'node:assert/strict'
import { keyframeRecoveryStep } from './party-keyframe-recovery.mjs'

const sample = (time = 1000, frames = 25, lag = 0, keys = 1) => ({ time,
  audio: { timestamp: time, ssrc: 1, estimatedPlayoutTimestamp: 4000000000000 + time },
  video: { timestamp: time, ssrc: 2, estimatedPlayoutTimestamp: 4000000000000 + time + lag,
    framesDecoded: frames, keyFramesDecoded: keys } })
const step = (row, state) => keyframeRecoveryStep(row.time, row.audio, row.video, state)
const ownedStep=(row,state,lateFrames=0,extra={})=>keyframeRecoveryStep(row.time,row.audio,row.video,state,
  {worker:1,configured:true,closed:false,lateFrames,...extra})
test('owned late-reference recovery uses advancing discards with the existing cooldown and decoded-key suppression',()=>{
  let state=ownedStep(sample()).state
  const repair=ownedStep(sample(2000,50),state,1)
  assert.equal(repair.request,true);assert.equal(repair.reason,'late-reference');state=repair.state
  for(let time=3000;time<7000;time+=1000){
    const next=ownedStep(sample(time,time/40),state,time/1000)
    assert.equal(next.request,false);state=next.state
  }
  assert.equal(ownedStep(sample(7000,175),state,7).request,true)
  assert.equal(ownedStep(sample(7000,175,0,2),state,7).request,false)
  assert.equal(ownedStep(sample(7000,175),state,state.lateFrames).request,false)
})
test('owned recovery rejects missing, closed, switched or reversed decoder evidence',()=>{
  const state=ownedStep(sample(),undefined,5).state
  for(const extra of [{closed:true},{configured:false},{worker:2},{worker:undefined},{lateFrames:4},{lateFrames:undefined}]){
    const next=ownedStep(sample(2000,50),state,6,extra)
    assert.equal(next.valid,false);assert.equal(next.request,false)
  }
})
test('native delay recovery seeds evidence and requests only bounded lag or stalled decoded frames', () => {
  const first = step(sample())
  assert.equal(first.request, false)
  assert.equal(step(sample(2000, 50, -150), first.state).request, false)
  const delayed = step(sample(2000, 50, -200), first.state)
  assert.equal(delayed.request, true); assert.equal(delayed.reason, 'video-behind')
  const stalled = step(sample(2000, 25), first.state)
  assert.equal(stalled.request, true); assert.equal(stalled.reason, 'frame-stalled')
  assert.equal(step(sample(2000, 50, -2500), first.state).request, false)
})
test('native recovery suppresses recent decoded keyframes and enforces a five-second request interval', () => {
  let state = step(sample()).state
  assert.equal(step(sample(2000, 50, -200, 2), state).request, false)
  state = step(sample(2000, 50, -200), state).state
  for (let time = 3000; time < 7000; time += 1000) {
    const next = step(sample(time, time / 40, -200), state)
    assert.equal(next.request, false); state = next.state
  }
  assert.equal(step(sample(7000, 175, -200), state).request, true)
})
test('missing estimates remain missing and changed paths, reset counters or stale observations fail validation', () => {
  const state = step(sample()).state
  assert.equal(step(sample(2000, 50, -200), { ...state, time: undefined }).valid, false)
  const noEstimate = sample(2000, 50); delete noEstimate.video.estimatedPlayoutTimestamp
  assert.equal(step(noEstimate, state).request, false)
  assert.equal(step({ ...noEstimate, video: { ...noEstimate.video, framesDecoded: 25 } }, state).request, true)
  for (const change of [
    row => { row.video.ssrc = 9 }, row => { row.video.framesDecoded = 1 },
    row => { row.video.keyFramesDecoded = 0 }, row => { row.video.timestamp += 200 },
    row => { delete row.video.framesDecoded }, row => { row.time = 5000 },
  ]) {
    const row = sample(2000, 50, -200); change(row)
    assert.equal(step(row, state).valid, false)
    assert.equal(step(row, state).request, false)
  }
})
