import type { PartyClockEstimate } from '@/utils/partyClock'
import { createPartyLeaseGuard } from './partyLeaseGuard'

export interface PartyPublishPermit {
  clockId: string
  performanceId: string
  generation: number
  expiresServerMs: number
}

// The original guide is a separate player/context. It is never an input to this
// graph. The caller supplies the instrumental before its personal monitor gain.
export class PartyPublishGraph {
  readonly stream: MediaStream
  private readonly monitor: GainNode
  private readonly backing: GainNode
  private readonly vocal: GainNode
  private readonly backingDelay: DelayNode
  private readonly vocalDelay: DelayNode
  private readonly limiter: DynamicsCompressorNode
  private readonly gate: GainNode
  private readonly output: MediaStreamAudioDestinationNode
  private readonly mic: MediaStreamAudioSourceNode
  private guard: ReturnType<typeof createPartyLeaseGuard> | null = null
  private closed = false
  private alignmentMs = 0
  private expiry = 0
  private usedPermit = false
  private requiresNewGeneration = false

  constructor(private readonly context: AudioContext, private readonly instrumental: AudioNode,
    private readonly capture: MediaStream, private readonly identity: Omit<PartyPublishPermit, 'expiresServerMs'>,
    readonly inputMode: 'clean-mic' | 'venue-mix' = 'clean-mic', monitorLocal = true) {
    if (!identity.clockId || !identity.performanceId || !Number.isSafeInteger(identity.generation) || identity.generation < 1 ||
      !['clean-mic', 'venue-mix'].includes(inputMode) || instrumental.context !== context || !capture.getAudioTracks().length) throw new Error('PUBLISH_INPUT_UNAVAILABLE')
    this.identity = { clockId: identity.clockId, performanceId: identity.performanceId, generation: identity.generation }
    this.monitor = context.createGain(); this.backing = context.createGain(); this.vocal = context.createGain()
    this.backingDelay = context.createDelay(0.5); this.vocalDelay = context.createDelay(0.5)
    this.limiter = context.createDynamicsCompressor(); this.gate = context.createGain()
    this.output = context.createMediaStreamDestination(); this.mic = context.createMediaStreamSource(capture)
    this.stream = this.output.stream
    this.monitor.gain.value = 0.7; this.backing.gain.value = inputMode === 'venue-mix' ? 0 : 0.65
    this.vocal.gain.value = 1; this.gate.gain.value = 0
    this.limiter.threshold.value = -3; this.limiter.knee.value = 0; this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.003; this.limiter.release.value = 0.1
    // Engine taps already have a separate personal monitor. Standalone capture
    // fixtures may opt into this branch, without creating a second monitor.
    instrumental.connect(this.monitor); if (monitorLocal) this.monitor.connect(context.destination)
    instrumental.connect(this.backing); this.backing.connect(this.backingDelay); this.backingDelay.connect(this.limiter)
    this.mic.connect(this.vocal); this.vocal.connect(this.vocalDelay); this.vocalDelay.connect(this.limiter)
    this.limiter.connect(this.gate)
    context.addEventListener('statechange', this.contextChanged)
    for (const track of capture.getAudioTracks()) track.addEventListener('ended', this.captureEnded)
  }

  get diagnostics() {
    return { inputMode: this.inputMode, alignmentMs: this.alignmentMs, expiresServerMs: this.expiry,
      sampleRate: this.context.sampleRate, captureLive: this.capture.getAudioTracks().some(track => track.readyState === 'live'),
      limiterReductionDb: this.limiter.reduction, requiresNewGeneration: this.requiresNewGeneration, physicalAlignmentMeasured: false }
  }

  setMonitorVolume(value: number) {
    if (!Number.isFinite(value) || this.closed) return
    this.monitor.gain.setTargetAtTime(Math.max(0, Math.min(1, value)), this.context.currentTime, 0.02)
  }

