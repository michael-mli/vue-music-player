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
