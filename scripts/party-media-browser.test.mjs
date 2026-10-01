// Owned loopback-only SFU spike. Synthetic tracks test real WebRTC transport and
// guide isolation; this does not measure physical microphones or internet TURN.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import ts from 'typescript'
import express from '../server/node_modules/express/index.js'
import WebSocket from '../server/node_modules/ws/wrapper.mjs'
import { AccessToken, RoomServiceClient, TrackSource } from '../server/node_modules/livekit-server-sdk/dist/index.js'
import { createKtvMediaGateway } from '../server/ktv-media-gateway.js'

const exec = promisify(execFile), root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-media-spike-'))
const container = `ktv-party-sfu-spike-${randomUUID().slice(0, 8)}`
const image = 'livekit/livekit-server:v1.13.7@sha256:6fd3b7088874c4d119160dd688798dfec852bc014786d392caad15f6f63912a3'
const apiKey = 'ktv-spike', apiSecret = randomBytes(32).toString('hex'), roomName = `ktv-spike-${randomUUID()}`
const upstreamUrl = 'http://127.0.0.1:17880', fatal = []
const provider = new RoomServiceClient(upstreamUrl, apiKey, apiSecret, { requestTimeout: 3, failover: false })
let db = new DatabaseSync(path.join(root, 'grants.db'))
db.exec(`CREATE TABLE grants (identity TEXT PRIMARY KEY, scope TEXT NOT NULL, generation INTEGER, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE room_state (generation INTEGER NOT NULL, closed INTEGER NOT NULL DEFAULT 0, active_publisher TEXT);
  INSERT INTO room_state VALUES (1, 0, NULL);`)
