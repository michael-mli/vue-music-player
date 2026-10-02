import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { analyseAvObservations, installAvSourceMarkers, installAvObserver } from './party-av-observer.mjs'
import { collectAvMediaStats } from './party-av-stats.mjs'

test('fixture RTC timeline retains encoder/buffer evidence without signaling credentials or missing counter inventions',async t=>{
  const previous=globalThis.window;t.after(()=>{globalThis.window=previous})
  const report=new Map([
    ['audio',{type:'inbound-rtp',kind:'audio',timestamp:1000,ssrc:3,codecId:'codec',jitterBufferEmittedCount:0,
      estimatedPlayoutTimestamp:3999900000000,address:'private-address',usernameFragment:'secret-ice'}],
    ['video',{type:'outbound-rtp',kind:'video',framesEncoded:25,totalEncodeTime:.01,qualityLimitationReason:'bandwidth',
      qualityLimitationDurations:{cpu:0,bandwidth:2,other:Infinity,access_token:'secret-token'},token:'secret-token'}],
    ['codec',{mimeType:'audio/opus',clockRate:48000,channels:2,sdpFmtpLine:'secret-sdp'}],
    ['transport',{type:'transport',selectedCandidatePairId:'ice'}],
    ['ice',{type:'candidate-pair',url:'turns:private-host',credential:'secret-turn',currentRoundTripTime:.7,availableOutgoingBitrate:95000}],
  ])
  const receiver={track:{kind:'audio'},jitterBufferTarget:null}
  globalThis.window={__peers:[{getStats:async()=>report,getReceivers:()=>[receiver]}]}
  const result=await collectAvMediaStats(),[audio,video]=result.reports
  assert.deepEqual(audio.codec,{mimeType:'audio/opus',clockRate:48000,channels:2})
  assert.equal(audio.jitterBufferEmittedCount,0);assert.equal('packetsLost' in audio,false)
  assert.equal(audio.estimatedPlayoutTimestamp,3999900000000)
  assert.equal(video.qualityLimitationReason,'bandwidth');assert.deepEqual(video.qualityLimitationDurations,{cpu:0,bandwidth:2})
  assert.deepEqual(result.receiverTargets,[{peer:0,kind:'audio',targetSupported:true,targetMs:null}])
  assert.equal(receiver.jitterBufferTarget,null)
  assert.deepEqual(result.reports[2],{peer:0,type:'selected-transport',currentRoundTripTime:.7,availableOutgoingBitrate:95000})
  for(const secret of ['private-address','secret-ice','secret-token','secret-sdp','secret-turn','turns:'])assert.ok(!JSON.stringify(result).includes(secret))
})

test('RTC timeline distinguishes unsupported buffering hints and refuses unbounded peer history',async t=>{
  const previous=globalThis.window;t.after(()=>{globalThis.window=previous})
  globalThis.window={__peers:[{getStats:async()=>new Map(),getReceivers:()=>[{track:{kind:'video'}}]}]}
  assert.deepEqual((await collectAvMediaStats()).receiverTargets,[{peer:0,kind:'video',targetSupported:false,targetMs:null}])
  window.__peers=Array(17).fill({})
  await assert.rejects(collectAvMediaStats,/AV_STATS_PEER_LIMIT/)
})

test('actual output detector passes PCM edge timing and interrupted-input tests', async () => {
  const {stderr}=await promisify(execFile)('python3',['scripts/party-av-pulse-capture.test.py'],{timeout:10000})
  assert.match(stderr,/Ran 5 tests/);assert.match(stderr,/OK/)
})

test('measurement pairs matching states within one clock domain and reports signed skew', () => {
  const video = [1, 2, 3].map(id => ({ id, phase: 'baseline', on: id % 2 === 0, time: 2000 * id + 100, callbackLagMs: 16 }))
  const audio = [1, 2, 3].map(id => ({ phase: 'baseline', on: id % 2 === 0, time: 2000 * id + (id === 1 ? 120 : 50), analysisWindowMs: 23.2 }))
  const sources = [1, 2, 3].map(id => ({ id, time: 2000 * id }))
  const result = analyseAvObservations({ video, audio, sources }, 'baseline')
  assert.equal(result.count, 3)
  assert.deepEqual(result.pairs.map(item => item.skewMs), [-20, 50, 50])
  assert.deepEqual(result.absoluteSkewMs, { p50: 50, p95: 50, max: 50 })
  assert.deepEqual(result.videoDelayMs, { p50: 100, p95: 100, max: 100 })
  assert.deepEqual(result.audioObservationDelayMs, { p50: 50, p95: 120, max: 120 })
  assert.equal(result.unmatchedAudio, 0); assert.deepEqual(result.unmatchedVideo, [])
})

