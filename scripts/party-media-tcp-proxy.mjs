// Owned test transport only. Delay encrypted TCP bytes without changing host
// routing/firewalls or pretending that TCP chunk stalls are UDP packet loss.
import net from 'node:net'
import os from 'node:os'
import { once } from 'node:events'

export async function createMediaTcpProxy({ listenPort, upstreamPort, listenHost = '127.0.0.1', upstreamHost = '127.0.0.1' }) {
  if (!Number.isInteger(listenPort) || (listenPort !== 0 && (listenPort < 1024 || listenPort > 65535)) ||
    !Number.isInteger(upstreamPort) || upstreamPort < 1024 || upstreamPort > 65535 ||
    listenPort === upstreamPort || !['127.0.0.1', '0.0.0.0'].includes(listenHost) ||
    !Object.values(os.networkInterfaces()).flat().some(item => item.family === 'IPv4' && item.address === upstreamHost)) throw new Error('Invalid local media TCP fixture address/ports')
  const circuits = new Map(), history = []
  let nextId = 0, delayMs = 0, jitterMs = 0, closing = false
  const server = net.createServer(client => {
    if (closing || circuits.size >= 24) { client.destroy(); return }
    const upstream = net.connect({ host: upstreamHost, port: upstreamPort })
    const record = { id: ++nextId, alive: true, bytesToClient: 0, bytesToSfu: 0, peakQueuedBytes: 0, overflow: false, errorCode: null }
    history.push(record)
    const queues = [], circuit = { record, pauseUntil: 0, wake() { for (const queue of queues) queue.schedule() }, destroy() {
      if (!record.alive) return
      record.alive = false; circuits.delete(record.id)
      for (const queue of queues) queue.close()
      client.destroy(); upstream.destroy()
    } }
    circuits.set(record.id, circuit)
    function pipe(source, target, counter) {
      let chunks = [], bytes = 0, timer, blocked = false, lastDue = 0, stopped = false
      function schedule() {
        clearTimeout(timer)
        if (!stopped && chunks.length && !blocked) timer = setTimeout(flush,
          Math.max(0, Math.max(chunks[0].due, circuit.pauseUntil) - performance.now()))
      }
      function flush() {
        if (stopped || blocked) return
        if (performance.now() < circuit.pauseUntil) { schedule(); return }
        while (chunks.length && chunks[0].due <= performance.now()) {
          const item = chunks.shift(); bytes -= item.data.length
          record[counter] += item.data.length
          if (!target.write(item.data)) { blocked = true; source.pause(); break }
        }
        if (!blocked && bytes < 512 * 1024) source.resume()
        schedule()
      }
      const queue = { schedule, close() { stopped = true; clearTimeout(timer); chunks = []; bytes = 0 } }
      queues.push(queue)
      source.on('data', data => {
        if (stopped) return
        bytes += data.length; record.peakQueuedBytes = Math.max(record.peakQueuedBytes, bytes)
        if (bytes > 4 * 1024 * 1024) { record.overflow = true; circuit.destroy(); return }
        // Preserve TCP byte order even when delivery deadlines vary.
        lastDue = Math.max(lastDue, performance.now() + delayMs + Math.random() * jitterMs)
        chunks.push({ data, due: lastDue })
        if (bytes >= 1024 * 1024 || blocked) source.pause()
        schedule()
      })
      target.on('drain', () => { blocked = false; flush() })
    }
    pipe(client, upstream, 'bytesToSfu'); pipe(upstream, client, 'bytesToClient')
    for (const socket of [client, upstream]) {
      socket.setNoDelay(true)
      socket.on('error', error => { record.errorCode = error.code; circuit.destroy() }); socket.on('close', () => circuit.destroy())
    }
  })
  server.listen(listenPort, listenHost)
  await once(server, 'listening')
  return {
    address: () => server.address(),
    snapshot: () => ({ delayMs, jitterMs, circuits: history.map(record => ({ ...record })) }),
    profile(next) {
      if (![next.delayMs, next.jitterMs].every(Number.isFinite) || next.delayMs < 0 || next.delayMs > 500 || next.jitterMs < 0 || next.jitterMs > 100) throw new Error('Invalid bounded TCP delay')
      delayMs = next.delayMs; jitterMs = next.jitterMs
    },
    pause(ids, milliseconds) {
      if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 10000) throw new Error('Invalid bounded TCP stall')
      for (const id of ids) {
        const circuit = circuits.get(id)
        if (circuit) { circuit.pauseUntil = performance.now() + milliseconds; circuit.wake() }
      }
    },
    resume(ids) { for (const id of ids) { const circuit = circuits.get(id); if (circuit) { circuit.pauseUntil = 0; circuit.wake() } } },
    drop(ids) { for (const id of ids) circuits.get(id)?.destroy() },
    async close() {
      closing = true
      for (const circuit of [...circuits.values()]) circuit.destroy()
      if (server.listening) await new Promise(resolve => server.close(resolve))
    },
  }
}
