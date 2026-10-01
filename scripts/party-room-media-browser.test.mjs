// Full built-app room/capture journey with actual gated SFU transport and a fake
// microphone tone. Owned fixtures only; this is not physical or internet evidence.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import net from 'node:net'
import { once } from 'node:events'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes, randomUUID } from 'node:crypto'
import express from '../server/node_modules/express/index.js'
import WebSocket from '../server/node_modules/ws/wrapper.mjs'
import { RoomServiceClient } from '../server/node_modules/livekit-server-sdk/dist/index.js'
import { initDb } from '../server/db.js'
import { registerKtvRoutes } from '../server/ktv-routes.js'
import { createKtvAssets } from '../server/ktv-assets.js'
import { createKtvMediaWorker } from '../server/ktv-media-worker.js'

const exec = promisify(execFile), root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-room-stream-'))
const container = `ktv-room-stream-${randomUUID().slice(0, 8)}`
const apiKey = 'room-browser', apiSecret = randomBytes(32).toString('hex'), controlSecret = randomBytes(32).toString('hex')
const upstreamUrl = 'http://127.0.0.1:17900', image = 'livekit/livekit-server:v1.13.7@sha256:6fd3b7088874c4d119160dd688798dfec852bc014786d392caad15f6f63912a3'
const provider = new RoomServiceClient(upstreamUrl, apiKey, apiSecret, { requestTimeout: 2, failover: false })
const db = initDb(root), contexts = [], debuggerSockets = [], pending = new Map(), sessionSockets = new Map(), errors = []
const ownedTcp = new Set()
const trackTcp = server => server.on('connection', socket => { ownedTcp.add(socket); socket.once('close', () => ownedTcp.delete(socket)) })
let frontend, backend, worker, realtime, chrome, pulseModule, pathRoom, running = false, nextId = 0, passed = 0
const check = (value, label) => { assert.ok(value, label); passed++; console.log(`PASS ${label}`) }
const poll = async (work, label, timeout = 20000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try { const value = await work(); if (value) return value } catch (error) {
      if (!/Execution context was destroyed|Cannot find context with specified id|Inspected target navigated/.test(error.message)) throw error
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${label}`)
}
function cdp(socket, method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value) }, reject(error) { clearTimeout(timer); reject(error) } })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}
async function debuggerConnection(url) {
  const info = await (await fetch(url + '/json/version')).json(), socket = new WebSocket(info.webSocketDebuggerUrl)
  debuggerSockets.push(socket); await once(socket, 'open')
  socket.on('message', raw => {
    const packet = JSON.parse(raw)
    if (packet.id) { const item = pending.get(packet.id); if (!item) return; pending.delete(packet.id); packet.error ? item.reject(new Error(packet.error.message)) : item.resolve(packet.result) }
    else if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails.exception?.description || packet.params.exceptionDetails.text)
  })
  console.log(`Browser: ${info.Browser}`); return socket
}
async function evaluate(session, expression) {
  const result = await cdp(sessionSockets.get(session), 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, session)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function click(session, label) {
  await poll(() => evaluate(session, `(() => { const item = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(label)} && !item.disabled && item.getClientRects().length); if (!item) return false; item.click(); return true })()`), `button ${label}`)
}
function wav(frequency, seconds = 60) {
  const rate = 44100, size = rate * seconds * 2, bytes = Buffer.alloc(44 + size)
  bytes.write('RIFF'); bytes.writeUInt32LE(36 + size, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(size, 40)
  for (let index = 0; index < rate * seconds; index++) bytes.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * frequency / rate) * 3000), 44 + index * 2)
  return bytes
}
try {
  for (const folder of ['data', 'karaoke', 'synced', 'lyrics', 'import']) await fs.mkdir(path.join(root, folder))
  // Keep the guide distinct from microphone/backing harmonics after encoding.
  await fs.writeFile(path.join(root, 'data/link.1.mp3'), wav(1729))
  await fs.writeFile(path.join(root, 'karaoke/link.1.instrumental.mp3'), wav(440))
  await fs.writeFile(path.join(root, 'synced/link.1.lrc'), '[00:00]Singing together\n[00:10]Second lyric\n[00:25]Third lyric\n[00:50]Final lyric')
  const micFile = path.join(root, 'microphone.wav'); await fs.writeFile(micFile, wav(880))
  const config = path.join(root, 'livekit.yaml')
  await fs.writeFile(config, `port: 17900\nbind_addresses: [127.0.0.1]\nrtc:\n  node_ip: 127.0.0.1\n  use_external_ip: false\n  tcp_port: 17901\n  udp_port: 17902\n  enable_loopback_candidate: true\n  interfaces:\n    includes: [lo]\nroom:\n  max_participants: 6\nkeys:\n  ${apiKey}: ${apiSecret}\nlogging:\n  level: warn\n`, { mode: 0o600 })
  await exec('docker', ['run', '-d', '--name', container, '--network', 'host', '--user', `${process.getuid()}:${process.getgid()}`,
    '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '-v', `${config}:/run/livekit.yaml:ro`, image, '--config', '/run/livekit.yaml'])
  running = true
  await poll(async () => { try { return (await fetch(upstreamUrl)).ok } catch { return false } }, 'owned SFU starts')
  for (let id = 1; id <= 3; id++) db.prepare("INSERT INTO users (username, kind, created_at) VALUES (?, 'guest', ?)").run(`stream-user-${id}`, new Date().toISOString())
  const app = express(); app.use(express.json())
  const auth = (req, res, next) => { const id = Number(req.headers.authorization?.replace('Bearer ', '')); if (![1, 2, 3].includes(id)) return res.sendStatus(401); req.auth = { sub: id }; next() }
  const user = id => ({ id, username: `stream-user-${id}`, name: `Person ${id}`, kind: 'guest', role: 'user' })
  app.get('/api/auth/me', auth, (req, res) => res.json({ success: true, data: user(req.auth.sub) }))
  app.post('/api/auth/guest', (req, res) => res.json({ success: true, data: { token: '1', user: user(1) } }))
  app.get('/api/dig/songs', (req, res) => res.json({ success: true, data: [] }))
  app.get('/api/categories', (req, res) => res.json({ success: true, data: { categories: [], assignments: [], lockedSongIds: [] } }))
  backend = app.listen(0, '127.0.0.1'); await once(backend, 'listening')
  trackTcp(backend)
  const backendUrl = `http://127.0.0.1:${backend.address().port}`
  frontend = http.createServer((req, res) => {
    const media = ['/api/ktv/media/rtc', '/api/ktv/media/rtc/v1', '/api/ktv/media/rtc/validate'].includes(new URL(req.url, 'http://proxy.local').pathname)
    const target = media ? worker.server.address().port : backend.address().port
    const request = http.request({ host: '127.0.0.1', port: target, path: req.url, method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res) })
    request.on('error', () => { res.writeHead(502); res.end() }); req.pipe(request)
  })
  frontend.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://proxy.local').pathname
    const media = ['/api/ktv/media/rtc', '/api/ktv/media/rtc/v1'].includes(pathname)
    if (!media && pathname !== '/api/ktv/ws') { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return }
    const upstream = net.connect({ host: '127.0.0.1', port: media ? worker.server.address().port : backend.address().port })
    upstream.once('connect', () => {
      const headers = req.rawHeaders.reduce((lines, value, index, items) => index % 2 === 0 ? lines + `${value}: ${items[index + 1]}\r\n` : lines, '')
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n`); if (head.length) upstream.write(head)
      socket.pipe(upstream); upstream.pipe(socket)
    })
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy())
  })
  frontend.listen(0, '127.0.0.1'); await once(frontend, 'listening')
  trackTcp(frontend)
  const origin = `http://127.0.0.1:${frontend.address().port}`
  worker = createKtvMediaWorker({ backendUrl, upstreamUrl, apiKey, apiSecret, controlSecret, origins: [origin],
    stopSfu: async () => { await exec('docker', ['kill', container]).catch(() => {}) } })
  worker.server.listen(0, '127.0.0.1'); await once(worker.server, 'listening')
  trackTcp(worker.server)
  realtime = registerKtvRoutes(app, { db, authMiddleware: auth, secret: 'isolated-streaming-room-secret', isKaraokeSong: id => id === 1,
    allowedOrigins: [origin], media: { apiKey, apiSecret, controlSecret, workerUrl: `http://127.0.0.1:${worker.server.address().port}` },
    resolveAssets: createKtvAssets({ musicRoot: path.join(root, 'data'), karaokeRoot: path.join(root, 'karaoke'), importRoot: path.join(root, 'import'), syncedRoot: path.join(root, 'synced'), lyricsRoot: path.join(root, 'lyrics') }) })
  realtime.attach(backend)
  app.get('/data/metadata.json', (req, res) => res.json({ '1': { title: 'Live stream test', duration: 60 } }))
  app.get('/karaoke/karaoke_manifest.json', (req, res) => res.json({ version: 1, ids: [1] }))
  app.use('/data', express.static(path.join(root, 'data'))); app.use('/karaoke', express.static(path.join(root, 'karaoke')))
  app.use(express.static(path.resolve('dist'))); app.get('*', (req, res) => res.sendFile(path.resolve('dist/index.html')))
  await worker.reconcile(); check(worker.ready, 'actual room-policy worker is ready')
  async function api(actor, route, body) {
    const response = await fetch(origin + '/api/ktv' + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const result = await response.json(); assert.ok(response.ok, `${route}: ${result.code || response.status}`); return result.data
  }
  const room = await api(1, '/rooms', { commandId: randomUUID(), name: 'Integrated online room', displayName: 'Host', approvalRequired: false })
  pathRoom = `/rooms/${room.room.id}`
  const singer = await api(2, '/join', { commandId: randomUUID(), code: room.invitationCode, displayName: 'Singer' })
  const nextSinger = await api(3, '/join', { commandId: randomUUID(), code: room.invitationCode, displayName: 'Next singer' })
  const singerDebugPort = Number(process.env.CHROME_MEDIA_TEST_PORT || 9240)
  const chromeEnv = { ...process.env }
  if (process.env.PARTY_TEST_PULSE_SINK === '1') {
    // An owned virtual output isolates the fixture from this host's shared sink.
    // Browser audio clocks and all application drift guards remain native.
    const sink = `ktv_${randomUUID().replaceAll('-', '')}`
    pulseModule = (await exec('pactl', ['load-module', 'module-null-sink', `sink_name=${sink}`, 'rate=44100'])).stdout.trim()
    chromeEnv.PULSE_SINK = sink
  }
  chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', '--no-default-browser-check', '--no-proxy-server',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${micFile}`,
    `--remote-debugging-port=${singerDebugPort}`, `--user-data-dir=${path.join(root, 'chrome')}`, 'about:blank'], { stdio: 'ignore', env: chromeEnv })
  await poll(async () => { try { return (await fetch(`http://127.0.0.1:${singerDebugPort}/json/version`)).ok } catch { return false } }, 'owned fake-mic Chrome')
  const singerSocket = await debuggerConnection(`http://127.0.0.1:${singerDebugPort}`)
  const audienceSocket = await debuggerConnection(process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9231')
  async function page(actor, stage = false) {
    const socket = actor === 2 || actor === 3 ? singerSocket : audienceSocket
    const { browserContextId } = await cdp(socket, 'Target.createBrowserContext'); contexts.push({ socket, browserContextId })
    await cdp(socket, 'Browser.grantPermissions', { browserContextId, origin, permissions: ['audioCapture'] })
    const { targetId } = await cdp(socket, 'Target.createTarget', { browserContextId, url: 'about:blank' })
    const { sessionId } = await cdp(socket, 'Target.attachToTarget', { targetId, flatten: true }); sessionSockets.set(sessionId, socket)
    await cdp(socket, 'Page.enable', {}, sessionId); await cdp(socket, 'Runtime.enable', {}, sessionId)
    await cdp(socket, 'Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('auth_token', '${actor}'); localStorage.setItem('language', 'en');
      window.__micStreams = []; window.__bufferSources = []; window.__sourceEvidence = []; window.__outputEvidence = []; window.__peers = []; window.__contexts = [];
      const Context = window.AudioContext; window.AudioContext = class extends Context { constructor(...args) { super(...args); window.__contexts.push(this); } };
      const Peer = window.RTCPeerConnection; window.RTCPeerConnection = class extends Peer { constructor(...args) { super(...args); window.__peers.push(this); } };
      const timestamp = AudioContext.prototype.getOutputTimestamp;
      AudioContext.prototype.getOutputTimestamp = function() { const output = timestamp.call(this); window.__outputEvidence.push({ ...output, now: performance.now(), render: this.currentTime, latency: this.outputLatency }); if (__outputEvidence.length > 24) __outputEvidence.shift(); return output; };
      const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await getMedia(...args); window.__micStreams.push(stream); return stream; };
      const source = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function() { const item = source.call(this), start = item.start.bind(item); item.start = (...args) => { window.__sourceEvidence.push({when:args[0],offset:args[1],now:performance.now(),render:this.currentTime,output:this.getOutputTimestamp()}); return start(...args); }; window.__bufferSources.push(item); return item; };
      window.confirm = () => true;` }, sessionId)
    await cdp(socket, 'Page.navigate', { url: origin + `/party/${room.room.id}${stage ? '/stage' : ''}` }, sessionId)
    await poll(() => evaluate(sessionId, "document.body?.innerText.includes('Live room updates connected')"), 'room page connected')
    if (!stage) await evaluate(sessionId, "document.getElementById('party-tab-sing').click()")
    return sessionId
  }
  const host = await page(1), phone = await page(2), audience = await page(1, true)
  await poll(() => evaluate(host, "[...document.querySelectorAll('select')].some(item => [...item.options].some(option => option.value === 'online') && !item.disabled)"), 'host mode selector ready')
  await evaluate(host, "(() => { const item = [...document.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === 'online')); item.value = 'online'; item.dispatchEvent(new Event('change', {bubbles:true})); })()")
  await poll(async () => (await api(1, pathRoom)).room.performanceMode === 'online', 'room switches online')
  check(await evaluate(audience, "![...document.querySelectorAll('button')].some(item => item.textContent.trim() === 'Enable stage audio')"), 'online common screen cannot independently enable backing')
  check(await evaluate(phone, "![...document.querySelectorAll('select')].some(item => [...item.options].some(option => option.value === 'online'))"), 'ordinary singer has no room-mode admin selector')
  const request = await api(2, `${pathRoom}/queue`, { commandId: randomUUID(), songId: 1, title: 'Live stream test', requestNext: false, singerMemberId: singer.self.id })
  let view = await api(1, pathRoom)
  view = await api(1, `${pathRoom}/readiness/offer`, { commandId: randomUUID(), entryId: request.queue[0].id, clockId: view.clock.clockId, baseRevision: view.room.revision })
  await api(2, `${pathRoom}/readiness/respond`, { commandId: randomUUID(), clockId: view.readiness.clockId, performanceId: view.readiness.performanceId, generation: view.readiness.generation, baseRevision: view.room.revision, ready: true })
  await poll(() => evaluate(phone, "[...document.querySelectorAll('label')].some(item => item.textContent.includes('I am using headphones'))"), 'performer capture form')
  await evaluate(phone, "[...document.querySelectorAll('label')].find(item => item.textContent.includes('I am using headphones')).querySelector('input').click()")
  await click(phone, 'Enable microphone and prepare')
  await poll(() => evaluate(phone, "document.querySelector('[data-party-media-status]')?.textContent.includes('Microphone ready')"), 'microphone ready')
  check(await evaluate(phone, "window.__micStreams.length === 1 && window.__micStreams[0].getAudioTracks()[0].readyState === 'live'"), 'built app acquires exactly one requested microphone stream')
  // Readiness comes from the application's real output-clock startup check.
  let device = await poll(async () => (await api(1, pathRoom)).presence.devices.find(item => item.memberId === singer.self.id && item.purpose === 'stage' && item.audioEnabled && item.clockHealthy), 'performing device status')
  await click(host, 'Stage · Singer')
  await click(host, 'Prepare selected song')
  await poll(async () => { const current = await api(1, pathRoom); return current.presence.devices.some(item => item.id === device.id && item.ready && item.readyGeneration === current.playback.generation) }, 'decoded performer backing ready')
  await click(audience, 'Watch and listen')
  await click(host, 'Start countdown')
  await poll(() => evaluate(phone, "document.querySelector('[data-party-media-status]')?.textContent.includes('Sending live singing')"), 'publisher ready through provider acknowledgment')
  await poll(() => evaluate(audience, "(() => { const video = document.querySelector('[data-party-media-screen] video'); return video?.srcObject?.getAudioTracks().length === 1 && video.srcObject.getVideoTracks().length === 1; })()"), 'audience receives both performance tracks')
  await poll(async () => (await api(1, pathRoom)).playback.state === 'playing', 'room plays after ready countdown')
  const firstPublisher = db.prepare("SELECT * FROM ktv_media_grants WHERE scope = 'publisher' AND state = 'active'").get()
  check(Boolean(firstPublisher.ready_at), 'provider-confirmed audio/video readiness is persisted for the exact publisher')
  const participants = await provider.listParticipants(`ktv-${room.room.id}`)
  check(participants.filter(item => item.identity === firstPublisher.identity).length === 1 && participants.find(item => item.identity === firstPublisher.identity).tracks.length === 2, 'actual SFU has one publisher with one mix and one lyric video')
  await evaluate(audience, `(() => { const element = document.querySelector('[data-party-media-screen] video'); window.__receiveContext = new AudioContext(); __receiveContext.resume();
    const source = __receiveContext.createMediaStreamSource(element.srcObject); window.__analyser = __receiveContext.createAnalyser(); __analyser.fftSize = 8192; __analyser.smoothingTimeConstant = 0;
    const silent = __receiveContext.createGain(); silent.gain.value = 0; source.connect(__analyser); __analyser.connect(silent); silent.connect(__receiveContext.destination); })()`)
  const spectrum = () => evaluate(audience, `(() => { const values = new Float32Array(__analyser.frequencyBinCount); __analyser.getFloatFrequencyData(values);
    return [440,880,1729].map(frequency => { const center = Math.round(frequency * __analyser.fftSize / __receiveContext.sampleRate); const value = Math.max(...values.slice(center-2,center+3)); return Number.isFinite(value) ? value : -120; }); })()`)
  let peaks = await poll(async () => { const value = await spectrum(); return value[0] > -55 && value[1] > -55 ? value : false }, 'received backing and microphone tones')
  check(peaks[2] < Math.min(peaks[0], peaks[1]) - 25, `audience mix contains backing and live microphone without original-vocal tone (${peaks.map(value => value.toFixed(1)).join(', ')} dB)`)
  await poll(() => evaluate(audience, "document.querySelector('[data-party-media-screen] video')?.videoWidth > 0"), 'first captured lyric video decoded')
  check(await evaluate(audience, "(() => { const video = document.querySelector('[data-party-media-screen] video'); return video.videoWidth > 0 && Math.abs(video.videoWidth / video.videoHeight - 16/9) < .02; })()"), 'audience displays decoded captured lyric video')
  await click(phone, 'Listen to original vocals privately')
  await poll(() => evaluate(phone, "document.body.innerText.includes('Turn off private original vocals')"), 'private original enabled')
  await poll(() => evaluate(phone, 'window.__bufferSources.length >= 2'), 'private original source actually scheduled')
  peaks = await poll(async () => { const value = await spectrum(); return value[0] > -55 && value[1] > -55 ? value : false }, 'private guide keeps public backing intact')
  check(peaks[2] < Math.min(peaks[0], peaks[1]) - 25, `enabling the original guide in the built app keeps it outside the public mix (${peaks.map(value => value.toFixed(1)).join(', ')} dB)`)
  check(await evaluate(audience, 'window.__bufferSources.length === 0'), 'remote common screen creates no independent instrumental player')
  await click(phone, 'Stop streaming on this device')
  check(await evaluate(phone, "window.__micStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))"), 'stop releases the actual microphone immediately')
  await poll(async () => !(await provider.listParticipants(`ktv-${room.room.id}`)).some(item => item.identity === firstPublisher.identity), 'old publisher removed at SFU')
  check(db.prepare('SELECT state FROM ktv_media_grants WHERE identity = ?').get(firstPublisher.identity).state === 'revoked', 'provider removal commits terminal nonce revocation')
  check((await api(1, pathRoom)).playback.state === 'recovering', 'losing the publisher enters explicit room recovery')
  await click(host, 'Skip song')
  const nextRequest = await api(3, `${pathRoom}/queue`, { commandId: randomUUID(), songId: 1, title: 'Second live performer', requestNext: false, singerMemberId: nextSinger.self.id })
  view = await api(1, pathRoom)
  if (view.readiness.state === 'idle') view = await api(1, `${pathRoom}/readiness/offer`, { commandId: randomUUID(), entryId: nextRequest.queue[0].id, clockId: view.clock.clockId, baseRevision: view.room.revision })
  await api(3, `${pathRoom}/readiness/respond`, { commandId: randomUUID(), clockId: view.readiness.clockId, performanceId: view.readiness.performanceId, generation: view.readiness.generation, baseRevision: view.room.revision, ready: true })
  const nextPhone = await page(3)
  await poll(() => evaluate(nextPhone, "[...document.querySelectorAll('label')].some(item => item.textContent.includes('I am using headphones'))"), 'next performer capture form')
  await evaluate(nextPhone, "[...document.querySelectorAll('label')].find(item => item.textContent.includes('I am using headphones')).querySelector('input').click()")
  await click(nextPhone, 'Enable microphone and prepare')
  await poll(() => evaluate(nextPhone, "document.querySelector('[data-party-media-status]')?.textContent.includes('Microphone ready')"), 'next microphone ready')
  await click(host, 'Stage · Next singer'); await click(host, 'Prepare selected song')
  await click(host, 'Start countdown')
  await poll(() => evaluate(nextPhone, "document.querySelector('[data-party-media-status]')?.textContent.includes('Sending live singing')"), 'replacement publisher ready')
  const secondPublisher = db.prepare("SELECT * FROM ktv_media_grants WHERE scope = 'publisher' AND state = 'active'").get()
  check(secondPublisher.identity !== firstPublisher.identity && secondPublisher.member_id === nextSinger.self.id, 'a new singer gets a fresh nonce after old-provider acknowledgment')
  check(db.prepare("SELECT COUNT(*) total FROM ktv_media_grants WHERE scope = 'publisher' AND state != 'revoked'").get().total === 1, 'handover keeps one non-revoked publisher')
  await poll(() => evaluate(audience, "(() => { const video = document.querySelector('[data-party-media-screen] video'); return video?.srcObject?.getAudioTracks().length === 1 && video.srcObject.getVideoTracks().length === 1; })()"), 'audience receives replacement tracks')
  await click(nextPhone, 'Stop streaming on this device')
  check(await evaluate(nextPhone, "window.__micStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))"), 'replacement capture also releases its microphone')
  check(errors.length === 0, `no browser runtime exceptions (${errors.length})`)
  console.log(`${passed} built-app streaming checks passed. Synthetic microphone, foreground Chrome, loopback SFU only.`)
} catch (error) {
  console.error('Journey failure:', error.message)
  console.error('Runtime exception count:', errors.length)
  for (const session of sessionSockets.keys()) console.error('UI state:', JSON.stringify(await evaluate(session, ` (async () => ({status:document.querySelector('[data-party-media-status]')?.textContent,
    errors:[...document.querySelectorAll('[role=alert]')].map(item=>item.textContent), diagnostics:[...document.querySelectorAll('dl')].map(item=>item.textContent),
    output:window.__outputEvidence, sources:window.__sourceEvidence, canvas:[...document.querySelectorAll('canvas')].map(item=>({width:item.width,height:item.height,connected:item.isConnected})),
    video:[...document.querySelectorAll('video')].map(item=>({width:item.videoWidth,height:item.videoHeight,ready:item.readyState,paused:item.paused,muted:item.muted,tracks:item.srcObject?.getTracks().map(track=>({kind:track.kind,state:track.readyState,muted:track.muted,settings:track.getSettings()}))})),
    rtc:await Promise.all(window.__peers.map(async peer=>({state:peer.connectionState,tracks:[...await peer.getStats()].map(([,item])=>item).filter(item=>['inbound-rtp','outbound-rtp'].includes(item.type)).map(item=>({kind:item.kind,type:item.type,bytes:item.bytesSent??item.bytesReceived,frames:item.framesEncoded??item.framesDecoded,framesReceived:item.framesReceived,framesDropped:item.framesDropped}))})))
  }))()` ).catch(() => ({}))))
  throw error
} finally {
  for (const { socket, browserContextId } of contexts) if (socket.readyState === WebSocket.OPEN) await cdp(socket, 'Target.disposeBrowserContext', { browserContextId }).catch(() => {})
  for (const socket of debuggerSockets) socket.close()
  for (const child of [chrome]) if (child && child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit'); child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 1000)
    try { await ended.catch(() => {}) } finally { clearTimeout(timer) }
  }
  if (worker) await worker.close().catch(() => {})
  realtime?.close()
  for (const socket of ownedTcp) socket.destroy()
  for (const server of [frontend, backend]) if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  if (running) await exec('docker', ['rm', '-f', container]).catch(() => {})
  if (pulseModule) await exec('pactl', ['unload-module', pulseModule]).catch(() => {})
  db.close(); await fs.rm(root, { recursive: true, force: true })
}
