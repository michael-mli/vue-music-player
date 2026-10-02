// Owned datagram fixture. STUN, DTLS and SRTP bytes remain unchanged; the
// encrypted media takes a real UDP route through delay/loss before the SFU.
import dgram from 'node:dgram'
import net from 'node:net'
import os from 'node:os'
import { once } from 'node:events'

export async function createMediaUdpProxy({ listenPort, upstreamPort, listenHost = '127.0.0.1', upstreamHost = '127.0.0.1', random = Math.random }) {
  if (!Number.isInteger(listenPort) || (listenPort !== 0 && (listenPort < 1024 || listenPort > 65535)) ||
    !Number.isInteger(upstreamPort) || upstreamPort < 1024 || upstreamPort > 65535 || listenPort === upstreamPort ||
    !['127.0.0.1', '0.0.0.0'].includes(listenHost) || !Object.values(os.networkInterfaces()).flat().some(item => item.family === 'IPv4' && item.address === upstreamHost) ||
    typeof random !== 'function') throw new Error('Invalid local media UDP fixture address/ports')
  const server = dgram.createSocket('udp4'), circuits = new Map(), history = []
  let nextId = 0, delayMs = 0, jitterMs = 0, lossRate = 0, closing = false
  function deliver(circuit, data, toClient) {
    const { record } = circuit
    if (!record.alive || closing) return
    circuit.lastActivity = performance.now()
    const dropped = toClient ? 'droppedToClient' : 'droppedToSfu'
    if (performance.now() < circuit.pauseUntil || random() < lossRate) { record[dropped]++; return }
    circuit.queuedBytes += data.length
    record.peakQueuedBytes = Math.max(record.peakQueuedBytes, circuit.queuedBytes)
    if (circuit.queuedBytes > 4 * 1024 * 1024 || circuit.timers.size >= 10000) { record.overflow = true; circuit.destroy(); return }
    const timer = setTimeout(() => {
      circuit.timers.delete(timer); circuit.queuedBytes -= data.length
      if (!record.alive || closing) return
      if (performance.now() < circuit.pauseUntil) { record[dropped]++; return }
      const callback = error => {
        if (error) { record.errorCode = error.code; circuit.destroy() }
        else record[toClient ? 'bytesToClient' : 'bytesToSfu'] += data.length
      }
      if (toClient) server.send(data, circuit.port, circuit.address, callback)
      else circuit.upstream.send(data, callback)
    }, delayMs + random() * jitterMs)
    circuit.timers.add(timer)
  }
  server.on('message', (data, remote) => {
    if (closing || net.isIP(remote.address) !== 4) return
    const key = `${remote.address}:${remote.port}`
    let circuit = circuits.get(key)
    if (!circuit) {
      if (circuits.size >= 24) return
      const upstream = dgram.createSocket('udp4')
      const record = { id: ++nextId, alive: true, bytesToClient: 0, bytesToSfu: 0, droppedToClient: 0, droppedToSfu: 0, peakQueuedBytes: 0, overflow: false, errorCode: null }
      history.push(record)
      circuit = { record, upstream, address: remote.address, port: remote.port, timers: new Set(), queuedBytes: 0,
        pauseUntil: 0, lastActivity: performance.now(), destroy() {
          if (!record.alive) return
          record.alive = false; circuits.delete(key)
          for (const timer of this.timers) clearTimeout(timer)
          this.timers.clear(); this.queuedBytes = 0
          upstream.close()
        } }
      circuits.set(key, circuit)
      upstream.on('error', error => { record.errorCode = error.code; circuit.destroy() })
      upstream.on('message', message => deliver(circuit, message, true))
      circuit.ready = new Promise(resolve => {
        upstream.once('error', resolve)
        upstream.bind(0, upstreamHost, () => {
          if (!record.alive) { resolve(); return }
          upstream.connect(upstreamPort, upstreamHost, resolve)
        })
      })
    }
    circuit.ready.then(() => deliver(circuit, data, false))
  })
  server.bind(listenPort, listenHost); await once(server, 'listening')
  const idleTimer = setInterval(() => {
    for (const circuit of circuits.values()) if (performance.now() - circuit.lastActivity > 120000) circuit.destroy()
  }, 5000)
  server.on('error', () => { for (const circuit of [...circuits.values()]) circuit.destroy() })
  return {
    address: () => server.address(),
    snapshot: () => ({ delayMs, jitterMs, lossRate, circuits: history.map(record => ({ ...record })) }),
    profile(next) {
      if (![next.delayMs, next.jitterMs, next.lossRate].every(Number.isFinite) || next.delayMs < 0 || next.delayMs > 500 || next.jitterMs < 0 || next.jitterMs > 100 || next.lossRate < 0 || next.lossRate > 0.2) throw new Error('Invalid bounded UDP impairment')
      delayMs = next.delayMs; jitterMs = next.jitterMs; lossRate = next.lossRate
    },
    pause(ids, milliseconds) {
      if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 10000) throw new Error('Invalid bounded UDP outage')
      for (const circuit of circuits.values()) if (ids.includes(circuit.record.id)) circuit.pauseUntil = performance.now() + milliseconds
    },
    resume(ids) { for (const circuit of circuits.values()) if (ids.includes(circuit.record.id)) circuit.pauseUntil = 0 },
    async close() {
      if (closing) return
      closing = true; clearInterval(idleTimer)
      for (const circuit of [...circuits.values()]) circuit.destroy()
      await new Promise(resolve => server.close(resolve))
    },
  }
}