  setPublishLevels(backing: number, vocal: number) {
    if (![backing, vocal].every(Number.isFinite) || this.closed) return
    const now = this.context.currentTime
    // A venue mixer already contains backing; adding the asset again doubles it.
    this.backing.gain.setTargetAtTime(this.inputMode === 'venue-mix' ? 0 : Math.max(0, Math.min(1, backing)), now, 0.02)
    this.vocal.gain.setTargetAtTime(Math.max(0, Math.min(2, vocal)), now, 0.02)
  }

  setAlignment(value: number) {
    if (!Number.isFinite(value) || Math.abs(value) > 500 || this.closed) throw new Error('INVALID_PUBLISH_ALIGNMENT')
    // Positive correction delays backing; negative correction delays the mic.
    // Changing this requires a fresh readiness cycle in the room controller.
    if (value !== this.alignmentMs && this.usedPermit) this.requiresNewGeneration = true
    this.silence(); this.alignmentMs = value
    this.backingDelay.delayTime.value = Math.max(0, value) / 1000
    this.vocalDelay.delayTime.value = Math.max(0, -value) / 1000
  }

  renew(permit: PartyPublishPermit, clock: PartyClockEstimate): boolean {
    const now = performance.now() + clock.offsetMs
    const duration = permit.expiresServerMs - now - clock.uncertaintyMs - 100
    if (this.closed || this.requiresNewGeneration || this.context.state !== 'running' || clock.status !== 'healthy' ||
      !Number.isFinite(clock.uncertaintyMs) || clock.uncertaintyMs < 0 || clock.uncertaintyMs > 80 ||
      clock.clockId !== permit.clockId || Object.entries(this.identity).some(([name, value]) => permit[name as keyof PartyPublishPermit] !== value) ||
      !Number.isFinite(duration) || duration <= 0 || duration > 10_000 ||
      !this.capture.getAudioTracks().some(track => track.readyState === 'live')) {
      this.silence(); return false
    }
    this.usedPermit = true
    this.expiry = permit.expiresServerMs
    if (!this.guard) {
      this.guard = createPartyLeaseGuard(this.context, duration)
      const guard = this.guard
      guard.node.port.onmessage = ({ data }) => {
        if (data?.type === 'silent' && this.guard === guard) { this.requiresNewGeneration = true; this.silence() }
      }
      guard.node.onprocessorerror = () => { if (this.guard === guard) { this.requiresNewGeneration = true; this.silence() } }
      this.gate.connect(guard.node); guard.node.connect(this.output)
    } else this.guard.renew(duration)
    const time = this.context.currentTime
    this.gate.gain.cancelScheduledValues(time)
    this.gate.gain.setValueAtTime(1, time)
    // The render thread enforces expiry even when the main thread is stalled.
    this.gate.gain.setValueAtTime(0, time + duration / 1000)
    return true
  }

  silence() {
    this.expiry = 0
    if (this.guard) { this.gate.disconnect(this.guard.node); this.guard.close(); this.guard = null }
    this.gate.gain.cancelScheduledValues(this.context.currentTime)
    this.gate.gain.setValueAtTime(0, this.context.currentTime)
  }
  private contextChanged = () => { if (this.context.state !== 'running') this.silence() }
  private captureEnded = () => this.silence()

  close() {
    if (this.closed) return
    this.silence(); this.closed = true
    this.context.removeEventListener('statechange', this.contextChanged)
    for (const track of this.capture.getAudioTracks()) track.removeEventListener('ended', this.captureEnded)
    // Disconnect our branches only. The caller owns its context, capture lease,
    // and instrumental source, which may still be used for local monitoring.
    for (const branch of [this.monitor, this.backing]) {
      try { this.instrumental.disconnect(branch) } catch { /* Caller may have released its source first. */ }
    }
    for (const node of [this.monitor, this.backing, this.vocal, this.backingDelay, this.vocalDelay, this.mic, this.limiter, this.gate]) node.disconnect()
    for (const track of this.stream.getTracks()) track.stop()
  }
}
