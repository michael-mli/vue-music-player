// Browser requests must come from the room's site or an explicit development
// origin. Direct clients can authenticate without Origin; room APIs use bearer
// or device credentials rather than ambient cookies.
export function createKtvHttpGuard({ allowedOrigins = [], limit = 600, now = Date.now } = {}) {
  const clients = new Map()
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    const origin = req.headers.origin
    if (origin && origin !== `https://${req.headers.host}` && origin !== `http://${req.headers.host}` && !allowedOrigins.includes(origin)) {
      return res.status(403).json({ success: false, code: 'ORIGIN_DENIED', message: 'Room requests must come from an allowed site' })
    }
    if (Number(req.headers['content-length']) > 16 * 1024 || Buffer.byteLength(JSON.stringify(req.body ?? {})) > 16 * 1024) {
      return res.status(413).json({ success: false, code: 'MESSAGE_TOO_LARGE', message: 'Room request is too large' })
    }
    // Use the actual socket peer. Untrusted forwarding headers cannot evade a
    // limit. A reverse proxy's aggregate budget comfortably covers one room.
    const address = req.socket.remoteAddress || 'unknown', timestamp = now()
    let record = clients.get(address)
    if (!record || timestamp - record.since >= 60_000) record = { since: timestamp, count: 0 }
    if (++record.count > limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((60_000 - timestamp + record.since) / 1000))))
      return res.status(429).json({ success: false, code: 'TOO_MANY_REQUESTS', message: 'Please wait before trying again' })
    }
    clients.set(address, record)
    if (clients.size > 1000) for (const [key, value] of clients) if (timestamp - value.since >= 60_000) clients.delete(key)
    while (clients.size > 1000) clients.delete(clients.keys().next().value)
    next()
  }
}
