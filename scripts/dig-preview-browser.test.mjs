// Song digging preview: following the lyrics must not scroll the page while the user browses results.
// Requires a production build, Chrome, and ffmpeg. No live backend is modified.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import express from '../server/node_modules/express/index.js'
import WebSocket from '../server/node_modules/ws/wrapper.mjs'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dig-preview-browser-'))
const app = express(), pending = new Map(), errors = []
const searches = []
let server, chrome, socket, nextId = 0, passed = 0
const check = (value, message) => { assert.ok(value, message); passed++; console.log('PASS', message) }
async function poll(work, label, attempts = 150) {
  for (let i = 0; i < attempts; i++) {
    if (await work()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Browser timeout: ' + label)
}
function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)) }, 15000)
    pending.set(id, { resolve(value) { clearTimeout(timeout); resolve(value) }, reject(error) { clearTimeout(timeout); reject(error) } })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}
async function evaluate(session, expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, session)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
// Everything the page scrolled: the results page and the lyrics box are the only expected scrollers.
const scrolled = `[...document.querySelectorAll('*')].filter(element => element.scrollTop > 0)`
const page = `document.querySelector('#dig-query').closest('.overflow-y-auto')`
const lyricsBox = `document.querySelector('[data-line]').parentElement`
const activeLine = `[...document.querySelectorAll('[data-line]')].findIndex(line => line.classList.contains('text-spotify-green'))`

