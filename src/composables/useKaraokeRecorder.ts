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
import { getMicStream } from './useMicDevices'
import { usePlayerStore } from '@/stores/player'

type AnyAudioContext = typeof AudioContext
function getAudioContextCtor(): AnyAudioContext | null {
  if (typeof window === 'undefined') return null
  return window.AudioContext || (window as unknown as { webkitAudioContext?: AnyAudioContext }).webkitAudioContext || null
}

function floatToInt16(buf: Float32Array): Int16Array {
  const out = new Int16Array(buf.length)
  for (let i = 0; i < buf.length; i++) {
    const s = Math.max(-1, Math.min(1, buf[i]))
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
      const micStream = await getMicStream({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
      // getUserMedia cannot be aborted. If karaoke was turned off while its prompt was
      // open, release the returned track before it can keep a headset capture profile live.
      if (generation !== startGeneration) {
        micStream.getTracks().forEach((track) => track.stop())
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
      const mix = ctx.createGain()
      musicSrc.connect(mix)
      micSrc.connect(mix)

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

      encoder = new Mp3Encoder(2, ctx.sampleRate, 128)
      mp3Chunks = []
      processor.onaudioprocess = (e) => {
        const ch = e.inputBuffer.numberOfChannels
        const l = floatToInt16(e.inputBuffer.getChannelData(0))
        const r = floatToInt16(ch > 1 ? e.inputBuffer.getChannelData(1) : e.inputBuffer.getChannelData(0))
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
      error.value = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed'
      cleanup()
    } finally {
      if (generation === startGeneration) starting.value = false
    }
  }

  function stop(name = 'karaoke-recording.mp3') {
    const wasRecording = recording.value
    if (!wasRecording && !starting.value) return

    // Invalidate every pending await in start() before releasing its current resources.
    startGeneration++
    starting.value = false
    recording.value = false

    if (wasRecording && encoder) {
      const end = encoder.flush()
      if (end.length > 0) mp3Chunks.push(new Uint8Array(end))
    }
    if (wasRecording) {
      const blob = new Blob(mp3Chunks as BlobPart[], { type: 'audio/mpeg' })
      if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
      resultUrl.value = URL.createObjectURL(blob)
      resultName.value = name
    }
    cleanup()
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
      recAudio.src = ''
    }
    stream?.getTracks().forEach((t) => t.stop())
    if (ctx) ctx.close().catch(() => { /* noop */ })
    processor = null
    recAudio = null
    stream = null
    ctx = null
    encoder = null
    // Restore playback after capture has been released. Bluetooth headphones can remain
    // in their low-quality headset profile while any microphone track is still live.
    playerStore.setRecordingDuck(false)
  }

  onUnmounted(() => {
    startGeneration++
    recording.value = false
    starting.value = false
    cleanup()
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  })

  return { recording, starting, error, elapsed, supported, resultUrl, resultName, start, stop }
}
