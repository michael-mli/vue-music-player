import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

function compile(file) {
  const source = fs.readFileSync(new URL('../src/utils/' + file, import.meta.url), 'utf8')
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
}
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const source = compile('karaokeGuidePlayback.ts').replace('./karaokeGuideSync', moduleUrl(compile('karaokeGuideSync.ts')))
const { KaraokeGuidePlayback } = await import(moduleUrl(source))
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

class AudioFixture {
  src = ''; duration = 120; readyState = 4; paused = true; seeking = false; ended = false
  error = null; muted = false; volume = 0.6; playbackRate = 1; position = 0
  loads = 0; plays = 0; seeks = []; playResult = null
  get currentTime() { return this.position }
  set currentTime(value) { this.position = value; this.seeks.push(value); this.seeking = true; this.ended = false }
  load() { this.loads++; this.position = 0; this.readyState = 0; this.seeking = false; this.ended = false; this.error = null; this.paused = true }
  pause() { this.paused = true }
  play() { this.plays++; if (!this.playResult) this.paused = false; return this.playResult || Promise.resolve() }
  removeAttribute(name) { if (name === 'src') this.src = '' }
}
function fixture() {
  let time = 0
  const audio = new AudioFixture(), notices = []
  const playback = new KaraokeGuidePlayback(audio, notice => notices.push(notice), () => time)
  playback.setSource('/data/link.1.mp3')
  const ready = () => { audio.readyState = 4; audio.seeking = false; playback.seeked() }
  const sync = (position = 20 + time / 1000, changes = {}, force = false) => playback.sync({ allowed: true, playing: true, position, rate: 1, ...changes }, force)
  const advance = milliseconds => { time += milliseconds }
  ready()
  return { audio, playback, notices, ready, sync, advance }
}

test('stalled playback reloads the same source, then seeks to the current host position', async () => {
  const f = fixture(); f.sync(); f.ready(); await flush()
  f.audio.seeking = true // A decoder stuck seeking must not look like successful playback.
  f.advance(5900); f.sync(); assert.equal(f.audio.loads, 1)
  f.advance(100); f.sync(); assert.equal(f.audio.loads, 2)
  assert.equal(f.audio.src, '/data/link.1.mp3')
  assert.equal(f.notices.at(-1), 'recoveringAudio')
  f.ready(); f.sync(); f.ready(); await flush()
  assert.equal(f.audio.currentTime, 26); assert.equal(f.audio.paused, false)
  f.advance(100); f.audio.position += 0.1; f.sync()
  assert.equal(f.notices.at(-1), 'ready')
})

test('a hung play promise cannot prevent automatic recovery or playback on the next source', async () => {
  const f = fixture(), old = deferred(); f.audio.playResult = old.promise
  f.sync(); f.ready(); assert.equal(f.audio.plays, 1)
  f.advance(6000); f.sync(); assert.equal(f.audio.loads, 2)
  f.audio.playResult = null; f.ready(); f.sync(); f.ready(); await flush()
  assert.equal(f.audio.plays, 2); assert.equal(f.audio.paused, false)
  old.reject({ name: 'NotAllowedError' }); await flush()
  assert.equal(f.audio.paused, false); assert.ok(!f.notices.includes('tapAgain'))
})

test('an old source play rejection cannot stop or report errors for the new song', async () => {
  const f = fixture(), old = deferred(); f.audio.playResult = old.promise; f.sync()
  f.playback.setSource('/data/link.2.mp3'); f.audio.playResult = null; f.ready(); f.sync(5); f.ready(); await flush()
  old.reject({ name: 'NotAllowedError' }); await flush()
  assert.equal(f.audio.paused, false); assert.equal(f.audio.currentTime, 5)
  assert.ok(!f.notices.includes('tapAgain')); assert.equal(f.audio.src, '/data/link.2.mp3')
})

test('an old source play resolution cannot mute or pause the current song', async () => {
  const f = fixture(), old = deferred(); f.audio.playResult = old.promise; f.sync(20, { playing: false }); f.playback.unlock()
  assert.equal(f.audio.muted, true)
  f.playback.setSource('/data/link.2.mp3'); f.audio.playResult = null; f.ready(); f.sync(5); f.ready(); await flush()
  old.resolve(); await flush()
  assert.equal(f.audio.paused, false); assert.equal(f.audio.muted, false)
})

test('slow seeks receive time to finish and compensate for measured seek latency', async () => {
  const f = fixture(); f.sync(); await flush()
  f.advance(450); f.ready(); f.sync() // canplay must not immediately begin another seek.
  assert.equal(f.audio.seeks.length, 1)
  f.advance(650); f.audio.position += 0.65; f.sync()
  assert.equal(f.audio.seeks.length, 1)
  f.advance(200); f.audio.position += 0.2; f.sync()
  assert.equal(f.audio.seeks.length, 2)
  assert.ok(Math.abs(f.audio.currentTime - 21.75) < 0.001)
  assert.equal(f.audio.loads, 1)
})

test('real audio progression prevents recovery, including at HAVE_CURRENT_DATA', async () => {
  const f = fixture(); f.sync(); f.ready(); await flush(); f.audio.readyState = 2
  for (let i = 0; i < 150; i++) { f.advance(100); f.audio.position += 0.1; f.sync() }
  assert.equal(f.audio.loads, 1); assert.equal(f.audio.plays, 1)
})

test('a transient media error retries after a delay without disabling the guide', async () => {
  const f = fixture(); f.sync(); f.ready(); await flush()
  f.audio.error = { code: 2 }; f.playback.handleError()
  f.advance(900); f.sync(); assert.equal(f.audio.loads, 1)
  f.advance(100); f.sync(); assert.equal(f.audio.loads, 2)
  f.ready(); f.sync(); f.ready(); await flush()
  assert.equal(f.audio.paused, false); assert.equal(f.audio.currentTime, 21)
  assert.ok(!f.notices.includes('audioFailed'))
})

