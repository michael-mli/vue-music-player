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
import { prepareMediaConfig } from './prepare-ktv-media-config.mjs'

const exec = promisify(execFile), origin = process.env.KTV_TRANSPORT_ORIGIN || 'https://music.micstec.com'
const publicIp = process.env.KTV_TRANSPORT_IP, turnDomain = process.env.KTV_TRANSPORT_DOMAIN
const networkInterface = process.env.KTV_TRANSPORT_INTERFACE, tlsRoot = process.env.KTV_TRANSPORT_TLS
assert.ok(publicIp && turnDomain && networkInterface && tlsRoot, 'Supply KTV_TRANSPORT_IP/DOMAIN/INTERFACE/TLS')
const image = process.env.KTV_TRANSPORT_IMAGE || 'ktv-party-media:release'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-public-transport-'))
const configRoot = path.join(root, 'private'), container = `ktv-transport-${randomUUID().slice(0, 8)}`
const room = `ktv-${randomUUID()}`, grants = new Map(), contexts = [], pending = new Map()
let backend, browser, running = false, nextId = 0, passed = 0, controlSecret, provider, probeStep = 'configuration', lastSession
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
  grants.set(identity, { identity, room, scope, expires: Date.now() + 120000, revoked: false, removed: false })
  const access = new AccessToken('ktv-party', provider.secret, { identity, ttl: 120 })
  access.addGrant({ roomJoin: true, room, canPublish: scope === 'publisher', canSubscribe: scope === 'audience', canPublishData: false,
    canPublishSources: scope === 'publisher' ? [TrackSource.MICROPHONE, TrackSource.CAMERA] : [] })
  return { identity, token: await access.toJwt() }
}
const stats = session => evaluate(session, `(async()=>{
  const reports=(await Promise.all(transportPeers.map(peer=>peer.getStats()))).flatMap(report=>[...report.values()]);
  const pairs=reports.filter(item=>item.type==='candidate-pair'&&item.state==='succeeded'&&item.nominated);
  const candidates=pairs.map(pair=>reports.find(item=>item.id===pair.localCandidateId)).filter(Boolean);
  const inbound=reports.filter(item=>item.type==='inbound-rtp');
  const configuredUrls=transportPeers.flatMap(peer=>(peer.getConfiguration().iceServers||[]).flatMap(item=>[].concat(item.urls)));
  return { pairs:pairs.length, types:candidates.map(item=>item.candidateType),
    relayProtocols:candidates.map(item=>item.relayProtocol || ''),
    tls:candidates.some(item=>(item.url || '').startsWith('turns:')),
    tlsOnly:configuredUrls.length>0&&configuredUrls.every(url=>url.startsWith('turns:')),
    audioBytes:inbound.filter(item=>item.kind==='audio').reduce((sum,item)=>sum+(item.bytesReceived||0),0),
    videoBytes:inbound.filter(item=>item.kind==='video').reduce((sum,item)=>sum+(item.bytesReceived||0),0),
    frames:inbound.filter(item=>item.kind==='video').reduce((sum,item)=>sum+(item.framesDecoded||0),0),
    state:window.performanceRoom?.state };
})()`)
async function connect(session, credential) {
  probeStep = 'public signaling and ICE connection'
  await evaluate(session, `(async()=>{
    const {Room,RoomEvent}=LivekitClient;
    window.performanceRoom=new Room({adaptiveStream:false,dynacast:false,reconnectPolicy:{nextRetryDelayInMs:()=>null}});window.tracks=[];
    performanceRoom.on(RoomEvent.TrackSubscribed,track=>tracks.push(track));
    await performanceRoom.connect(${JSON.stringify(origin.replace('https:', 'wss:') + '/api/ktv/media')},${JSON.stringify(credential.token)},
      {rtcConfig:{iceTransportPolicy:transportMode==='direct'?'all':'relay'}});return true;
  })()`)
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
  const info = await (await fetch((process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9230') + '/json/version')).json()
  browser = new WebSocket(info.webSocketDebuggerUrl); await once(browser, 'open')
  browser.on('message', raw => { const message = JSON.parse(raw); if (!message.id) return; const task = pending.get(message.id); if (!task) return; pending.delete(message.id); message.error ? task.reject(new Error('CDP command failed')) : task.resolve(message.result) })
  console.log('Browser:', info.Browser, '; client location: same media host')
  const singer = await page('direct')
  probeStep = 'publisher credential'
  const publisher = await issue('publisher')
  await connect(singer, publisher)
  probeStep = 'synthetic publisher tracks'
  await evaluate(singer, `(async()=>{
    window.audioContext=new AudioContext();await audioContext.resume();const oscillator=audioContext.createOscillator();oscillator.frequency.value=440;
    const destination=audioContext.createMediaStreamDestination();oscillator.connect(destination);oscillator.start();
    const canvas=document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=640;canvas.height=360;
    const ctx=canvas.getContext('2d');window.videoTimer=setInterval(()=>{ctx.fillStyle='#102030';ctx.fillRect(0,0,640,360);ctx.fillStyle='white';ctx.font='32px sans-serif';ctx.fillText('KTV transport '+Date.now(),20,180)},100);
    const video=canvas.captureStream(10);
    await performanceRoom.localParticipant.publishTrack(destination.stream.getAudioTracks()[0],{name:'performance-mix',source:LivekitClient.Track.Source.Microphone,stream:'performance'});
    await performanceRoom.localParticipant.publishTrack(video.getVideoTracks()[0],{name:'performance-lyrics',source:LivekitClient.Track.Source.Camera,stream:'performance'});return true;
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
  grants.get(publisher.identity).revoked = true
  probeStep = 'publisher revocation'
  await poll(() => evaluate(singer, "performanceRoom.state==='disconnected'"), 'publisher revoked')
  check(grants.get(publisher.identity).removed, 'publisher revoked by provider through supervisor gateway')
  check(await denied(singer, publisher), 'revoked publisher JWT cannot restore public media access')
  console.log(`${passed} supervised public-origin transport checks passed. Same-host, synthetic policy/media only; room/physical/different-network acceptance remains open.`)
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
  if (running) await exec('docker', ['rm', '-f', container]).catch(() => {})
  if (backend?.listening) await new Promise(resolve => { backend.close(resolve); backend.closeAllConnections() })
  await fs.rm(root, { recursive: true, force: true })
}
