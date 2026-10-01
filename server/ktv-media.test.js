import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { AccessToken, TrackSource } from 'livekit-server-sdk'
import { createKtvMediaGateway } from './ktv-media-gateway.js'

const wait = async (work, label) => {
  for (let count = 0; count < 100; count++) { const value = work(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)) }
  throw new Error(`Timed out: ${label}`)
}
async function fixture(t) {
  const apiKey = 'media-unit', apiSecret = 'test-only-media-secret-with-more-than-thirty-two-bytes', identity = randomUUID()
  const grant = { identity, scope: 'audience', room: 'room' }, removed = [], fatal = [], clients = []
  let admitted = true, removal = async () => {}
  const upstream = http.createServer((req, res) => { res.writeHead(200); res.end('ok') })
  const upstreamSockets = new WebSocketServer({ server: upstream })
  upstreamSockets.on('connection', socket => { socket.on('message', (data, binary) => socket.send(data, { binary })) })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`
  const gateway = createKtvMediaGateway({ upstreamUrl, apiKey, apiSecret, pollMs: 20,
    authorize: claims => admitted && claims.sub === identity ? grant : null,
    allowedOrigin: origin => !origin || origin === 'http://room.local',
    removeParticipant: async (room, id) => { removed.push([room, id]); await removal() }, onFatal: async error => { fatal.push(error) } })
  const server = http.createServer((req, res) => void gateway.http(req, res))
  server.on('upgrade', (req, socket, head) => void gateway.upgrade(req, socket, head))
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  const token = async overrides => {
    const access = new AccessToken(apiKey, apiSecret, { identity, ttl: 120 })
    access.addGrant({ roomJoin: true, room: 'room', canPublish: false, canSubscribe: true, canPublishData: false, canPublishSources: [], ...overrides })
    return access.toJwt()
  }
  const join = async (credential, path = '/api/ktv/media/rtc') => {
    const socket = new WebSocket(origin.replace('http:', 'ws:') + path + '?access_token=' + encodeURIComponent(credential), { origin: 'http://room.local' })
    clients.push(socket); socket.on('error', () => {})
    await once(socket, 'open'); return socket
  }
  t.after(async () => {
    for (const socket of clients) socket.terminate()
    await gateway.close()
    for (const socket of upstreamSockets.clients) socket.terminate()
    upstreamSockets.close()
    await Promise.all([new Promise(resolve => { server.close(resolve); server.closeAllConnections() }),
      new Promise(resolve => { upstream.close(resolve); upstream.closeAllConnections() })])
  })
  return { gateway, token, join, origin, removed, fatal, revokeAdmission: () => { admitted = false },
    setRemoval: work => { removal = work }, grant }
}

test('media gateway forwards authorized binary signaling and removes RTP permission on signal loss', async t => {
  const f = await fixture(t), socket = await f.join(await f.token())
  const reply = once(socket, 'message'); socket.send(Buffer.from([0, 255, 42]))
  assert.deepEqual((await reply)[0], Buffer.from([0, 255, 42]))
  socket.terminate()
  await wait(() => f.removed.length === 1, 'provider removal after signal loss')
  assert.deepEqual(f.removed[0], ['room', f.grant.identity]); assert.equal(f.fatal.length, 0)
})

test('audience tokens cannot inherit default publish/data grants, publish sources, or room administration', async t => {
  const f = await fixture(t)
  const unsafe = [{ canPublish: undefined }, { canPublish: true }, { canSubscribe: undefined }, { canPublishData: undefined },
    { canPublishSources: [TrackSource.MICROPHONE] }, { roomAdmin: true }, { roomRecord: true }, { roomList: true },
    { ingressAdmin: true }, { destinationRoom: 'other' }]
  for (const overrides of unsafe) {
    const response = await fetch(`${f.origin}/api/ktv/media/rtc/validate?access_token=${encodeURIComponent(await f.token(overrides))}`)
    assert.equal(response.status, 403)
  }
  const allowed = await fetch(`${f.origin}/api/ktv/media/rtc/validate?access_token=${encodeURIComponent(await f.token())}`)
  assert.equal(allowed.status, 200)
  const badOrigin = await fetch(`${f.origin}/api/ktv/media/rtc/validate?access_token=${encodeURIComponent(await f.token())}`, { headers: { Origin: 'https://untrusted.invalid' } })
  assert.equal(badOrigin.status, 403)
  assert.equal((await fetch(`${f.origin}/twirp/livekit.RoomService/ListParticipants`)).status, 403)
})

test('revoked admission removes an open participant and rejects its old and refreshed JWTs', async t => {
  const f = await fixture(t), oldToken = await f.token(), socket = await f.join(oldToken)
  f.revokeAdmission()
  await wait(() => f.removed.length === 1 && socket.readyState === WebSocket.CLOSED, 'current media participant removed')
  for (const credential of [oldToken, await f.token()]) {
    assert.equal((await fetch(`${f.origin}/api/ktv/media/rtc/validate?access_token=${encodeURIComponent(credential)}`)).status, 403)
    await assert.rejects(f.join(credential), /403/)
  }
})

test('identity reconnect waits for old provider removal and concurrent replacement cannot double join', async t => {
  const f = await fixture(t), credential = await f.token(), first = await f.join(credential)
  let release
  f.setRemoval(() => new Promise(resolve => { release = resolve }))
  const second = f.join(credential)
  try {
    await wait(() => !!release && first.readyState !== WebSocket.OPEN, 'provider removal pending')
    await assert.rejects(f.join(credential), /403/)
  } finally { release?.() }
  const replacement = await second
  assert.equal(replacement.readyState, WebSocket.OPEN)
  f.setRemoval(async () => {})
})

test('provider removal failure invokes the supervisor instead of treating signaling closure as media revocation', async t => {
  const f = await fixture(t)
  await f.join(await f.token())
  f.setRemoval(async () => { throw new Error('Provider unreachable') })
  await assert.rejects(f.gateway.revoke(f.grant), /MEDIA_REVOCATION_FAILED/)
  assert.equal(f.fatal.length, 1); assert.equal(f.fatal[0].message, 'Provider unreachable')
  f.setRemoval(async () => {})
})
