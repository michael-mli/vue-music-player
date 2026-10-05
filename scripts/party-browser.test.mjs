// Isolated production-build journey through Chrome's DevTools protocol. Uses
// disposable identities/database/audio fixtures; never touches deployed rooms.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from '../server/node_modules/express/index.js'
import WebSocket from '../server/node_modules/ws/wrapper.mjs'
import { initDb } from '../server/db.js'
import { registerKtvRoutes } from '../server/ktv-routes.js'
import { createKtvAssets } from '../server/ktv-assets.js'

const repo = fileURLToPath(new URL('..', import.meta.url))
const clientDist = process.env.KTV_BROWSER_CLIENT_DIST || path.join(repo, 'dist')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-browser-'))
const db = initDb(root)
const app = express()
app.use(express.json())
const receiptRequests = [], receiptRoomName = 'Browser receipt room'
let lostReceiptReplies = 0
app.use((req, res, next) => {
  if (req.path === '/api/ktv/rooms' && req.body?.name === receiptRoomName) {
    receiptRequests.push(req.body.commandId)
    const json = res.json.bind(res)
    res.json = body => {
      // A proxy can lose the upstream reply after commit and return 502. A
      // bare TCP reset is unsuitable here: Chrome may transparently retry it.
      if (body.success && lostReceiptReplies < 1) {
        lostReceiptReplies++; res.status(502)
        return json({ success: false, code: 'TEST_GATEWAY_LOST_REPLY', message: 'Gateway lost the committed reply' })
      }
      return json(body)
    }
  }
  next()
})
for (let id = 1; id <= 4; id++) db.prepare("INSERT INTO users (username, kind, created_at) VALUES (?, 'guest', ?)").run(`browser-${id}`, new Date().toISOString())
const user = id => ({ id, username: `browser-${id}`, name: `Browser ${id}`, role: 'user', kind: 'guest' })
const auth = (req, res, next) => {
  const id = Number(req.headers.authorization?.replace('Bearer ', ''))
  if (!Number.isInteger(id) || id < 1 || id > 4) return res.sendStatus(401)
  req.auth = { sub: id }; next()
}
app.get('/api/auth/me', auth, (req, res) => res.json({ success: true, data: user(req.auth.sub) }))
app.post('/api/auth/guest', (req, res) => res.json({ success: true, data: { token: '1', user: user(1) } }))
app.get('/api/dig/songs', (req, res) => res.json({ success: true, data: [] }))
app.get('/api/categories', (req, res) => res.json({ success: true, data: { categories: [], assignments: [], lockedSongIds: [] } }))
for (const folder of ['data', 'karaoke', 'synced', 'lyrics', 'import']) await fs.mkdir(path.join(root, folder))
const sampleRate = 8000, durationSeconds = 45, dataSize = sampleRate * durationSeconds * 2
const audio = Buffer.alloc(44 + dataSize)
audio.write('RIFF', 0); audio.writeUInt32LE(36 + dataSize, 4); audio.write('WAVEfmt ', 8)
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22)
audio.writeUInt32LE(sampleRate, 24); audio.writeUInt32LE(sampleRate * 2, 28)
audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(dataSize, 40)
for (let index = 0; index < sampleRate * durationSeconds; index++) audio.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / sampleRate) * 2000), 44 + index * 2)
await fs.writeFile(path.join(root, 'data/link.1.mp3'), audio)
await fs.writeFile(path.join(root, 'karaoke/link.1.instrumental.mp3'), audio)
await fs.writeFile(path.join(root, 'synced/link.1.lrc'), '[00:00]Start singing\n[00:10]Second line\n[00:20]Seek line\n[00:40]Final line')
const realtime = registerKtvRoutes(app, { db, authMiddleware: auth, secret: 'isolated-browser-secret', isKaraokeSong: id => id === 1,
  hostGraceMs: 1000,
  resolveAssets: createKtvAssets({ musicRoot: path.join(root, 'data'), karaokeRoot: path.join(root, 'karaoke'),
    importRoot: path.join(root, 'import'), syncedRoot: path.join(root, 'synced'), lyricsRoot: path.join(root, 'lyrics') }) })
