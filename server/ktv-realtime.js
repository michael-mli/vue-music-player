import { createHash, randomBytes } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'

const TICKET_LIFETIME_MS = 30_000
const AUTH_TIMEOUT_MS = 5_000
const MAX_TICKETS = 1_000
const MAX_TICKETS_PER_MEMBER = 5
const MAX_ROOM_SOCKETS = 60
const MAX_MEMBER_SOCKETS = 3

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sameHostOrigin(req, origin) {
  // TLS may terminate at an edge proxy before the request reaches nginx/Node.
  // Browser Origin still names the public site; require its exact host.
  return origin === `https://${req.headers.host}` || origin === `http://${req.headers.host}`
}

export function createKtvRealtime({ getSnapshot, allowedOrigins = [], clock, onDevice, onConnected, onDisconnected }) {
  const tickets = new Map()
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false })
  let heartbeat

  function issueTicket(roomId, principal) {
    const now = Date.now()
    for (const [hash, record] of tickets) if (record.expiresAt <= now) tickets.delete(hash)
    let memberTickets = 0
    for (const record of tickets.values()) {
      if (record.roomId === roomId && record.principal.memberId === principal.memberId) memberTickets++
    }
    if (tickets.size >= MAX_TICKETS || memberTickets >= MAX_TICKETS_PER_MEMBER) {
      const error = new Error('Too many pending connections')
      error.status = 429
      error.code = 'SOCKET_BUSY'
      throw error
    }
    const ticket = randomBytes(32).toString('base64url')
    const expiresAt = now + TICKET_LIFETIME_MS
    tickets.set(digest(ticket), { roomId, principal, expiresAt })
    return { ticket, expiresAt: new Date(expiresAt).toISOString() }
  }

  function takeTicket(ticket) {
    if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null
    const hash = digest(ticket)
    const record = tickets.get(hash)
    tickets.delete(hash)
    return record?.expiresAt > Date.now() ? record : null
  }

  function sendSnapshot(ws) {
    try {
      const data = getSnapshot(ws.roomId, ws.principal)
      if (ws.bufferedAmount > 256 * 1024) { ws.terminate(); return }
      ws.send(JSON.stringify({ protocolVersion: 1, type: 'snapshot', data }))
    } catch (error) {
      ws.close(error.status === 410 ? 4410 : 4403, 'Room access ended')
    }
  }

  function broadcast(roomId) {
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN && ws.roomId === roomId) sendSnapshot(ws)
    }
  }
  function broadcastLease(roomId, lease) {
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN || ws.roomId !== roomId) continue
      try {
        if (getSnapshot(roomId, ws.principal).self.admission !== 'admitted') continue
        if (ws.bufferedAmount > 256 * 1024) { ws.terminate(); continue }
        ws.send(JSON.stringify({ protocolVersion: 1, type: 'lease', roomId, lease }))
      } catch (error) { ws.close(error.status === 410 ? 4410 : 4403, 'Room access ended') }
    }
  }

  function revokeMember(roomId, memberId) {
    for (const [hash, record] of tickets) {
      if (record.roomId === roomId && record.principal.memberId === memberId) tickets.delete(hash)
    }
    for (const ws of wss.clients) {
      if (ws.roomId === roomId && ws.principal?.memberId === memberId) ws.close(4403, 'Room access ended')
    }
  }

  function replyClock(ws, message, receivedMs) {
    if (message.protocolVersion !== 1) {
      ws.send(JSON.stringify({ protocolVersion: 1, type: 'error', code: 'PROTOCOL_UNSUPPORTED' }))
      return
    }
    if (typeof message.probeId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(message.probeId) ||
      !Number.isFinite(message.clientSendMs) || message.clientSendMs < 0) {
      ws.close(4400, 'Invalid clock probe'); return
    }
    if (ws.probeWindowMs === undefined || receivedMs - ws.probeWindowMs >= 10_000) {
      ws.probeWindowMs = receivedMs; ws.probeCount = 0
    }
    if (++ws.probeCount > 20) { ws.close(4429, 'Too many clock probes'); return }
    try {
      if (getSnapshot(ws.roomId, ws.principal).self.admission !== 'admitted') {
        ws.send(JSON.stringify({ protocolVersion: 1, type: 'error', code: 'NOT_ADMITTED' })); return
      }
      if (ws.bufferedAmount > 256 * 1024) { ws.terminate(); return }
      ws.send(JSON.stringify({ protocolVersion: 1, type: 'clock.reply', roomId: ws.roomId,
        probeId: message.probeId, clockId: clock.id, clientSendMs: message.clientSendMs,
        serverReceiveMs: receivedMs, serverSendMs: clock.nowMs() }))
    } catch (error) { ws.close(error.status === 410 ? 4410 : 4403, 'Room access ended') }
  }

  function attach(server) {
    server.on('upgrade', (req, socket, head) => {
      let pathname
      try { pathname = new URL(req.url, 'http://localhost').pathname } catch { pathname = '' }
      if (pathname !== '/api/ktv/ws' || req.url !== '/api/ktv/ws') {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
        return
      }
      const origin = req.headers.origin
      if (!origin || (!sameHostOrigin(req, origin) && !allowedOrigins.includes(origin))) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
    })

    wss.on('connection', (ws) => {
      ws.isAlive = true
      ws.on('pong', () => { ws.isAlive = true })
      const authTimeout = setTimeout(() => ws.close(4401, 'Authentication timed out'), AUTH_TIMEOUT_MS)
      authTimeout.unref()
      ws.on('close', () => { clearTimeout(authTimeout); onDisconnected?.(ws) })
      ws.on('error', () => {})
      ws.on('message', (raw, isBinary) => {
        const receivedMs = clock.nowMs()
        if (isBinary) { ws.close(4400, 'Unexpected message'); return }
        let message
        try { message = JSON.parse(raw.toString()) } catch { ws.close(4400, 'Invalid message'); return }
        if (ws.roomId) {
          if (message?.type === 'clock.probe') replyClock(ws, message, receivedMs)
          else if (message?.type?.startsWith('device.') || message?.type === 'playback.ended') {
            if (message.protocolVersion !== 1) { ws.close(4400, 'Unsupported protocol'); return }
            if (ws.deviceWindowMs === undefined || receivedMs - ws.deviceWindowMs >= 10_000) {
              ws.deviceWindowMs = receivedMs; ws.deviceMessageCount = 0
            }
            if (++ws.deviceMessageCount > 40) { ws.close(4429, 'Too many device messages'); return }
            try {
              const snapshot = getSnapshot(ws.roomId, ws.principal)
              if (snapshot.self.admission !== 'admitted') throw Object.assign(new Error('Room admission is required'), { code: 'NOT_ADMITTED', status: 403 })
              const reply = onDevice?.(ws, message, snapshot)
              if (reply) ws.send(JSON.stringify({ protocolVersion: 1, roomId: ws.roomId, ...reply }))
            } catch (error) {
              ws.send(JSON.stringify({ protocolVersion: 1, type: 'error', roomId: ws.roomId,
                code: error.code || 'DEVICE_ERROR', message: error.status ? error.message : 'Device request failed', messageType: message.type }))
            }
          }
          else ws.close(4400, 'Unexpected message')
          return
        }
        if (message?.type !== 'authenticate') { ws.close(4400, 'Authenticate first'); return }
        const claim = takeTicket(message.ticket)
        if (!claim) { ws.close(4401, 'Invalid ticket'); return }
        let roomSockets = 0
        let memberSockets = 0
        for (const client of wss.clients) {
          if (client.roomId === claim.roomId) roomSockets++
          if (client.roomId === claim.roomId && client.principal?.memberId === claim.principal.memberId) memberSockets++
        }
        if (roomSockets >= MAX_ROOM_SOCKETS || memberSockets >= MAX_MEMBER_SOCKETS) {
          ws.close(4429, 'Too many room connections')
          return
        }
        clearTimeout(authTimeout)
        ws.roomId = claim.roomId
        ws.principal = claim.principal
        ws.clientDeviceId = claim.principal.clientDeviceId
        try { onConnected?.(ws, getSnapshot(ws.roomId, ws.principal)) }
        catch { ws.close(4403, 'Device connection unavailable'); return }
        sendSnapshot(ws)
      })
    })

    heartbeat = setInterval(() => {
      for (const ws of wss.clients) {
        if (ws.isAlive === false) { ws.terminate(); continue }
        ws.isAlive = false
        ws.ping()
        if (ws.roomId) sendSnapshot(ws)
      }
    }, 30_000)
    heartbeat.unref()
  }

  function close() {
    if (heartbeat) clearInterval(heartbeat)
    for (const ws of wss.clients) ws.terminate()
    wss.close()
  }

  return { issueTicket, broadcast, broadcastLease, revokeMember, attach, close }
}
