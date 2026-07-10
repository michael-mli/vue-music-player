/**
 * Mic test mode — shows a live input-level meter (no speaker output, so no feedback risk)
 * and can record a short clip that plays back so the user can hear how their mic sounds.
 */
import { ref, onUnmounted } from 'vue'
import { getMicStream } from './useMicDevices'

type AnyAudioContext = typeof AudioContext
function getAudioContextCtor(): AnyAudioContext | null {
  if (typeof window === 'undefined') return null
  return window.AudioContext || (window as unknown as { webkitAudioContext?: AnyAudioContext }).webkitAudioContext || null
}

const CLIP_SECONDS = 3

export function useMicTest() {
  const testing = ref(false)
  const level = ref(0) // live input level, 0..1
  const clipUrl = ref('')
  const clipRecording = ref(false)
  const clipCountdown = ref(0)
  const error = ref<'' | 'denied' | 'unsupported' | 'failed'>('')

  const supported = ref(
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!getAudioContextCtor()
  )

  let ctx: AudioContext | null = null
  let stream: MediaStream | null = null
  let analyser: AnalyserNode | null = null
  let rafId: number | null = null
  let recorder: MediaRecorder | null = null
  let countdownTimer: number | null = null

  function meterLoop() {
    if (!analyser) return
    const data = new Uint8Array(analyser.fftSize)
    const tick = () => {
      if (!analyser) return
      analyser.getByteTimeDomainData(data)
      let peak = 0
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i] - 128) / 128
        if (v > peak) peak = v
      }
      // A little smoothing so the bar decays instead of flickering
      level.value = Math.max(peak, level.value * 0.85)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
  }

  async function start() {
    if (testing.value) return
    const AC = getAudioContextCtor()
    if (!AC || !navigator.mediaDevices?.getUserMedia) {
      error.value = 'unsupported'
      return
    }
    error.value = ''
    try {
      stream = await getMicStream({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
      ctx = new AC()
      await ctx.resume()
      analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      // Analyser only — nothing is routed to the speakers
      ctx.createMediaStreamSource(stream).connect(analyser)
      testing.value = true
      meterLoop()
    } catch (e) {
      const name = (e as DOMException)?.name
      error.value = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed'
      stop()
    }
  }

  function stop() {
    testing.value = false
    level.value = 0
    if (rafId) { cancelAnimationFrame(rafId); rafId = null }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop() } catch { /* noop */ } }
    recorder = null
    clipRecording.value = false
    clipCountdown.value = 0
    try { analyser?.disconnect() } catch { /* noop */ }
    analyser = null
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    if (ctx) {
      ctx.close().catch(() => { /* noop */ })
      ctx = null
    }
  }

  async function toggle() {
    if (testing.value) stop()
    else await start()
  }

  /** Record a short clip from the test stream, then expose it for playback. */
  function recordClip() {
    if (!testing.value || !stream || clipRecording.value) return
    if (typeof MediaRecorder === 'undefined') {
      error.value = 'unsupported'
      return
    }
    if (clipUrl.value) { URL.revokeObjectURL(clipUrl.value); clipUrl.value = '' }
    const chunks: Blob[] = []
    try {
      recorder = new MediaRecorder(stream)
    } catch {
      error.value = 'failed'
      return
    }
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => {
      clipRecording.value = false
      clipCountdown.value = 0
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
      if (chunks.length) {
        clipUrl.value = URL.createObjectURL(new Blob(chunks, { type: chunks[0].type || 'audio/webm' }))
      }
      recorder = null
    }
    clipRecording.value = true
    clipCountdown.value = CLIP_SECONDS
    recorder.start()
    countdownTimer = window.setInterval(() => {
      clipCountdown.value--
      if (clipCountdown.value <= 0 && recorder && recorder.state !== 'inactive') {
        recorder.stop()
      }
    }, 1000)
  }

  onUnmounted(() => {
    stop()
    if (clipUrl.value) URL.revokeObjectURL(clipUrl.value)
  })

  return { testing, level, clipUrl, clipRecording, clipCountdown, error, supported, start, stop, toggle, recordClip }
}
