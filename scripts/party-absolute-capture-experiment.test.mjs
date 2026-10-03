import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { installAbsoluteCaptureExperiment } from './party-absolute-capture-experiment.mjs'

const uri = 'http://www.webrtc.org/experiments/rtp-hdrext/abs-capture-time'
function fixture({ supported = true, absent = false, fail = false } = {}) {
  const mid = { uri: 'urn:ietf:params:rtp-hdrext:sdes:mid', direction: 'sendrecv' },
    twcc = { uri: 'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01', direction: 'sendonly' }
  class Transceiver {
    constructor(kind) { this.receiver = { track: { kind } }; this.extensions = [mid, twcc,
      ...(absent ? [] : [{ uri, direction: 'stopped', preferredId: 7 }])]; this.requests = [] }
    getHeaderExtensionsToNegotiate() { return this.extensions }
    setHeaderExtensionsToNegotiate(extensions) {
      if (fail) throw new Error('Unavailable')
      this.requests.push(extensions); this.extensions = extensions
    }
  }
  if (!supported) delete Transceiver.prototype.setHeaderExtensionsToNegotiate
  const offer = {}, answer = {}
  class Peer {
    constructor() { this.transceivers = [] }
    addTransceiver(kind) { const value = new Transceiver(kind); this.transceivers.push(value); return value }
    getTransceivers() { return this.transceivers }
    createOffer() { return offer }
    createAnswer() { return answer }
  }
  const realm = { RTCRtpTransceiver: Transceiver, window: { RTCPeerConnection: Peer } }
  vm.runInNewContext('('+installAbsoluteCaptureExperiment.toString()+')()', realm)
  return { realm, mid, twcc, offer, answer, peer: () => new realm.window.RTCPeerConnection() }
}

test('capture negotiation preserves extension order, mandatory/feedback capabilities and native offer/answer identity', () => {
  const f = fixture(), peer = f.peer(), transceiver = peer.addTransceiver('audio')
  assert.deepEqual(Array.from(transceiver.extensions, item => item.uri), [f.mid.uri, f.twcc.uri, uri])
  assert.equal(transceiver.extensions[0], f.mid); assert.equal(transceiver.extensions[1], f.twcc)
  assert.equal(transceiver.extensions[2].direction, 'sendrecv')
  assert.equal(transceiver.extensions[2].preferredId, 7)
  assert.equal(peer.createOffer(), f.offer); assert.equal(peer.createAnswer(), f.answer)
  assert.equal(transceiver.requests.length, 1)
  // Renegotiation can copy the previous answer's stopped capability.
  transceiver.extensions[2].direction = 'stopped'
  peer.createOffer()
  assert.equal(transceiver.requests.length, 2)
  assert.equal(f.realm.window.__absoluteCaptureExperiment.configured, 2)
})

test('missing APIs or unsupported capture extensions do not fabricate capabilities', () => {
  for (const options of [{ supported: false }, { absent: true }]) {
    const f = fixture(options), peer = f.peer(), transceiver = peer.addTransceiver('video')
    peer.createOffer(); peer.createAnswer()
    assert.equal(transceiver.requests.length, 0)
    assert.equal(transceiver.extensions[0], f.mid); assert.equal(transceiver.extensions[1], f.twcc)
    assert.equal(f.realm.window.__absoluteCaptureExperiment.configured, 0)
    assert.equal(f.realm.window.__absoluteCaptureExperiment.failures, 0)
  }
})

test('API failures are visible and long negotiations retain a fixed evidence ceiling', () => {
  const failed = fixture({ fail: true })
  failed.peer().addTransceiver('audio')
  assert.equal(failed.realm.window.__absoluteCaptureExperiment.failures, 1)
  assert.equal(failed.realm.window.__absoluteCaptureExperiment.configured, 0)
  const f = fixture(), peer = f.peer()
  for (let i = 0; i < 200; i++) peer.addTransceiver('video')
  const evidence = f.realm.window.__absoluteCaptureExperiment
  assert.equal(evidence.configured, 200)
  assert.equal(evidence.evidence.length, 64)
  assert.ok(evidence.evidence.every(row => row.kind === 'video' && row.previous === 'stopped'))
  assert.ok(!JSON.stringify(evidence.evidence).includes('http'))
})
