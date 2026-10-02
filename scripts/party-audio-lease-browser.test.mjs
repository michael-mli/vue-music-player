// Native production-engine lease experiment. Private PulseAudio observes actual
// output while the page task is blocked. This is not physical takeover evidence.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import WebSocket from '../server/node_modules/ws/wrapper.mjs'
import { createOwnedRemoteBrowser } from './party-remote-browser.mjs'

const receiverTargetMs = process.env.KTV_LEASE_TEST_RECEIVER_TARGET_MS === undefined ? null : Number(process.env.KTV_LEASE_TEST_RECEIVER_TARGET_MS)
assert.ok(receiverTargetMs === null || Number.isInteger(receiverTargetMs) && receiverTargetMs >= 0 && receiverTargetMs <= 1000,
  'Native receiver buffering experiment requires a 0–1000 ms target')

const source = await fs.readFile('src/services/partyAudioEngine.ts', 'utf8')
const compile = text => ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText
const modules = {
  '/engine.js': compile(source).replace("'@/utils/partyTimeline'", "'/timeline.js'").replace("'./partyLeaseGuard'", "'/lease-guard.js'"),
  '/timeline.js': compile(await fs.readFile('src/utils/partyTimeline.ts', 'utf8')),
  '/lease-guard.js': compile(await fs.readFile('src/services/partyLeaseGuard.ts', 'utf8'))
    .replace("import moduleUrl from './partyLeaseGuard.worklet.js?url';", "const moduleUrl = '/lease-guard.worklet.js';"),
  '/lease-guard.worklet.js': await fs.readFile('src/services/partyLeaseGuard.worklet.js', 'utf8'),
  '/publish-graph.js': compile(await fs.readFile('src/services/partyPublishGraph.ts', 'utf8'))
    .replace("'./partyLeaseGuard'", "'/lease-guard.js'"),
  '/encoded-lease.js': compile(await fs.readFile('src/services/partyEncodedLease.ts', 'utf8'))
    .replace("import workerUrl from './partyEncodedLease.worker.js?url';", "const workerUrl = '/encoded-lease.worker.js';"),
  '/encoded-lease.worker.js': await fs.readFile('src/services/partyEncodedLease.worker.js', 'utf8'),
}
const rate = 44100, duration = 60, bytes = Buffer.alloc(44 + rate * duration * 2)
bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28)
bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40)
for (let index = 0; index < rate * duration; index++) bytes.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / rate) * 6000), 44 + index * 2)
const asset = { url: '/tone.wav', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  durationMs: duration * 1000, sampleRate: rate, channels: 1, alignmentOffsetMs: 0 }
const html = `<!doctype html><title>Owned native lease fixture</title><script type="module">
  import { PartyAudioEngine } from '/engine.js';
  import { PartyPublishGraph } from '/publish-graph.js';
  import { PartyEncodedLease, partyEncodedRTCConfiguration } from '/encoded-lease.js';
  window.PartyEncodedLease = PartyEncodedLease; window.partyEncodedRTCConfiguration = partyEncodedRTCConfiguration;
  const Context = window.AudioContext;
  window.AudioContext = class extends Context { constructor(...args) { super(...args); window.context = this; } };
  window.engine = new PartyAudioEngine();
  window.stateEvents = [];
  window.authorizePublisher = () => {
    const now = performance.now(), offset = 5000;
    window.leaseEnd = now + 3500;
    const clock = { clockId: 'owned-clock', status: 'healthy', offsetMs: offset, uncertaintyMs: 5 };
    const permit = {clockId:clock.clockId,performanceId:'owned-performance',generation:1,expiresServerMs:leaseEnd+offset};
    if (!graph.renew(permit,clock) || !encodedLease.renew(permit,clock)) throw new Error('PUBLISH_LEASE_REJECTED');
    return { start:performance.timeOrigin+now,expiry:performance.timeOrigin+leaseEnd };
  };
  window.start = async (profile) => {
    await engine.enable();
    context.addEventListener('statechange', () => stateEvents.push({ state: context.state, time: performance.timeOrigin + performance.now() }));
    const now = performance.now(), offset = 5000;
    window.leaseEnd = now + 3500;
    const clock = { clockId: 'owned-clock', status: 'healthy', offsetMs: offset, uncertaintyMs: 5 };
    const playback = { state: 'scheduled', generation: 1, clockId: clock.clockId, performanceId: 'owned-performance',
      entryId: 'owned-entry', positionMs: 0, anchorServerMs: now + offset + 200, durationMs: 60000,
      pendingTransition: null, assets: { instrumental: ${JSON.stringify(asset)}, original: ${JSON.stringify(asset)} } };
    const lease = { id: 'owned-lease', generation: 1, clockId: clock.clockId, performanceId: playback.performanceId,
      expiresServerMs: leaseEnd + offset, sequence: 1 };
    if (profile === 'stage') {
      await engine.prepare(${JSON.stringify(asset)});
      engine.sync(playback, clock, lease, 'stage');
    } else {
      const tone = context.createOscillator(), gain = context.createGain(), capture = context.createMediaStreamDestination();
      tone.frequency.value = 440; gain.gain.value = .15; tone.connect(gain); gain.connect(capture); tone.start();
      window.publisherTone = tone;
      window.graph = new PartyPublishGraph(context, context.createGain(), capture.stream,
        { clockId: clock.clockId, performanceId: playback.performanceId, generation: 1 }, 'clean-mic', false);
      // Negotiate an independent receiver while the publish gate is still closed.
      // A same-context loopback can retain samples when that consumer is frozen.
    }
    return { start: performance.timeOrigin + now, expiry: performance.timeOrigin + leaseEnd };
  };
  window.ready = true;
</script>`
const sockets = new Set(), server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  if (req.url === '/tone.wav') { res.setHeader('Content-Type', 'audio/wav'); res.end(bytes) }
  else if (modules[req.url]) { res.setHeader('Content-Type', 'text/javascript'); res.end(modules[req.url]) }
  else { res.setHeader('Content-Type', 'text/html'); res.end(html) }
})
server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
let browser, receiverBrowser, socket, receiverSocket, session, receiverSession, contextId, nextId = 0, passed = 0
const pending = new Map(), errors = []
const check = (value, message) => { assert.ok(value, message); passed++; console.log('PASS', message) }
const poll = async (work, label, timeout = 10000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await work(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(`Timed out: ${label}`)
}
function cdp(method, params = {}, sessionId, connection = socket) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value) }, reject(error) { clearTimeout(timer); reject(error) } })
    connection.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, session)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
