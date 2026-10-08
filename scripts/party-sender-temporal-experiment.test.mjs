import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { installSenderTemporalExperiment } from './party-sender-temporal-experiment.mjs'

function fixture(fail = false,codec='vp9') {
  const calls = [], result = {}
  class Peer { addTransceiver(...args) { calls.push(args); if (fail) throw new Error('native'); return result } }
  const realm = { window: { RTCPeerConnection: Peer } }
  vm.runInNewContext(`(${installSenderTemporalExperiment.toString()})(${JSON.stringify(codec)})`, realm)
  return { calls, result, realm, peer: new realm.window.RTCPeerConnection() }
}
const encoding = () => ({ active: true, maxBitrate: 350000, maxFramerate: 25, scalabilityMode: 'L1T3' })
test('temporal comparison changes only native temporal structure and preserves the caller and other media', () => {
  const f = fixture(), track = { kind: 'video', contentHint: 'motion' }
  const init = { direction: 'sendonly', streams: [{}], sendEncodings: [encoding()] }
  assert.equal(f.peer.addTransceiver(track, init), f.result)
  assert.equal(f.calls[0][0], track); assert.equal(track.contentHint, 'motion')
  assert.equal(f.calls[0][1].streams, init.streams)
  assert.equal(f.calls[0][1].sendEncodings[0].maxBitrate, 350000)
  assert.equal(f.calls[0][1].sendEncodings[0].maxFramerate, 25)
  assert.equal(f.calls[0][1].sendEncodings[0].active, true)
  assert.equal(f.calls[0][1].sendEncodings[0].scalabilityMode, 'L1T1')
  assert.equal(init.sendEncodings[0].scalabilityMode, 'L1T3')
  for (const [t, i] of [[{ kind: 'audio' }, init], [track, { direction: 'recvonly' }], ['video', init]]) {
    assert.equal(f.peer.addTransceiver(t, i), f.result)
    assert.equal(f.calls.at(-1)[0], t); assert.equal(f.calls.at(-1)[1], i)
  }
  assert.equal(f.realm.window.__senderTemporalExperiment.snapshot().configured, 1)
})
test('explicit VP8 temporal comparison preserves nominal caps and reports its declared codec',()=>{
  const f=fixture(false,'vp8'),track={kind:'video',contentHint:''}
  const vp8Encoding=encoding();delete vp8Encoding.scalabilityMode
  const init={direction:'sendonly',sendEncodings:[vp8Encoding]}
  f.peer.addTransceiver(track,init)
  assert.equal(f.calls[0][1].sendEncodings[0].scalabilityMode,'L1T1')
  assert.equal(f.calls[0][1].sendEncodings[0].maxBitrate,350000)
  assert.equal(f.calls[0][1].sendEncodings[0].maxFramerate,25)
  assert.equal(init.sendEncodings[0].scalabilityMode,undefined)
  assert.equal(track.contentHint,'')
  assert.equal(f.realm.window.__senderTemporalExperiment.snapshot().codec,'vp8')
  assert.equal(fixture().realm.window.__senderTemporalExperiment.snapshot().codec,'vp9')
  for(const codec of ['h264','VP8',null,{}])assert.throws(()=>fixture(false,codec),/TEMPORAL_CODEC_CONFIG/)
  for(const [hint,mode] of [['motion',undefined],['','L1T3'],['','L1T2']]){
    const rejected=fixture(false,'vp8')
    assert.throws(()=>rejected.peer.addTransceiver({kind:'video',contentHint:hint},
      {direction:'sendonly',sendEncodings:[{...vp8Encoding,scalabilityMode:mode}]}),/TEMPORAL_ENCODING_POLICY/)
    assert.equal(rejected.calls.length,0)
  }
})
test('temporal comparison rejects changed quality or source policy and does not count a native rejection', () => {
  for (const e of [{ ...encoding(), maxBitrate: 900000 }, { ...encoding(), maxFramerate: 10 },
    { ...encoding(), scalabilityMode: 'L1T2' }]) {
    const f = fixture()
    assert.throws(() => f.peer.addTransceiver({ kind: 'video', contentHint: 'motion' },
      { direction: 'sendonly', sendEncodings: [e] }), /TEMPORAL_ENCODING_POLICY/)
    assert.equal(f.calls.length, 0)
  }
  const f = fixture(true), track = { kind: 'video', contentHint: 'motion' }
  assert.throws(() => f.peer.addTransceiver(track, { direction: 'sendonly', sendEncodings: [encoding()] }), /native/)
  assert.equal(track.contentHint, 'motion'); assert.equal(f.realm.window.__senderTemporalExperiment.snapshot().configured, 0)
})
