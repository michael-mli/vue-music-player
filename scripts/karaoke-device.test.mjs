import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const { createPinia, setActivePinia } = require('pinia')
const source = await readFile(new URL('../src/stores/karaokeDevice.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } })
const secret = 'a'.repeat(32), token = 'b'.repeat(32), id = 'c'.repeat(32)
class GuideError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status } }
function setup(request, { expired = false, hash = '' } = {}) {
  let time = 1000, nextTimer = 0
  const timers = new Map(), storage = new Map([['karaoke-device-pair', JSON.stringify({ sessionId: secret, token, deviceId: id, name: 'Phone', expiresAt: expired ? 0 : 10000 })]])
  const exports = {}, window = { location: { href: 'https://music.test/sing/guide' + hash }, history: { state: {}, replaceState() {} },
    setTimeout(work, delay = 0) { const id = ++nextTimer; timers.set(id, { work, at: time + delay }); return id }, clearTimeout(id) { timers.delete(id) } }
  vm.runInNewContext(outputText, { exports, URL, URLSearchParams, performance,
    Date: class extends Date { static now() { return time } },
    localStorage: { getItem: key => storage.get(key) || null, removeItem: key => storage.delete(key), setItem: (key, value) => storage.set(key, value) },
    window, document: { visibilityState: 'visible' }, navigator: { userAgent: 'Test phone' },
    require: name => name === '@/stores/auth' ? { useAuthStore: () => ({ token: 'fixture-identity', async ensureIdentity() {} }) }
      : name === '@/services/karaokeGuideApi' ? { guideRequest: request, KaraokeGuideError: GuideError, karaokeRequestId: () => 'unique-request-id-long' }
      : name === '@/utils/karaokeGuideSync' ? { KaraokeGuideClock: class {} } : require(name) })
  setActivePinia(createPinia())
  const store = exports.useKaraokeDeviceStore()
  return { store, storage, advance(ms) { time += ms }, async tick() {
    const entry = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (entry) { timers.delete(entry[0]); entry[1].work() }
    await new Promise(resolve => setImmediate(resolve))
  } }
}
const reply = () => ({ state: { song: null, playing: false }, hostOnline: true, controlsAvailable: true,
  device: { id, name: 'Phone', canControl: true, status: 'guide', idleRemainingMs: 9000 }, queue: [], commands: [] })

test('saved pairing survives away navigation; only listening and interaction renew activity', async () => {
  const paths = [], response = reply(), f = setup(async (_clock, path) => { paths.push(path); return response })
  f.store.start(); await f.tick()
  assert.match(paths.at(-1), /mode=away&active=0/)
  f.store.setInGuide(true); await f.tick()
  assert.match(paths.at(-1), /mode=guide&active=1/)
  await f.tick(); assert.match(paths.at(-1), /active=0/)
  response.state.playing = true; f.store.listening = true
  await f.tick(); assert.match(paths.at(-1), /active=1/)
  f.store.setInGuide(false); await f.tick(); assert.match(paths.at(-1), /mode=away&active=0/)
  assert.ok(f.storage.has('karaoke-device-pair')); assert.equal(f.store.grant.token, token)
})

test('expired saved grants are cleared; host removal clears persistence on the next response', async () => {
  const expired = setup(async () => reply(), { expired: true })
  assert.equal(expired.store.grant, null); assert.equal(expired.storage.has('karaoke-device-pair'), false)
  const f = setup(async () => { throw new GuideError('removed', 403) })
  f.store.start(); await f.tick()
  assert.equal(f.store.grant, null); assert.equal(f.store.error, 'removed')
  assert.equal(f.storage.has('karaoke-device-pair'), false)
})

