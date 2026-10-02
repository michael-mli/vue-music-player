// Supervised transport probe using the real nginx/CDN origin and trusted TURN.
// Its short-lived policy fixture never changes production users/rooms. Running
// it requires the exact nginx media routes, idle media ports and private TLS files.
// Same-host clients are not evidence of different-network/physical acceptance.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import net from 'node:net'
import { once } from 'node:events'
import { randomUUID, X509Certificate, createPrivateKey } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import WebSocket from '../server/node_modules/ws/wrapper.mjs'
import { AccessToken, RoomServiceClient, TrackSource } from '../server/node_modules/livekit-server-sdk/dist/index.js'
import { createOwnedRemoteBrowser } from './party-remote-browser.mjs'
import { prepareMediaConfig } from './prepare-ktv-media-config.mjs'

const exec = promisify(execFile), origin = process.env.KTV_TRANSPORT_ORIGIN || 'https://music.micstec.com'
const publicIp = process.env.KTV_TRANSPORT_IP, turnDomain = process.env.KTV_TRANSPORT_DOMAIN
const networkInterface = process.env.KTV_TRANSPORT_INTERFACE, tlsRoot = process.env.KTV_TRANSPORT_TLS
assert.ok(publicIp && turnDomain && networkInterface && tlsRoot, 'Supply KTV_TRANSPORT_IP/DOMAIN/INTERFACE/TLS')
const image = process.env.KTV_TRANSPORT_IMAGE || 'ktv-party-media:release'
const clientLocation = process.env.KTV_TRANSPORT_CLIENT_LOCATION || 'same-host'
assert.ok(['same-host', 'remote-ec2'].includes(clientLocation), 'Unknown client location')
const audienceCount = Number(process.env.KTV_TRANSPORT_AUDIENCES || 0)
const loadSeconds = Number(process.env.KTV_TRANSPORT_LOAD_SECONDS || 60)
assert.ok(Number.isInteger(audienceCount) && audienceCount >= 0 && audienceCount <= 59, 'Audience count must be 0–59')
assert.ok(Number.isInteger(loadSeconds) && loadSeconds >= 10 && loadSeconds <= 180, 'Load duration must be 10–180 seconds')
const credentialSeconds = audienceCount ? 900 : 120
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-public-transport-'))
const configRoot = path.join(root, 'private'), container = `ktv-transport-${randomUUID().slice(0, 8)}`
const room = `ktv-${randomUUID()}`, grants = new Map(), contexts = [], pending = new Map()
let backend, browser, remoteBrowser, running = false, nextId = 0, passed = 0, controlSecret, provider, probeStep = 'configuration', lastSession
const check = (condition, label) => { assert.ok(condition, label); passed++; console.log('PASS', label) }
const poll = async (work, label, timeout = 20000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await work()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(`Timed out: ${label}`)
}
const free = port => new Promise((resolve, reject) => {
  const probe = net.createServer(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(resolve))
})
function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value) }, reject(error) { clearTimeout(timer); reject(error) } })
    browser.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}
