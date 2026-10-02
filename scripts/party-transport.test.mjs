import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import ts from 'typescript'

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const sdk = moduleUrl(`export class Room { constructor(options) { globalThis.__partyTransport.options = options; return globalThis.__partyTransport.room } }
  export const RoomEvent = { TrackSubscribed:'subscribe', TrackUnsubscribed:'unsubscribe', TrackPublished:'published', Disconnected:'disconnect',
    SignalReconnecting:'signal-reconnecting', Reconnecting:'reconnecting', Reconnected:'reconnected', AudioPlaybackStatusChanged:'audio-status', VideoPlaybackStatusChanged:'video-status' };
  export const DisconnectReason = { UNKNOWN_REASON:0, CLIENT_INITIATED:1, DUPLICATE_IDENTITY:2, SERVER_SHUTDOWN:3, PARTICIPANT_REMOVED:4, ROOM_DELETED:5, STATE_MISMATCH:6, JOIN_FAILURE:7, SIGNAL_CLOSE:9 };
  export const Track = { Kind:{Audio:'audio',Video:'video'}, Source:{Microphone:'mic',Camera:'camera',ScreenShare:'screen_share'} };`)
const source = await fs.readFile(new URL('../src/services/partyMediaTransport.ts', import.meta.url), 'utf8')
const encoded = moduleUrl(`export const partyEncodedRTCConfiguration = () => ({encodedInsertableStreams:true});
  export class PartyEncodedLease { constructor(identity, failed) { this.identity=identity; this.failed=failed; this.attachments=[]; this.closed=false; globalThis.__partyTransport.lease=this; }
    attach(sender,kind) { if(!sender) throw new Error('MEDIA_CAPTURE_UNAVAILABLE'); this.attachments.push({sender,kind}); }
    renew(permit,clock) { this.permit=permit; this.clock=clock; return !this.closed; }
    close() { this.closed=true; } }`)
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const receive = moduleUrl(`export class PartyReceiveGraph { constructor(context,stream,identity,failed) { this.closed=false;this.identity=identity;this.failed=failed;globalThis.__partyTransport.graph=this; }
  renew(permit,clock) {this.permit=permit;return !this.closed;} close() {this.closed=true;} }`)
const guard = moduleUrl('export const installPartyLeaseGuard = async () => {};')
const { createPartyMediaTransport } = await import(moduleUrl(compiled.replace("'livekit-client'", JSON.stringify(sdk)).replace("'./partyEncodedLease'", JSON.stringify(encoded))
  .replace("'./partyReceiveGraph'", JSON.stringify(receive)).replace("'./partyLeaseGuard'", JSON.stringify(guard))))

