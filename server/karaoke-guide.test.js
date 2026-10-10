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
  }, ...options })
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
  for (const patch of [{ position: -1 }, { duration: null }, { rate: 0 }, { playing: 'true' },
    { sampledAt: 99_999 }, { song: { id: 42, title: 'bad', url: 'javascript:alert(1)' } },
    { song: { id: 42, title: 'bad', url: 'https://music.test/link.42.instrumental.mp3' } }]) {
    assert.equal((await f.request('PUT', route, pair.hostToken, { ...f.state(), ...patch })).status, 400)
  }
  assert.deepEqual((await f.request('GET', route, device.token)).data.data.state, f.state())
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
