import type { PartyAudioAsset, PartyLease, PartyPlayback, PartySegment } from './partyApi'
import type { PartyClockEstimate } from '@/utils/partyClock'
import { serverToAudioTime, partyOutputClock, partyPosition } from '@/utils/partyTimeline'

interface Source { node: AudioBufferSourceNode; gain: GainNode; generation: number; deadlineMs: number; when: number; offsetMs: number; stopAt?: number }
export interface PartyAudioDiagnostics {
  contextState: string
  sampleRate: number
  decodedMiB: number
  timingMode: 'timestamp' | 'estimate' | 'unavailable'
  outputLatencyMs: number | null
  phaseErrorMs: number | null
  maxAbsPhaseErrorMs: number
  sampleCount: number
  recovery: 'drift' | 'output' | null
}

export class PartyAudioEngine {
  private context: AudioContext | null = null
  private buffer: AudioBuffer | null = null
  private assetHash = ''
  private source: Source | null = null
  private next: Source | null = null
  private loadId = 0
  private abort: AbortController | null = null
  private volume = 0.7
  private estimatedBytes = 0
  private readonly maxDecodedBytes = 192 * 1024 * 1024
  private blocked = false
  private lastMeasureMs = -Infinity
  private badSamples = 0
  private outputLatencyMs: number | null = null
  private stats: PartyAudioDiagnostics = { contextState: 'closed', sampleRate: 0, decodedMiB: 0, timingMode: 'unavailable',
    outputLatencyMs: null, phaseErrorMs: null, maxAbsPhaseErrorMs: 0, sampleCount: 0, recovery: null }
  onEnded: ((generation: number) => void) | null = null
  onSuspended: (() => void) | null = null
  onRecovery: ((reason: 'drift' | 'output') => void) | null = null

  get enabled() { return this.context?.state === 'running' }
  get preparedHash() { return this.assetHash }
  get durationMs() { return (this.buffer?.duration || 0) * 1000 }
  get decodedBytes() { return this.estimatedBytes }
  get sampleRate() { return this.context?.sampleRate || 0 }
  get diagnostics() { return { ...this.stats, contextState: this.context?.state || 'closed', sampleRate: this.sampleRate,
    decodedMiB: Math.round(this.estimatedBytes / 1024 / 1024 * 10) / 10 } }

