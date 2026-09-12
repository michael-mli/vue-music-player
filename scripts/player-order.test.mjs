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

function setup(preloadSong = async () => {}, isPlayable = () => true) {
  const modules = {
    '@/config': { getMusicUrl: name => `/api/dig/files/${name}` },
    '@/services/songService': { songService: {} },
    '@/services/audioCacheService': { audioCacheService: {
      preloadSong, isPlayable, isCached: isPlayable, takeCachedUrl: () => null,
    } },
    '@/services/karaokeService': { karaokeService: { isAvailable: () => false } },
    '@/services/debugLogger': { debugLogger: { info() {}, warn() {}, error() {} } },
    '@/composables/useMicDevices': {},
  }
  const exports = {}
  vm.runInNewContext(outputText, {
    exports,
    require: name => modules[name] ?? require(name),
    localStorage: { getItem: () => null, removeItem() {}, setItem() {} },
    navigator: { onLine: true, userAgent: 'test' },
    console: { log() {}, warn() {}, error() {} },
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    setTimeout, clearTimeout, URL,
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
