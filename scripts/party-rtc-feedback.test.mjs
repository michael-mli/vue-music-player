import test from 'node:test'
import assert from 'node:assert/strict'
import { collectRtcFeedback } from './party-rtc-feedback.mjs'

test('negotiation evidence exposes only fixed booleans, direction and description type', t => {
  const previous = globalThis.window
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous })
  const sdp = ['v=0', 'a=ice-pwd:secret', 'a=candidate:private-address', 'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=sendonly', 'a=rtcp-fb:111 nack', 'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=sendrecv',
    'a=rtcp-fb:96 transport-cc', 'a=rtcp-fb:96 goog-remb',
    'a=extmap:4 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
    'a=extmap:5/sendonly http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
    'a=msid:private-stream private-track'].join('\r\n') + '\r\n'
  globalThis.window = { __peers: [{ localDescription: { type: 'answer', sdp }, remoteDescription: null }] }
  const rows = collectRtcFeedback()
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { peer: 0, side: 'local', type: 'answer', kind: 'audio', direction: 'sendonly',
    transportCcFeedback: false, rembFeedback: false, transportCcExtension: false, absoluteSendTimeExtension: false })
  assert.equal(rows[1].transportCcFeedback, true); assert.equal(rows[1].rembFeedback, true)
  assert.equal(rows[1].transportCcExtension, true); assert.equal(rows[1].absoluteSendTimeExtension, true)
  for (const secret of ['secret', 'private-address', 'private-stream', 'private-track']) assert.ok(!JSON.stringify(rows).includes(secret))
})
test('negotiation history refuses unbounded peers, sections and SDP bytes', t => {
  const previous = globalThis.window
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous })
  for (const [peers, error] of [
    [Array(17).fill({}), 'AV_FEEDBACK_PEER_LIMIT'],
    [[{ localDescription: { sdp: 'x'.repeat(262145) } }], 'AV_FEEDBACK_SDP_LIMIT'],
    [[{ localDescription: { sdp: 'm=video 9 RTP/SAVPF 96\r\n'.repeat(17) } }], 'AV_FEEDBACK_SECTION_LIMIT'],
  ]) {
    globalThis.window = { __peers: peers }
    assert.throws(collectRtcFeedback, new RegExp(error))
  }
})
