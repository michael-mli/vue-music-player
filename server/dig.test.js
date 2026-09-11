import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import express from 'express'
import { createDigProvider, parseSearchHtml, validateSyncedLyrics } from './dig-provider.js'
import { createDigLibrary, convertAudio } from './dig-library.js'
import { registerDigRoutes } from './dig-routes.js'
import { createDigIngestionWorker } from './dig-ingestion.js'

const LRC = '[ti:Test]\n[offset:250]\n[00:01.25]First line\n[00:02.500][00:04.50]Second line\n'
const AUDIO_SAMPLE = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-f', 'mp3', 'pipe:1'])
const SONG = { id: 'external-12', source: 'netease', title: 'Test & Song', artist: 'Artist', album: 'Album', duration: 5, extra: { album: 'Album' } }
const HTML = `<html><div data-current-page="2" data-total-pages="3"></div>
<li class="song-card" data-id="external-12" data-source="netease" data-name="Test &amp; Song" data-artist="Artist" data-album="Album" data-duration="5" data-extra='{&#34;album&#34;:&#34;Album&#34;}'></li></html>`
function setup(t, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-test-'))
  const root = path.join(temp, 'imports')
  const legacy = path.join(temp, 'legacy')
  fs.mkdirSync(legacy)
  fs.writeFileSync(path.join(legacy, 'song_number.txt'), '1339\n')
  const db = new DatabaseSync(path.join(temp, 'test.db'))
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1), (2);')
  const config = { db, root, legacyRoots: [legacy], countPaths: [path.join(legacy, 'song_number.txt'), path.join(root, 'song_number.txt')], convert: async (input, output) => fs.copyFileSync(input, output), ...options }
  const library = createDigLibrary(config)
  t.after(() => { db.close(); fs.rmSync(temp, { recursive: true, force: true }) })
  const provider = { search: async () => ({ songs: [SONG], page: 1, totalPages: 1 }), lyrics: async () => LRC, download: async (_song, target) => fs.writeFileSync(target, Buffer.alloc(4096, 1)), verify: async () => ({ verdict: 'ok' }) }
  return { temp, root, legacy, db, library, provider, config }
}

