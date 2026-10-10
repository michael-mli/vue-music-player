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
  const state = () => ({ song: { id: 42, title: 'Original song', url: 'https://music.test/data/link.42.mp3' },
    position: 21.5, duration: 180, playing: true, rate: 1, sampledAt: time })
  return { request, create, state, advance(ms) { time += ms } }
}

test('pairing requires a host identity and gives the guide read-only access', async t => {
  const f = await setup(t)
  assert.equal((await f.request('POST', '', '', {})).status, 401)
  const pair = await f.create(), route = `/${pair.id}`
  assert.notEqual(pair.hostToken, pair.guideToken)
  assert.equal((await f.request('PUT', route, pair.guideToken, f.state())).status, 403)
  assert.equal((await f.request('DELETE', route, pair.guideToken)).status, 403)
  assert.equal((await f.request('GET', route, 'wrong')).status, 403)
  assert.equal((await f.request('PUT', route, pair.hostToken, f.state())).status, 200)
  const read = await f.request('GET', route, pair.guideToken)
  assert.deepEqual(read.data.data.state, f.state())
  assert.equal(read.data.data.hostOnline, true)
  assert.match(read.headers.get('cache-control'), /no-store/)
  assert.equal(read.data.data.hostToken, undefined)
  assert.equal(read.data.data.guideToken, undefined)
})

test('play, pause, seek, rate, song changes and buffering are published without changing host playback', async t => {
  const f = await setup(t), pair = await f.create(), route = `/${pair.id}`
  for (const patch of [{}, { playing: false }, { position: 72 }, { rate: 1.25 },
    { song: { id: 2, title: 'Next', url: 'https://music.test/api/dig/files/link.2.mp3' } },
    { song: null, playing: true }]) {
    const state = { ...f.state(), ...patch }
    assert.equal((await f.request('PUT', route, pair.hostToken, state)).status, 200)
    const read = (await f.request('GET', route, pair.guideToken)).data.data.state
    assert.deepEqual(read, { ...state, playing: !!state.song && state.playing })
    f.advance(500)
  }
})

test('invalid media, timestamps and playback values cannot replace valid state', async t => {
  const f = await setup(t), pair = await f.create(), route = `/${pair.id}`
  await f.request('PUT', route, pair.hostToken, f.state())
  for (const patch of [{ position: -1 }, { duration: null }, { rate: 0 }, { playing: 'true' },
    { sampledAt: 99_999 }, { song: { id: 42, title: 'bad', url: 'javascript:alert(1)' } },
    { song: { id: 42, title: 'bad', url: 'https://music.test/link.42.instrumental.mp3' } }]) {
    assert.equal((await f.request('PUT', route, pair.hostToken, { ...f.state(), ...patch })).status, 400)
  }
  assert.deepEqual((await f.request('GET', route, pair.guideToken)).data.data.state, f.state())
})

test('stale hosts stop being live; guide polling cannot keep an abandoned session alive', async t => {
  const f = await setup(t, { idleMs: 10_000 }), pair = await f.create(), route = `/${pair.id}`
  await f.request('PUT', route, pair.hostToken, f.state())
  f.advance(3500)
  assert.equal((await f.request('GET', route, pair.guideToken)).data.data.hostOnline, false)
  await f.request('PUT', route, pair.hostToken, { ...f.state(), position: 60 })
  assert.equal((await f.request('GET', route, pair.guideToken)).data.data.hostOnline, true)
  f.advance(10_001)
  assert.equal((await f.request('GET', route, pair.guideToken)).status, 410)
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

test('paired device counts deduplicate polling and drop disconnected devices', async t => {
  const f = await setup(t), pair = await f.create(), route = `/${pair.id}`
  for (const device of ['phone-a', 'phone-a', 'phone-b']) await f.request('GET', `${route}?device=${device}`, pair.guideToken)
  assert.equal((await f.request('PUT', route, pair.hostToken, f.state())).data.data.connectedDevices, 2)
  f.advance(5001)
  assert.equal((await f.request('PUT', route, pair.hostToken, f.state())).data.data.connectedDevices, 0)
})
