// Full built-app room/capture journey with actual gated SFU transport and a fake
// microphone tone. Owned fixtures only; this is not physical audio evidence.
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
import { createMediaTcpProxy } from './party-media-tcp-proxy.mjs'
import { createMediaUdpProxy } from './party-media-udp-proxy.mjs'
import { createOwnedRemoteBrowser } from './party-remote-browser.mjs'
import { runRoomReceiverFault } from './party-room-receiver-fault.mjs'
import { installAbsoluteCaptureExperiment } from './party-absolute-capture-experiment.mjs'
import { probeDecodedTracks } from './party-decoded-track-probe.mjs'
import { RtpCaptureClock, analyseCaptureClocks } from './party-rtp-capture-clock.mjs'
import { CaptureFrameQueue } from './party-capture-frame-queue.mjs'
import { installControlledReceiver, analyseControlledReceiverQuality, hasSingleAudienceOutput } from './party-controlled-receiver.mjs'
import { encodedTimingWorker, installEncodedTimingProbe } from './party-encoded-timing-observer.mjs'
import { installAvSourceMarkers, installAvObserver, analyseAvObservations } from './party-av-observer.mjs'
import { collectAvMediaStats } from './party-av-stats.mjs'
import { analyseCodecQuality } from './party-av-codec-quality.mjs'
import { installEncodedLeaseObserver } from './party-encoded-lease-observer.mjs'
import { installSenderKeyframeExperiment } from './party-sender-keyframes.mjs'
import { keyframeRecoveryStep } from './party-keyframe-recovery.mjs'
import { collectRtcFeedback } from './party-rtc-feedback.mjs'
import { publisherRembSdp, installPublisherRembExperiment } from './party-publisher-feedback.mjs'
import { nativeSyncTargetStep, nativeNetworkTargetStep, nativeRepairTargetStep, installNativeSyncExperiment } from './party-av-native-sync.mjs'