test('parse real upstream song-card attributes, HTML entities, source IDs and pagination', () => {
  const result = parseSearchHtml(HTML)
  assert.deepEqual(result.songs, [SONG])
  assert.equal(result.page, 2)
  assert.equal(result.totalPages, 3)
  assert.equal(parseSearchHtml('<p>未找到符合条件的资源</p>').songs.length, 0)
})
test('source verification and unexpected HTML are errors, not empty searches', () => {
  assert.throws(() => parseSearchHtml('<title>Security Verification</title>'), { code: 'SOURCE_VERIFICATION' })
  assert.throws(() => parseSearchHtml('<html>Sign in</html>'), { code: 'SOURCE_RESPONSE' })
  assert.throws(() => validateSyncedLyrics('plain lyrics'), { code: 'NO_SYNCED_LYRICS' })
  assert.throws(() => validateSyncedLyrics('[99:99]bad timestamp'), { code: 'NO_SYNCED_LYRICS' })
  assert.equal(validateSyncedLyrics(LRC), LRC)
})
test('adapter uses verified endpoints and the exact source/id/extra for audio and lyrics', async (t) => {
  const { root } = setup(t)
  fs.mkdirSync(root)
  const urls = []
  const provider = createDigProvider({ fetchImpl: async (url) => {
    urls.push(new URL(url))
    if (url.pathname.endsWith('/search')) return new Response(HTML)
    if (url.pathname.endsWith('/download_lrc')) return new Response(LRC)
    return new Response(Buffer.alloc(4096, 1))
  } })
  const result = await provider.search('Test & Song', 2)
  assert.equal(urls[0].pathname, '/music/search')
  assert.equal(urls[0].searchParams.get('q'), 'Test & Song')
  assert.equal(urls[0].searchParams.get('page'), '2')
  assert.equal(await provider.lyrics(result.songs[0]), LRC)
  await provider.download(result.songs[0], path.join(root, 'source'))
  for (const url of urls.slice(1)) {
    assert.equal(url.searchParams.get('id'), SONG.id)
    assert.equal(url.searchParams.get('source'), SONG.source)
    assert.deepEqual(JSON.parse(url.searchParams.get('extra')), SONG.extra)
  }
  assert.equal(urls[2].searchParams.get('stream'), '1')
})
test('adapter rejects off-site redirects, oversized bodies, and unavailable lyrics', async () => {
  const redirected = createDigProvider({ fetchImpl: async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }) })
  await assert.rejects(redirected.search('test', 1), { code: 'SOURCE_RESPONSE' })
  const huge = createDigProvider({ fetchImpl: async () => new Response('', { headers: { 'content-length': '999999999' } }) })
  await assert.rejects(huge.search('test', 1), { code: 'ASSET_TOO_LARGE' })
  const missing = createDigProvider({ fetchImpl: async () => new Response('', { status: 404 }) })
  await assert.rejects(missing.lyrics(SONG), { code: 'NO_SYNCED_LYRICS' })
})
test('preview forwards range requests and streams the exact source audio without waiting for the full download', async () => {
  const bytes = Buffer.alloc(4096, 1)
  bytes.write('ID3')
  let requested
  let cancelled = false
  const provider = createDigProvider({ fetchImpl: async (url, options) => {
    requested = { url, options }
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes) },
      cancel() { cancelled = true },
    }), { status: 206, headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-4095/9999', 'accept-ranges': 'bytes' } })
  } })
  const signal = new AbortController().signal
  const response = await provider.preview(SONG, { range: 'bytes=0-', signal })
  assert.equal(requested.url.pathname, '/music/download')
  assert.equal(requested.url.searchParams.get('id'), SONG.id)
  assert.equal(requested.url.searchParams.get('source'), SONG.source)
  assert.equal(requested.options.headers.Range, 'bytes=0-')
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('content-range'), 'bytes 0-4095/9999')
  const reader = response.body.getReader()
  assert.deepEqual(Buffer.from((await reader.read()).value), bytes)
  await reader.cancel()
  assert.equal(cancelled, true)
})
test('preview rejects provider error documents; arbitrary seek bytes remain playable', async () => {
  for (const contentType of ['application/json', 'text/html', 'audio/mpeg']) {
    const provider = createDigProvider({ fetchImpl: async () => new Response('{"error":"unavailable"}', { headers: { 'content-type': contentType } }) })
    await assert.rejects(provider.preview(SONG), { code: 'INVALID_AUDIO' })
  }
  const provider = createDigProvider({ fetchImpl: async () => new Response('[arbitrary bytes in the middle of an MP3]', { status: 206, headers: { 'content-type': 'audio/mpeg' } }) })
  const response = await provider.preview(SONG, { range: 'bytes=1000-' })
  assert.equal(await response.text(), '[arbitrary bytes in the middle of an MP3]')
})
test('verify rejects explicit audio errors but keeps missing lyrics and undecodable samples uncertain', async () => {
  const audioBytes = AUDIO_SAMPLE
  let mode = 'all-good'
  let downloadCalls = 0
  const provider = createDigProvider({ fetchImpl: async (url) => {
    if (url.pathname.endsWith('/download_lrc')) {
      if (mode === 'no-lyrics') return new Response('', { status: 404 })
      if (mode === 'lyrics-transient') return new Response('', { status: 503 })
      return new Response(LRC)
    }
    downloadCalls++
    if (mode === 'fake-id3') return new Response(Buffer.from('ID3' + 'x'.repeat(4096)))
    if (mode === 'bad-audio') return new Response('{"error":"unavailable"}', { headers: { 'content-type': 'audio/mpeg' } })
    return new Response(audioBytes, { headers: { 'content-type': 'audio/mpeg' } })
  } })
  mode = 'all-good'
  assert.deepEqual(await provider.verify(SONG), { verdict: 'ok' })
  mode = 'no-lyrics'
  downloadCalls = 0
  assert.deepEqual(await provider.verify(SONG), { verdict: 'unknown' })
  assert.equal(downloadCalls, 1) // Missing lyrics does not prevent previewing playable audio.
  mode = 'bad-audio'
  assert.deepEqual(await provider.verify(SONG), { verdict: 'bad', reason: 'INVALID_AUDIO' })
  mode = 'fake-id3'
  assert.deepEqual(await provider.verify(SONG), { verdict: 'unknown' })
  mode = 'lyrics-transient'
  assert.deepEqual(await provider.verify(SONG), { verdict: 'unknown' })
})
test('audio verification reads split chunks, bounds the sample and cancels the upstream stream', async () => {
  const payload = Buffer.concat([AUDIO_SAMPLE, Buffer.alloc(300 * 1024)])
  let cancelled = false
  let requestedRange
  let position = 0
  const provider = createDigProvider({ fetchImpl: async (url, options) => {
    if (url.pathname.endsWith('/download_lrc')) return new Response(LRC)
    requestedRange = options.headers.Range
    return new Response(new ReadableStream({
      pull(controller) {
        const end = Math.min(position + (position === 0 ? 3 : 4096), payload.length)
        controller.enqueue(payload.subarray(position, end))
        position = end
        if (position === payload.length) controller.close()
      },
      cancel() { cancelled = true },
    }), { headers: { 'content-type': 'audio/mpeg' } })
  } })
  assert.deepEqual(await provider.verify(SONG), { verdict: 'ok' })
  assert.equal(requestedRange, 'bytes=0-262143')
  assert.equal(cancelled, true)
  assert.ok(position < payload.length) // A server ignoring Range is still bounded.
})
test('search ranks verified versions first, keeps uncertain versions, and can show unavailable versions', async (t) => {
  const { db, library } = setup(t)
  const candidates = [
    { ...SONG, id: 'flaky-1' },
    { ...SONG, id: 'bad-1' },
    { ...SONG, id: 'good-1' },
  ]
  let verifyCalls = 0
  let flakyVerdict = 'unknown'
  const provider = {
    search: async () => ({ songs: candidates, page: 1, totalPages: 1 }),
    verify: async (song) => {
      verifyCalls++
      return { verdict: song.id.startsWith('bad') ? 'bad' : song.id.startsWith('flaky') ? flakyVerdict : 'ok' }
    },
  }
  const app = express()
  app.use(express.json())
  const authMiddleware = (req, res, next) => {
    const id = Number(req.headers['x-test-user'])
    if (!id) return res.sendStatus(401)
    req.auth = { sub: id, role: 'user' }
    next()
  }
  registerDigRoutes(app, { authMiddleware, db, library, provider })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}/api/dig`
  const call = (url, options = {}) => fetch(base + url, { ...options, headers: { 'x-test-user': '1', 'content-type': 'application/json', ...options.headers } })
  const first = await (await call('/search?q=test')).json()
  assert.equal(first.data.songs.length, 2)
  assert.equal(first.data.excluded, 1)
  assert.deepEqual(first.data.songs.map((song) => song.verification), ['verified', 'unverified'])
  assert.equal(verifyCalls, 3)
  const second = await (await call('/search?q=test')).json()
  assert.equal(second.data.songs.length, 2)
  assert.equal(second.data.excluded, 1)
  // ok/bad verdicts are cached; only the unknown one is re-verified.
  assert.equal(verifyCalls, 4)
  flakyVerdict = 'ok'
  const recovered = await (await call('/search?q=test')).json()
  assert.equal(recovered.data.songs.length, 2)
  assert.equal(recovered.data.excluded, 1)
  assert.equal(verifyCalls, 5)
  const all = await (await call('/search?q=test&includeUnavailable=1')).json()
  assert.equal(all.data.songs.length, 3)
  assert.equal(all.data.excluded, 0)
  assert.deepEqual(all.data.songs.map(song => song.verification), ['verified', 'verified', 'unavailable'])
})
test('one playback failure marks a result uncertain; repeated failures hide it without blocking retries', async (t) => {
  const { db, library } = setup(t)
  const flaky = { ...SONG, id: 'flaky-9' }
  const fine = { ...SONG, id: 'fine-9' }
  let previewFails = 99
  const provider = {
    search: async () => ({ songs: [flaky, fine], page: 1, totalPages: 1 }),
    verify: async () => ({ verdict: 'ok' }),
    preview: async () => {
      if (previewFails > 0) {
        previewFails--
        throw Object.assign(new Error('upstream boom'), { code: 'SOURCE_UNAVAILABLE', status: 503 })
      }
      return new Response(Buffer.alloc(4096, 1), { headers: { 'content-type': 'audio/mpeg' } })
    },
  }
  const app = express()
  app.use(express.json())
  const authMiddleware = (req, res, next) => {
    const id = Number(req.headers['x-test-user'])
    if (!id) return res.sendStatus(401)
    req.auth = { sub: id, role: 'user' }
    next()
  }
  registerDigRoutes(app, { authMiddleware, db, library, provider })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}/api/dig`
  const call = (url, options = {}) => fetch(base + url, { ...options, headers: { 'x-test-user': '1', 'content-type': 'application/json', ...options.headers } })
  async function searchSongs() {
    return (await (await call('/search?q=test')).json()).data.songs
  }
  async function tokenFor(key) {
    return (await (await call('/preview', { method: 'POST', body: JSON.stringify({ key }) })).json()).data.token
  }
  // Confirmed versions are listed and their positive verdicts cached.
  let listed = await searchSongs()
  assert.equal(listed.length, 2)
  // Probes (?probe=1) diagnose without feeding failure memory.
  previewFails = 99
  const probeToken = await tokenFor(listed[0].key)
  assert.equal((await fetch(base + '/preview/' + probeToken + '?probe=1')).status, 503)
  assert.equal((await fetch(base + '/preview/' + probeToken + '?probe=1')).status, 503)
  listed = await searchSongs()
  assert.equal(listed.length, 2)
  // One failure must not remove a potentially playable version.
  previewFails = 99
  const realToken = await tokenFor(listed[0].key)
  assert.equal((await fetch(base + '/preview/' + realToken)).status, 503)
  listed = await searchSongs()
  assert.equal(listed.length, 2)
  assert.equal(listed[1].verification, 'unverified')
  assert.equal((await fetch(base + '/preview/' + realToken)).status, 503)
  listed = await searchSongs()
  assert.equal(listed.length, 1)
  const all = await (await call('/search?q=test&includeUnavailable=1')).json()
  assert.equal(all.data.songs.length, 2)
  assert.equal(all.data.songs[1].verification, 'unavailable')
  // A successful stream clears the memory and the track returns.
  previewFails = 0
  assert.equal((await fetch(base + '/preview/' + realToken)).status, 200)
  listed = await searchSongs()
  assert.equal(listed.length, 2)
})
test('fresh imports trigger onImported once; duplicates do not', async (t) => {
  const { db, library, provider } = setup(t)
  const imported = []
  const app = express()
  app.use(express.json())
  const authMiddleware = (req, res, next) => {
    const id = Number(req.headers['x-test-user'])
    if (!id) return res.sendStatus(401)
    req.auth = { sub: id, role: 'user' }
    next()
  }
  registerDigRoutes(app, { authMiddleware, db, library, provider, onImported: (id) => imported.push(id) })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}/api/dig`
  const call = (url, options = {}) => fetch(base + url, { ...options, headers: { 'x-test-user': '1', 'content-type': 'application/json', ...options.headers } })
  async function importKey(key) {
    const job = await (await call('/import', { method: 'POST', body: JSON.stringify({ key }) })).json()
    for (let i = 0; i < 50; i++) {
      const status = await (await call(`/import/${job.data.id}`)).json()
      if (status.data.status !== 'running') return status.data
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('import did not finish')
  }
  const key = (await (await call('/search?q=test')).json()).data.songs[0].key
  const first = await importKey(key)
  assert.equal(first.status, 'complete')
  assert.deepEqual(imported, [1340])
  await importKey(key)
  assert.deepEqual(imported, [1340])
})
test('lyrics endpoint serves synced lyrics without allocating a library ID', async (t) => {
  const { db, library } = setup(t)
  let lyricsCalls = 0
  let failNext = true
  const provider = {
    search: async () => ({ songs: [SONG], page: 1, totalPages: 1 }),
    verify: async () => ({ verdict: 'ok' }),
    lyrics: async () => {
      lyricsCalls++
      if (failNext) { failNext = false; throw new Error('upstream hiccup') }
      return LRC
    },
  }
  const app = express()
  app.use(express.json())
  const authMiddleware = (req, res, next) => {
    const id = Number(req.headers['x-test-user'])
    if (!id) return res.sendStatus(401)
    req.auth = { sub: id, role: 'user' }
    next()
  }
  registerDigRoutes(app, { authMiddleware, db, library, provider })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}/api/dig`
  const call = (url, options = {}) => fetch(base + url, { ...options, headers: { 'x-test-user': '1', 'content-type': 'application/json', ...options.headers } })
  const search = await (await call('/search?q=test')).json()
  const key = search.data.songs[0].key
  assert.equal((await fetch(base + '/lyrics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) })).status, 401)
  assert.equal((await call('/lyrics', { method: 'POST', headers: { 'x-test-user': '2' }, body: JSON.stringify({ key }) })).status, 410)
  assert.equal((await call('/lyrics', { method: 'POST', body: JSON.stringify({ key: 'expired' }) })).status, 410)
  // A transient upstream failure must not poison the per-result cache.
  assert.equal((await call('/lyrics', { method: 'POST', body: JSON.stringify({ key }) })).status, 500)
  const first = await (await call('/lyrics', { method: 'POST', body: JSON.stringify({ key }) })).json()
  assert.equal(first.data.lrc, LRC)
  const second = await (await call('/lyrics', { method: 'POST', body: JSON.stringify({ key }) })).json()
  assert.equal(second.data.lrc, LRC)
  assert.equal(lyricsCalls, 2)
  assert.deepEqual(library.list(), [])
})
test('import increments ID and persists matching audio, plain lyrics, LRC and count across reloads', async (t) => {
  const { library, provider, root, config, legacy, db } = setup(t)
  const result = await library.add(SONG, 1, provider)
  assert.equal(result.song.id, 1340)
  assert.equal(result.song.filename, 'link.1340.mp3')
  assert.equal(fs.readFileSync(path.join(root, 'synced/link.1340.lrc'), 'utf8'), LRC)
  assert.equal(fs.readFileSync(path.join(root, 'lyrics/link.1340.mp3.l'), 'utf8'), 'Test & Song\n\nFirst line\nSecond line\n')
  assert.equal(fs.statSync(path.join(root, 'link.1340.mp3')).size, 4096)
  assert.equal(fs.readFileSync(path.join(root, 'song_number.txt'), 'utf8'), '1340\n')
  assert.equal(fs.readFileSync(path.join(legacy, 'song_number.txt'), 'utf8'), '1339\n')
  assert.equal(createDigLibrary(config).list()[0].id, 1340)
  const again = await library.add(SONG, 2, provider)
  assert.equal(again.alreadyAdded, true)
  assert.equal(again.song.id, 1340)
  assert.equal(library.list().length, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dig_ingestion').get().n, 1)
  assert.equal(createDigLibrary(config).ingestion(1340).status, 'queued')
  assert.equal(result.song.lyricsMode, 'synced')
})
test('manual lyrics validate text, use the same incremented ID and queue ingestion without creating LRC', async (t) => {
  const { library, provider, root, config } = setup(t)
  for (const manualLyrics of [null, 123, 'x'.repeat(20001), 'bad\0text']) {
    await assert.rejects(library.add(SONG, 1, provider, { manualLyrics }), { code: 'INVALID_MANUAL_LYRICS' })
    assert.equal(library.list().length, 0)
    assert.equal(library.ingestion(1340), null)
  }
  const result = await library.add(SONG, 1, { ...provider, lyrics: async () => { throw new Error('manual must not refetch') } }, { manualLyrics: 'First line\r\nSecond line' })
  assert.equal(result.song.id, 1340)
  assert.equal(result.song.lyricsMode, 'manual')
  assert.equal(fs.readFileSync(path.join(root, 'lyrics/link.1340.mp3.l'), 'utf8'), 'Test & Song\n\nFirst line\nSecond line\n')
  assert.equal(fs.existsSync(path.join(root, 'synced/link.1340.lrc')), false)
  assert.equal(createDigLibrary(config).list()[0].lyricsMode, 'manual')
  assert.equal(library.ingestion(1340).status, 'queued')
  assert.equal((await library.add(SONG, 1, provider)).alreadyAdded, true)
  assert.equal((await library.add({ ...SONG, id: 'next' }, 1, provider)).song.id, 1341)
})
test('API offers manual lyrics only after missing synced lyrics, then imports supplied text', async (t) => {
  const { db, library, provider, root } = setup(t)
  provider.lyrics = async () => 'No timed lyrics'
  const app = express()
  app.use(express.json())
  registerDigRoutes(app, { db, library, provider, authMiddleware: (req, res, next) => {
    req.auth = { sub: Number(req.headers['x-test-user'] || 1) }; next()
  } })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}/api/dig`
  const search = await (await fetch(base + '/search?q=test')).json()
  const key = search.data.songs[0].key
  const add = (body, user = 1) => fetch(base + '/import', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': String(user) }, body: JSON.stringify(body) })
  async function settled(response) {
    const job = (await response.json()).data
    for (let i = 0; i < 100; i++) {
      const status = (await (await fetch(base + '/import/' + job.id)).json()).data
      if (status.status !== 'running') return status
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.fail('import never settled')
  }
  assert.equal((await add({ key, manualLyrics: 'Text' })).status, 400)
  const missing = await settled(await add({ key }))
  assert.equal(missing.code, 'NO_SYNCED_LYRICS')
  assert.equal(library.list().length, 0)
  assert.equal(library.ingestion(1340), null)
  assert.equal((await add({ key, manualLyrics: 'Text' }, 2)).status, 410)
  const invalid = await settled(await add({ key, manualLyrics: null }))
  assert.equal(invalid.code, 'INVALID_MANUAL_LYRICS')
  assert.equal(library.list().length, 0)
  const complete = await settled(await add({ key, manualLyrics: '<script>literal text</script>\nNext line' }))
  assert.equal(complete.status, 'complete')
  assert.equal(complete.result.song.id, 1340)
  assert.equal(complete.result.song.lyricsMode, 'manual')
  assert.match(fs.readFileSync(path.join(root, 'lyrics/link.1340.mp3.l'), 'utf8'), /<script>literal text<\/script>/)
  assert.equal(fs.existsSync(path.join(root, 'synced/link.1340.lrc')), false)
  assert.equal(library.ingestion(1340).status, 'queued')
  provider.search = async () => ({ songs: [{ ...SONG, id: 'title-only' }], page: 1, totalPages: 1 })
  const nextKey = (await (await fetch(base + '/search?q=title-only')).json()).data.songs[0].key
  assert.equal((await settled(await add({ key: nextKey }))).code, 'NO_SYNCED_LYRICS')
  const titleOnly = await settled(await add({ key: nextKey, manualLyrics: '   ' }))
  assert.equal(titleOnly.status, 'complete')
  assert.equal(titleOnly.result.titleOnlyLyrics, true)
  assert.equal(titleOnly.result.song.lyrics, 'Test & Song\n')
  assert.equal(titleOnly.result.song.id, 1341)
  assert.equal(library.ingestion(1341).status, 'queued')
})
test('blank manual lyrics use only the title; a pasted title is not duplicated', async (t) => {
  const { library, provider, root } = setup(t)
  for (const [index, manualLyrics] of ['', ' \n\r\n ', SONG.title].entries()) {
    const result = await library.add({ ...SONG, id: `blank-${index}` }, 1, provider, { manualLyrics })
    assert.equal(result.titleOnlyLyrics, true)
    assert.equal(result.song.lyricsMode, 'manual')
    assert.equal(fs.readFileSync(path.join(root, `lyrics/link.${result.song.id}.mp3.l`), 'utf8'), `${SONG.title}\n`)
    assert.equal(fs.existsSync(path.join(root, `synced/link.${result.song.id}.lrc`)), false)
    assert.equal(library.ingestion(result.song.id).status, 'queued')
  }
  const result = await library.add({ ...SONG, id: 'pasted-title' }, 1, provider, { manualLyrics: `${SONG.title}\nFirst line\nSecond line` })
  assert.equal(result.titleOnlyLyrics, false)
  assert.equal(result.song.lyrics, `${SONG.title}\n\nFirst line\nSecond line\n`)
})
test('ingestion outbox failure rolls back publication and ID allocation', async (t) => {
  const { library, provider, root, db } = setup(t)
  db.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON dig_ingestion BEGIN SELECT RAISE(ABORT, 'queue failure'); END")
  await assert.rejects(library.add(SONG, 1, provider), /queue failure/)
  assert.equal(library.list().length, 0)
  assert.equal(library.ingestion(1340), null)
  assert.equal(fs.existsSync(path.join(root, 'link.1340.mp3')), false)
  assert.equal(fs.existsSync(path.join(root, 'song_number.txt')), false)
  db.exec('DROP TRIGGER fail_queue')
  assert.equal((await library.add(SONG, 1, provider)).song.id, 1340)
})
test('automatic ingestion serializes imported IDs and does not repeat completed jobs', async (t) => {
  const { library, provider, db } = setup(t)
  await library.add(SONG, 1, provider)
  await library.add({ ...SONG, id: 'second' }, 1, provider)
  let release
  const calls = []
  const worker = createDigIngestionWorker({ db, run: async id => {
    calls.push(id)
    if (id === 1340) await new Promise(resolve => { release = resolve })
  } })
  const running = worker.tick()
  assert.equal(library.ingestion(1340).status, 'running')
  await worker.tick()
  assert.deepEqual(calls, [1340])
  release()
  await running
  await worker.tick()
  await worker.tick()
  assert.deepEqual(calls, [1340, 1341])
  assert.equal(library.ingestion(1341).status, 'complete')
  worker.stop()
})
test('scheduled worker picks up an import without an admin request or manual tick', async (t) => {
  const { library, provider, db } = setup(t)
  let finished
  const seen = new Promise(resolve => { finished = resolve })
  const worker = createDigIngestionWorker({ db, intervalMs: 5, run: async id => { finished(id) } })
  const timeout = setTimeout(() => finished('timed out'), 2000)
  try {
    worker.start()
    await library.add(SONG, 1, provider)
    assert.equal(await seen, 1340)
  } finally { worker.stop(); clearTimeout(timeout) }
})
test('failed ingestion retries automatically without undoing the playable song', async (t) => {
  const { library, provider, db } = setup(t)
  await library.add(SONG, 1, provider)
  let clock = 1000
  let calls = 0
  const worker = createDigIngestionWorker({ db, now: () => clock, retryMs: 100, run: async () => {
    if (++calls === 1) throw new Error('No GPU workers ready')
  } })
  await worker.tick()
  assert.equal(library.ingestion(1340).status, 'retry')
  assert.equal(library.list().length, 1)
  await worker.tick()
  assert.equal(calls, 1)
  clock += 100
  await worker.tick()
  assert.equal(library.ingestion(1340).status, 'complete')
  assert.equal(library.ingestion(1340).attempts, 2)
  worker.stop()
})
test('backend startup recovers interrupted ingestion from the durable queue', async (t) => {
  const { library, provider, db } = setup(t)
  await library.add(SONG, 1, provider)
  db.prepare("UPDATE dig_ingestion SET status = 'running', attempts = 1 WHERE song_id = 1340").run()
  const calls = []
  const worker = createDigIngestionWorker({ db, run: async id => { calls.push(id) } })
  await worker.tick()
  assert.deepEqual(calls, [1340])
  assert.equal(library.ingestion(1340).status, 'complete')
  worker.stop()
})
test('concurrent additions get consecutive IDs; concurrent duplicate adds share one ID', async (t) => {
  const { library, provider } = setup(t)
  const results = await Promise.all([library.add(SONG, 1, provider), library.add({ ...SONG, id: 'different' }, 2, provider), library.add(SONG, 2, provider)])
  assert.deepEqual(library.list().map((song) => song.id), [1341, 1340])
  assert.equal(results[0].song.id, results[2].song.id)
  assert.equal(results.filter((result) => result.alreadyAdded).length, 1)
})
test('allocation skips existing legacy files and orphaned timed lyrics', async (t) => {
  const { library, provider, legacy, root } = setup(t)
  fs.writeFileSync(path.join(legacy, 'link.1342.mp3'), 'existing')
  fs.mkdirSync(path.join(root, 'synced'), { recursive: true })
  fs.writeFileSync(path.join(root, 'synced/link.1343.lrc'), 'orphan')
  const result = await library.add(SONG, 1, provider)
  assert.equal(result.song.id, 1344)
  assert.equal(fs.readFileSync(path.join(legacy, 'link.1342.mp3'), 'utf8'), 'existing')
})
test('missing lyrics or failed downloads do not allocate an ID or publish partial songs', async (t) => {
  const { library, provider, root } = setup(t)
  await assert.rejects(library.add(SONG, 1, { ...provider, lyrics: async () => 'plain' }), { code: 'NO_SYNCED_LYRICS' })
  await assert.rejects(library.add(SONG, 1, { ...provider, download: async () => { throw new Error('interrupted') } }))
  assert.deepEqual(library.list(), [])
  assert.equal(fs.existsSync(path.join(root, 'song_number.txt')), false)
  assert.deepEqual(fs.readdirSync(root), [])
  assert.equal((await library.add(SONG, 1, provider)).song.id, 1340)
})
test('failed database publication rolls back files; later retries use the correct ID', async (t) => {
  const { library, provider, root, db } = setup(t)
  db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON imported_songs BEGIN SELECT RAISE(ABORT, 'test failure'); END")
  await assert.rejects(library.add(SONG, 1, provider), /test failure/)
  assert.equal(fs.existsSync(path.join(root, 'link.1340.mp3')), false)
  assert.equal(fs.existsSync(path.join(root, 'synced/link.1340.lrc')), false)
  assert.equal(fs.existsSync(path.join(root, 'song_number.txt')), false)
  db.exec('DROP TRIGGER fail_import')
  assert.equal((await library.add(SONG, 1, provider)).song.id, 1340)
})
test('MP3 conversion retains duration and accepts a non-MP3 source', async (t) => {
  const { temp } = setup(t)
  const input = path.join(temp, 'tone.wav')
  const output = path.join(temp, 'tone.mp3')
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', input])
  await convertAudio(input, output)
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output], { encoding: 'utf8' }))
  assert.equal(probe.streams[0].codec_name, 'mp3')
  assert.ok(Math.abs(Number(probe.format.duration) - 5) < 0.1)
})
test('guest API search/import, ownership, media range requests, and traversal rejection', async (t) => {
  const { db, library, provider } = setup(t)
  let previewCalls = 0
  provider.preview = async (song, { range }) => {
    assert.equal(song.id, SONG.id)
    assert.equal(range, 'bytes=0-99')
    previewCalls++
    return new Response(Buffer.alloc(100, 1), { status: 206, headers: { 'content-type': 'audio/mpeg', 'content-length': '100', 'content-range': 'bytes 0-99/4096' } })
  }
  const app = express()
  app.use(express.json())
  const authMiddleware = (req, res, next) => {
    const id = Number(req.headers['x-test-user'])
    if (!id) return res.sendStatus(401)
    req.auth = { sub: id, role: 'user' }
    next()
  }
  registerDigRoutes(app, { authMiddleware, db, library, provider })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${server.address().port}/api/dig`
  const call = (url, options = {}) => fetch(base + url, { ...options, headers: { 'x-test-user': '1', 'content-type': 'application/json', ...options.headers } })
  assert.equal((await fetch(base + '/search?q=test')).status, 401)
  assert.equal((await call('/search?q=test', { headers: { 'x-test-user': '99' } })).status, 401)
  assert.equal((await call('/search?q=http://127.0.0.1')).status, 400)
  assert.equal((await call('/import', { method: 'POST', body: JSON.stringify({ url: 'http://127.0.0.1' }) })).status, 410)
  const search = await (await call('/search?q=test')).json()
  const key = search.data.songs[0].key
  assert.equal((await fetch(base + '/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) })).status, 401)
  assert.equal((await call('/preview', { method: 'POST', headers: { 'x-test-user': '2' }, body: JSON.stringify({ key }) })).status, 410)
  assert.equal((await call('/preview', { method: 'POST', body: JSON.stringify({ key: 'expired' }) })).status, 410)
  assert.equal((await fetch(base + '/preview/unknown')).status, 410)
  const preview = await (await call('/preview', { method: 'POST', body: JSON.stringify({ key }) })).json()
  const samePreview = await (await call('/preview', { method: 'POST', body: JSON.stringify({ key }) })).json()
  assert.equal(preview.data.token, samePreview.data.token)
  assert.equal((await fetch(base + '/preview/' + preview.data.token, { headers: { range: 'bytes=0-1,5-6' } })).status, 416)
  const previewAudio = await fetch(base + '/preview/' + preview.data.token, { headers: { range: 'bytes=0-99' } })
  assert.equal(previewAudio.status, 206)
  assert.equal(previewAudio.headers.get('content-type'), 'audio/mpeg')
  assert.equal(previewAudio.headers.get('cache-control'), 'private, no-store')
  assert.equal((await previewAudio.arrayBuffer()).byteLength, 100)
  assert.equal(previewCalls, 1)
  assert.deepEqual(library.list(), []) // Listening must not allocate a library ID.
  assert.equal((await call('/import', { method: 'POST', headers: { 'x-test-user': '2' }, body: JSON.stringify({ key }) })).status, 410)
  const job = await (await call('/import', { method: 'POST', body: JSON.stringify({ key }) })).json()
  assert.equal((await call(`/import/${job.data.id}`, { headers: { 'x-test-user': '2' } })).status, 404)
  let status
  for (let i = 0; i < 50; i++) {
    status = await (await call(`/import/${job.data.id}`)).json()
    if (status.data.status !== 'running') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(status.data.status, 'complete')
  assert.equal(status.data.result.song.id, 1340)
  const ingestion = await (await fetch(base + '/ingestion/1340')).json()
  assert.equal(ingestion.data.status, 'queued')
  assert.equal(ingestion.data.songId, 1340)
  assert.equal((await fetch(base + '/ingestion/1339')).status, 404)
  const list = await (await fetch(base + '/library')).json()
  assert.equal(list.data[0].id, 1340)
  const lrc = await fetch(base + '/files/synced/link.1340.lrc')
  assert.match(lrc.headers.get('content-type'), /text\/plain/)
  assert.equal(await lrc.text(), LRC)
  const range = await fetch(base + '/files/link.1340.mp3', { headers: { range: 'bytes=0-99' } })
  assert.equal(range.status, 206)
  assert.equal((await range.arrayBuffer()).byteLength, 100)
  assert.equal(library.asset('../test.db'), null)
  assert.equal(library.asset('link.1339.mp3'), null)
  const posterPath = library.asset('poster/link.1340.jpg')
  fs.mkdirSync(path.dirname(posterPath), { recursive: true })
  const posterBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
  fs.writeFileSync(posterPath, posterBytes)
  const poster = await fetch(base + '/poster/1340')
  assert.equal(poster.headers.get('content-type'), 'image/jpeg')
  assert.deepEqual(Buffer.from(await poster.arrayBuffer()), posterBytes)
  assert.equal(library.asset('poster/link.1339.jpg'), null)
  assert.equal(library.asset('poster/../../auth.db'), null)
  assert.equal((await fetch(base + '/poster/1339')).status, 404)
  assert.equal((await fetch(base + '/poster/not-an-id')).status, 404)
})
