import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import { registerKaraokeGuideRoutes } from './karaoke-guide-routes.js'

async function setup(t, options = {}) {
  let time = 1000
  const app = express()
  app.use(express.json())
  const guide = registerKaraokeGuideRoutes(app, { now: () => time, authMiddleware(req, res, next) {
    if (!['user-1', 'user-2'].includes(req.headers.authorization?.slice(7))) return res.sendStatus(401)
    req.auth = { sub: req.headers.authorization.slice(7) }; next()
  }, resolveUser: token => token === 'user-2' ? { username: 'BlueSinger' } : null, ...options })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { guide.close(); await new Promise(resolve => server.close(resolve)) })
  async function request(method, route = '', token = '', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/karaoke-guide/sessions${route}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, headers: response.headers,
      data: response.headers.get('content-type')?.includes('json') ? await response.json() : null }
  }
  const create = async (user = 'user-1') => (await request('POST', '', user, {})).data.data
  const join = async (pair, name = 'Phone', joinKey = 'test-device-join-key') => (await request('POST', `/${pair.id}/devices`, pair.guideToken, { name, joinKey })).data.data.device
  const state = () => ({ song: { id: 42, title: 'Original song', url: 'https://music.test/data/link.42.mp3' },
    position: 21.5, duration: 180, playing: true, rate: 1, sampledAt: time })
  return { request, create, join, state, advance(ms) { time += ms } }
}

test('pairing requires a host identity and exchanges the invitation for a device grant', async t => {
  const f = await setup(t)
  assert.equal((await f.request('POST', '', '', {})).status, 401)
  const pair = await f.create(), route = `/${pair.id}`
  assert.notEqual(pair.hostToken, pair.guideToken)
  assert.equal((await f.request('PUT', route, pair.guideToken, f.state())).status, 403)
  assert.equal((await f.request('DELETE', route, pair.guideToken)).status, 403)
  assert.equal((await f.request('GET', route, 'wrong')).status, 403)
  assert.equal((await f.request('PUT', route, pair.hostToken, f.state())).status, 200)
  assert.equal((await f.request('GET', route, pair.guideToken)).status, 403)
  const device = await f.join(pair)
  assert.notEqual(device.token, pair.guideToken)
  assert.equal((await f.request('PUT', route, device.token, f.state())).status, 403)
  const read = await f.request('GET', route, device.token)
  assert.deepEqual(read.data.data.state, f.state())
  assert.equal(read.data.data.hostOnline, true)
  assert.match(read.headers.get('cache-control'), /no-store/)
  assert.equal(read.data.data.hostToken, undefined)
  assert.equal(read.data.data.guideToken, undefined)
})

test('play, pause, seek, rate, song changes and buffering are published without changing host playback', async t => {
  const f = await setup(t), pair = await f.create(), route = `/${pair.id}`
  const device = await f.join(pair)
  for (const patch of [{}, { playing: false }, { position: 72 }, { rate: 1.25 },
    { song: { id: 2, title: 'Next', url: 'https://music.test/api/dig/files/link.2.mp3' } },
    { song: null, playing: true }]) {
    const state = { ...f.state(), ...patch }
    assert.equal((await f.request('PUT', route, pair.hostToken, state)).status, 200)
    const read = (await f.request('GET', route, device.token)).data.data.state
    assert.deepEqual(read, { ...state, playing: !!state.song && state.playing })
    f.advance(500)
  }
})

test('invalid media, timestamps and playback values cannot replace valid state', async t => {
  const f = await setup(t), pair = await f.create(), route = `/${pair.id}`
  const device = await f.join(pair)
  await f.request('PUT', route, pair.hostToken, f.state())
  for (const patch of [{ position: -1 }, { duration: null }, { rate: 0 }, { playing: 'true' }, { karaoke: 'true' }, { canSwitchMode: 1 },
    { sampledAt: 99_999 }, { song: { id: 42, title: 'bad', url: 'javascript:alert(1)' } },
    { song: { id: 42, title: 'bad', url: 'https://music.test/link.42.instrumental.mp3' } }]) {
    assert.equal((await f.request('PUT', route, pair.hostToken, { ...f.state(), ...patch })).status, 400)
  }
  assert.deepEqual((await f.request('GET', route, device.token)).data.data.state, f.state())
})

