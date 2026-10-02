import test from 'node:test'
import assert from 'node:assert/strict'
import { publisherRembSdp, installPublisherRembExperiment } from './party-publisher-feedback.mjs'

const section = direction => ['m=video 9 UDP/TLS/RTP/SAVPF 96', 'a=' + direction,
  'a=rtcp-fb:96 transport-cc', 'a=rtcp-fb:96 goog-remb', 'a=rtcp-fb:96 nack',
  'a=rtcp-fb:96 nack pli', 'a=rtcp-fb:96 ccm fir',
  'a=extmap:4 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
  'a=extmap:5 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
  'a=ssrc:123 cname:owned', 'a=msid:stream track'].join('\r\n') + '\r\n'
test('publisher estimator experiment removes only sendonly-video TWCC and preserves every other SDP byte', () => {
  const header = 'v=0\r\na=ice-pwd:secret\r\na=fingerprint:private\r\n'
  const audio = 'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendonly\r\na=rtcp-fb:111 transport-cc\r\n'
  const receive = section('recvonly'), send = section('sendonly')
  const expectedSend = send.split('\r\n').filter(line => !line.includes('transport-cc') && !line.includes('transport-wide-cc')).join('\r\n')
  assert.equal(publisherRembSdp(header + audio + receive + send), header + audio + receive + expectedSend)
  assert.equal(publisherRembSdp(header + receive), header + receive)
  assert.equal(publisherRembSdp(header + section('sendrecv')), header + section('sendrecv'))
})
test('missing REMB or absolute-send-time, multiple senders and oversized input fail before negotiation', () => {
  for (const sdp of [section('sendonly').replace('a=rtcp-fb:96 goog-remb\r\n', ''),
    section('sendonly').replace('a=extmap:5 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time\r\n', '')])
    assert.throws(() => publisherRembSdp(sdp), /AV_PUBLISHER_REMB_UNSUPPORTED/)
  assert.throws(() => publisherRembSdp(section('sendonly').repeat(2)), /AV_PUBLISHER_FEEDBACK_AMBIGUOUS/)
  assert.throws(() => publisherRembSdp('x'.repeat(262145)), /AV_PUBLISHER_FEEDBACK_SDP_LIMIT/)
})
test('native offer/answer calls retain their receiver and options and close restores owned wrappers', async t => {
  const previous = globalThis.window
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous })
  const calls = []
  class Peer {
    async createOffer(...args) { calls.push([this, args]); return { type: 'offer', sdp: section('sendonly') } }
    async createAnswer(...args) { calls.push([this, args]); return { type: 'answer', sdp: section('recvonly') } }
  }
  const original = Peer.prototype.createOffer
  globalThis.window = { RTCPeerConnection: Peer }
  installPublisherRembExperiment(publisherRembSdp)
  const peer = new Peer(), options = { iceRestart: true }
  const offer = await peer.createOffer(options), answer = await peer.createAnswer()
  assert.equal(offer.type, 'offer'); assert.ok(!offer.sdp.includes('transport-cc'))
  assert.equal(answer.sdp, section('recvonly'))
  assert.equal(calls[0][0], peer); assert.equal(calls[0][1][0], options)
  assert.deepEqual(window.__publisherRembExperiment.snapshot(), { offers: 1, answers: 1, modified: 1, closed: false })
  window.__publisherRembExperiment.close(); window.__publisherRembExperiment.close()
  assert.equal(Peer.prototype.createOffer, original)
  assert.equal((await peer.createOffer()).sdp, section('sendonly'))
})
