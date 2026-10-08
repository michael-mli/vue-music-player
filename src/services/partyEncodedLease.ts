import workerUrl from './partyEncodedLease.worker.js?url'
import type { PartyClockEstimate } from '@/utils/partyClock'
import type { PartyPublishPermit } from './partyPublishGraph'

type Identity = Omit<PartyPublishPermit, 'expiresServerMs'>
type EncodedSender = RTCRtpSender & { transform?: unknown; createEncodedStreams?: () => {
  readable: ReadableStream; writable: WritableStream
} }
type ScriptTransform = new (worker: Worker, options: { kind: 'audio' | 'video' }) => unknown
const scriptTransform = () => (globalThis as typeof globalThis & { RTCRtpScriptTransform?: ScriptTransform }).RTCRtpScriptTransform
const legacyTransform = () => typeof RTCRtpSender !== 'undefined' &&
  typeof (RTCRtpSender.prototype as EncodedSender).createEncodedStreams === 'function'

export function partyEncodedRTCConfiguration(): RTCConfiguration & { encodedInsertableStreams?: boolean } {
  // Chromium can permanently bypass a transform attached after publication.
  // Opt into its legacy gate before creating the peer so initial frames wait
  // for our worker, even when the standard API is also exposed.
  if (legacyTransform()) return { encodedInsertableStreams: true }
  if (scriptTransform()) return {}
  throw new Error('MEDIA_CAPTURE_UNAVAILABLE')
}

export class PartyEncodedLease {
  private readonly worker: Worker
  private readonly identity: Identity
  private readonly legacy = legacyTransform()
  private readonly senders = new Set<RTCRtpSender>()
  private closed = false
  private failed = false
  private sequence = 0
  constructor(identity: Identity, onFailure: () => void) {
    if (typeof identity?.clockId !== 'string' || !identity.clockId || typeof identity.performanceId !== 'string' ||
      !identity.performanceId || !Number.isSafeInteger(identity.generation) || identity.generation < 1)
      throw new Error('MEDIA_PERMISSION')
    this.identity = { clockId: identity.clockId, performanceId: identity.performanceId, generation: identity.generation }
    this.worker = new Worker(workerUrl, { type: 'module' })
    const fail = () => {
      if (this.closed || this.failed) return
      this.failed = true
      for (const sender of this.senders) void sender.replaceTrack(null).catch(() => {})
      onFailure()
    }
    this.worker.onmessage = ({ data }) => { if (data?.type === 'silent') fail() }
    this.worker.onerror = fail
    this.worker.onmessageerror = fail
    this.worker.postMessage({ type: 'init', identity: this.identity })
  }
  attach(sender: RTCRtpSender | undefined, kind: 'audio' | 'video') {
    if (this.closed || this.failed || !sender || this.senders.has(sender)) throw new Error('MEDIA_CAPTURE_UNAVAILABLE')
    this.senders.add(sender)
    const transform = scriptTransform(), encoded = sender as EncodedSender
    if (this.legacy) {
      if (!encoded.createEncodedStreams) throw new Error('MEDIA_CAPTURE_UNAVAILABLE')
      const { readable, writable } = encoded.createEncodedStreams()
      this.worker.postMessage({ type: 'attach', kind, readable, writable }, [readable, writable])
    } else if (transform) encoded.transform = new transform(this.worker, { kind })
    else throw new Error('MEDIA_CAPTURE_UNAVAILABLE')
  }
  renew(permit: PartyPublishPermit, clock: PartyClockEstimate): boolean {
    // PCM becomes silent 100 ms early. Keep this gate open until 10 ms early so
    // the encoder can send that silence and drain receiver concealment. Closing
    // both layers simultaneously makes the receiver prolong its last vocal frame.
    const duration = permit.expiresServerMs - performance.now() - clock.offsetMs - clock.uncertaintyMs - 10
    if (this.closed || this.failed || clock.status !== 'healthy' || clock.clockId !== this.identity.clockId ||
      !Number.isFinite(clock.uncertaintyMs) || clock.uncertaintyMs < 0 || clock.uncertaintyMs > 80 ||
      Object.entries(this.identity).some(([key, value]) => permit[key as keyof PartyPublishPermit] !== value) ||
      !Number.isFinite(duration) || duration <= 0 || duration > 10000) {
      this.close(); return false
    }
    // Send an absolute deadline, never a duration that delivery delay can extend.
    this.worker.postMessage({ type: 'renew', identity: this.identity, sequence: ++this.sequence, expiry: Date.now() + duration })
    return true
  }
  close() {
    if (this.closed) return
    this.closed = true
    // Keep the installed transform closed; removing it would restore passthrough.
    this.worker.terminate()
    for (const sender of this.senders) void sender.replaceTrack(null).catch(() => {})
  }
}
