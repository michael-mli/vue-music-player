import { WebSocket, WebSocketServer } from 'ws'
import { TokenVerifier } from 'livekit-server-sdk'

// Self-hosted LiveKit does not revoke old JWTs when a participant is removed.
// Keep its signaling port private and validate the immutable identity/nonce at
// this gateway on every join, including refreshed tokens. Media authorization
// comes from the application's persisted grant/lease policy, never JWT TTL alone.
export function createKtvMediaGateway({ upstreamUrl, apiKey, apiSecret, authorize, removeParticipant,
  allowedOrigin, onFatal, prefix = '/api/ktv/media', pollMs = 250 }) {
  const verifier = new TokenVerifier(apiKey, apiSecret)
  const server = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 })
  const connections = new Set()
  const revoking = new Map()
  const joining = new Set()
  let stopped = false, sweeping = false
  const keyOf = grant => `${grant.room}:${grant.identity}`
  const paths = new Set([`${prefix}/rtc`, `${prefix}/rtc/v1`, `${prefix}/rtc/validate`])

  async function access(req) {
    const url = new URL(req.url, 'http://gateway.local')
    if (stopped || !paths.has(url.pathname) || !allowedOrigin(req.headers.origin)) throw new Error('MEDIA_ACCESS_DENIED')
    const token = url.searchParams.get('access_token') || req.headers.authorization?.replace(/^Bearer /, '')
    if (!token || token.length > 16384) throw new Error('MEDIA_ACCESS_DENIED')
    const claims = await verifier.verify(token, 0)
    const grant = await authorize(claims)
    if (!grant || !['audience', 'publisher'].includes(grant.scope) || claims.sub !== grant.identity || claims.video?.room !== grant.room || !claims.video?.roomJoin ||
      claims.video?.roomAdmin || claims.video?.roomCreate || claims.video?.roomList || claims.video?.roomRecord ||
      claims.video?.ingressAdmin || claims.video?.destinationRoom || claims.video?.canPublishData !== false ||
      (grant.scope === 'audience' && claims.video?.canPublishSources?.length) ||
      (grant.scope === 'publisher' && (!claims.video?.canPublishSources?.length || claims.video.canPublishSources.some(source => !['microphone', 'camera'].includes(source)))) ||
      claims.video?.canPublish !== (grant.scope === 'publisher') || claims.video?.canSubscribe !== (grant.scope === 'audience') ||
      revoking.has(keyOf(grant))) throw new Error('MEDIA_ACCESS_DENIED')
    return { url, token, claims, grant }
  }
  function close(connection) {
    connections.delete(connection)
    connection.client?.terminate(); connection.upstream?.terminate()
  }
  async function revoke(grant) {
    const key = keyOf(grant)
    if (revoking.has(key)) return revoking.get(key)
    const work = (async () => {
      for (const connection of connections) if (keyOf(connection.grant) === key) close(connection)
      try { await removeParticipant(grant.room, grant.identity) }
      catch (error) {
        // A closed signaling socket does not stop already established RTP.
        // The deployment supervisor must stop the owned SFU on control failure.
        await onFatal(error)
        throw new Error('MEDIA_REVOCATION_FAILED')
      }
    })()
    revoking.set(key, work)
    try { await work } finally { revoking.delete(key) }
  }

  async function http(req, res) {
    try {
      const { url, token } = await access(req)
      if (req.method !== 'GET' || url.pathname !== `${prefix}/rtc/validate`) throw new Error('MEDIA_ACCESS_DENIED')
      const target = new URL('/rtc/validate', upstreamUrl); target.search = url.search
      target.searchParams.set('access_token', token)
      const result = await fetch(target, { signal: AbortSignal.timeout(3000), redirect: 'error' })
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', result.headers.get('content-type') || 'text/plain')
      res.writeHead(result.status); res.end(await result.text())
    } catch { res.writeHead(403, { 'Cache-Control': 'no-store' }); res.end('Media access unavailable') }
  }

  async function upgrade(req, socket, head) {
    let joiningKey
    socket.on('error', () => {})
    try {
      const { url, token, claims, grant } = await access(req)
      if (stopped || url.pathname === `${prefix}/rtc/validate` || joining.has(keyOf(grant))) throw new Error('MEDIA_ACCESS_DENIED')
      joiningKey = keyOf(grant); joining.add(joiningKey)
      // One connection per issued identity. A reconnect must first release the
      // old provider participant; it cannot create a second authorized publisher.
      if ([...connections].some(item => keyOf(item.grant) === keyOf(grant))) await revoke(grant)
      // Admission may have changed while provider removal was awaiting its ack.
      if (!await authorize(claims)) throw new Error('MEDIA_ACCESS_DENIED')
      server.handleUpgrade(req, socket, head, client => {
        const target = new URL(url.pathname.slice(prefix.length), upstreamUrl)
        target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
        target.search = url.search; target.searchParams.set('access_token', token)
        const upstream = new WebSocket(target, { handshakeTimeout: 5000, maxPayload: 512 * 1024 })
        const connection = { client, upstream, grant, claims }; connections.add(connection)
        let buffered = [], bufferedBytes = 0
        client.on('message', (data, binary) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary })
          else if (upstream.readyState === WebSocket.CONNECTING && (bufferedBytes += data.length) <= 512 * 1024) buffered.push([data, binary])
          else void revoke(grant).catch(() => {})
        })
        upstream.on('open', () => { for (const [data, binary] of buffered) upstream.send(data, { binary }); buffered = []; bufferedBytes = 0 })
        upstream.on('message', (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }) })
        const ended = () => {
          if (connections.has(connection)) void revoke(grant).catch(() => {})
        }
        client.on('error', ended); upstream.on('error', ended)
        client.on('close', ended); upstream.on('close', ended)
      })
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n') }
    finally { if (joiningKey) joining.delete(joiningKey) }
  }
  const timer = setInterval(async () => {
    if (sweeping || stopped) return
    sweeping = true
    try {
      for (const connection of connections) {
        try { if (!await authorize(connection.claims)) await revoke(connection.grant) }
        catch (error) { await onFatal(error); break }
      }
    } finally { sweeping = false }
  }, pollMs)
  timer.unref()
  return { http, upgrade, revoke, async close() {
    stopped = true; clearInterval(timer)
    const grants = [...new Map([...connections].map(connection => [keyOf(connection.grant), connection.grant])).values()]
    await Promise.allSettled(grants.map(revoke))
    server.close()
  } }
}
