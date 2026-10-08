import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'


const require = createRequire(import.meta.url)
const { createPinia, setActivePinia } = require('pinia')
const source = await readFile(new URL('../src/stores/player.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
const song = id => ({ id, title: `Track ${id}`, duration: 180 })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function setup(preloadSong = async () => {}, isPlayable = () => true, environment = {}) {
  const modules = {
    '@/config': { getMusicUrl: name => `/api/dig/files/${name}`, getPosterUrl: id => `/poster/${id}` },
    '@/services/songService': { songService: {} },
    '@/services/audioCacheService': { audioCacheService: {
      preloadSong, isPlayable, isCached: isPlayable, takeCachedUrl: () => null,
    } },
    '@/services/karaokeService': { karaokeService: { isAvailable: () => false, ensureLoaded() {} } },
    '@/services/debugLogger': { debugLogger: { info() {}, warn() {}, error() {} } },
    '@/composables/useMicDevices': { MIC_CAPTURE_STATE_EVENT: 'mic-capture-state' },
  }
  const exports = {}
  vm.runInNewContext(outputText, {
    exports,
    require: name => modules[name] ?? require(name),
    localStorage: { getItem: () => null, removeItem() {}, setItem() {} },
    navigator: { onLine: true, userAgent: 'test' },
    console: { log() {}, warn() {}, error() {} },
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    setTimeout, clearTimeout, URL, Error,
    ...environment,
  })
  setActivePinia(createPinia())
  const player = exports.usePlayerStore()
  player.shuffle = false
  return player
}

test('1370 advances to 1369 even when preloading 1369 fails', async () => {
  const player = setup(async () => {}, id => id !== 1369)
  player.audioElement = {
    src: '', currentTime: 0, duration: 180,
    pause() {}, load() {}, async play() {},
  }
  const queue = [song(1370), song(1369), song(1368), song(1339)]
  await player.playSong(queue[0], queue, 0)
  await player.triggerReadAheadCache()
  await player.nextSong()
  assert.equal(player.currentSong.id, 1369)
  assert.equal(player.audioElement.src, '/api/dig/files/link.1369.mp3')
  await player.nextSong()
  assert.equal(player.currentSong.id, 1368)
})

test('adding and sorting Dig imports cannot shift the active queue positions', async () => {
  const player = setup()
  const library = [song(1370), song(1369), song(1339)]
  await player.playSong(library[0], library, 0)
  await player.triggerReadAheadCache()
  library.push(song(1371))
  library.sort((a, b) => b.id - a.id)
  await player.nextSong()
  assert.equal(player.currentSong.id, 1369)
})

test('an old shuffle preload cannot overwrite the sequential next track', async () => {
  const pending = deferred()
  let first = true
  const player = setup(() => {
    if (first) { first = false; return pending.promise }
    return Promise.resolve()
  })
  const queue = [song(1370), song(1369), song(1368)]
  await player.playSong(queue[0], queue, 0)
  // A one-song queue makes the old shuffle selection deterministic.
  player.queue = [song(1339)]
  player.shuffle = true
  const oldPreload = player.triggerReadAheadCache()
  await player.playSong(queue[0], queue, 0)
  player.toggleShuffle()
  await player.triggerReadAheadCache()
  pending.resolve()
  await oldPreload
  await player.nextSong()
  assert.equal(player.currentSong.id, 1369)
})

test('sequential mode follows custom playlist order and stops at its end', async () => {
  const player = setup()
  const queue = [song(1369), song(1339), song(1370)]
  await player.playSong(queue[0], queue)
  await player.nextSong()
  assert.equal(player.currentSong.id, 1339)
  await player.nextSong()
  await player.nextSong()
  assert.equal(player.currentSong.id, 1370)
  player.repeat = 'all'
  await player.nextSong()
  assert.equal(player.currentSong.id, 1369)
})

test('range filtering respects the end of the queue without repeat-all', async () => {
  const player = setup()
  const queue = [song(1370), song(1369), song(1368), song(1339)]
  await player.playSong(queue[1], queue, 1)
  player.setSongRange(1369, 1370)
  await player.nextSong()
  assert.equal(player.currentSong.id, 1369)
  player.repeat = 'all'
  await player.nextSong()
  assert.equal(player.currentSong.id, 1370)
})


test('a stale preload cannot overwrite a newer shuffle selection', async () => {
  const pending = deferred()
  const player = setup(track => track.id === 1339 ? pending.promise : Promise.resolve())
  player.shuffle = true
  await player.playSong(song(1339), [song(1339)], 0)
  const oldPreload = player.triggerReadAheadCache()
  const queue = [song(1370), song(1369)]
  await player.playSong(queue[0], queue, 0)
  await player.triggerReadAheadCache()
  pending.resolve()
  await oldPreload
  await player.nextSong()
  assert.equal(player.currentSong.id, 1369)
})

function audioEnvironment() {
  const timers = new Map(), handlers = new Map(), window = new EventTarget(), document = new EventTarget()
  let nextTimer = 0
  const setTimeout = work => { const id = ++nextTimer; timers.set(id, work); return id }
  const clearTimeout = id => timers.delete(id)
  Object.assign(window, { setTimeout, clearTimeout })
  Object.assign(document, { hidden: false })
  class Audio extends EventTarget {
    src = ''; currentTime = 0; duration = 180; readyState = 4; paused = true; ended = false
    playCalls = 0; loadCalls = 0
    async play() { this.playCalls++; this.paused = false; this.dispatchEvent(new Event('play')) }
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')) }
    load() { this.loadCalls++ }
    removeAttribute(name) { if (name === 'src') this.src = '' }
  }
  const mediaSession = { setActionHandler: (action, handler) => handlers.set(action, handler), setPositionState() {} }
  const environment = { Audio, window, document, setTimeout, clearTimeout, AbortController,
    navigator: { onLine: true, userAgent: 'test', mediaSession }, MediaMetadata: class { constructor(data) { Object.assign(this, data) } },
    HTMLMediaElement: { HAVE_METADATA: 1 }, MediaError: { MEDIA_ERR_NETWORK: 2, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 } }
  const flushTimers = async () => {
    const pending = [...timers.values()]; timers.clear()
    for (const work of pending) work()
    await new Promise(resolve => setImmediate(resolve))
  }
  return { environment, handlers, window, document, flushTimers }
}

test('party ownership blocks solo actions and saved media handlers, then restores the paused queue', async () => {
  const { environment, handlers } = audioEnvironment(), player = setup(undefined, undefined, environment)
  player.initializeAudio()
  const queue = [song(1370), song(1369)]
  await player.playSong(queue[0], queue, 0)
  player.seek(12)
  const oldPlay = handlers.get('play'), oldNext = handlers.get('nexttrack'), audio = player.audioElement
  player.setPartyAudioOwnership(true)
  assert.equal(audio.paused, true); assert.equal(player.lastPlayState, false)
  assert.equal(handlers.get('play'), null)
  await oldPlay(); await oldNext(); await player.previousSong(); await player.playSong(queue[1], queue, 1)
  assert.equal(audio.playCalls, 1); assert.equal(player.currentSong.id, 1370); assert.equal(player.currentTime, 12)
  assert.equal(environment.navigator.mediaSession.metadata, null)
  player.setPartyAudioOwnership(false)
  assert.equal(audio.paused, true); assert.equal(audio.playCalls, 1)
  assert.equal(typeof handlers.get('play'), 'function')
  await handlers.get('play')()
  assert.equal(audio.playCalls, 2); assert.equal(player.currentSong.id, 1370); assert.equal(player.currentTime, 12)
})

test('entering and leaving party mode cancels delayed network and missing-file recovery', async () => {
  const { environment, window, document, flushTimers } = audioEnvironment(), player = setup(undefined, undefined, environment)
  player.initializeAudio()
  await player.playSong(song(1370), [song(1370), song(1369)], 0)
  const audio = player.audioElement
  player.isPlaying = false; player.lastPlayState = true
  window.dispatchEvent(new Event('online'))
  audio.error = { code: 2 }; audio.dispatchEvent(new Event('error'))
  audio.error = { code: 4 }; audio.dispatchEvent(new Event('error'))
  player.setPartyAudioOwnership(true); player.setPartyAudioOwnership(false)
  await flushTimers()
  document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(audio.playCalls, 1); assert.equal(audio.paused, true); assert.equal(player.currentSong.id, 1370)
})

test('a pending autoplay retry cannot restart solo after a round trip through party mode', async () => {
  const { environment, flushTimers } = audioEnvironment(), player = setup(undefined, undefined, environment)
  player.initializeAudio(); player.currentSong = song(1370)
  const audio = player.audioElement
  audio.play = async () => { audio.playCalls++; throw Object.assign(new Error('Gesture required'), { name: 'NotAllowedError' }) }
  const pending = player.play()
  await new Promise(resolve => setImmediate(resolve))
  player.setPartyAudioOwnership(true); player.setPartyAudioOwnership(false)
  await flushTimers(); await pending
  assert.equal(audio.playCalls, 1); assert.equal(player.isPlaying, false)
})

test('party entry during an Android output rebuild retains the paused solo source and position', async () => {
  const { environment, window, flushTimers } = audioEnvironment()
  environment.navigator.userAgent = 'Android'
  const player = setup(undefined, undefined, environment)
  player.initializeAudio(); await player.playSong(song(1370), [song(1370)], 0); player.seek(12)
  window.dispatchEvent(new CustomEvent('mic-capture-state', { detail: { active: false } }))
  await flushTimers()
  const replacement = player.audioElement
  assert.equal(replacement.src, '')
  player.setPartyAudioOwnership(true); player.setPartyAudioOwnership(false)
  await flushTimers()
  assert.equal(replacement.src, '/api/dig/files/link.1370.mp3')
  assert.equal(replacement.currentTime, 12); assert.equal(replacement.paused, true); assert.equal(replacement.playCalls, 0)
})
