// Built-app UI acceptance with real isolated room routes and native Chrome DOM.
// Viewport emulation is layout evidence, not physical phone/audio acceptance.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import express from '../server/node_modules/express/index.js'
import WebSocket from '../server/node_modules/ws/wrapper.mjs'
import { initDb } from '../server/db.js'
import { registerKtvRoutes } from '../server/ktv-routes.js'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-ui-')), db = initDb(root)
const app = express(), contexts = [], pending = new Map(), errors = []
const extraFixtures = []
let socket, nextId = 0, passed = 0
let malformedRoomList = null
for (let i = 1; i <= 3; i++) db.prepare("INSERT INTO users (username, kind, created_at) VALUES (?, 'guest', ?)").run(`ui-${i}`, new Date().toISOString())
app.use(express.json())
const auth = (req, res, next) => {
  const id = Number(req.headers.authorization?.replace('Bearer ', ''))
  if (!Number.isInteger(id) || id < 1 || id > 3) return res.sendStatus(401)
  req.auth = { sub: id }; next()
}
const user = id => ({ id, username: `ui-${id}`, name: `UI ${id}`, role: 'user', kind: 'guest' })
app.get('/api/auth/me', auth, (req, res) => res.json({ success: true, data: user(req.auth.sub) }))
app.post('/api/auth/guest', (_req, res) => res.json({ success: true, data: { token: '1', user: user(1) } }))
app.get('/api/dig/songs', (_req, res) => res.json({ success: true, data: [] }))
app.get('/api/categories', (_req, res) => res.json({ success: true, data: { categories: [], assignments: [], lockedSongIds: [] } }))
app.get('/data/song_number.txt', (_req, res) => res.type('text').send('1'))
app.get('/data/metadata.json', (_req, res) => res.json({ '1': { title: 'Layout song', duration: 60 } }))
app.get('/karaoke/karaoke_manifest.json', (_req, res) => res.json({ version: 1, ids: [1] }))
app.get('/api/ktv/rooms', (_req, res, next) => {
  if (malformedRoomList === 'html') return res.type('html').send('<!doctype html><title>private-proxy-response</title>')
  if (malformedRoomList === 'object') return res.json({ success: true, data: {} })
  next()
})
const realtime = registerKtvRoutes(app, { db, authMiddleware: auth, secret: 'isolated-ui-only-secret', isKaraokeSong: id => id === 1 })
const appRoot = path.resolve(process.env.KTV_UI_TEST_DIST_ROOT || 'dist')
app.use(express.static(appRoot)); app.get('*', (_req, res) => res.sendFile(path.join(appRoot,'index.html')))
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); realtime.attach(server)
const origin = `http://127.0.0.1:${server.address().port}`
const check = (condition, label) => { assert.ok(condition, label); passed++; console.log(`PASS ${label}`) }
async function api(actor, route, body) {
  const response = await fetch(origin + '/api/ktv' + route, { method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${actor}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify({ commandId: randomUUID(), ...body }) : undefined })
  const data = await response.json(); assert.ok(response.ok, data.code || route); return data.data
}
function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)) }, 15000)
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value) }, reject(error) { clearTimeout(timer); reject(error) } })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}
async function evaluate(sessionId, expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function poll(work, label) {
  for (let i = 0; i < 150; i++) { if (await work()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error('UI timeout: ' + label)
}
async function page(actor, route, language = 'en', width = 320, siteOrigin = origin) {
  const { browserContextId } = await cdp('Target.createBrowserContext'); contexts.push(browserContextId)
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true })
  await cdp('Page.enable', {}, sessionId); await cdp('Runtime.enable', {}, sessionId)
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: 740, deviceScaleFactor: 1, mobile: true }, sessionId)
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('auth_token', '${actor}'); localStorage.setItem('language', '${language}');` }, sessionId)
  if (process.env.KTV_UI_TEST_WAKE_LOCK === '1') {
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__partyWakeAudit = { requests: 0, acquired: 0, releases: 0, handles: [] };
      if (navigator.wakeLock) {
        const native = navigator.wakeLock.request.bind(navigator.wakeLock);
        navigator.wakeLock.request = async type => {
          window.__partyWakeAudit.requests++;
          const handle = await native(type);
          window.__partyWakeAudit.acquired++; window.__partyWakeAudit.handles.push(handle);
          handle.addEventListener('release', () => window.__partyWakeAudit.releases++);
          return handle;
        };
      }
    ` }, sessionId)
  }
  await cdp('Page.navigate', { url: siteOrigin + route }, sessionId)
  await poll(() => evaluate(sessionId, '!!document.querySelector(".party-page")'), 'party page')
  return sessionId
}
async function featureFixture(features) {
  const directory = path.join(root, randomUUID()), database = initDb(directory)
  database.prepare("INSERT INTO users (username, kind, created_at) VALUES ('ui-1', 'guest', ?)").run(new Date().toISOString())
  const app = express(); app.use(express.json())
  app.get('/api/auth/me', auth, (_req, res) => res.json({ success: true, data: user(1) }))
  app.post('/api/auth/guest', (_req, res) => res.json({ success: true, data: { token: '1', user: user(1) } }))
  const realtime = registerKtvRoutes(app, { db: database, authMiddleware: auth, features,
    secret: 'feature-ui-only-secret', isKaraokeSong: () => true })
  app.get('/api/*', (_req, res) => res.json({ success: true, data: [] }))
  app.use(express.static(appRoot)); app.get('*', (_req, res) => res.sendFile(path.join(appRoot,'index.html')))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); realtime.attach(server)
  extraFixtures.push({ database, realtime, server })
  return { database, realtime, origin: `http://127.0.0.1:${server.address().port}` }
}
async function layout(session, label) {
  const result = await evaluate(session, `(() => {
    const root = document.querySelector('.party-page');
    const controls = [...root.querySelectorAll('button,a,input:not([type=checkbox]):not([type=radio]),select,summary')].filter(item => item.getClientRects().length);
    return { width:innerWidth, scroll:root.scrollWidth, available:root.clientWidth,
      small:controls.filter(item => item.getBoundingClientRect().height < 43.5).map(item => item.textContent.trim() || item.id),
      unnamed:controls.filter(item => { if (['INPUT','SELECT'].includes(item.tagName)) return !item.labels?.length && !item.getAttribute('aria-label') && !item.getAttribute('aria-labelledby'); return !item.textContent.trim() && !item.getAttribute('aria-label'); }).map(item => item.id || item.tagName) };
  })()`)
  check(result.scroll <= result.available + 1, `${label}: no horizontal overflow (${result.scroll}/${result.available})`)
  check(result.small.length === 0, `${label}: controls have 44px targets (${result.small.join(',')})`)
  check(result.unnamed.length === 0, `${label}: controls have accessible names (${result.unnamed.join(',')})`)
}
try {
  const info = await (await fetch(process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9230/json/version')).json()
  socket = new WebSocket(info.webSocketDebuggerUrl); await once(socket, 'open')
  socket.on('message', raw => { const message = JSON.parse(raw); if (message.id) { const task = pending.get(message.id); if (!task) return; pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result) }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text) })
  console.log('Browser:', info.Browser)
  const room = await api(1, '/rooms', { name: '长房间名称' + 'W'.repeat(40), displayName: 'H'.repeat(40), approvalRequired: false })
  const guest = await api(2, '/join', { code: room.invitationCode, displayName: '歌手' + 'S'.repeat(35) })
  await api(2, `/rooms/${room.room.id}/queue`, { songId: 1, title: '长歌曲名称' + 'Q'.repeat(70), requestNext: false, singerMemberId: guest.self.id })
  const home = await page(1, '/party'); await poll(() => evaluate(home, '!!document.getElementById("party-room-name")'), 'create form')
  await layout(home, '320px home')
  let failedHome
  for (const [payload, language] of [['html', 'en'], ['object', 'zh']]) {
    malformedRoomList = payload
    failedHome = await page(1, '/party', language)
    await poll(() => evaluate(failedHome, "!!document.querySelector('[role=alert]')"), 'malformed room response recovery message')
    check(await evaluate(failedHome, "!!document.getElementById('party-room-name') && !document.body.innerText.includes('private-proxy-response')"),
      `${language}: malformed ${payload} room response leaves the form available without rendering response details`)
  }
  malformedRoomList = null
  await cdp('Page.reload', {}, failedHome)
  await poll(() => evaluate(failedHome, `!!document.getElementById('party-room-name') && !document.querySelector('[role=alert]') && document.body.innerText.includes(${JSON.stringify(room.room.name)})`), 'room list recovers on a valid reload')
  check(true, 'valid room response restores the existing room list after a malformed response')
  const join = await page(3, '/party/join', 'zh'); await poll(() => evaluate(join, '!!document.getElementById("party-code")'), 'join form')
  await layout(join, '320px Chinese join')
  await evaluate(join, `(() => { const input=document.getElementById('party-code'); input.value='ZZZZZZZZ'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
  await poll(() => evaluate(join, '!!document.querySelector("[role=alert]")'), 'invalid invite recovery')
  check(await evaluate(join, "document.querySelector('[role=alert]').textContent.includes('邀请码') && !document.querySelector('[role=alert]').textContent.includes('Invalid')"), 'Chinese invitation failure is translated')
  const pair = await page(3, '/party/pair'); await layout(pair, '320px pairing')
  const host = await page(1, `/party/${room.room.id}`)
  await poll(() => evaluate(host, '!!document.getElementById("party-tab-songs")'), 'host tabs')
  await layout(host, '320px host Songs')
  if (process.env.KTV_UI_TEST_WAKE_LOCK === '1') {
    await poll(() => evaluate(host, "document.getElementById('party-keep-screen-awake')?.checked && window.__partyWakeAudit.acquired === 1"), 'default native room wake lock')
    check(await evaluate(host, "window.__partyWakeAudit.handles.some(handle => !handle.released)"), 'Room defaults to a real native screen wake lock without playing a song')
    await evaluate(host, "document.getElementById('party-keep-screen-awake').click()")
    await poll(() => evaluate(host, "window.__partyWakeAudit.releases === 1 && localStorage.getItem('party-keep-screen-awake') === 'false'"), 'disable releases native lock')
    check(await evaluate(host, "!document.getElementById('party-keep-screen-awake').checked"), 'Room header lets the user disable sleep prevention')
    await cdp('Page.reload', {}, host)
    await poll(() => evaluate(host, "!!document.getElementById('party-tab-songs') && !document.getElementById('party-keep-screen-awake').checked"), 'off choice survives room reload')
    check(await evaluate(host, 'window.__partyWakeAudit.requests === 0'), 'Reload preserves an off preference without requesting another native lock')
    await evaluate(host, "document.getElementById('party-keep-screen-awake').click()")
    await poll(() => evaluate(host, 'window.__partyWakeAudit.acquired === 1'), 'explicit enable native lock')
    check(true, 'Re-enabling the header control acquires a native screen wake lock')
    await evaluate(host, "document.querySelector('.party-room a[href=\"/party\"]').click()")
    await poll(() => evaluate(host, "!!document.getElementById('party-room-name') && window.__partyWakeAudit.handles.every(handle => handle.released)"), 'leaving releases native lock')
    check(true, 'Leaving the room releases its native wake lock')
    await cdp('Page.navigate', { url: origin + `/party/${room.room.id}` }, host)
    await poll(() => evaluate(host, "!!document.getElementById('party-tab-songs') && window.__partyWakeAudit.acquired === 1"), 'returning room lock')
    check(true, 'Returning to the room restores the enabled preference and native wake lock')
  }
  const tree = await cdp('Accessibility.getFullAXTree', {}, host)
  check(tree.nodes.some(node => node.role?.value === 'tab' && node.name?.value === 'Songs'), 'native accessibility tree exposes named Songs tab')
  await evaluate(host, "document.getElementById('party-tab-songs').focus()")
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' }, host)
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' }, host)
  await poll(() => evaluate(host, "document.getElementById('party-tab-queue').getAttribute('aria-selected')==='true'"), 'keyboard queue selection')
  check(await evaluate(host, "document.activeElement.id === 'party-tab-queue' && getComputedStyle(document.activeElement).outlineStyle === 'solid'"), 'arrow navigation moves keyboard focus with visible outline')
  await layout(host, '320px host Queue with long title')
  await evaluate(host, "document.getElementById('party-tab-people').click()")
  await layout(host, '320px host People')
  const phone = await page(2, `/party/${room.room.id}`, 'zh')
  await poll(() => evaluate(phone, '!!document.getElementById("party-tab-people")'), 'Chinese controller tabs')
  await evaluate(phone, "document.getElementById('party-tab-people').click()")
  await layout(phone, '320px Chinese guest People')
  if (process.env.KTV_UI_TEST_WAKE_LOCK === '1') check(await evaluate(phone, "document.getElementById('party-keep-screen-awake').checked && document.querySelector('label[for=\"party-keep-screen-awake\"], label:has(#party-keep-screen-awake)').textContent.includes('保持屏幕常亮')"), 'Ordinary singer has a translated default-on screen control')
  check(await evaluate(phone, "!document.body.innerText.includes('关闭房间')"), 'ordinary guest omits host-only close control')
  const stage = await page(1, `/party/${room.room.id}/stage`, 'en', 1280)
  await poll(() => evaluate(stage, 'document.body.innerText.includes("Shared stage")'), 'common stage')
  await layout(stage, '1280px shared stage')
  if (process.env.KTV_UI_TEST_WAKE_LOCK === '1') {
    await poll(() => evaluate(stage, 'window.__partyWakeAudit.acquired === 1'), 'shared stage native lock')
    check(await evaluate(stage, "document.getElementById('party-keep-screen-awake').checked"), 'Shared screen also defaults to a native wake lock')
  }
  const disabled = await featureFixture({ rooms: false })
  for (const language of ['en', 'zh']) for (const route of ['/party', '/party/join', '/party/pair']) {
    const session = await page(1, route, language, 320, disabled.origin)
    await poll(() => evaluate(session, '!!document.querySelector("[role=alert]")'), 'disabled room status')
    check(await evaluate(session, `document.querySelector('[role=alert]').textContent.includes(${JSON.stringify(language === 'en' ? 'temporarily unavailable' : '暂时不可用')}) && document.querySelector('form button[type=submit]').disabled`), `${language} ${route}: translated unavailable state and disabled submission`)
  }
  check(disabled.database.prepare('SELECT COUNT(*) total FROM ktv_rooms').get().total === 0, 'disabled room pages create no rooms')
  const noGuide = await featureFixture({ guide: false })
  const response = await fetch(noGuide.origin + '/api/ktv/rooms', { method: 'POST', headers: { Authorization: 'Bearer 1', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Backing only', displayName: 'Host' }) })
  const view = (await response.json()).data
  for (const language of ['en', 'zh']) {
    const session = await page(1, `/party/${view.room.id}`, language, 320, noGuide.origin)
    await poll(() => evaluate(session, '!!document.getElementById("party-tab-sing")'), 'guide flag controller tabs')
    await evaluate(session, "document.getElementById('party-tab-sing').click()")
    const text = language === 'en' ? 'Private vocal guides are temporarily unavailable' : '私人原唱提示暂时不可用'
    await poll(() => evaluate(session, `document.body.innerText.includes(${JSON.stringify(text)})`), 'guide disabled hint')
    check(await evaluate(session, `!document.body.innerText.includes(${JSON.stringify(language === 'en' ? 'Enable private vocal guide' : '启用私人原唱指导')})`), `${language} controller explains guide unavailability`)
  }
  const roomText = '<svg onload=window.__partyInjected=1>', memberText = '<img src=x onerror=__partyInjected=1>'
  const songText = '<img src=x onerror=window.__partyInjected=1>'
  const escaped = await api(1, '/rooms', { name: roomText, displayName: memberText, approvalRequired: false })
  await api(2, '/join', { code: escaped.invitationCode, displayName: memberText })
  await api(2, `/rooms/${escaped.room.id}/queue`, { songId: 1, title: songText, requestNext: false })
  async function literalText(session, value, label) {
    await poll(() => evaluate(session, `document.body.textContent.includes(${JSON.stringify(value)})`), label)
    check(await evaluate(session, `window.__partyInjected === undefined && !document.querySelector('.party-page [onload], .party-page [onerror]')`), label)
  }
  const escapedHome = await page(1, '/party')
  await literalText(escapedHome, roomText, 'room list renders supplied markup as literal text')
  const escapedPhone = await page(1, `/party/${escaped.room.id}`)
  await poll(() => evaluate(escapedPhone, '!!document.getElementById("party-tab-people")'), 'escaped room tabs')
  await evaluate(escapedPhone, "document.getElementById('party-tab-people').click()")
  await literalText(escapedPhone, memberText, 'people list renders supplied member markup as literal text')
  await evaluate(escapedPhone, "document.getElementById('party-tab-queue').click()")
  await literalText(escapedPhone, songText, 'queue renders supplied song markup as literal text')
  const escapedStage = await page(1, `/party/${escaped.room.id}/stage`, 'en', 1280)
  await literalText(escapedStage, roomText, 'shared stage renders supplied room markup as literal text')
  check(errors.length === 0, 'no native browser runtime exceptions')
  console.log(`${passed} built-app UI checks passed. Emulated layout and keyboard only; no physical audio/browser matrix claim.`)
} finally {
  for (const browserContextId of contexts) if (socket?.readyState === WebSocket.OPEN) await cdp('Target.disposeBrowserContext', { browserContextId }).catch(() => {})
  socket?.close(); realtime.close()
  for (const fixture of extraFixtures) {
    fixture.realtime.close()
    await new Promise(resolve => { fixture.server.close(resolve); fixture.server.closeAllConnections() })
    fixture.database.close()
  }
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  db.close(); await fs.rm(root, { recursive: true, force: true })
}