test('audio mode requests relay an explicit target, retry once and retain the paired grant in Original mode', async t => {
  const f = await setup(t), pair = await f.create(), route = `/${pair.id}`, device = await f.join(pair)
  const state = { ...f.state(), controlsAvailable: true, karaoke: true, canSwitchMode: true }
  await f.request('PUT', route, pair.hostToken, state)
  for (const karaoke of [undefined, 'false', 0]) {
    assert.equal((await f.request('POST', route + '/commands', device.token,
      { commandId: 'invalid-mode-request', action: 'setMode', karaoke })).status, 400)
  }
  const command = { commandId: 'original-mode-request', action: 'setMode', karaoke: false }
  assert.equal((await f.request('POST', route + '/commands', device.token, command)).status, 200)
  assert.equal((await f.request('POST', route + '/commands', device.token, command)).status, 200)
  const incoming = (await f.request('PUT', route, pair.hostToken, state)).data.data.commands
  assert.equal(incoming.length, 1); assert.equal(incoming[0].karaoke, false)
  assert.equal(incoming[0].action, 'setMode')
  assert.equal((await f.request('POST', route + '/commands', device.token, { ...command, karaoke: true })).status, 409)
  await f.request('PUT', route, pair.hostToken, { ...state, karaoke: false,
    acknowledgements: [{ id: command.commandId, status: 'applied' }] })
  const read = (await f.request('GET', route, device.token)).data.data
  assert.equal(read.state.karaoke, false); assert.equal(read.state.playing, true)
  assert.equal(read.state.canSwitchMode, true); assert.equal(read.device.id, device.id)
  assert.equal((await f.request('POST', route + '/commands', device.token, command)).data.data.command.status, 'applied')
  assert.equal((await f.request('POST', route + '/commands', device.token,
    { commandId: 'karaoke-mode-request', action: 'setMode', karaoke: true })).status, 200)
})

test('audio mode requests honor host control permissions and instrumental availability', async t => {
  const f = await setup(t), pair = await f.create(), route = `/${pair.id}`, device = await f.join(pair)
  const state = { ...f.state(), controlsAvailable: true, karaoke: false, canSwitchMode: false }
  await f.request('PUT', route, pair.hostToken, state)
  const command = { commandId: 'switch-mode-permission', action: 'setMode', karaoke: true }
  assert.equal((await f.request('POST', route + '/commands', device.token, command)).data.code, 'songUnavailable')
  await f.request('PUT', route, pair.hostToken, { ...state, canSwitchMode: true })
  await f.request('PATCH', route + '/devices/' + device.id, pair.hostToken, { canControl: false })
  assert.equal((await f.request('POST', route + '/commands', device.token, command)).data.code, 'controlsDisabled')
  await f.request('PATCH', route + '/devices/' + device.id, pair.hostToken, { canControl: true })
  assert.equal((await f.request('POST', route + '/commands', device.token, command)).status, 200)
  await f.request('DELETE', route + '/devices/' + device.id, pair.hostToken)
  assert.equal((await f.request('POST', route + '/commands', device.token, command)).data.code, 'removed')
})

test('stale hosts stop being live; guide polling cannot keep an abandoned session alive', async t => {
  const f = await setup(t, { idleMs: 10_000 }), pair = await f.create(), route = `/${pair.id}`
  const device = await f.join(pair)
  await f.request('PUT', route, pair.hostToken, f.state())
  f.advance(3500)
  assert.equal((await f.request('GET', route, device.token)).data.data.hostOnline, false)
  await f.request('PUT', route, pair.hostToken, { ...f.state(), position: 60 })
  assert.equal((await f.request('GET', route, device.token)).data.data.hostOnline, true)
  f.advance(10_001)
  assert.equal((await f.request('GET', route, device.token)).status, 410)
})

test('ending, replacing and expiring a session invalidate old QR codes', async t => {
  const f = await setup(t, { lifetimeMs: 5000 }), pair = await f.create()
  const replacement = await f.create()
  assert.equal((await f.request('GET', `/${pair.id}`, pair.guideToken)).status, 410)
  assert.equal((await f.request('DELETE', `/${replacement.id}`, replacement.hostToken)).status, 200)
  assert.equal((await f.request('GET', `/${replacement.id}`, replacement.guideToken)).status, 410)
  const expiring = await f.create()
  f.advance(5001)
  assert.equal((await f.request('GET', `/${expiring.id}`, expiring.guideToken)).status, 410)
})

