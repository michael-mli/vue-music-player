import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createKtvMediaWorker } from './ktv-media-worker.js'

// Run as PID 1 in the media container. When this supervisor exits or crashes,
// the container also kills its LiveKit child, including existing RTP sessions.
const required = name => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}
const configPath = required('KTV_SFU_CONFIG')
let child, worker, closing = false
async function stopSfu() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 500)
  try { await exited } finally { clearTimeout(timer) }
}
async function shutdown(code) {
  if (closing) return
  closing = true
  await stopSfu()
  await worker?.close()
  process.exit(code)
}
process.on('SIGTERM', () => void shutdown(0)); process.on('SIGINT', () => void shutdown(0))
process.on('uncaughtException', () => { console.error('[ktv-media] supervisor failed'); void shutdown(1) })
process.on('unhandledRejection', () => { console.error('[ktv-media] supervisor failed'); void shutdown(1) })
try {
  // Check that the operator supplied a readable file before spawning. Never print it.
  await readFile(configPath)
  const apiKey = required('KTV_MEDIA_API_KEY'), apiSecret = required('KTV_MEDIA_API_SECRET')
  const controlSecret = required('KTV_MEDIA_CONTROL_SECRET')
  const origins = required('KTV_MEDIA_ORIGINS').split(',').map(value => value.trim()).filter(Boolean)
  const upstreamUrl = process.env.KTV_SFU_URL || 'http://127.0.0.1:7880'
  child = spawn(process.env.KTV_SFU_BIN || '/usr/local/bin/livekit-server', ['--config', configPath], { stdio: ['ignore', 'ignore', 'ignore'] })
  child.once('error', () => void shutdown(1))
  child.once('exit', () => { if (!closing) void shutdown(1) })
  const deadline = Date.now() + 10000
  let up = false
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    try { up = (await fetch(upstreamUrl, { signal: AbortSignal.timeout(500) })).ok } catch { /* Wait for this owned child only. */ }
    if (up) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!up) throw new Error('SFU startup failed')
  worker = createKtvMediaWorker({ backendUrl: process.env.KTV_MEDIA_BACKEND_URL || 'http://127.0.0.1:3101',
    upstreamUrl, apiKey, apiSecret, controlSecret, origins, stopSfu })
  const port = Number(process.env.KTV_MEDIA_WORKER_PORT || 3103)
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid worker port')
  worker.server.listen(port, '127.0.0.1')
  await worker.reconcile()
  if (!worker.ready) throw new Error('Media policy unavailable at startup')
  console.log('[ktv-media] private gateway ready')
} catch (error) {
  const reason = ['SFU startup failed', 'Media policy unavailable at startup', 'Invalid worker port'].includes(error.message) ? error.message : 'configuration or process error'
  console.error(`[ktv-media] startup failed: ${reason}`); await shutdown(1)
}