test('transient command failures retry the original request ID and accept the host receipt', async () => {
  const posts = [], f = setup(async (_clock, _path, _token, method, body) => {
    if (method !== 'POST') return reply()
    posts.push(body.commandId)
    if (posts.length === 1) throw new GuideError('unavailable', 503)
    return { command: { id: body.commandId, status: 'applied' } }
  })
  f.store.start(); await f.tick(); f.store.command('skip')
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(f.store.pending)
  f.advance(2600); await f.tick(); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(posts, ['unique-request-id-long', 'unique-request-id-long'])
  assert.equal(f.store.pending, null); assert.equal(f.store.commandNotice, 'commandApplied')
})

test('batch enqueue waits for host acknowledgement and reports applied or rejected songs', async () => {
  let acknowledgement
  const f = setup(async (_clock, _path, _token, method, body) => {
    if (method === 'POST') return { command: { id: body.commandId, status: 'pending' } }
    return { ...reply(), commands: acknowledgement ? [acknowledgement] : [] }
  })
  f.store.start(); await f.tick()
  let resolved = false
  const applied = f.store.enqueueSongAndWait(4).then(result => { resolved = true; return result })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(resolved, false)
  assert.equal(f.store.canControl, false)
  acknowledgement = { id: f.store.pending.commandId, status: 'applied' }
  f.store.resume(); await f.tick()
  assert.equal(await applied, true)
  acknowledgement = null
  const rejected = f.store.enqueueSongAndWait(5)
  await new Promise(resolve => setImmediate(resolve))
  acknowledgement = { id: f.store.pending.commandId, status: 'failed', code: 'queueFull' }
  f.store.resume(); await f.tick()
  assert.equal(await rejected, false)
  assert.equal(f.store.commandError, 'queueFull')
})

test('removing a paired device stops an awaiting batch instead of sending its next song', async () => {
  let removed = false
  const f = setup(async (_clock, _path, _token, method, body) => {
    if (removed) throw new GuideError('removed', 403)
    return method === 'POST' ? { command: { id: body.commandId, status: 'pending' } } : reply()
  })
  f.store.start(); await f.tick()
  const result = f.store.enqueueSongAndWait(4)
  await new Promise(resolve => setImmediate(resolve))
  removed = true; f.store.resume(); await f.tick()
  assert.equal(await result, false)
  assert.equal(f.store.grant, null)
})

test('rescanning the current QR replaces a removed saved grant rather than restoring it', async () => {
  const replacement = 'd'.repeat(32), f = setup(async (_clock, _path, _token, method) => {
    if (method !== 'POST') throw new GuideError('removed', 403)
    return { device: { ...reply().device, token: replacement } }
  }, { hash: `#session=${secret}&token=${'e'.repeat(32)}` })
  await f.store.openPair()
  assert.equal(f.store.grant.token, replacement)
  assert.equal(JSON.parse(f.storage.get('karaoke-device-pair')).token, replacement)
  assert.equal(f.storage.has('karaoke-device-invitation'), false)
})

test('retrying an audio mode request preserves its explicit target and original command ID', async () => {
  const posts = [], f = setup(async (_clock, _path, _token, method, body) => {
    if (method !== 'POST') return reply()
    posts.push({ commandId: body.commandId, action: body.action, karaoke: body.karaoke })
    if (posts.length === 1) throw new GuideError('unavailable', 503)
    return { command: { id: body.commandId, status: 'applied' } }
  })
  f.store.start(); await f.tick(); f.store.command('setMode', { karaoke: false })
  await new Promise(resolve => setImmediate(resolve))
  f.advance(2600); await f.tick()
  assert.deepEqual(posts, Array(2).fill({ commandId: 'unique-request-id-long', action: 'setMode', karaoke: false }))
  assert.equal(f.store.pending, null); assert.equal(f.store.commandNotice, 'commandApplied')
})

