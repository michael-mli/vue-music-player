import config from '@/config'
import { partyApi, type PartySnapshot } from './partyApi'
import { PartyClockEstimator, type PartyClockEstimate } from '@/utils/partyClock'

export interface PartySubscription { (): void; send: (message: Record<string, unknown>) => boolean }

function socketUrl(): string {
  const url = new URL(config.apiBaseUrl, window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ktv/ws`
  url.search = ''
  return url.toString()
}

export function subscribeParty(
  roomId: string,
  onSnapshot: (snapshot: PartySnapshot) => void,
  onStatus: (connected: boolean) => void,
  onAccessEnded: () => void,
  onClock: (estimate: PartyClockEstimate | null) => void = () => {},
  options: { deviceId?: string; onMessage?: (message: Record<string, any>) => void } = {},
): PartySubscription {
  let socket: WebSocket | null = null
  let retryTimer: number | undefined
  let stopped = false
  let connecting = false
  let attempts = 0
  let probeTimer: number | undefined
  let expectedClockId = ''
  let admitted = false
  const clock = new PartyClockEstimator()
  const pendingProbes = new Map<string, number>()
  let lastResyncMs = -Infinity

  function stopClock() {
    if (probeTimer !== undefined) window.clearTimeout(probeTimer)
    probeTimer = undefined
    pendingProbes.clear()
    clock.reset()
    expectedClockId = ''
    admitted = false
    onClock(null)
  }

  function syncClock(clockId: string) {
    lastResyncMs = performance.now()
    if (probeTimer !== undefined) window.clearTimeout(probeTimer)
    pendingProbes.clear()
    clock.reset(clockId)
    expectedClockId = clockId
    onClock(null)
    let burst = 8
    function probe() {
      if (stopped || !admitted || socket?.readyState !== WebSocket.OPEN) return
      const nowMs = performance.now()
      for (const [id, sentMs] of pendingProbes) if (nowMs - sentMs > 10_000) pendingProbes.delete(id)
      onClock(clock.estimate(nowMs))
      if (pendingProbes.size < 12) {
        const probeId = crypto.randomUUID()
        pendingProbes.set(probeId, nowMs)
        socket.send(JSON.stringify({ protocolVersion: 1, type: 'clock.probe', probeId, clientSendMs: nowMs }))
      }
      probeTimer = window.setTimeout(probe, --burst > 0 ? 300 : 10_000)
    }
    probe()
  }

  function resyncClock() {
    if (admitted && expectedClockId && !document.hidden && performance.now() - lastResyncMs >= 10_000) syncClock(expectedClockId)
  }
  document.addEventListener('visibilitychange', resyncClock)
  window.addEventListener('online', resyncClock)

  function scheduleRetry() {
    if (stopped || retryTimer !== undefined) return
    const delay = Math.min(15_000, Math.round(500 * 2 ** Math.min(attempts++, 5) * (0.8 + Math.random() * 0.4)))
    retryTimer = window.setTimeout(() => { retryTimer = undefined; void connect() }, delay)
  }

  async function connect() {
    if (stopped || connecting || socket) return
    connecting = true
    try {
      const { ticket } = await partyApi.socketTicket(roomId, options.deviceId)
      if (stopped) return
      const next = new WebSocket(socketUrl())
      socket = next
      next.onopen = () => { if (!stopped && socket === next) next.send(JSON.stringify({ type: 'authenticate', ticket })) }
      next.onmessage = (event) => {
        if (stopped || socket !== next) return
        const receivedMs = performance.now()
        try {
          const message = JSON.parse(event.data as string)
          if (message.protocolVersion !== 1) return
          if (message.roomId === roomId && message.type !== 'snapshot' && message.type !== 'clock.reply') options.onMessage?.(message)
          if (message.type === 'clock.reply') {
            const sentMs = pendingProbes.get(message.probeId)
            pendingProbes.delete(message.probeId)
            if (sentMs === undefined || message.clientSendMs !== sentMs || message.roomId !== roomId ||
              message.clockId !== expectedClockId) return
            if (clock.add(message, receivedMs)) onClock(clock.estimate(receivedMs))
            return
          }
          if (message.type !== 'snapshot' || message.data?.room?.id !== roomId) return
          attempts = 0
          onStatus(true)
          onSnapshot(message.data as PartySnapshot)
          const wasAdmitted = admitted
          admitted = message.data.self?.admission === 'admitted'
          const clockId = message.data.clock?.clockId
          if (admitted && typeof clockId === 'string' && (clockId !== expectedClockId || !wasAdmitted)) syncClock(clockId)
          else if (!admitted) stopClock()
        } catch { /* A malformed packet is ignored; a later snapshot can recover. */ }
      }
      next.onerror = () => next.close()
      next.onclose = (event) => {
        if (socket !== next) return
        socket = null
        stopClock()
        onStatus(false)
        if (event.code === 4403 || event.code === 4410) { onAccessEnded(); return }
        scheduleRetry()
      }
    } catch { scheduleRetry() }
    finally { connecting = false }
  }

  void connect()
  const stop = () => {
    stopped = true
    document.removeEventListener('visibilitychange', resyncClock)
    window.removeEventListener('online', resyncClock)
    stopClock()
    if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    socket?.close()
    socket = null
    onStatus(false)
  }
  return Object.assign(stop, { send(message: Record<string, unknown>) {
    if (stopped || !admitted || socket?.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify({ protocolVersion: 1, ...message })); return true
  } })
}