async function fixture(t, scope = 'audience') {
  const previous = { window: globalThis.window, document: globalThis.document, state: globalThis.__partyTransport,
    stream: globalThis.MediaStream, context: globalThis.AudioContext }
  const disconnected = []
  const room = new EventEmitter(), elements = new Set(), created = [], rejected = [], detached = []
  let started = 0, recovering = 0, recovered = 0, ended = 0, blocked = 0
  room.startAudio = async () => { started++ }; room.disconnect = async () => room.emit('disconnect')
  room.connect = async (...args) => { globalThis.__partyTransport.connectArgs=args }
  room.remoteParticipants = new Map()
  globalThis.MediaStream = class {
    constructor(tracks=[]) {this.tracks=[...tracks];} getTracks() {return this.tracks;}
    getAudioTracks() {return this.tracks.filter(track=>track.kind==='audio');}
    addTrack(track) {this.tracks.push(track);} removeTrack(track) {this.tracks=this.tracks.filter(item=>item!==track);}
  }
  globalThis.AudioContext = class {
    constructor() {this.state='suspended';globalThis.__partyTransport.context=this;}
    async resume() {this.state='running';await globalThis.__partyTransport.resume?.();}
    async close() {this.state='closed';}
  }
  globalThis.__partyTransport = { room }
  globalThis.window = { location: { origin: 'https://party.example' } }
  globalThis.document = { createElement() {
    const element = { srcObject: null, paused: false, removed: false, style: {},
      pause() { this.paused = true }, remove() { this.removed = true }, async play() { this.paused = false } }
    created.push(element); return element
  } }
  const transport = await createPartyMediaTransport({ scope, serverUrl: '/api/ktv/media', token: 'test-only',
    permit: scope==='publisher'?{clockId:'clock',performanceId:'performance',generation:1,expiresServerMs:8000}:undefined }, {
    attached: element => elements.add(element), detached: element => { detached.push(element); elements.delete(element) }, ended(recoverable) { ended++; disconnected.push(recoverable) }, recovering() { recovering++ }, recovered() { recovered++ }, playbackBlocked() { blocked++ } })
  const permit={publisherIdentity:'first',clockId:'clock',performanceId:'performance',generation:1,expiresServerMs:performance.now()+5000}
  const clock={clockId:'clock',status:'healthy',offsetMs:0,uncertaintyMs:5}
  if(scope==='audience') assert.equal(transport.renewReceivePermit(permit,clock),true)
  t.after(async () => {
    await transport.close()
    globalThis.window = previous.window; globalThis.document = previous.document; globalThis.__partyTransport = previous.state
    globalThis.MediaStream=previous.stream;globalThis.AudioContext=previous.context
  })
  function subscribe(kind, participant = 'first', name = kind === 'audio' ? 'performance-mix' : 'performance-lyrics', source = kind === 'audio' ? 'mic' : 'screen_share') {
    const mediaStreamTrack={kind,readyState:'live'}
    const track = { kind, mediaStreamTrack, get element() {return created.find(element=>element.srcObject?.getTracks().includes(mediaStreamTrack)) || null},
      attach() {throw new Error('SDK attachment would bypass the receiver gate');}, detach() { return [] } }
    const publication = { source, trackName: name,
      setSubscribed(value) { if (!value) rejected.push(track) } }
    room.emit('subscribe', track, publication, { identity: participant })
    return track
  }
  return { permit, clock, disconnected, room, elements, created, rejected, detached, transport, subscribe, options: globalThis.__partyTransport.options,
    get recovering() { return recovering }, get recovered() { return recovered }, get ended() { return ended }, get blocked() { return blocked }, get started() { return started } }
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
  f.transport.renewReceivePermit({...f.permit,publisherIdentity:'replacement'},f.clock)
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
  const camera = f.subscribe('video', 'first', 'performance-lyrics', 'camera')
  assert.ok(f.rejected.includes(camera)); assert.equal(f.created.length, 0)
  f.subscribe('audio'); f.subscribe('video')
  await f.transport.close()
  assert.equal(f.elements.size, 0)
  const late = f.subscribe('audio', 'late')
  assert.ok(f.rejected.includes(late)); assert.equal(f.created.length, 1)
})

const settled = async () => { for (let index = 0; index < 6; index++) await Promise.resolve() }

test('unexpected audience link loss pauses output and asks the owner for fresh authorization', async t => {
  const f = await fixture(t), audio = f.subscribe('audio'); f.subscribe('video')
  assert.equal(f.options.reconnectPolicy.nextRetryDelayInMs({retryCount:0,elapsedMs:0}), null)
  f.room.emit('disconnect')
  assert.equal(audio.element.paused, true); assert.deepEqual(f.disconnected, [true])
  const late = f.subscribe('video', 'late'); assert.ok(f.rejected.includes(late))
  f.room.emit('disconnect'); assert.equal(f.ended, 1)
})

test('a terminal provider removal or intentional leave cannot request automatic audience recovery', async t => {
  const f = await fixture(t); f.subscribe('audio'); f.subscribe('video')
  f.room.emit('disconnect', 4); assert.deepEqual(f.disconnected, [false])
  assert.equal(f.ended, 1)
})

test('a publisher never retries or requests automatic recovery after transport loss', async t => {
  const f = await fixture(t, 'publisher')
  assert.equal(f.options.reconnectPolicy.nextRetryDelayInMs({retryCount:0,elapsedMs:0}), null)
  f.room.emit('disconnect'); assert.deepEqual(f.disconnected, [false])
})