  async enable() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive', sampleRate: 44100 })
      this.context.onstatechange = () => { if (!this.enabled) { this.stop(); this.onSuspended?.() } }
      this.context.addEventListener?.('sinkchange', this.outputChanged)
    }
    // Never resume a context with a source left over from before suspension.
    // Fresh sources are scheduled only after the room/clock/lease guards pass.
    this.stop()
    await this.context.resume()
    if (!this.enabled) throw new Error('AUDIO_GESTURE_REQUIRED')
  }
  resetRecovery() {
    this.blocked = false; this.badSamples = 0; this.lastMeasureMs = -Infinity; this.outputLatencyMs = null
    this.stats = { ...this.stats, phaseErrorMs: null, maxAbsPhaseErrorMs: 0, sampleCount: 0, timingMode: 'unavailable', outputLatencyMs: null, recovery: null }
  }
  outputChanged = () => {
    if (this.context) this.recover('output')
  }
  private recover(reason: 'drift' | 'output') {
    if (this.blocked) return
    this.blocked = true; this.stats.recovery = reason
    this.stop(20); this.releaseBuffer(); this.onRecovery?.(reason)
  }

  async prepare(asset: PartyAudioAsset) {
    if (!this.context || !this.enabled) throw new Error('AUDIO_GESTURE_REQUIRED')
    if (this.assetHash === asset.sha256 && this.buffer) return
    this.releaseBuffer()
    const loadId = ++this.loadId
    const context = this.context
    const estimated = Math.ceil(asset.durationMs / 1000 * context.sampleRate * asset.channels * 4)
    if (estimated > this.maxDecodedBytes || asset.bytes > 32 * 1024 * 1024) throw new Error('AUDIO_MEMORY_LIMIT')
    this.abort = new AbortController()
    const abort = this.abort
    const timeout = window.setTimeout(() => abort.abort(), 25_000)
    try {
      const response = await fetch(asset.url, { cache: 'no-store', signal: abort.signal })
      if (!response.ok) throw new Error('AUDIO_ASSET_UNAVAILABLE')
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength !== asset.bytes) throw new Error('AUDIO_ASSET_CHANGED')
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
      if (hash !== asset.sha256) throw new Error('AUDIO_ASSET_CHANGED')
      const buffer = await context.decodeAudioData(bytes)
      if (loadId !== this.loadId || context !== this.context) return
      const size = buffer.length * buffer.numberOfChannels * 4
      if (size > this.maxDecodedBytes || Math.abs(buffer.duration * 1000 - asset.durationMs) > 250) throw new Error('AUDIO_DECODE_MISMATCH')
      this.buffer = buffer; this.assetHash = asset.sha256; this.estimatedBytes = size
    } finally { window.clearTimeout(timeout); if (this.abort === abort) this.abort = null }
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value))
    const now = this.context?.currentTime || 0
    for (const source of [this.source, this.next]) if (source && (!source.stopAt || source.stopAt > now)) {
      source.gain.gain.setTargetAtTime(this.volume, now, 0.02)
    }
  }

  private cancel(source: Source | null, when?: number, fadeMs = 0) {
    if (!source || !this.context) return
    const now = this.context.currentTime
    const time = Math.max(now, when ?? now) + (source.when <= now ? fadeMs / 1000 : 0)
    source.stopAt = time
    source.node.onended = time > now ? () => { source.node.disconnect(); source.gain.disconnect() } : null
    if (fadeMs && source.when <= now) {
      source.gain.gain.cancelScheduledValues(now)
      source.gain.gain.setValueAtTime(source.gain.gain.value, now)
      source.gain.gain.linearRampToValueAtTime(0, time)
    } else { source.gain.gain.cancelScheduledValues(time); source.gain.gain.setValueAtTime(0, time) }
    try { source.node.stop(time) } catch { /* Already ended. */ }
    if (time <= this.context.currentTime) { source.node.disconnect(); source.gain.disconnect() }
  }

  stop(fadeMs = 0) { this.cancel(this.source, undefined, fadeMs); this.cancel(this.next, undefined, fadeMs); this.source = null; this.next = null; this.stats.phaseErrorMs = null }
  releaseBuffer() {
    this.loadId++; this.abort?.abort(); this.abort = null
    this.stop(); this.buffer = null; this.assetHash = ''; this.estimatedBytes = 0
  }

  private schedule(playback: PartyPlayback, segment: PartySegment, clock: PartyClockEstimate, deadlineMs: number,
    advanceMs: number, alignmentMs: number): Source | null {
    const context = this.context!, buffer = this.buffer!
    const nowMs = performance.now(), serverNowMs = nowMs + clock.offsetMs
    // When joining late, map the future safe audio sample to the live position.
    // This never starts a late device at the beginning of the song.
    const lateLeadMs = Math.max(120, partyOutputClock(context, nowMs).latencyMs + 100, clock.uncertaintyMs * 2 + 100)
    const intendedServerMs = Math.max(segment.anchorServerMs - advanceMs, serverNowMs + lateLeadMs)
    const when = Math.max(context.currentTime + 0.01, serverToAudioTime(context, intendedServerMs, clock.offsetMs, nowMs))
    const positionMs = segment.positionMs + Math.max(0, intendedServerMs + advanceMs - segment.anchorServerMs) + alignmentMs
    if (positionMs >= buffer.duration * 1000 || intendedServerMs >= deadlineMs - 100) return null
    const node = context.createBufferSource(), gain = context.createGain()
    node.buffer = buffer; node.connect(gain); gain.connect(context.destination)
    gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(this.volume, when + 0.02)
    const source: Source = { node, gain, generation: segment.generation, deadlineMs, when, offsetMs: Math.max(0, positionMs) }
    node.onended = () => {
      node.disconnect(); gain.disconnect()
      if (this.source === source) this.source = null
      if (this.next === source) this.next = null
      if (!source.stopAt) this.onEnded?.(source.generation)
    }
    node.start(when, Math.max(0, positionMs / 1000))
    this.extend(source, deadlineMs, clock)
    return source
  }

  private extend(source: Source, deadlineMs: number, clock: PartyClockEstimate) {
    if (!this.context || source.stopAt) return
    source.deadlineMs = deadlineMs
    // Stop is scheduled on the audio clock, so a suspended JS task cannot leave
    // backing audible indefinitely. Later stop() calls replace an earlier
    // scheduled stop only for a current, renewed generation.
    const deadline = Math.max(this.context.currentTime, serverToAudioTime(this.context, deadlineMs - clock.uncertaintyMs - 50, clock.offsetMs))
    try { source.node.stop(deadline) } catch { /* Source already ended. */ }
  }

  sync(playback: PartyPlayback, clock: PartyClockEstimate | null, lease: PartyLease | null,
    role: 'stage' | 'guide', advanceMs = 0) {
    if (this.blocked || !this.enabled || !this.buffer || !clock || clock.status !== 'healthy' || playback.clockId !== clock.clockId ||
      !lease || lease.clockId !== clock.clockId || lease.performanceId !== playback.performanceId ||
      lease.expiresServerMs <= performance.now() + clock.offsetMs + clock.uncertaintyMs + 100) { this.stop(); return }
    const nowMs = performance.now() + clock.offsetMs
    const asset = role === 'stage' ? playback.assets?.instrumental : playback.assets?.original
    if (!asset || asset.sha256 !== this.assetHash) { this.stop(); return }
    const pending = playback.pendingTransition
    let segment: PartySegment = playback
    if (pending && nowMs >= pending.effectiveServerMs) {
      segment = pending
    }
    if (this.next?.generation === segment.generation) { this.cancel(this.source); this.source = this.next; this.next = null }
    if (!['playing', 'scheduled'].includes(segment.state)) { this.stop(); return }
    if (lease.generation !== segment.generation && lease.nextGeneration !== segment.generation) { this.stop(); return }
    if (this.source?.generation !== segment.generation) {
      this.cancel(this.source); this.source = this.schedule(playback, segment, clock, lease.expiresServerMs, advanceMs, asset.alignmentOffsetMs)
    } else this.extend(this.source, lease.expiresServerMs, clock)
    if (pending && nowMs < pending.effectiveServerMs) {
      const boundary = serverToAudioTime(this.context!, pending.effectiveServerMs - advanceMs, clock.offsetMs)
      this.cancel(this.source, boundary)
      if (pending.state === 'playing' && lease.nextGeneration === pending.generation && this.next?.generation !== pending.generation) {
        this.cancel(this.next)
        this.next = this.schedule(playback, pending, clock, lease.expiresServerMs, advanceMs, asset.alignmentOffsetMs)
      }
    }
    this.measure(playback, clock, advanceMs, asset.alignmentOffsetMs)
  }
  private measure(playback: PartyPlayback, clock: PartyClockEstimate, advanceMs: number, alignmentMs: number) {
    const nowMs = performance.now()
    if (nowMs - this.lastMeasureMs < 1000) return
    this.lastMeasureMs = nowMs
    const output = partyOutputClock(this.context!, nowMs)
    const latency = Number.isFinite(this.context!.outputLatency) && this.context!.outputLatency > 0 ? this.context!.outputLatency * 1000 : null
    const lostTimestamp = this.stats.timingMode === 'timestamp' && output.mode !== 'timestamp'
    this.stats.timingMode = output.mode; this.stats.outputLatencyMs = latency ?? output.latencyMs
    if (lostTimestamp && this.source && output.contextTime >= this.source.when + .1) { this.recover('output'); return }
    if (latency !== null && this.outputLatencyMs !== null && Math.abs(latency - this.outputLatencyMs) > 40) {
      this.recover('output'); return
    }
    if (latency !== null) this.outputLatencyMs = latency
    const source = this.source
    // Transition windows and future scheduled sources do not represent the
    // current audible sample. They must not create false drift recovery.
    if (!source || playback.pendingTransition || output.contextTime < source.when + 0.1 ||
      (source.stopAt !== undefined && output.contextTime >= source.stopAt)) { this.stats.phaseErrorMs = null; this.badSamples = 0; return }
    const renderedMs = source.offsetMs + (output.contextTime - source.when) * 1000
    const expectedMs = partyPosition(playback, nowMs + clock.offsetMs + advanceMs) + alignmentMs
    const errorMs = renderedMs - expectedMs
    this.stats.phaseErrorMs = Math.round(errorMs * 10) / 10
    this.stats.sampleCount++; this.stats.maxAbsPhaseErrorMs = Math.max(this.stats.maxAbsPhaseErrorMs, Math.abs(this.stats.phaseErrorMs))
    // The latency fallback is an estimate. It cannot establish rendered drift.
    if (output.mode !== 'timestamp') { this.badSamples = 0; return }
    this.badSamples = Math.abs(errorMs) > Math.max(80, clock.uncertaintyMs * 2 + 25) ? this.badSamples + 1 : 0
    if (this.badSamples >= 3 || Math.abs(errorMs) > Math.max(250, clock.uncertaintyMs * 4 + 50)) this.recover('drift')
  }

  async close() {
    this.releaseBuffer(); this.onEnded = null; this.onSuspended = null; this.onRecovery = null
    const context = this.context; this.context = null
    if (context) { context.onstatechange = null; context.removeEventListener?.('sinkchange', this.outputChanged); await context.close() }
  }
}
