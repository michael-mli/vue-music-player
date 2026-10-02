// Built app and generated worker in one isolated Chrome context. The legacy
// worker deliberately caches room state to exercise an installed-client upgrade.
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import path from 'node:path'
import WebSocket from '../server/node_modules/ws/wrapper.mjs'

const port = Number(process.env.CHROME_DEBUG_URL ? new URL(process.env.CHROME_DEBUG_URL).port : 9231)
assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'Invalid owned Chrome debugging port')
const appRoot = path.resolve('dist'), pending = new Map()
const failures = [], requests = new Map()
let probeStep = 'initial entry'
const noteFailure = item => { failures.push({ step: probeStep, ...item }); if (failures.length > 16) failures.shift() }
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
  app.get('/api/ktv/rooms', (_req, res) => res.set('Cache-Control', 'no-store').json({ success: true, data: [] }))
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
    const result = JSON.parse(raw)
    if (result.method === 'Network.requestWillBeSent' && result.sessionId === sessionId) {
      // Fixture paths only; omit queries, headers, bodies and credentials.
      const url = new URL(result.params.request.url)
      if (url.origin === origin) requests.set(result.params.requestId, url.pathname)
      if (requests.size > 128) requests.delete(requests.keys().next().value)
    }
    if (result.method === 'Network.loadingFailed' && result.sessionId === sessionId) {
      noteFailure({ path: requests.get(result.params.requestId), type: result.params.type, error: result.params.errorText })
    }
    if (result.method === 'Network.responseReceived' && result.sessionId === sessionId) {
      const response = result.params.response, path = requests.get(result.params.requestId)
      if (path && (response.status >= 400 || result.params.type === 'Script' && !/javascript/.test(response.mimeType))) {
        noteFailure({ path, type: result.params.type, status: response.status, mime: response.mimeType })
      }
    }
    if (result.method === 'Runtime.exceptionThrown' && result.sessionId === sessionId) {
      noteFailure({ exception: result.params.exceptionDetails.text })
    }
    if (result.method === 'Runtime.consoleAPICalled' && result.sessionId === sessionId && result.params.type === 'error') {
      noteFailure({ console: result.params.args.map(arg => String(arg.value ?? arg.description ?? arg.type)
        .split('\n')[0].replace(/https?:\/\/\S+/g, '[url]').slice(0, 160)).slice(0, 3) })
    }
    if (!result.id) return
    const item = pending.get(result.id); if (!item) return
    pending.delete(result.id); result.error ? item.reject(new Error(result.error.message)) : item.resolve(result.result)
  })
  ;({ browserContextId } = await cdp('Target.createBrowserContext', {}, null))
  const { targetId } = await cdp('Target.createTarget', { browserContextId, url: 'about:blank' }, null)
  ;({ sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true }, null))
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable')
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('auth_token','3'); localStorage.setItem('language','en');
    window.__pwaCacheEvidence = [];
    if (${process.env.KTV_PWA_TEST_CACHE_DIAGNOSTICS === '1'}) for (const [object, names] of [[CacheStorage.prototype,['keys','open']],[Cache.prototype,['keys','delete']]]) {
      for (const name of names) {
        const original = object[name];
        object[name] = function(...args) {
          const event = {operation:name, started:performance.now(), state:'pending'};
          __pwaCacheEvidence.push(event);if(__pwaCacheEvidence.length>24)__pwaCacheEvidence.shift();
          return original.apply(this,args).then(value=>{event.state='done';event.ended=performance.now();return value},
            error=>{event.state='failed';event.ended=performance.now();throw error});
        };
      }
    }` })
  await cdp('Page.navigate', { url: origin + '/party' })
  await poll(() => evaluate("!!document.getElementById('party-room-name')"), 'built party entry opens')
  await poll(() => evaluate("navigator.serviceWorker?.getRegistrations().then(items => items.some(item => item.active?.state === 'activated'))"), 'generated worker installs')
  let oldTime = await evaluate('performance.timeOrigin')
  probeStep = 'generated worker reload'
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
  probeStep = 'offline authority check'
  try {
    await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    check(await evaluate(`Promise.all(['${stateUrl}','${assetUrl}','/api/ktv/features'].map(async url => {try {await fetch(url); return false} catch{return true}})).then(values=>values.every(Boolean))`),
      'offline worker cannot replay old room authority or party audio')
  } finally { await cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }) }
  const currentWorkerUrl = await evaluate('navigator.serviceWorker.controller.scriptURL')
  probeStep = 'legacy worker install'
  await evaluate("navigator.serviceWorker.register('/sw-legacy.js', {scope:'/'})")
  await poll(() => evaluate("navigator.serviceWorker.controller?.scriptURL.includes('/sw-legacy.js')"), 'installed legacy worker controls the page')
  check(await evaluate(`Promise.all([fetch('${stateUrl}'),fetch('/api/ktv/features')]).then(items=>items.every(item=>item.ok))`), 'legacy worker can fetch the room and feature flags')
  check(await evaluate("caches.open('legacy-ktv-test').then(cache=>cache.keys()).then(keys=>keys.some(item=>new URL(item.url).pathname.startsWith('/api/ktv')))"),
    'legacy worker caches a room response in the upgrade fixture')
  await evaluate(`navigator.serviceWorker.register(${JSON.stringify(currentWorkerUrl)}, {updateViaCache:'none'})`)
  probeStep = 'new worker offer'
  await poll(() => evaluate("(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting && !![...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='Update'))()"),
    'new worker offers an explicit update')
  oldTime = await evaluate('performance.timeOrigin')
  probeStep = 'blocked update activation'
  await evaluate(`(async () => {
    const worker = (await navigator.serviceWorker.getRegistration()).waiting;
    window.__blockedUpdateWorker = worker;
    window.__originalUpdatePost = worker.postMessage;
    worker.postMessage = () => {};
  })()`)
  try {
    await evaluate("[...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='Update').click(); true")
    await poll(() => evaluate("!![...document.querySelectorAll('[role=alert]')].find(item=>item.textContent.includes('The update could not finish'))"),
      'activation timeout offers a retry')
    check(await evaluate(`performance.timeOrigin === ${oldTime} && navigator.serviceWorker.controller.scriptURL.includes('/sw-legacy.js')`),
      'blocked activation keeps the current page and worker instead of blindly reloading')
    check(await evaluate("[...document.querySelectorAll('button')].some(item=>item.textContent.trim()==='Update' && !item.disabled)"),
      'activation failure restores the enabled update button')
  } finally { await evaluate('__blockedUpdateWorker.postMessage = __originalUpdatePost; true') }
  probeStep = 'explicit update activation'
  await evaluate("[...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='Update').click(); true").catch(() => {})
  await poll(() => evaluate(`performance.timeOrigin !== ${oldTime} && !!navigator.serviceWorker?.controller?.scriptURL.includes('/sw.js') && !!document.getElementById('party-room-name')`),
    'update activates the new worker and reloads the room entry')
  check(await evaluate("caches.open('legacy-ktv-test').then(cache=>cache.keys()).then(keys=>!keys.some(item=>new URL(item.url).pathname.startsWith('/api/ktv')))"),
    'upgraded party page removes cached room authority')
  console.log(`${passed} PWA browser checks passed. Isolated synthetic legacy worker and local frontend only.`)
} catch (error) {
  const state = await evaluate(`(async () => {
    const registration = await navigator.serviceWorker?.getRegistration();
    const route = document.querySelector('#app')?.__vue_app__?.config.globalProperties.$route;
    return { timeOrigin: performance.timeOrigin, path: location.pathname, readyState: document.readyState,
      route: route ? {path:route.path, name:route.name, matched:route.matched.map(item=>item.name)} : null,
      appChildren: document.querySelector('#app')?.childElementCount,
      cacheOperations: window.__pwaCacheEvidence,
      text: document.body.innerText.slice(0,400),
      controller: navigator.serviceWorker?.controller?.scriptURL,
      active: registration?.active?.state, waiting: registration?.waiting?.state, installing: registration?.installing?.state,
      entry: !!document.getElementById('party-room-name'),
      updateButton: !![...document.querySelectorAll('button')].find(item=>item.textContent.trim()==='Update') };
  })()`).catch(() => null)
  console.error('PWA failure state:', JSON.stringify(state))
  console.error('PWA fixture failures:', JSON.stringify(failures))
  throw error
} finally {
  if (browser?.readyState === WebSocket.OPEN && browserContextId) await cdp('Target.disposeBrowserContext', { browserContextId }, null).catch(() => {})
  browser?.close()
  if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
}
