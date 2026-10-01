import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import ts from 'typescript'

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const sdk = moduleUrl(`export class Room { constructor() { return globalThis.__partyTransport.room } }
  export const RoomEvent = { TrackSubscribed:'subscribe', TrackUnsubscribed:'unsubscribe', Disconnected:'disconnect',
    AudioPlaybackStatusChanged:'audio-status', VideoPlaybackStatusChanged:'video-status' };
  export const Track = { Kind:{Audio:'audio',Video:'video'}, Source:{Microphone:'mic',Camera:'camera'} };`)
const source = await fs.readFile(new URL('../src/services/partyMediaTransport.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { createPartyMediaTransport } = await import(moduleUrl(compiled.replace("'livekit-client'", JSON.stringify(sdk))))

async function fixture(t) {
  const previous = { window: globalThis.window, document: globalThis.document, state: globalThis.__partyTransport }
  const room = new EventEmitter(), elements = new Set(), created = [], rejected = [], detached = []
  room.startAudio = async () => {}; room.disconnect = async () => room.emit('disconnect')
  globalThis.__partyTransport = { room }
  globalThis.window = { location: { origin: 'https://party.example' } }
  globalThis.document = { createElement() {
    const element = { srcObject: null, paused: false, removed: false, style: {},
      pause() { this.paused = true }, remove() { this.removed = true }, async play() { this.paused = false } }
    created.push(element); return element
  } }
  const transport = await createPartyMediaTransport({ scope: 'audience', serverUrl: '/api/ktv/media', token: 'test-only' }, {
    attached: element => elements.add(element), detached: element => { detached.push(element); elements.delete(element) }, ended() {} })
  t.after(async () => {
    await transport.close()
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.__partyTransport = previous.state
  })
  function subscribe(kind, participant = 'first', name = kind === 'audio' ? 'performance-mix' : 'performance-lyrics') {
    const track = { kind, element: null, attach(element) { this.element = element; element.srcObject = { participant } },
      detach() { this.element = null; return [] } }
    const publication = { source: kind === 'audio' ? 'mic' : 'camera', trackName: name,
      setSubscribed(value) { if (!value) rejected.push(track) } }
    room.emit('subscribe', track, publication, { identity: participant })
    return track
  }
  return { room, elements, created, rejected, detached, transport, subscribe }
}

test('SDK unsubscribe with an empty detach result still removes the final owned media element', async t => {
  const f = await fixture(t), audio = f.subscribe('audio'), video = f.subscribe('video')
  assert.equal(audio.element, video.element)
  assert.equal(f.elements.size, 1)
  const element = audio.element
  // The SDK may already have cleared its own attachment list before this event.
  f.room.emit('unsubscribe', audio)
  assert.equal(f.elements.size, 1)
  assert.equal(element.removed, false)
  f.room.emit('unsubscribe', video)
  assert.equal(f.elements.size, 0)
  assert.equal(element.removed, true)
  assert.equal(element.srcObject, null)
  assert.deepEqual(f.detached, [element])
})

test('performer replacement retains one media element and ignores delayed old-track events', async t => {
  const f = await fixture(t), oldAudio = f.subscribe('audio'), oldVideo = f.subscribe('video')
  const previous = oldAudio.element
  const audio = f.subscribe('audio', 'replacement'), video = f.subscribe('video', 'replacement')
  assert.equal(audio.element, video.element)
  assert.equal(previous.removed, true)
  assert.deepEqual([...f.elements], [audio.element])
  f.room.emit('unsubscribe', oldAudio); f.room.emit('unsubscribe', oldVideo)
  assert.deepEqual([...f.elements], [audio.element])
  assert.equal(audio.element.removed, false)
})

test('unexpected publications and late subscriptions after close cannot attach another player', async t => {
  const f = await fixture(t)
  const unexpected = f.subscribe('audio', 'first', 'original-vocals')
  assert.deepEqual(f.rejected, [unexpected]); assert.equal(f.created.length, 0)
  f.subscribe('audio'); f.subscribe('video')
  await f.transport.close()
  assert.equal(f.elements.size, 0)
  const late = f.subscribe('audio', 'late')
  assert.ok(f.rejected.includes(late)); assert.equal(f.created.length, 1)
})