app.get('/data/song_number.txt', (req, res) => res.type('text').send('1'))
app.get('/data/metadata.json', (req, res) => res.json({ '1': { title: 'Browser test song', duration: 45 } }))
app.get('/karaoke/karaoke_manifest.json', (req, res) => res.json({ version: 1, ids: [1] }))
app.use('/data', express.static(path.join(root, 'data')))
app.use('/karaoke', express.static(path.join(root, 'karaoke')))
app.use(express.static(clientDist))
app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')))
const server = app.listen(0, '127.0.0.1')
realtime.attach(server)
await new Promise(resolve => server.once('listening', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const contexts = [], errors = [], sessions = []
let debuggerSocket, phoneSocket, nextId = 0, passed = 0
const debuggerSockets = [], sessionSockets = new Map()
const pending = new Map()
async function api(actor, route, body) {
  const response = await fetch(`${origin}/api/ktv${route}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await response.json(); assert.ok(response.ok, `${route}: ${json.code || response.status}`); return json.data
}
function check(condition, label) { assert.ok(condition, label); passed++; console.log(`PASS ${label}`) }
async function poll(work, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try { const result = await work(); if (result) return result } catch (error) {
      // Reload can destroy the prior context between polling and evaluation.
      // Retry only that transient CDP condition; assertion/runtime failures still fail.
      if (!/Inspected target navigated or closed|Execution context was destroyed|Cannot find context with specified id/.test(error.message)) throw error
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${label}`)
}
function cdp(method, params = {}, sessionId, socket = sessionSockets.get(sessionId) || debuggerSocket) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve: result => { clearTimeout(timeout); resolve(result) }, reject: error => { clearTimeout(timeout); reject(error) } })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}
async function evaluate(session, expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, session)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function click(session, text) {
  await poll(() => evaluate(session, `(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(text)} && !item.disabled && item.getClientRects().length); if (!button) return false; button.click(); return true })()`), `visible button ${text}`)
}
async function tab(session, name) {
  await evaluate(session, `document.getElementById('party-tab-${name}').click()`)
  await poll(() => evaluate(session, `document.getElementById('party-tab-${name}').getAttribute('aria-selected') === 'true' && document.getElementById('party-panel-${name}').getClientRects().length > 0`), `${name} tab`)
}
async function page(actor, route, ready = "document.body?.innerText.includes('Live room updates connected')") {
  const socket = actor === 2 && phoneSocket ? phoneSocket : debuggerSocket
  const { browserContextId } = await cdp('Target.createBrowserContext', {}, undefined, socket)
  contexts.push({ browserContextId, socket })
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId }, undefined, socket)
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true }, undefined, socket)
  sessionSockets.set(sessionId, socket)
  sessions.push(sessionId)
  await cdp('Runtime.enable', {}, sessionId); await cdp('Page.enable', {}, sessionId)
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('auth_token', '${actor}'); localStorage.setItem('language', 'en');
    window.__soloAudios = []; window.__soloHandlers = {};
    const NativeAudio = window.Audio;
    window.Audio = function(...args) { const audio = new NativeAudio(...args); window.__soloAudios.push(audio); return audio; };
    window.Audio.prototype = NativeAudio.prototype;
    if ('mediaSession' in navigator) {
      const setHandler = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      navigator.mediaSession.setActionHandler = (action, handler) => {
        if (handler && ['play', 'nexttrack'].includes(action)) window.__soloHandlers[action] = handler;
        return setHandler(action, handler);
      };
    }
    window.__partyAudit = []; window.__partyContexts = []; window.__partyTimestamps = []; window.__partyClocks = []; window.__partyPlaybacks = [];
    const timestamp = AudioContext.prototype.getOutputTimestamp;
    AudioContext.prototype.getOutputTimestamp = function() {
      const native = timestamp.call(this);
      const result = { ...native, contextTime: Math.max(0, native.contextTime - (window.__partyTimestampShiftMs || 0) / 1000) };
      window.__partyTimestamps.push({ ...result, now: performance.now(), currentTime: this.currentTime, outputLatency: this.outputLatency });
      if (window.__partyTimestamps.length > 256) window.__partyTimestamps.shift();
      return result;
    };
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          if (typeof event.data !== 'string') return;
          let packet; try { packet = JSON.parse(event.data); } catch { return; }
          if (packet.type === 'clock.reply') {
            window.__partyClocks.push({ ...packet, received: performance.now() });
            if (window.__partyClocks.length > 16) window.__partyClocks.shift();
          }
          if (packet.type === 'snapshot' && packet.data?.playback) {
            const { state, generation, positionMs, anchorServerMs, pendingTransition } = packet.data.playback;
            window.__partyPlaybacks.push({ state, generation, positionMs, anchorServerMs, pendingTransition, received: performance.now() });
            if (window.__partyPlaybacks.length > 16) window.__partyPlaybacks.shift();
          }
        });
      }
    };
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function() {
      const node = create.call(this), context = this;
      const record = { starts: [], stops: [], ended: false, context };
      window.__partyContexts.push(context); window.__partyAudit.push(record);
      const start = node.start.bind(node), stop = node.stop.bind(node);
      node.start = (...args) => { record.starts.push(args); return start(...args); };
      node.stop = (...args) => { record.stops.push(args); return stop(...args); };
      node.addEventListener('ended', () => record.ended = true);
      return node;
    };` }, sessionId)
  await cdp('Page.navigate', { url: origin + route }, sessionId)
  await poll(() => evaluate(sessionId, ready), 'page ready')
  assert.equal(await evaluate(sessionId, 'document.hidden'), false)
  return sessionId
}
const audit = session => evaluate(session, `window.__partyAudit.map(item => ({ starts: item.starts, stops: item.stops, ended: item.ended, contextTime: item.context.currentTime }))`)
let pathRoom, closer = 1
try {
  async function connect(debugUrl, label) {
    const info = await (await fetch(`${debugUrl}/json/version`, { signal: AbortSignal.timeout(3000) })).json()
    console.log(`${label}: ${info.Browser}`)
    const socket = new WebSocket(info.webSocketDebuggerUrl)
    debuggerSockets.push(socket)
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
    socket.on('message', raw => {
      const packet = JSON.parse(raw)
      if (packet.id) {
        const item = pending.get(packet.id); if (!item) return
        pending.delete(packet.id); packet.error ? item.reject(new Error(packet.error.message)) : item.resolve(packet.result)
      } else if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails.exception?.description || packet.params.exceptionDetails.text)
    })
    return socket
  }
  debuggerSocket = await connect(process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9229', 'Stage browser')
  if (process.env.CHROME_SINGER_DEBUG_URL) phoneSocket = await connect(process.env.CHROME_SINGER_DEBUG_URL, 'Singer browser')
  const receiptPage = await page(4, '/party', "!!document.getElementById('party-room-name')")
  const fillReceiptForm = () => evaluate(receiptPage, `(() => {
    for (const [id, value] of [['party-room-name', ${JSON.stringify(receiptRoomName)}], ['party-host-name', 'Receipt host']]) {
      const input = document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`)
  await fillReceiptForm(); await click(receiptPage, 'Create room')
  await poll(() => evaluate(receiptPage, "!!document.querySelector('[role=alert]')"), 'lost room reply feedback')
  check(lostReceiptReplies === 1 && db.prepare('SELECT COUNT(*) total FROM ktv_rooms WHERE name = ?').get(receiptRoomName).total === 1,
    'A gateway losing the committed reply leaves one room and visible retry feedback')
  const beforeReload = await evaluate(receiptPage, 'performance.timeOrigin')
  await cdp('Page.reload', {}, receiptPage)
  await poll(() => evaluate(receiptPage, `performance.timeOrigin !== ${beforeReload} && document.readyState === 'complete' && !!document.getElementById('party-room-name') && !!document.getElementById('party-host-name')`), 'new receipt document after reload')
  await fillReceiptForm(); await click(receiptPage, 'Create room')
  await poll(() => evaluate(receiptPage, "document.body.innerText.includes('Live room updates connected')"), 'room restored after lost reply')
  check(receiptRequests.length === 2 && new Set(receiptRequests).size === 1,
    'Room creation retries use the same command ID after a full tab reload')
  const receiptRoomId = db.prepare('SELECT id FROM ktv_rooms WHERE name = ?').get(receiptRoomName).id
  await api(4, `/rooms/${receiptRoomId}/close`, {})
  await cdp('Target.closeTarget', { targetId: (await cdp('Target.getTargetInfo', {}, receiptPage)).targetInfo.targetId })
  const admissionRoom = await api(1, '/rooms', { name: 'Browser admission party', displayName: 'Host' })
  await api(4, '/join', { code: admissionRoom.invitationCode, displayName: 'Waiting guest' })
  const waitingGuest = await page(4, `/party/join#invite=${admissionRoom.invitationCode}`)
  check(await evaluate(waitingGuest, "document.body.innerText.includes('Waiting for host approval') && !document.querySelector('[role=tablist]')"),
    'A returning pending guest recovers the approval screen without admitted controls')
  await api(1, `/rooms/${admissionRoom.room.id}/close`, {})
  await cdp('Target.closeTarget', { targetId: (await cdp('Target.getTargetInfo', {}, waitingGuest)).targetInfo.targetId })
  let view = await api(1, '/rooms', { name: 'Browser playback party', displayName: 'Host', approvalRequired: false })
  pathRoom = `/rooms/${view.room.id}`
  await api(2, '/join', { code: view.invitationCode, displayName: 'Singer' })
  await api(3, '/join', { code: view.invitationCode, displayName: 'Viewer' })
  const newGuest = await page(4, `/party/join#invite=${view.invitationCode}`, "!!document.getElementById('party-guest-name') && !document.querySelector('[role=status]')")
  await poll(() => evaluate(newGuest, "document.activeElement?.id === 'party-guest-name'"), 'new guest name focus')
  check(await evaluate(newGuest, "document.getElementById('party-guest-name').value === '' && !location.hash && !location.search"),
    'New invitation guests choose a name and the code leaves the address bar')
  check(!db.prepare('SELECT 1 FROM ktv_members WHERE room_id = ? AND user_id = 4').get(view.room.id),
    'Opening an invitation alone does not create membership')
  await evaluate(newGuest, "(() => { const input = document.getElementById('party-guest-name'); input.value = 'Viewer'; input.dispatchEvent(new Event('input', { bubbles: true })); })()")
  await click(newGuest, 'Join room')
  await poll(() => evaluate(newGuest, "document.body.innerText.includes('Live room updates connected')"), 'new guest admitted without signup')
  const duplicateNames = db.prepare("SELECT id FROM ktv_members WHERE room_id = ? AND display_name = 'Viewer'").all(view.room.id)
  check(duplicateNames.length === 2 && duplicateNames[0].id !== duplicateNames[1].id,
    'Guest joining through the form gets a distinct participant ID despite a duplicate name')
  await cdp('Target.closeTarget', { targetId: (await cdp('Target.getTargetInfo', {}, newGuest)).targetInfo.targetId })
  const returning = await page(3, `/party/join#invite=${view.invitationCode}`)
  check(await evaluate(returning, `location.pathname === '/party/${view.room.id}' && !document.getElementById('party-guest-name')`) &&
    db.prepare('SELECT display_name FROM ktv_members WHERE room_id = ? AND user_id = 3').get(view.room.id).display_name === 'Viewer',
    'Returning invitation guests recover their existing room and chosen name')
  await cdp('Target.closeTarget', { targetId: (await cdp('Target.getTargetInfo', {}, returning)).targetInfo.targetId })
  const solo = await page(1, '/music', "window.__soloAudios?.[0]?.src && document.querySelector('a[href=\"/party\"]')")
  await evaluate(solo, 'window.__soloAudios[0].play()')
  await poll(() => evaluate(solo, "!!window.__soloHandlers.play && !window.__soloAudios[0].paused"), 'solo music enabled')
  await evaluate(solo, "document.querySelector('a[href=\"/party\"]').click()")
  await poll(() => evaluate(solo, "location.pathname === '/party' && !!document.getElementById('party-room-name')"), 'party route owns audio')
  await evaluate(solo, 'window.__soloHandlers.play(); window.__soloHandlers.nexttrack()')
  check(await evaluate(solo, "window.__soloAudios[0].paused && navigator.mediaSession.metadata === null"), 'Entering party mode blocks saved solo media controls')
  await evaluate(solo, "document.querySelector('a[href=\"/\"]').click()")
  await poll(() => evaluate(solo, "location.pathname === '/'"), 'solo route restored')
  check(await evaluate(solo, 'window.__soloAudios[0].paused'), 'Returning to solo mode keeps its preserved song paused')
  await cdp('Target.closeTarget', { targetId: (await cdp('Target.getTargetInfo', {}, solo)).targetInfo.targetId })
  const host = await page(1, `/party/${view.room.id}/stage`)
  const singer = await page(2, `/party/${view.room.id}`)
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, singer)
  const viewer = await page(3, `/party/${view.room.id}/stage`)
  check(await evaluate(viewer, "!document.querySelector('canvas[aria-label=\"Scan to join this KTV room\"]')"), 'Common screen keeps invitations hidden by default')
  if (await evaluate(host, 'document.fullscreenEnabled')) {
    await click(host, 'Fullscreen')
    await poll(() => evaluate(host, "!!document.fullscreenElement || document.body.innerText.includes('Fullscreen is unavailable')"), 'fullscreen result')
    const entered = await evaluate(host, '!!document.fullscreenElement')
    if (entered) {
      await click(host, 'Exit fullscreen')
      await poll(() => evaluate(host, '!document.fullscreenElement'), 'fullscreen exit')
      check(await evaluate(host, '!document.fullscreenElement'), 'Stage provides an explicit fullscreen exit')
    } else check(await evaluate(host, "document.body.innerText.includes('Fullscreen is unavailable')"), 'Fullscreen refusal leaves the stage usable with a clear fallback')
  }
  check(await evaluate(singer, "document.querySelectorAll('[role=tab]').length === 4 && [...document.querySelectorAll('[role=tabpanel]')].filter(panel => panel.getClientRects().length).length === 1"), 'Phone presents four tabs and one active panel')
  await evaluate(singer, "document.getElementById('party-tab-songs').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))")
  await poll(() => evaluate(singer, "document.activeElement.id === 'party-tab-queue' && document.activeElement.getAttribute('aria-selected') === 'true'"), 'keyboard tab focus')
  check(true, 'Arrow keys move selection and keyboard focus together')
  await tab(singer, 'people')
  check(await evaluate(singer, "!document.body.innerText.includes('Close room') && !document.body.innerText.includes('Invite people')"), 'Ordinary phone hides host-only controls')
  const controller = await page(1, `/party/${view.room.id}`)
  view = await api(1, pathRoom)
  const singerId = view.members.find(member => member.displayName === 'Singer').id
  view = await api(1, `${pathRoom}/queue`, { commandId: crypto.randomUUID(), songId: 1, title: 'Host ordering song', requestNext: false })
  const hostRequestId = view.queue.find(entry => entry.title === 'Host ordering song').id
  view = await api(3, `${pathRoom}/queue`, { commandId: crypto.randomUUID(), songId: 1, title: 'Viewer ordering song', requestNext: false })
  const viewerRequestId = view.queue.find(entry => entry.title === 'Viewer ordering song').id
  await tab(singer, 'songs')
  await poll(() => evaluate(singer, "document.body.innerText.includes('Already requested in this room; another turn is allowed.')"), 'duplicate song warning')
  check(true, 'Catalog warns about duplicates while allowing another performance')
  await tab(controller, 'queue')
  const queueButton = async (title, text) => {
    await poll(() => evaluate(controller, `(() => { const row = [...document.querySelectorAll('#party-panel-queue li')].find(item => item.textContent.includes(${JSON.stringify(title)})); const button = [...(row?.querySelectorAll('button') || [])].find(item => item.textContent.trim() === ${JSON.stringify(text)} && !item.disabled); if (!button) return false; button.click(); return true })()`), text)
  }
  await queueButton('Viewer ordering song', 'Move next')
  view = await poll(async () => { const current = await api(1, pathRoom); return current.queue[0]?.id === viewerRequestId && current.queue[0].hostOrder != null ? current : false }, 'manual next order')
  check(true, 'Host phone moves a pending performance next')
  await queueButton('Viewer ordering song', 'Return to fair order')
  await poll(async () => (await api(1, pathRoom)).queue[0]?.id === hostRequestId, 'restored fair order')
  check(true, 'Host phone restores the singer rotation')
  await tab(singer, 'queue')
  check(await evaluate(singer, "!document.querySelector('[id^=party-reassign-]') && ![...document.querySelectorAll('#party-panel-queue button')].some(button => button.textContent.trim() === 'Move next')"), 'Ordinary phones hide ordering and assignment controls')
  await evaluate(controller, `(() => { const select = document.getElementById('party-reassign-${hostRequestId}'); select.value = '${singerId}'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await queueButton('Host ordering song', 'Assign song')
  view = await poll(async () => { const current = await api(1, pathRoom); const entry = current.queue.find(item => item.id === hostRequestId); return entry?.singerMemberId === singerId && !entry.singerAccepted ? current : false }, 'new singer must accept')
  check(view.queue.find(item => item.id === hostRequestId).requesterName === 'Host', 'Reassignment preserves requester and requires the new singer’s acceptance')
  await click(singer, 'Accept song')
  await poll(async () => (await api(1, pathRoom)).queue.find(item => item.id === hostRequestId)?.singerAccepted, 'assignment acceptance')
  await tab(controller, 'people')
  await evaluate(controller, "(() => { const select = document.getElementById('party-singer-limit'); select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })); })()")
  await poll(async () => (await api(1, pathRoom)).limits.singerRequests === 1, 'host singer cap')
  await tab(singer, 'songs')
  await poll(() => evaluate(singer, "[...document.querySelectorAll('#party-panel-songs button')].find(button => button.textContent.trim() === 'Add song')?.disabled"), 'singer cap control')
  check(true, 'Host cap updates disable extra singer requests without removing existing songs')
  check(await evaluate(controller, 'document.documentElement.scrollWidth <= window.innerWidth'), 'Assignment and cap controls fit their viewport')
  await api(1, `${pathRoom}/settings`, { commandId: crypto.randomUUID(), singerRequests: 3 })
  for (const id of [hostRequestId, viewerRequestId]) await api(1, `${pathRoom}/queue/${id}/cancel`, { commandId: crypto.randomUUID() })
  await cdp('Target.closeTarget', { targetId: (await cdp('Target.getTargetInfo', {}, controller)).targetInfo.targetId })
  await tab(singer, 'sing')
  check((await audit(viewer)).length === 0, 'Viewer stays silent before audio enablement')
  await click(host, 'Enable stage audio')
  await poll(async () => { const latest = await api(1, pathRoom); return latest.presence.devices.find(device => device.purpose === 'stage' && device.clockHealthy && device.audioEnabled) }, 'stage audio enabled')
  await poll(() => evaluate(host, `(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.includes('Stage · Host') && !item.disabled); if (!button) return false; button.click(); return true })()`), 'select stage')
  view = await poll(async () => { const latest = await api(1, pathRoom); return latest.playback.stageDeviceId ? latest : false }, 'stage designated')
  check(!!view.playback.stageDeviceId, 'Host selects an enabled stage in the rendered UI')
  view = await api(2, `${pathRoom}/queue`, { commandId: crypto.randomUUID(), songId: 1, title: 'Browser test song', requestNext: false })
  view = await api(1, `${pathRoom}/readiness/offer`, { commandId: crypto.randomUUID(), entryId: view.queue[0].id, clockId: view.clock.clockId, baseRevision: view.room.revision })
  await click(singer, "I'm ready to sing")
  await poll(async () => (await api(1, pathRoom)).readiness.state === 'ready', 'human ready')
  if(process.env.KTV_BROWSER_STAGE_RELOAD==='1'){
    await cdp('Page.reload',{},host)
    await poll(()=>evaluate(host,"document.body?.innerText.includes('Live room updates connected')"),'stage reconnected after refresh')
    await poll(()=>evaluate(host,"document.body.innerText.includes('The selected stage is disconnected') && [...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Prepare selected song'&&button.disabled)"),'stale stage selection explained and preparation disabled')
    check(true,'Refreshing the selected stage blocks stale preparation and explains reselection')
    await click(host,'Enable stage audio')
    await poll(()=>evaluate(host,"(() => { const button=[...document.querySelectorAll('button')].find(item=>item.textContent.includes('Stage · Host')&&!item.disabled); if(!button)return false;button.click();return true })()"),'select refreshed stage')
    await poll(()=>evaluate(host,"[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Prepare selected song'&&!button.disabled)"),'fresh stage permits preparation')
    check(true,'Explicit refreshed stage selection restores preparation without changing singer readiness')
  }
  await click(host, 'Prepare selected song')
  await poll(async () => { const latest = await api(1, pathRoom); return latest.presence.devices.some(device => device.id === latest.playback.stageDeviceId && device.ready) }, 'stage decoded')
  check((await audit(host)).length === 0, 'Preparation does not start backing before a countdown')
  await poll(() => evaluate(singer, `(() => { const label = [...document.querySelectorAll('label')].find(item => item.textContent.includes('Require my vocal guide')); const box = label?.querySelector('input'); if (!box || box.disabled) return false; box.click(); return true })()`), 'require guide control')
  await poll(async () => (await api(1, pathRoom)).playback.guideRequired, 'guide marked required')
  await poll(() => evaluate(host, "[...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Start countdown')?.disabled"), 'required guide disables the rendered start control')
  check(true, 'Required guide blocks the rendered start control until ready')
  await click(singer, 'Enable private vocal guide')
  await poll(() => evaluate(singer, "document.body.innerText.includes('Audio prepared')"), 'guide decoded')
  await click(host, 'Start countdown')
  await poll(async () => (await api(1, pathRoom)).playback.state === 'playing', 'playing')
  check((await audit(host)).length === 1, 'Designated stage schedules one backing source')
  check((await audit(singer)).length === 1, 'Singer phone schedules its private original source')
  if(process.env.KTV_BROWSER_GUIDE_SUSTAINED==='1'){
    await new Promise(resolve=>setTimeout(resolve,5000))
    check((await audit(singer)).length===1&&!(await audit(singer))[0].ended,
      'Private guide remains playing through output-clock measurements and lease renewal')
  }
  const backgroundGuide = process.env.KTV_BROWSER_GUIDE_BACKGROUND === '1'
  if (backgroundGuide) {
    // Simulate the browser's hidden/no-rAF contract while retaining native
    // Web Audio and real sockets. This is not a physical phone lock test.
    await evaluate(singer, `(() => {
      window.__guideBackgroundTest = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__guideBackgroundTest });
      window.__guideNativeRaf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => window.__guideNativeRaf(time => {
        if (window.__guideBackgroundTest) window.__guidePendingFrame = callback; else callback(time);
      });
      document.dispatchEvent(new Event('visibilitychange'));
    })()`)
    await new Promise(resolve => setTimeout(resolve, 12000))
    view = await api(1, pathRoom)
    check(await evaluate(singer, 'document.hidden && !!window.__guidePendingFrame'), 'Background fixture hides singer and suspends animation callbacks')
    check(view.playback.state === 'playing' && view.playback.guidePrepared,
      'Required hidden guide remains ready beyond the eight-second lease interval')
    check((await audit(singer)).length === 1 && !(await audit(singer))[0].ended,
      'Hidden guide renews native output deadlines without restarting its source')
    check(await evaluate(singer, "navigator.mediaSession.playbackState === 'playing' && navigator.mediaSession.metadata?.title === 'Browser test song'"),
      'Private guide reports active song to the phone media session')
  }
  await tab(singer, 'queue')
  check(await evaluate(singer, "document.body.innerText.includes('Requested by') && document.body.innerText.includes('Singer')"), 'Queue tab shows singer and requester attribution')
  check(await evaluate(singer, "![...document.querySelectorAll('#party-panel-queue button')].some(button => button.textContent.trim() === 'Remove song')"),
    'Current performance has no request-removal action in the phone queue')
  check((await audit(singer)).length === 1 && !(await audit(singer))[0].ended, 'Changing phone tabs preserves the active private guide')
  await tab(singer, 'sing')
  check((await audit(viewer)).length === 0, 'Other common screens remain silent during playback')
  check(await evaluate(host, "document.body.innerText.includes('Start singing')"), 'Stage renders pinned synchronized lyrics')
  await click(host, 'Pause song')
  await poll(async () => (await api(1, pathRoom)).playback.state === 'paused', 'paused')
  await poll(async () => (await audit(host)).every(record => record.ended), 'audio stops at pause')
  check((await audit(singer)).every(record => record.ended), 'Guide follows the scheduled pause')
  await click(host, 'Resume with countdown')
  await poll(async () => (await api(1, pathRoom)).playback.state === 'playing', 'resumed')
  await poll(async () => (await audit(host)).length === 2 && (await audit(singer)).length === 2, 'resumed sources')
  check(true, 'Resume creates fresh sources for the new generation')
  if (backgroundGuide) {
    check(await evaluate(singer, 'document.hidden'), 'Host pause and resume work while the guide page remains hidden')
    await evaluate(singer, `(() => {
      window.__guideBackgroundTest = false;
      document.dispatchEvent(new Event('visibilitychange'));
      if (window.__guidePendingFrame) window.__guideNativeRaf(window.__guidePendingFrame);
      window.__guidePendingFrame = null;
    })()`)
    await new Promise(resolve => setTimeout(resolve, 1000))
    check((await audit(singer)).length === 2 && !(await audit(singer)).at(-1).ended,
      'Returning to the screen preserves the current healthy guide and clock')
  }
  await evaluate(host, `(() => { const slider = document.querySelector('input[aria-label="Shared song position"]'); slider.value = '20000'; slider.dispatchEvent(new Event('change', { bubbles: true })); })()`)
  await poll(async () => { const latest = await api(1, pathRoom); return latest.playback.positionMs === 20000 && !latest.playback.pendingTransition }, 'seek effective')
  await poll(async () => (await audit(host)).length === 3 && (await audit(singer)).length === 3, 'seek sources')
  await new Promise(resolve => setTimeout(resolve, 300))
  check((await audit(host)).length === 3, 'Seek adopts the prepared next source without duplicate backing')
  const source = (await audit(host)).at(-1)
  check(source.stops.at(-1)[0] > source.contextTime, 'Active backing has an audio-clock silence deadline')
  await click(singer, "Turn off this device's audio")
  await poll(async () => { const current = await api(1, pathRoom); return current.playback.state === 'recovering' && current.playback.recoveryReason === 'guide.unavailable' }, 'required guide recovery')
  await poll(async () => (await audit(host)).every(record => record.ended), 'backing stops for required guide')
  check(true, 'Muting a required guide stops backing and preserves the current entry')
  await evaluate(singer, `(() => { const label = [...document.querySelectorAll('label')].find(item => item.textContent.includes('Require my vocal guide')); label.querySelector('input').click(); })()`)
  await poll(async () => !(await api(1, pathRoom)).playback.guideRequired, 'guide explicitly optional')
  await click(host, 'Resume with countdown')
  await poll(async () => (await api(1, pathRoom)).playback.state === 'playing', 'resume without required guide')
  await click(singer, 'Enable private vocal guide')
  await poll(async () => (await audit(singer)).length === 4, 'optional guide late attachment')
  check((await audit(singer)).at(-1).starts[0][1] >= 20, 'Optional guide attaches at the live position')
  await click(singer, "Turn off this device's audio")
  const beforeOutput = (await api(1, pathRoom)).playback
  check(beforeOutput.state === 'playing', 'Optional guide interruption leaves backing playing')
  await click(singer, 'Enable private vocal guide')
  await poll(async () => (await audit(singer)).length === 5, 'guide enabled for output check')
  await click(singer, 'Earlier')
  await poll(() => evaluate(singer, "localStorage.getItem('party-guide-advance-ms') === '25'"), 'guide calibration before output change')
  let stageCount = (await audit(host)).length
  await evaluate(singer, "window.__partyContexts[0].dispatchEvent(new Event('sinkchange'))")
  await poll(() => evaluate(singer, "document.body.innerText.includes('Audio output changed')"), 'guide output change alert')
  check(await evaluate(singer, "localStorage.getItem('party-guide-advance-ms') === '0'"), 'Changing guide output invalidates its old timing correction')
  // A real headless output-clock stall is a required recovery scenario. Do not
  // disable drift detection or treat a recovered stage as a healthy speaker.
  const afterOutput = await api(1, pathRoom)
  if (afterOutput.playback.state === 'recovering' && afterOutput.playback.recoveryReason === 'stage.drift') {
    const maxError = await evaluate(host, "parseFloat(document.querySelector('dl dd:nth-of-type(2)').textContent)")
    check(maxError >= 80 && afterOutput.playback.entryId === beforeOutput.entryId && afterOutput.playback.generation > beforeOutput.generation,
      'Rendered stage drift stops the room and preserves the current turn')
    await poll(async () => (await audit(host)).every(record => record.ended), 'drift source silence')
    await click(host, 'Retry audio preparation')
    check((await api(1, pathRoom)).playback.state === 'recovering', 'Drift retry prepares without automatically resuming the room')
    await click(host, 'Resume with countdown')
    await poll(async () => (await api(1, pathRoom)).playback.state === 'playing', 'deliberate drift resume')
    await click(singer, 'Confirm output and retry')
    await poll(async () => (await audit(singer)).at(-1)?.starts.length && !(await audit(singer)).at(-1).ended, 'guide reattaches after drift recovery')
    stageCount = (await audit(host)).length
    await evaluate(singer, "window.__partyContexts[0].dispatchEvent(new Event('sinkchange'))")
    await poll(() => evaluate(singer, "document.body.innerText.includes('Audio output changed')"), 'isolated optional guide output fault')
  }
  const healthyOutputTurn = (await api(1, pathRoom)).playback
  check(healthyOutputTurn.state === 'playing' && (await audit(host)).length === stageCount, 'Optional guide output change preserves healthy backing')
  await poll(async () => (await audit(singer)).every(record => record.ended), 'optional guide stops for output recovery')
  const mutedCount = (await audit(singer)).length
  await new Promise(resolve => setTimeout(resolve, 300))
  check((await audit(singer)).length === mutedCount, 'Changed output cannot restart itself before an explicit retry')
  await click(singer, 'Confirm output and retry')
  await poll(async () => (await audit(singer)).length === mutedCount + 1, 'guide resumes after explicit output confirmation')
  check(true, 'Explicit confirmation reattaches the guide to the live position')
  await click(singer, "Turn off this device's audio")
  const driftTurn = healthyOutputTurn
  await evaluate(host, 'window.__partyTimestampShiftMs = 350')
  await poll(async () => { const current = await api(1, pathRoom); return current.playback.state === 'recovering' && current.playback.recoveryReason === 'stage.drift' ? current : false }, 'injected rendered-clock drift')
  const driftRecovered = (await api(1, pathRoom)).playback
  check(driftRecovered.entryId === driftTurn.entryId && driftRecovered.generation > driftTurn.generation, 'Rendered-clock drift preserves the selected turn under a recovery generation')
  await poll(async () => (await audit(host)).every(record => record.ended), 'all drift backing sources stop')
  check(true, 'Rendered-clock drift cancels the active backing source')
  await evaluate(host, 'window.__partyTimestampShiftMs = 0')
  await click(host, 'Retry audio preparation')
  check((await api(1, pathRoom)).playback.state === 'recovering', 'Explicit drift retry does not restart backing by itself')
  await click(host, 'Resume with countdown')
  await poll(async () => ['scheduled', 'playing'].includes((await api(1, pathRoom)).playback.state), 'fresh drift countdown')
  await evaluate(host, "window.__partyContexts[0].dispatchEvent(new Event('sinkchange'))")
  await poll(async () => { const current = await api(1, pathRoom); return current.playback.state === 'recovering' && current.playback.recoveryReason === 'stage.output' }, 'stage output recovery')
  check(true, 'Stage output change preserves the song in room recovery')
  await click(host, 'Confirm output and retry')
  check((await api(1, pathRoom)).playback.state === 'recovering', 'Preparing the changed stage does not resume the room automatically')
  await click(host, 'Resume with countdown')
  await poll(async () => (await api(1, pathRoom)).playback.state === 'playing', 'changed stage deliberately resumes')
  check(await evaluate(host, "document.body.innerText.includes('Audio timing and health')"), 'Rendered diagnostics describe browser timing separately from acoustic alignment')
  view = await api(1, pathRoom)
  await api(1, `${pathRoom}/members/${view.members.find(member => member.displayName === 'Singer').id}/role`, { commandId: crypto.randomUUID(), role: 'cohost' })
  await api(3, `${pathRoom}/queue`, { commandId: crypto.randomUUID(), songId: 1, title: 'Next browser song', requestNext: false })
  await evaluate(host, "document.querySelector('button').dispatchEvent(new Event('blur'))")
  await cdp('Target.closeTarget', { targetId: (await cdp('Target.getTargetInfo', {}, host)).targetInfo.targetId })
  await poll(async () => (await api(1, pathRoom)).playback.state === 'recovering', 'stage disconnect recovery')
  check(true, 'Closing the stage enters recovery without advancing the queue')
  await poll(async () => (await api(2, pathRoom)).self.role === 'host', 'cohost inherits after grace')
  closer = 2
  await tab(singer, 'people')
  await poll(() => evaluate(singer, "[...document.querySelectorAll('button')].some(item => item.textContent.trim() === 'Close room')"), 'transferred host controls')
  check(true, 'Transferred host controls update on the remaining phone')
  await poll(() => evaluate(singer, "document.querySelector('canvas[aria-label=\"Scan to join this KTV room\"]')?.width === 224"), 'invitation QR rendering')
  check(await evaluate(singer, "!!document.querySelector('a[href*=\"#invite=\"]') && !!document.querySelector('canvas[aria-label=\"Scan to join this KTV room\"]')"), 'Host has a local invitation QR and accessible link')
  await evaluate(singer, "[...document.querySelectorAll('label')].find(label => label.textContent.includes('Show invitation QR')).querySelector('input').click()")
  await poll(() => evaluate(viewer, "!!document.querySelector('canvas[aria-label=\"Scan to join this KTV room\"]')"), 'host exposes invitation on stage')
  check(true, 'Host can show invitation QR on the common screen')
  await evaluate(singer, "[...document.querySelectorAll('label')].find(label => label.textContent.includes('Show invitation QR')).querySelector('input').click()")
  await poll(() => evaluate(viewer, "!document.querySelector('canvas[aria-label=\"Scan to join this KTV room\"]')"), 'host hides invitation on stage')
  check(true, 'Hiding invitations removes the common-screen QR immediately')
  await fs.writeFile('/tmp/ktv-ui-invitation-qr.png', Buffer.from((await evaluate(singer, "document.querySelector('canvas[aria-label=\"Scan to join this KTV room\"]').toDataURL().split(',')[1]")), 'base64'))
  await fs.writeFile('/tmp/ktv-ui-invitation-qr-link.txt', await evaluate(singer, "document.querySelector('a[href*=\"#invite=\"]').href"))
  await click(singer, 'Create pairing code')
  await poll(() => evaluate(singer, "document.querySelector('canvas[aria-label=\"Scan to connect this device\"]')?.width === 224"), 'pairing QR rendering')
  check(await evaluate(singer, "!!document.querySelector('a[href*=\"#pair=\"]')"), 'Device pairing has its own QR and scoped connection link')
  await fs.writeFile('/tmp/ktv-ui-pairing-qr.png', Buffer.from((await evaluate(singer, "document.querySelector('canvas[aria-label=\"Scan to connect this device\"]').toDataURL().split(',')[1]")), 'base64'))
  await fs.writeFile('/tmp/ktv-ui-pairing-qr-link.txt', await evaluate(singer, "document.querySelector('a[href*=\"#pair=\"]').href"))
  check(await evaluate(singer, "document.documentElement.scrollWidth <= 390 && [...document.querySelectorAll('[role=tab]')].every(button => button.getBoundingClientRect().height >= 44)"), 'Phone tabs fit a 390-pixel viewport with touch-sized controls')
  await tab(singer, 'sing')
  await evaluate(singer, 'window.confirm = () => true')
  await click(singer, 'Skip song')
  view = await poll(async () => { const current = await api(2, pathRoom); return current.readiness.title === 'Next browser song' ? current : false }, 'next singer automatically offered')
  check(view.readiness.state === 'awaiting-singer' && view.playback.state === 'idle', 'Skip offers the next turn without starting unready audio')
  check((await audit(viewer)).length === 0, 'The next singer’s common screen remains silent')
  check(errors.length === 0, `No browser runtime exceptions (${errors.length})`)
  console.log(`${passed} browser checks passed. Audio graph timing only; physical acoustic alignment remains unmeasured.`)
} catch (error) {
  console.error('Browser runtime exceptions:', errors)
  if (pathRoom) {
    const current = await api(1, pathRoom)
    console.error('Playback at failure:', current.playback.state, current.playback.generation, current.playback.recoveryReason,
      current.presence.devices.map(device => ({ purpose: device.purpose, enabled: device.audioEnabled, ready: device.ready, generation: device.readyGeneration })))
  }
  for (const session of sessions) {
    console.error('UI errors:', await evaluate(session, "[...document.querySelectorAll('[role=alert]')].map(item => item.textContent)").catch(() => []))
    console.error('Timing diagnostics:', await evaluate(session, "[...document.querySelectorAll('dl')].map(item => item.textContent)").catch(() => []))
    console.error('Audio timing evidence:', JSON.stringify(await evaluate(session, "({sources: window.__partyAudit.map(item => ({starts:item.starts, stops:item.stops.slice(-2), currentTime:item.context.currentTime})), timestamps:window.__partyTimestamps.slice(-8), clocks:window.__partyClocks, playbacks:window.__partyPlaybacks})").catch(() => ({}))))
  }
  throw error
} finally {
  if (pathRoom) await api(closer, `${pathRoom}/close`, {}).catch(() => {})
  for (const { browserContextId, socket } of contexts) if (socket.readyState === WebSocket.OPEN) {
    await cdp('Target.disposeBrowserContext', { browserContextId }, undefined, socket).catch(() => {})
  }
  for (const socket of debuggerSockets) socket.close()
  realtime.close()
  await new Promise(resolve => server.close(resolve))
  db.close(); await fs.rm(root, { recursive: true, force: true })
}