const app = express(), contexts = [], sockets = [], pending = new Map(), sessions = new Map()
let gateway, server, origin, leaseTimer, nextId = 0, passed = 0, running = false
const check = (condition, label) => { assert.ok(condition, label); passed++; console.log(`PASS ${label}`) }
const poll = async (work, label, timeout = 20000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await work(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(`Timed out: ${label}`)
}
function cdp(socket, method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}
async function connectDebugger(endpoint) {
  const info = await (await fetch(`${endpoint}/json/version`)).json(), socket = new WebSocket(info.webSocketDebuggerUrl)
  sockets.push(socket); await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  socket.on('message', raw => { const packet = JSON.parse(raw); if (!packet.id) return; const item = pending.get(packet.id); if (!item) return
    pending.delete(packet.id); packet.error ? item.reject(new Error(packet.error.message)) : item.resolve(packet.result) })
  return socket
}
async function page(socket) {
  const { browserContextId } = await cdp(socket, 'Target.createBrowserContext'); contexts.push({ socket, browserContextId })
  const { targetId } = await cdp(socket, 'Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await cdp(socket, 'Target.attachToTarget', { targetId, flatten: true }); sessions.set(sessionId, socket)
  await cdp(socket, 'Page.enable', {}, sessionId); await cdp(socket, 'Runtime.enable', {}, sessionId)
  await cdp(socket, 'Page.addScriptToEvaluateOnNewDocument', { source: `window.__relayPeers = [];
    const NativePeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeer { constructor(...args) { super(...args); window.__relayPeers.push(this) } };` }, sessionId)
  await cdp(socket, 'Page.navigate', { url: origin }, sessionId)
  await poll(() => evaluate(sessionId, '!!window.LivekitClient && !!window.PartyPublishGraph && !!window.PartyLyricCapture'), 'media fixture loaded')
  return sessionId
}
async function evaluate(sessionId, expression) {
  const result = await cdp(sessions.get(sessionId), 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function token(identity, scope, generation = 1) {
  db.prepare('INSERT INTO grants VALUES (?, ?, ?, ?, 0)').run(identity, scope, generation, Date.now() + 120000)
  return renewedToken(identity, scope)
}
async function renewedToken(identity, scope, overrides = {}) {
  const access = new AccessToken(apiKey, apiSecret, { identity, ttl: 120 })
  access.addGrant({ roomJoin: true, room: roomName, canPublish: scope === 'publisher', canSubscribe: scope === 'audience',
    canPublishData: false, canPublishSources: scope === 'publisher' ? [TrackSource.MICROPHONE, TrackSource.CAMERA] : [], ...overrides })
  return access.toJwt()
}
const roomScript = (url, credential, relay = false) => `(() => {
  const { Room, RoomEvent, Track } = LivekitClient;
  window.room = new Room({ adaptiveStream: false, dynacast: false }); window.received = []; window.unsubscribed = 0;
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    const element = track.attach(); element.autoplay = true; element.playsInline = true; document.body.appendChild(element);
    window.received.push({ track, publication, participant, element });
    if (track.kind === Track.Kind.Audio) {
      window.receiveContext = new AudioContext(); receiveContext.resume();
      const source = receiveContext.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
      window.analyser = receiveContext.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0;
      const silent = receiveContext.createGain(); silent.gain.value = 0;
      source.connect(analyser); analyser.connect(silent); silent.connect(receiveContext.destination);
    }
  });
  room.on(RoomEvent.TrackUnsubscribed, track => { window.unsubscribed++; for (const element of track.detach()) element.remove(); });
  return room.connect(${JSON.stringify(url)}, ${JSON.stringify(credential)}, ${relay ? "{rtcConfig:{iceTransportPolicy:'relay'}}" : '{}'}).then(() => room.startAudio());
})()`
const energies = session => evaluate(session, `(() => {
  if (!window.analyser) return null;
  const bins = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(bins);
  return [440, 880, 1760].map(hz => {
    const center = Math.round(hz * analyser.fftSize / receiveContext.sampleRate);
    return Math.max(...bins.slice(center - 3, center + 4));
  });
})()`)
try {
  const turnRoot = path.join(root, 'turn'); await fs.mkdir(turnRoot, { mode: 0o700 })
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=turn.localhost',
    '-keyout', path.join(turnRoot, 'key.pem'), '-out', path.join(turnRoot, 'cert.pem')])
  await fs.chmod(path.join(turnRoot, 'key.pem'), 0o600)
  await fs.writeFile(path.join(root, 'livekit.yaml'), `port: 17880\nbind_addresses: [127.0.0.1]\nlog_level: warn\nrtc:\n  tcp_port: 17881\n  udp_port: 17882\n  node_ip: 127.0.0.1\n  use_external_ip: false\n  enable_loopback_candidate: true\n  interfaces:\n    includes: [lo]\nturn:\n  enabled: true\n  domain: turn.localhost\n  udp_port: 17884\n  tls_port: 17885\n  cert_file: /run/turn/cert.pem\n  key_file: /run/turn/key.pem\n  relay_range_start: 17886\n  relay_range_end: 17898\n  allow_restricted_peer_cidrs: [127.0.0.0/8]\nkeys:\n  ${apiKey}: ${apiSecret}\nroom:\n  max_participants: 6\n`, { mode: 0o600 })
  await exec('docker', ['run', '-d', '--name', container, '--network', 'host', '--user', `${process.getuid()}:${process.getgid()}`, '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '-v', `${root}/livekit.yaml:/etc/livekit.yaml:ro`, '-v', `${turnRoot}:/run/turn:ro`, image, '--config', '/etc/livekit.yaml'])
  running = true
  await poll(async () => { try { await provider.listRooms(); return true } catch { return false } }, 'owned SFU starts')
  await provider.createRoom({ name: roomName, maxParticipants: 6 })
  const authorize = claims => {
    const grant = db.prepare('SELECT * FROM grants WHERE identity = ?').get(claims.sub)
    const state = db.prepare('SELECT * FROM room_state').get()
    if (!grant || grant.revoked || grant.expires <= Date.now() || state.closed || (grant.scope === 'publisher' && (grant.generation !== state.generation || grant.identity !== state.active_publisher))) return null
    return { identity: grant.identity, scope: grant.scope, room: roomName }
  }
  const removeParticipant = async (room, identity) => { try { await provider.removeParticipant(room, identity) } catch (error) { if (error.code !== 'not_found') throw error } }
  gateway = createKtvMediaGateway({ upstreamUrl, apiKey, apiSecret, authorize, removeParticipant,
    allowedOrigin: value => !value || value === origin, onFatal: async error => { fatal.push(error.message); await exec('docker', ['stop', container]).catch(() => {}) } })
  app.use('/api/ktv/media', (req, res) => { req.url = '/api/ktv/media' + req.url; void gateway.http(req, res) })
  app.get('/sdk.js', (req, res) => res.sendFile(path.resolve('node_modules/livekit-client/dist/livekit-client.umd.js')))
  const graphSource = await fs.readFile('src/services/partyPublishGraph.ts', 'utf8')
  const graphJs = ts.transpileModule(graphSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  app.get('/graph.js', (req, res) => res.type('text/javascript').send(graphJs))
  const lyricsJs = ts.transpileModule(await fs.readFile('src/utils/lyricsTiming.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  const captureJs = ts.transpileModule(await fs.readFile('src/services/partyLyricCapture.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace("'@/utils/lyricsTiming'", "'/lyrics-timing.js'")
  app.get('/lyrics-timing.js', (req, res) => res.type('text/javascript').send(lyricsJs))
  app.get('/capture.js', (req, res) => res.type('text/javascript').send(captureJs))
  app.get('/', (req, res) => res.type('html').send('<!doctype html><html><body><script src="/sdk.js"></script><script type="module">import { PartyPublishGraph } from "/graph.js"; import { PartyLyricCapture } from "/capture.js"; window.PartyPublishGraph = PartyPublishGraph; window.PartyLyricCapture = PartyLyricCapture;</script></body></html>'))
  server = app.listen(0, '127.0.0.1'); server.on('upgrade', (req, socket, head) => void gateway.upgrade(req, socket, head))
  await new Promise(resolve => server.once('listening', resolve)); origin = `http://127.0.0.1:${server.address().port}`
  const signalUrl = origin + '/api/ktv/media'
  const publisherId = randomUUID(), audienceId = randomUUID(), otherId = randomUUID(), relayId = randomUUID()
  const publisherToken = await token(publisherId, 'publisher'), audienceToken = await token(audienceId, 'audience'), otherToken = await token(otherId, 'audience')
  db.prepare('UPDATE room_state SET active_publisher = ?').run(publisherId)
  const renewServerLease = () => db.prepare(`UPDATE grants SET expires = ? WHERE identity = (SELECT active_publisher FROM room_state) AND revoked = 0 AND generation = (SELECT generation FROM room_state)`).run(Date.now() + 5000)
  renewServerLease(); leaseTimer = setInterval(renewServerLease, 500)
  const publisherSocket = await connectDebugger(process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9231')
  const audienceSocket = await connectDebugger(process.env.CHROME_SINGER_DEBUG_URL || 'http://127.0.0.1:9230')
  const publisher = await page(publisherSocket), audience = await page(audienceSocket), other = await page(audienceSocket)
  await evaluate(audience, roomScript(signalUrl, audienceToken)); await evaluate(other, roomScript(signalUrl, otherToken))
  await evaluate(publisher, roomScript(signalUrl, publisherToken))
  check(await evaluate(audience, 'room.localParticipant.permissions.canPublish === false'), 'SFU audience joins with no publishing permission')
  check(await evaluate(publisher, 'room.localParticipant.permissions.canSubscribe === false'), 'Publisher cannot subscribe to independent room audio')
  const publish = generation => evaluate(publisher, `(async () => {
    const context = new AudioContext(); await context.resume(); window.publishContext = context;
    const tone = hz => { const source = context.createOscillator(), level = context.createGain(); source.frequency.value = hz; level.gain.value = 0.1; source.connect(level); source.start(); return level; };
    const backing = tone(440), micOutput = context.createMediaStreamDestination(); tone(880).connect(micOutput);
    const guide = tone(1760), guideMonitor = context.createGain(); guideMonitor.gain.value = 0.7; guide.connect(guideMonitor); guideMonitor.connect(context.destination);
    window.graph = new PartyPublishGraph(context, backing, micOutput.stream, { clockId: 'spike', performanceId: 'performance', generation: ${generation} });
    const renew = () => graph.renew({ clockId: 'spike', performanceId: 'performance', generation: ${generation}, expiresServerMs: performance.now() + 4000 },
      { clockId: 'spike', status: 'healthy', offsetMs: 0, uncertaintyMs: 1 }); renew(); window.renewTimer = setInterval(renew, 500);
    await room.localParticipant.publishTrack(graph.stream.getAudioTracks()[0], { name: 'performance-mix', source: LivekitClient.Track.Source.Microphone });
    const canvas = document.createElement('canvas'); document.body.appendChild(canvas); window.lyricCanvas = canvas;
    window.lyricCapture = new PartyLyricCapture(canvas, () => performance.now() < graph.diagnostics.expiresServerMs - 100 ?
      { title: 'Captured performance', singer: 'Synthetic singer', renderPositionMs: context.currentTime * 1000,
        backingDelayMs: 0, lyricOffsetMs: 0, lines: [{ time: 0, text: 'First line' }, { time: 2, text: 'Second line' }] } : null);
    await room.localParticipant.publishTrack(lyricCapture.stream.getVideoTracks()[0], { name: 'performance-lyrics', source: LivekitClient.Track.Source.Camera,
      simulcast: false, videoEncoding: { maxBitrate: 350000, maxFramerate: 25 } });
  })()`)
  await publish(1)
  await poll(async () => { const values = await energies(audience); return values && values[0] > -50 && values[1] > -50 }, 'received backing plus mic')
  for (const [session, label] of [[audience, 'first'], [other, 'second']]) {
    const values = await poll(async () => { const value = await energies(session); return value && value[0] > -50 && value[1] > -50 && value }, `${label} audience audio`)
    check(values[2] < Math.min(values[0], values[1]) - 25, `${label} audience receives backing and mic with no private guide tone`)
    await poll(() => evaluate(session, "received.some(item => item.track.kind === 'video' && item.element.videoWidth > 0 && item.element.getVideoPlaybackQuality().totalVideoFrames > 3)"), 'received captured lyric video')
    check(true, `${label} audience decodes the publisher’s captured lyric video`)
  }
  const relayToken = await token(relayId, 'audience'), relayAudience = await page(audienceSocket)
  await evaluate(relayAudience, roomScript(signalUrl, relayToken, true))
  await poll(() => evaluate(relayAudience, "received.some(item => item.track.kind === 'audio') && received.some(item => item.track.kind === 'video')"), 'forced-relay audience receives both tracks')
  const selectedRelay = await poll(() => evaluate(relayAudience, `(async () => {
    for (const peer of window.__relayPeers) {
      const entries = [...await peer.getStats()].map(([, item]) => item), transport = entries.find(item => item.type === 'transport' && item.selectedCandidatePairId);
      const active = entries.find(item => item.id === transport?.selectedCandidatePairId) || entries.find(item => item.type === 'candidate-pair' && item.selected);
      const local = entries.find(item => item.id === active?.localCandidateId);
      if (local?.candidateType === 'relay') return { type: local.candidateType, protocol: local.protocol };
    }
    return false;
  })()`), 'selected relay candidate')
  check(selectedRelay.type === 'relay', `embedded TURN carries a forced-relay audience (${selectedRelay.protocol})`)
  await evaluate(publisher, 'graph.setMonitorVolume(0)')
  const afterMonitor = await poll(async () => { const value = await energies(audience); return value && value[0] > -50 && value }, 'independent publish levels')
  check(afterMonitor[0] > -50 && afterMonitor[1] > -50, 'Muting the singer monitor leaves the received performance mix audible')
  const denied = await evaluate(audience, `(async () => { const ctx = new AudioContext(); await ctx.resume(); const destination = ctx.createMediaStreamDestination();
    try { await room.localParticipant.publishTrack(destination.stream.getAudioTracks()[0], { source: LivekitClient.Track.Source.Microphone }); return false }
    catch { return true } finally { await ctx.close() } })()`)
  check(denied, 'SFU rejects an audience attempt to publish an audio track')
  await evaluate(publisher, 'clearInterval(renewTimer)')
  await poll(async () => { const value = await energies(audience); return value && value[0] < -65 && value[1] < -65 }, 'render-thread publish expiry', 10000)
  check(true, 'Expired publishing permission silences received backing and mic without a room command')
  await poll(() => evaluate(audience, `(() => {
    const video = received.find(item => item.track.kind === 'video')?.element;
    if (!video?.videoWidth) return false;
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, 640, 360);
    const bytes = ctx.getImageData(0, 0, 640, 360).data;
    let green = 0; for (let i = 0; i < bytes.length; i += 4) if (bytes[i + 1] > bytes[i] * 1.4 && bytes[i + 1] > bytes[i + 2] * 1.2) green++;
    return green < 10;
  })()`), 'expired captured video blank')
  check(true, 'Captured lyrics go blank when the publisher’s permission expires')
  db.prepare('UPDATE grants SET revoked = 1 WHERE identity = ?').run(publisherId)
  await gateway.revoke({ identity: publisherId, room: roomName })
  await poll(() => evaluate(audience, 'window.unsubscribed >= 2'), 'publisher revocation acknowledged')
  check(true, 'Provider removal stops both published tracks for the audience')
  const refreshedPublisher = await renewedToken(publisherId, 'publisher')
  for (const credential of [publisherToken, refreshedPublisher]) {
    const response = await fetch(signalUrl + '/rtc/validate?access_token=' + encodeURIComponent(credential))
    check(response.status === 403, 'Gateway denies a revoked identity even with a valid or refreshed JWT')
  }
  db.prepare('UPDATE room_state SET generation = 2').run()
  const staleId = randomUUID(), staleToken = await token(staleId, 'publisher', 1)
  check((await fetch(signalUrl + '/rtc/validate?access_token=' + encodeURIComponent(staleToken))).status === 403, 'A previous generation cannot join as publisher under the new performance')
  await evaluate(publisher, 'graph.close(); lyricCapture.close(); publishContext.close(); room.disconnect()')
  const replacementId = randomUUID(), replacementToken = await token(replacementId, 'publisher', 2)
  db.prepare('UPDATE room_state SET active_publisher = ?').run(replacementId); renewServerLease()
  await evaluate(publisher, roomScript(signalUrl, replacementToken)); await publish(2)
  await poll(() => evaluate(other, `received.some(item => item.participant.identity === '${replacementId}' && item.track.kind === 'audio' && item.element.isConnected)`), 'replacement performance reaches audience')
  const participants = await provider.listParticipants(roomName)
  check(participants.filter(item => item.permission.canPublish).length === 1 && participants.some(item => item.identity === replacementId), 'Provider admits exactly one fresh publisher after the old removal acknowledgment')
  const replacementAudio = await poll(async () => { const value = await energies(other); return value && value[0] > -50 && value[1] > -50 && value }, 'replacement performance mix')
  check(replacementAudio[2] < Math.min(replacementAudio[0], replacementAudio[1]) - 25, 'Fresh performer handover preserves private-guide exclusion')
  const nonselectedToken = await token(randomUUID(), 'publisher', 2)
  check((await fetch(signalUrl + '/rtc/validate?access_token=' + encodeURIComponent(nonselectedToken))).status === 403, 'A nonselected identity cannot publish even with a valid current-generation token')
  clearInterval(leaseTimer); leaseTimer = null
  await poll(async () => !(await provider.listParticipants(roomName)).some(item => item.identity === replacementId), 'server publisher lease expires', 10000)
  check(true, 'Server lease expiry removes a publisher even while its client keeps renewing the local audio gate')
  db.prepare('UPDATE grants SET revoked = 1 WHERE identity = ?').run(audienceId)
  await gateway.revoke({ identity: audienceId, room: roomName })
  await evaluate(audience, 'room.disconnect()')
  await evaluate(audience, roomScript(upstreamUrl, audienceToken))
  check(await evaluate(audience, "room.state === 'connected'"), 'Negative control: raw self-hosted SFU accepts an old removed-participant token')
  await removeParticipant(roomName, audienceId); await evaluate(audience, 'room.disconnect()')
  db.close(); db = new DatabaseSync(path.join(root, 'grants.db'))
  const deniedAfterReopen = await fetch(signalUrl + '/rtc/validate?access_token=' + encodeURIComponent(audienceToken))
  check(deniedAfterReopen.status === 403, 'Persisted revocation survives reopening the grant database')
  db.prepare('UPDATE room_state SET closed = 1').run()
  await poll(async () => (await provider.listParticipants(roomName)).length === 0, 'closed room has no SFU participants')
  check(true, 'Closing the media room removes every provider participant')
  check(fatal.length === 0, 'Media control path completes without supervisor failure')
  console.log(`${passed} loopback SFU checks passed. Synthetic media only; physical A/V alignment, public TURN and room integration remain open.`)
} catch (error) {
  if (running) {
    const logs = await exec('docker', ['logs', container]).catch(() => ({ stdout: '', stderr: 'Owned SFU already stopped' }))
    console.error('Owned SFU diagnostics:', (logs.stdout + logs.stderr).replaceAll(apiSecret, '[redacted]').slice(-6000))
  }
  throw error
} finally {
  if (leaseTimer) clearInterval(leaseTimer)
  await gateway?.close()
  for (const { socket, browserContextId } of contexts) await cdp(socket, 'Target.disposeBrowserContext', { browserContextId }).catch(() => {})
  for (const socket of sockets) socket.close()
  if (running) await exec('docker', ['rm', '-f', container]).catch(() => {})
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  db.close(); await fs.rm(root, { recursive: true, force: true })
}
