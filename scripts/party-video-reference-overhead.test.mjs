import test from 'node:test'
import assert from 'node:assert/strict'
import {analyseVideoReferenceOverhead} from './party-video-reference-overhead.mjs'

function samples(){return [0,1,2].map(i=>({phase:'baseline',...Object.fromEntries(
  [['source','send','wrapped'],['receiver','receive','unwrapped']].map(([side,direction,count])=>[side,{
    time:100000+i*8000,videoReferenceEnvelopes:[{worker:side==='source'?7:8,direction,closed:false,error:null,
      version:1,observedAtUnixMs:1000+i*4000,[count]:100+i*100,payloadBytes:10000+i*10000,
      overheadBytes:3800+i*3800,wireBytes:13800+i*13800}]}]))}))}
test('metadata bandwidth uses actual counter publication rather than newer cached sample clocks',()=>{
  const result=analyseVideoReferenceOverhead(samples(),'baseline')
  assert.deepEqual(result.errors,[]);assert.equal(result.paths.length,2)
  for(const path of result.paths){
    assert.equal(path.frames,200);assert.equal(path.durationMs,8000)
    assert.equal(path.metadataBps,7600);assert.equal(path.payloadBps,20000)
    assert.equal(path.envelopeBps,27600);assert.equal(path.metadataBytesPerFrame,38)
  }
  assert.ok(!JSON.stringify(result).includes('worker'))
})
test('ambiguous workers, resets, invalid totals and absent timing cannot establish overhead',()=>{
  for(const corrupt of [
    rows=>rows[1].source.videoReferenceEnvelopes.push({...rows[1].source.videoReferenceEnvelopes[0],worker:9}),
    rows=>rows[1].source.videoReferenceEnvelopes[0].worker=9,
    rows=>rows[1].source.videoReferenceEnvelopes[0].wireBytes=1,
    rows=>rows[1].source.videoReferenceEnvelopes[0].observedAtUnixMs=0,
    rows=>rows[1].source.videoReferenceEnvelopes[0].wrapped=1,
    rows=>delete rows[1].source.videoReferenceEnvelopes[0].observedAtUnixMs,
    rows=>rows[1].source.videoReferenceEnvelopes[0].error='VIDEO_ENVELOPE_INTEGRITY'
  ]){const rows=samples();corrupt(rows);assert.ok(analyseVideoReferenceOverhead(rows,'baseline').errors.length>0)}
})
test('format bounds and insufficient distinct observations reject fabricated bandwidth evidence',()=>{
  const rows=samples()
  for(const row of rows){row.source.videoReferenceEnvelopes[0].overheadBytes=0;row.source.videoReferenceEnvelopes[0].wireBytes=row.source.videoReferenceEnvelopes[0].payloadBytes}
  assert.ok(analyseVideoReferenceOverhead(rows,'baseline').errors.includes('source-invalid-overhead'))
  const stale=samples();for(const row of stale)row.source.videoReferenceEnvelopes[0].observedAtUnixMs=1000
  assert.ok(analyseVideoReferenceOverhead(stale,'baseline').errors.includes('source-insufficient-duration'))
  assert.ok(analyseVideoReferenceOverhead(null,'baseline').errors.includes('invalid-samples'))
})
