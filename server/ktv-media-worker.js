import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { RoomServiceClient, TrackSource, TrackType } from 'livekit-server-sdk'
import { createKtvMediaGateway } from './ktv-media-gateway.js'

function loopback(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Media control and SFU signaling must use private loopback URLs')
  }
  return url
}

// This process must own the SFU process. Its fatal callback kills that child;
// merely dropping WebSockets would leave established RTP flows running.
export function createKtvMediaWorker({ backendUrl, upstreamUrl, apiKey, apiSecret, controlSecret,
  origins, stopSfu, turnTls, pollMs = 250, timeoutMs = 1000, provider: suppliedProvider }) {
  const backend = loopback(backendUrl), upstream = loopback(upstreamUrl)
  if (!apiKey || !apiSecret || apiSecret.length < 32 || !controlSecret || controlSecret.length < 32 ||
    !Array.isArray(origins) || !origins.length || typeof stopSfu !== 'function' ||
    !Number.isSafeInteger(pollMs) || pollMs < 20 || pollMs > 1000 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 3000) {
    throw new Error('Invalid KTV media worker configuration')
  }
  const expected = Buffer.from(`Bearer ${controlSecret}`)
  const provider = suppliedProvider || new RoomServiceClient(upstream.toString(), apiKey, apiSecret, { requestTimeout: 2, failover: false })
  let ready = false, stopped = false, busy = false, fatalTask = null
  async function backendRequest(path, body = {}) {
    const response = await fetch(new URL(path, backend), { method: 'POST',
      headers: { Authorization: expected.toString(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
    if (!response.ok) { const error = new Error('Media policy unavailable'); error.status = response.status; throw error }
    const result = await response.json()
    if (result.success !== true) throw new Error('Media policy unavailable')
    return result.data
  }
  async function fatal() {
    ready = false; stopped = true
    clearInterval(timer)
    if (!fatalTask) fatalTask = Promise.resolve().then(stopSfu)
    await fatalTask
  }
  const gateway = createKtvMediaGateway({ upstreamUrl: upstream.toString(), apiKey, apiSecret, pollMs, turnTls,
    // Same-origin validation GETs may omit Origin. They still require the exact
    // signed token and current persisted nonce; supplied browser origins must match.
    allowedOrigin: origin => !origin || (typeof origin === 'string' && origins.includes(origin)),
    authorize: async claims => {
      if (!ready || stopped) return null
      try {
        const grant = await backendRequest('/internal/ktv/media/authorize', { claims })
        return stopped ? null : grant
      } catch { await fatal(); throw new Error('Media policy unavailable') }
    },
    removeParticipant: async (room, identity) => {
      try { await provider.removeParticipant(room, identity) }
      catch (error) { if (error.code !== 'not_found') throw new Error('Provider removal failed') }
      // An absent participant is a valid provider acknowledgment too. Persist
      // the nonce's terminal state before a replacement can be issued.
      await backendRequest('/internal/ktv/media/removed', { room, identity })
    },
    onFatal: fatal,
  })
  async function body(req) {
    let bytes = 0, chunks = []
    for await (const chunk of req) {
      bytes += chunk.length
      if (bytes > 16384) throw new Error('Control body too large')
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString() || '{}')
  }
  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith('/control/')) return gateway.http(req, res)
    res.setHeader('Cache-Control', 'no-store')
    const supplied = Buffer.from(req.headers.authorization || '')
    if (req.method !== 'POST' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.writeHead(403); res.end(); return
    }
    try {
      const data = await body(req)
      let result
      if (req.url === '/control/health') result = { ready: ready && !stopped }
      else if (req.url === '/control/revoke' && !stopped && /^ktv-[0-9a-f-]{36}$/.test(data.room) && /^ktv-media-[0-9a-f-]{36}$/.test(data.identity)) {
        await gateway.revoke(data); result = { removed: true }
      } else if (req.url === '/control/publisher-ready' && ready && !stopped && /^ktv-[0-9a-f-]{36}$/.test(data.room) && /^ktv-media-[0-9a-f-]{36}$/.test(data.identity)) {
        let participant
        try { participant = await provider.getParticipant(data.room, data.identity) }
        catch (error) { if (error.code === 'not_found') { res.writeHead(409); res.end(); return } throw error }
        const tracks = participant.tracks || []
        if (tracks.length !== 2 || !tracks.some(track => track.type === TrackType.AUDIO && track.source === TrackSource.MICROPHONE && track.name === 'performance-mix') ||
          !tracks.some(track => track.type === TrackType.VIDEO && track.source === TrackSource.CAMERA && track.name === 'performance-lyrics')) {
          res.writeHead(409); res.end(); return
        }
        try { await backendRequest('/internal/ktv/media/ready', data) }
        catch (error) { if ([403, 404, 409].includes(error.status)) { res.writeHead(409); res.end(); return } throw error }
        result = { ready: true }
      } else { res.writeHead(stopped ? 503 : 400); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data: result }))
    } catch {
      await fatal(); res.writeHead(503); res.end()
    }
  })
  server.requestTimeout = 3000; server.headersTimeout = 3000
  server.on('upgrade', (req, socket, head) => void gateway.upgrade(req, socket, head))
  async function reconcile() {
    if (busy || stopped) return
    busy = true
    try {
      const health = await fetch(upstream, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
      if (!health.ok) throw new Error('SFU unavailable')
      const targets = await backendRequest('/internal/ktv/media/reconcile')
      if (!Array.isArray(targets) || targets.length > 1000) throw new Error('Invalid media reconciliation')
      for (const target of targets) await gateway.revoke(target)
      ready = !stopped
    } catch { await fatal() }
    finally { busy = false }
  }
  const timer = setInterval(() => void reconcile(), pollMs)
  timer.unref()
  return { server, reconcile, get ready() { return ready && !stopped }, get failed() { return stopped },
    async close() {
      clearInterval(timer); ready = false
      try { await gateway.close() } finally { await fatal() }
      if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
    }, fatal }
}