test('device grants deduplicate enrolment, retain away devices, and enforce host management', async t => {
  const f = await setup(t), pair = await f.create(), route = `/${pair.id}`
  const a = await f.join(pair), again = await f.join(pair), b = await f.join(pair, 'Tablet', 'tablet-device-join-key')
  assert.equal(a.token, again.token)
  await f.request('GET', `${route}?mode=away`, a.token)
  const devices = (await f.request('PUT', route, pair.hostToken, f.state())).data.data.devices
  assert.equal(devices.length, 2)
  assert.equal(devices.find(item => item.id === a.id).status, 'away')
  assert.equal(devices.some(item => item.token || item.joinKey), false)
  assert.equal((await f.request('DELETE', `${route}/devices/${b.id}`, a.token)).status, 403)
  assert.equal((await f.request('PATCH', `${route}/device`, a.token, { name: 'My phone' })).data.data.device.name, 'My phone')
  const removed = await f.request('DELETE', `${route}/devices/${a.id}`, pair.hostToken)
  assert.notEqual(removed.data.data.guideToken, pair.guideToken)
  assert.equal((await f.request('GET', route, a.token)).data.code, 'removed')
  assert.equal((await f.request('GET', route, b.token)).status, 200)
  assert.equal((await f.request('POST', `${route}/devices`, pair.guideToken, { name: 'Phone', joinKey: 'new-phone-join-key' })).status, 403)
  const newPair = { ...pair, guideToken: removed.data.data.guideToken }
  assert.ok((await f.join(newPair, 'Returned phone', 'new-phone-join-key')).token)
})

test('idle cleanup removes untouched and away devices while listening or controls keep a grant alive', async t => {
  const f = await setup(t, { deviceIdleMs: 1000 }), pair = await f.create(), route = `/${pair.id}`
  const a = await f.join(pair), b = await f.join(pair, 'Away', 'away-device-join-key')
  f.advance(700)
  await f.request('GET', `${route}?active=1`, a.token)
  await f.request('GET', `${route}?mode=away&active=1`, b.token)
  f.advance(400)
  assert.equal((await f.request('GET', route, b.token)).data.code, 'idleExpired')
  assert.equal((await f.request('GET', route, a.token)).status, 200)
  f.advance(601)
  assert.equal((await f.request('GET', route, a.token)).data.code, 'idleExpired')
  assert.equal((await f.request('PUT', route, pair.hostToken, f.state())).data.data.devices.length, 0)
})

async function controller(t, options) {
  const f = await setup(t, options), pair = await f.create(), route = `/${pair.id}`, device = await f.join(pair)
  const publish = patch => f.request('PUT', route, pair.hostToken, { ...f.state(), controlsAvailable: true, ...patch })
  const command = (action, extra = {}, commandId = 'test-command-unique-id') => f.request('POST', `${route}/commands`, device.token, { commandId, action, ...extra })
  await publish()
  return { ...f, pair, route, device, publish, command }
}

test('remote commands are acknowledged once and retries cannot duplicate a skip', async t => {
  const f = await controller(t)
  assert.equal((await f.command('skip')).data.data.command.status, 'pending')
  assert.equal((await f.command('skip')).data.data.command.status, 'pending')
  const host = (await f.publish()).data.data
  assert.equal(host.commands.length, 1)
  assert.equal(host.commands[0].action, 'skip')
  await f.publish({ acknowledgements: [{ id: host.commands[0].id, status: 'applied' }] })
  assert.equal((await f.publish()).data.data.commands.length, 0)
  assert.equal((await f.command('skip')).data.data.command.status, 'applied')
  assert.equal((await f.command('pause')).data.code, 'commandConflict')
  const receipts = (await f.request('GET', f.route, f.device.token)).data.data.commands
  assert.deepEqual(receipts, [{ id: 'test-command-unique-id', status: 'applied' }])
})