function receive(raw) {
  const packet = JSON.parse(raw)
  if (packet.id) {
    const item = pending.get(packet.id); if (!item) return
    pending.delete(packet.id); packet.error ? item.reject(new Error(packet.error.message)) : item.resolve(packet.result)
  } else if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails.text)
}
async function receiverEvaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, receiverSession, receiverSocket)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function connectPublisherReceiver() {
  if (!receiverBrowser) {
    receiverBrowser = await createOwnedRemoteBrowser({ host:process.env.KTV_ROOM_TEST_SSH_HOST,
      knownHosts:process.env.KTV_ROOM_TEST_KNOWN_HOSTS,
      debugPort:Number(process.env.KTV_LEASE_TEST_RECEIVER_PORT || 9246),isolatedOutput:true,captureActivity:true })
    const info = await (await fetch(receiverBrowser.debuggerUrl+'/json/version')).json()
    console.log('Independent native publisher receiver:',info.Browser)
    receiverSocket = new WebSocket(info.webSocketDebuggerUrl); await once(receiverSocket,'open')
    receiverSocket.on('message',receive)
    // The receiver needs native media APIs, not the source's engine/bootstrap.
    const target = await cdp('Target.createTarget',{url:'about:blank'},undefined,receiverSocket)
    ;({sessionId:receiverSession}=await cdp('Target.attachToTarget',{targetId:target.targetId,flatten:true},undefined,receiverSocket))
    await cdp('Runtime.enable',{},receiverSession,receiverSocket)
    assert.equal(await receiverEvaluate("typeof RTCPeerConnection==='function'&&typeof document.createElement==='function'"),true,
      'Independent receiver exposes native peer/audio APIs')
  }
  const gather = `peer => new Promise((resolve,reject) => {
    if(peer.iceGatheringState==='complete') {resolve();return;}
    const timer=setTimeout(()=>reject(new Error('LEASE_ICE_TIMEOUT')),8000);
    const check=()=>{if(peer.iceGatheringState==='complete'){clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',check);resolve();}};
    peer.addEventListener('icegatheringstatechange',check);
  })`
  const offer = await evaluate(`(async()=>{
    window.encodedLease?.close(); window.publisherPeer?.close();
    window.publisherPeer=new RTCPeerConnection(partyEncodedRTCConfiguration());
    window.encodedLease = new PartyEncodedLease({clockId:'owned-clock',performanceId:'owned-performance',generation:1},()=>{});
    graph.stream.getTracks().forEach(track=>encodedLease.attach(publisherPeer.addTrack(track,graph.stream),'audio'));
    await publisherPeer.setLocalDescription(await publisherPeer.createOffer());
    await (${gather})(publisherPeer);return publisherPeer.localDescription.toJSON();
  })()`)
  const answer = await receiverEvaluate(`(async()=>{
    window.receiverPeer?.close();window.receiverAudio?.remove();
    window.receiverPeer=new RTCPeerConnection();window.receiverAudio=document.createElement('audio');
    receiverAudio.autoplay=true;document.body.append(receiverAudio);
    receiverPeer.ontrack=event=>{
      if (${receiverTargetMs !== null}) {
        if (!('jitterBufferTarget' in event.receiver)) throw new Error('LEASE_RECEIVER_TARGET_UNSUPPORTED');
        event.receiver.jitterBufferTarget=${receiverTargetMs};
      }
      receiverAudio.srcObject=event.streams[0];
    };
    await receiverPeer.setRemoteDescription(${JSON.stringify(offer)});
    await receiverPeer.setLocalDescription(await receiverPeer.createAnswer());
    await (${gather})(receiverPeer);return receiverPeer.localDescription.toJSON();
  })()`)
  await evaluate(`publisherPeer.setRemoteDescription(${JSON.stringify(answer)})`)
  await poll(()=>evaluate("publisherPeer.connectionState==='connected'"),'native publisher peer connected')
  await poll(()=>receiverEvaluate("receiverAudio.srcObject?.getAudioTracks().length===1"),'independent receiver audio track')
  await receiverEvaluate('receiverAudio.play()')
  if (receiverTargetMs !== null) {
    const targets = await receiverEvaluate("receiverPeer.getReceivers().filter(receiver=>receiver.track.kind==='audio').map(receiver=>receiver.jitterBufferTarget)")
    assert.deepEqual(targets, [receiverTargetMs], 'Native publisher expiry fixture applies the actual receiver buffering target')
    console.log('Native publisher expiry receiver target:', receiverTargetMs)
  }
}
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  browser = await createOwnedRemoteBrowser({ host: process.env.KTV_ROOM_TEST_SSH_HOST,
    knownHosts: process.env.KTV_ROOM_TEST_KNOWN_HOSTS, frontendPort: server.address().port,
    debugPort: Number(process.env.KTV_LEASE_TEST_CHROME_PORT || 9245), isolatedOutput: true, captureActivity:true })
  const info = await (await fetch(browser.debuggerUrl + '/json/version')).json()
  console.log('Native lease engine source SHA256:', createHash('sha256').update(source).digest('hex'), '; browser:', info.Browser)
  socket = new WebSocket(info.webSocketDebuggerUrl); await once(socket, 'open')
  socket.on('message',receive)
  ;({ browserContextId: contextId } = await cdp('Target.createBrowserContext'))
  const target = await cdp('Target.createTarget', { browserContextId: contextId, url: `http://127.0.0.1:${server.address().port}/` })
  ;({ sessionId: session } = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true }))
  await cdp('Runtime.enable', {}, session)
  await poll(() => evaluate('window.ready'), 'production engine module ready')
  await poll(async () => (await browser.audioEvidence()).some(item => item.ready), 'private output detector ready')
  const measurements = []
  for (const [profile, mode] of [['stage', 'task-stall'], ['stage', 'suspend-task-stall'], ['publisher', 'task-stall'], ['publisher', 'suspend-task-stall']]) {
    const label = `${profile}/${mode}`
    let timing = await evaluate(`start(${JSON.stringify(profile)})`)
    if (profile === 'publisher') {
      await connectPublisherReceiver()
      timing = await evaluate('authorizePublisher()')
    }
    const outputBrowser = profile === 'publisher' ? receiverBrowser : browser
    await poll(async () => (await outputBrowser.audioEvidence()).some(item => item.captureHeartbeat && item.time > timing.start && item.onAmplitude > .02), 'actual authorized tone output', 2000)
    check(true, `${label}: native output contains the authorized tone`)
    const frozen = await evaluate(`(() => {
      const before = context.currentTime, begin = performance.timeOrigin + performance.now();
      ${mode === 'suspend-task-stall' ? 'context.suspend();' : ''}
      while (performance.now() < leaseEnd + 750) {}
      const suspendedTime = context.currentTime, resume = performance.timeOrigin + performance.now();
      ${mode === 'suspend-task-stall' ? 'context.resume();' : ''}
      const finish = performance.now() + 2200;
      while (performance.now() < finish) {}
      return { before, suspendedTime, after: context.currentTime, begin, resume, finish: performance.timeOrigin + performance.now() };
    })()`)
    await new Promise(resolve => setTimeout(resolve, 300))
    const observed = await outputBrowser.audioEvidence()
    const evidence = observed.filter(item => (item.captureHeartbeat || typeof item.audible==='boolean') && item.time >= timing.start && item.time <= frozen.finish + 100)
    const expired = evidence.filter(item => item.time > timing.expiry + 150)
    const activityAtBoundary = observed.filter(item=>typeof item.audible==='boolean'&&item.time<=timing.expiry+150).at(-1)
    const receiverBuffer = profile === 'publisher' ? await receiverEvaluate(`(async()=>{
      const rows=[...(await receiverPeer.getStats()).values()].filter(row=>row.type==='inbound-rtp'&&row.kind==='audio');
      return rows.map(row=>Object.fromEntries(['jitterBufferDelay','jitterBufferTargetDelay','jitterBufferEmittedCount',
        'totalSamplesReceived','concealedSamples'].filter(key=>Number.isFinite(row[key])).map(key=>[key,row[key]])));
    })()`) : undefined
    console.log('Native lease measurement:', JSON.stringify({ profile, mode, output:profile==='publisher'?'independent native WebRTC receiver':'native stage',timing, frozen, evidence, receiverTargetMs, receiverBuffer, stateEvents: await evaluate('stateEvents') }))
    check(expired.filter(item=>item.captureHeartbeat).length >= 2&&typeof activityAtBoundary?.audible==='boolean', `${label}: actual output is observed after the wall-clock lease boundary`)
    measurements.push({ label, expiredAudible: expired.filter(item => item.onAmplitude > .015 || item.audible===true),
      activeAtBoundary:activityAtBoundary?.audible===true })
    if (mode === 'suspend-task-stall') check(frozen.suspendedTime - frozen.before < .2, 'audio render clock actually freezes while the page task is blocked')
    await evaluate('(async () => { window.encodedLease?.close(); window.publisherPeer?.close(); window.graph?.close(); window.publisherTone?.stop(); window.graph = null; window.publisherTone = null; await engine.close(); })()')
  }
  check(errors.length === 0, 'native lease fixture has no runtime exception')
  for (const measurement of measurements) check(!measurement.activeAtBoundary&&measurement.expiredAudible.length === 0,
    `${measurement.label}: old output remains silent after lease expiry despite blocked page tasks`)
  console.log(`${passed} native lease checks passed; isolated engine experiment only`)
} finally {
  if (socket?.readyState === WebSocket.OPEN && contextId) await cdp('Target.disposeBrowserContext', { browserContextId: contextId }).catch(() => {})
  socket?.close(); receiverSocket?.close()
  for (const item of pending.values()) item.reject(new Error('Native lease fixture closed'))
  pending.clear()
  const cleanup = await Promise.allSettled([browser?.close(),receiverBrowser?.close()])
  for (const item of sockets) item.destroy()
  if (server.listening) await new Promise(resolve => server.close(resolve))
  for (const result of cleanup) if (result.status==='rejected') throw result.reason
}
