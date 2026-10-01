// Built app and generated worker in one isolated Chrome context. The legacy
// worker deliberately caches room state to exercise an installed-client upgrade.
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import path from 'node:path'
import WebSocket from '../server/node_modules/ws/wrapper.mjs'

const port = Number(process.env.CHROME_DEBUG_URL?.split(':').at(-1) || 9231)
const appRoot = path.resolve('dist'), pending = new Map()
let nextId = 0, passed = 0, browser, browserContextId, sessionId, server
let roomsEnabled = true
const check = (value, label) => { assert.ok(value, label); passed++; console.log(`PASS ${label}`) }
const poll = async (work, label, timeout = 30000) => {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    try { if (await work()) return } catch (error) {
      if (!/Execution context was destroyed|Cannot find context with specified id|Inspected target navigated/.test(error.message)) throw error
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${label}`)
}
function cdp(method, params = {}, target = sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
    browser.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }))
  })
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}

const legacyWorker = `
  const cacheName = 'legacy-ktv-test';
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', event => {
    const route = new URL(event.request.url).pathname;
    if (event.request.method !== 'GET' || !route.startsWith('/api/ktv')) return;
    event.respondWith((async () => {
      const cache = await caches.open(cacheName), old = await cache.match(event.request);
      if (old) return old;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    })());
  });`
try {
  const express = (await import('../server/node_modules/express/index.js')).default
  const app = express()
  app.get('/api/auth/me', (req, res) => res.json({ success: true, data: { id: 3, username: 'pwa-guest', name: 'PWA guest', kind: 'guest', role: 'user' } }))
  app.get('/api/dig/songs', (req, res) => res.json({ success: true, data: [] }))
  app.get('/api/categories', (req, res) => res.json({ success: true, data: { categories: [], assignments: [], lockedSongIds: [] } }))
  app.get('/api/ktv/rooms/fixture', (req, res) => res.set('Cache-Control', 'no-store').json({ success: true, data: { room: 'fresh' } }))
  app.get('/api/ktv/features', (_req, res) => res.set('Cache-Control', 'no-store').json({ success: true, data: { rooms: roomsEnabled, guide: roomsEnabled, media: false } }))
  app.get('/data/song_number.txt', (req, res) => res.type('text').send('0'))
  app.get('/data/metadata.json', (req, res) => res.json({}))
  app.get('/karaoke/karaoke_manifest.json', (req, res) => res.json({ version: 1, ids: [] }))
  app.get('/karaoke/fixture.mp3', (req, res) => res.type('audio/mpeg').send(Buffer.from('fixture-audio')))
  app.get('/sw-legacy.js', (req, res) => res.type('application/javascript').send(legacyWorker))
  app.use(express.static(appRoot))
  app.get('*', (req, res) => res.sendFile(path.join(appRoot, 'index.html')))
  server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  browser = new WebSocket(info.webSocketDebuggerUrl); await once(browser, 'open')
  browser.on('message', raw => {
    const result = JSON.parse(raw); if (!result.id) return
    const item = pending.get(result.id); if (!item) return
    pending.delete(result.id); result.error ? item.reject(new Error(result.error.message)) : item.resolve(result.result)
  })
  ;({ browserContextId } = await cdp('Target.createBrowserContext', {}, null))
  const { targetId } = await cdp('Target.createTarget', { browserContextId, url: 'about:blank' }, null)
  ;({ sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true }, null))
  await cdp('Page.enable'); await cdp('Runtime.enable')
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('auth_token','3'); localStorage.setItem('language','en');" })
  await cdp('Page.navigate', { url: origin + '/party' })
  await poll(() => evaluate("!!document.getElementById('party-room-name')"), 'built party entry opens')
  await poll(() => evaluate("navigator.serviceWorker?.getRegistrations().then(items => items.some(item => item.active?.state === 'activated'))"), 'generated worker installs')
  let oldTime = await evaluate('performance.timeOrigin')
  await cdp('Page.reload')
  await poll(() => evaluate(`performance.timeOrigin !== ${oldTime} && !!navigator.serviceWorker?.controller && !!document.getElementById('party-room-name')`),
    'room entry reload is controlled by the generated worker')
  const stateUrl = '/api/ktv/rooms/fixture', assetUrl = '/karaoke/fixture.mp3?ktvAsset=fixture'
  check(await evaluate(`Promise.all([fetch('${stateUrl}'),fetch('${assetUrl}')]).then(items=>items.every(item=>item.ok))`),
    'worker-controlled page fetches live room state and party audio')
  check(await evaluate("fetch('/api/ktv/features').then(async response=>response.headers.get('cache-control')==='no-store' && (await response.json()).data.rooms===true)"),
    'worker-controlled page receives live no-store feature flags')
  roomsEnabled = false
  check(await evaluate("fetch('/api/ktv/features').then(response=>response.json()).then(result=>result.data.rooms===false && result.data.guide===false)"),
    'operator disablement cannot replay cached feature availability')
  roomsEnabled = true
  check(await evaluate(`(async () => { const keys = await caches.keys(), entries = (await Promise.all(keys.map(async key => (await caches.open(key)).keys()))).flat();
    return !entries.some(item => new URL(item.url).pathname.startsWith('/api/ktv') || new URL(item.url).searchParams.has('ktvAsset')) })()`),
    'current worker stores no room credentials or party audio')
  await cdp('Network.enable')
  try {
    await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    check(await evaluate(`Promise.all(['${stateUrl}','${assetUrl}','/api/ktv/features'].map(async url => {try {await fetch(url); return false} catch{return true}})).then(values=>values.every(Boolean))`),
      'offline worker cannot replay old room authority or party audio')
  } finally { await cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }) }
  const currentWorkerUrl = await evaluate('navigator.serviceWorker.controller.scriptURL')
  await evaluate("navigator.serviceWorker.register('/sw-legacy.js', {scope:'/'})")
  await poll(() => evaluate("navigator.serviceWorker.controller?.scriptURL.includes('/sw-legacy.js')"), 'installed legacy worker controls the page')
  check(await evaluate(`Promise.all([fetch('${stateUrl}'),fetch('/api/ktv/features')]).then(items=>items.every(item=>item.ok))`), 'legacy worker can fetch the room and feature flags')
  check(await evaluate("caches.open('legacy-ktv-test').then(cache=>cache.keys()).then(keys=>keys.some(item=>new URL(item.url).pathname.startsWith('/api/ktv')))"),
    'legacy worker caches a room response in the upgrade fixture')
  await evaluate(`navigator.serviceWorker.register(${JSON.stringify(currentWorkerUrl)}, {updateViaCache:'none'})`)
  await poll(() => evaluate("(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting && !![...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='Update'))()"),
    'new worker offers an explicit update')
  oldTime = await evaluate('performance.timeOrigin')
  await evaluate("[...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='Update').click(); true").catch(() => {})
  await poll(() => evaluate(`performance.timeOrigin !== ${oldTime} && !!navigator.serviceWorker?.controller?.scriptURL.includes('/sw.js') && !!document.getElementById('party-room-name')`),
    'update activates the new worker and reloads the room entry')
  check(await evaluate("caches.open('legacy-ktv-test').then(cache=>cache.keys()).then(keys=>!keys.some(item=>new URL(item.url).pathname.startsWith('/api/ktv')))"),
    'upgraded party page removes cached room authority')
  console.log(`${passed} PWA browser checks passed. Isolated synthetic legacy worker and local frontend only.`)
} catch (error) {
  const state = await evaluate(`(async () => {
    const registration = await navigator.serviceWorker?.getRegistration();
    return { timeOrigin: performance.timeOrigin, controller: navigator.serviceWorker?.controller?.scriptURL,
      active: registration?.active?.state, waiting: registration?.waiting?.state, installing: registration?.installing?.state,
      entry: !!document.getElementById('party-room-name'),
      updateButton: !![...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='Update') };
  })()`).catch(() => null)
  console.error('PWA failure state:', JSON.stringify(state))
  throw error
} finally {
  if (browser?.readyState === WebSocket.OPEN && browserContextId) await cdp('Target.disposeBrowserContext', { browserContextId }, null).catch(() => {})
  browser?.close()
  if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
}
