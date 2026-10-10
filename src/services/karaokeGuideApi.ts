import { getApiUrl } from '@/config'
import { KaraokeGuideClock, type KaraokeGuideState } from '@/utils/karaokeGuideSync'

export interface KaraokeGuideSession { id: string; hostToken: string; guideToken: string }
export class KaraokeGuideError extends Error {
  constructor(public code: string, public status = 0) { super(code) }
}

export async function guideRequest<T>(clock: KaraokeGuideClock, path: string, token: string,
  method = 'GET', body?: unknown, keepalive = false): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 4000)
  const sent = performance.now()
  try {
    const response = await fetch(getApiUrl(`/karaoke-guide/sessions${path}`), {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
      signal: controller.signal, keepalive,
    })
    const result = await response.json()
    if (!response.ok || !result.success) throw new KaraokeGuideError(result.code || 'unavailable', response.status)
    clock.add(sent, performance.now(), result.data.serverReceivedAt, result.data.serverNow)
    return result.data as T
  } finally { window.clearTimeout(timeout) }
}

export interface KaraokeGuideReply { state: KaraokeGuideState | null; hostOnline: boolean }