const clientLocation = process.env.KTV_ROOM_TEST_CLIENT || 'same-host'
assert.ok(['same-host', 'remote-ec2'].includes(clientLocation), 'Unknown room-test client topology')
const remoteMode = clientLocation === 'remote-ec2'
const frontendBuild = path.resolve(process.env.KTV_ROOM_TEST_DIST_ROOT || 'dist')
await fs.access(path.join(frontendBuild, 'index.html'))
const legacyBuild = process.env.KTV_ROOM_TEST_LEGACY_DIST_ROOT ? path.resolve(process.env.KTV_ROOM_TEST_LEGACY_DIST_ROOT) : null
let legacyHtml
if (legacyBuild) {
  assert.notEqual(legacyBuild, frontendBuild, 'Legacy compatibility needs a distinct immutable older app build')
  legacyHtml = await fs.readFile(path.join(legacyBuild, 'index.html'), 'utf8')
  assert.ok(legacyHtml.includes('<head>') && /<script[^>]*type="module"[^>]*src="\/assets\//.test(legacyHtml), 'Invalid legacy app entry')
}
let codecExperiment
try { codecExperiment = JSON.parse(await fs.readFile(path.join(frontendBuild, 'ktv-codec-experiment.json'), 'utf8')) }
catch (error) { if (error.code !== 'ENOENT') throw error }
if (codecExperiment) {
  assert.ok(codecExperiment.version===1&&codecExperiment.privateCodecExperiment===true&&
    ['vp8','vp9','h264'].includes(codecExperiment.codec)&&codecExperiment.backupCodec===false&&
    codecExperiment.width===1280&&codecExperiment.height===720&&codecExperiment.fps===25&&codecExperiment.maxBitrate===350000&&
    (codecExperiment.transport==null||['default','dual'].includes(codecExperiment.transport))&&
    (codecExperiment.keyframeMs==null||(Number.isInteger(codecExperiment.keyframeMs)&&codecExperiment.keyframeMs>=250&&codecExperiment.keyframeMs<=5000)),
    'Malformed private codec experiment marker')
  assert.equal(process.env.KTV_ROOM_TEST_AV_TIMING,'1','Codec comparisons require actual native A/V evidence')
  console.log('Private codec comparison:',JSON.stringify(codecExperiment))
}
const avTiming = process.env.KTV_ROOM_TEST_AV_TIMING === '1'
const encodedTiming = process.env.KTV_ROOM_TEST_ENCODED_TIMING === '1'
const absoluteCapture = process.env.KTV_ROOM_TEST_ABSOLUTE_CAPTURE === '1'
assert.ok(!absoluteCapture||encodedTiming,'Absolute capture negotiation requires actual frame timing observation')
const decodedTrackProbe = process.env.KTV_ROOM_TEST_DECODED_TRACKS === '1'
assert.ok(!decodedTrackProbe||absoluteCapture&&!avTiming,
  'Decoded capability observation requires actual capture timestamps and runs separately from A/V timing measurement')
const encodedApi = process.env.KTV_ROOM_TEST_ENCODED_API || 'native'
assert.ok(['native','legacy'].includes(encodedApi)&&(encodedApi==='native'||encodedTiming),
  'A private encoded API comparison requires timing observation')
const receiverFault = process.env.KTV_ROOM_TEST_RECEIVER_FAULT || 'off'
assert.ok(['off','task-stall','suspend-task-stall','source-task-stall'].includes(receiverFault), 'Unknown integrated receiver fault')
assert.ok(receiverFault==='off'||remoteMode&&!avTiming&&!codecExperiment,
  'Integrated output faults require the production build and independent native outputs, without A/V marker experiments')
assert.ok(!encodedTiming||remoteMode&&receiverFault==='off'&&!codecExperiment,
  'Encoded timing observation requires an owned remote production build without output faults or codec comparisons')
const publisherFeedback = process.env.KTV_ROOM_TEST_PUBLISHER_FEEDBACK || 'default'
assert.ok(['default', 'remb'].includes(publisherFeedback) && (publisherFeedback === 'default' || avTiming && codecExperiment),
  'Publisher feedback comparison requires a marked private build and native A/V evidence')
assert.ok(publisherFeedback === 'default' || codecExperiment.transport !== 'dual',
  'Legacy dual-peer publisher feedback must retain its negotiated TWCC estimator')
const senderKeyframeMs = process.env.KTV_ROOM_TEST_SENDER_KEYFRAME_MS === undefined ? null : Number(process.env.KTV_ROOM_TEST_SENDER_KEYFRAME_MS)
const demandKeyframes = process.env.KTV_ROOM_TEST_DEMAND_KEYFRAMES === '1'
assert.ok(!demandKeyframes || avTiming && codecExperiment && codecExperiment.keyframeMs == null && senderKeyframeMs === null,
  'Demand recovery requires a private native comparison without another keyframe policy')
assert.ok(senderKeyframeMs === null || avTiming && codecExperiment && codecExperiment.keyframeMs == null &&
  Number.isInteger(senderKeyframeMs) && senderKeyframeMs >= 250 && senderKeyframeMs <= 5000,
  'Sender keyframes require a private native comparison without the worker keyframe policy')
const sourceStallMs = Number(process.env.KTV_ROOM_TEST_OUTPUT_STALL_MS || 0)
assert.ok(sourceStallMs === 0 || avTiming && remoteMode && Number.isInteger(sourceStallMs) && sourceStallMs >= 20 && sourceStallMs <= 100,
  'Owned native output stall requires remote A/V timing and a bounded 20–100 ms pause')
const receiverTargetMs = process.env.KTV_ROOM_TEST_RECEIVER_TARGET_MS === undefined ? null : Number(process.env.KTV_ROOM_TEST_RECEIVER_TARGET_MS)
const receiverSync = process.env.KTV_ROOM_TEST_RECEIVER_SYNC || 'off'
const controlledPlayoutMs = process.env.KTV_ROOM_TEST_CONTROLLED_PLAYOUT_MS === undefined ? null : Number(process.env.KTV_ROOM_TEST_CONTROLLED_PLAYOUT_MS)
assert.ok(controlledPlayoutMs === null || avTiming && absoluteCapture && receiverSync === 'off' && receiverTargetMs === null &&
  Number.isInteger(controlledPlayoutMs) && controlledPlayoutMs >= 200 && controlledPlayoutMs <= 1000,
  'Controlled receiver playout requires actual capture/A/V evidence without another receiver policy')
assert.ok(['off', 'ntp', 'network', 'repair'].includes(receiverSync) && (receiverSync === 'off' || avTiming && receiverTargetMs === null),
  'Native sync experiment requires A/V timing and no fixed receiver target')
assert.ok(receiverTargetMs === null || avTiming && Number.isInteger(receiverTargetMs) && receiverTargetMs >= 0 && receiverTargetMs <= 1000,
  'Receiver target experiment requires A/V timing and a 0–1000 ms target')
const avTransitions = Number(process.env.KTV_ROOM_TEST_AV_TRANSITIONS || 40)
assert.ok(Number.isInteger(avTransitions)&&avTransitions>=6&&avTransitions<=60, 'A/V transitions must be 6–60')
const fixtureSeconds = avTiming ? Math.max(60, (avTransitions + 6) * 2 + 40) : 60
const avMeasurements = []
const avTimingSamples = []
const playoutHints = process.env.KTV_ROOM_TEST_PLAYOUT_HINTS || 'adaptive'
assert.ok(['adaptive','off'].includes(playoutHints),'Unknown SFU playout hint mode')
const playoutMaxMs = Number(process.env.KTV_ROOM_TEST_PLAYOUT_MAX_MS || 500)
assert.ok(Number.isInteger(playoutMaxMs) && playoutMaxMs >= 50 && playoutMaxMs <= 500,
  'Isolated SFU playout maximum must be 50–500 ms')
assert.ok(!avTiming || remoteMode, 'A/V fixture requires owned source/receiver browsers on one remote host clock domain')
const impairmentMode = process.env.KTV_ROOM_TEST_MEDIA_IMPAIRMENT || 'off'
assert.ok(['off', '1', 'tcp', 'udp'].includes(impairmentMode), 'Unknown media impairment mode')
const mediaImpairment = impairmentMode !== 'off', impairmentProtocol = impairmentMode === 'udp' ? 'udp' : 'tcp'
assert.ok(!mediaImpairment || remoteMode, 'Media impairment requires the owned remote browser topology')
const networkRecovery = process.env.KTV_ROOM_TEST_NETWORK_RECOVERY === '1'
const routeHandover = process.env.KTV_ROOM_TEST_ROUTE_HANDOVER === '1'
const handoverAv = process.env.KTV_ROOM_TEST_HANDOVER_AV === '1'
assert.ok(receiverFault==='off'||!networkRecovery&&!routeHandover&&!mediaImpairment&&!legacyBuild,
  'Integrated receiver faults run independently of impairment, hybrid handover and legacy journeys')
assert.ok(!demandKeyframes || !handoverAv, 'Private demand-recovery measurement currently scopes one initial publisher')
assert.ok(!handoverAv || avTiming && routeHandover && receiverSync === 'off' && receiverTargetMs === null,
  'Post-handover A/V requires native timing, full hybrid handover and unmodified receiver policy')
const continuousImpairment = process.env.KTV_ROOM_TEST_CONTINUOUS_IMPAIRMENT === '1'
assert.ok(!continuousImpairment || mediaImpairment && networkRecovery && routeHandover,
  'Continuous impairment requires a media proxy, signaling recovery and hybrid handover')
assert.ok(!routeHandover || remoteMode, 'Hybrid fixture requires the owned remote fake-microphone browser')
if (remoteMode) {
  assert.equal(net.isIP(process.env.KTV_ROOM_TEST_PUBLIC_IP || ''), 4, 'Remote fixture requires the SFU public IPv4')
  assert.match(process.env.KTV_ROOM_TEST_INTERFACE || '', /^[A-Za-z0-9_-]+$/, 'Remote fixture requires its network interface')
}

const exec = promisify(execFile), root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-room-stream-'))
const container = `ktv-room-stream-${randomUUID().slice(0, 8)}`
const apiKey = 'room-browser', apiSecret = randomBytes(32).toString('hex'), controlSecret = randomBytes(32).toString('hex')
const upstreamUrl = 'http://127.0.0.1:17900', image = 'livekit/livekit-server:v1.13.7@sha256:6fd3b7088874c4d119160dd688798dfec852bc014786d392caad15f6f63912a3'
const provider = new RoomServiceClient(upstreamUrl, apiKey, apiSecret, { requestTimeout: 2, failover: false })
const db = initDb(root), contexts = [], debuggerSockets = [], pending = new Map(), sessionSockets = new Map(), sessionTargets = new Map(), errors = [], mediaHttp = []
const ownedTcp = new Set()
const trackTcp = server => server.on('connection', socket => { ownedTcp.add(socket); socket.once('close', () => ownedTcp.delete(socket)) })
let mediaProxy, audienceCircuits, frontend, backend, worker, realtime, chrome, remoteBrowser, avBrowser, hostBrowser, pulseModule, pathRoom, nativeSyncAudience, senderKeyframePage, running = false, nextId = 0, passed = 0
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
function cdp(socket, method, params = {}, sessionId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, timeoutMs)
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
    else if (packet.method === 'Network.responseReceived') {
      const response = packet.params.response, pathname = new URL(response.url).pathname
      if (pathname.startsWith('/api/ktv/') && pathname.includes('media')) {
        mediaHttp.push({ path: pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'id'), status: response.status })
        if (mediaHttp.length > 64) mediaHttp.shift()
      }
    }
  })
  console.log(`Browser: ${info.Browser}`); return socket
}
async function evaluate(session, expression, timeoutMs = 15000) {
  const result = await cdp(sessionSockets.get(session), 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, session, timeoutMs)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function click(session, label) {
  await poll(() => evaluate(session, `(() => { const item = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(label)} && !item.disabled && item.getClientRects().length); if (!item) return false; item.click(); return true })()`), `button ${label}`)
}
function wav(frequency, seconds = fixtureSeconds) {
  const rate = 44100, size = rate * seconds * 2, bytes = Buffer.alloc(44 + size)
  bytes.write('RIFF'); bytes.writeUInt32LE(36 + size, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(size, 40)
  for (let index = 0; index < rate * seconds; index++) {
    const tone = avTiming && frequency === 440 && Math.floor(index / rate / 2) % 2 ? 660 : frequency
    bytes.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * tone / rate) * 3000), 44 + index * 2)
  }
  return bytes
}
try {
  for (const folder of ['data', 'karaoke', 'synced', 'lyrics', 'import']) await fs.mkdir(path.join(root, folder))
  // Keep the guide distinct from microphone/backing harmonics after encoding.
  await fs.writeFile(path.join(root, 'data/link.1.mp3'), wav(1729))
  await fs.writeFile(path.join(root, 'karaoke/link.1.instrumental.mp3'), wav(440))
  const lyrics = avTiming ? Array.from({length:Math.ceil(fixtureSeconds/2)},(_,id)=>`[${String(Math.floor(id*2/60)).padStart(2,'0')}:${String(id*2%60).padStart(2,'0')}]AV${id%2?'OFF':'ON'}${id}`).join('\n')
    : '[00:00]Singing together\n[00:10]Second lyric\n[00:25]Third lyric\n[00:50]Final lyric'
  await fs.writeFile(path.join(root, 'synced/link.1.lrc'), lyrics)
  const micFile = path.join(root, 'microphone.wav'); await fs.writeFile(micFile, wav(880))
  const config = path.join(root, 'livekit.yaml')
  if (mediaImpairment) {
    // ICE TCP muxes identify the local interface as well as the ICE username.
    // Use the SFU's actual interface; loopback is excluded from its candidates.
    const upstreamHost = os.networkInterfaces()[process.env.KTV_ROOM_TEST_INTERFACE]?.find(item=>item.family==='IPv4')?.address
    assert.ok(upstreamHost, 'Owned SFU interface has an IPv4 address')
    mediaProxy = await (impairmentProtocol === 'udp' ? createMediaUdpProxy : createMediaTcpProxy)({
      listenPort: impairmentProtocol === 'udp' ? 7882 : 7881, upstreamPort: impairmentProtocol === 'udp' ? 17902 : 17901,
      listenHost: '0.0.0.0', upstreamHost })
  }
  const rtc = remoteMode
    ? `  node_ip: ${process.env.KTV_ROOM_TEST_PUBLIC_IP}\n  use_external_ip: false\n  tcp_port: ${mediaImpairment ? 17901 : 7881}\n  udp_port: ${mediaImpairment ? 17902 : 7882}\n  interfaces:\n    includes: [${process.env.KTV_ROOM_TEST_INTERFACE}]\n`
    : '  node_ip: 127.0.0.1\n  use_external_ip: false\n  tcp_port: 17901\n  udp_port: 17902\n  enable_loopback_candidate: true\n  interfaces:\n    includes: [lo]\n'
  await fs.writeFile(config, `port: 17900\nbind_addresses: [127.0.0.1]\nrtc:\n${rtc}room:\n  max_participants: 6\n  sync_streams: true\n  playout_delay:\n    enabled: ${playoutHints==='adaptive'}\n    min: 0\n    max: ${playoutMaxMs}\nkeys:\n  ${apiKey}: ${apiSecret}\nlogging:\n  level: warn\n`, { mode: 0o600 })
  console.log('Fixture SFU policy:',JSON.stringify({syncStreams:true,playoutHints,playoutMaxMs}))
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
  // This fixture owns one song. An absent count falls back to 1282 unrelated
  // catalog entries and downloads; that is neither valid audio nor load evidence.
  app.get('/data/song_number.txt', (_req, res) => res.type('text').send('1'))
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
  if (legacyBuild) app.get('/__ktv_legacy_app', (req, res) => {
    const id = req.query.room
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return res.sendStatus(400)
    res.setHeader('Cache-Control','no-store')
    res.type('html').send(legacyHtml.replace('<head>', `<head><script>history.replaceState(null,'',${JSON.stringify('/party/'+id+'/stage')});</script>`))
  })
  app.use(express.static(frontendBuild))
  if (legacyBuild) app.use(express.static(legacyBuild))
  app.get('*', (req, res) => res.sendFile(path.join(frontendBuild,'index.html')))
  await worker.reconcile(); check(worker.ready, 'actual room-policy worker is ready')
  async function api(actor, route, body) {
    const response = await fetch(origin + '/api/ktv' + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const result = await response.json()
    if(!response.ok) throw Object.assign(new Error(`${route}: ${result.code || response.status}`),{code:result.code,status:response.status})
    return result.data
  }
  const room = await api(1, '/rooms', { commandId: randomUUID(), name: 'Integrated online room', displayName: 'Host', approvalRequired: false })
  pathRoom = `/rooms/${room.room.id}`
  const singer = await api(2, '/join', { commandId: randomUUID(), code: room.invitationCode, displayName: 'Singer' })
  const nextSinger = await api(3, '/join', { commandId: randomUUID(), code: room.invitationCode, displayName: 'Next singer' })
  const singerDebugPort = Number(process.env.CHROME_MEDIA_TEST_PORT || 9240)
  const chromeEnv = { ...process.env }
  if (!remoteMode && process.env.PARTY_TEST_PULSE_SINK === '1') {
    // An owned virtual output isolates the fixture from this host's shared sink.
    // Browser audio clocks and all application drift guards remain native.
    const sink = `ktv_${randomUUID().replaceAll('-', '')}`
    pulseModule = (await exec('pactl', ['load-module', 'module-null-sink', `sink_name=${sink}`, 'rate=44100'])).stdout.trim()
    chromeEnv.PULSE_SINK = sink
  }
  if (remoteMode) remoteBrowser = await createOwnedRemoteBrowser({ host: process.env.KTV_ROOM_TEST_SSH_HOST,
    knownHosts: process.env.KTV_ROOM_TEST_KNOWN_HOSTS, micFile, frontendPort: frontend.address().port,
    debugPort: Number(process.env.KTV_ROOM_TEST_CHROME_PORT || 9243), isolatedOutput: avTiming||receiverFault!=='off',
    captureOutput: false })
  else chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', '--no-default-browser-check', '--no-proxy-server',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${micFile}`,
    `--remote-debugging-port=${singerDebugPort}`, `--user-data-dir=${path.join(root, 'chrome')}`, 'about:blank'], { stdio: 'ignore', env: chromeEnv })
  const singerDebugUrl = remoteBrowser?.debuggerUrl || `http://127.0.0.1:${singerDebugPort}`
  await poll(async () => { try { return (await fetch(singerDebugUrl + '/json/version')).ok } catch { return false } }, 'owned fake-mic Chrome')
  const singerSocket = await debuggerConnection(singerDebugUrl)
  if(avTiming||receiverFault!=='off') avBrowser=await createOwnedRemoteBrowser({host:process.env.KTV_ROOM_TEST_SSH_HOST,
    knownHosts:process.env.KTV_ROOM_TEST_KNOWN_HOSTS,micFile,debugPort:Number(process.env.KTV_ROOM_TEST_AV_CHROME_PORT||9244),isolatedOutput:true,
    captureActivity:receiverFault!=='off'})
  if(handoverAv||receiverFault!=='off') hostBrowser=await createOwnedRemoteBrowser({host:process.env.KTV_ROOM_TEST_SSH_HOST,
    knownHosts:process.env.KTV_ROOM_TEST_KNOWN_HOSTS,micFile,debugPort:9245,isolatedOutput:true,
    captureOutput:receiverFault!=='off',captureActivity:receiverFault!=='off'})
  const audienceSocket = avBrowser ? await debuggerConnection(avBrowser.debuggerUrl) : remoteMode ? singerSocket : await debuggerConnection(process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9231')
  const hostSocket = hostBrowser ? await debuggerConnection(hostBrowser.debuggerUrl) : audienceSocket
  console.log('Client topology:', clientLocation, '; native audio clocks; isolated synthetic room/microphone')
  async function page(actor, stage = false, legacy = false) {
    const socket = actor === 2 || actor === 3 ? singerSocket : actor === 1 && !stage ? hostSocket : audienceSocket
    const { browserContextId } = await cdp(socket, 'Target.createBrowserContext'); contexts.push({ socket, browserContextId })
    await cdp(socket, 'Browser.grantPermissions', { browserContextId, origin, permissions: ['audioCapture'] })
    const { targetId } = await cdp(socket, 'Target.createTarget', { browserContextId, url: 'about:blank' })
    const { sessionId } = await cdp(socket, 'Target.attachToTarget', { targetId, flatten: true }); sessionSockets.set(sessionId, socket);sessionTargets.set(sessionId,targetId)
    await cdp(socket, 'Page.enable', {}, sessionId); await cdp(socket, 'Runtime.enable', {}, sessionId)
    await cdp(socket, 'Network.enable', {}, sessionId)
    await cdp(socket, 'Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('auth_token', '${actor}'); localStorage.setItem('language', 'en');
      ${avTiming ? `(${installAvSourceMarkers.toString()})();` : ''}
      ${encodedApi==='legacy' ? 'window.RTCRtpScriptTransform=undefined;' : ''}
      ${encodedTiming ? `(${installEncodedTimingProbe.toString()})(${JSON.stringify('('+encodedTimingWorker.toString()+')();')});` : ''}
      (${installEncodedLeaseObserver.toString()})();
      ${absoluteCapture ? `(${installAbsoluteCaptureExperiment.toString()})();` : ''}
      window.__partyClocks=[]; window.__partyPlaybacks=[]; window.__phaseEvidence=[];
      window.__receivedPermits=[];
      if(${receiverFault!=='off'}) {
        const open=XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open=function(method,url,...args){
          const pathname=new URL(url,location.href).pathname;
          if(pathname.endsWith('/output'))this.addEventListener('load',()=>{
            try {
              const reply=this.responseType==='json'?this.response:JSON.parse(this.responseText);
              if(reply?.data?.permit)__receivedPermits.push({permit:reply.data.permit,received:performance.now()});
              if(__receivedPermits.length>16)__receivedPermits.shift();
            } catch {}
          });
          return open.call(this,method,url,...args);
        };
      }
      window.__longTasks=[];
      if (${avTiming} && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        new PerformanceObserver(list => {
          for (const item of list.getEntries()) __longTasks.push({startTime:item.startTime,duration:item.duration});
          if (__longTasks.length>128) __longTasks.splice(0,__longTasks.length-128);
        }).observe({entryTypes:['longtask']});
      }
      window.__sockets = []; const Socket = window.WebSocket; window.WebSocket = class extends Socket { constructor(...args) {
        super(...args); window.__sockets.push(this);
        this.addEventListener('message',event=>{
          let packet;try { packet=JSON.parse(event.data) } catch { return }
          if(packet.type==='clock.reply') {
            const {clientSendMs,serverReceiveMs,serverSendMs}=packet,received=performance.now();
            __partyClocks.push({received,offsetMs:((serverReceiveMs-clientSendMs)+(serverSendMs-received))/2,
              roundTripMs:received-clientSendMs-(serverSendMs-serverReceiveMs)});
            if(__partyClocks.length>120)__partyClocks.shift();
          }
          if(packet.type==='snapshot'&&packet.data?.playback) {
            const {state,generation,positionMs,anchorServerMs}=packet.data.playback;
            __partyPlaybacks.push({state,generation,positionMs,anchorServerMs,received:performance.now()});
            if(__partyPlaybacks.length>120)__partyPlaybacks.shift();
          }
        });
      } };
      window.__micStreams = []; window.__bufferSources = []; window.__sourceEvidence = []; window.__outputEvidence = []; window.__peers = []; window.__contexts = [];window.__gainNodes=[];
      const Context = window.AudioContext; window.AudioContext = class extends Context { constructor(...args) { super(...args); window.__contexts.push(this); } };
      if(${receiverFault!=='off'}) {
        const mediaSource=Context.prototype.createMediaStreamSource;
        Context.prototype.createMediaStreamSource=function(stream){
          this.__mediaSourceTrackIds=stream.getAudioTracks().map(track=>track.id);
          return mediaSource.call(this,stream);
        };
      }
      if(${avTiming}) { const gain=Context.prototype.createGain;Context.prototype.createGain=function(...args){const node=gain.apply(this,args);node.__automation=[]; for(const name of ["setValueAtTime","cancelScheduledValues"]){const original=node.gain[name];node.gain[name]=function(...values){node.__automation.push({name,values,time:node.context.currentTime,at:performance.now()});if(node.__automation.length>12)node.__automation.shift();return original.apply(this,values)}} __gainNodes.push(node);return node} }
      window.__iceEvidence = [];
      const Peer = window.RTCPeerConnection; window.RTCPeerConnection = class extends Peer { constructor(...args) { super(...args); window.__peers.push(this);
        this.addEventListener('iceconnectionstatechange',()=>window.__iceEvidence.push({state:this.iceConnectionState,now:performance.now()})); } };
      ${publisherFeedback === 'remb' && (actor === 2 || actor === 3) ? `(${installPublisherRembExperiment.toString()})(${publisherRembSdp.toString()});` : ''}
      if (${mediaImpairment}) {
        // Only fixture remote candidates are routed through the owned relay.
        // Native media clocks, source timing, permissions and drift gates remain unchanged.
        const candidate = text => {
          if (!text) return text;
          const parts=text.trim().split(/\\s+/);
          if(parts[2]?.toLowerCase()!==${JSON.stringify(impairmentProtocol)}) return null;
          if(parts[5]==='17901') parts[5]='7881';
          if(parts[5]==='17902') parts[5]='7882';
          window.__iceEvidence.push({protocol:parts[2],address:parts[4],port:parts[5]});
          return parts.join(' ');
        };
        const add = Peer.prototype.addIceCandidate, remote = Peer.prototype.setRemoteDescription;
        Peer.prototype.addIceCandidate = function(value) {
          if(!value?.candidate) return add.call(this,value);
          const rewritten=candidate(value.candidate); if(rewritten===null) return Promise.resolve();
          return add.call(this,{...value.toJSON?.(),...value,candidate:rewritten});
        };
        Peer.prototype.setRemoteDescription = function(value) {
          if(!value?.sdp) return remote.call(this,value);
          const sdp=value.sdp.split('\\r\\n').map(line=>{
            if(!line.startsWith('a=candidate:')) return line;
            const rewritten=candidate(line.slice(2));return rewritten===null?null:'a='+rewritten;
          }).filter(line=>line!==null).join('\\r\\n');return remote.call(this,{type:value.type,sdp});
        };
      }
      const timestamp = AudioContext.prototype.getOutputTimestamp;
      AudioContext.prototype.getOutputTimestamp = function() { const output = timestamp.call(this); window.__outputEvidence.push({ ...output, context: window.__contexts.indexOf(this), now: performance.now(), render: this.currentTime, latency: this.outputLatency }); if (__outputEvidence.length > 24) __outputEvidence.shift(); return output; };
      const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await getMedia(...args); window.__micStreams.push(stream); return stream; };
      const source = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function() { const item = source.call(this), start = item.start.bind(item), stop = item.stop.bind(item);
        item.__state = { started: false, ended: false, stopAt: null, stopCalls: 0, context: this };
        item.addEventListener('ended', () => { item.__state.ended = true; });
        item.stop = (...args) => { const result = stop(...args); item.__state.stopCalls++; item.__state.stopAt = args[0] ?? this.currentTime; return result; };
        item.start = (...args) => {
        const samples = item.buffer?.getChannelData(0), length = Math.min(samples?.length || 0, 4096); let crossings = 0;
        for (let index = 1; index < length; index++) if (samples[index-1] <= 0 && samples[index] > 0) crossings++;
        item.__state.started = true; window.__sourceEvidence.push({when:args[0],offset:args[1],now:performance.now(),render:this.currentTime,output:this.getOutputTimestamp(),
          frequency: length ? Math.round(crossings * item.buffer.sampleRate / length) : null}); return start(...args);
      }; window.__bufferSources.push(item); return item; };
      window.confirm = () => true;
      ${controlledPlayoutMs === null ? '' : `(${installControlledReceiver.toString()})(${RtpCaptureClock.toString()},${CaptureFrameQueue.toString()},${controlledPlayoutMs});`}` }, sessionId)
    await cdp(socket, 'Page.navigate', { url: origin + (legacy ? `/__ktv_legacy_app?room=${room.room.id}` : `/party/${room.room.id}${stage ? '/stage' : ''}`) }, sessionId)
    await poll(() => evaluate(sessionId, "document.body?.innerText.includes('Live room updates connected')"), 'room page connected')
    if (!stage) await evaluate(sessionId, "document.getElementById('party-tab-sing').click()")
    return sessionId
  }
  const host = await page(1), phone = await page(2), audience = await page(1, true)
  if(absoluteCapture) check(await evaluate(phone,'__absoluteCaptureExperiment.supported'),
    'native transceiver APIs support absolute capture negotiation without SDP rewriting')
  await poll(() => evaluate(host, "[...document.querySelectorAll('select')].some(item => [...item.options].some(option => option.value === 'online') && !item.disabled)"), 'host mode selector ready')
  await evaluate(host, "(() => { const item = [...document.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === 'online')); item.value = 'online'; item.dispatchEvent(new Event('change', {bubbles:true})); })()")
  await poll(async () => (await api(1, pathRoom)).room.performanceMode === 'online', 'room switches online')
  await poll(() => evaluate(audience, "![...document.querySelectorAll('button')].some(item => item.textContent.trim() === 'Enable stage audio')"), 'common screen applies online snapshot')
  check(await evaluate(audience, "![...document.querySelectorAll('button')].some(item => item.textContent.trim() === 'Enable stage audio')"), 'online common screen cannot independently enable backing')
  check(await evaluate(phone, "![...document.querySelectorAll('select')].some(item => [...item.options].some(option => option.value === 'online'))"), 'ordinary singer has no room-mode admin selector')
  if (legacyBuild) {
    const beforeIds = new Set((await api(1,pathRoom)).presence.devices.map(item=>item.id))
    const legacy = await page(1,true,true)
    const legacyDevice = await poll(async()=> (await api(1,pathRoom)).presence.devices.find(item=>!beforeIds.has(item.id)),
      'actual old app device status')
    check(legacyDevice.mediaProtocol===1,'immutable older app reports its actual legacy media contract')
    const loaded = await evaluate(legacy,"[...document.querySelectorAll('script[type=module][src]')].map(item=>new URL(item.src).pathname)")
    check(loaded.length===1 && legacyHtml.includes(loaded[0]),'legacy journey executes the older entry bundle unchanged')
    await click(legacy,'Watch and listen')
    await poll(()=>evaluate(legacy,"document.querySelector('[data-party-media-status]')?.textContent.includes('Streaming stopped.')"),
      'older audience receives a terminal streaming refusal')
    check(!db.prepare('SELECT 1 FROM ktv_media_grants WHERE device_id = ?').get(legacyDevice.id),
      'older real app receives no media token or provider nonce')
    check(await evaluate(legacy,"__peers.length===0&&!document.querySelector('[data-party-media-screen] video')"),
      'older real app opens no peer or unguarded audience output')
    check((await api(1,pathRoom)).presence.devices.some(item=>item.id===legacyDevice.id&&item.connected),
      'older real app retains its room connection after media refusal')
    await cdp(sessionSockets.get(legacy),'Target.closeTarget',{targetId:sessionTargets.get(legacy)})
    await poll(async()=> !(await api(1,pathRoom)).presence.devices.some(item=>item.id===legacyDevice.id),'legacy test device released')
  }
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
  if (mediaImpairment) audienceCircuits = await poll(() => { const ids=mediaProxy.snapshot().circuits.filter(item=>item.alive&&item.bytesToClient>0).map(item=>item.id); return ids.length ? ids : false }, 'initial audience media circuit')
  await click(host, 'Start countdown')
  await poll(() => evaluate(phone, "document.querySelector('[data-party-media-status]')?.textContent.includes('Sending live singing')"), 'publisher ready through provider acknowledgment')
  await poll(() => evaluate(audience, "(() => { const video = document.querySelector('[data-party-media-screen] video'); return video?.srcObject?.getAudioTracks().length === 1 && video.srcObject.getVideoTracks().length === 1; })()"), 'audience receives both performance tracks')
  await poll(async () => (await api(1, pathRoom)).playback.state === 'playing', 'room plays after ready countdown')
  if(absoluteCapture) await poll(()=>evaluate(audience,
    "['audio','video'].every(kind=>__encodedTimingProbe.records.filter(row=>row.direction==='receive'&&row.kind===kind&&Number.isFinite(row.values.captureTime)).length>=8)"),
    'actual SFU audio/video capture timestamps',60000)
  if(controlledPlayoutMs !== null) await poll(()=>evaluate(audience,'__controlledReceiver.snapshot().active?.ready'),
    'actual capture-clock-controlled receiver presentation',15000)
  if(decodedTrackProbe) {
    const evidence=await evaluate(audience,`(${probeDecodedTracks.toString()})(document.querySelector('[data-party-media-screen] video').srcObject,__peers)`)
    console.log('Native decoded track capability:',JSON.stringify(evidence))
    const video=evidence.find(row=>row.kind==='video')
    check(video.status==='complete'&&video.records.length===8&&video.records.every(row=>
      Number.isInteger(row.rtpTimestamp)&&row.codedWidth===1280&&row.codedHeight===720),
      'actual decoded video frames expose RTP timestamps at the nominal 1280x720 size')
    check(video.records.every((row,index)=>index===0||row.timestamp>video.records[index-1].timestamp),
      'actual decoded video presentation timestamps advance')
  }
  if (senderKeyframeMs !== null || demandKeyframes) {
    await evaluate(phone, `(${installSenderKeyframeExperiment.toString()})(${senderKeyframeMs ?? 5000}, ${demandKeyframes})`)
    senderKeyframePage = phone
    console.log('Private native sender keyframe policy:', JSON.stringify({ periodMs: senderKeyframeMs, demandKeyframes }))
  }
  const firstPublisher = db.prepare("SELECT * FROM ktv_media_grants WHERE scope = 'publisher' AND state = 'active'").get()
  check(Boolean(firstPublisher.ready_at), 'provider-confirmed audio/video readiness is persisted for the exact publisher')
  const participants = await provider.listParticipants(`ktv-${room.room.id}`)
  check(participants.filter(item => item.identity === firstPublisher.identity).length === 1 && participants.find(item => item.identity === firstPublisher.identity).tracks.length === 2, 'actual SFU has one publisher with one mix and one lyric video')
  check(participants.find(item => item.identity === firstPublisher.identity).tracks.every(track=>track.stream==='performance'), 'SFU places performance audio and lyric video in the same synchronization stream')
  const publisherNegotiation = await evaluate(phone, `(${collectRtcFeedback.toString()})()`)
  console.log('Publisher negotiated feedback:', JSON.stringify(publisherNegotiation))
  if (codecExperiment?.transport === 'dual') {
    const topology = await evaluate(phone, `__peers.map(peer => ({
      senders:peer.getSenders().filter(sender=>sender.track?.readyState==='live').map(sender=>sender.track.kind)
    }))`)
    console.log('Private native publisher topology:', JSON.stringify(topology))
    const publishing = topology.filter(peer => peer.senders.length > 0)
    check(topology.length === 2 && publishing.length === 1 && publishing[0].senders.length === 2 &&
      ['audio', 'video'].every(kind => publishing[0].senders.includes(kind)),
      'private dual topology has two native peers and exactly one audio/video publisher')
  }
  if (publisherFeedback === 'remb') {
    const state = await evaluate(phone, 'window.__publisherRembExperiment.snapshot()')
    console.log('Private publisher feedback rewrite counts:', JSON.stringify(state))
    const local = publisherNegotiation.filter(row => row.side === 'local' && row.kind === 'video' && row.direction === 'sendonly')
    const remote = publisherNegotiation.filter(row => row.side === 'remote' && row.kind === 'video' && row.direction === 'recvonly')
    check(local.length === 1 && remote.length === 1 && [...local, ...remote].every(row =>
      row.rembFeedback && row.absoluteSendTimeExtension && !row.transportCcFeedback && !row.transportCcExtension),
      'private publisher negotiates REMB and absolute-send-time without TWCC on the actual sending video')
    check(state.modified > 0, 'private feedback experiment changes an actual native offer or answer')
  }
  console.log('Audience negotiated feedback:', JSON.stringify(await evaluate(audience, `(${collectRtcFeedback.toString()})()`)))
  const receiverGroups = await evaluate(audience, `(() => __peers.flatMap(peer => {
    const sdp=peer.remoteDescription?.sdp||'';
    return sdp.split(/(?:^|\\r?\\n)m=/).filter(section=>/^(audio|video) /.test(section))
      .map(section=>({kind:section.startsWith('audio ')?'audio':'video',
        playoutDelayNegotiated:section.includes('http://www.webrtc.org/experiments/rtp-hdrext/playout-delay'),
        cnames:[...new Set([...section.matchAll(/a=ssrc:\\d+ cname:([^\\r\\n]+)/g)].map(item=>item[1]))],
        streams:[...new Set([...section.matchAll(/a=msid:([^ \\r\\n]+)/g)].map(item=>item[1]))]}));
  }))()`)
  console.log('Receiver synchronization group counts:',JSON.stringify(receiverGroups.map(item=>({kind:item.kind,cnameCount:item.cnames.length,streamCount:item.streams.length,playoutDelayNegotiated:item.playoutDelayNegotiated}))))
  const syncAudio=receiverGroups.find(item=>item.kind==='audio'&&item.cnames.length),syncVideo=receiverGroups.find(item=>item.kind==='video'&&item.cnames.length)
  check(Boolean(syncAudio&&syncVideo&&syncAudio.cnames.some(value=>syncVideo.cnames.includes(value))&&syncAudio.streams.some(value=>syncVideo.streams.includes(value))), 'negotiated receiver audio/video share an RTCP synchronization identity')

  if(receiverFault!=='off') {
    await runRoomReceiverFault({mode:receiverFault,phone,audience,host,origin,pathRoom,firstPublisher,
      api,evaluate,click,poll,check,db,provider,replacementBrowser:hostBrowser,receiverBrowser:avBrowser})
  } else {
  const installSpectrum = () => evaluate(audience, `(() => { const element = document.querySelector('[data-party-media-screen] video'); window.__receiveContext = new AudioContext(); __receiveContext.resume();
    const source = __receiveContext.createMediaStreamSource(element.srcObject); window.__analyser = __receiveContext.createAnalyser(); __analyser.fftSize = 8192; __analyser.smoothingTimeConstant = 0;
    const silent = __receiveContext.createGain(); silent.gain.value = 0; source.connect(__analyser); __analyser.connect(silent); silent.connect(__receiveContext.destination); })()`)
  const spectrum = () => evaluate(audience, `(() => { const values = new Float32Array(__analyser.frequencyBinCount); __analyser.getFloatFrequencyData(values);
    return [440,880,1729].map(frequency => { const center = Math.round(frequency * __analyser.fftSize / __receiveContext.sampleRate); const value = Math.max(...values.slice(center-2,center+3)); return Number.isFinite(value) ? value : -120; }); })()`)
  let peaks
  async function verifySpectrum() {
    await installSpectrum()
    peaks = await poll(async () => { const value = await spectrum(); return value[0] > -55 && value[1] > -55 ? value : false }, 'received backing and microphone tones')
    check(peaks[2] < Math.min(peaks[0], peaks[1]) - 25, `audience mix contains backing and live microphone without original-vocal tone (${peaks.map(value => value.toFixed(1)).join(', ')} dB)`)
  }
  if(!avTiming) await verifySpectrum()
  await poll(() => evaluate(audience, "document.querySelector('[data-party-media-screen] video')?.videoWidth > 0"), 'first captured lyric video decoded')
  check(await evaluate(audience, "(() => { const video = document.querySelector('[data-party-media-screen] video'); return video.videoWidth > 0 && Math.abs(video.videoWidth / video.videoHeight - 16/9) < .02; })()"), 'audience displays decoded captured lyric video')
  const inboundTiming = () => evaluate(audience, `(async () => {
    const fields=['kind','packetsReceived','packetsLost','jitter','jitterBufferDelay','jitterBufferTargetDelay',
      'jitterBufferMinimumDelay','jitterBufferEmittedCount','estimatedPlayoutTimestamp','totalSamplesReceived',
      'concealedSamples','insertedSamplesForDeceleration','removedSamplesForAcceleration','framesDecoded',
      'framesDropped','framesReceived','freezeCount','totalFreezesDuration','totalProcessingDelay','totalDecodeTime'];
    const reports=await Promise.all(__peers.map(peer=>peer.getStats()));
    return reports.flatMap(report=>[...report.values()].filter(item=>item.type==='inbound-rtp')
      .map(item=>Object.fromEntries(fields.filter(field=>item[field]!==undefined).map(field=>[field,item[field]]))));
  })()`)
  async function installVideoObserver(session) {
    if(controlledPlayoutMs !== null) await poll(()=>evaluate(session,'__controlledReceiver.snapshot().active?.ready'),
      'current capture-clock-controlled receiver presentation',15000)
    await evaluate(session,`(${installAvObserver.toString()})();`)
  }
  const routes = session => evaluate(session, `(async()=>{
    return (await Promise.all(__peers.map(peer=>peer.getStats()))).flatMap(report=>{
      const rows=[...report.values()];return rows.filter(item=>item.type==='transport'&&item.selectedCandidatePairId).map(item=>{
        const pair=rows.find(value=>value.id===item.selectedCandidatePairId), remote=rows.find(value=>value.id===pair?.remoteCandidateId);
        return {protocol:remote?.protocol,port:remote?.port};
      });
    });
  })()`)
  async function verifyImpairedRoute(session) {
    if(!continuousImpairment) return
    const profile=mediaProxy.snapshot(), selected=await routes(session)
    check(profile.delayMs===150&&profile.jitterMs===40&&
      (impairmentProtocol!=='udp'||profile.lossRate===0.05)&&selected.length>0&&
      selected.every(item=>item.protocol===impairmentProtocol&&item.port===(impairmentProtocol==='udp'?7882:7881)),
      'handover media keeps the configured delay/jitter/loss and selected proxy route')
  }
  let recoveryLastRequest = null, recoveryPending, recoveryEncoded = 0
  async function measureAv(phase, sourcePage = phone) {
    // Phase setup can include several seconds of network settling. Seed a fresh
    // progress window while preserving the request cooldown across that gap.
    let recoveryState
    const transitions = phase==='baseline'&&mediaImpairment?6:avTransitions
    const inboundBefore = await inboundTiming()
    const begin=await evaluate(audience, `__avObserver.begin(${JSON.stringify(phase)})`)
    let lastPhaseSample=0
    const result=await poll(async()=>{
      if(Date.now()-lastPhaseSample>=1000) {
        lastPhaseSample=Date.now()
        if(avTimingSamples.length>=(handoverAv ? 400 : 180)) throw new Error('AV_TIMING_SAMPLES_LIMIT')
        const [source,receiver] = await Promise.all([
          evaluate(sourcePage,`(${collectAvMediaStats.toString()})()`),
          evaluate(audience,`(${collectAvMediaStats.toString()})()`),
        ])
        avTimingSamples.push({phase,source,receiver})
        if (demandKeyframes) {
          const audios = receiver.reports.filter(row => row.type === 'inbound-rtp' && row.kind === 'audio')
          const videos = receiver.reports.filter(row => row.type === 'inbound-rtp' && row.kind === 'video')
          const sourceVideos = source.reports.filter(row => row.type === 'outbound-rtp' && row.kind === 'video')
          assert.ok(audios.length === 1 && videos.length === 1 && sourceVideos.length === 1,
            'Private recovery must use exactly one native audio/video path')
          const sourceVideo = sourceVideos[0]
          if (recoveryPending && sourceVideo.ssrc === recoveryPending.ssrc &&
            sourceVideo.keyFramesEncoded > recoveryPending.keys) {
            recoveryEncoded++; recoveryPending = null
          }
          const decision = keyframeRecoveryStep(receiver.time, audios[0], videos[0], recoveryState)
          assert.ok(decision.valid, 'Private recovery refuses missing, reset or stale native progress')
          if (decision.request) recoveryLastRequest = receiver.time
          recoveryState = { ...decision.state, lastRequestMs: recoveryLastRequest }
          avTimingSamples.at(-1).keyframeRecovery = { request: decision.request, reason: decision.reason,
            aheadMs: decision.aheadMs, encodedResponses: recoveryEncoded }
          if (decision.request) {
            assert.ok(Number.isFinite(sourceVideo.keyFramesEncoded), 'Native encoder keyframe evidence must exist before a recovery request')
            assert.equal(await evaluate(sourcePage, 'window.__avSenderKeyframes.request()'), true,
              'Demand recovery request is accepted by the current native sender')
            recoveryPending = { ssrc: sourceVideo.ssrc, keys: sourceVideo.keyFramesEncoded }
          }
        }
        if (receiverSync !== 'off') avTimingSamples.at(-1).nativeSync = await evaluate(audience,
          `__avNativeSync.sample(${JSON.stringify(receiver)}${receiverSync === 'repair' ? ',' + JSON.stringify(source) : ''})`)
        const sample=await evaluate(sourcePage,`(() => {
          const node=document.querySelector('dl'),context=__contexts[0];
          const sample={now:performance.now(),diagnostics:node?.textContent,
            rates:__bufferSources.filter(item=>item.__state.started&&!item.__state.ended).map(item=>item.playbackRate.value),
            sourceStops:__bufferSources.filter(item=>item.__state.started&&!item.__state.ended).map(item=>item.__state.stopCalls),
            recentLongTasks:__longTasks.filter(item=>performance.now()-item.startTime<3000),
            output:context?.getOutputTimestamp(),render:context?.currentTime};
          __phaseEvidence.push(sample);if(__phaseEvidence.length>180)__phaseEvidence.shift();
          return {failed:document.querySelector('[role=alert]')?.textContent,
            timing:{now:sample.now,rates:sample.rates,sourceStops:sample.sourceStops,
              recentLongTasks:sample.recentLongTasks,output:sample.output,render:sample.render,
              phaseErrorMs:Number(/Calculated sample phase(-?[0-9.]+) ms/.exec(sample.diagnostics)?.[1])}};
        })()`)
        avTimingSamples.at(-1).sourceTiming=sample.timing
        if(sample.failed) throw new Error('Publisher audio recovery interrupted A/V observation')
      }
      const observed=await evaluate(audience,'__avObserver.evidence'), sources=await evaluate(sourcePage,'__avSources')
      const audio=(await avBrowser.audioEvidence()).filter(item=>typeof item.on==='boolean'&&!item.initial&&item.time>=begin).map(item=>({...item,phase}))
      const measured=analyseAvObservations({...observed,audio,sources},phase)
      return measured.count>=transitions?measured:false
    },`${transitions} matched ${phase} audio/video marker transitions`,(transitions+5)*2000)
    console.log('A/V receiver buffer diagnostics:',JSON.stringify({phase,before:inboundBefore,after:await inboundTiming()}))
    console.log('A/V timing timeline:',JSON.stringify(avTimingSamples.filter(item=>item.phase===phase)))
    avMeasurements.push(result)
    console.log('A/V received frame metadata:',JSON.stringify((await evaluate(audience,'__avObserver.evidence.video')).filter(item=>item.phase===phase)))
    console.log('A/V marker measurement:',JSON.stringify(result))
    check(result.unmatchedVideo.length<=1&&result.unmatchedAudio<=1, `${phase} marker matching accounts for observed audio/video edges without selecting only aligned pairs`)
    check(result.pairs.every(item=>item.videoDelayMs>=0&&item.videoDelayMs<2000), `${phase} captured marker has a valid source-to-received video observation delay`)
    check(result.pairs.every(item=>Number.isFinite(item.captureQueueMs)&&Math.abs(item.captureQueueMs)<100&&item.captureCallMs<20),`${phase} private output monitor capture queue and timing call remain bounded`)
  }
  if(avTiming) {
    if (receiverSync !== 'off') {
      nativeSyncAudience = audience
      const step = receiverSync === 'ntp' ? nativeSyncTargetStep : receiverSync === 'repair' ? nativeRepairTargetStep : nativeNetworkTargetStep
      const receivers = await evaluate(audience, `(${installNativeSyncExperiment.toString()})(${step.toString()})`)
      check(receivers.length === 2, 'native sync experiment scopes hints to the two current player receivers')
    }
    if(receiverTargetMs !== null) {
      const targets=await evaluate(audience,`(() => {
        const tracks=document.querySelector('[data-party-media-screen] video').srcObject.getTracks();
        const receivers=__peers.flatMap(peer=>peer.getReceivers()).filter(receiver=>tracks.some(track=>track.id===receiver.track?.id));
        if(receivers.length!==2||receivers.some(receiver=>!('jitterBufferTarget' in receiver)))throw new Error('AV_RECEIVER_TARGET_UNSUPPORTED');
        return receivers.map(receiver=>{receiver.jitterBufferTarget=${receiverTargetMs};return {kind:receiver.track.kind,targetMs:receiver.jitterBufferTarget}});
      })()`)
      check(targets.length===2&&targets.every(item=>item.targetMs===receiverTargetMs),'experimental receiver audio/video targets apply to the two current tracks')
      console.log('Experimental native receiver targets:',JSON.stringify(targets))
    }
    await installVideoObserver(audience)
    await poll(async()=>await evaluate(audience,'__avObserver.evidence.ready')&&(await avBrowser.audioEvidence()).some(item=>typeof item.on==='boolean'),'actual private receiver output and decoded video marker available')
    let nativeStall
    if (sourceStallMs) {
      const before = await api(1,pathRoom)
      nativeStall = { generation: before.playback.generation, sources: await evaluate(phone, '__sourceEvidence.length') }
      const outputBefore = await evaluate(phone,'({time:performance.now(),render:__contexts[0].currentTime,output:__contexts[0].getOutputTimestamp()})')
      const pause = await remoteBrowser.pauseOutput(sourceStallMs)
      const outputAfter = await evaluate(phone,'({time:performance.now(),render:__contexts[0].currentTime,output:__contexts[0].getOutputTimestamp()})')
      console.log('Actual bounded native output pause:',JSON.stringify({pause,outputBefore,outputAfter}))
      check(pause.elapsedMs>=sourceStallMs&&pause.elapsedMs<sourceStallMs+100,
        'owned output process actually pauses without replacing browser timestamps or the room clock')
    }
    await measureAv('baseline')
    if (nativeStall) {
      const evidence=await evaluate(phone, `({phase:__phaseEvidence, sources:__sourceEvidence.length})`)
      const phases=evidence.phase.map(item=>Number(/Calculated sample phase(-?[0-9.]+) ms/.exec(item.diagnostics)?.[1])).filter(Number.isFinite)
      check(evidence.phase.some(item=>item.rates.some(rate=>rate>1.0001&&rate<=1.005))&&
        phases.length>=20&&Math.abs(phases.at(-1))<20, 'actual bounded rate feedback corrects the native source stall below twenty milliseconds')
      check(evidence.sources===nativeStall.sources&&(await api(1,pathRoom)).playback.generation===nativeStall.generation,
        'small source correction retains the actual source and playback generation without a hidden restart')
    }
    await evaluate(audience,'__avObserver.begin(null)')
    if (receiverSync !== 'off' && !mediaImpairment) await evaluate(audience, '__avNativeSync.close()')
  }
  if (mediaImpairment) {
    const selected = [...await routes(phone), ...await routes(audience)]
    check(selected.length>=2 && selected.every(item=>item.protocol===impairmentProtocol&&item.port===(impairmentProtocol==='udp'?7882:7881)), `publisher and audience media traverse the owned ${impairmentProtocol.toUpperCase()} proxy with no bypass`)
    mediaProxy.profile({delayMs:150,jitterMs:40,lossRate:impairmentProtocol==='udp'?0.05:0})
    if(avTiming) { await new Promise(resolve=>setTimeout(resolve,2000));await measureAv('impaired');await evaluate(audience,'__avObserver.stopRecording()');if(receiverSync!=='off')await evaluate(audience,'__avNativeSync.close()') }
    if(avTiming) await verifySpectrum()
    const frames=await evaluate(audience, "document.querySelector('[data-party-media-screen] video').getVideoPlaybackQuality().totalVideoFrames")
    await poll(() => evaluate(audience, `document.querySelector('[data-party-media-screen] video').getVideoPlaybackQuality().totalVideoFrames>=${frames+40}`), 'video advances with bounded media delay')
    const delayedPeaks=await poll(async()=>{const value=await spectrum();return value[0]>-55&&value[1]>-55?value:false}, 'audio with bounded media delay')
    check(delayedPeaks[2]<Math.min(delayedPeaks[0],delayedPeaks[1])-25, `delayed ${impairmentProtocol.toUpperCase()} media preserves backing/microphone playback and private-vocal separation`)
    if(impairmentProtocol==='udp') check(mediaProxy.snapshot().circuits.reduce((sum,item)=>sum+item.droppedToClient+item.droppedToSfu,0)>0, 'UDP loss profile drops real datagrams before the audience outage')
    console.log('Delayed receiver RTP:',JSON.stringify(await evaluate(audience, `(async()=> (await Promise.all(__peers.map(peer=>peer.getStats()))).flatMap(report=>[...report.values()].filter(item=>item.type==='inbound-rtp').map(item=>({kind:item.kind,packetsReceived:item.packetsReceived,packetsLost:item.packetsLost,jitterMs:(item.jitter||0)*1000,bufferMs:item.jitterBufferEmittedCount?item.jitterBufferDelay*1000/item.jitterBufferEmittedCount:null,framesDecoded:item.framesDecoded}))))()`)))
    const outageStarted=performance.now()
    mediaProxy.pause(audienceCircuits,3000)
    await new Promise(resolve=>setTimeout(resolve,900))
    const stalled=await evaluate(audience, "document.querySelector('[data-party-media-screen] video').getVideoPlaybackQuality().totalVideoFrames")
    await new Promise(resolve=>setTimeout(resolve,800))
    check(await evaluate(audience, "document.querySelector('[data-party-media-screen] video').getVideoPlaybackQuality().totalVideoFrames")===stalled, 'a media-only outage stops decoded audience video while room controls stay connected')
    check((await api(1,pathRoom)).playback.state==='playing'&&await evaluate(audience, "document.body.innerText.includes('Live room updates connected')&&__sockets.some(socket=>socket.readyState===WebSocket.OPEN&&new URL(socket.url).pathname==='/api/ktv/ws')"), 'media-only outage preserves the actual room-control socket and playing state')
    mediaProxy.resume(audienceCircuits)
    console.log('Audience media outage elapsed ms:',Math.round(performance.now()-outageStarted))
    await poll(() => evaluate(audience, `document.querySelector('[data-party-media-screen] video').getVideoPlaybackQuality().totalVideoFrames>=${stalled+10}`), 'decoded video resumes after the reversible media outage')
    check(await evaluate(audience, "!document.querySelector('[data-party-media-screen] video').paused"), 'audience resumes its received player after the media stall')
    const resumedPeaks=await poll(async()=>{const value=await spectrum();return value[0]>-55&&value[1]>-55?value:false}, 'actual audio resumes after the media outage')
    check(resumedPeaks[2]<Math.min(resumedPeaks[0],resumedPeaks[1])-25, 'resumed media restores both public tones without private vocals')
    check(mediaProxy.snapshot().circuits.every(item=>!item.overflow), 'bounded impairment queues avoid overflow')
    if(impairmentProtocol==='udp') check(mediaProxy.snapshot().circuits.reduce((sum,item)=>sum+item.droppedToClient+item.droppedToSfu,0)>0, 'UDP fixture drops real datagrams during packet loss and the audience outage')
    console.log(`Media ${impairmentProtocol.toUpperCase()} fixture:`,JSON.stringify(mediaProxy.snapshot()))
  }
  if(avTiming&&!mediaImpairment) { await evaluate(audience,'__avObserver.stopRecording()');await verifySpectrum() }
  await click(phone, 'Listen to original vocals privately')
  await poll(() => evaluate(phone, "document.body.innerText.includes('Turn off private original vocals')"), 'private original enabled')
  await poll(() => evaluate(phone, 'window.__sourceEvidence.some(item => item.frequency > 1600 && item.frequency < 1850)'), 'native private original tone source actually scheduled')
  check(await evaluate(phone, 'window.__sourceEvidence.some(item => item.frequency > 1600 && item.frequency < 1850) && window.__outputEvidence.some(item => item.contextTime > 0 && item.performanceTime > 0)'), 'private original tone is scheduled against native Web Audio output timestamps')
  peaks = await poll(async () => { const value = await spectrum(); return value[0] > -55 && value[1] > -55 ? value : false }, 'private guide keeps public backing intact')
  check(peaks[2] < Math.min(peaks[0], peaks[1]) - 25, `enabling the original guide in the built app keeps it outside the public mix (${peaks.map(value => value.toFixed(1)).join(', ')} dB)`)
  check(await evaluate(audience, 'window.__bufferSources.length === 0'), 'remote common screen creates no independent instrumental player')
  // Continuous mode retains the profile through recovery and all fresh performers.
  if(mediaProxy&&!continuousImpairment) mediaProxy.profile({delayMs:0,jitterMs:0,lossRate:0})
  if (networkRecovery) {
    await evaluate(audience, `(() => {
      window.__mediaHistory=[];
      new MutationObserver(()=>{const value=document.querySelector('[data-party-media-status]')?.textContent;
        if(value&&__mediaHistory.at(-1)!==value)__mediaHistory.push(value)}).observe(document.body,{subtree:true,childList:true,characterData:true});
    })()`)
    const oldAudience = db.prepare("SELECT * FROM ktv_media_grants WHERE scope = 'audience' AND state = 'active'").get()
    const oldAudienceGrant = await api(1, `${pathRoom}/media/${oldAudience.identity}/renew`, { deviceId: oldAudience.device_id })
    await evaluate(audience, "window.__previousAudienceVideo = document.querySelector('[data-party-media-screen] video')")
    const drop = await evaluate(audience, `(() => {
      const sockets=__sockets.filter(socket=>socket.readyState===WebSocket.OPEN&&new URL(socket.url).pathname.startsWith('/api/ktv/media/rtc'));
      sockets.forEach(socket=>socket.close(4000,'owned test signaling interruption'));return sockets.length;
    })()`)
    check(drop === 1, 'fixture interrupts only the audience media signaling socket')
    await poll(() => evaluate(audience, "__mediaHistory.some(value=>value.includes('Reconnecting live performance'))"), 'visible audience recovery state')
    await poll(() => evaluate(audience, "document.querySelector('[data-party-media-status]')?.textContent.includes('Connected to the live performance')"), 'audience automatically returns to listening')
    await poll(() => evaluate(audience, "(() => { const video=document.querySelector('[data-party-media-screen] video'); return video && video!==window.__previousAudienceVideo && video.getVideoPlaybackQuality().totalVideoFrames>=10 })()"), 'new player decodes after audience signaling recovery')
    const newAudience = db.prepare("SELECT * FROM ktv_media_grants WHERE scope = 'audience' AND state = 'active'").get()
    check(newAudience.identity !== oldAudience.identity && db.prepare('SELECT state FROM ktv_media_grants WHERE identity = ?').get(oldAudience.identity).state === 'revoked', 'automatic audience recovery uses a fresh nonce after old-provider acknowledgment')
    const oldAudienceClaims=JSON.parse(Buffer.from(oldAudienceGrant.token.split('.')[1], 'base64url').toString())
    const audienceDenied=await fetch(origin + '/api/ktv/media/rtc/validate?access_token=' + encodeURIComponent(oldAudienceGrant.token))
    check(oldAudienceClaims.exp*1000>Date.now() && audienceDenied.status===403, 'the old unexpired audience token stays denied after automatic recovery')
    if(controlledPlayoutMs !== null)await poll(()=>evaluate(audience,`(${hasSingleAudienceOutput.toString()})()`),'fresh controlled audience recovery output',15000)
    check(await evaluate(audience,`(${hasSingleAudienceOutput.toString()})()`), 'audience resumes one visible performance with one current native stream without a user click')
    await evaluate(audience, `(async () => { await __receiveContext.close(); const video=document.querySelector('[data-party-media-screen] video');
      window.__receiveContext=new AudioContext(); await __receiveContext.resume(); const source=__receiveContext.createMediaStreamSource(video.srcObject);
      window.__analyser=__receiveContext.createAnalyser(); __analyser.fftSize=8192; __analyser.smoothingTimeConstant=0;
      const silent=__receiveContext.createGain(); silent.gain.value=0; source.connect(__analyser); __analyser.connect(silent); silent.connect(__receiveContext.destination); })()`)
    const recoveredPeaks=await poll(async()=>{const value=await spectrum();return value[0]>-55&&value[1]>-55?value:false}, 'new audience receives actual backing and microphone audio')
    check(recoveredPeaks[2]<Math.min(recoveredPeaks[0],recoveredPeaks[1])-25, 'recovered audience hears backing and microphone while private original remains excluded')
    check((await api(1, pathRoom)).playback.state === 'playing' && db.prepare('SELECT state FROM ktv_media_grants WHERE identity = ?').get(firstPublisher.identity).state === 'active', 'audience recovery does not replace or interrupt the current singer')
    check(await evaluate(audience, 'window.__bufferSources.length===0'), 'audience recovery never starts competing digital backing')
    await verifyImpairedRoute(audience)
  }
  const oldPublisherGrant = await api(2, `${pathRoom}/media/${firstPublisher.identity}/renew`, { deviceId: device.id })
  if (networkRecovery) {
    const dropped = await evaluate(phone, `(() => { const sockets=__sockets.filter(socket=>socket.readyState===WebSocket.OPEN&&new URL(socket.url).pathname.startsWith('/api/ktv/media/rtc'));sockets.forEach(socket=>socket.close(4000,'owned test publisher interruption'));return sockets.length })()`)
    check(dropped === 1, 'fixture interrupts only the singer media signaling socket')
    await poll(() => evaluate(phone, "window.__micStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))"), 'publisher disconnect releases capture')
    check(await evaluate(phone, "!document.querySelector('[data-party-media-status]')?.textContent.includes('Sending live singing')"), 'interrupted publisher requires explicit fresh readiness instead of reconnecting')
  } else await click(phone, 'Stop streaming on this device')
  check(await evaluate(phone, "window.__micStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))"), 'stop releases the actual microphone immediately')
  await poll(async () => !(await provider.listParticipants(`ktv-${room.room.id}`)).some(item => item.identity === firstPublisher.identity), 'old publisher removed at SFU')
  check(db.prepare('SELECT state FROM ktv_media_grants WHERE identity = ?').get(firstPublisher.identity).state === 'revoked', 'provider removal commits terminal nonce revocation')
  const oldClaims = JSON.parse(Buffer.from(oldPublisherGrant.token.split('.')[1], 'base64url').toString())
  const denied = await fetch(origin + '/api/ktv/media/rtc/validate?access_token=' + encodeURIComponent(oldPublisherGrant.token))
  check(oldClaims.exp * 1000 > Date.now() && denied.status === 403, 'revoked unexpired room-issued publisher JWT cannot restore media access')
  check((await api(1, pathRoom)).playback.state === 'recovering', 'losing the publisher enters explicit room recovery')
  await click(host, 'Skip song')
  await poll(async () => { const current = await api(1, pathRoom); return current.playback.state === 'idle' && current.readiness.entryId !== request.queue[0].id }, 'skip commits before the next singer is invited')
  const nextRequest = await api(3, `${pathRoom}/queue`, { commandId: randomUUID(), songId: 1, title: 'Second live performer', requestNext: false, singerMemberId: nextSinger.self.id })
  view = await api(1, pathRoom)
  // The fair-turn sweep can offer the next singer between the read and write.
  for(let attempt=0;view.readiness.state==='idle'&&attempt<3;attempt++) {
    try { view = await api(1, `${pathRoom}/readiness/offer`, { commandId: randomUUID(), entryId: nextRequest.queue[0].id, clockId: view.clock.clockId, baseRevision: view.room.revision }) }
    catch(error) { if(error.code!=='REVISION_CONFLICT') throw error;view=await api(1,pathRoom) }
  }
  view = await poll(async () => { const current = await api(1, pathRoom); return current.readiness.entryId === nextRequest.queue[0].id && current.readiness.singerMemberId === nextSinger.self.id ? current : false }, 'correct next singer selection committed')
  await api(3, `${pathRoom}/readiness/respond`, { commandId: randomUUID(), clockId: view.readiness.clockId, performanceId: view.readiness.performanceId, generation: view.readiness.generation, baseRevision: view.room.revision, ready: true })
  const nextPhone = await page(3)
  await poll(() => evaluate(nextPhone, "[...document.querySelectorAll('label')].some(item => item.textContent.includes('I am using headphones'))"), 'next performer capture form')
  await evaluate(nextPhone, "[...document.querySelectorAll('label')].find(item => item.textContent.includes('I am using headphones')).querySelector('input').click()")
  await click(nextPhone, 'Enable microphone and prepare')
  await poll(() => evaluate(nextPhone, "document.querySelector('[data-party-media-status]')?.textContent.includes('Microphone ready')"), 'next microphone ready')
  await click(host, 'Stage · Next singer'); await click(host, 'Prepare selected song')
  await poll(async () => { const current=await api(1,pathRoom);return current.presence.devices.some(item=>item.memberId===nextSinger.self.id&&item.id===current.playback.stageDeviceId&&item.ready&&item.readyGeneration===current.playback.generation) }, 'replacement backing decoded')
  await click(host, 'Start countdown')
  await poll(() => evaluate(nextPhone, "document.querySelector('[data-party-media-status]')?.textContent.includes('Sending live singing')"), 'replacement publisher ready')
  const secondPublisher = db.prepare("SELECT * FROM ktv_media_grants WHERE scope = 'publisher' AND state = 'active'").get()
  check(secondPublisher.identity !== firstPublisher.identity && secondPublisher.member_id === nextSinger.self.id, 'a new singer gets a fresh nonce after old-provider acknowledgment')
  check(db.prepare("SELECT COUNT(*) total FROM ktv_media_grants WHERE scope = 'publisher' AND state != 'revoked'").get().total === 1, 'handover keeps one non-revoked publisher')
  await poll(() => evaluate(audience, "(() => { const video = document.querySelector('[data-party-media-screen] video'); return video?.srcObject?.getAudioTracks().length === 1 && video.srcObject.getVideoTracks().length === 1; })()"), 'audience receives replacement tracks')
  await poll(() => evaluate(audience, "document.querySelector('[data-party-media-screen] video')?.getVideoPlaybackQuality().totalVideoFrames >= 10"), 'replacement lyric video decodes ten frames')
  if(controlledPlayoutMs !== null)await poll(()=>evaluate(audience,`(${hasSingleAudienceOutput.toString()})()`),'fresh controlled handover output',15000)
  check(await evaluate(audience,`(${hasSingleAudienceOutput.toString()})()`), 'handover presents exactly one visible performance with one current native stream and decoded replacement video')
  if (handoverAv) {
    await installVideoObserver(audience)
    await measureAv('next-singer', nextPhone)
    await evaluate(audience, '__avObserver.stopRecording()')
  }
  await click(nextPhone, 'Stop streaming on this device')
  check(await evaluate(nextPhone, "window.__micStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))"), 'replacement capture also releases its microphone')
  if (routeHandover) {
    // Use a real common-screen capture device for venue turns, then route that
    // same screen to received remote media. Synthetic venue input contains only
    // 880 Hz: this detects duplicate digital backing, not acoustic leakage.
    async function skipAfterRemoval(previous) {
      await poll(async () => db.prepare('SELECT state FROM ktv_media_grants WHERE identity = ?').get(previous.identity)?.state === 'revoked', 'previous publisher revocation acknowledged')
      await poll(async () => !(await provider.listParticipants(`ktv-${room.room.id}`)).some(item => item.identity === previous.identity), 'previous publisher absent at provider')
      await click(host, 'Skip song')
      await poll(async () => (await api(1, pathRoom)).playback.state === 'idle', 'hybrid skip commits')
    }
    async function offerTurn(actor, member, title) {
      const queued = await api(actor, `${pathRoom}/queue`, { commandId: randomUUID(), songId: 1, title, requestNext: false, singerMemberId: member.id })
      let current = await api(1, pathRoom)
      // Automatic fair-turn selection can commit between this read and offer.
      // Refresh only a definitive revision conflict; each revised payload gets
      // a new command ID, as it does in the application's command journal.
      for(let attempt=0;current.readiness.state==='idle'&&attempt<3;attempt++) {
        try { current = await api(1, `${pathRoom}/readiness/offer`, { commandId: randomUUID(), entryId: queued.queue[0].id, clockId: current.clock.clockId, baseRevision: current.room.revision }) }
        catch(error) { if(error.code!=='REVISION_CONFLICT') throw error;current=await api(1,pathRoom) }
      }
      current = await poll(async () => { const value = await api(1, pathRoom); return value.readiness.entryId === queued.queue[0].id && value.readiness.singerMemberId === member.id ? value : false }, 'hybrid singer readiness offer')
      await api(actor, `${pathRoom}/readiness/respond`, { commandId: randomUUID(), clockId: current.readiness.clockId, performanceId: current.readiness.performanceId, generation: current.readiness.generation, baseRevision: current.room.revision, ready: true })
    }
    async function stopAudience(session) {
      if (await evaluate(session, "[...document.querySelectorAll('button')].some(item => item.textContent.trim() === 'Stop streaming on this device')")) await click(session, 'Stop streaming on this device')
      await poll(() => evaluate(session, "document.querySelectorAll('[data-party-media-screen] video').length === 0"), 'old audience player removed')
    }
    async function received(session, venue) {
      await poll(() => evaluate(session, "(() => { const video = document.querySelector('[data-party-media-screen] video'); return video?.srcObject?.getAudioTracks().length === 1 && video.srcObject.getVideoTracks().length === 1 && video.getVideoPlaybackQuality().totalVideoFrames >= 10; })()"), 'hybrid received audio and decoded lyric video')
      await verifyImpairedRoute(session)
      if(controlledPlayoutMs !== null)await poll(()=>evaluate(session,`(${hasSingleAudienceOutput.toString()})()`),'fresh controlled hybrid audience output',15000)
      check(await evaluate(session,`(${hasSingleAudienceOutput.toString()})()`), 'hybrid route has exactly one visible performance and current native stream')
      await evaluate(session, `(async () => {
        if (window.__routeContext) await __routeContext.close();
        const video = document.querySelector('[data-party-media-screen] video'); window.__routeContext = new AudioContext(); await __routeContext.resume();
        const source = __routeContext.createMediaStreamSource(video.srcObject); window.__routeAnalyser = __routeContext.createAnalyser(); __routeAnalyser.fftSize = 8192; __routeAnalyser.smoothingTimeConstant = 0;
        const silent = __routeContext.createGain(); silent.gain.value = 0; source.connect(__routeAnalyser); __routeAnalyser.connect(silent); silent.connect(__routeContext.destination);
      })()`)
      const peaks = await poll(async () => {
        const values = await evaluate(session, `(() => { const data = new Float32Array(__routeAnalyser.frequencyBinCount); __routeAnalyser.getFloatFrequencyData(data);
          return [440,880,1729].map(frequency => { const center = Math.round(frequency * __routeAnalyser.fftSize / __routeContext.sampleRate); const value = Math.max(...data.slice(center-2,center+3)); return Number.isFinite(value) ? value : -120; }); })()`)
        return values[1] > -55 && (venue ? values[0] < values[1] - 25 : values[0] > -55) ? values : false
      }, 'hybrid received spectrum')
      check(venue ? peaks[0] < peaks[1] - 25 && peaks[2] < peaks[1] - 25 : peaks[2] < Math.min(peaks[0], peaks[1]) - 25,
        venue ? 'venue input is published without adding digital backing or private vocals' : 'remote clean microphone and backing are present while private vocals stay absent')
    }
    async function startTurn(session, stageLabel, previous, member) {
      await click(session, 'Enable microphone and prepare')
      await poll(() => evaluate(session, "document.querySelector('[data-party-media-status]')?.textContent.includes('Microphone ready')"), 'hybrid capture ready')
      await click(host, stageLabel); await click(host, 'Prepare selected song')
      await poll(async()=>{const current=await api(1,pathRoom);return current.presence.devices.some(item=>item.memberId===member&&item.id===current.playback.stageDeviceId&&item.ready&&item.readyGeneration===current.playback.generation)},'hybrid backing decoded')
      await click(host, 'Start countdown')
      await poll(() => evaluate(session, "document.querySelector('[data-party-media-status]')?.textContent.includes('Sending live singing')"), 'hybrid provider acknowledges publisher')
      await poll(async () => (await api(1, pathRoom)).playback.state === 'playing', 'hybrid playing')
      const active = db.prepare("SELECT * FROM ktv_media_grants WHERE scope = 'publisher' AND state = 'active'").get()
      await verifyImpairedRoute(session)
      check(active.identity !== previous.identity && active.member_id === member && active.generation !== previous.generation && Boolean(active.ready_at), 'hybrid handover grants a fresh generation and provider-confirmed nonce')
      check(db.prepare("SELECT COUNT(*) total FROM ktv_media_grants WHERE scope = 'publisher' AND state != 'revoked'").get().total === 1, 'hybrid handover preserves one publisher after provider acknowledgment')
      return active
    }
    await skipAfterRemoval(secondPublisher)
    await stopAudience(audience)
    await evaluate(host, "(() => { const item = [...document.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === 'hybrid')); item.value = 'hybrid'; item.dispatchEvent(new Event('change', {bubbles:true})); })()")
    await poll(async () => (await api(1, pathRoom)).room.performanceMode === 'hybrid', 'hybrid mode committed')
    await offerTurn(2, singer.self, 'First venue turn')
    await poll(() => evaluate(audience, "[...document.querySelectorAll('select')].some(item => [...item.options].some(option => option.value === 'venue-mix'))"), 'venue capture option')
    await evaluate(audience, "(() => { const item = [...document.querySelectorAll('select')].find(item => [...item.options].some(option => option.value === 'venue-mix')); item.value = 'venue-mix'; item.dispatchEvent(new Event('change', {bubbles:true})); })()")
    await click(host, 'Watch and listen')
    const venuePublisher = await startTurn(audience, 'Stage · Host', secondPublisher, room.self.id)
    check(await evaluate(audience, 'window.__sourceEvidence.some(item => item.frequency > 400 && item.frequency < 480)'), 'venue common screen renders local instrumental for the room')
    await received(host, true)
    await click(audience, 'Stop streaming on this device')
    check(await evaluate(audience, "window.__micStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))"), 'venue-to-remote handover immediately releases venue capture')
    await skipAfterRemoval(venuePublisher)
    await offerTurn(3, nextSinger.self, 'Hybrid remote turn')
    const previousStageSources = await evaluate(audience, 'window.__sourceEvidence.length')
    await click(audience, 'Watch and listen')
    const remotePublisher = await startTurn(nextPhone, 'Stage · Next singer', venuePublisher, nextSinger.self.id)
    await received(audience, false)
    check(await evaluate(audience, 'window.__bufferSources.every(item => !item.__state.started || item.__state.ended || (item.__state.stopAt !== null && item.__state.stopAt <= item.__state.context.currentTime))'), 'all previous venue backing sources have stopped before remote media plays')
    check(await evaluate(audience, 'window.__sourceEvidence.length') === previousStageSources, 'venue common screen switches to received remote media without restarting local backing')
    if (handoverAv) {
      await installVideoObserver(audience)
      await measureAv('venue-to-remote', nextPhone)
      await evaluate(audience, '__avObserver.stopRecording()')
    }
    await click(nextPhone, 'Stop streaming on this device'); await skipAfterRemoval(remotePublisher)
    await offerTurn(2, singer.self, 'Return venue turn')
    await stopAudience(audience)
    const returnPublisher = await startTurn(audience, 'Stage · Host', remotePublisher, room.self.id)
    await received(host, true)
    check(await evaluate(audience, 'window.__sourceEvidence.length') > previousStageSources, 'remote-to-venue handover restores native local backing on the common screen')
    await click(audience, 'Stop streaming on this device')
    await poll(async () => db.prepare('SELECT state FROM ktv_media_grants WHERE identity = ?').get(returnPublisher.identity)?.state === 'revoked', 'final venue publisher revoked')
    check(db.prepare("SELECT COUNT(*) total FROM ktv_media_grants WHERE scope = 'publisher' AND state != 'revoked'").get().total === 0, 'hybrid journey leaves no publisher capability active')
  }
  // Collect both phases before judging timing: a baseline failure must remain
  // a failed run, while still exposing the impaired measurements for diagnosis.
  if (senderKeyframePage) {
    const state = await evaluate(senderKeyframePage, 'window.__avSenderKeyframes.snapshot()')
    console.log('Private native sender keyframe requests:', JSON.stringify(state))
    check(state.requests > 0 && state.fulfilled > 0 && [null, 'sender-ended'].includes(state.failure),
      'native sender keyframe requests complete without encoder or policy failure')
    if (demandKeyframes) {
      console.log('Private demand recovery encoded responses:', recoveryEncoded)
      check(recoveryEncoded > 0, 'demand recovery observes actual newly encoded keyframes after requests')
    }
  }
  // Production also has to retain nominal quality. The pinned SDK defaults to
  // VP8; comparison artifacts declare their own expected codec explicitly.
  const expectedCodec=codecExperiment?.codec || 'vp8'
  const codecQualities=avMeasurements.map(measurement=>
    analyseCodecQuality(avTimingSamples,measurement.phase,expectedCodec,(senderKeyframeMs??codecExperiment?.keyframeMs??null)))
  for (const quality of codecQualities) console.log('Native codec quality:',JSON.stringify(quality))
  if(controlledPlayoutMs !== null)for(const phase of new Set(avTimingSamples.map(item=>item.phase))) {
    const quality=analyseControlledReceiverQuality(avTimingSamples,phase)
    console.log('Controlled native presentation quality:',JSON.stringify(quality))
    check(quality.errors.length===0,`${phase} controlled native presentation retains nominal 1280x720 and 20–30 fps within buffer bounds`)
  }
  for (const quality of codecQualities) {
    check(quality.errors.length===0,`${quality.phase} preserves actual 1280x720 and nominal measured source/receiver cadence`)
  }
  for(const result of avMeasurements) check(result.absoluteSkewMs.p95<=150&&result.absoluteSkewMs.max<=250, `${result.phase} received audio/video marker presentation skew passes the 150 ms p95 / 250 ms maximum software target`)
  }
  check(errors.length === 0, `no browser runtime exceptions (${errors.length})`)
  if(absoluteCapture) for(const session of sessionSockets.keys()) {
    const evidence=await evaluate(session,'({supported:__absoluteCaptureExperiment.supported,configured:__absoluteCaptureExperiment.configured,missing:__absoluteCaptureExperiment.missing,failures:__absoluteCaptureExperiment.failures,evidence:__absoluteCaptureExperiment.evidence})')
    console.log('Private absolute capture negotiation:',JSON.stringify(evidence))
    check(evidence.failures===0,'native absolute capture negotiation has no failed API requests')
  }
  if(controlledPlayoutMs !== null)for(const session of sessionSockets.keys()) {
    const evidence=await evaluate(session,'__controlledReceiver.snapshot()')
    console.log('Private controlled receiver evidence:',JSON.stringify(evidence))
    check([evidence.active,...evidence.history].filter(Boolean).every(item=>!item.error&&
      item.maximumBytes<=64*1024*1024&&item.maximumQueued<=40),
      'controlled receiver keeps native frame/byte bounds without clock or renderer failure')
  }
  if(encodedTiming) {
    console.log('Private encoded API selection:',encodedApi)
    const observed=[]
    for(const session of sessionSockets.keys()) {
      const evidence=await evaluate(session,'({records:__encodedTimingProbe.records,states:__encodedTimingProbe.states,errors:__encodedTimingProbe.errors,features:__encodedTimingProbe.features,failures:__encodedTimingProbe.failures,wrappedSenders:__encodedTimingProbe.wrappedSenders,workerCount:__encodedTimingProbe.workerCount})')
      console.log('Native encoded timing evidence:',JSON.stringify(evidence))
      console.log('Native RTP capture clock study:',JSON.stringify(analyseCaptureClocks(evidence.records)))
      check(evidence.errors===0,'encoded timing observers forward native frames without errors')
      observed.push(...evidence.records)
    }
    for(const direction of ['send','receive'])for(const kind of ['audio','video'])
      check(observed.filter(row=>row.direction===direction&&row.kind===kind&&Number.isFinite(row.rtpTimestamp)).length>=8,
        `native ${direction} ${kind} observation contains actual frame timestamps`)
    if(absoluteCapture)for(const kind of ['audio','video'])
      check(observed.filter(row=>row.direction==='receive'&&row.kind===kind&&Number.isFinite(row.values.captureTime)).length>=8,
        `received ${kind} exposes actual capture timestamps through the SFU`)
  }
  console.log(`${passed} built-app streaming checks passed. Client: ${clientLocation}; synthetic microphone, foreground Chrome, isolated policy/SFU. Remote HTTP/CDP use loopback SSH forwards; physical and distinct access-network acceptance remains open.`)
} catch (error) {
  console.error('Journey failure:', error.message)
  if(avTimingSamples.length) console.error('A/V timing timeline on failure:',JSON.stringify(avTimingSamples))
  for(const phase of new Set(avTimingSamples.map(item=>item.phase)))
    console.error('Native codec quality on failure:',JSON.stringify(analyseCodecQuality(avTimingSamples,phase,codecExperiment?.codec || 'vp8',(senderKeyframeMs??codecExperiment?.keyframeMs??null))))
  if(controlledPlayoutMs !== null)for(const phase of new Set(avTimingSamples.map(item=>item.phase)))
    console.error('Controlled native presentation quality on failure:',JSON.stringify(analyseControlledReceiverQuality(avTimingSamples,phase)))
  if(avBrowser) console.error('Private receiver output:',JSON.stringify(await avBrowser.audioEvidence().catch(()=>({error:'capture unavailable'}))))
  if(mediaProxy) console.error('Owned media proxy:',JSON.stringify(mediaProxy.snapshot()))
  console.error('Playback recovery:',JSON.stringify(db.prepare('SELECT state,recovery_reason FROM ktv_playback').all()))
  console.error('Runtime exception count:', errors.length)
  if(controlledPlayoutMs !== null)for(const session of sessionSockets.keys()) console.error('Private controlled receiver on failure:',
    JSON.stringify(await evaluate(session,'__controlledReceiver.snapshot()').catch(()=>({unavailable:true}))))
  if(encodedTiming) for(const session of sessionSockets.keys()) {
    const evidence=await evaluate(session,'({records:__encodedTimingProbe.records,states:__encodedTimingProbe.states,errors:__encodedTimingProbe.errors,features:__encodedTimingProbe.features,failures:__encodedTimingProbe.failures,wrappedSenders:__encodedTimingProbe.wrappedSenders,workerCount:__encodedTimingProbe.workerCount})').catch(()=>({unavailable:true}))
    console.error('Native encoded timing on failure:',JSON.stringify(evidence))
    if(evidence.records) console.error('Native RTP capture clock study on failure:',JSON.stringify(analyseCaptureClocks(evidence.records)))
  }
  const known=['AV_VIDEO_EVIDENCE_LIMIT','AV_MARKER_ID_LIMIT','AV_STATS_SENDER_LIMIT','AV_STATS_PEER_LIMIT',
    'TypeError','RangeError','ReferenceError','NetworkError','AbortError','InvalidStateError','OperationError']
  console.error('Runtime error categories:',JSON.stringify(errors.slice(0,8).map(message=>known.find(code=>message.includes(code))||'RuntimeError')))
  console.error('Media HTTP status (paths only):', JSON.stringify(mediaHttp))
  for (const session of sessionSockets.keys()) console.error('UI state:', JSON.stringify(await evaluate(session, ` (async () => ({status:document.querySelector('[data-party-media-status]')?.textContent,encodedLeaseEvents:window.__encodedLeaseEvents,publisherFeedback:window.__publisherRembExperiment?.snapshot(),senderKeyframes:window.__avSenderKeyframes?.snapshot(),
    errors:[...document.querySelectorAll('[role=alert]')].map(item=>item.textContent), diagnostics:[...document.querySelectorAll('dl')].map(item=>item.textContent),
    av:window.__avObserver?.evidence,avSources:window.__avSources,phase:window.__phaseEvidence,clocks:window.__partyClocks,playbacks:window.__partyPlaybacks,gains:window.__gainNodes.map(node=>({gain:node.gain.value,context:window.__contexts.indexOf(node.context),automation:node.__automation})),receivedPeaks:window.__analyser?(()=>{const data=new Float32Array(__analyser.frequencyBinCount);__analyser.getFloatFrequencyData(data);return [440,660,880].map(frequency=>{const center=Math.round(frequency*__analyser.fftSize/__receiveContext.sampleRate);const value=Math.max(...data.slice(center-2,center+3));return Number.isFinite(value)?value:-120})})():null,ice:window.__iceEvidence, output:window.__outputEvidence, sources:window.__sourceEvidence, contexts:window.__contexts.map(item=>({state:item.state,time:item.currentTime})), canvas:[...document.querySelectorAll('canvas')].map(item=>({width:item.width,height:item.height,connected:item.isConnected})),
    video:[...document.querySelectorAll('video')].map(item=>({width:item.videoWidth,height:item.videoHeight,ready:item.readyState,paused:item.paused,muted:item.muted,tracks:item.srcObject?.getTracks().map(track=>({kind:track.kind,state:track.readyState,muted:track.muted,settings:track.getSettings()}))})),
    rtc:await Promise.all(window.__peers.map(async peer=>({state:peer.connectionState,tracks:[...await peer.getStats()].map(([,item])=>item).filter(item=>['inbound-rtp','outbound-rtp'].includes(item.type)).map(item=>({kind:item.kind,type:item.type,bytes:item.bytesSent??item.bytesReceived,frames:item.framesEncoded??item.framesDecoded,framesReceived:item.framesReceived,framesDropped:item.framesDropped}))})))
  }))()` ).catch(() => ({}))))
  throw error
} finally {
  if(controlledPlayoutMs !== null)for(const session of sessionSockets.keys()) await evaluate(session,'__controlledReceiver?.close()').catch(()=>{})
  if(encodedTiming) for(const session of sessionSockets.keys()) await evaluate(session,'__encodedTimingProbe?.close()').catch(()=>{})
  if (senderKeyframePage) await evaluate(senderKeyframePage, 'window.__avSenderKeyframes?.close()').catch(() => {})
  if (nativeSyncAudience) await evaluate(nativeSyncAudience, 'window.__avNativeSync?.close()').catch(() => {})
  for (const { socket, browserContextId } of contexts) if (socket.readyState === WebSocket.OPEN) await cdp(socket, 'Target.disposeBrowserContext', { browserContextId }).catch(() => {})
  for (const socket of debuggerSockets) socket.close()
  for(const ownedBrowser of [hostBrowser,avBrowser,remoteBrowser]) if (ownedBrowser) await ownedBrowser.close().catch(() => {
    console.error('Owned remote browser cleanup was not verified; its 15-minute watchdog remains bounded')
    process.exitCode = 1
  })
  for (const child of [chrome]) if (child && child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit'); child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 1000)
    try { await ended.catch(() => {}) } finally { clearTimeout(timer) }
  }
  if (mediaProxy) await mediaProxy.close()
  if (worker) await worker.close().catch(() => {})
  realtime?.close()
  for (const socket of ownedTcp) socket.destroy()
  for (const server of [frontend, backend]) if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  if (running) await exec('docker', ['rm', '-f', container]).catch(() => {})
  if (pulseModule) await exec('pactl', ['unload-module', pulseModule]).catch(() => {})
  db.close(); await fs.rm(root, { recursive: true, force: true })
}
