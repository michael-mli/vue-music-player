// Real process-lifetime checks for the owned, loopback-only SFU container.
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import WebSocket from '../server/node_modules/ws/wrapper.mjs'
import { AccessToken, RoomServiceClient, TrackSource } from '../server/node_modules/livekit-server-sdk/dist/index.js'

const exec = promisify(execFile), root = await fs.mkdtemp(path.join(os.tmpdir(), 'ktv-supervisor-'))
const apiKey = 'ktv-supervisor-test', apiSecret = randomBytes(32).toString('hex'), controlSecret = randomBytes(32).toString('hex')
const room = `ktv-${randomUUID()}`, identity = `ktv-media-${randomUUID()}`
const upstream = 'http://127.0.0.1:17890', control = 'http://127.0.0.1:17893', sockets = []
let policyUp = true, owned, count = 0
const check = (condition, label) => { assert.ok(condition, label); count++; console.log(`PASS ${label}`) }
const poll = async (work, label) => {
  for (let attempt = 0; attempt < 100; attempt++) { if (await work()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(`Timed out: ${label}`)
}
const backend = http.createServer(async (req, res) => {
  if (!policyUp || req.headers.authorization !== `Bearer ${controlSecret}`) { res.writeHead(503); res.end(); return }
  let input = ''; for await (const chunk of req) input += chunk
  const body = JSON.parse(input || '{}')
  let data
  if (req.url === '/internal/ktv/media/reconcile') data = []
  else if (req.url === '/internal/ktv/media/authorize') data = body.claims?.sub === identity ? { room, identity, scope: 'publisher' } : null
  else if (req.url === '/internal/ktv/media/removed') data = { removed: true }
  else { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data }))
})
backend.listen(0, '127.0.0.1'); await once(backend, 'listening')
const origin = `http://127.0.0.1:${backend.address().port}`
const provider = new RoomServiceClient(upstream, apiKey, apiSecret, { requestTimeout: 1, failover: false })
const config = path.join(root, 'livekit.yaml'), env = path.join(root, 'worker.env')
await fs.writeFile(config, `port: 17890\nbind_addresses: [127.0.0.1]\nrtc:\n  node_ip: 127.0.0.1\n  use_external_ip: false\n  tcp_port: 17891\n  udp_port: 17892\n  enable_loopback_candidate: true\n  interfaces:\n    includes: [lo]\nroom:\n  max_participants: 6\n  sync_streams: true\n  playout_delay:\n    enabled: true\n    min: 0\n    max: 500\nkeys:\n  ${apiKey}: ${apiSecret}\nlogging:\n  level: warn\n`, { mode: 0o600 })
await fs.writeFile(env, `KTV_SFU_CONFIG=/run/ktv/livekit.yaml\nKTV_SFU_URL=${upstream}\nKTV_MEDIA_WORKER_PORT=17893\nKTV_MEDIA_BACKEND_URL=${origin}\nKTV_MEDIA_ORIGINS=${origin}\nKTV_MEDIA_API_KEY=${apiKey}\nKTV_MEDIA_API_SECRET=${apiSecret}\nKTV_MEDIA_CONTROL_SECRET=${controlSecret}\n`, { mode: 0o600 })
async function launch() {
  owned = `ktv-supervisor-test-${randomUUID().slice(0, 8)}`
  await exec('docker', ['run', '-d', '--name', owned, '--network', 'host', '--read-only', '--cap-drop=ALL',
    '--user', `${process.getuid()}:${process.getgid()}`,
    '--security-opt=no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--env-file', env,
    '-v', `${config}:/run/ktv/livekit.yaml:ro`, process.env.KTV_MEDIA_TEST_IMAGE || 'ktv-party-media:prototype'], { timeout: 30000 })
  try { await poll(async () => {
    try { const response = await fetch(control + '/control/health', { method: 'POST', headers: { Authorization: `Bearer ${controlSecret}` }, signal: AbortSignal.timeout(300) }); return (await response.json()).data?.ready }
    catch { return false }
  }, 'supervised SFU ready') } catch (error) {
    const logs = await exec('docker', ['logs', owned]).catch(() => ({ stdout: '', stderr: '' }))
    const safe = `${logs.stdout}${logs.stderr}`.replaceAll(apiSecret, '[redacted]').replaceAll(controlSecret, '[redacted]')
    console.error(safe.slice(-2000)); throw error
  }
}
async function connect() {
  const access = new AccessToken(apiKey, apiSecret, { identity, ttl: 120 })
  access.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: false, canPublishData: false, canPublishSources: [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE] })
  const token = await access.toJwt()
  const ws = new WebSocket(control.replace('http:', 'ws:') + '/api/ktv/media/rtc?protocol=16&auto_subscribe=0&access_token=' + encodeURIComponent(token), { origin })
  sockets.push(ws); ws.on('error', () => {}); await once(ws, 'open')
  await poll(async () => { try { return (await provider.listParticipants(room)).some(participant => participant.identity === identity) } catch { return false } }, 'provider participant joined')
  return ws
}
async function exited() {
  await poll(async () => (await exec('docker', ['inspect', '--format', '{{.State.Running}}', owned])).stdout.trim() === 'false', 'owned container exits')
}
async function unavailable() {
  try { await fetch(upstream, { signal: AbortSignal.timeout(300) }); return false } catch { return true }
}
try {
  await launch()
  check((await fetch(control + '/control/health', { method: 'POST' })).status === 403, 'worker control is authenticated')
  const first = await connect(); check(first.readyState === WebSocket.OPEN, 'actual SFU admits the authorized identity through its private gateway')
  check((await provider.listParticipants(room)).length === 1, 'actual SFU contains one publisher identity')
  policyUp = false; await exited()
  check(await unavailable(), 'backend policy failure terminates the owned SFU process and its signaling port')
  await poll(() => first.readyState === WebSocket.CLOSED, 'first signal closed')
  check(first.readyState === WebSocket.CLOSED, 'existing participant signaling closes after SFU termination')
  const failed = JSON.parse((await exec('docker', ['inspect', '--format', '{{json .State}}', owned])).stdout)
  check(failed.ExitCode === 1, 'supervisor exits with failure and cannot silently resume old grants')
  await exec('docker', ['rm', '-f', owned]); owned = undefined
  policyUp = true; await launch()
  const second = await connect(); check(second.readyState === WebSocket.OPEN, 'a fresh owned container starts after policy recovery')
  await exec('docker', ['kill', '--signal=KILL', owned]); await exited()
  check(await unavailable(), 'killing the supervisor PID also kills its SFU child')
  await poll(() => second.readyState === WebSocket.CLOSED, 'second signal closed')
  check(second.readyState === WebSocket.CLOSED, 'supervisor process loss removes its existing participant')
  console.log(`${count} real supervisor/SFU checks passed. Loopback only; no public TURN or physical audio claim.`)
} finally {
  for (const socket of sockets) socket.terminate()
  if (owned) await exec('docker', ['rm', '-f', owned]).catch(() => {})
  await new Promise(resolve => { backend.close(resolve); backend.closeAllConnections() })
  await fs.rm(root, { recursive: true, force: true })
}
