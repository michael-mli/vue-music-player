import test from 'node:test'
import assert from 'node:assert/strict'
import { SignalResponse, JoinResponse, ReconnectResponse, ICEServer, ParticipantInfo } from '@livekit/protocol'
import { createKtvIceRewrite } from './ktv-media-ice.js'

const tls = { domain: 'turn.example.com', port: 5349 }
const urls = ['turns:turn.example.com:443?transport=tcp', 'turn:203.0.113.10:3478?transport=udp',
  'turns:other.example.com:443?transport=tcp', 'turns:turn.example.com.evil.test:443?transport=tcp']
const servers = () => [new ICEServer({ urls, username: 'fixture-expiry-participant', credential: 'fixture-password' })]
for (const type of ['join', 'reconnect']) {
  test(`TURN adapter changes only the configured TLS port in binary ${type} and preserves credentials/unknown fields`, () => {
    const payload = type === 'join' ? new JoinResponse({ iceServers: servers(), participant: new ParticipantInfo({ identity: 'fixture-performer' }) }) : new ReconnectResponse({ iceServers: servers() })
    const original = new SignalResponse({ message: { case: type, value: payload } })
    const unknown = Buffer.from([0xb8, 0x3e, 0x7b]) // field 999, varint 123
    const bytes = Buffer.concat([original.toBinary(), unknown])
    const result = createKtvIceRewrite(tls)(bytes, true)
    const decoded = SignalResponse.fromBinary(result), updated = decoded.message.value.iceServers[0]
    assert.deepEqual(updated.urls, ['turns:turn.example.com:5349?transport=tcp', ...urls.slice(1)])
    assert.equal(updated.username, payload.iceServers[0].username)
    assert.equal(updated.credential, payload.iceServers[0].credential)
    if (type === 'join') assert.equal(decoded.message.value.participant.identity, 'fixture-performer')
    assert.deepEqual(result.subarray(-unknown.length), unknown)
  })
  test(`TURN adapter preserves future JSON fields in ${type}`, () => {
    const payload = { [type]: { iceServers: servers().map(item => item.toJson()), futureServerField: { count: 123 } }, futureEnvelopeField: 'retained' }
    const output = JSON.parse(createKtvIceRewrite(tls)(Buffer.from(JSON.stringify(payload)), false))
    const expected = structuredClone(payload); expected[type].iceServers[0].urls[0] = 'turns:turn.example.com:5349?transport=tcp'
    assert.deepEqual(output, expected)
  })
}
test('TURN adapter forwards non-ICE and nonmatching messages byte for byte; no adapter accepts arbitrary existing frames', () => {
  const rewrite = createKtvIceRewrite(tls)
  const other = new SignalResponse({ message: { case: 'join', value: new JoinResponse({ iceServers: [new ICEServer({ urls: ['turns:other.example.com:443?transport=tcp'] })] }) } }).toBinary()
  assert.equal(rewrite(other, true), other)
  const pong = new SignalResponse({ message: { case: 'pong', value: 1n } }).toBinary()
  assert.equal(rewrite(pong, true), pong)
  const json = Buffer.from('{"answer":{"sdp":"fixture-sdp","type":"answer"},"unknown":true}')
  assert.equal(rewrite(json, false), json)
  const arbitrary = Buffer.from([0, 255, 42]); assert.equal(createKtvIceRewrite()(arbitrary, true), arbitrary)
})
test('TURN adapter rejects invalid operator configuration and malformed upstream signaling', () => {
  for (const invalid of [null, {}, { domain: 'turn.example.com\nsecret', port: 5349 }, { domain: 'turn.example.com', port: 80 }, { ...tls, port: 65536 }]) {
    assert.throws(() => createKtvIceRewrite(invalid), /Invalid KTV TURN advertisement/)
  }
  assert.throws(() => createKtvIceRewrite(tls)(Buffer.from([255]), true))
  assert.throws(() => createKtvIceRewrite(tls)(Buffer.from('invalid-json'), false))
})
