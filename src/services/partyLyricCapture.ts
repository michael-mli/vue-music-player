import { activeLineIndex } from '@/utils/lyricsTiming'
import type { LyricLine } from '@/types'

export interface PartyLyricFrame {
  title: string
  singer: string
  // Position in the publisher's rendered instrumental, before its publish delay.
  // The receiver uses this captured video instead of a separate room clock.
  renderPositionMs: number
  backingDelayMs: number
  lyricOffsetMs: number
  lines: LyricLine[]
}

export function publishedLyricFrame(frame: PartyLyricFrame) {
  const positionMs = Math.max(0, frame.renderPositionMs - Math.max(0, frame.backingDelayMs))
  const index = activeLineIndex(frame.lines, (positionMs + frame.lyricOffsetMs) / 1000)
  return { positionMs, line: frame.lines[index]?.text || '', next: frame.lines[index + 1]?.text || '' }
}

export class PartyLyricCapture {
  readonly stream: MediaStream
  private readonly context: CanvasRenderingContext2D
  private frameId = 0
  private lastFrameMs = -Infinity
  private closed = false
  private readonly manualTrack?: CanvasCaptureMediaStreamTrack

  constructor(readonly canvas: HTMLCanvasElement, private readonly readFrame: () => PartyLyricFrame | null,
    private readonly fps = 25) {
    if (!canvas.captureStream || !Number.isInteger(fps) || fps < 10 || fps > 30) throw new Error('LYRIC_CAPTURE_UNSUPPORTED')
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('LYRIC_CAPTURE_UNSUPPORTED')
    this.context = context
    canvas.width = 1280; canvas.height = 720
    this.draw(null)
    // One cadence controls both drawing and capture where requestFrame is supported.
    // Retain automatic capture as a fallback for browsers without that API.
    let stream = canvas.captureStream(0)
    const manualTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined
    if (typeof manualTrack?.requestFrame === 'function') {
      this.manualTrack = manualTrack
    } else {
      for (const track of stream.getTracks()) track.stop()
      stream = canvas.captureStream(fps)
    }
    if (!stream.getVideoTracks().length) {
      for (const track of stream.getTracks()) track.stop()
      throw new Error('LYRIC_CAPTURE_UNSUPPORTED')
    }
    this.stream = stream
    this.manualTrack?.requestFrame()
    document.addEventListener('visibilitychange', this.visibilityChanged)
    this.frameId = requestAnimationFrame(this.tick)
  }

  private tick = (time: number) => {
    if (this.closed) return
    const period = 1000 / this.fps
    if (!document.hidden && time - this.lastFrameMs >= period) {
      // Preserve the fractional interval across animation frames. Resetting to
      // `time` rounds 40 ms up to three 60 Hz frames, reducing 25 fps to 20 fps.
      // After a stall, render one fresh frame rather than a burst of old frames.
      this.lastFrameMs = Number.isFinite(this.lastFrameMs)
        ? this.lastFrameMs + Math.floor((time - this.lastFrameMs) / period) * period : time
      this.draw(this.readFrame())
      this.manualTrack?.requestFrame()
    }
    this.frameId = requestAnimationFrame(this.tick)
  }
  private visibilityChanged = () => {
    if (document.hidden) {
      this.draw(null)
      const track = this.stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
      track.requestFrame?.()
    }
  }
  private wrapped(text: string, y: number, color: string, size: number, maxLines = 3) {
    const ctx = this.context
    ctx.fillStyle = color; ctx.font = `600 ${size}px sans-serif`
    let line = '', row = 0
    // Wrapping by code point works for unspaced Chinese as well as Latin text.
    for (const character of Array.from(text.slice(0, 600))) {
      if (ctx.measureText(line + character).width > 1152 && line) {
        ctx.fillText(line, 64, y + row * (size + 16)); line = ''; row++
        if (row >= maxLines) return
      }
      line += character
    }
    if (line) ctx.fillText(line, 64, y + row * (size + 16))
  }
  private draw(frame: PartyLyricFrame | null) {
    const ctx = this.context
    ctx.fillStyle = '#102027'; ctx.fillRect(0, 0, 1280, 720)
    if (!frame) return
    const rendered = publishedLyricFrame(frame)
    this.wrapped(frame.title, 74, '#ffffff', 36, 1)
    this.wrapped(frame.singer, 126, '#9ca3af', 28, 1)
    this.wrapped(rendered.line, 300, '#22c55e', 64)
    this.wrapped(rendered.next, 574, '#d1d5db', 32, 2)
    const seconds = Math.floor(rendered.positionMs / 1000)
    ctx.fillStyle = '#9ca3af'; ctx.font = '24px sans-serif'
    ctx.fillText(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, 1160, 686)
  }
  close() {
    if (this.closed) return
    this.closed = true; cancelAnimationFrame(this.frameId)
    document.removeEventListener('visibilitychange', this.visibilityChanged)
    for (const track of this.stream.getTracks()) track.stop()
    this.draw(null)
  }
}
