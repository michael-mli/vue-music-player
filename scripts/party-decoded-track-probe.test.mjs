import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { probeDecodedTracks } from './party-decoded-track-probe.mjs'

function fixture({ audioUnsupported = false, metadataFailure = false, stalled = false } = {}) {
  const counts = { closed: 0, stopped: 0, cancelled: 0, released: 0, originalStops: 0 }
  const originals = ['video', 'audio'].map(kind => ({ kind, stop() { counts.originalStops++ },
    clone() { return { kind, stop() { counts.stopped++ } } } }))
  class Processor {
    constructor({ track, maxBufferSize }) {
      assert.equal(maxBufferSize, 1)
      if (track.kind === 'audio' && audioUnsupported) throw new TypeError('Audio unsupported')
      let index = 0, pending
      this.readable = { getReader: () => ({
        async read() {
          if (stalled) return new Promise(resolve => { pending = resolve })
          return { done: false, value: { timestamp: ++index * 40000,
          ...(track.kind === 'video' ? { codedWidth: 1280, codedHeight: 720 } : { sampleRate: 48000, numberOfChannels: 2, numberOfFrames: 960 }),
          metadata() { if (metadataFailure) throw new Error('Unexpected'); return { rtpTimestamp: index * 3600, captureTime: index * 40, privateData: 'secret' } },
          close() { counts.closed++ } } } },
        async cancel() { counts.cancelled++; pending?.({ done: true }) }, releaseLock() { counts.released++ }
      }) }
    }
  }
  const realm = { MediaStreamTrackProcessor: Processor,
    setTimeout: stalled ? callback => setTimeout(callback, 1) : setTimeout, clearTimeout }
  const probe = vm.runInNewContext('('+probeDecodedTracks.toString()+')', realm)
  const peers = [{ getReceivers: () => originals.map(track => ({ track, getSynchronizationSources: () => [
    { source: 987654, timestamp: 99, rtpTimestamp: 3600, captureTimestamp: 40, secret: 'never-export' }
  ] })) }]
  return { probe: () => probe({ getTracks: () => originals }, peers), counts }
}

test('bounded decoded probe closes every frame and clone without touching performance tracks or exporting payload/SSRC', async () => {
  const f = fixture(), evidence = await f.probe()
  assert.ok(evidence.every(row => row.status === 'complete' && row.records.length === 8 && row.sourceSamples.length === 8))
  assert.deepEqual(f.counts, { closed: 16, stopped: 2, cancelled: 2, released: 2, originalStops: 0 })
  assert.equal(evidence[0].records[0].rtpTimestamp, 3600)
  assert.ok(!/secret|privateData|987654|never-export/.test(JSON.stringify(evidence)))
})

test('unsupported audio processors remain explicit while video frames are observed', async () => {
  const f = fixture({ audioUnsupported: true }), evidence = await f.probe()
  assert.equal(evidence[0].status, 'complete'); assert.equal(evidence[1].status, 'unsupported')
  assert.deepEqual(f.counts, { closed: 8, stopped: 2, cancelled: 1, released: 1, originalStops: 0 })
})

test('unexpected metadata errors propagate and still close resources', async () => {
  const f = fixture({ metadataFailure: true })
  await assert.rejects(f.probe(), /Unexpected/)
  assert.deepEqual(f.counts, { closed: 1, stopped: 1, cancelled: 1, released: 1, originalStops: 0 })
})

test('a processor waiting forever is cancelled and releases readers/clones without claiming capability samples', async () => {
  const f = fixture({ stalled: true }), evidence = await f.probe()
  assert.ok(evidence.every(row => row.status === 'timeout' && row.records.length === 0))
  assert.deepEqual(f.counts, { closed: 0, stopped: 2, cancelled: 4, released: 2, originalStops: 0 })
})
