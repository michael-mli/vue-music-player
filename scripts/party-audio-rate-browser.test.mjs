// Native offline rendering verifies the media-position integral against actual
// AudioBufferSource playback, without returning PCM or claiming acoustic proof.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import WebSocket from '../server/node_modules/ws/wrapper.mjs'
import { createOwnedRemoteBrowser } from './party-remote-browser.mjs'

const source = await fs.readFile('src/utils/partyTimeline.ts', 'utf8')
const module = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const html = `<!doctype html><title>Owned native rate integral fixture</title><script type="module">
  import { PartySourcePosition } from '/timeline.js';
  window.probe = async (profile) => {
    const rate = 44100, seconds = 20, context = new OfflineAudioContext(1, rate * 23, rate);
    const buffer = context.createBuffer(1, rate * seconds, rate), data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) {
      const frequency = Math.floor(index / rate / 2) % 2 ? 660 : 440;
      data[index] = .15 * Math.sin(2 * Math.PI * frequency * index / rate);
    }
    const node = context.createBufferSource(), position = new PartySourcePosition(0, 0);
    node.buffer = buffer; node.connect(context.destination); node.start(0);
    const schedules = [];
    for (let second = 1; second <= 18; second++) {
      const target = profile === 'faster' ? 1.005 : profile === 'slower' ? .995 : second <= 9 ? 1.005 : .995;
      position.apply(node.playbackRate, second, target);
      schedules.push({ time: second, rate: position.rateAt(second + .5) });
    }
    const rendered = (await context.startRendering()).getChannelData(0), edges = [];
    let lastCrossing = null, state = null, lastNonzero = 0;
    for (let index = 1; index < rendered.length; index++) {
      if (Math.abs(rendered[index]) > .0001) lastNonzero = index;
      if (rendered[index - 1] > 0 || rendered[index] <= 0) continue;
      if (lastCrossing !== null) {
        const next = index - lastCrossing > 83;
        if (state !== null && next !== state) {
          const id = edges.length + 1, time = index / rate, mediaPositionMs = position.positionAt(time);
          edges.push({ id, time, mediaPositionMs, errorMs: mediaPositionMs - id * 2000 });
        }
        state = next;
      }
      lastCrossing = index;
    }
    return { profile, rate, edges, schedules, lastNonzeroTime: lastNonzero / rate,
      finalMappedPositionMs: position.positionAt(lastNonzero / rate) };
  };
  window.ready = true;
</script>`
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', req.url === '/timeline.js' ? 'text/javascript' : 'text/html')
  res.end(req.url === '/timeline.js' ? module : html)
})
const connections = new Set(); server.on('connection', socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)) })
let browser, socket, session, contextId, nextId = 0, passed = 0
const pending = new Map(), errors = []
const check = (value, message) => { assert.ok(value, message); passed++; console.log('PASS', message) }
function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve(value) { clearTimeout(timer); resolve(value) }, reject(error) { clearTimeout(timer); reject(error) } })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  browser = await createOwnedRemoteBrowser({ host: process.env.KTV_ROOM_TEST_SSH_HOST, knownHosts: process.env.KTV_ROOM_TEST_KNOWN_HOSTS,
    frontendPort: server.address().port, debugPort: 9245 })
  const info = await (await fetch(browser.debuggerUrl + '/json/version')).json()
  console.log('Native rate source SHA256:', createHash('sha256').update(source).digest('hex'), '; browser:', info.Browser)
  socket = new WebSocket(info.webSocketDebuggerUrl); await once(socket, 'open')
  socket.on('message', raw => {
    const packet = JSON.parse(raw)
    if (packet.id) {
      const request = pending.get(packet.id); if (!request) return
      pending.delete(packet.id); packet.error ? request.reject(new Error(packet.error.message)) : request.resolve(packet.result)
    } else if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails.text)
  })
  ;({ browserContextId: contextId } = await cdp('Target.createBrowserContext'))
  const { targetId } = await cdp('Target.createTarget', { browserContextId: contextId, url: 'about:blank' })
  ;({ sessionId: session } = await cdp('Target.attachToTarget', { targetId, flatten: true }))
  await cdp('Runtime.enable', {}, session); await cdp('Page.enable', {}, session)
  await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }, session)
  const end = Date.now() + 5000
  while (!await evaluate('window.ready')) { if (Date.now() > end) throw new Error('Native rate module unavailable'); await new Promise(resolve => setTimeout(resolve, 100)) }
  for (const profile of ['faster', 'slower', 'reverse']) {
    const result = await evaluate(`probe(${JSON.stringify(profile)})`)
    console.log('Native media-position measurement:', JSON.stringify(result))
    check(result.edges.length === 9, `${profile}: all nine actual PCM frequency transitions are observed`)
    check(result.edges.every(edge => Math.abs(edge.errorMs) < 3), `${profile}: native rendered markers agree with integrated rate position within three milliseconds`)
    check(Math.abs(result.finalMappedPositionMs - 20000) < 3, `${profile}: native source completion agrees with the integrated media position`)
    check(result.schedules.every(item => item.rate >= .995 && item.rate <= 1.005), `${profile}: every scheduled native ramp retains the bounded rate`)
  }
  check(errors.length === 0, 'native rate rendering has no browser runtime exception')
  console.log(`${passed} native rate integral checks passed; no physical/pitch acceptance claim`)
} finally {
  if (socket?.readyState === WebSocket.OPEN && contextId) await cdp('Target.disposeBrowserContext', { browserContextId: contextId }).catch(() => {})
  socket?.close()
  for (const request of pending.values()) request.reject(new Error('Owned rate fixture closed'))
  pending.clear()
  try { await browser?.close() } finally {
    for (const connection of connections) connection.destroy()
    if (server.listening) await new Promise(resolve => server.close(resolve))
  }
}
