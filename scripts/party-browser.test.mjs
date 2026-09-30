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
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-browser-'))
const db = initDb(root)
const app = express()
app.use(express.json())
for (let id = 1; id <= 3; id++) db.prepare("INSERT INTO users (username, kind, created_at) VALUES (?, 'guest', ?)").run(`browser-${id}`, new Date().toISOString())
const user = id => ({ id, username: `browser-${id}`, name: `Browser ${id}`, role: 'user', kind: 'guest' })
const auth = (req, res, next) => {
  const id = Number(req.headers.authorization?.replace('Bearer ', ''))
  if (!Number.isInteger(id) || id < 1 || id > 3) return res.sendStatus(401)
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
app.use(express.static(path.join(repo, 'dist')))
app.get('*', (req, res) => res.sendFile(path.join(repo, 'dist/index.html')))
const server = app.listen(0, '127.0.0.1')
realtime.attach(server)
await new Promise(resolve => server.once('listening', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const contexts = [], errors = [], sessions = []
let debuggerSocket, nextId = 0, passed = 0
const pending = new Map()
async function api(actor, route, body) {
  const response = await fetch(`${origin}/api/ktv${route}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await response.json(); assert.ok(response.ok, `${route}: ${json.code || response.status}`); return json.data
}
function check(condition, label) { assert.ok(condition, label); passed++; console.log(`PASS ${label}`) }
async function poll(work, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const result = await work(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(`Timed out: ${label}`)
}
function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve: result => { clearTimeout(timeout); resolve(result) }, reject: error => { clearTimeout(timeout); reject(error) } })
    debuggerSocket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}
async function evaluate(session, expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, session)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function click(session, text) {
  await poll(() => evaluate(session, `(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(text)} && !item.disabled); if (!button) return false; button.click(); return true })()`), `button ${text}`)
}
async function page(actor, route) {
  const { browserContextId } = await cdp('Target.createBrowserContext')
  contexts.push(browserContextId)
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true })
  sessions.push(sessionId)
  await cdp('Runtime.enable', {}, sessionId); await cdp('Page.enable', {}, sessionId)
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('auth_token', '${actor}'); localStorage.setItem('language', 'en');
    window.__partyAudit = []; window.__partyContexts = [];
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
  await poll(() => evaluate(sessionId, "document.body?.innerText.includes('Live room updates connected')"), 'room connected')
  assert.equal(await evaluate(sessionId, 'document.hidden'), false)
  return sessionId
}
const audit = session => evaluate(session, `window.__partyAudit.map(item => ({ starts: item.starts, stops: item.stops, ended: item.ended, contextTime: item.context.currentTime }))`)
let pathRoom, closer = 1
try {
  const info = await (await fetch(`${process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9229'}/json/version`, { signal: AbortSignal.timeout(3000) })).json()
  console.log(`Browser: ${info.Browser}`)
  debuggerSocket = new WebSocket(info.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { debuggerSocket.once('open', resolve); debuggerSocket.once('error', reject) })
  debuggerSocket.on('message', raw => {
    const packet = JSON.parse(raw)
    if (packet.id) {
      const item = pending.get(packet.id); if (!item) return
      pending.delete(packet.id); packet.error ? item.reject(new Error(packet.error.message)) : item.resolve(packet.result)
    } else if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails.exception?.description || packet.params.exceptionDetails.text)
  })
  let view = await api(1, '/rooms', { name: 'Browser playback party', displayName: 'Host', approvalRequired: false })
  pathRoom = `/rooms/${view.room.id}`
  await api(2, '/join', { code: view.invitationCode, displayName: 'Singer' })
  await api(3, '/join', { code: view.invitationCode, displayName: 'Viewer' })
  const host = await page(1, `/party/${view.room.id}/stage`)
  const singer = await page(2, `/party/${view.room.id}`)
  const viewer = await page(3, `/party/${view.room.id}/stage`)
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
  await click(host, 'Prepare selected song')
  await poll(async () => { const latest = await api(1, pathRoom); return latest.presence.devices.some(device => device.id === latest.playback.stageDeviceId && device.ready) }, 'stage decoded')
  check((await audit(host)).length === 0, 'Preparation does not start backing before a countdown')
  await poll(() => evaluate(singer, `(() => { const label = [...document.querySelectorAll('label')].find(item => item.textContent.includes('Require my vocal guide')); const box = label?.querySelector('input'); if (!box || box.disabled) return false; box.click(); return true })()`), 'require guide control')
  await poll(async () => (await api(1, pathRoom)).playback.guideRequired, 'guide marked required')
  check(await evaluate(host, "[...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Start countdown')?.disabled"), 'Required guide blocks the rendered start control until ready')
  await click(singer, 'Enable private vocal guide')
  await poll(() => evaluate(singer, "document.body.innerText.includes('Audio prepared')"), 'guide decoded')
  await click(host, 'Start countdown')
  await poll(async () => (await api(1, pathRoom)).playback.state === 'playing', 'playing')
  check((await audit(host)).length === 1, 'Designated stage schedules one backing source')
  check((await audit(singer)).length === 1, 'Singer phone schedules its private original source')
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
  check((await api(1, pathRoom)).playback.state === 'playing', 'Optional guide interruption leaves backing playing')
  await click(singer, 'Enable private vocal guide')
  await poll(async () => (await audit(singer)).length === 5, 'guide enabled for output check')
  await click(singer, 'Earlier')
  await poll(() => evaluate(singer, "localStorage.getItem('party-guide-advance-ms') === '25'"), 'guide calibration before output change')
  const stageCount = (await audit(host)).length
  await evaluate(singer, "window.__partyContexts[0].dispatchEvent(new Event('sinkchange'))")
  await poll(() => evaluate(singer, "document.body.innerText.includes('Audio output changed')"), 'guide output change alert')
  check(await evaluate(singer, "localStorage.getItem('party-guide-advance-ms') === '0'"), 'Changing guide output invalidates its old timing correction')
  check((await api(1, pathRoom)).playback.state === 'playing' && (await audit(host)).length === stageCount, 'Optional guide output change preserves healthy backing')
  await poll(async () => (await audit(singer)).every(record => record.ended), 'optional guide stops for output recovery')
  const mutedCount = (await audit(singer)).length
  await new Promise(resolve => setTimeout(resolve, 300))
  check((await audit(singer)).length === mutedCount, 'Changed output cannot restart itself before an explicit retry')
  await click(singer, 'Confirm output and retry')
  await poll(async () => (await audit(singer)).length === mutedCount + 1, 'guide resumes after explicit output confirmation')
  check(true, 'Explicit confirmation reattaches the guide to the live position')
  await click(singer, "Turn off this device's audio")
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
  await poll(() => evaluate(singer, "[...document.querySelectorAll('button')].some(item => item.textContent.trim() === 'Close room')"), 'transferred host controls')
  check(true, 'Transferred host controls update on the remaining phone')
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
    console.error('Playback at failure:', current.playback.state, current.playback.generation,
      current.presence.devices.map(device => ({ purpose: device.purpose, enabled: device.audioEnabled, ready: device.ready, generation: device.readyGeneration })))
  }
  for (const session of sessions) console.error('UI errors:', await evaluate(session, "[...document.querySelectorAll('[role=alert]')].map(item => item.textContent)").catch(() => []))
  throw error
} finally {
  if (pathRoom) await api(closer, `${pathRoom}/close`, {}).catch(() => {})
  if (debuggerSocket?.readyState === WebSocket.OPEN) {
    for (const browserContextId of contexts) await cdp('Target.disposeBrowserContext', { browserContextId }).catch(() => {})
    debuggerSocket.close()
  }
  realtime.close()
  await new Promise(resolve => server.close(resolve))
  db.close(); await fs.rm(root, { recursive: true, force: true })
}
