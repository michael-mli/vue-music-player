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
  const recording = ref(false)
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

  async function start(opts: RecordOptions) {
    if (recording.value) return
    const AC = getAudioContextCtor()
    if (!AC || !navigator.mediaDevices?.getUserMedia) {
      error.value = 'unsupported'
      return
    }
    error.value = ''
    elapsed.value = 0
    if (resultUrl.value) {
      URL.revokeObjectURL(resultUrl.value)
      resultUrl.value = ''
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    } catch (e) {
      error.value = (e as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'failed'
      cleanup()
      return
    }

    try {
      ctx = new AC()
      await ctx.resume()

      // Hidden element that plays the instrumental into our context (muted to speakers).
      recAudio = new Audio(opts.instrumentalUrl)
      recAudio.crossOrigin = 'anonymous'
      recAudio.preload = 'auto'
      await new Promise<void>((resolve, reject) => {
        recAudio!.addEventListener('canplay', () => resolve(), { once: true })
        recAudio!.addEventListener('error', () => reject(new Error('load')), { once: true })
        recAudio!.load()
      })
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
    } catch {
      error.value = 'failed'
      cleanup()
    }
  }

  function stop(name = 'karaoke-recording.mp3') {
    if (!recording.value) return
    recording.value = false
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null }
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null }

    if (encoder) {
      const end = encoder.flush()
      if (end.length > 0) mp3Chunks.push(new Uint8Array(end))
    }
    const blob = new Blob(mp3Chunks as BlobPart[], { type: 'audio/mpeg' })
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
    resultUrl.value = URL.createObjectURL(blob)
    resultName.value = name
    cleanup()
  }

  function cleanup() {
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
  }

  onUnmounted(() => {
    if (recording.value) {
      if (syncTimer) clearInterval(syncTimer)
      if (tickTimer) clearInterval(tickTimer)
      recording.value = false
      cleanup()
    }
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  })

  return { recording, error, elapsed, supported, resultUrl, resultName, start, stop }
}
