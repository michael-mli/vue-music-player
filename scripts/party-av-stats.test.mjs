import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { collectAvMediaStats } from './party-av-stats.mjs'

test('native source capture counters remain distinct from encoded frames and do not expose track identities or arbitrary report fields', async () => {
  const report = new Map([
    ['source-secret', { type: 'media-source', kind: 'video', frames: 2000, framesPerSecond: 25,
      width: 1280, height: 720, trackIdentifier: 'private-track', id: 'source-secret', privateUrl: 'credential-url' }],
    ['outbound', { type: 'outbound-rtp', kind: 'video', framesEncoded: 1500, frameWidth: 1280,
      frameHeight: 720, mediaSourceId: 'source-secret', codecId: 'codec' }],
    ['codec', { mimeType: 'video/VP8', clockRate: 90000 }],
    ['microphone-source', { type: 'media-source', kind: 'audio', privateAmplitude: .4 }]
  ])
  const realm = { window: { __peers: [{ getStats: async () => report, getSenders: () => [], getReceivers: () => [] }] },
    performance: { timeOrigin: 1000, now: () => 123 } }
  const collect = vm.runInNewContext('('+collectAvMediaStats.toString()+')', realm)
  const result = await collect()
  const source = result.reports.find(row => row.type === 'media-source')
  const encoded = result.reports.find(row => row.type === 'outbound-rtp')
  assert.equal(source.frames, 2000); assert.equal(source.framesPerSecond, 25)
  assert.equal(source.width, 1280); assert.equal(source.height, 720)
  assert.equal(encoded.framesEncoded, 1500); assert.equal(encoded.codec.mimeType, 'video/VP8')
  assert.equal(result.reports.length, 2)
  assert.ok(!/private|credential|source-secret|codecId|mediaSourceId|trackIdentifier/.test(JSON.stringify(result)))
})

test('sender allocation diagnostics retain only bounded priorities and numeric encoding fields',async()=>{
  const encoding={maxBitrate:350000,maxFramerate:25,priority:'high',networkPriority:'high',
    bitratePriority:2,privateUrl:'credential-url',rid:'private-layer'}
  const realm={window:{__peers:[{getStats:async()=>new Map(),getReceivers:()=>[],
    getSenders:()=>[{track:{kind:'video',contentHint:'text'},getParameters:()=>({
      encodings:[encoding],degradationPreference:'maintain-resolution',privateId:'private'})}]}]},
    performance:{timeOrigin:1000,now:()=>123}}
  const collect=vm.runInNewContext('('+collectAvMediaStats.toString()+')',realm)
  const result=await collect(),row=result.senderParameters[0].encodings[0]
  assert.equal(row.priority,'high');assert.equal(row.networkPriority,'high');assert.equal(row.bitratePriority,2)
  assert.equal(row.maxBitrate,350000);assert.ok(!/private|credential|rid/.test(JSON.stringify(result)))
  encoding.priority='private';encoding.networkPriority='private';encoding.bitratePriority=Infinity
  const invalid=(await collect()).senderParameters[0].encodings[0]
  assert.equal(invalid.priority,undefined);assert.equal(invalid.networkPriority,undefined);assert.equal(invalid.bitratePriority,undefined)
})
