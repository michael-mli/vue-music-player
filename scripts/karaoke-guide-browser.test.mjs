// Isolated real-media acceptance: two browser contexts act as separate devices.
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
import { registerKaraokeGuideRoutes } from '../server/karaoke-guide-routes.js'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'karaoke-guide-browser-'))
const app = express(), contexts = [], pending = new Map(), errors = [], dialogs = []
let server, guide, chrome, socket, nextId = 0, passed = 0, dropHostUpdates = false, dialogChoice = true, loseCommandResponse = false
const check = (value, message) => { assert.ok(value, message); passed++; console.log('PASS', message) }
async function poll(work, label, attempts = 150) {
  for (let i = 0; i < attempts; i++) {
    try { if (await work()) return }
    catch (error) {
      if (!/Execution context was destroyed|Cannot find context|Inspected target navigated/.test(error.message)) throw error
    }
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
const store = name => `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('${name}')`
async function page(origin, route, width = 320, language = 'en') {
  const { browserContextId } = await cdp('Target.createBrowserContext'); contexts.push(browserContextId)
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true })
  await cdp('Page.enable', {}, sessionId); await cdp('Runtime.enable', {}, sessionId)
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: 1, mobile: width < 600 }, sessionId)
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('language', '${language}'); localStorage.setItem('auth_token', 'fixture-host'); localStorage.setItem('music-player-karaoke-mode', 'true');` }, sessionId)
  await cdp('Page.navigate', { url: origin + route }, sessionId)
  await poll(() => evaluate(sessionId, `!!document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia`), 'Vue mount')
  return sessionId
}
async function clickText(session, text) {
  await evaluate(session, `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`)
}
try {
  const media = path.join(root, 'track.mp3')
  await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=90', '-codec:a', 'libmp3lame', '-b:a', '64k', media])
  app.use(express.json())
  app.use('/api/karaoke-guide/sessions', (req, res, next) => {
    if (dropHostUpdates && req.method === 'PUT') return res.sendStatus(503)
    if (loseCommandResponse && req.method === 'POST' && req.path.endsWith('/commands')) {
      loseCommandResponse = false
      res.json = () => { res.destroy(); return res }
    }
    next()
  })
  const user = { id: 1, username: 'Fixture', name: 'Fixture', role: 'user', kind: 'guest' }
  app.get('/api/auth/me', (_req, res) => res.json({ success: true, data: user }))
  app.post('/api/auth/guest', (_req, res) => res.json({ success: true, data: { token: 'fixture-host', user } }))
  guide = registerKaraokeGuideRoutes(app, { authMiddleware(req, res, next) {
    if (req.headers.authorization !== 'Bearer fixture-host') return res.sendStatus(401)
    req.auth = { sub: 1 }; next()
  } })
  app.get('/api/categories', (_req, res) => res.json({ success: true, data: { categories: [], assignments: [], lockedSongIds: [] } }))
  app.get('/api/*', (_req, res) => res.json({ success: true, data: [] }))
  app.get('/data/song_number.txt', (_req, res) => res.type('text').send('2'))
  app.get('/data/metadata.json', (_req, res) => res.json({ '1': { title: 'First guide song', duration: 90 }, '2': { title: 'Second guide song', duration: 90 } }))
  app.get('/karaoke/karaoke_manifest.json', (_req, res) => res.json({ version: 1, ids: [1, 2] }))
  app.get(['/data/link.:id.mp3', '/karaoke/link.:id.instrumental.mp3'], (_req, res) => res.sendFile(media))
  app.get(['/lyrics/link.:id.l', '/data/lyrics/link.:id.l'], (_req, res) => res.type('text').send('Fixture song\nSing along'))
  app.get('/synced/link.:id.lrc', (_req, res) => res.type('text').send('[00:05.00]Sing along\n[00:10.00]Second line'))
  const dist = path.resolve(process.env.KARAOKE_GUIDE_TEST_DIST || 'dist')
  app.use(express.static(dist)); app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  let debug = process.env.CHROME_DEBUG_URL
  if (!debug) {
    const profile = path.join(root, 'chrome')
    chrome = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--no-first-run', '--no-default-browser-check', '--autoplay-policy=document-user-activation-required',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
    let port
    await poll(async () => {
      try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return !!port }
      catch { return false }
    }, 'Chrome debug port')
    debug = `http://127.0.0.1:${port}`
  }
  const info = await (await fetch(debug + '/json/version')).json()
  socket = new WebSocket(info.webSocketDebuggerUrl); await once(socket, 'open')
  socket.on('message', raw => {
    const message = JSON.parse(raw)
    if (message.id) {
      const task = pending.get(message.id)
      if (!task) return
      pending.delete(message.id)
      message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result)
    } else if (message.method === 'Page.javascriptDialogOpening') {
      dialogs.push(message.params)
      void cdp('Page.handleJavaScriptDialog', { accept: dialogChoice }, message.sessionId)
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
  })
  console.log('Browser:', info.Browser)
  const host = await page(origin, '/sing', 1100)
  await poll(() => evaluate(host, `!!${store('songs')}?.songs.length && !!${store('player')}.audioElement && !!${store('player')}.currentSong && ${store('songs')}.titleLoadingProgress < 0`), 'host library')
  await evaluate(host, `${store('player')}.playSong(${store('songs')}.songs.find(song => song.id === 1), ${store('songs')}.songs, 0)`)
  await poll(() => evaluate(host, `${store('player')}.audioElement.readyState >= 3 && ${store('player')}.isPlaying`), 'host instrumental playing')
  await evaluate(host, `${store('player')}.seek(20)`)
  await clickText(host, 'Pair vocal guide')
  await poll(() => evaluate(host, `!!document.querySelector('#karaoke-guide-link')?.value && document.querySelector('canvas[aria-label="Scan to pair your vocal guide"]')?.width === 224`), 'QR and pairing link')
  const link = await evaluate(host, `document.querySelector('#karaoke-guide-link').value`)
  check(new URL(link).pathname === '/sing/guide' && new URL(link).hash.includes('token='), 'QR targets regular karaoke guide with a fragment credential')
  check(await evaluate(host, `${store('player')}.audioElement.src.includes('.instrumental.mp3')`), 'main device continues instrumental playback')
  const phone = await page(origin, new URL(link).pathname + new URL(link).hash)
  await poll(() => evaluate(phone, `document.body?.innerText.includes('Paired · tap Start vocal guide')`), 'phone paired')
  check(await evaluate(phone, `document.querySelector('.karaoke-vocal-guide audio').paused && !${store('player')}.currentSong && ${store('songs')}.songs.length === 0`), 'phone waits for a tap and does not auto-play or load the music catalog')
  check(await evaluate(phone, `!location.hash && !document.querySelector('.player-controls') && !document.querySelector('.floating-recorder')`), 'guide removes its URL credential and hides the regular player and recorder')
  await clickText(phone, 'Start vocal guide')
  await poll(() => evaluate(phone, `!document.querySelector('audio').paused && document.querySelector('audio').currentTime > 19`), 'mid-song guide playback')
  let drift
  await poll(async () => {
    const [hostPosition, phonePosition] = await Promise.all([
      evaluate(host, `${store('player')}.audioElement.currentTime`),
      evaluate(phone, `document.querySelector('audio').currentTime`),
    ])
    drift = Math.abs(hostPosition - phonePosition)
    return drift < 0.35
  }, 'mid-song seek settles and drift correction aligns media', 30)
  check(drift < 0.35, `mid-song media positions align (${drift.toFixed(3)}s drift)`)
  check(await evaluate(phone, `document.querySelector('audio').src.endsWith('/data/link.1.mp3')`), 'phone plays the original track with vocals')
  await poll(() => evaluate(host, `document.body?.innerText.includes('1 device(s) paired')`), 'host paired indicator')
  await evaluate(host, `${store('player')}.pause()`)
  await poll(() => evaluate(phone, `document.querySelector('audio').paused && document.body?.innerText.includes('Karaoke player paused')`), 'pause sync')
  await evaluate(host, `${store('player')}.seek(44)`)
  await poll(() => evaluate(phone, `Math.abs(document.querySelector('audio').currentTime - 44) < 0.1`), 'paused seek sync')
  check(true, 'phone follows host pause and seeks while paused')
  await evaluate(host, `${store('player')}.play()`)
  await poll(() => evaluate(phone, `!document.querySelector('audio').paused`), 'resume sync')
  await evaluate(host, `${store('player')}.audioElement.playbackRate = 1.25`)
  await poll(() => evaluate(phone, `Math.abs(document.querySelector('audio').playbackRate - 1.25) < 0.05`), 'rate sync')
  check(true, 'phone follows resume and playback rate changes')
  await evaluate(phone, `(() => { const slider = document.querySelector('#vocal-guide-offset'); slider.value = '500'; slider.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await poll(() => evaluate(phone, `localStorage.getItem('karaoke-guide-offset') === '500'`), 'timing preference')
  await clickText(phone, 'Reset timing')
  check(await evaluate(phone, `document.querySelector('.karaoke-vocal-guide').scrollWidth <= document.querySelector('.karaoke-vocal-guide').clientWidth`), '320px guide layout has no horizontal overflow')
  await clickText(phone, 'Stop guide on this device')
  check(await evaluate(host, `!${store('player')}.audioElement.paused`), 'stopping the private guide leaves host playback running')
  await clickText(phone, 'Start vocal guide')
  async function control(action) {
    await poll(() => evaluate(phone, `${store('karaokeDevice')}.canControl`), 'remote controls ready')
    await evaluate(phone, `document.querySelector('[data-command="${action}"]').click()`)
    await poll(() => evaluate(phone, `!${store('karaokeDevice')}.pending && ${store('karaokeDevice')}.commandNotice === 'commandApplied'`), 'remote ' + action)
  }
  await control('pause')
  await poll(() => evaluate(host, `${store('player')}.audioElement.paused`), 'remote pause on host')
  await control('play')
  await poll(() => evaluate(host, `!${store('player')}.audioElement.paused`), 'remote play on host')
  await evaluate(phone, `(() => { const slider = document.querySelector('#karaoke-remote-seek'); slider.value = '12'; slider.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await poll(() => evaluate(host, `${store('player')}.audioElement.currentTime >= 12 && ${store('player')}.audioElement.currentTime < 17`), 'remote seek on host')
  await poll(() => evaluate(phone, `!${store('karaokeDevice')}.pending`), 'remote seek acknowledged')
  await control('stop')
  await poll(() => evaluate(host, `${store('player')}.audioElement.paused && ${store('player')}.audioElement.currentTime === 0`), 'remote stop on host')
  check(true, 'phone controls host play, pause, seek and stop/reset')
  await control('play')
  await evaluate(phone, `(() => { const input = document.querySelector('input[type="search"]'); input.value = 'Second'; input.dispatchEvent(new Event('input', { bubbles: true })); input.form.requestSubmit(); })()`)
  await poll(() => evaluate(phone, `!!document.querySelector('[data-song-id="2"]') && !document.querySelector('[data-song-id="1"]')`), 'remote song search')
  await evaluate(phone, `document.querySelector('[data-song-id="2"] [data-action="enqueue"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.requestedQueue[0]?.id === 2`), 'remote song added')
  await poll(() => evaluate(phone, `${store('karaokeDevice')}.queue[0]?.id === 2 && !${store('karaokeDevice')}.pending`), 'queue sync')
  await evaluate(phone, `(() => { const input = document.querySelector('input[type="search"]'); input.value = 'First'; input.dispatchEvent(new Event('input', { bubbles: true })); input.form.requestSubmit(); })()`)
  await poll(() => evaluate(phone, `!!document.querySelector('[data-song-id="1"]')`), 'search second request')
  await evaluate(phone, `document.querySelector('[data-song-id="1"] [data-action="enqueue"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.requestedQueue.length === 2`), 'two remote requests')
  await evaluate(host, `${store('player')}.shuffle = true; ${store('player')}.repeat = 'one'`)
  loseCommandResponse = true
  await control('skip')
  await poll(() => evaluate(host, `${store('player')}.currentSong.id === 2 && ${store('player')}.requestedQueue.length === 1`), 'skip honors request queue')
  await new Promise(resolve => setTimeout(resolve, 2800))
  check(await evaluate(host, `${store('player')}.currentSong.id === 2 && ${store('player')}.requestedQueue.length === 1`), 'lost command response cannot execute skip twice; requests override shuffle and repeat')
  await control('skip')
  await poll(() => evaluate(host, `${store('player')}.currentSong.id === 1 && ${store('player')}.requestedQueue.length === 0`), 'FIFO second request')
  check(true, 'phone searches ready karaoke songs and adds a synchronized FIFO queue')
  await evaluate(phone, `(() => { const input = document.querySelector('input[type="search"]'); input.value = 'Second'; input.dispatchEvent(new Event('input', { bubbles: true })); input.form.requestSubmit(); })()`)
  await poll(() => evaluate(phone, `!!document.querySelector('[data-song-id="2"]') && ${store('karaokeDevice')}.canControl`), 'sing now search')
  await evaluate(phone, `document.querySelector('[data-song-id="2"] [data-action="singNow"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.currentSong.id === 2`), 'sing now starts host')
  check(true, 'Sing now starts the selected song on the host')
  await evaluate(host, `${store('player')}.playSong(${store('songs')}.songs.find(song => song.id === 2), ${store('songs')}.songs, 1)`)
  await poll(() => evaluate(phone, `document.querySelector('audio').src.endsWith('/data/link.2.mp3') && !document.querySelector('audio').paused && document.body?.innerText.includes('Second guide song')`), 'song change sync')
  check(true, 'paired guide automatically follows song changes')
  await evaluate(host, `document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/library')`)
  await evaluate(host, `${store('player')}.seek(35)`)
  await poll(() => evaluate(phone, `document.querySelector('audio').currentTime > 34 && document.querySelector('audio').currentTime < 39`), 'pairing while browsing')
  check(true, 'guide stays paired when the host browses another page')
  dropHostUpdates = true
  await poll(() => evaluate(phone, `document.querySelector('audio').paused && document.body?.innerText.includes('Waiting for the karaoke player to reconnect')`), 'stale host stops audio')
  dropHostUpdates = false
  await poll(() => evaluate(phone, `!document.querySelector('audio').paused`), 'reconnect resumes guide')
  check(true, 'stale host updates pause guide audio and reconnect restores sync')
  await cdp('Page.reload', {}, phone)
  await poll(() => evaluate(phone, `document.body?.innerText.includes('Paired · tap Start vocal guide')`), 'guide reload pairing')
  check(await evaluate(phone, `document.querySelector('audio').paused`), 'guide reload retains pairing and requires a fresh playback tap')
  await clickText(phone, 'Start vocal guide')
  await poll(() => evaluate(phone, `!!navigator.serviceWorker.controller`), 'PWA controls the guide page')
  check(await evaluate(phone, `(async () => {
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) {
      if (new URL(request.url).pathname.startsWith('/api/karaoke-guide')) return false;
    }
    return true;
  })()`), 'PWA stores no live guide sessions or credentials')
  await cdp('Network.enable', {}, phone)
  await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }, phone)
  try {
    await poll(() => evaluate(phone, `document.querySelector('audio').paused && document.body?.innerText.includes('Reconnecting')`), 'offline guide stops')
    check(true, 'offline PWA cannot replay cached guide state or continue following stale playback')
  } finally {
    await cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }, phone)
  }
  await poll(() => evaluate(phone, `!document.querySelector('audio').paused`), 'phone reconnect restores guide')
  await evaluate(host, `${store('karaokeGuide')}.stop()`)
  await poll(() => evaluate(phone, `document.querySelector('audio').paused && document.body?.innerText.includes('Pairing has ended')`), 'ending pairing')
  check(true, 'ending pairing stops guide audio and invalidates the link')
  // A fresh session checks browser Back warnings and returning without rescanning.
  await evaluate(host, `${store('karaokeGuide')}.start()`)
  const newLink = await evaluate(host, `${store('karaokeGuide')}.pairUrl`)
  const leavingPhone = await page(origin, '/library')
  await evaluate(leavingPhone, `document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(new URL(newLink).pathname + new URL(newLink).hash)})`)
  await poll(() => evaluate(leavingPhone, `document.body?.innerText.includes('Paired · tap Start vocal guide')`), 'returning phone paired')
  await clickText(leavingPhone, 'Start vocal guide')
  await poll(() => evaluate(leavingPhone, `!document.querySelector('.karaoke-vocal-guide audio').paused`), 'returning phone plays')
  const deviceId = await evaluate(leavingPhone, `${store('karaokeDevice')}.grant.deviceId`)
  const savedToken = await evaluate(leavingPhone, `${store('karaokeDevice')}.grant.token`)
  dialogChoice = false
  await evaluate(leavingPhone, `history.back()`)
  await poll(() => Promise.resolve(dialogs.some(dialog => dialog.type === 'confirm' && dialog.message.includes('Your pairing stays saved'))), 'browser Back warning')
  check(await evaluate(leavingPhone, `!!document.querySelector('.karaoke-vocal-guide') && !document.querySelector('.karaoke-vocal-guide audio').paused`), 'cancelling browser Back keeps the paired guide and audio open')
  dialogChoice = true
  await evaluate(leavingPhone, `window.__guideAudio = document.querySelector('.karaoke-vocal-guide audio'); history.back()`)
  await poll(() => evaluate(leavingPhone, `!!document.querySelector('.karaoke-pair-return') && window.__guideAudio.paused && !window.__guideAudio.getAttribute('src')`), 'guide route cleanup and return link')
  await poll(() => evaluate(host, `${store('karaokeGuide')}.devices.find(item => item.id === '${deviceId}')?.status === 'away'`), 'host away device status')
  await cdp('Page.reload', {}, leavingPhone)
  await poll(() => evaluate(leavingPhone, `!!document.querySelector('.karaoke-pair-return')`), 'saved pairing after away reload')
  await evaluate(leavingPhone, `document.querySelector('.karaoke-pair-return').click()`)
  await poll(() => evaluate(leavingPhone, `document.body?.innerText.includes('Paired · tap Start vocal guide')`), 'resume guide')
  check(await evaluate(leavingPhone, `${store('karaokeDevice')}.grant.token === '${savedToken}' && document.querySelector('.karaoke-vocal-guide audio').paused`), 'confirmed Back stops guide audio; saved pairing returns after reload without another scan')
  await clickText(leavingPhone, 'Start vocal guide')
  await poll(() => evaluate(leavingPhone, `!document.querySelector('.karaoke-vocal-guide audio').paused`), 'resumed guide audio source')
  await evaluate(host, `document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/sing')`)
  await poll(() => evaluate(host, `!!document.querySelector('[data-device-id="${deviceId}"] input[type="checkbox"]')`), 'host device controls')
  await evaluate(host, `document.querySelector('[data-device-id="${deviceId}"] input[type="checkbox"]').click()`)
  await poll(() => evaluate(leavingPhone, `!${store('karaokeDevice')}.device.canControl && document.querySelector('[data-command="pause"]').disabled`), 'host disables remote controls')
  check(await evaluate(leavingPhone, `!document.querySelector('.karaoke-vocal-guide audio').paused`), 'host can disable controls while allowing vocal-guide listening')
  await evaluate(host, `document.querySelector('[data-device-id="${deviceId}"] input[type="checkbox"]').click()`)
  await poll(() => evaluate(leavingPhone, `${store('karaokeDevice')}.canControl`), 'host restores remote controls')
  const otherPhone = await page(origin, new URL(newLink).pathname + new URL(newLink).hash)
  await poll(() => evaluate(otherPhone, `!!${store('karaokeDevice')}.device`), 'second independent device')
  await evaluate(host, `document.querySelector('[data-device-id="${deviceId}"] button').click()`)
  await poll(() => evaluate(leavingPhone, `document.body?.innerText.includes('The host removed this device') && !${store('karaokeDevice')}.grant && document.querySelector('.karaoke-vocal-guide audio').paused`), 'host removes device')
  check(await evaluate(otherPhone, `!!${store('karaokeDevice')}.grant && ${store('karaokeDevice')}.hostOnline`), 'host removal clears only the selected phone; another paired device stays connected')
  check(await evaluate(host, `${store('karaokeGuide')}.pairUrl !== ${JSON.stringify(newLink)}`), 'removing a device refreshes the QR invitation')
  const invalid = await page(origin, '/sing/guide', 320, 'zh')
  await poll(() => evaluate(invalid, `document.body?.innerText.includes('配对链接无效')`), 'localized invalid pair')
  check(true, 'missing pairing links show a localized recovery message')
  check(errors.length === 0, 'no uncaught browser errors: ' + errors.join('\n'))
  console.log(`${passed} karaoke guide browser checks passed`)
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    for (const browserContextId of contexts) await cdp('Target.disposeBrowserContext', { browserContextId }).catch(() => {})
    socket.close()
  }
  if (chrome) { chrome.kill('SIGTERM'); await once(chrome, 'exit').catch(() => {}) }
  guide?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await fs.rm(root, { recursive: true, force: true })
}