test('user Stop cancels an in-flight audio enable before its late reply can play an old element', async t => {
  const f = await fixture(t), audio = f.subscribe('audio'); f.subscribe('video')
  let resolve; globalThis.__partyTransport.resume = () => new Promise(done => { resolve = done })
  const enabling = f.transport.enableAudio(); await f.transport.close(); resolve(); await enabling; await settled()
  assert.equal(f.elements.size, 0); assert.equal(audio.element, null); assert.equal(f.ended, 0)
})

test('performance audio and lyric video publish in the same receiver synchronization stream', async t=>{
  const f=await fixture(t,'publisher'), published=[]
  f.room.localParticipant={async publishTrack(track,options){published.push({track,options});return {track:{sender:track}}}}
  const mix={kind:'audio'},lyrics={kind:'video'}
  await f.transport.publish({getAudioTracks:()=>[mix]},{getVideoTracks:()=>[lyrics]})
  assert.deepEqual(published.map(item=>item.track),[mix,lyrics])
  assert.deepEqual(published.map(item=>item.options.stream),['performance','performance'])
  assert.deepEqual(published.map(item=>item.options.name),['performance-mix','performance-lyrics'])
  assert.deepEqual(published.map(item=>item.options.source),['mic','screen_share'])
  assert.deepEqual(published[1].options.screenShareEncoding,{maxBitrate:350000,maxFramerate:25})
  await f.transport.connect()
  assert.equal(globalThis.__partyTransport.connectArgs[2].rtcConfig.encodedInsertableStreams,true)
  const lease=globalThis.__partyTransport.lease
  assert.deepEqual(lease.attachments,[{sender:mix,kind:'audio'},{sender:lyrics,kind:'video'}])
  assert.equal(f.transport.renewPublishPermit({expiresServerMs:5000},{status:'healthy'}),true)
  await f.transport.close()
  assert.equal(lease.closed,true)
  assert.equal(f.transport.renewPublishPermit({expiresServerMs:6000},{status:'healthy'}),false)
})

test('receiver elements stay muted and use one guarded audio path instead of SDK raw playback', async t => {
  const f = await fixture(t), audio = f.subscribe('audio'), video = f.subscribe('video')
  assert.equal(audio.element, video.element); assert.equal(audio.element.muted, true)
  assert.equal(audio.element.srcObject.getTracks().length, 2)
  await f.transport.connect()
  assert.equal(globalThis.__partyTransport.connectArgs[2].autoSubscribe, false)
  await f.transport.enableAudio()
  const graph = globalThis.__partyTransport.graph
  assert.equal(graph.identity.publisherIdentity, 'first'); assert.deepEqual(graph.permit, f.permit)
  assert.equal(audio.element.muted, true); assert.equal(f.started, 0)
  await f.transport.close(); assert.equal(graph.closed, true)
})

test('a delayed old source cannot clear a replacement and missing authority removes buffered output', async t => {
  const f = await fixture(t); f.subscribe('audio'); f.subscribe('video'); await f.transport.enableAudio()
  const old = globalThis.__partyTransport.graph
  f.transport.renewReceivePermit({ ...f.permit, publisherIdentity: 'replacement' }, f.clock)
  assert.equal(old.closed, true)
  const replacement = f.subscribe('audio', 'replacement'); f.subscribe('video', 'replacement')
  const late = f.subscribe('audio', 'first')
  assert.ok(f.rejected.includes(late)); assert.equal(f.elements.size, 1)
  assert.deepEqual([...f.elements], [replacement.element])
  const current = globalThis.__partyTransport.graph
  f.transport.renewReceivePermit(null, null)
  assert.equal(current.closed, true); assert.equal(f.elements.size, 0)
})

test('rechecking the same source deadline does not flood native subscription signaling', async t => {
  const f = await fixture(t), updates = []
  const publication = { kind: 'audio', source: 'mic', trackName: 'performance-mix', isDesired: false,
    setSubscribed(value) { this.isDesired = value; updates.push(value) } }
  f.room.remoteParticipants.set('first', { identity: 'first', trackPublications: new Map([['mix', publication]]) })
  f.transport.renewReceivePermit(f.permit, f.clock)
  f.transport.renewReceivePermit(f.permit, f.clock)
  assert.deepEqual(updates, [true])
  f.transport.renewReceivePermit(null, null); f.transport.renewReceivePermit(null, null)
  assert.deepEqual(updates, [true, false])
})
