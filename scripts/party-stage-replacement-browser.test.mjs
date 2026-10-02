// Built app + actual room backend + two owned native Chrome/Pulse outputs.
// Digital fixture evidence only: physical speakers/mobile acceptance stay open.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import express from '../server/node_modules/express/index.js'
import WebSocket from '../server/node_modules/ws/wrapper.mjs'
import { initDb } from '../server/db.js'
import { registerKtvRoutes } from '../server/ktv-routes.js'
import { createKtvAssets } from '../server/ktv-assets.js'
import { createKtvClock } from '../server/ktv-clock.js'
import { createOwnedRemoteBrowser } from './party-remote-browser.mjs'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-stage-replacement-'))
const db = initDb(root), app = express(), clock = createKtvClock()
const browsers = [], sockets = [], contexts = [], connections = new Set(), errors = []
const sessionSockets = new Map(), pending = new Map(), stalls = new Map()
let server, realtime, origin, roomPath, stallTask, nextId = 0, passed = 0
const check = (value, label) => { assert.ok(value, label); passed++; console.log('PASS', label) }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function poll(work, label, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await work(); if (value) return value; await wait(100) }
  throw new Error(`Timed out: ${label}`)
}
function cdp(socket, method, params = {}, sessionId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, timeoutMs)
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value) }, reject(error) { clearTimeout(timer); reject(error) } })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}
async function evaluate(session, expression, timeoutMs) {
  const result = await cdp(sessionSockets.get(session), 'Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  }, session, timeoutMs)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function connect(browser, label) {
  const info = await (await fetch(browser.debuggerUrl + '/json/version')).json()
  console.log(label, info.Browser)
  const socket = new WebSocket(info.webSocketDebuggerUrl); sockets.push(socket); await once(socket, 'open')
  socket.on('message', raw => {
    const packet = JSON.parse(raw)
    if (packet.id) {
      const request = pending.get(packet.id); if (!request) return
      pending.delete(packet.id); packet.error ? request.reject(new Error(packet.error.message)) : request.resolve(packet.result)
    } else if (packet.method === 'Runtime.exceptionThrown') {
      errors.push(packet.params.exceptionDetails.exception?.description || packet.params.exceptionDetails.text)
    } else if (packet.method === 'Runtime.consoleAPICalled' && packet.params.args?.[0]?.value === 'KTV_STAGE_STALL') {
      try { stalls.set(packet.sessionId, JSON.parse(packet.params.args[1].value)) }
      catch { errors.push('Invalid bounded stage stall observation') }
    }
  })
  return socket
}
async function page(socket, route) {
  const { browserContextId } = await cdp(socket, 'Target.createBrowserContext')
  contexts.push({ socket, browserContextId })
  const { targetId } = await cdp(socket, 'Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await cdp(socket, 'Target.attachToTarget', { targetId, flatten: true })
  sessionSockets.set(sessionId, socket)
  await cdp(socket, 'Runtime.enable', {}, sessionId); await cdp(socket, 'Page.enable', {}, sessionId)
  await cdp(socket, 'Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('auth_token', '1'); localStorage.setItem('language', 'en');
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(...args) { super(...args); window.__stageContext = this; }
    };
    window.__clockReplies = []; window.__lastLease = null;
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(...args) {
        super(...args); window.__partySocket = this;
        this.addEventListener('message', event => {
          if (typeof event.data !== 'string') return;
          let packet; try { packet = JSON.parse(event.data); } catch { return; }
          if (packet.type === 'clock.reply') {
            window.__clockReplies.push({ ...packet, receivedMs: performance.now() });
            if (window.__clockReplies.length > 16) window.__clockReplies.shift();
          }
          const lease = packet.type === 'lease' ? packet.lease : packet.data?.playback?.lease;
          if (lease) window.__lastLease = lease;
        });
      }
    };
  ` }, sessionId)
  await cdp(socket, 'Page.navigate', { url: origin + route }, sessionId)
  await poll(() => evaluate(sessionId, "document.body?.innerText.includes('Live room updates connected')"), 'live built room page')
  check(await evaluate(sessionId, '!document.hidden'), 'native room page is foreground')
  return sessionId
}
async function click(session, text) {
  await poll(() => evaluate(session, `(() => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(text)} && !item.disabled && item.getClientRects().length);
    if (!button) return false; button.click(); return true;
  })()`), `visible ${text}`)
}
async function api(actor, route, body, expectedStatus = 200) {
  const response = await fetch(origin + '/api/ktv' + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json()
  assert.equal(response.status, expectedStatus, `${route}: ${result.code || response.status}`)
  return expectedStatus === 200 ? result.data : result
}
async function command(action, extra = {}, expectedStatus = 200) {
  const view = await api(1, roomPath), playback = view.playback
  return api(1, roomPath + '/playback/' + action, {
    commandId: randomUUID(), clockId: view.clock.clockId, baseRevision: view.room.revision,
    performanceId: playback.performanceId, generation: playback.generation, ...extra,
  }, expectedStatus)
}
async function enableStage(session, excluded = []) {
  await click(session, 'Enable stage audio')
  return poll(async () => (await api(1, roomPath)).presence.devices.find(device =>
    !excluded.includes(device.id) && device.purpose === 'stage' && device.audioEnabled && device.clockHealthy), 'native stage enabled')
}
async function closeContexts() {
  for (const context of contexts.splice(0).reverse()) {
    await cdp(context.socket, 'Target.disposeBrowserContext', { browserContextId: context.browserContextId })
  }
}

try {
  app.use(express.json())
  for (let actor = 1; actor <= 2; actor++) db.prepare("INSERT INTO users (username, kind, created_at) VALUES (?, 'guest', ?)")
    .run(`replacement-${actor}`, new Date().toISOString())
  const auth = (req, res, next) => {
    const actor = Number(req.headers.authorization?.replace('Bearer ', ''))
    if (![1, 2].includes(actor)) return res.sendStatus(401)
    req.auth = { sub: actor }; next()
  }
  app.get('/api/auth/me', auth, (req, res) => res.json({ success: true,
    data: { id: req.auth.sub, username: `replacement-${req.auth.sub}`, name: 'Owned fixture', role: 'user', kind: 'guest' } }))
  app.get('/api/dig/songs', (req, res) => res.json({ success: true, data: [] }))
  app.get('/api/categories', (req, res) => res.json({ success: true, data: { categories: [], assignments: [], lockedSongIds: [] } }))
  for (const directory of ['data', 'karaoke', 'synced', 'lyrics', 'import']) await fs.mkdir(path.join(root, directory))
  const rate = 44100, duration = 60, audio = Buffer.alloc(44 + rate * duration * 2)
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8)
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(rate, 24); audio.writeUInt32LE(rate * 2, 28)
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40)
  for (let frame = 0; frame < rate * duration; frame++) audio.writeInt16LE(Math.round(Math.sin(frame * 2 * Math.PI * 440 / rate) * 6000), 44 + frame * 2)
  await fs.writeFile(path.join(root, 'data/link.1.mp3'), audio)
  await fs.writeFile(path.join(root, 'karaoke/link.1.instrumental.mp3'), audio)
  await fs.writeFile(path.join(root, 'synced/link.1.lrc'), '[00:00]Owned replacement fixture\n[00:30]Same selected turn')
  realtime = registerKtvRoutes(app, { db, authMiddleware: auth, secret: 'owned-replacement-fixture', clock,
    isKaraokeSong: songId => songId === 1,
    resolveAssets: createKtvAssets({ musicRoot: path.join(root, 'data'), karaokeRoot: path.join(root, 'karaoke'),
      importRoot: path.join(root, 'import'), syncedRoot: path.join(root, 'synced'), lyricsRoot: path.join(root, 'lyrics') }) })
  app.get('/data/song_number.txt', (req, res) => res.type('text').send('1'))
  app.get('/data/metadata.json', (req, res) => res.json({ '1': { title: 'Replacement test song', duration } }))
  app.get('/karaoke/karaoke_manifest.json', (req, res) => res.json({ version: 1, ids: [1] }))
  app.use('/data', express.static(path.join(root, 'data')))
  app.use('/karaoke', express.static(path.join(root, 'karaoke')))
  app.use(express.static(path.resolve('dist')))
  app.get('*', (req, res) => res.sendFile(path.resolve('dist/index.html')))
  server = app.listen(0, '127.0.0.1'); server.on('connection', socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)) })
  realtime.attach(server); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`
  console.log('Built index SHA256:', createHash('sha256').update(await fs.readFile('dist/index.html')).digest('hex'))
  const config = { host: process.env.KTV_ROOM_TEST_SSH_HOST, knownHosts: process.env.KTV_ROOM_TEST_KNOWN_HOSTS,
    isolatedOutput: true, captureActivity: true }
  const oldBrowser = await createOwnedRemoteBrowser({ ...config, frontendPort: server.address().port, debugPort: 9243 }); browsers.push(oldBrowser)
  // The second browser shares the first owned app forward, with its own CDP and sink.
  const newBrowser = await createOwnedRemoteBrowser({ ...config, debugPort: 9244 }); browsers.push(newBrowser)
  const oldSocket = await connect(oldBrowser, 'Old stage'), newSocket = await connect(newBrowser, 'Replacement stage')
  await poll(async () => (await oldBrowser.audioEvidence()).some(item => item.ready) &&
    (await newBrowser.audioEvidence()).some(item => item.ready), 'two private native monitors')

  for (const mode of ['task-stall', 'suspend-task-stall']) {
    let view = await api(1, '/rooms', { name: 'Owned stage replacement ' + mode, displayName: 'Host', approvalRequired: false })
    roomPath = '/rooms/' + view.room.id
    await api(2, '/join', { code: view.invitationCode, displayName: 'Singer' })
    const oldStage = await page(oldSocket, `/party/${view.room.id}/stage`)
    const controller = await page(newSocket, `/party/${view.room.id}`)
    const newStage = await page(newSocket, `/party/${view.room.id}/stage`)
    const a = await enableStage(oldStage), b = await enableStage(newStage, [a.id])
    await command('assign-stage', { deviceId: a.id })
    view = await api(2, roomPath + '/queue', { commandId: randomUUID(), songId: 1, title: 'Replacement test song', requestNext: false })
    view = await api(1, roomPath + '/readiness/offer', { commandId: randomUUID(), entryId: view.queue[0].id,
      clockId: view.clock.clockId, baseRevision: view.room.revision })
    view = await api(2, roomPath + '/readiness/respond', { commandId: randomUUID(), clockId: view.clock.clockId,
      baseRevision: view.room.revision, performanceId: view.readiness.performanceId, generation: view.readiness.generation, ready: true })
    await evaluate(controller, "document.getElementById('party-tab-sing').click()")
    await click(controller, 'Prepare selected song')
    await poll(async () => (await api(1, roomPath)).presence.devices.find(device => device.id === a.id)?.ready, 'old native asset decoded')
    await poll(async () => { const current = await api(1, roomPath); return current.clock.serverNowMs >= current.playback.restartSafeAfterMs }, 'original service silence boundary')
    const startedAt = await evaluate(oldStage, 'Date.now()')
    await click(controller, 'Start countdown')
    view = await poll(async () => { const current = await api(1, roomPath); return current.playback.state === 'playing' ? current : false }, 'old stage playing')
    const oldAudible = await poll(async () => (await oldBrowser.audioEvidence()).find(item => item.audible === true && item.time >= startedAt), 'old actual tone output')
    check(view.playback.lease.deviceId === a.id && view.playback.stageDeviceId === a.id, `${mode}: original stage owns the sole live lease`)
    const prior = view.playback
    check(view.timing.outputLeaseMs === 8000 && view.timing.outputMarginMs === 500, `${mode}: default eight-second lease and safety margin remain enforced`)
    // Only the fixture page's JS/render suspension changes. Clock replies,
    // AudioContext timestamps, lease issuance and output processing stay native.
    stallTask = evaluate(oldStage, `(() => {
      const context = window.__stageContext, begin = performance.now(), wallBegin = Date.now(), beforeAudio = context.currentTime;
      const samples = window.__clockReplies.map(reply => ({
        rtt: (reply.receivedMs - reply.clientSendMs) - (reply.serverSendMs - reply.serverReceiveMs),
        offset: ((reply.serverReceiveMs - reply.clientSendMs) + (reply.serverSendMs - reply.receivedMs)) / 2,
      })).filter(sample => sample.rtt >= 0).sort((a,b) => a.rtt - b.rtt);
      const sample = samples[0], lease = window.__lastLease;
      const observation = { begin: wallBegin, beforeAudio, lease,
        clockRttMs: sample?.rtt, expiryWallMs: wallBegin + lease.expiresServerMs - (begin + sample.offset) };
      ${mode === 'suspend-task-stall' ? 'context.suspend();' : ''}
      console.log('KTV_STAGE_STALL', JSON.stringify(observation));
      while (performance.now() < begin + 12000) {}
      const frozenAudio = context.currentTime, resume = Date.now();
      ${mode === 'suspend-task-stall' ? 'context.resume();' : ''}
      while (performance.now() < begin + 22000) {}
      return { ...observation, frozenAudio, resume, finish: Date.now(), afterAudio: context.currentTime };
    })()`, 30000).then(value => ({ value }), error => ({ error }))
    const stall = await poll(() => stalls.get(oldStage), 'old stage task actually blocked', 3000)
    check(stall.lease.deviceId === a.id && Number.isFinite(stall.expiryWallMs) && stall.clockRttMs < 80,
      `${mode}: real clock exchanges bound the old lease deadline observation`)
    const leaseBeforeAssign = (await api(1, roomPath)).playback.lease
    check(leaseBeforeAssign.id === stall.lease.id && leaseBeforeAssign.expiresServerMs === stall.lease.expiresServerMs,
      `${mode}: blocked stage cannot extend its observed lease`)
    await command('assign-stage', { deviceId: b.id })
    view = await poll(async () => { const current = await api(1, roomPath); return current.presence.devices.find(device => device.id === b.id)?.ready ? current : false }, 'replacement native source decoded')
    check(view.playback.state === 'paused' && view.playback.generation > prior.generation && view.playback.entryId === prior.entryId &&
      view.playback.performanceId === prior.performanceId && view.playback.positionMs > 0,
    `${mode}: reassignment preserves the selected singer, song and paused checkpoint`)
    const blocked = await command('start', {}, 409)
    check(blocked.code === 'OUTPUT_STOPPING' && clock.nowMs() < leaseBeforeAssign.safeAfterServerMs,
      `${mode}: backend refuses replacement playback before the old silence boundary`)
    await poll(() => clock.nowMs() >= leaseBeforeAssign.safeAfterServerMs, 'unchanged old lease plus margin', 10000)
    view = await command('start')
    check(view.playback.anchorServerMs >= leaseBeforeAssign.safeAfterServerMs + 2000,
      `${mode}: new countdown follows the prior safety boundary`)
    const newAudible = await poll(async () => (await newBrowser.audioEvidence()).find(item => item.audible === true && item.time > stall.begin), 'replacement actual tone output', 4000)
    check(newAudible.time < stall.begin + 12000, `${mode}: replacement is actually audible while the old page remains blocked`)
    const completion = await stallTask; stallTask = null
    if (completion.error) throw completion.error
    const observed = completion.value
    await wait(1200) // One bounded evidence follower flush; no browser scheduling inference.
    if (mode === 'suspend-task-stall') check(observed.frozenAudio - observed.beforeAudio < .25 &&
      observed.afterAudio - observed.frozenAudio > 8, 'native audio clock freezes then advances while page tasks remain blocked')
    else check(observed.frozenAudio - observed.beforeAudio > 11, 'native render clock advances through the page task stall')
    const oldEvidence = (await oldBrowser.audioEvidence()).filter(item => item.time >= oldAudible.time && item.time <= observed.finish)
    const newEvidence = (await newBrowser.audioEvidence()).filter(item => item.time >= newAudible.time && item.time <= observed.finish)
    const quiet = oldEvidence.find(item => item.audible === false && item.time > oldAudible.time)
    check(quiet && quiet.time <= stall.expiryWallMs + 100,
      `${mode}: actual old sink becomes quiet within the observed lease deadline bound`)
    const gapUncertaintyMs = quiet ? quiet.analysisWindowMs + quiet.fragmentMs + quiet.captureCallMs / 2 +
      newAudible.analysisWindowMs + newAudible.fragmentMs + newAudible.captureCallMs / 2 : Infinity
    check(quiet && newAudible.time - quiet.time - gapUncertaintyMs >= 500,
      `${mode}: measured old/new outputs have no overlap and retain the safety margin`)
    const afterResume = oldEvidence.filter(item => item.captureHeartbeat && item.time >= observed.resume + 100)
    check(afterResume.length >= 5 && afterResume.every(item => item.rmsAmplitude < .005) &&
      !oldEvidence.some(item => item.audible === true && item.time > quiet.time),
    `${mode}: old output stays quiet throughout native resume before page callbacks can run`)
    const replacementDuringResume = newEvidence.filter(item => item.captureHeartbeat && item.time >= observed.resume + 100)
    check(replacementDuringResume.length >= 5 && replacementDuringResume.every(item => item.rmsAmplitude >= .02),
      `${mode}: replacement continues actual backing during old native resume`)
    const activity = [...oldEvidence, ...newEvidence].filter(item => typeof item.audible === 'boolean')
    const heartbeats = [...oldEvidence, ...newEvidence].filter(item => item.captureHeartbeat)
    check(activity.every(item => Math.abs(item.captureQueueMs) < 100 && item.captureCallMs < 20 && item.analysisWindowMs < 24) &&
      heartbeats.every(item => Math.abs(item.captureQueueMs) < 100),
      `${mode}: output edge measurements retain capture latency and analysis bounds`)
    view = await api(1, roomPath)
    check(view.playback.state === 'playing' && view.playback.stageDeviceId === b.id && view.playback.lease.deviceId === b.id &&
      view.playback.lease.id !== leaseBeforeAssign.id && view.playback.entryId === prior.entryId,
    `${mode}: resumed old page cannot regain current room authority`)
    const freshLease = view.playback.lease
    await evaluate(oldStage, `window.__partySocket.send(JSON.stringify(${JSON.stringify({ protocolVersion: 1, type: 'device.heartbeat',
      clockId: leaseBeforeAssign.clockId, performanceId: leaseBeforeAssign.performanceId, generation: leaseBeforeAssign.generation, leaseId: leaseBeforeAssign.id })}))`)
    await wait(300)
    view = await api(1, roomPath)
    check(view.playback.lease.id === freshLease.id && view.playback.lease.deviceId === b.id && view.playback.generation === freshLease.generation,
      `${mode}: stale old heartbeat cannot renew or replace the current lease`)
    const postCallbacks = await poll(async () => {
      const evidence = await oldBrowser.audioEvidence()
      return evidence.some(item => item.captureHeartbeat && item.time > observed.finish + 300) ? evidence : false
    }, 'actual old output after queued callbacks and stale heartbeat', 3000)
    check(postCallbacks.filter(item => item.captureHeartbeat && item.time > observed.finish).every(item => item.rmsAmplitude < .005) &&
      !postCallbacks.some(item => item.audible === true && item.time > quiet.time),
    `${mode}: old output also stays quiet after queued callbacks and stale heartbeat run`)
    console.log('Integrated replacement measurement:', JSON.stringify({ mode, oldLease: leaseBeforeAssign, stall: observed,
      oldQuiet: quiet, newAudible, outputGapMs: newAudible.time - quiet.time, gapUncertaintyMs,
      oldResumeHeartbeats: afterResume, newResumeHeartbeats: replacementDuringResume }))
    await api(1, roomPath + '/close', { commandId: randomUUID() }); roomPath = null
    await closeContexts()
  }
  check(errors.length === 0, 'built replacement journey has no browser runtime exception')
  console.log(`${passed} integrated native stage replacement checks passed; physical output acceptance remains open`)
} catch (error) {
  console.error('Replacement fixture failure:', error.message, '; runtime exceptions:', errors)
  if (roomPath) {
    const view = await api(1, roomPath).catch(() => null)
    console.error('Current playback:', view?.playback)
  }
  throw error
} finally {
  if (stallTask) await stallTask
  if (roomPath) await api(1, roomPath + '/close', { commandId: randomUUID() }).catch(() => {})
  await closeContexts().catch(() => {})
  sockets.forEach(socket => socket.close())
  for (const request of pending.values()) request.reject(new Error('Owned replacement fixture closed'))
  pending.clear()
  const cleanupFailures = []
  for (const browser of browsers.reverse()) {
    try { await browser.close() } catch (error) { cleanupFailures.push(error) }
  }
  realtime?.close()
  for (const connection of connections) connection.destroy()
  if (server?.listening) await new Promise(resolve => server.close(resolve))
  db.close(); await fs.rm(root, { recursive: true, force: true })
  if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'Owned replacement browser cleanup failed')
}