async function evaluate(session, expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, session)
  // Provider failures can include token URLs. Keep details out of logs.
  if (result.exceptionDetails) throw new Error('Transport browser operation failed')
  return result.result.value
}
async function page(mode) {
  probeStep = `${mode} browser context`
  const { browserContextId } = await cdp('Target.createBrowserContext'); contexts.push(browserContextId)
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true })
  lastSession = sessionId
  await cdp('Page.enable', {}, sessionId); await cdp('Runtime.enable', {}, sessionId)
  // A static SVG establishes the HTTPS origin without mounting the app or
  // creating a production guest identity.
  await cdp('Page.navigate', { url: origin + '/poster-default.svg' }, sessionId)
  await poll(() => evaluate(sessionId, `location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`), 'public static HTTPS origin')
  probeStep = `${mode} SDK loading`
  await evaluate(sessionId, await fs.readFile('node_modules/livekit-client/dist/livekit-client.umd.js', 'utf8'))
  await evaluate(sessionId, `window.transportMode=${JSON.stringify(mode)}; window.transportPeers=[];window.offeredUrls=[];
    window.transportConfig=config=>{
      config={...config};
      offeredUrls.push(...(config.iceServers||[]).flatMap(item=>[].concat(item.urls)));
      config.iceServers=transportMode==='direct' ? [] : (config.iceServers || []).map(item=>({...item,urls:[].concat(item.urls).filter(url=>url.startsWith('turns:'))})).filter(item=>item.urls.length);
      config.iceTransportPolicy=transportMode==='direct'?'all':'relay';return config;
    };
    const NativePeer=window.RTCPeerConnection;
    window.RTCPeerConnection=class extends NativePeer { constructor(config, ...args) {
      super(transportConfig(config),...args);transportPeers.push(this);
    }
    setConfiguration(config){super.setConfiguration(transportConfig(config))}
    }; true`)
  return sessionId
}
async function issue(scope) {
  const identity = `ktv-media-${randomUUID()}`
  grants.set(identity, { identity, room, scope, expires: Date.now() + credentialSeconds * 1000, revoked: false, removed: false })
  const access = new AccessToken('ktv-party', provider.secret, { identity, ttl: credentialSeconds })
  access.addGrant({ roomJoin: true, room, canPublish: scope === 'publisher', canSubscribe: scope === 'audience', canPublishData: false,
    canPublishSources: scope === 'publisher' ? [TrackSource.MICROPHONE, TrackSource.CAMERA] : [] })
  return { identity, token: await access.toJwt() }
}
const stats = session => evaluate(session, `(async()=>{
  const groups=(await Promise.all(transportPeers.map(peer=>peer.getStats()))).map(report=>[...report.values()]);
  const reports=groups.flat();
  // Resolve IDs within each peer's report and follow the transport's current
  // selection. Nominated/succeeded historical pairs need not carry current RTP.
  const selected=groups.flatMap(rows=>rows.filter(item=>item.type==='transport'&&item.selectedCandidatePairId).map(item=>{
    const pair=rows.find(value=>value.id===item.selectedCandidatePairId);return {pair,candidate:rows.find(value=>value.id===pair?.localCandidateId)};
  })).filter(item=>item.pair?.state==='succeeded'&&item.candidate);
  const pairs=selected.map(item=>item.pair), candidates=selected.map(item=>item.candidate);
  const inbound=reports.filter(item=>item.type==='inbound-rtp');
  const configuredUrls=transportPeers.flatMap(peer=>(peer.getConfiguration().iceServers||[]).flatMap(item=>[].concat(item.urls)));
  return { pairs:pairs.length, types:candidates.map(item=>item.candidateType),
    relayProtocols:candidates.map(item=>item.relayProtocol || ''),
    tls:candidates.some(item=>(item.url || '').startsWith('turns:')),
    tlsOnly:configuredUrls.length>0&&configuredUrls.every(url=>url.startsWith('turns:')),
    audioBytes:inbound.filter(item=>item.kind==='audio').reduce((sum,item)=>sum+(item.bytesReceived||0),0),
    videoBytes:inbound.filter(item=>item.kind==='video').reduce((sum,item)=>sum+(item.bytesReceived||0),0),
    frames:inbound.filter(item=>item.kind==='video').reduce((sum,item)=>sum+(item.framesDecoded||0),0),
    packetsLost:inbound.reduce((sum,item)=>sum+Math.max(0,item.packetsLost||0),0),
    packetsReceived:inbound.reduce((sum,item)=>sum+(item.packetsReceived||0),0),
    jitterMs:inbound.map(item=>(item.jitter||0)*1000),
    roundTripMs:pairs.map(item=>(item.currentRoundTripTime||0)*1000),
    jitterBuffers:['audio','video'].map(kind=>({kind,
      delay:inbound.filter(item=>item.kind===kind).reduce((sum,item)=>sum+(item.jitterBufferDelay||0),0),
      emitted:inbound.filter(item=>item.kind===kind).reduce((sum,item)=>sum+(item.jitterBufferEmittedCount||0),0)})),
    resolutions:inbound.filter(item=>item.kind==='video').map(item=>({width:item.frameWidth,height:item.frameHeight})),
    framesDropped:inbound.reduce((sum,item)=>sum+(item.framesDropped||0),0),
    state:window.performanceRoom?.state };
})()`)
async function connect(session, credential) {
  probeStep = 'public signaling and ICE connection'
  await evaluate(session, `(async()=>{
    const {Room,RoomEvent}=LivekitClient;
    window.transportPeers=[]; window.performanceRoom=new Room({adaptiveStream:false,dynacast:false,reconnectPolicy:{nextRetryDelayInMs:()=>null}});window.tracks=[];
    performanceRoom.on(RoomEvent.TrackSubscribed,track=>tracks.push(track));
    await performanceRoom.connect(${JSON.stringify(origin.replace('https:', 'wss:') + '/api/ktv/media')},${JSON.stringify(credential.token)},
      {rtcConfig:{iceTransportPolicy:transportMode==='direct'?'all':'relay'}});return true;
  })()`)
}
async function playAudienceAudio(session) {
  await evaluate(session, `(async()=>{
    const audioTracks=tracks.filter(track=>track.kind==='audio');
    for(const track of audioTracks){const element=document.createElementNS('http://www.w3.org/1999/xhtml','audio');
      track.attach(element);document.documentElement.appendChild(element);await element.play();}
    await performanceRoom.startAudio();return true;
  })()`)
  await poll(async () => (await stats(session)).jitterBuffers.some(item=>item.kind==='audio'&&item.emitted>0), 'actual received audio playout')
}
const denied = (session, credential) => evaluate(session, `fetch(${JSON.stringify(origin + '/api/ktv/media/rtc/validate')},
  {headers:{Authorization:${JSON.stringify('Bearer ' + credential.token)}}}).then(response=>response.status===403)`)
