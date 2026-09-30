import config from '@/config'
import { partyApi, type PartySnapshot } from './partyApi'

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
): () => void {
  let socket: WebSocket | null = null
  let retryTimer: number | undefined
  let stopped = false
  let connecting = false
  let attempts = 0

  function scheduleRetry() {
    if (stopped || retryTimer !== undefined) return
    const delay = Math.min(15_000, 500 * 2 ** Math.min(attempts++, 5))
    retryTimer = window.setTimeout(() => { retryTimer = undefined; void connect() }, delay)
  }

  async function connect() {
    if (stopped || connecting || socket) return
    connecting = true
    try {
      const { ticket } = await partyApi.socketTicket(roomId)
      if (stopped) return
      const next = new WebSocket(socketUrl())
      socket = next
      next.onopen = () => next.send(JSON.stringify({ type: 'authenticate', ticket }))
      next.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string)
          if (message.protocolVersion !== 1 || message.type !== 'snapshot' || message.data?.room?.id !== roomId) return
          attempts = 0
          onStatus(true)
          onSnapshot(message.data as PartySnapshot)
        } catch { /* A malformed packet is ignored; a later snapshot can recover. */ }
      }
      next.onerror = () => next.close()
      next.onclose = (event) => {
        if (socket !== next) return
        socket = null
        onStatus(false)
        if (event.code === 4403 || event.code === 4410) { onAccessEnded(); return }
        scheduleRetry()
      }
    } catch { scheduleRetry() }
    finally { connecting = false }
  }

  void connect()
  return () => {
    stopped = true
    if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    socket?.close()
    socket = null
    onStatus(false)
  }
}