test('permissions, removal, offline hosts and command deadlines prevent pending playback changes', async t => {
  const f = await controller(t)
  await f.command('pause')
  await f.request('PATCH', `${f.route}/devices/${f.device.id}`, f.pair.hostToken, { canControl: false })
  assert.equal((await f.publish()).data.data.commands.length, 0)
  assert.equal((await f.command('pause')).data.data.command.code, 'controlsDisabled')
  assert.equal((await f.command('play', {}, 'second-command-id-long')).data.code, 'controlsDisabled')
  await f.request('PATCH', `${f.route}/devices/${f.device.id}`, f.pair.hostToken, { canControl: true })
  f.advance(3500)
  assert.equal((await f.command('play', {}, 'second-command-id-long')).data.code, 'hostOffline')
  await f.publish()
  await f.command('stop', {}, 'third-command-id-long')
  f.advance(10_001)
  assert.equal((await f.publish()).data.data.commands.length, 0)
  assert.equal((await f.command('stop', {}, 'third-command-id-long')).data.data.command.code, 'commandExpired')
  await f.command('play', {}, 'fourth-command-id-long')
  await f.request('DELETE', `${f.route}/devices/${f.device.id}`, f.pair.hostToken)
  assert.equal((await f.publish()).data.data.commands.length, 0)
})

test('song search publishes catalogs atomically, paginates, and validates requested songs', async t => {
  const f = await controller(t), upload = body => f.request('PUT', `${f.route}/catalog`, f.pair.hostToken, body)
  const songs = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, title: `Song ${i + 1}`, artist: 'Singer' }))
  await upload({ revision: 'revision-1', reset: true, done: false, songs: songs.slice(0, 20) })
  assert.equal((await f.request('GET', `${f.route}/catalog`, f.device.token)).data.data.ready, false)
  await upload({ revision: 'revision-1', reset: false, done: true, songs: songs.slice(20) })
  const page = (await f.request('GET', `${f.route}/catalog?q=SINGER&page=2`, f.device.token)).data.data
  assert.equal(page.total, 30); assert.equal(page.songs.length, 5); assert.equal(page.songs[0].id, 26)
  assert.equal((await f.request('GET', `${f.route}/catalog?q=Song%2030`, f.device.token)).data.data.songs[0].id, 30)
  assert.equal((await f.command('enqueue', { songId: 30 })).status, 200)
  assert.equal((await f.command('singNow', { songId: 31 }, 'missing-song-command-id')).data.code, 'songUnavailable')
  await f.publish({ queue: [{ id: 30, title: 'Song 30' }] })
  assert.deepEqual((await f.request('GET', f.route, f.device.token)).data.data.queue, [{ id: 30, title: 'Song 30' }])
  assert.equal((await f.request('PUT', `${f.route}/catalog`, f.device.token, {})).status, 403)
  assert.equal((await f.command('seek', { position: -1 }, 'invalid-seek-command-id')).status, 400)
})

test('pairing limits devices without changing existing grants', async t => {
  const f = await setup(t), pair = await f.create()
  for (let i = 0; i < 10; i++) assert.ok((await f.join(pair, `Phone ${i}`, `unique-device-join-key-${i}`)).token)
  const response = await f.request('POST', `/${pair.id}/devices`, pair.guideToken, { name: 'Extra', joinKey: 'extra-device-join-key' })
  assert.equal(response.status, 409); assert.equal(response.data.code, 'deviceLimit')
})