try {
  for (const port of [3103, 7880, 7881, 5349]) await free(port)
  const cert = await fs.readFile(path.join(tlsRoot, 'fullchain.pem')), key = await fs.readFile(path.join(tlsRoot, 'privkey.pem'))
  const x509 = new X509Certificate(cert)
  check(x509.checkHost(turnDomain) && Date.parse(x509.validTo) > Date.now() + 86400000 && x509.checkPrivateKey(createPrivateKey(key)), 'trusted TURN files match hostname/key and remain valid')
  await prepareMediaConfig({ directory: configRoot, publicIp, turnDomain, origin, networkInterface })
  await fs.writeFile(path.join(configRoot, 'tls/fullchain.pem'), cert, { mode: 0o600 })
  await fs.writeFile(path.join(configRoot, 'tls/privkey.pem'), key, { mode: 0o600 })
  const settings = Object.fromEntries((await fs.readFile(path.join(configRoot, 'worker.env'), 'utf8')).trim().split('\n').map(line => line.split('=')))
  controlSecret = settings.KTV_MEDIA_CONTROL_SECRET
  provider = new RoomServiceClient('http://127.0.0.1:7880', settings.KTV_MEDIA_API_KEY, settings.KTV_MEDIA_API_SECRET, { requestTimeout: 2, failover: false })
  provider.secret = settings.KTV_MEDIA_API_SECRET
  backend = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${controlSecret}`) { res.writeHead(403); res.end(); return }
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 16384) { res.writeHead(413); res.end(); return } }
    const input = JSON.parse(body || '{}'); let data
    if (req.url === '/internal/ktv/media/reconcile') data = [...grants.values()].filter(item => (item.revoked || item.expires <= Date.now()) && !item.removed).map(({ room, identity }) => ({ room, identity }))
    else if (req.url === '/internal/ktv/media/authorize') {
      const grant = grants.get(input.claims?.sub)
      data = grant && !grant.revoked && grant.expires > Date.now() ? { room: grant.room, identity: grant.identity, scope: grant.scope } : null
    } else if (req.url === '/internal/ktv/media/removed') { const grant = grants.get(input.identity); if (grant) grant.removed = true; data = { removed: true } }
    else { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ success: true, data }))
  })
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening')
  const envPath = path.join(configRoot, 'worker.env')
  await fs.writeFile(envPath, (await fs.readFile(envPath, 'utf8')).replace('KTV_MEDIA_BACKEND_URL=http://127.0.0.1:3101', `KTV_MEDIA_BACKEND_URL=http://127.0.0.1:${backend.address().port}`), { mode: 0o600 })
  await exec('docker', ['run', '-d', '--name', container, '--network', 'host', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--user', `${process.getuid()}:${process.getgid()}`, '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--env-file', envPath,
    '--mount', `type=bind,src=${configRoot},dst=/run/ktv,readonly`, image]); running = true
  await poll(async () => { try {
    const response = await fetch('http://127.0.0.1:3103/control/health', { method: 'POST', headers: { Authorization: `Bearer ${controlSecret}` }, signal: AbortSignal.timeout(500) })
    return (await response.json()).data?.ready
  } catch { return false } }, 'supervised public transport service ready')
  check(true, 'supervisor owns SFU on production media ports with isolated policy')
  const response = await exec('curl', ['-sS', '-A', 'Mozilla/5.0', '--max-time', '10', '-w', '\n%{http_code}', origin + '/api/ktv/media/rtc/validate'])
  check(response.stdout.trim() === 'Media access unavailable\n403', 'public nginx/CDN signaling reaches gateway and rejects missing credentials')
  if (process.env.KTV_TRANSPORT_SSH_HOST) {
    assert.equal(clientLocation, 'remote-ec2', 'Owned remote fixture requires remote-ec2 client label')
    remoteBrowser = await createOwnedRemoteBrowser({ host: process.env.KTV_TRANSPORT_SSH_HOST,
      knownHosts: process.env.KTV_TRANSPORT_KNOWN_HOSTS, debugPort: Number(process.env.KTV_TRANSPORT_CHROME_PORT || 9243) })
  }
  const info = await (await fetch((remoteBrowser?.debuggerUrl || process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9230') + '/json/version')).json()
  browser = new WebSocket(info.webSocketDebuggerUrl); await once(browser, 'open')
  browser.on('message', raw => { const message = JSON.parse(raw); if (!message.id) return; const task = pending.get(message.id); if (!task) return; pending.delete(message.id); message.error ? task.reject(new Error('CDP command failed')) : task.resolve(message.result) })
  console.log('Browser:', info.Browser, '; client location:', clientLocation)
  const singer = await page('direct')
  probeStep = 'publisher credential'
  const publisher = await issue('publisher')
  await connect(singer, publisher)
  probeStep = 'synthetic publisher tracks'
  await evaluate(singer, `(async()=>{
    window.audioContext=new AudioContext();await audioContext.resume();const oscillator=audioContext.createOscillator();oscillator.frequency.value=440;
    const destination=audioContext.createMediaStreamDestination();oscillator.connect(destination);oscillator.start();
    const load = ${audienceCount > 0};
    const canvas=document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=load?1280:640;canvas.height=load?720:360;
    const ctx=canvas.getContext('2d');window.videoTimer=setInterval(()=>{ctx.fillStyle='#102030';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#28aa60';ctx.fillRect(Date.now()%1000,240,180,40);ctx.fillStyle='white';ctx.font='32px sans-serif';ctx.fillText('KTV transport '+Date.now(),20,180)},load?40:100);
    const video=canvas.captureStream(load?25:10);
    await performanceRoom.localParticipant.publishTrack(destination.stream.getAudioTracks()[0],{name:'performance-mix',source:LivekitClient.Track.Source.Microphone,stream:'performance',...(load?{audioPreset:{maxBitrate:64000},dtx:false,red:true}:{})});
    await performanceRoom.localParticipant.publishTrack(video.getVideoTracks()[0],{name:'performance-lyrics',source:LivekitClient.Track.Source.Camera,stream:'performance',...(load?{degradationPreference:'maintain-resolution',simulcast:false,videoEncoding:{maxBitrate:350000,maxFramerate:25}}:{})});return true;
  })()`)
  probeStep = 'provider publisher tracks'
  await poll(async () => (await provider.listParticipants(room)).some(item => item.identity === publisher.identity && item.tracks.length === 2), 'provider reports published audio/video')
  check(true, 'public gated publisher has audio and lyric-video tracks')
  for (const mode of ['direct', 'turn-tls']) {
    const listener = await page(mode), audience = await issue('audience')
    await connect(listener, audience)
    await poll(async () => { const sample = await stats(listener); return sample.audioBytes > 0 && sample.videoBytes > 0 && sample.frames >= 10 }, `${mode} receives and decodes audio/video`, 30000)
    const sample = await stats(listener)
    console.log('Transport statistics:', JSON.stringify({ mode, ...sample }))
    check(sample.pairs > 0 && sample.audioBytes > 0 && sample.frames > 0, `${mode} transfers actual RTP and decodes lyric video`)
    if (mode === 'direct') check(!sample.types.includes('relay'), 'direct transport selected no relay candidate')
    if (mode === 'turn-tls') check(sample.types.includes('relay') && sample.tlsOnly && sample.relayProtocols.every(value=>['tls','tcp'].includes(value)), 'forced relay used only trusted turns: servers without certificate bypass')
    grants.get(audience.identity).revoked = true
    probeStep = `${mode} audience revocation`
    await poll(async () => grants.get(audience.identity).removed && !(await provider.listParticipants(room)).some(item => item.identity === audience.identity), `${mode} provider revocation`)
    await poll(() => evaluate(listener, "performanceRoom.state==='disconnected'"), `${mode} audience revoked`)
    check(grants.get(audience.identity).removed, `${mode} revocation has provider acknowledgment`)
    check(await denied(listener, audience), `${mode} revoked unexpired JWT cannot restore public media access`)
  }
  if (audienceCount) {
    const listeners = []
    for (let index = 0; index < audienceCount; index++) {
      const mode = index % 2 ? 'turn-tls' : 'direct', session = await page(mode), credential = await issue('audience')
      await connect(session, credential)
      await poll(async () => { const value = await stats(session); return value.audioBytes > 0 && value.frames >= 10 }, `load audience ${index + 1} receives`, 30000)
      await playAudienceAudio(session)
      listeners.push({ session, credential, mode })
      console.log(`Load audience ${index + 1}/${audienceCount} connected (${mode})`)
    }
    check((await provider.listParticipants(room)).length === audienceCount + 1, 'one publisher fans out to every requested concurrent audience')
    probeStep = 'concurrent fanout measurement'
    const baseline = await Promise.all(listeners.map(item => stats(item.session)))
    const started = Date.now(), samples = [], resources = []
    while (Date.now() - started < loadSeconds * 1000) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      samples.push(await Promise.all(listeners.map(item => stats(item.session))))
      const usage = JSON.parse((await exec('docker', ['stats', '--no-stream', '--format', '{{json .}}', container])).stdout)
      resources.push({ cpu: usage.CPUPerc, memory: usage.MemUsage, network: usage.NetIO })
      assert.ok(samples.at(-1).every(item => item.state === 'connected'), 'All load audiences must stay connected')
    }
    const final = samples.at(-1), durations = (Date.now() - started) / 1000
    const metrics = final.map((item, index) => {
      const before = baseline[index], frames = item.frames - before.frames, audio = item.audioBytes - before.audioBytes, video = item.videoBytes - before.videoBytes
      const lost = Math.max(0, item.packetsLost - before.packetsLost), received = item.packetsReceived - before.packetsReceived
      return { mode: listeners[index].mode, fps: Number((frames / durations).toFixed(2)), audioBytes: audio, videoBytes: video,
        packetLossPercent: Number((100 * lost / Math.max(1, lost + received)).toFixed(3)), framesDropped: item.framesDropped - before.framesDropped,
        jitterBufferMs: item.jitterBuffers.map(value => { const previous = before.jitterBuffers.find(old => old.kind === value.kind), emitted = value.emitted - previous.emitted;
          return { kind: value.kind, ms: emitted > 0 ? Number((1000 * (value.delay - previous.delay) / emitted).toFixed(2)) : null }; }),
        audioPlayoutSamples: item.jitterBuffers.find(value=>value.kind==='audio').emitted - before.jitterBuffers.find(value=>value.kind==='audio').emitted,
        resolutions: item.resolutions, pairs: item.pairs, candidateTypes: item.types, tls: item.tls, tlsOnly: item.tlsOnly, relayProtocols: item.relayProtocols,
        jitterMs: item.jitterMs.map(value => Number(value.toFixed(2))), roundTripMs: item.roundTripMs.map(value => Number(value.toFixed(2))) }
    })
    console.log('Fanout measurement:', JSON.stringify({ audiences: audienceCount, seconds: Number(durations.toFixed(1)), source: 'synthetic 1280x720 canvas at 25 fps, app single-video/350-kbit and audio/64-kbit settings', metrics, resources }))
    check(metrics.every(item => item.audioBytes > 0 && item.videoBytes > 0 && item.fps >= 5), 'every concurrent audience advances audio and decodes at least five video frames per second')
    check(metrics.every(item => item.audioPlayoutSamples > 0), 'every concurrent audience decodes and plays received audio')
    check(final.every((item, index) => item.pairs > 0 && (listeners[index].mode === 'direct' ? !item.types.includes('relay') : item.types.every(value=>value==='relay') && item.tlsOnly && item.tls && item.relayProtocols.every(value=>['tls','tcp'].includes(value)))), 'concurrent direct and strict TLS relay audiences keep their intended ICE routes')
    // An authorized user can deliberately leave and reconnect with their still
    // live credential. This is not a simulated Wi-Fi/LTE outage or automatic retry.
    probeStep = 'authorized audience reconnect'
    const reconnect = listeners[0]
    await evaluate(reconnect.session, 'performanceRoom.disconnect()')
    await poll(async () => !(await provider.listParticipants(room)).some(item => item.identity === reconnect.credential.identity), 'load audience leaves provider')
    await connect(reconnect.session, reconnect.credential)
    await poll(async () => { const value = await stats(reconnect.session); return value.state === 'connected' && value.frames >= 10 }, 'authorized audience reconnect')
    await playAudienceAudio(reconnect.session)
    check((await provider.listParticipants(room)).some(item => item.identity === reconnect.credential.identity), 'authorized unexpired audience credential permits deliberate reconnect')
    probeStep = 'fanout audience revocation'
    for (const item of listeners) grants.get(item.credential.identity).revoked = true
    await poll(async () => listeners.every(item => grants.get(item.credential.identity).removed) && (await provider.listParticipants(room)).length === 1, 'all fanout audience revocations acknowledged', 30000)
    check(listeners.every(item => grants.get(item.credential.identity).removed), 'all concurrent audience revocations have provider acknowledgment')
    check((await Promise.all(listeners.map(item => denied(item.session, item.credential)))).every(Boolean), 'all revoked fanout credentials are denied at the public gateway')
  }
  grants.get(publisher.identity).revoked = true
  probeStep = 'publisher revocation'
  await poll(() => evaluate(singer, "performanceRoom.state==='disconnected'"), 'publisher revoked')
  check(grants.get(publisher.identity).removed, 'publisher revoked by provider through supervisor gateway')
  check(await denied(singer, publisher), 'revoked publisher JWT cannot restore public media access')
  console.log(`${passed} supervised public-origin transport checks passed. Client: ${clientLocation}; synthetic policy/media only; integrated room, physical and access-network acceptance remains open.`)
} catch (error) {
  if (lastSession) console.error('ICE configuration:', JSON.stringify(await evaluate(lastSession, `({mode:transportMode,
    offeredTls:offeredUrls.filter(url=>url.startsWith('turns:')).length,
    offeredTls5349:offeredUrls.filter(url=>url.startsWith('turns:')&&url.includes(':5349')).length,
    peerStates:transportPeers.map(peer=>({ice:peer.iceConnectionState,connection:peer.connectionState,
      servers:(peer.getConfiguration().iceServers||[]).flatMap(item=>[].concat(item.urls)).length}))})`).catch(()=>null)))
  if (running) {
    const details = await exec('docker', ['logs', container]).catch(() => ({ stdout: '', stderr: '' }))
    const safe = (details.stdout + details.stderr).split('\n').filter(line => line.startsWith('[ktv-media]')).join('\n')
    console.error(safe.slice(-1000))
  }
  console.error('Transport probe failed at', probeStep, ':', ['Transport browser operation failed', 'CDP command failed'].includes(error.message) || /^(Timed out:|CDP timeout:)/.test(error.message) ? error.message : 'configuration, port, process or transport assertion')
  process.exitCode = 1
} finally {
  if (browser?.readyState === WebSocket.OPEN) for (const browserContextId of contexts) await cdp('Target.disposeBrowserContext', { browserContextId }).catch(() => {})
  browser?.close()
  if (remoteBrowser) await remoteBrowser.close().catch(() => { console.error('Owned remote browser cleanup was not verified'); process.exitCode = 1 })
  if (running) await exec('docker', ['rm', '-f', container]).catch(() => {})
  if (backend?.listening) await new Promise(resolve => { backend.close(resolve); backend.closeAllConnections() })
  await fs.rm(root, { recursive: true, force: true })
}
