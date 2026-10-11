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
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('language', '${language}'); localStorage.setItem('auth_token', 'fixture-host'); localStorage.setItem('music-player-karaoke-mode', 'true');
    if (!localStorage.getItem('music-visualizer-settings')) localStorage.setItem('music-visualizer-settings', JSON.stringify({ v: 2, type: 'circle', colorScheme: 'blue' }));
    window.__visualizerSources = []; window.__visualizerAnalysers = []; window.__waveSamples = 0;
    if (window.AudioContext) {
      const source = AudioContext.prototype.createMediaElementSource, analyser = AudioContext.prototype.createAnalyser;
      AudioContext.prototype.createMediaElementSource = function(element) {
        const node = source.call(this, element); window.__visualizerSources.push({ element, context: this }); return node;
      };
      AudioContext.prototype.createAnalyser = function() {
        const node = analyser.call(this), read = node.getByteTimeDomainData;
        node.getByteTimeDomainData = function(values) { window.__waveSamples++; return read.call(this, values); };
        window.__visualizerAnalysers.push(node); return node;
      };
    }
  ` }, sessionId)
  await cdp('Page.navigate', { url: origin + route }, sessionId)
  await poll(() => evaluate(sessionId, `!!document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia`), 'Vue mount')
  return sessionId
}
async function clickText(session, text) {
  await evaluate(session, `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`)
}
async function reloadPage(session) {
  await evaluate(session, 'window.__beforeReload = true')
  await cdp('Page.reload', {}, session)
  await poll(() => evaluate(session, `!window.__beforeReload && !!document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia`), 'reload mounts a new document')
}
async function screenshot(session, suffix = '') {
  if (!process.env.KARAOKE_GUIDE_SCREENSHOT) return
  const file = path.parse(process.env.KARAOKE_GUIDE_SCREENSHOT)
  const shot = await cdp('Page.captureScreenshot', { format: 'png' }, session)
  await fs.writeFile(path.join(file.dir, file.name + suffix + '.png'), Buffer.from(shot.data, 'base64'))
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
  app.get('/karaoke/karaoke_manifest.json', (_req, res) => res.json({ version: 1, ids: Array.from({ length: 33 }, (_, index) => index + 1) }))
  app.get(['/data/link.:id.mp3', '/karaoke/link.:id.instrumental.mp3'], (_req, res) => res.sendFile(media))
  app.get(['/lyrics/link.:id.mp3.l', '/data/lyrics/link.:id.mp3.l', '/lyrics/link.:id.l', '/data/lyrics/link.:id.l'], (_req, res) => res.type('text').send('Fixture song\nSing along'))
  app.get('/synced/link.:id.lrc', (_req, res) => res.type('text').send(Array.from({ length: 45 }, (_, index) => {
    const seconds = index * 2
    return `[${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.00]Sing along · line ${index + 1}`
  }).join('\n')))
  app.get(['/poster/link.:id.jpg', '/data/poster/link.:id.jpg'], (req, res) => res.type('svg').send(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="${req.params.id === '1' ? '#4b306d' : '#336678'}"/><circle cx="450" cy="450" r="240" fill="#c8a16a"/><text x="400" y="490" font-size="120">${Number(req.params.id)}</text></svg>`))
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
  await poll(() => evaluate(phone, `document.querySelectorAll('[data-song-browser] [data-song-id]').length === 2`), 'paired phone auto-loads its browsable catalog')
  check(await evaluate(phone, `!!document.querySelector('[data-song-browser] [data-song-id="1"] img') && document.querySelector('[data-song-browser] [data-song-id="2"] .remote-song-id').textContent.includes('2') && document.querySelector('#guide-song-search').compareDocumentPosition(document.querySelector('#guide-browse-songs')) & Node.DOCUMENT_POSITION_FOLLOWING`), 'paired phone browses cover-and-title song rows with IDs below search without loading the host library')
  await poll(() => evaluate(phone, `document.querySelector('.guide-current-song-id')?.textContent.includes('1')`), 'paired now-playing ID')
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
  await evaluate(phone, `(() => {
    const audio = document.querySelector('audio'), load = audio.load.bind(audio);
    window.__guideGrant = ${store('karaokeDevice')}.grant.token;
    window.__guideLoads = 0;
    audio.load = () => {
      window.__guideLoads++;
      for (const key of ['currentTime', 'paused', 'seeking', 'error']) delete audio[key];
      return load();
    };
    const position = audio.currentTime;
    audio.pause();
    Object.defineProperties(audio, {
      currentTime: { configurable: true, get: () => position, set: () => {} },
      paused: { configurable: true, get: () => false },
      seeking: { configurable: true, get: () => true },
    });
    audio.dispatchEvent(new Event('stalled'));
  })()`)
  await poll(() => evaluate(phone, `window.__guideLoads === 1 && !document.querySelector('audio').paused && !document.querySelector('audio').seeking && document.querySelector('audio').currentTime > 25`), 'stuck decoder reloads the same song')
  await poll(async () => {
    const [hostPosition, phonePosition] = await Promise.all([
      evaluate(host, `${store('player')}.audioElement.currentTime`), evaluate(phone, `document.querySelector('audio').currentTime`),
    ])
    return Math.abs(hostPosition - phonePosition) < 0.35
  }, 'recovered guide catches up to the host')
  check(await evaluate(phone, `${store('karaokeDevice')}.grant.token === window.__guideGrant && document.querySelector('audio').src.endsWith('/data/link.1.mp3')`), 'stuck seeking recovers the current song and resyncs without repairing the pairing or skipping')
  check(await evaluate(host, `${store('player')}.currentSong.id === 1 && !${store('player')}.audioElement.paused`), 'automatic guide recovery leaves host playback running on the same song')
  await evaluate(phone, `(() => {
    const audio = document.querySelector('audio');
    Object.defineProperty(audio, 'error', { configurable: true, get: () => ({ code: 2 }) });
    audio.dispatchEvent(new Event('error'));
  })()`)
  await poll(() => evaluate(phone, `document.body.innerText.includes('Recovering audio')`), 'transient audio error displays recovery status')
  await poll(() => evaluate(phone, `window.__guideLoads === 2 && !document.querySelector('audio').paused && document.querySelector('audio').currentTime > 25`), 'transient media error automatically resumes')
  check(await evaluate(phone, `!!document.querySelector('[data-action="repair-audio"]') && ${store('karaokeDevice')}.grant.token === window.__guideGrant`), 'transient media errors recover automatically and retain guide controls and the device grant')
  await evaluate(phone, `(() => { const slider = document.querySelector('#vocal-guide-volume'); slider.value = '0.35'; slider.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-action="repair-audio"]').click(); })()`)
  await poll(() => evaluate(phone, `window.__guideLoads === 3 && !document.querySelector('audio').paused && document.querySelector('audio').currentTime > 25`), 'manual same-song repair')
  check(await evaluate(phone, `document.querySelector('audio').volume === 0.35 && ${store('karaokeDevice')}.grant.token === window.__guideGrant`) && await evaluate(host, `${store('player')}.currentSong.id === 1 && !${store('player')}.audioElement.paused`), 'Repair audio resumes the current song while preserving volume, pairing and host playback')
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
  await cdp('Page.bringToFront', {}, host)
  await evaluate(host, `${store('ui')}.showVisualizer = true`)
  await poll(() => evaluate(host, `!!document.querySelector('.music-visualizer') && window.__visualizerSources.length === 1`), 'regular visualizer audio source')
  await evaluate(host, `window.__visualizerNode = document.querySelector('.music-visualizer')`)
  await evaluate(host, `window.__karaokeStage = document.querySelector('.karaoke-view .singing-guide'); window.__fullscreenExits = 0;
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) window.__fullscreenExits++; });
    window.__karaokeStage.querySelector('.guide-icon-button').click()`)
  await poll(() => evaluate(host, `document.fullscreenElement === window.__karaokeStage && !!document.fullscreenElement.querySelector('.stage-queue')`), 'host fullscreen with queue')
  check(true, 'fullscreen singing stage includes the live requested-song queue')
  await poll(() => evaluate(host, `document.fullscreenElement.querySelector('.stage-pairing canvas')?.width === 224`), 'fullscreen pairing QR renders on entry')
  check(await evaluate(host, `document.fullscreenElement.querySelector('.stage-pairing canvas').toDataURL() === document.querySelector('#vocal-guide-pairing-title').closest('section').querySelector('canvas').toDataURL()`), 'fullscreen shows the same current QR invitation as the host pairing panel')
  await poll(() => evaluate(host, `document.fullscreenElement.querySelector('.music-visualizer')?.dataset.visualizerType === 'bars'`), 'fullscreen visualization')
  check(await evaluate(host, `document.fullscreenElement.querySelector('.music-visualizer') === window.__visualizerNode && window.__visualizerNode.dataset.visualizerColor === 'rainbow' && window.__visualizerSources.length === 1`), 'fullscreen defaults to rainbow bars and reuses the existing visualizer audio source')
  await poll(() => evaluate(host, `(() => { const node = window.__visualizerAnalysers[0], values = new Uint8Array(node.frequencyBinCount); node.getByteFrequencyData(values); return values.some(value => value > 0); })()`), 'live visualizer signal')
  check(true, 'fullscreen visualization receives live audio frequency data')
  await evaluate(host, `document.fullscreenElement.querySelector('.visualizer-settings-button').click()`)
  check(await evaluate(host, `document.fullscreenElement.querySelector('#visualizer-type').options.length === 6 && document.fullscreenElement.querySelector('#visualizer-color').value === 'rainbow'`), 'fullscreen settings expose all six visualizations and color schemes')
  for (const type of ['circle', 'wave', 'galaxy', 'fountain', 'terrain', 'bars']) {
    await evaluate(host, `(() => { const select = document.querySelector('#visualizer-type'); select.value = '${type}'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await poll(() => evaluate(host, `document.fullscreenElement?.querySelector('.music-visualizer')?.dataset.visualizerType === '${type}'`), 'visualization ' + type)
    if (type === 'wave') await poll(() => evaluate(host, `window.__waveSamples > 0`), 'waveform reads live waveform samples')
  }
  check(true, 'all six visualization styles render, including live waveform samples')
  await evaluate(host, `document.querySelector('#music-visualizer-settings input[type="checkbox"]').click()`)
  check(await evaluate(host, `document.fullscreenElement === window.__karaokeStage && document.fullscreenElement.querySelector('.visualizer-canvas').style.display === 'none' && !${store('player')}.audioElement.paused`), 'turning off visualization keeps host audio and fullscreen active')
  await evaluate(host, `document.querySelector('#music-visualizer-settings input[type="checkbox"]').click(); document.fullscreenElement.querySelector('.visualizer-settings-button').click()`)
  const toolbarVisible = () => evaluate(host, `(() => {
    const buttons = [...document.fullscreenElement.querySelectorAll('[data-stage-command], [data-stage-mode]')];
    return buttons.length === 6 && buttons.every(button => {
      const rect = button.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
        && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('button') === button;
    });
  })()`)
  check(await toolbarVisible(), 'fullscreen always shows separate clickable play, pause, stop and next controls')
  await evaluate(host, `window.__modePair = ${store('karaokeGuide')}.session.id; window.__modePairUrl = ${store('karaokeGuide')}.pairUrl;
    document.fullscreenElement.querySelector('[data-stage-mode="original"]').click()`)
  await poll(() => evaluate(host, `!${store('player')}.karaokeMode && !${store('player')}.audioElement.paused && ${store('player')}.audioElement.src.endsWith('/link.1.mp3')`), 'fullscreen switches to Original')
  await poll(() => evaluate(phone, `${store('karaokeDevice')}.snapshot.karaoke === false && document.querySelector('[data-remote-mode="original"]').getAttribute('aria-pressed') === 'true' && !document.querySelector('audio').paused`), 'paired mode indicator follows host')
  check(await evaluate(host, `${store('karaokeGuide')}.session.id === window.__modePair && ${store('karaokeGuide')}.pairUrl === window.__modePairUrl && !!document.fullscreenElement.querySelector('.stage-pairing canvas') && document.fullscreenElement === window.__karaokeStage && window.__fullscreenExits === 0`), 'fullscreen Original switch keeps pairing, QR and fullscreen active; the phone continues its vocal guide')
  await poll(() => evaluate(phone, `!document.querySelector('[data-remote-mode="karaoke"]').disabled`), 'paired mode ready')
  await evaluate(phone, `document.querySelector('[data-remote-mode="karaoke"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.karaokeMode && !${store('player')}.audioElement.paused && ${store('player')}.audioElement.src.endsWith('/link.1.instrumental.mp3')`), 'paired switch to Karaoke')
  await poll(() => evaluate(phone, `${store('karaokeDevice')}.snapshot.karaoke === true && !document.querySelector('[data-remote-mode="original"]').disabled`), 'paired Karaoke acknowledgement and ready mode controls')
  check(await evaluate(phone, `${store('karaokeDevice')}.grant.token === window.__guideGrant && document.querySelector('audio').src.endsWith('/link.1.mp3') && !document.querySelector('audio').paused`) && await evaluate(host, `document.fullscreenElement.querySelector('[data-stage-mode="karaoke"]').getAttribute('aria-pressed') === 'true' && window.__visualizerSources.length === 1`), 'paired Karaoke button changes the host instrumental and synced indicators while preserving private original audio and visualizer')
  await evaluate(phone, `document.querySelector('[data-remote-mode="original"]').click()`)
  await poll(() => evaluate(host, `!${store('player')}.karaokeMode && !${store('player')}.audioElement.paused && ${store('player')}.audioElement.src.endsWith('/link.1.mp3')`), 'paired switch to Original')
  await poll(() => evaluate(phone, `${store('karaokeDevice')}.snapshot.karaoke === false && !${store('karaokeDevice')}.pending`), 'paired Original acknowledgement')
  check(await toolbarVisible() && await evaluate(host, `${store('karaokeGuide')}.session.id === window.__modePair && window.__fullscreenExits === 0`), 'paired Original button switches the main audio without ending pairing or leaving fullscreen')
  await evaluate(phone, `document.querySelector('[data-command="pause"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.audioElement.paused`), 'paired pause in Original mode')
  await poll(() => evaluate(phone, `!${store('karaokeDevice')}.pending && document.querySelector('audio').paused`), 'Original pause acknowledgement')
  await evaluate(phone, `document.querySelector('[data-command="play"]').click()`)
  await poll(() => evaluate(host, `!${store('player')}.audioElement.paused`), 'paired play in Original mode')
  await poll(() => evaluate(phone, `!${store('karaokeDevice')}.pending && !document.querySelector('audio').paused`), 'Original play acknowledgement')
  check(await evaluate(host, `!${store('player')}.karaokeMode && document.fullscreenElement === window.__karaokeStage`), 'paired playback controls remain functional in Original mode without exiting fullscreen')
  await evaluate(host, `${store('player')}.pause(); ${store('player')}.seek(24)`)
  await poll(() => evaluate(phone, `document.querySelector('audio').paused`), 'pause before mode switch')
  await evaluate(host, `document.fullscreenElement.querySelector('[data-stage-mode="karaoke"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.karaokeMode && ${store('player')}.audioElement.readyState >= 3 && !${store('player')}.isTransitioning`), 'paused fullscreen Karaoke switch')
  check(await evaluate(host, `${store('player')}.audioElement.paused && Math.abs(${store('player')}.audioElement.currentTime - 24) < .1`), 'fullscreen mode switches preserve the paused state and song position')
  await poll(() => evaluate(phone, `${store('karaokeDevice')}.snapshot.karaoke === true && !document.querySelector('[data-remote-mode="original"]').disabled`), 'paused paired mode ready')
  await evaluate(phone, `document.querySelector('[data-remote-mode="original"]').click()`)
  await poll(() => evaluate(host, `!${store('player')}.karaokeMode && ${store('player')}.audioElement.readyState >= 3`), 'paused paired Original switch')
  await poll(() => evaluate(phone, `${store('karaokeDevice')}.snapshot.karaoke === false && !${store('karaokeDevice')}.pending`), 'paused paired Original acknowledgement')
  check(await evaluate(host, `${store('player')}.audioElement.paused && Math.abs(${store('player')}.audioElement.currentTime - 24) < .1`) && await evaluate(phone, `document.querySelector('audio').paused && Math.abs(document.querySelector('audio').currentTime - 24) < .1`), 'paired mode switches preserve pause and timing on both devices')
  await evaluate(host, `document.fullscreenElement.querySelector('[data-stage-mode="karaoke"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.karaokeMode && ${store('player')}.audioElement.readyState >= 3`), 'restore Karaoke after mode checks')
  await evaluate(host, `${store('player')}.play()`)
  await poll(() => evaluate(phone, `!document.querySelector('audio').paused`), 'resume vocal guide after mode checks')
  await poll(() => evaluate(host, `document.fullscreenElement.querySelector('.stage-cover img')?.src.endsWith('/poster/link.1.jpg') && document.fullscreenElement.querySelector('.stage-cover img').naturalWidth > 0`), 'current song cover background')
  check(true, 'fullscreen displays the current song cover behind the lyrics and visualization')
  await evaluate(host, `document.fullscreenElement.querySelector('[data-action="toggle-stage-cover"]').click()`)
  await poll(() => evaluate(host, `!document.fullscreenElement.querySelector('.stage-cover') && localStorage.getItem('karaoke-stage-cover') === 'false'`), 'hide fullscreen cover')
  check(true, 'Hide cover removes the background artwork and saves the preference')
  await evaluate(host, `document.fullscreenElement.querySelector('[data-action="toggle-stage-cover"]').click(); document.fullscreenElement.querySelector('[data-action="toggle-stage-songs"]').click()`)
  await poll(() => evaluate(host, `document.querySelectorAll('#karaoke-stage-songs [data-song-id]').length === 2`), 'fullscreen browsable songs')
  check(await toolbarVisible() && await evaluate(host, `document.activeElement === document.querySelector('#karaoke-stage-songs input') && !!document.querySelector('#karaoke-stage-songs [data-song-id="1"] img') && document.querySelector('#karaoke-stage-songs [data-song-id="2"]').innerText.includes('ID: 2')`), 'expanded song browser focuses search, shows covers and song IDs, and leaves playback buttons accessible')
  await evaluate(host, `(() => { const input = document.querySelector('#karaoke-stage-songs input'); input.value = 'Second'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await poll(() => evaluate(host, `document.querySelectorAll('#karaoke-stage-songs [data-song-id]').length === 1 && !!document.querySelector('#karaoke-stage-songs [data-song-id="2"]')`), 'fullscreen local song search')
  check(await evaluate(host, `${store('songs')}.quickQuery === ''`), 'fullscreen song search filters independently of the main page search')
  await evaluate(host, `document.querySelector('#karaoke-stage-songs [data-song-id="2"] [data-action="enqueue"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.requestedQueue[0]?.id === 2 && document.querySelector('#karaoke-stage-songs [data-action="enqueue"]').disabled`), 'fullscreen add to queue')
  await poll(() => evaluate(phone, `${store('karaokeDevice')}.queue[0]?.id === 2`), 'paired phone sees fullscreen song request')
  check(await toolbarVisible(), 'adding a song from fullscreen syncs the paired queue and keeps the playback toolbar visible')
  await evaluate(host, `document.fullscreenElement.querySelector('[data-stage-command="next"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.currentSong.id === 2 && ${store('player')}.requestedQueue.length === 0 && document.fullscreenElement.querySelector('.stage-cover img')?.src.endsWith('/poster/link.2.jpg')`), 'fullscreen next song and background update')
  check(await evaluate(host, `document.fullscreenElement === window.__karaokeStage && window.__visualizerSources.length === 1`), 'fullscreen Next plays the queued song, updates its cover and preserves the stage and audio graph')
  for (const action of ['pause', 'play', 'stop', 'play']) {
    await poll(() => evaluate(host, `!document.fullscreenElement.querySelector('[data-stage-command="${action}"]').disabled`), 'stage control ready: ' + action)
    await evaluate(host, `document.fullscreenElement.querySelector('[data-stage-command="${action}"]').click()`)
    await poll(() => evaluate(host, action === 'play' ? `!${store('player')}.audioElement.paused` : `${store('player')}.audioElement.paused${action === 'stop' ? ` && ${store('player')}.audioElement.currentTime === 0` : ''}`), 'stage ' + action)
  }
  check(await toolbarVisible(), 'fullscreen play, pause and stop work while browsing songs; Stop resets the track')
  await evaluate(host, `(() => { const input = document.querySelector('#karaoke-stage-songs input'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await poll(() => evaluate(host, `!!document.querySelector('#karaoke-stage-songs [data-song-id="1"]')`), 'clear fullscreen search')
  await evaluate(host, `document.querySelector('#karaoke-stage-songs [data-song-id="1"] [data-action="enqueue"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.requestedQueue[0]?.id === 1`), 'enqueue song before Sing now')
  await evaluate(host, `document.querySelector('#karaoke-stage-songs [data-song-id="1"] [data-action="singNow"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.currentSong.id === 1 && !${store('player')}.audioElement.paused && !!document.fullscreenElement.querySelector('.current-line')`), 'fullscreen sing now')
  check(await evaluate(host, `document.fullscreenElement === window.__karaokeStage && ${store('player')}.audioElement.src.includes('.instrumental.mp3') && ${store('player')}.requestedQueue.length === 0`), 'Sing now starts the selected instrumental without leaving fullscreen or leaving a duplicate request queued')
  await evaluate(host, `document.querySelector('#karaoke-stage-songs [data-action="close-songs"]').click()`)
  await poll(() => evaluate(host, `!document.querySelector('#karaoke-stage-songs') && document.activeElement === document.fullscreenElement.querySelector('[data-action="toggle-stage-songs"]')`), 'song browser closes and restores focus')
  await evaluate(host, `${store('player')}.pause(); ${store('player')}.seek(60); window.__lyricsParentScroll = document.fullscreenElement.querySelector('.guide-layout').scrollTop; document.fullscreenElement.querySelector('[data-action="toggle-stage-lyrics"]').click()`)
  const currentLyricCentered = () => evaluate(host, `(() => {
    const list = document.querySelector('#karaoke-stage-lyrics .stage-lyrics-list'), active = list?.querySelector('[aria-current="true"]');
    if (!active) return false;
    const a = active.getBoundingClientRect(), b = list.getBoundingClientRect();
    return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 32;
  })()`)
  await poll(currentLyricCentered, 'full lyrics opens centered on current line')
  check(await toolbarVisible() && await evaluate(host, `document.querySelector('#karaoke-stage-lyrics .stage-lyrics-list').scrollTop > 0 && document.fullscreenElement.querySelector('.guide-layout').scrollTop === window.__lyricsParentScroll`), 'Full lyrics opens at the current line and scrolls its own window without moving the transport controls')
  await evaluate(host, `window.__lyricsScroll = document.querySelector('#karaoke-stage-lyrics .stage-lyrics-list').scrollTop; ${store('player')}.seek(20)`)
  await poll(currentLyricCentered, 'full lyrics follows a backward seek')
  check(await evaluate(host, `document.querySelector('#karaoke-stage-lyrics [aria-current="true"]').dataset.lineIndex === '10' && document.querySelector('#karaoke-stage-lyrics .stage-lyrics-list').scrollTop < window.__lyricsScroll`), 'full lyrics auto-scrolls backward when the song is seeked')
  await evaluate(host, `${store('player')}.seek(20.8); document.fullscreenElement.querySelector('[data-stage-command="play"]').click()`)
  await poll(() => evaluate(host, `Number(document.querySelector('#karaoke-stage-lyrics [aria-current="true"]')?.dataset.lineIndex) >= 11`), 'full lyrics follows normal playback')
  await poll(currentLyricCentered, 'playing full lyrics recenters on the new line')
  check(await toolbarVisible(), 'full lyrics automatically follows advancing playback while all transport buttons remain accessible')
  await evaluate(host, `${store('player')}.pause(); document.querySelector('#karaoke-stage-lyrics [data-line-index="5"]').click()`)
  await poll(() => evaluate(host, `Math.abs(${store('player')}.audioElement.currentTime - 10) < 0.1 && document.querySelector('#karaoke-stage-lyrics [aria-current="true"]')?.dataset.lineIndex === '5'`), 'click full lyrics to seek')
  check(await evaluate(host, `document.fullscreenElement === window.__karaokeStage`), 'clicking a full lyric line seeks the song and keeps fullscreen')
  await poll(currentLyricCentered, 'full lyrics recenters after clicking a line')
  await screenshot(host, '-full-lyrics')
  await evaluate(host, `document.querySelector('[data-action="close-lyrics"]').click()`)
  await poll(() => evaluate(host, `!document.querySelector('#karaoke-stage-lyrics') && document.activeElement === document.fullscreenElement.querySelector('[data-action="toggle-stage-lyrics"]')`), 'full lyrics closes and restores focus')
  await evaluate(host, `document.fullscreenElement.querySelector('[data-stage-command="play"]').click()`)
  async function stillFullscreen(label) {
    check(await evaluate(host, `document.fullscreenElement === window.__karaokeStage && window.__fullscreenExits === 0`), label)
  }
  async function control(action) {
    await poll(() => evaluate(phone, `${store('karaokeDevice')}.canControl`), 'remote controls ready')
    await evaluate(phone, `document.querySelector('[data-command="${action}"]').click()`)
    await poll(() => evaluate(phone, `!${store('karaokeDevice')}.pending && ${store('karaokeDevice')}.commandNotice === 'commandApplied'`), 'remote ' + action)
    await stillFullscreen('remote ' + action + ' keeps the same host fullscreen stage')
  }
  await control('pause')
  await poll(() => evaluate(host, `${store('player')}.audioElement.paused`), 'remote pause on host')
  await control('play')
  await poll(() => evaluate(host, `!${store('player')}.audioElement.paused`), 'remote play on host')
  await evaluate(phone, `(() => { const slider = document.querySelector('#karaoke-remote-seek'); slider.value = '12'; slider.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await poll(() => evaluate(host, `${store('player')}.audioElement.currentTime >= 12 && ${store('player')}.audioElement.currentTime < 17`), 'remote seek on host')
  await poll(() => evaluate(phone, `!${store('karaokeDevice')}.pending`), 'remote seek acknowledged')
  await stillFullscreen('remote seeking keeps the host fullscreen')
  await control('stop')
  await poll(() => evaluate(host, `${store('player')}.audioElement.paused && ${store('player')}.audioElement.currentTime === 0`), 'remote stop on host')
  check(true, 'phone controls host play, pause, seek and stop/reset')
  await control('play')
  await evaluate(phone, `(() => { const input = document.querySelector('input[type="search"]'); input.value = 'Second'; input.dispatchEvent(new Event('input', { bubbles: true })); input.form.requestSubmit(); })()`)
  await poll(() => evaluate(phone, `!!document.querySelector('[data-song-search-results] [data-song-id="2"]') && !document.querySelector('[data-song-search-results] [data-song-id="1"]')`), 'remote song search')
  await evaluate(phone, `document.querySelector('[data-song-search-results] [data-song-id="2"] [data-action="enqueue"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.requestedQueue[0]?.id === 2`), 'remote song added')
  await poll(() => evaluate(phone, `${store('karaokeDevice')}.queue[0]?.id === 2 && !${store('karaokeDevice')}.pending`), 'queue sync')
  await evaluate(phone, `(() => { const input = document.querySelector('input[type="search"]'); input.value = 'First'; input.dispatchEvent(new Event('input', { bubbles: true })); input.form.requestSubmit(); })()`)
  await poll(() => evaluate(phone, `!!document.querySelector('[data-song-search-results] [data-song-id="1"]')`), 'search second request')
  await evaluate(phone, `document.querySelector('[data-song-search-results] [data-song-id="1"] [data-action="enqueue"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.requestedQueue.length === 2`), 'two remote requests')
  await evaluate(host, `${store('player')}.shuffle = true; ${store('player')}.repeat = 'one'`)
  await poll(() => evaluate(host, `JSON.stringify([...document.fullscreenElement.querySelectorAll('[data-queued-song-id]')].map(item => Number(item.dataset.queuedSongId))) === '[2,1]'`), 'fullscreen queue order')
  check(true, 'phone requests appear in order inside fullscreen without opening another page')
  await poll(() => evaluate(phone, `document.querySelector('[data-queued-song-id="2"] .remote-queue-song-id')?.textContent.includes('2')`), 'paired queue ID')
  check(await evaluate(host, `document.fullscreenElement.querySelector('[data-queued-song-id="2"] .stage-queue-song-id').textContent.includes('2') && document.fullscreenElement.querySelector('.guide-song-id').textContent.includes('1')`), 'host and paired queues and now-playing song show actual song IDs')
  check(await evaluate(phone, `document.querySelectorAll('[data-song-browser] [data-song-id]').length === 2 && document.querySelectorAll('[data-song-search-results] [data-song-id]').length === 1`), 'search results remain separate from the full browsable list')
  await screenshot(host)
  await evaluate(phone, `document.querySelector('#guide-song-search').scrollIntoView({ block: 'start' })`)
  await screenshot(phone, '-phone')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 820, deviceScaleFactor: 1, mobile: true }, host)
  check(await evaluate(host, `document.fullscreenElement.scrollWidth <= document.fullscreenElement.clientWidth && !!document.fullscreenElement.querySelector('.stage-queue')`), '320px fullscreen retains the queue without horizontal overflow')
  await evaluate(host, `document.fullscreenElement.querySelector('.guide-layout').scrollTop = 10000`)
  check(await toolbarVisible(), 'all four fullscreen playback controls stay visible after scrolling on a 320px screen')
  await evaluate(host, `document.fullscreenElement.querySelector('[data-action="toggle-stage-songs"]').click()`)
  await poll(() => evaluate(host, `!!document.querySelector('#karaoke-stage-songs [data-song-id]')`), '320px fullscreen song browser')
  check(await toolbarVisible() && await evaluate(host, `document.querySelector('#karaoke-stage-songs').scrollWidth <= document.querySelector('#karaoke-stage-songs').clientWidth`), '320px song browser fits the screen and keeps playback controls clickable')
  await screenshot(host, '-mobile-songs')
  await evaluate(host, `document.fullscreenElement.querySelector('[data-action="toggle-stage-lyrics"]').click()`)
  await poll(() => evaluate(host, `!!document.querySelector('#karaoke-stage-lyrics .stage-lyrics-list') && !document.querySelector('#karaoke-stage-songs')`), '320px full lyrics replaces browser')
  check(await toolbarVisible() && await evaluate(host, `document.querySelector('#karaoke-stage-lyrics').scrollWidth <= document.querySelector('#karaoke-stage-lyrics').clientWidth`), '320px full lyrics replaces browsing without covering playback controls or overflowing')
  await screenshot(host, '-mobile-lyrics')
  await evaluate(host, `document.querySelector('[data-action="close-lyrics"]').click()`)
  check(await evaluate(host, `(() => { const bounds = document.fullscreenElement.querySelector('.stage-pairing canvas').getBoundingClientRect(); return bounds.width > 150 && Math.abs(bounds.width - bounds.height) < 1; })()`), 'fullscreen QR remains square and scannable at 320px')
  await evaluate(host, `document.fullscreenElement.querySelector('.visualizer-settings-button').click()`)
  check(await evaluate(host, `(() => { const panel = document.querySelector('#music-visualizer-settings').getBoundingClientRect(), button = document.querySelector('.visualizer-settings-button'), bounds = button.getBoundingClientRect(); return panel.left >= 0 && panel.right <= innerWidth && document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest('button') === button; })()`), '320px fullscreen settings fit the viewport and remain clickable above lyrics')
  await evaluate(host, `document.fullscreenElement.querySelector('.visualizer-settings-button').click()`)
  await cdp('Emulation.setDeviceMetricsOverride', { width: 740, height: 360, deviceScaleFactor: 1, mobile: true }, host)
  check(await toolbarVisible() && await evaluate(host, `document.fullscreenElement.querySelector('.stage-workspace').clientHeight > 100`), 'short landscape fullscreen keeps playback buttons visible and leaves room for lyrics')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1100, height: 820, deviceScaleFactor: 1, mobile: false }, host)
  await evaluate(host, `window.__getSongLyrics = ${store('songs')}.getSongLyrics;
    ${store('songs')}.getSongLyrics = async (...args) => { await new Promise(resolve => setTimeout(resolve, 1500)); return window.__getSongLyrics(...args); }`)
  loseCommandResponse = true
  await control('skip')
  await poll(() => evaluate(host, `${store('player')}.currentSong.id === 2 && ${store('player')}.requestedQueue.length === 1`), 'skip honors request queue')
  await poll(() => evaluate(host, `!!document.fullscreenElement?.querySelector('.guide-fallback') && document.fullscreenElement.innerText.includes('Loading lyrics')`), 'lyrics loading inside fullscreen')
  await stillFullscreen('changing songs keeps fullscreen while replacement lyrics are loading')
  await evaluate(host, `${store('songs')}.getSongLyrics = window.__getSongLyrics`)
  await poll(() => evaluate(host, `!!document.fullscreenElement?.querySelector('.current-line') && !document.fullscreenElement.querySelector('[data-queued-song-id="2"]')`), 'replacement lyrics and queue update')
  await new Promise(resolve => setTimeout(resolve, 2800))
  check(await evaluate(host, `${store('player')}.currentSong.id === 2 && ${store('player')}.requestedQueue.length === 1`), 'lost command response cannot execute skip twice; requests override shuffle and repeat')
  await control('skip')
  await poll(() => evaluate(host, `${store('player')}.currentSong.id === 1 && ${store('player')}.requestedQueue.length === 0`), 'FIFO second request')
  check(true, 'phone searches ready karaoke songs and adds a synchronized FIFO queue')
  await evaluate(phone, `(() => { const input = document.querySelector('input[type="search"]'); input.value = 'Second'; input.dispatchEvent(new Event('input', { bubbles: true })); input.form.requestSubmit(); })()`)
  await poll(() => evaluate(phone, `!!document.querySelector('[data-song-search-results] [data-song-id="2"]') && ${store('karaokeDevice')}.canControl`), 'sing now search')
  await evaluate(phone, `document.querySelector('[data-song-search-results] [data-song-id="2"] [data-action="singNow"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.currentSong.id === 2`), 'sing now starts host')
  await stillFullscreen('remote Sing now keeps the host fullscreen')
  check(true, 'Sing now starts the selected song on the host')
  await evaluate(host, `${store('songs')}.songs.push({ id: 3, title: 'Plain guide song', filename: 'link.3.mp3', duration: 90, lyricsMode: 'manual', isFavorite: false })`)
  await poll(() => evaluate(host, `!${store('karaokeGuide')}.catalogBusy`), 'host catalog idle')
  await new Promise(resolve => setTimeout(resolve, 800))
  await evaluate(phone, `(() => { const input = document.querySelector('input[type="search"]'); input.value = 'Plain'; input.dispatchEvent(new Event('input', { bubbles: true })); input.form.requestSubmit(); })()`)
  await poll(() => evaluate(phone, `!!document.querySelector('[data-song-search-results] [data-song-id="3"]') && ${store('karaokeDevice')}.canControl`), 'plain song search')
  await evaluate(host, `document.fullscreenElement.querySelector('[data-action="toggle-stage-lyrics"]').click()`)
  await evaluate(phone, `document.querySelector('[data-song-search-results] [data-song-id="3"] [data-action="singNow"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.currentSong.id === 3 && !!document.fullscreenElement?.querySelector('.guide-plain-lyrics')`), 'plain lyrics fallback in fullscreen')
  await poll(() => evaluate(host, `document.querySelector('#karaoke-stage-lyrics .stage-plain-lyrics')?.innerText.includes('Fixture song')`), 'full lyrics switches to plain lyrics on song change')
  check(await toolbarVisible(), 'full lyrics stays open across song changes and supports songs with plain lyrics')
  await evaluate(host, `document.querySelector('[data-action="close-lyrics"]').click()`)
  await stillFullscreen('songs without synchronized lyrics keep fullscreen and display plain lyrics')
  await poll(() => evaluate(phone, `${store('karaokeDevice')}.canControl`), 'plain song request acknowledged')
  await evaluate(phone, `document.querySelector('[data-song-search-results] [data-song-id="3"] [data-action="enqueue"]').click()`)
  await poll(() => evaluate(host, `!!document.fullscreenElement?.querySelector('[data-queued-song-id="3"]')`), 'new queue entry in fullscreen')
  await poll(() => evaluate(phone, `${store('karaokeDevice')}.canControl && ${store('karaokeDevice')}.queue.length === 1`), 'queue removal ready')
  await evaluate(phone, `document.querySelector('button[aria-label="Remove Plain guide song from the queue"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.requestedQueue.length === 0 && !!document.fullscreenElement?.querySelector('.stage-queue-empty')`), 'empty queue update in fullscreen')
  await stillFullscreen('removing the last queued song updates fullscreen to the empty state')
  await evaluate(host, `${store('player')}.playSong(${store('songs')}.songs.find(song => song.id === 2), ${store('songs')}.songs, 1)`)
  await poll(() => evaluate(phone, `document.querySelector('audio').src.endsWith('/data/link.2.mp3') && !document.querySelector('audio').paused && document.body?.innerText.includes('Second guide song')`), 'song change sync')
  check(true, 'paired guide automatically follows song changes')
  await evaluate(host, `document.fullscreenElement.querySelector('.visualizer-settings-button').click()`)
  await poll(() => evaluate(host, `!!document.querySelector('#visualizer-type')`), 'open settings before saving preferences')
  await evaluate(host, `
    for (const [id, value] of [['visualizer-type', 'wave'], ['visualizer-color', 'fire']]) {
      const select = document.getElementById(id); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    for (const [id, value] of [['visualizer-background', '0.3'], ['visualizer-height', '0.5']]) {
      const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }`)
  await poll(() => evaluate(host, `(() => { const saved = JSON.parse(localStorage.getItem('karaoke-stage-visualizer-settings')); return saved.colorScheme === 'fire' && saved.backgroundOpacity === 0.3 && saved.barHeight === 0.5; })()`), 'saved fullscreen visualization preferences')
  await screenshot(host, '-settings')
  await evaluate(host, `document.fullscreenElement.querySelector('[data-action="toggle-stage-cover"]').click()`)
  await evaluate(host, `document.fullscreenElement.querySelector('.guide-icon-button').click()`)
  await poll(() => evaluate(host, `!document.fullscreenElement`), 'explicit fullscreen exit')
  check(true, 'host can explicitly leave fullscreen')
  await poll(() => evaluate(host, `document.querySelector('.music-visualizer')?.dataset.visualizerType === 'circle' && document.querySelector('.music-visualizer')?.dataset.visualizerColor === 'blue'`), 'restore regular visualizer preferences')
  check(await evaluate(host, `document.querySelector('.music-visualizer') === window.__visualizerNode && window.__visualizerSources.length === 1 && window.__visualizerSources[0].context.state === 'running'`), 'leaving fullscreen restores regular visualization settings and keeps the original audio graph running')
  await evaluate(host, `document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/library')`)
  await evaluate(host, `${store('player')}.seek(35)`)
  await poll(() => evaluate(phone, `document.querySelector('audio').currentTime > 34 && document.querySelector('audio').currentTime < 39`), 'pairing while browsing')
  check(true, 'guide stays paired when the host browses another page')
  await evaluate(host, `window.__sidebarStage = document.querySelector('.singing-guide.is-compact'); window.__sidebarStage.querySelector('.guide-icon-button').click()`)
  await poll(() => evaluate(host, `document.fullscreenElement === window.__sidebarStage`), 'lyrics sidebar fullscreen')
  await poll(() => evaluate(host, `document.fullscreenElement.querySelector('.stage-pairing canvas')?.width === 224`), 'sidebar fullscreen QR renders on entry')
  check(true, 'expanding the lyrics sidebar also displays the pairing QR')
  check(await evaluate(host, `!document.fullscreenElement.querySelector('.stage-cover') && document.fullscreenElement.querySelector('[data-action="toggle-stage-cover"]').textContent.includes('Show cover')`), 'fullscreen remembers the hidden-cover preference across stage instances')
  await evaluate(host, `document.fullscreenElement.querySelector('[data-action="toggle-stage-cover"]').click()`)
  check(await evaluate(host, `document.fullscreenElement.querySelector('.music-visualizer').dataset.visualizerType === 'wave' && document.fullscreenElement.querySelector('.music-visualizer').dataset.visualizerColor === 'fire' && window.__visualizerSources.length === 1`), 'fullscreen remembers the chosen visualization and color across stage instances')
  await evaluate(host, `document.fullscreenElement.querySelector('.visualizer-settings-button').click()`)
  await poll(() => evaluate(host, `!!document.querySelector('#visualizer-height')`), 'saved sliders in fullscreen settings')
  check(await evaluate(host, `document.querySelector('#visualizer-background').value === '0.3' && document.querySelector('#visualizer-height').value === '0.5'`), 'fullscreen restores the chosen background opacity and bar height')
  await evaluate(host, `document.fullscreenElement.querySelector('.visualizer-settings-button').click()`)
  await poll(() => evaluate(phone, `${store('karaokeDevice')}.canControl`), 'sidebar control ready')
  await evaluate(phone, `${store('karaokeDevice')}.command('singNow', { songId: 1 })`)
  await poll(() => evaluate(host, `${store('player')}.currentSong.id === 1 && document.fullscreenElement?.querySelector('.guide-song').textContent.includes('First guide song')`), 'sidebar song change')
  await poll(() => evaluate(host, `!!document.fullscreenElement?.querySelector('.current-line')`), 'sidebar replacement lyrics')
  check(await evaluate(host, `document.fullscreenElement === window.__sidebarStage && !!document.fullscreenElement.querySelector('.stage-queue')`), 'expanded lyrics sidebar also stays fullscreen across remote song changes')
  await evaluate(host, `document.fullscreenElement.querySelector('.guide-icon-button').click()`)
  await poll(() => evaluate(host, `!document.fullscreenElement`), 'sidebar fullscreen exit')
  dropHostUpdates = true
  await poll(() => evaluate(phone, `document.querySelector('audio').paused && document.body?.innerText.includes('Waiting for the karaoke player to reconnect')`), 'stale host stops audio')
  dropHostUpdates = false
  await poll(() => evaluate(phone, `!document.querySelector('audio').paused`), 'reconnect resumes guide')
  check(true, 'stale host updates pause guide audio and reconnect restores sync')
  await reloadPage(phone)
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
  await cdp('Page.bringToFront', {}, host)
  await evaluate(host, `window.__pairStage = document.querySelector('.singing-guide.is-compact'); window.__pairStage.querySelector('.guide-icon-button').click()`)
  await poll(() => evaluate(host, `document.fullscreenElement === window.__pairStage && document.fullscreenElement.querySelector('.stage-pairing canvas')?.width === 224`), 'fullscreen before ending session')
  await evaluate(host, `${store('karaokeGuide')}.stop()`)
  await poll(() => evaluate(phone, `document.querySelector('audio').paused && document.body?.innerText.includes('Pairing has ended')`), 'ending pairing')
  check(true, 'ending pairing stops guide audio and invalidates the link')
  check(await evaluate(host, `document.fullscreenElement === window.__pairStage && !document.fullscreenElement.querySelector('.stage-pairing canvas') && !!document.fullscreenElement.querySelector('.stage-pair-button')`), 'ending pairing removes its old fullscreen QR and offers a fresh pairing')
  // A fresh session checks browser Back warnings and returning without rescanning.
  await evaluate(host, `document.fullscreenElement.querySelector('.stage-pair-button').click()`)
  await poll(() => evaluate(host, `!!${store('karaokeGuide')}.pairUrl && document.fullscreenElement?.querySelector('.stage-pairing canvas')?.width === 224`), 'start pairing inside fullscreen')
  check(await evaluate(host, `document.fullscreenElement === window.__pairStage`), 'host can start pairing and display a new QR without leaving fullscreen')
  const newLink = await evaluate(host, `${store('karaokeGuide')}.pairUrl`)
  const leavingPhone = await page(origin, '/library')
  await evaluate(leavingPhone, `document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(new URL(newLink).pathname + new URL(newLink).hash)})`)
  await poll(() => evaluate(leavingPhone, `document.body?.innerText.includes('Paired · tap Start vocal guide')`), 'returning phone paired')
  check(await evaluate(host, `document.fullscreenElement === window.__pairStage`), 'joining the fullscreen pairing invitation keeps the host fullscreen')
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
  await reloadPage(leavingPhone)
  await poll(() => evaluate(leavingPhone, `!!document.querySelector('.karaoke-pair-return')`), 'saved pairing after away reload')
  await evaluate(leavingPhone, `document.querySelector('.karaoke-pair-return').click()`)
  await poll(() => evaluate(leavingPhone, `document.body?.innerText.includes('Paired · tap Start vocal guide')`), 'resume guide')
  check(await evaluate(leavingPhone, `${store('karaokeDevice')}.grant.token === '${savedToken}' && document.querySelector('.karaoke-vocal-guide audio').paused`), 'confirmed Back stops guide audio; saved pairing returns after reload without another scan')
  await clickText(leavingPhone, 'Start vocal guide')
  await poll(() => evaluate(leavingPhone, `!document.querySelector('.karaoke-vocal-guide audio').paused`), 'resumed guide audio source')
  await evaluate(host, `document.fullscreenElement.querySelector('.guide-icon-button').click()`)
  await poll(() => evaluate(host, `!document.fullscreenElement`), 'exit before host page navigation')
  await evaluate(host, `document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/sing')`)
  await poll(() => evaluate(host, `!!document.querySelector('[data-device-id="${deviceId}"] input[type="checkbox"]')`), 'host device controls')
  await evaluate(host, `document.querySelector('[data-device-id="${deviceId}"] input[type="checkbox"]').click()`)
  await poll(() => evaluate(leavingPhone, `!${store('karaokeDevice')}.device.canControl && document.querySelector('[data-command="pause"]').disabled`), 'host disables remote controls')
  check(await evaluate(leavingPhone, `!document.querySelector('.karaoke-vocal-guide audio').paused && [...document.querySelectorAll('[data-remote-mode]')].every(button => button.disabled)`), 'host can disable playback and audio mode controls while allowing vocal-guide listening')
  await evaluate(host, `document.querySelector('[data-device-id="${deviceId}"] input[type="checkbox"]').click()`)
  await poll(() => evaluate(leavingPhone, `${store('karaokeDevice')}.canControl`), 'host restores remote controls')
  const otherPhone = await page(origin, new URL(newLink).pathname + new URL(newLink).hash)
  await poll(() => evaluate(otherPhone, `!!${store('karaokeDevice')}.device`), 'second independent device')
  await cdp('Page.bringToFront', {}, host)
  await evaluate(host, `window.__rotationStage = document.querySelector('.karaoke-view .singing-guide'); window.__rotationStage.querySelector('.guide-icon-button').click()`)
  await poll(() => evaluate(host, `document.fullscreenElement === window.__rotationStage && document.fullscreenElement.querySelector('.stage-pairing canvas')?.width === 224`), 'fullscreen before invitation rotation')
  const oldQr = await evaluate(host, `document.fullscreenElement.querySelector('.stage-pairing canvas').toDataURL()`)
  await evaluate(host, `document.querySelector('[data-device-id="${deviceId}"] button').click()`)
  await poll(() => evaluate(leavingPhone, `document.body?.innerText.includes('The host removed this device') && !${store('karaokeDevice')}.grant && document.querySelector('.karaoke-vocal-guide audio').paused`), 'host removes device')
  check(await evaluate(otherPhone, `!!${store('karaokeDevice')}.grant && ${store('karaokeDevice')}.hostOnline`), 'host removal clears only the selected phone; another paired device stays connected')
  check(await evaluate(host, `${store('karaokeGuide')}.pairUrl !== ${JSON.stringify(newLink)}`), 'removing a device refreshes the QR invitation')
  await poll(() => evaluate(host, `(() => {
    const canvas = document.fullscreenElement?.querySelector('.stage-pairing canvas');
    return canvas?.getContext('2d').getImageData(0, 0, 1, 1).data[3] === 255 && canvas.toDataURL() !== ${JSON.stringify(oldQr)}
      && canvas.toDataURL() === document.querySelector('#vocal-guide-pairing-title').closest('section').querySelector('canvas').toDataURL();
  })()`), 'rotated fullscreen QR')
  check(await evaluate(host, `document.fullscreenElement === window.__rotationStage`), 'fullscreen QR updates to the rotated invitation without leaving fullscreen')
  // A larger host catalog checks remote browsing independently of search and playback.
  await evaluate(host, `${store('songs')}.songs.push(...Array.from({ length: 30 }, (_, index) => ({ id: index + 4, title: 'Browse song ' + (index + 4), filename: 'link.' + (index + 4) + '.mp3', duration: 90, isFavorite: false })))`)
  await poll(() => evaluate(host, `!${store('karaokeGuide')}.catalogBusy`), 'expanded catalog upload idle')
  await poll(async () => {
    await evaluate(otherPhone, `document.querySelector('[data-action="refresh-catalog"]').click()`)
    return await evaluate(otherPhone, `${store('karaokeDevice')}.browseCatalog?.total === 33`)
  }, 'expanded paired catalog')
  await poll(() => evaluate(otherPhone, `!${store('karaokeDevice')}.browsing && document.querySelectorAll('[data-song-browser] [data-song-id]').length === 25`), 'first browse page')
  await evaluate(otherPhone, `document.querySelector('[data-browse-pagination] [data-action="next-page"]').click()`)
  await poll(() => evaluate(otherPhone, `${store('karaokeDevice')}.browseCatalog.page === 2 && document.querySelectorAll('[data-song-browser] [data-song-id]').length === 8`), 'second browse page')
  await evaluate(otherPhone, `(() => { const input = document.querySelector('input[type="search"]'); input.value = 'First'; input.dispatchEvent(new Event('input', { bubbles: true })); input.form.requestSubmit(); })()`)
  await poll(() => evaluate(otherPhone, `document.querySelectorAll('[data-song-search-results] [data-song-id]').length === 1 && !!document.querySelector('[data-song-search-results] [data-song-id="1"]')`), 'search while browsing page two')
  check(await evaluate(otherPhone, `${store('karaokeDevice')}.browseCatalog.page === 2 && !!document.querySelector('[data-song-browser] [data-song-id="32"]') && ${store('songs')}.songs.length === 0`), 'paired song browsing paginates and retains its page while searching without loading the normal library')
  await poll(() => evaluate(otherPhone, `${store('karaokeDevice')}.canControl`), 'browse request ready')
  await evaluate(otherPhone, `document.querySelector('[data-song-browser] [data-song-id="32"] [data-action="enqueue"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.requestedQueue.some(song => song.id === 32)`), 'enqueue from browsed page')
  check(await evaluate(host, `document.fullscreenElement === window.__rotationStage && document.fullscreenElement.querySelector('[data-queued-song-id="32"] .stage-queue-song-id').textContent.includes('32')`), 'adding a browsed song updates the host fullscreen queue with its song ID')
  await poll(() => evaluate(otherPhone, `${store('karaokeDevice')}.canControl`), 'browse Sing now ready')
  await evaluate(otherPhone, `document.querySelector('[data-song-browser] [data-song-id="33"] [data-action="singNow"]').click()`)
  await poll(() => evaluate(host, `${store('player')}.currentSong.id === 33 && document.fullscreenElement?.querySelector('.guide-song-id').textContent.includes('33')`), 'Sing now from browsed page')
  check(await evaluate(host, `document.fullscreenElement === window.__rotationStage && window.__visualizerSources.length === 1`), 'Sing now from the browsable list keeps host fullscreen and its audio graph')
  await evaluate(otherPhone, `document.querySelector('[data-browse-pagination] [data-action="previous-page"]').click()`)
  await poll(() => evaluate(otherPhone, `${store('karaokeDevice')}.browseCatalog.page === 1`), 'previous browse page')
  check(await evaluate(otherPhone, `document.querySelector('.karaoke-vocal-guide').scrollWidth <= document.querySelector('.karaoke-vocal-guide').clientWidth`), '320px song browsing, search and queue fit without horizontal overflow')
  await cdp('Page.bringToFront', {}, host)
  await evaluate(host, `document.fullscreenElement.querySelector('[data-action="toggle-stage-songs"]').click()`)
  await poll(() => evaluate(host, `document.querySelectorAll('#karaoke-stage-songs [data-song-id]').length === 25`), 'fullscreen browser bounds its first page')
  await evaluate(host, `document.querySelector('#karaoke-stage-songs [data-action="next-page"]').click()`)
  await poll(() => evaluate(host, `document.querySelectorAll('#karaoke-stage-songs [data-song-id]').length === 8 && !!document.querySelector('#karaoke-stage-songs [data-song-id="33"]')`), 'fullscreen browse page two')
  check(await toolbarVisible(), 'fullscreen browsing paginates the karaoke catalog while playback controls remain visible')
  await evaluate(host, `(() => { const input = document.querySelector('#karaoke-stage-songs input'); input.value = '33'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await poll(() => evaluate(host, `document.querySelectorAll('#karaoke-stage-songs [data-song-id]').length === 1 && !!document.querySelector('#karaoke-stage-songs [data-song-id="33"]')`), 'fullscreen song ID search from page two')
  check(true, 'searching by song ID resets fullscreen pagination and finds songs from other pages')
  await evaluate(host, `${store('songs')}.songs.push({ id: 99, title: 'Unavailable fixture song', filename: 'link.99.mp3', isFavorite: false }); ${store('songs')}.songs.find(song => song.id === 33).title = '傳統歌曲';
    (() => { const input = document.querySelector('#karaoke-stage-songs input'); input.value = '传统'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await poll(() => evaluate(host, `document.querySelectorAll('#karaoke-stage-songs [data-song-id]').length === 1 && !!document.querySelector('#karaoke-stage-songs [data-song-id="33"]')`), 'fullscreen variant-aware Chinese search')
  check(true, 'fullscreen search matches simplified and traditional Chinese song titles')
  await evaluate(host, `(() => { const input = document.querySelector('#karaoke-stage-songs input'); input.value = '99'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await poll(() => evaluate(host, `!document.querySelector('#karaoke-stage-songs [data-song-id]') && !!document.querySelector('#karaoke-stage-songs .picker-empty')`), 'fullscreen excludes songs without instrumentals')
  check(true, 'fullscreen song browser only offers songs with karaoke instrumentals')
  await evaluate(host, `document.querySelector('#karaoke-stage-songs [data-action="close-songs"]').click()`)
  const freshHost = await page(origin, '/sing', 1100)
  await poll(() => evaluate(freshHost, `!!${store('player')}.currentSong && ${store('player')}.audioElement?.readyState >= 3 && !!document.querySelector('.karaoke-view .singing-guide')`), 'fresh fullscreen host')
  await evaluate(freshHost, `${store('ui')}.showVisualizer = false; ${store('player')}.play()`)
  check(await evaluate(freshHost, `window.__visualizerSources.length === 0`), 'fresh host has no visualizer audio source before fullscreen')
  await cdp('Page.bringToFront', {}, freshHost)
  await evaluate(freshHost, `document.querySelector('.karaoke-view .singing-guide .guide-icon-button').click()`)
  await poll(() => evaluate(freshHost, `!!document.fullscreenElement?.querySelector('.music-visualizer') && window.__visualizerSources.length === 1`), 'fullscreen creates initial audio analyser')
  await poll(() => evaluate(freshHost, `(() => { const node = window.__visualizerAnalysers[0], values = new Uint8Array(node.frequencyBinCount); node.getByteFrequencyData(values); return values.some(value => value > 0); })()`), 'fresh fullscreen live signal')
  check(true, 'fullscreen starts rainbow-bar visualization with live audio when the regular visualizer was never opened')
  await evaluate(freshHost, `document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/library')`)
  await poll(() => evaluate(freshHost, `!document.fullscreenElement && !${store('ui')}.fullscreenStage`), 'unmount fullscreen stage clears visualizer destination')
  await evaluate(freshHost, `${store('ui')}.showVisualizer = true`)
  await poll(() => evaluate(freshHost, `document.querySelector('.music-visualizer')?.dataset.embedded === 'false'`), 'visualizer returns to regular page after stage removal')
  check(await evaluate(freshHost, `window.__visualizerSources.length === 1 && window.__visualizerSources[0].context.state === 'running'`), 'removing a fullscreen stage returns the visualizer to the app without recreating or closing its audio source')
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