test('short codes are unique for live sessions and issue device grants with verified usernames', async t => {
  const f = await setup(t), a = await f.create(), b = await f.create('user-2')
  assert.match(a.pairCode, /^\d{6}$/); assert.match(b.pairCode, /^\d{6}$/)
  assert.notEqual(a.pairCode, b.pairCode)
  const body = { code: `${a.pairCode.slice(0, 3)} ${a.pairCode.slice(3)}`, name: 'Tablet',
    joinKey: 'short-code-tablet-key', identityToken: 'user-2', username: 'ForgedUsername' }
  const response = await f.request('POST', '/pair', '', body), data = response.data.data
  assert.equal(response.status, 200); assert.equal(data.sessionId, a.id)
  assert.equal(data.device.username, 'BlueSinger')
  assert.equal(data.hostToken, undefined); assert.equal(data.guideToken, undefined); assert.equal(data.pairCode, undefined)
  assert.notEqual(data.device.token, a.hostToken); assert.notEqual(data.device.token, a.guideToken)
  assert.match(response.headers.get('cache-control'), /no-store/)
  const host = (await f.request('PUT', `/${a.id}`, a.hostToken, f.state())).data.data
  assert.equal(host.devices[0].username, 'BlueSinger'); assert.equal(host.devices[0].token, undefined)
  assert.equal((await f.request('GET', `/${b.id}`, data.device.token)).status, 403)
  assert.equal((await f.request('DELETE', `/${a.id}`, data.device.token)).status, 403)
  const repeated = (await f.request('POST', '/pair', '', body)).data.data.device
  assert.equal(repeated.token, data.device.token)
  const restored = (await f.request('POST', '/pair', '', { ...body, joinKey: 'different-join-key-long', deviceToken: data.device.token })).data.data.device
  assert.equal(restored.id, data.device.id)
  assert.equal((await f.request('PUT', `/${a.id}`, a.hostToken, f.state())).data.data.devices.length, 1)
})

test('QR pairing resolves usernames from identity tokens and ignores unverified client usernames', async t => {
  const f = await setup(t), pair = await f.create(), route = `/${pair.id}/devices`
  const body = { name: 'Phone', joinKey: 'verified-qr-phone-key', identityToken: 'user-2', username: 'Fake' }
  const device = (await f.request('POST', route, pair.guideToken, body)).data.data.device
  assert.equal(device.username, 'BlueSinger')
  const anonymous = (await f.request('POST', route, pair.guideToken,
    { ...body, joinKey: 'anonymous-qr-phone-key', identityToken: 'fake-token' })).data.data.device
  assert.equal(anonymous.username, '')
  await f.request('PATCH', `/${pair.id}/device`, device.token, { name: 'Renamed phone', username: 'Fake' })
  assert.equal((await f.request('GET', `/${pair.id}`, device.token)).data.data.device.username, 'BlueSinger')
})

test('removal, idle cleanup, replacement and session end invalidate short codes without revoking other devices', async t => {
  const f = await setup(t, { deviceIdleMs: 1000 }), pair = await f.create(), route = `/${pair.id}`
  const phone = await f.join(pair), tablet = await f.join(pair, 'Tablet', 'code-survivor-tablet-key')
  const enrol = code => f.request('POST', '/pair', '', { code, name: 'New phone', joinKey: 'new-code-phone-key' })
  const removed = (await f.request('DELETE', `${route}/devices/${phone.id}`, pair.hostToken)).data.data
  assert.notEqual(removed.pairCode, pair.pairCode)
  assert.equal((await enrol(pair.pairCode)).data.code, 'invalidCode')
  assert.equal((await f.request('GET', route, tablet.token)).status, 200)
  const fresh = await enrol(removed.pairCode)
  assert.equal(fresh.status, 200)
  f.advance(1001)
  const idle = (await f.request('PUT', route, pair.hostToken, f.state())).data.data
  assert.equal(idle.devices.length, 0); assert.notEqual(idle.pairCode, removed.pairCode)
  assert.equal((await enrol(removed.pairCode)).data.code, 'invalidCode')
  const replacement = await f.create()
  assert.equal((await enrol(idle.pairCode)).data.code, 'invalidCode')
  await f.request('DELETE', `/${replacement.id}`, replacement.hostToken)
  assert.equal((await enrol(replacement.pairCode)).data.code, 'invalidCode')
})

test('short-code attempts are limited and expired hosts cannot be joined by code', async t => {
  const f = await setup(t, { idleMs: 1000 }), pair = await f.create()
  const body = { name: 'Phone', joinKey: 'bounded-pair-code-key', code: 'bad' }
  for (let i = 0; i < 30; i++) assert.equal((await f.request('POST', '/pair', '', body)).status, 404)
  assert.equal((await f.request('POST', '/pair', '', { ...body, code: pair.pairCode })).data.code, 'pairCodeBusy')
  f.advance(60_001)
  assert.equal((await f.request('POST', '/pair', '', { ...body, code: pair.pairCode })).data.code, 'invalidCode')
  const fresh = await f.create()
  assert.equal((await f.request('POST', '/pair', '', { ...body, code: fresh.pairCode })).status, 200)
})
