import type { PartyAudioAsset, PartyLease, PartyPlayback, PartySegment } from './partyApi'
import type { PartyClockEstimate } from '@/utils/partyClock'
import { serverToAudioTime } from '@/utils/partyTimeline'

interface Source { node: AudioBufferSourceNode; gain: GainNode; generation: number; deadlineMs: number; stopAt?: number }

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
  onEnded: ((generation: number) => void) | null = null
  onSuspended: (() => void) | null = null

  get enabled() { return this.context?.state === 'running' }
  get preparedHash() { return this.assetHash }
  get durationMs() { return (this.buffer?.duration || 0) * 1000 }
  get decodedBytes() { return this.estimatedBytes }
  get sampleRate() { return this.context?.sampleRate || 0 }

  async enable() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive', sampleRate: 44100 })
      this.context.onstatechange = () => { if (!this.enabled) { this.stop(); this.onSuspended?.() } }
    }
    await this.context.resume()
    if (!this.enabled) throw new Error('AUDIO_GESTURE_REQUIRED')
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

  private cancel(source: Source | null, when?: number) {
    if (!source || !this.context) return
    const time = Math.max(this.context.currentTime, when ?? this.context.currentTime)
    source.stopAt = time
    source.node.onended = null
    source.gain.gain.cancelScheduledValues(time)
    source.gain.gain.setValueAtTime(0, time)
    try { source.node.stop(time) } catch { /* Already ended. */ }
    if (time <= this.context.currentTime) { source.node.disconnect(); source.gain.disconnect() }
  }

  stop() { this.cancel(this.source); this.cancel(this.next); this.source = null; this.next = null }
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
    const intendedServerMs = Math.max(segment.anchorServerMs - advanceMs, serverNowMs + 120)
    const when = Math.max(context.currentTime + 0.01, serverToAudioTime(context, intendedServerMs, clock.offsetMs, nowMs))
    const positionMs = segment.positionMs + Math.max(0, intendedServerMs + advanceMs - segment.anchorServerMs) + alignmentMs
    if (positionMs >= buffer.duration * 1000 || intendedServerMs >= deadlineMs - 100) return null
    const node = context.createBufferSource(), gain = context.createGain()
    node.buffer = buffer; node.connect(gain); gain.connect(context.destination)
    gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(this.volume, when + 0.02)
    const source: Source = { node, gain, generation: segment.generation, deadlineMs }
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
    if (!this.enabled || !this.buffer || !clock || clock.status !== 'healthy' || playback.clockId !== clock.clockId ||
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
  }

  async close() {
    this.releaseBuffer(); this.onEnded = null; this.onSuspended = null
    const context = this.context; this.context = null
    if (context) { context.onstatechange = null; await context.close() }
  }
}
