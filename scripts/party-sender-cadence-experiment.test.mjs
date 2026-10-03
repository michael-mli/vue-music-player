import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { installSenderCadenceExperiment } from './party-sender-cadence-experiment.mjs'

function fixture(fail = false) {
  const calls = [], result = {}
  class Peer {
    addTransceiver(...args) { calls.push(args); if (fail) throw new Error('native'); return result }
  }
  const realm = { window: { RTCPeerConnection: Peer } }
  vm.runInNewContext(`(${installSenderCadenceExperiment.toString()})()`, realm)
  return { calls, result, realm, peer: new realm.window.RTCPeerConnection() }
}
const encoding = () => ({ active: true, maxBitrate: 350000, maxFramerate: 25 })
test('cadence experiment preserves native identity, caller options and other media paths', () => {
  const f = fixture(), track = { kind: 'video', contentHint: '' }
  const init = { direction: 'sendonly', streams: [{}], sendEncodings: [encoding()] }
  assert.equal(f.peer.addTransceiver(track, init), f.result)
  assert.equal(track.contentHint, 'text')
  assert.equal(f.calls[0][1].streams, init.streams)
  assert.equal(f.calls[0][1].sendEncodings[0].active, true)
  assert.equal(f.calls[0][1].sendEncodings[0].scalabilityMode, 'L1T2')
  assert.equal(init.sendEncodings[0].scalabilityMode, undefined)
  for (const [t, i] of [[{ kind: 'audio' }, init], [track, { direction: 'recvonly' }], ['video', init]]) {
    assert.equal(f.peer.addTransceiver(t, i), f.result)
    assert.equal(f.calls.at(-1)[0], t); assert.equal(f.calls.at(-1)[1], i)
  }
  assert.equal(f.realm.window.__senderCadenceExperiment.configured, 1)
})
test('cadence experiment rejects changed quality settings and restores hint on native rejection', () => {
  for (const e of [{ ...encoding(), maxBitrate: 900000 }, { ...encoding(), maxFramerate: 10 },
    { ...encoding(), scalabilityMode: 'L1T3' }]) {
    const f = fixture(), track = { kind: 'video', contentHint: 'motion' }
    assert.throws(() => f.peer.addTransceiver(track, { direction: 'sendonly', sendEncodings: [e] }), /CADENCE_ENCODING_POLICY/)
    assert.equal(f.calls.length, 0); assert.equal(track.contentHint, 'motion')
  }
  const f = fixture(true), track = { kind: 'video', contentHint: 'motion' }
  assert.throws(() => f.peer.addTransceiver(track, { direction: 'sendonly', sendEncodings: [encoding()] }), /native/)
  assert.equal(track.contentHint, 'motion'); assert.equal(f.realm.window.__senderCadenceExperiment.configured, 0)
})