test('an aborted media download also recovers while the fresh host permits playback', () => {
  const f = fixture(); f.sync(); f.audio.error = { code: 1 }; f.playback.handleError()
  f.advance(1000); f.sync(); assert.equal(f.audio.loads, 2)
})

test('generic play failures recover, while autoplay rejection asks for a tap', async () => {
  const f = fixture(); f.audio.playResult = Promise.reject({ name: 'NotSupportedError' }); f.sync(); await flush()
  assert.equal(f.notices.at(-1), 'recoveringAudio')
  f.advance(1000); f.sync(); assert.equal(f.audio.loads, 2)
  f.audio.playResult = Promise.reject({ name: 'NotAllowedError' }); f.ready(); f.sync(); await flush()
  assert.equal(f.notices.at(-1), 'tapAgain'); assert.equal(f.audio.paused, true)
})

test('aborted play attempts release their lock and can be tried again without a reload', async () => {
  const f = fixture(); f.audio.playResult = Promise.reject({ name: 'AbortError' }); f.sync(); await flush()
  f.audio.playResult = null; f.ready(); f.sync(); await flush()
  assert.equal(f.audio.plays, 2); assert.equal(f.audio.paused, false); assert.equal(f.audio.loads, 1)
})

test('paused host does not trigger a stall reload or start audible playback', async () => {
  const f = fixture(); f.sync(20, { playing: false }); f.playback.unlock()
  assert.equal(f.audio.muted, true); await flush()
  assert.equal(f.audio.paused, true); assert.equal(f.audio.muted, false)
  f.ready(); f.advance(30_000); f.sync(20, { playing: false })
  assert.equal(f.audio.loads, 1); assert.equal(f.audio.paused, true)
})

test('stale host, stopped guide or removed pairing cancels recovery until allowed again', async () => {
  const f = fixture(); f.sync(); f.ready(); await flush()
  f.audio.error = { code: 2 }; f.playback.handleError()
  f.advance(500); f.sync(undefined, { allowed: false })
  f.advance(10_000); f.sync(undefined, { allowed: false })
  assert.equal(f.audio.loads, 1); assert.equal(f.audio.paused, true)
  f.sync(); f.advance(1000); f.sync(); assert.equal(f.audio.loads, 2)
})

test('unmount ignores pending promises and future callbacks', async () => {
  const f = fixture(), old = deferred(); f.audio.playResult = old.promise; f.sync()
  f.playback.dispose(); f.advance(10_000); f.sync(); f.playback.handleError(); f.playback.repair()
  old.reject({ name: 'NotAllowedError' }); await flush()
  assert.equal(f.audio.loads, 1); assert.equal(f.audio.paused, true); assert.deepEqual(f.notices, [])
})

test('bounded recovery avoids endless reloads and manual repair renews the budget', async () => {
  const f = fixture(); f.sync(); f.ready(); await flush()
  for (let i = 0; i < 4; i++) {
    f.audio.error = { code: 3 }; f.playback.handleError(); f.advance(1000); f.sync()
    if (i < 3) { f.ready(); f.sync(); f.ready(); await flush() }
  }
  assert.equal(f.audio.loads, 4); assert.equal(f.notices.at(-1), 'audioFailed'); assert.equal(f.audio.paused, true)
  f.playback.repair(); f.ready(); f.sync(); f.ready(); await flush()
  assert.equal(f.audio.loads, 5); assert.equal(f.audio.paused, false)
})

test('manual repair preserves volume, speed, source and current host position', async () => {
  const f = fixture(); f.audio.volume = 0.35; f.sync(); f.ready(); await flush()
  f.advance(2500); f.playback.repair(); f.ready(); f.sync(46, { rate: 1.25 }); f.ready(); await flush()
  assert.equal(f.audio.src, '/data/link.1.mp3'); assert.equal(f.audio.volume, 0.35)
  assert.equal(f.audio.currentTime, 46); assert.equal(f.audio.paused, false)
  f.advance(100); f.audio.position += 0.125; f.sync(46.125, { rate: 1.25 })
  assert.equal(f.audio.playbackRate, 1.25)
})

test('a new Start tap renews automatic recovery after the retry limit was reached', async () => {
  const f = fixture(); f.sync(); f.ready(); await flush()
  for (let i = 0; i < 4; i++) {
    f.audio.seeking = true; f.advance(6000); f.sync()
    if (i < 3) { f.ready(); f.sync(); f.ready(); await flush() }
  }
  assert.equal(f.notices.at(-1), 'audioFailed'); assert.equal(f.audio.loads, 4)
  f.sync(); f.playback.unlock(); await flush()
  f.audio.seeking = true; f.advance(6000); f.sync()
  assert.equal(f.audio.loads, 5); assert.equal(f.notices.at(-1), 'recoveringAudio')
})

test('a shorter original track waits at the end without looping its final fragment', async () => {
  const f = fixture(); f.audio.duration = 119; f.sync(118); f.ready(); await flush()
  f.audio.position = 119; f.audio.ended = true; f.audio.paused = true
  const plays = f.audio.plays, seeks = f.audio.seeks.length
  for (let i = 0; i < 100; i++) { f.advance(100); f.sync(119 + i / 100) }
  assert.equal(f.audio.loads, 1); assert.equal(f.audio.plays, plays); assert.equal(f.audio.seeks.length, seeks)
  f.sync(30); f.ready(); await flush()
  assert.equal(f.audio.paused, false); assert.equal(f.audio.currentTime, 30)
})
