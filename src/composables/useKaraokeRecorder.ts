/**
 * Karaoke recorder — mixes the instrumental + the live mic into a single MP3 the user can
 * save. Opt-in (a Record button).
 *
 * Audio graph: a dedicated AudioContext plays the instrumental through its OWN hidden
 * <audio> element (so it never conflicts with the player's element or the visualizer's
 * MediaElementSource), mixes it with the mic, and taps the mix through a ScriptProcessor
 * that encodes PCM to MP3 with lamejs. The recording element is muted to the speakers
 * (the user keeps hearing the main player), and is kept in sync with the player position.
 *
 * Notes/limitations (v1):
 * - Requires mic permission. Use headphones to avoid the mic catching the speakers.
 * - The recorded music tracks the player position within ~0.35s (periodic resync).
 * - Seeking the main player mid-recording is followed on the next resync tick.
 */
import { ref, onUnmounted } from 'vue'
import { Mp3Encoder } from '@breezystack/lamejs'
import { getMicStream, releaseMicStream } from './useMicDevices'
import { usePlayerStore } from '@/stores/player'

type AnyAudioContext = typeof AudioContext
function getAudioContextCtor(): AnyAudioContext | null {
  if (typeof window === 'undefined') return null
  return window.AudioContext || (window as unknown as { webkitAudioContext?: AnyAudioContext }).webkitAudioContext || null
}

// Leave enough room for the two independent sources before the final safety limiter.
// These gains affect the saved mix only; the singer still hears the instrumental at its
// normal level through the separate destination connection below.
const RECORD_MUSIC_GAIN = 0.7
const RECORD_VOICE_GAIN = 0.85
const LIMITER_CEILING = 0.8 // about -1.9 dBFS, leaving room for MP3 inter-sample peaks
const LIMITER_RELEASE_PER_BLOCK = 0.08
const MP3_BITRATE_KBPS = 192

