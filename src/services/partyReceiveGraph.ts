import type { PartyClockEstimate } from '@/utils/partyClock'
import type { PartyPublishPermit } from './partyPublishGraph'
import { createPartyLeaseGuard } from './partyLeaseGuard'

export interface PartyReceivePermit extends PartyPublishPermit {
  publisherIdentity: string
}

// Apply the source's authoritative deadline after native WebRTC buffering.
// The caller must mute the media element and install the lease worklet first.
// This graph owns its nodes; it never stops the caller's received track/context.
export class PartyReceiveGraph {
  private readonly source: MediaStreamAudioSourceNode
  private readonly gate: GainNode
  private guard: ReturnType<typeof createPartyLeaseGuard> | null = null
  private readonly identity: Omit<PartyReceivePermit, 'expiresServerMs'>
  private closed = false
  private used = false
  private localExpiry = 0
  private wallExpiry = 0
  private lastNow = 0
  private lastWall = 0
  private sourceExpiry = 0

  constructor(private readonly context: AudioContext, private readonly stream: MediaStream,
    identity: Omit<PartyReceivePermit, 'expiresServerMs'>, private readonly onFailure: () => void) {
    if (!identity?.publisherIdentity || typeof identity.publisherIdentity !== 'string' ||
      typeof identity.clockId !== 'string' || !identity.clockId || typeof identity.performanceId !== 'string' ||
      !identity.performanceId || !Number.isSafeInteger(identity.generation) || identity.generation < 1 ||
      stream.getAudioTracks().length !== 1 || stream.getAudioTracks()[0]?.readyState !== 'live')
      throw new Error('MEDIA_PERMISSION')
    this.identity = { publisherIdentity: identity.publisherIdentity, clockId: identity.clockId,
      performanceId: identity.performanceId, generation: identity.generation }
    this.source = context.createMediaStreamSource(stream)
    this.gate = context.createGain(); this.gate.gain.value = 0
    this.source.connect(this.gate)
    context.addEventListener('statechange', this.contextChanged)
    stream.getAudioTracks()[0]!.addEventListener('ended', this.trackEnded)
  }

  renew(permit: PartyReceivePermit, clock: PartyClockEstimate): boolean {
    const now = performance.now(), wall = Date.now()
    const duration = permit.expiresServerMs - now - clock.offsetMs - clock.uncertaintyMs - 100
    // Check the previous deadline before considering a newer grant. A delayed
    // page callback must never rebuild a processor that has already gone silent.
    if (this.closed) return false
    if (this.context.state !== 'running' || clock.status !== 'healthy' || clock.clockId !== this.identity.clockId ||
      !Number.isFinite(clock.offsetMs) || !Number.isFinite(clock.uncertaintyMs) || clock.uncertaintyMs < 0 || clock.uncertaintyMs > 80 ||
      Object.entries(this.identity).some(([key, value]) => permit[key as keyof PartyReceivePermit] !== value) ||
      !Number.isFinite(duration) || duration <= 0 || duration > 10000 ||
      this.stream.getAudioTracks()[0]?.readyState !== 'live' ||
      (this.used && (now >= this.localExpiry || wall >= this.wallExpiry || now < this.lastNow || wall < this.lastWall ||
        Math.abs((wall - this.lastWall) - (now - this.lastNow)) > 250 || permit.expiresServerMs < this.sourceExpiry))) {
      this.fail(); return false
    }
    if (!this.guard) {
      try {
        const guard = createPartyLeaseGuard(this.context, duration)
        this.guard = guard
        guard.node.port.onmessage = ({ data }) => { if (data?.type === 'silent' && this.guard === guard) this.fail() }
        guard.node.onprocessorerror = () => { if (this.guard === guard) this.fail() }
        this.gate.connect(guard.node); guard.node.connect(this.context.destination)
      } catch { this.fail(); return false }
    } else this.guard.renew(duration)
    this.used = true; this.lastNow = now; this.lastWall = wall
    this.localExpiry = now + duration; this.wallExpiry = wall + duration; this.sourceExpiry = permit.expiresServerMs
    const time = this.context.currentTime
    this.gate.gain.cancelScheduledValues(time)
    this.gate.gain.setValueAtTime(1, time)
    this.gate.gain.setValueAtTime(0, time + duration / 1000)
    return true
  }

  private fail() {
    if (this.closed) return
    this.close(); this.onFailure()
  }
  private contextChanged = () => { if (this.context.state !== 'running') this.fail() }
  private trackEnded = () => this.fail()

  close() {
    if (this.closed) return
    this.closed = true
    this.context.removeEventListener('statechange', this.contextChanged)
    this.stream.getAudioTracks()[0]?.removeEventListener('ended', this.trackEnded)
    this.gate.gain.cancelScheduledValues(this.context.currentTime)
    this.gate.gain.setValueAtTime(0, this.context.currentTime)
    this.source.disconnect(); this.gate.disconnect(); this.guard?.close(); this.guard = null
  }
}
