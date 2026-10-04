import test from 'node:test'
import assert from 'node:assert/strict'
import { publisherVideoFloorSdp, installVideoFloorExperiment } from './party-video-floor-experiment.mjs'

function description(newline = '\r\n') {
  return ['v=0', 'a=ice-pwd:private-secret', 'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
    'a=recvonly', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 maxaveragebitrate=64000;usedtx=0', 'a=rtpmap:63 red/48000/2',
    'm=video 9 UDP/TLS/RTP/SAVPF 98 99', 'a=recvonly', 'a=rtpmap:98 VP9/90000', 'a=fmtp:98 profile-id=0',
    'a=rtpmap:99 rtx/90000', 'a=fmtp:99 apt=98', 'a=rtcp-fb:98 transport-cc', 'a=rtcp-fb:98 nack pli',
    'm=video 9 UDP/TLS/RTP/SAVPF 98 99', 'a=inactive', 'a=rtpmap:98 VP9/90000', 'a=fmtp:98 profile-id=0',
  ].join(newline) + newline
}
test('video floor normalizes shared VP9 formats while preserving audio, feedback, payloads and private SDP bytes', () => {
  for (const newline of ['\r\n', '\n']) {
    const original = description(newline), rewritten = publisherVideoFloorSdp(original)
    assert.equal(rewritten.replaceAll(';x-google-min-bitrate=250', ''), original)
    assert.equal((rewritten.match(/x-google-min-bitrate=250/g) || []).length, 2)
    assert.equal(publisherVideoFloorSdp(rewritten), rewritten)
  }
  const withoutFmtp = description().replaceAll('a=fmtp:98 profile-id=0\r\n', '')
  assert.equal(publisherVideoFloorSdp(withoutFmtp).replaceAll('a=fmtp:98 x-google-min-bitrate=250\r\n', ''), withoutFmtp)
  for (const invalid of [description().replaceAll('VP9', 'VP8'), description().replace('profile-id=0', 'x-google-min-bitrate=50'),
    description().replace('profile-id=0', 'x-google-min-bitrate=250;x-google-min-bitrate=250'),
    description().replace('a=rtpmap:98 VP9/90000', 'a=rtpmap:98 VP9/90000\r\na=rtpmap:98 VP9/90000'),
    'x'.repeat(262145), description() + 'm=video 9 RTP/SAVPF 98\r\n'.repeat(16)])
    assert.throws(() => publisherVideoFloorSdp(invalid), /VIDEO_FLOOR_/)
  assert.throws(() => publisherVideoFloorSdp(description(), 350), /VIDEO_FLOOR_INPUT/)
})

function fixture(t, { ignore = false, reject = false, pending = false } = {}) {
  const previous = globalThis.window
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous })
  let complete
  class Peer {
    constructor(kind) { this.kind = kind; this.calls = 0 }
    getSenders() { return this.kind ? [{ track: { kind: this.kind, readyState: 'live' } }] : [] }
    async setRemoteDescription(value) {
      this.calls++
      if (reject) throw new Error('private-native-error')
      if (pending) await new Promise(resolve => { complete = resolve })
      this.remoteDescription = { ...value, sdp: ignore ? value.sdp.replaceAll(';x-google-min-bitrate=250', '') : value.sdp }
    }
  }
  globalThis.window = { RTCPeerConnection: Peer }
  const original = Peer.prototype.setRemoteDescription
  installVideoFloorExperiment(publisherVideoFloorSdp)
  return { Peer, original, state: window.__videoFloorExperiment, complete: () => complete() }
}
test('floor experiment scopes actual publisher answers, verifies native retention and restores the original method', async t => {
  const f = fixture(t), publisher = new f.Peer('video'), listener = new f.Peer(null)
  await listener.setRemoteDescription({ type: 'answer', sdp: description() })
  assert.equal(listener.remoteDescription.sdp, description()); assert.equal(f.state.snapshot().applied, 0)
  await publisher.setRemoteDescription({ type: 'offer', sdp: description() })
  assert.equal(publisher.remoteDescription.sdp, description())
  await publisher.setRemoteDescription({ type: 'answer', sdp: description() })
  assert.equal(f.state.snapshot().verified, 1); assert.equal(f.state.snapshot().error, null)
  assert.equal(/private-|sdp|pwd|payload/.test(JSON.stringify(f.state.snapshot())), false)
  f.state.close(); f.state.close(); assert.equal(f.Peer.prototype.setRemoteDescription, f.original)
  await publisher.setRemoteDescription({ type: 'answer', sdp: description() })
  assert.equal(f.state.snapshot().verified, 1); assert.equal(publisher.remoteDescription.sdp, description())
})
test('ignored native floor and rejected descriptions remain failed evidence', async t => {
  for (const options of [{ ignore: true }, { reject: true }]) {
    const f = fixture(t, options), publisher = new f.Peer('video')
    await assert.rejects(publisher.setRemoteDescription({ type: 'answer', sdp: description() }), /VIDEO_FLOOR_/)
    assert.equal(f.state.snapshot().verified, 0)
    const calls = publisher.calls
    await assert.rejects(publisher.setRemoteDescription({ type: 'answer', sdp: description() }), /VIDEO_FLOOR_/)
    assert.equal(publisher.calls, calls); f.state.close()
  }
})
test('closing during pending native application cannot update verified state or rewrap the peer', async t => {
  const f = fixture(t, { pending: true }), publisher = new f.Peer('video')
  const promise = publisher.setRemoteDescription({ type: 'answer', sdp: description() })
  f.state.close(); f.complete(); await promise
  assert.equal(f.state.snapshot().verified, 0); assert.equal(f.state.snapshot().closed, true)
  assert.equal(f.Peer.prototype.setRemoteDescription, f.original)
})
