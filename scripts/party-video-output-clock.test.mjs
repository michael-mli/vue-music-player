import test from 'node:test'
import assert from 'node:assert/strict'
import {contextVideoOutputTimestamp} from './party-video-output-clock.mjs'

test('video timestamps follow the existing native context despite a different wall-clock rate',()=>{
  const context={state:'running',currentTime:12.5},before=JSON.stringify(context)
  const first=contextVideoOutputTimestamp(context,-Infinity)
  assert.equal(first,12500000);assert.equal(JSON.stringify(context),before)
  context.currentTime+=.016
  assert.equal(contextVideoOutputTimestamp(context,first),12516000)
  assert.equal(contextVideoOutputTimestamp({state:'running',currentTime:0},-Infinity),0)
})
test('clock failures retain only fixed categories for native diagnosis',()=>{
  for(const [context,previous,reason] of [
    [{state:'closed',currentTime:12},-Infinity,'CONTEXT_NOT_RUNNING'],
    [{state:'running',currentTime:NaN},-Infinity,'INVALID_CLOCK'],
    [{state:'running',currentTime:12},12000000,'UNCHANGED_CLOCK'],
    [{state:'running',currentTime:11},12000000,'REVERSED_CLOCK']
  ])assert.throws(()=>contextVideoOutputTimestamp(context,previous),error=>error.message==='PLAYOUT_VIDEO_OUTPUT_CLOCK'&&error.reason===reason)
})
test('suspended, unchanged, reversed, invalid or unrepresentable native clocks never synthesize timestamps',()=>{
  for(const [context,previous] of [[{state:'suspended',currentTime:12.5},-Infinity],
    [{state:'closed',currentTime:12.5},-Infinity],[{state:'running',currentTime:12.5},12500000],
    [{state:'running',currentTime:12.4},12500000],[{state:'running',currentTime:NaN},-Infinity],
    [{state:'running',currentTime:Infinity},-Infinity],[{state:'running',currentTime:-1},-Infinity],
    [{state:'running',currentTime:Number.MAX_SAFE_INTEGER},-Infinity],
    [{state:'running',currentTime:12.5},NaN],[{state:'running',currentTime:12.5},-1],
    [null,-Infinity]])assert.throws(()=>contextVideoOutputTimestamp(context,previous),/PLAYOUT_VIDEO_OUTPUT_CLOCK/)
})