try {
  const media = path.join(root, 'track.mp3')
  await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=90', '-codec:a', 'libmp3lame', '-b:a', '64k', media])
  app.use(express.json())
  const user = { id: 1, username: 'Fixture', name: 'Fixture', role: 'user', kind: 'guest' }
  app.get('/api/auth/me', (_req, res) => res.json({ success: true, data: user }))
  app.post('/api/auth/guest', (_req, res) => res.json({ success: true, data: { token: 'fixture', user } }))
  app.get('/api/dig/search', (req, res) => { searches.push(req.query.q); res.json({ success: true, data: { page: 1, totalPages: 1, excluded: 0, songs: Array.from({ length: 30 }, (_, index) => ({
    key: `song-${index + 1}`, title: `Dug song ${index + 1}`, artist: 'Fixture artist', album: 'Fixture album', duration: 90, source: 'fixture', libraryId: null, verification: 'verified',
  })) } }) })
  app.post('/api/dig/preview', (_req, res) => res.json({ success: true, data: { token: 'preview-token' } }))
  app.get('/api/dig/preview/:token', (_req, res) => res.sendFile(media))
  app.post('/api/dig/lyrics', (_req, res) => res.json({ success: true, data: { lrc: Array.from({ length: 80 }, (_, index) =>
    `[${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.00]Preview line ${index + 1}`).join('\n') } }))
  app.get('/api/categories', (_req, res) => res.json({ success: true, data: { categories: [], assignments: [], lockedSongIds: [] } }))
  app.get('/api/*', (_req, res) => res.json({ success: true, data: [] }))
  app.get('/data/song_number.txt', (_req, res) => res.type('text').send('1'))
  app.get('/data/metadata.json', (_req, res) => res.json({ '1': { title: 'Library song', duration: 90 } }))
  // A missing library file would make the main player retry, and its playback rightly stops the preview.
  app.get('/data/link.:id.mp3', (_req, res) => res.sendFile(media))
  const dist = path.resolve(process.env.DIG_PREVIEW_TEST_DIST || 'dist')
  app.use(express.static(dist)); app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`

  const profile = path.join(root, 'chrome')
  chrome = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--autoplay-policy=document-user-activation-required',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  let port
  await poll(async () => {
    try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return !!port }
    catch { return false }
  }, 'Chrome debug port')
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  socket = new WebSocket(info.webSocketDebuggerUrl); await once(socket, 'open')
  socket.on('message', raw => {
    const message = JSON.parse(raw)
    if (message.id) {
      const task = pending.get(message.id)
      if (!task) return
      pending.delete(message.id)
      message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
  })

  const { browserContextId } = await cdp('Target.createBrowserContext')
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId: tab } = await cdp('Target.attachToTarget', { targetId, flatten: true })
  await cdp('Page.enable', {}, tab); await cdp('Runtime.enable', {}, tab)
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 820, deviceScaleFactor: 1, mobile: true }, tab)
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('language', 'en'); localStorage.setItem('auth_token', 'fixture');` }, tab)
  await cdp('Page.navigate', { url: origin + '/' }, tab)
  await poll(() => evaluate(tab, `!!document.querySelector('.home-view input')`), 'home page')
  // The app auto-starts a library song on load; its playback would rightly stop the preview.
  const player = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('player')`
  const router = `document.querySelector('#app').__vue_app__.config.globalProperties.$router`
  const songs = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('songs')`
  await poll(() => evaluate(tab, `!!${player}.currentSong`), 'library auto-start')
  await evaluate(tab, `${player}.pause()`)

  const enterHomeQuery = query => evaluate(tab, `(() => { const input = document.querySelector('.home-view input'); input.value = ${JSON.stringify(query)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await enterHomeQuery('no match yet')
  await enterHomeQuery('Library song')
  await new Promise(resolve => setTimeout(resolve, 1000))
  check(await evaluate(tab, `location.pathname === '/' && document.querySelector('.home-view').innerText.includes('Library song')`) && searches.length === 0,
    'a matching homepage query cancels the pending no-result redirect')
  await enterHomeQuery('')
  await new Promise(resolve => setTimeout(resolve, 900))
  check(await evaluate(tab, `location.pathname === '/'`) && searches.length === 0, 'an empty homepage query stays on the homepage')
  const keyword = '未收录 & fresh + song?'
  await enterHomeQuery(keyword)
  await poll(() => evaluate(tab, `location.pathname === '/dig' && document.querySelector('#dig-query')?.value === ${JSON.stringify(keyword)} && document.querySelectorAll('ul[aria-busy] > li').length === 30`), 'homepage fallback searches Song Digging')
  check(searches.length === 1 && searches[0] === keyword && await evaluate(tab, `new URLSearchParams(location.search).get('q') === ${JSON.stringify(keyword)}`),
    'an empty homepage search redirects and automatically digs using the same Unicode and punctuation keyword')
  check(await evaluate(tab, `${songs}.quickQuery === '' && document.querySelector('#dig-query').value === ${JSON.stringify(keyword)}`),
    'switching to Song Digging clears the homepage keyword while preserving the digging keyword')

  await evaluate(tab, `history.back()`)
  await poll(() => evaluate(tab, `document.querySelector('.home-view input')?.value === ''`), 'Back returns to a cleared homepage search')
  await new Promise(resolve => setTimeout(resolve, 900))
  check(await evaluate(tab, `location.pathname === '/' && !${songs}.quickQuery`) && searches.length === 1,
    'browser Back leaves the homepage search empty without redirecting back to the previous digging query')
  await enterHomeQuery('Library song')
  await poll(() => evaluate(tab, `location.pathname === '/' && ${songs}.quickQuery === 'Library song' && ${songs}.quickFilteredSongs.length === 1`), 'search again after returning home')
  await evaluate(tab, `${router}.push('/dig')`)
  await poll(() => evaluate(tab, `!!document.querySelector('#dig-query')`), 'manual navigation to Song Digging')
  check(await evaluate(tab, `${songs}.quickQuery === ''`), 'manually opening Song Digging also clears the homepage search')

  await evaluate(tab, `(() => { const input = document.querySelector('#dig-query'); input.value = 'fixture'; input.dispatchEvent(new Event('input')); input.form.requestSubmit(); })()`)
  await poll(() => evaluate(tab, `document.querySelector('ul[aria-busy]')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('ul[aria-busy] > li').length === 30`), 'search results')
  await evaluate(tab, `document.querySelector('ul[aria-busy] > li button[aria-pressed]').click()`)
  const previewState = `(() => { const audio = document.querySelector('audio[controls]'); return { paused: audio.paused, time: audio.currentTime, error: audio.error?.code, active: ${activeLine},
    messages: [...document.querySelectorAll('[role=alert], [role=status]')].map(element => element.textContent.trim()) }; })()`
  await poll(() => evaluate(tab, `(state => !state.paused && state.time > 0 && state.active >= 0)(${previewState})`), 'preview playing with lyrics')
    .catch(async error => { throw new Error(error.message + ': ' + JSON.stringify(await evaluate(tab, previewState))) })
  check(true, 'preview plays with synced lyrics')

  await evaluate(tab, `(() => { const scroller = ${page}; scroller.scrollTop = scroller.scrollHeight; window.__browseTop = scroller.scrollTop; window.__browseLine = ${activeLine}; })()`)
  check(await evaluate(tab, `window.__browseTop > 0`), 'the result list scrolls below the preview')
  await poll(() => evaluate(tab, `${activeLine} >= window.__browseLine + 3`), 'lyrics advance while browsing', 100)
  const browse = await evaluate(tab, `(() => ({ playing: !document.querySelector('audio[controls]').paused, before: window.__browseTop, after: ${page}.scrollTop,
    others: ${scrolled}.filter(element => element !== ${page}).length }))()`)
  check(browse.playing && Math.abs(browse.after - browse.before) < 1 && browse.others === 0, 'advancing preview lyrics leave the browsed results in place: ' + JSON.stringify(browse))

  await evaluate(tab, `document.querySelector('audio[controls]').currentTime = 40`)
  await poll(() => evaluate(tab, `${activeLine} === 40`), 'seek to a later lyric')
  check(await evaluate(tab, `(() => { const box = ${lyricsBox}.getBoundingClientRect(), line = document.querySelectorAll('[data-line]')[40].getBoundingClientRect(),
    others = ${scrolled}.filter(element => element !== ${page} && element !== ${lyricsBox});
    return ${lyricsBox}.scrollTop > 0 && line.top >= box.top - 1 && line.bottom <= box.bottom + 1 && Math.abs(${page}.scrollTop - window.__browseTop) < 1 && others.length === 0; })()`),
  'the lyrics box alone follows the current line')
  check(errors.length === 0, 'no uncaught browser errors: ' + errors.join('\n'))
  console.log(`${passed} dig preview browser checks passed`)
} finally {
  socket?.close()
  if (chrome) { chrome.kill('SIGTERM'); await once(chrome, 'exit').catch(() => {}) }
  if (server) await new Promise(resolve => server.close(resolve))
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
