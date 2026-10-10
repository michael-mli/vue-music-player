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
    setTimeout(work) { const id = ++nextTimer; timers.set(id, work); return id }, clearTimeout(id) { timers.delete(id) } }
  vm.runInNewContext(outputText, { exports, URL, URLSearchParams, performance,
    Date: class extends Date { static now() { return time } },
    localStorage: { getItem: key => storage.get(key) || null, removeItem: key => storage.delete(key), setItem: (key, value) => storage.set(key, value) },
    window, document: { visibilityState: 'visible' }, navigator: { userAgent: 'Test phone' },
    require: name => name === '@/services/karaokeGuideApi' ? { guideRequest: request, KaraokeGuideError: GuideError, karaokeRequestId: () => 'unique-request-id-long' }
      : name === '@/utils/karaokeGuideSync' ? { KaraokeGuideClock: class {} } : require(name) })
  setActivePinia(createPinia())
  const store = exports.useKaraokeDeviceStore()
  return { store, storage, advance(ms) { time += ms }, async tick() {
    const entry = timers.entries().next().value
    if (entry) { timers.delete(entry[0]); entry[1]() }
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
