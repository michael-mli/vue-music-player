/**
 * Live microphone monitoring for karaoke — routes the mic through Web Audio back to the
 * speakers so the singer hears themselves over the instrumental, with optional reverb.
 *
 * Caveats (by design, v1):
 * - HEADPHONES recommended: without them the mic picks up the speakers and can howl (feedback).
 * - There is inherent latency hearing yourself; Web Audio keeps it low but not zero.
 * - We disable echoCancellation/noiseSuppression/autoGainControl for a natural singing voice;
 *   that trades feedback safety for fidelity, hence the headphones note.
 */
import { ref, onUnmounted } from 'vue'
import { getMicStream, releaseMicStream } from './useMicDevices'

type AnyAudioContext = typeof AudioContext

function getAudioContextCtor(): AnyAudioContext | null {
  if (typeof window === 'undefined') return null
  return window.AudioContext || (window as unknown as { webkitAudioContext?: AnyAudioContext }).webkitAudioContext || null
}

/** Build a short synthetic impulse response (decaying noise) for a plate-ish reverb. */
function makeImpulse(ctx: AudioContext, seconds = 2, decay = 2.5): AudioBuffer {
  const rate = ctx.sampleRate
  const length = Math.max(1, Math.floor(seconds * rate))
  const impulse = ctx.createBuffer(2, length, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
    }
  }
  return impulse
}

export function useMicMonitor() {
  const active = ref(false)
  const starting = ref(false)
  const error = ref<'' | 'denied' | 'unsupported' | 'failed'>('')
  const gain = ref(0.85)
  const reverb = ref(0.25)

  const supported = ref(
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!getAudioContextCtor()
  )

  let ctx: AudioContext | null = null
  let stream: MediaStream | null = null
  let srcNode: MediaStreamAudioSourceNode | null = null
  let gainNode: GainNode | null = null
  let dryNode: GainNode | null = null
  let wetNode: GainNode | null = null
  let convolver: ConvolverNode | null = null
  let startGeneration = 0

  async function start() {
    if (active.value || starting.value) return
    const AC = getAudioContextCtor()
    if (!AC || !navigator.mediaDevices?.getUserMedia) {
      error.value = 'unsupported'
      return
    }
    const generation = ++startGeneration
    starting.value = true
    error.value = ''
    try {
      const micStream = await getMicStream({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
      if (generation !== startGeneration) {
        releaseMicStream(micStream)
        return
      }
      stream = micStream
      ctx = new AC()
      await ctx.resume()
      if (generation !== startGeneration) return

      srcNode = ctx.createMediaStreamSource(stream)
      gainNode = ctx.createGain()
      gainNode.gain.value = gain.value
      dryNode = ctx.createGain()
      dryNode.gain.value = 1
      wetNode = ctx.createGain()
      wetNode.gain.value = reverb.value
      convolver = ctx.createConvolver()
      convolver.buffer = makeImpulse(ctx)

      // mic -> gain -> [dry -> out] and [reverb -> wet -> out]
      srcNode.connect(gainNode)
      gainNode.connect(dryNode)
      dryNode.connect(ctx.destination)
      gainNode.connect(convolver)
      convolver.connect(wetNode)
      wetNode.connect(ctx.destination)

      active.value = true
    } catch (e) {
      if (generation !== startGeneration) return
      const name = (e as DOMException)?.name
      if (name !== 'AbortError') {
        error.value = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed'
      }
      stop()
    } finally {
      if (generation === startGeneration) starting.value = false
    }
  }

  function stop() {
    startGeneration++
    starting.value = false
    active.value = false
    try { srcNode?.disconnect() } catch { /* noop */ }
    try { gainNode?.disconnect() } catch { /* noop */ }
    try { dryNode?.disconnect() } catch { /* noop */ }
    try { wetNode?.disconnect() } catch { /* noop */ }
    try { convolver?.disconnect() } catch { /* noop */ }
    releaseMicStream(stream)
    stream = null
    srcNode = gainNode = dryNode = wetNode = null
    convolver = null
    if (ctx) {
      ctx.close().catch(() => { /* noop */ })
      ctx = null
    }
  }

  async function toggle() {
    if (active.value) stop()
    else await start()
  }

  function setGain(v: number) {
    gain.value = v
    if (gainNode && ctx) gainNode.gain.setTargetAtTime(v, ctx.currentTime, 0.01)
  }

  function setReverb(v: number) {
    reverb.value = v
    if (wetNode && ctx) wetNode.gain.setTargetAtTime(v, ctx.currentTime, 0.01)
  }

  const onVisibilityChange = () => {
    if (document.hidden) stop()
  }
  const onPageHide = () => stop()
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide)

  onUnmounted(() => {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide)
    stop()
  })

  return { active, starting, error, supported, gain, reverb, toggle, start, stop, setGain, setReverb }
}