function floatToInt16(buf: Float32Array, gain = 1): Int16Array {
  const out = new Int16Array(buf.length)
  for (let i = 0; i < buf.length; i++) {
    const s = Math.max(-1, Math.min(1, buf[i] * gain))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

export interface RecordOptions {
  instrumentalUrl: string
  positionSec: number
  getPosition: () => number
  name: string
}

export function useKaraokeRecorder() {
  const playerStore = usePlayerStore()
  const recording = ref(false)
  const starting = ref(false)
  const error = ref<'' | 'denied' | 'unsupported' | 'failed'>('')
  const elapsed = ref(0)
  const resultUrl = ref('')
  const resultName = ref('')

  const supported = ref(
    typeof window !== 'undefined' &&
    !!getAudioContextCtor() &&
    !!navigator.mediaDevices?.getUserMedia
  )

  let ctx: AudioContext | null = null
  let stream: MediaStream | null = null
  let recAudio: HTMLAudioElement | null = null
  let processor: ScriptProcessorNode | null = null
  let encoder: InstanceType<typeof Mp3Encoder> | null = null
  let mp3Chunks: Uint8Array[] = []
  let syncTimer: number | null = null
  let tickTimer: number | null = null
  let startGeneration = 0
  let limiterGain = 1

  async function start(opts: RecordOptions) {
    if (recording.value || starting.value) return
    const AC = getAudioContextCtor()
    if (!AC || !navigator.mediaDevices?.getUserMedia) {
      error.value = 'unsupported'
      return
    }
    const generation = ++startGeneration
    starting.value = true
    error.value = ''
    elapsed.value = 0
    if (resultUrl.value) {
      URL.revokeObjectURL(resultUrl.value)
      resultUrl.value = ''
    }

    try {
      const micStream = await getMicStream({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48000 },
      })
      if (generation !== startGeneration) {
        releaseMicStream(micStream)
        return
      }
      stream = micStream

      ctx = new AC()
      await ctx.resume()
      if (generation !== startGeneration) return

      // Hidden element that plays the instrumental into our context (muted to speakers).
      recAudio = new Audio(opts.instrumentalUrl)
      recAudio.crossOrigin = 'anonymous'
      recAudio.preload = 'auto'
      await new Promise<void>((resolve, reject) => {
        recAudio!.addEventListener('canplay', () => resolve(), { once: true })
        recAudio!.addEventListener('error', () => reject(new Error('load')), { once: true })
        recAudio!.load()
      })
      if (generation !== startGeneration) return
      try { recAudio.currentTime = opts.positionSec || 0 } catch { /* not seekable yet */ }

      const musicSrc = ctx.createMediaElementSource(recAudio)
      const micSrc = ctx.createMediaStreamSource(stream)
      const musicRecordGain = ctx.createGain()
      musicRecordGain.gain.value = RECORD_MUSIC_GAIN
      const voiceRecordGain = ctx.createGain()
      voiceRecordGain.gain.value = RECORD_VOICE_GAIN
      const mix = ctx.createGain()
      musicSrc.connect(musicRecordGain)
      musicRecordGain.connect(mix)
      micSrc.connect(voiceRecordGain)
      voiceRecordGain.connect(mix)

      processor = ctx.createScriptProcessor(4096, 2, 2)
      const silent = ctx.createGain()
      silent.gain.value = 0
      mix.connect(processor)
      processor.connect(silent)
      silent.connect(ctx.destination)

      // The user hears the music from THIS context (mic stays recorder-only — no
      // feedback), while the main player element is muted below: playing both copies
      // near-synced phases badly and sounds like a big quality drop.
      musicSrc.connect(ctx.destination)
      playerStore.setRecordingDuck(true)

      encoder = new Mp3Encoder(2, ctx.sampleRate, MP3_BITRATE_KBPS)
      mp3Chunks = []
      limiterGain = 1
      processor.onaudioprocess = (e) => {
        const ch = e.inputBuffer.numberOfChannels
        const left = e.inputBuffer.getChannelData(0)
        const right = ch > 1 ? e.inputBuffer.getChannelData(1) : left

        // Linked-stereo, block-lookahead safety limiter. The mix previously went straight
        // through floatToInt16(), which hard-clipped every sample outside [-1, 1]. Find the
        // loudest sample in both channels first, then apply one gain to the whole block so
        // stereo placement is preserved and no sample reaches the encoder above the ceiling.
        let peak = 0
        for (let i = 0; i < left.length; i++) {
          peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
        }
        const requiredGain = peak > LIMITER_CEILING ? LIMITER_CEILING / peak : 1
        if (requiredGain < limiterGain) {
          limiterGain = requiredGain
        } else {
          limiterGain = Math.min(requiredGain, limiterGain + (1 - limiterGain) * LIMITER_RELEASE_PER_BLOCK)
        }

        const l = floatToInt16(left, limiterGain)
        const r = floatToInt16(right, limiterGain)
        const out = encoder!.encodeBuffer(l, r)
        if (out.length > 0) mp3Chunks.push(new Uint8Array(out))
      }

      await recAudio.play()
      if (generation !== startGeneration) return
      recording.value = true

      const startedAt = ctx.currentTime
      tickTimer = window.setInterval(() => {
        if (ctx) elapsed.value = Math.floor(ctx.currentTime - startedAt)
      }, 250)
      syncTimer = window.setInterval(() => {
        if (!recAudio) return
        if (recAudio.ended) { stop(opts.name); return }
        const target = opts.getPosition()
        if (target > 0 && Math.abs(recAudio.currentTime - target) > 0.35) {
          try { recAudio.currentTime = target } catch { /* noop */ }
        }
      }, 1000)
    } catch (e) {
      if (generation !== startGeneration) return
      const name = (e as DOMException)?.name
      if (name !== 'AbortError') {
        error.value = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed'
      }
      cleanup()
    } finally {
      if (generation === startGeneration) starting.value = false
    }
  }

  function finish(save: boolean, name = 'karaoke-recording.mp3') {
    const wasRecording = recording.value
    if (!wasRecording && !starting.value && !stream && !ctx) return

    startGeneration++
    starting.value = false
    recording.value = false

    if (save && wasRecording && encoder) {
      const end = encoder.flush()
      if (end.length > 0) mp3Chunks.push(new Uint8Array(end))
    }
    if (save && wasRecording) {
      const blob = new Blob(mp3Chunks as BlobPart[], { type: 'audio/mpeg' })
      if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
      resultUrl.value = URL.createObjectURL(blob)
      resultName.value = name
    }
    cleanup()
  }

  function stop(name = 'karaoke-recording.mp3') {
    finish(true, name)
  }

  function cancel() {
    finish(false)
  }

  function cleanup() {
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
    if (processor) {
      processor.onaudioprocess = null
      try { processor.disconnect() } catch { /* noop */ }
    }
    if (recAudio) {
      try { recAudio.pause() } catch { /* noop */ }
      recAudio.removeAttribute('src')
      try { recAudio.load() } catch { /* noop */ }
    }
    releaseMicStream(stream)
    if (ctx) ctx.close().catch(() => { /* noop */ })
    processor = null
    recAudio = null
    stream = null
    ctx = null
    encoder = null
    mp3Chunks = []
    // Restore the main element only after Chrome's final microphone input is stopped.
    playerStore.setRecordingDuck(false)
  }

  const onVisibilityChange = () => {
    if (document.hidden) cancel()
  }
  const onPageHide = () => cancel()
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide)

  onUnmounted(() => {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide)
    cancel()
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  })

  return { recording, starting, error, elapsed, supported, resultUrl, resultName, start, stop, cancel }
}
