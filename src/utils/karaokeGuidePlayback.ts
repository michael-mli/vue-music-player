import { guideCorrection } from './karaokeGuideSync'

export interface GuidePlaybackFrame {
  allowed: boolean
  playing: boolean
  position: number
  rate: number
}
export type GuidePlaybackNotice = 'ready' | 'recoveringAudio' | 'audioFailed' | 'tapAgain'

// Keep a mobile media element alive without letting retries change the host song.
// The view supplies a fresh, authoritative host frame on each sync tick.
export class KaraokeGuidePlayback {
  private source = ''
  private frame: GuidePlaybackFrame | null = null
  private pendingPlay: object | null = null
  private disposed = false
  private lastSeek = -Infinity
  private seekStarted = -Infinity
  private seekLatency = 0
  private lastPosition = 0
  private lastTarget: number | null = null
  private lastTick = 0
  private progressAt = 0
  private retryAt = Infinity
  private recovering = false
  private recoveries: number[] = []

  constructor(private audio: HTMLAudioElement, private notify: (notice: GuidePlaybackNotice) => void,
    private now: () => number = () => performance.now()) {}

  setSource(source: string) {
    if (source === this.source || this.disposed) return
    this.source = source
    this.stop(); this.lastSeek = -Infinity; this.seekStarted = -Infinity; this.seekLatency = 0
    this.recoveries = []
    if (source) this.audio.src = source
    else this.audio.removeAttribute('src')
    this.audio.load()
  }

  stop() {
    this.pendingPlay = null
    this.audio.pause(); this.audio.muted = false
    this.frame = null; this.lastTarget = null; this.retryAt = Infinity
    this.progressAt = this.now(); this.lastPosition = this.audio.currentTime
    this.setRecovering(false)
  }

  dispose() { this.disposed = true; this.stop() }

  private setRecovering(value: boolean) {
    if (value === this.recovering) return
    this.recovering = value
    this.notify(value ? 'recoveringAudio' : 'ready')
  }

  // Seeking can take hundreds of milliseconds on a phone. Do not immediately
  // start another seek from canplay and starve the decoder of actual playback.
  seeked() {
    if (!Number.isFinite(this.seekStarted)) return
    this.seekLatency = Math.min(1000, Math.max(0, this.now() - this.seekStarted))
    this.seekStarted = -Infinity
    this.lastPosition = this.audio.currentTime
  }

  handleError() {
    if (this.disposed || !this.source || !this.frame?.allowed) return
    if (!Number.isFinite(this.retryAt)) this.retryAt = this.now() + 1000
    this.setRecovering(true)
  }

  // Explicit repair also renews the retry budget. Reusing the element preserves
  // its mobile playback permission, volume and output device.
  repair() {
    if (!this.source || this.disposed) return
    this.recoveries = []
    this.reload()
  }

  private reload() {
    this.pendingPlay = null
    this.audio.pause(); this.audio.muted = false
    this.lastSeek = -Infinity; this.seekStarted = -Infinity; this.lastTarget = null
    this.progressAt = this.now(); this.retryAt = Infinity
    this.audio.load()
    this.lastPosition = this.audio.currentTime
    this.setRecovering(true)
  }

  private recover() {
    const now = this.now()
    this.recoveries = this.recoveries.filter(time => now - time < 60_000)
    if (this.recoveries.length >= 3) {
      this.stop(); this.notify('audioFailed'); return
    }
    this.recoveries.push(now)
    this.reload()
  }

  sync(frame: GuidePlaybackFrame, force = false) {
    if (this.disposed) return
    if (!frame.allowed || !this.source) { this.stop(); return }
    const now = this.now(), previous = this.frame
    this.frame = frame
    if (this.lastTarget === null || !previous?.playing) this.progressAt = now
    const jumped = this.lastTarget !== null && Math.abs(frame.position - this.lastTarget
      - (previous?.playing ? Math.max(0, now - this.lastTick) / 1000 * frame.rate : 0)) > 0.75
    if (jumped) { this.lastSeek = -Infinity; this.progressAt = now }
    this.lastTarget = frame.position; this.lastTick = now

    if (this.audio.error || Number.isFinite(this.retryAt)) {
      if (!Number.isFinite(this.retryAt)) this.handleError()
      if (now >= this.retryAt) this.recover()
      return
    }

    const duration = this.audio.duration, hasEnd = Number.isFinite(duration) && duration > 0
    const target = hasEnd ? Math.min(frame.position, Math.max(0, duration - 0.05)) : frame.position
    // Original and instrumental MP3 lengths can differ slightly. Wait for the
    // host at the end instead of repeatedly replaying the final audio fragment.
    const finished = hasEnd && (frame.position >= duration - 0.05 || (this.audio.ended && target >= duration - 0.5))
    if (frame.playing && finished) {
      this.pendingPlay = null; this.audio.pause(); this.audio.muted = false
      this.progressAt = now; this.setRecovering(false); return
    }

    const current = this.audio.currentTime
    if (frame.playing && !this.audio.paused && !this.audio.seeking && this.audio.readyState >= 2
      && current > this.lastPosition + 0.01) {
      this.progressAt = now; this.setRecovering(false)
    }
    this.lastPosition = current
    if (frame.playing && now - this.progressAt >= 6000) { this.recover(); return }

    if (this.audio.readyState >= 1) {
      const correction = guideCorrection(current, target, frame.rate, frame.playing)
      if ((force || jumped || correction.seek) && !this.audio.seeking && now - this.lastSeek >= 1200) {
        this.lastSeek = now; this.seekStarted = now
        const ahead = frame.playing ? this.seekLatency / 1000 * frame.rate : 0
        const destination = hasEnd ? Math.min(target + ahead, Math.max(0, duration - 0.05)) : target + ahead
        try { this.audio.currentTime = destination; this.lastPosition = destination }
        catch { this.handleError() }
      }
      this.audio.playbackRate = correction.rate
    }
    this.audio.muted = false
    if (frame.playing) this.play()
    else {
      this.pendingPlay = null; this.audio.pause(); this.progressAt = now
      if (this.audio.readyState >= 2) this.setRecovering(false)
    }
  }

  // Called synchronously from a tap even when the host is paused, so Safari can
  // grant playback permission. The paused-host unlock is muted and stops again.
  unlock() {
    if (!this.frame?.allowed || this.disposed) return
    this.recoveries = []
    if (this.audio.error) this.repair()
    this.audio.muted = !this.frame.playing
    this.play(true)
  }

  private play(unlock = false) {
    if (this.pendingPlay || (!this.audio.paused && !unlock) || this.disposed) return
    const attempt = {}
    this.pendingPlay = attempt
    const failed = (reason: unknown) => {
      if (this.disposed || this.pendingPlay !== attempt) return
      const name = (reason as { name?: string })?.name
      if (name === 'AbortError') return
      if (name === 'NotAllowedError') { this.stop(); this.notify('tapAgain') }
      else { this.retryAt = this.now() + 1000; this.setRecovering(true) }
    }
    try {
      void this.audio.play().then(() => {
        // A play promise from a previous source must never mute, pause or fail
        // the current source, or hold its pending-play lock indefinitely.
        if (this.disposed || this.pendingPlay !== attempt) return
        if (!this.frame?.allowed || !this.frame.playing) this.audio.pause()
        this.audio.muted = false
      }).catch(failed).finally(() => { if (this.pendingPlay === attempt) this.pendingPlay = null })
    } catch (reason) { failed(reason); if (this.pendingPlay === attempt) this.pendingPlay = null }
  }
}