test('browsing pages and searching keep independent results and discard older browse responses', async () => {
  const requests = [], f = setup((_clock, path) => new Promise(resolve => requests.push({ path, resolve })))
  const first = f.store.browse(1), second = f.store.browse(2), search = f.store.search('Singer', 1)
  assert.equal(f.store.browsing, true); assert.equal(f.store.searching, true)
  assert.match(requests[1].path, /catalog\?page=2$/)
  assert.match(requests[2].path, /q=Singer&page=1$/)
  requests[1].resolve({ ready: true, page: 2, total: 30, songs: [{ id: 26, title: 'Browse song', artist: '' }] })
  requests[2].resolve({ ready: true, page: 1, total: 1, songs: [{ id: 1, title: 'Search song', artist: 'Singer' }] })
  await second; await search
  requests[0].resolve({ ready: true, page: 1, total: 30, songs: [{ id: 1, title: 'Old page', artist: '' }] })
  await first
  assert.equal(f.store.browseCatalog.page, 2); assert.equal(f.store.browseCatalog.songs[0].id, 26)
  assert.equal(f.store.catalog.songs[0].title, 'Search song')
  assert.equal(f.store.browsing, false); assert.equal(f.store.searching, false)
})

test('revoking a paired grant clears browsed songs and rejects an outstanding catalog response', async () => {
  let completeBrowse
  const f = setup(async (_clock, path) => {
    if (path.includes('/catalog')) return new Promise(resolve => { completeBrowse = resolve })
    throw new GuideError('removed', 403)
  })
  const browsing = f.store.browse(1)
  f.store.start(); await f.tick()
  completeBrowse({ ready: true, page: 1, total: 1, songs: [{ id: 1, title: 'Old grant', artist: '' }] })
  await browsing
  assert.equal(f.store.grant, null); assert.equal(f.store.browseCatalog, null)
  assert.equal(f.store.catalog, null); assert.equal(f.store.browsing, false)
})

test('typing a formatted code includes app identity and replaces the grant only after a successful join', async () => {
  const requests = [], replacement = 'd'.repeat(32), sessionId = 'e'.repeat(32)
  const f = setup(async (_clock, path, _token, method, body) => {
    requests.push({ path, method, body })
    if (body.code === '111111') throw new GuideError('invalidCode', 404)
    return { sessionId, device: { ...reply().device, username: 'BlueSinger', token: replacement } }
  })
  assert.equal(await f.store.pairByCode('123'), false); assert.equal(requests.length, 0)
  assert.equal(await f.store.pairByCode('111111'), false)
  assert.equal(f.store.grant.token, token); assert.equal(f.store.pairCodeError, 'invalidCode')
  assert.equal(await f.store.pairByCode('234 567'), true)
  assert.equal(requests.at(-1).path, '/pair'); assert.equal(requests.at(-1).body.code, '234567')
  assert.equal(requests.at(-1).body.identityToken, 'fixture-identity')
  assert.equal(requests.at(-1).body.deviceToken, token)
  assert.equal(f.store.grant.token, replacement); assert.equal(f.store.grant.sessionId, sessionId)
  assert.equal(f.store.device.username, 'BlueSinger'); assert.equal(f.store.pairCodeError, '')
  assert.equal(JSON.parse(f.storage.get('karaoke-device-pair')).token, replacement)
  assert.equal(f.storage.has('karaoke-device-code-attempt'), false)
})

test('retrying a code after a lost response reuses its enrolment key and retains the saved pairing meanwhile', async () => {
  const keys = [], f = setup(async (_clock, _path, _token, _method, body) => {
    keys.push(body.joinKey)
    if (keys.length === 1) throw new GuideError('unavailable', 503)
    return { sessionId: secret, device: { ...reply().device, token } }
  })
  assert.equal(await f.store.pairByCode('234567'), false)
  assert.equal(f.store.grant.token, token); assert.ok(f.storage.has('karaoke-device-code-attempt'))
  assert.equal(await f.store.pairByCode('234567'), true)
  assert.equal(keys[0], keys[1]); assert.equal(f.storage.has('karaoke-device-code-attempt'), false)
})