test('wrong states, missing source markers and unmatched cycles remain visible', () => {
  const video = [{ id: 1, on: false, phase: 'impaired', time: 2100 }, { id: 2, on: true, phase: 'impaired', time: 4100 }]
  const audio = [{ on: true, phase: 'impaired', time: 2100 }, { on: true, phase: 'impaired', time: 4100 }]
  const result = analyseAvObservations({ video, audio, sources: [{ id: 1, time: 2000 }] }, 'impaired')
  assert.equal(result.count, 0)
  assert.deepEqual(result.unmatchedVideo, [1, 2]); assert.equal(result.unmatchedAudio, 2)
  assert.equal(result.absoluteSkewMs.p95, null)
})

test('reused marker IDs select the current capture without borrowing future redraws', () => {
  const video = [{ id: 2, phase: 'handover', on: true, time: 10100 }]
  const audio = [{ phase: 'handover', on: true, time: 10080 }]
  const sources = [{ id: 2, time: 2000 }, { id: 2, time: 10000 }, { id: 2, time: 12000 }]
  const measured = analyseAvObservations({ audio, video, sources }, 'handover')
  assert.equal(measured.count, 1)
  assert.equal(measured.pairs[0].videoDelayMs, 100)
  assert.equal(measured.pairs[0].audioObservationDelayMs, 80)
  assert.equal(measured.pairs[0].skewMs, 20)
  const missing = analyseAvObservations({ audio, video, sources: sources.slice(2) }, 'handover')
  assert.equal(missing.count, 0)
  assert.deepEqual(missing.unmatchedVideo, [2])
  assert.equal(missing.unmatchedAudio, 1)
})

test('captured marker protocol crosses 63 and preserves full byte IDs and parity',t=>{
  const previous={window:globalThis.window,document:globalThis.document,canvas:globalThis.CanvasRenderingContext2D}
  const data=new Uint8ClampedArray(416*32*4)
  let callback
  class Context {
    canvas={width:1280,height:720};fillStyle='';draws=[]
    fillText(...args){this.draws.push(args)} save(){} restore(){}
    fillRect(x){data[(16*416+x-64+16)*4]=this.fillStyle==='#ffffff'?230:10}
  }
  const video={videoWidth:1280,videoHeight:720,requestVideoFrameCallback(work){callback=work;return 1},cancelVideoFrameCallback(){}}
  globalThis.window={};globalThis.CanvasRenderingContext2D=Context
  globalThis.document={querySelector:()=>video,createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>({data})})})}
  t.after(()=>{globalThis.window=previous.window;globalThis.document=previous.document;globalThis.CanvasRenderingContext2D=previous.canvas})
  installAvSourceMarkers();installAvObserver()
  const context=new Context(),frame=id=>{
    context.fillText(`AV${id%2?'OFF':'ON'}${id}`,64,300)
    callback(100,{expectedDisplayTime:116,rtpTimestamp:123,mediaTime:1})
  }
  frame(63);window.__avObserver.begin('baseline');frame(64);frame(255)
  assert.deepEqual(window.__avSources.map(item=>item.id),[63,64,255])
  assert.deepEqual(window.__avObserver.evidence.video.map(item=>[item.id,item.on]),[[64,true],[255,false]])
  assert.equal(window.__avObserver.evidence.video[0].expectedDisplayTime,116)
  assert.equal('captureTime' in window.__avObserver.evidence.video[0],false)
  assert.equal(context.draws.length,3)
  data[(16*416+12*32+16)*4]=data[(16*416+12*32+16)*4]>128?10:230
  callback(100,{expectedDisplayTime:116})
  assert.equal(window.__avObserver.evidence.invalidFrames,1)
  assert.equal(window.__avObserver.evidence.video.length,2)
  assert.throws(()=>context.fillText('AVON256',64,300),/AV_MARKER_ID_LIMIT/)
  window.__avObserver.close()
})
