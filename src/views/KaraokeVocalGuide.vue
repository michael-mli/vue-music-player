<template>
  <div class="karaoke-vocal-guide h-full overflow-y-auto p-5 sm:p-8">
    <div class="mx-auto max-w-lg rounded-2xl border border-light-border dark:border-white/10 bg-light-card dark:bg-white/5 p-6">
      <p class="text-sm font-medium text-spotify-green">{{ $t('navigation.karaoke') }}</p>
      <h1 class="mt-3 text-3xl font-bold">{{ $t('karaoke.guide.title') }}</h1>
      <p class="mt-3 text-sm text-light-text-secondary dark:text-gray-400">{{ $t('karaoke.guide.listenerHint') }}</p>
      <div class="my-6 rounded-xl bg-light-bg dark:bg-black/20 p-4">
        <p class="break-words text-lg font-semibold">{{ snapshot?.song?.title || $t('karaoke.guide.noSong') }}</p>
        <p class="mt-2 text-sm text-light-text-secondary dark:text-gray-400" role="status">{{ $t(`karaoke.guide.${status}`) }}</p>
        <p v-if="snapshot?.song" class="mt-2 text-sm tabular-nums">{{ formatTime(position) }} / {{ formatTime(snapshot.duration) }}</p>
      </div>
      <button type="button" :disabled="ended || (!enabled && (!snapshot?.song || !hostOnline))"
        class="min-h-[48px] w-full rounded-full bg-spotify-green px-5 py-3 font-semibold text-black disabled:opacity-50"
        @click="enabled ? stopGuide() : startGuide()">{{ $t(enabled ? 'karaoke.guide.stop' : 'karaoke.guide.start') }}</button>
      <label for="vocal-guide-volume" class="mt-6 block text-sm">{{ $t('karaoke.guide.volume') }} · {{ Math.round(volume * 100) }}%</label>
      <input id="vocal-guide-volume" v-model.number="volume" type="range" min="0" max="1" step="0.01" class="mt-2 min-h-[44px] w-full accent-spotify-green" />
      <label for="vocal-guide-offset" class="mt-4 block text-sm">{{ $t('karaoke.guide.timing') }} · {{ offset > 0 ? '+' : '' }}{{ offset }} ms</label>
      <input id="vocal-guide-offset" v-model.number="offset" type="range" min="-2000" max="2000" step="50" class="mt-2 min-h-[44px] w-full accent-spotify-green" />
      <p class="text-xs text-light-text-secondary dark:text-gray-400">{{ $t('karaoke.guide.timingHint') }}</p>
      <button type="button" class="mt-2 min-h-[44px] px-2 text-sm text-spotify-green underline" @click="offset = 0">{{ $t('karaoke.guide.resetTiming') }}</button>
      <p v-if="error" role="alert" class="mt-4 text-sm text-red-500 dark:text-red-300">{{ $t(`karaoke.guide.${error}`) }}</p>
      <p class="mt-6 text-xs text-light-text-secondary dark:text-gray-400">{{ $t('karaoke.guide.keepOpen') }}</p>
      <RouterLink to="/sing" class="mt-4 inline-flex min-h-[44px] items-center text-sm text-spotify-green">← {{ $t('karaoke.guide.back') }}</RouterLink>
      <audio ref="audio" preload="auto" playsinline @loadedmetadata="sync(true)" @canplay="sync()" @error="audioFailed" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useWakeLock } from '@/composables/useWakeLock'
import { guideRequest, KaraokeGuideError, type KaraokeGuideReply } from '@/services/karaokeGuideApi'
import { KaraokeGuideClock, guidePosition, guideCorrection, type KaraokeGuideState } from '@/utils/karaokeGuideSync'

const audio = ref<HTMLAudioElement | null>(null), snapshot = ref<KaraokeGuideState | null>(null)
const enabled = ref(false), hostOnline = ref(false), ended = ref(false), error = ref(''), position = ref(0)
const volume = ref(0.6), offset = ref(readOffset())
const clock = new KaraokeGuideClock(), wakeLock = useWakeLock()
const status = computed(() => ended.value ? 'expired' : error.value === 'reconnecting' ? 'reconnecting' :
  !snapshot.value ? 'connecting' : !hostOnline.value ? 'hostOffline' : !enabled.value ? 'ready' :
    snapshot.value.playing ? 'following' : 'paused')
let credentials: { id: string; token: string } | null = null
let pollTimer: number | undefined, syncTimer: number | undefined, disposed = false, playing = false
let lastReply = -Infinity, source = '', polling = false
const deviceId = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

function readOffset() {
  try { return Math.max(-2000, Math.min(2000, Number(localStorage.getItem('karaoke-guide-offset')) || 0)) }
  catch { return 0 }
}
function readCredentials() {
  const url = new URL(window.location.href), params = new URLSearchParams(url.hash.slice(1))
  const id = params.get('session'), token = params.get('token')
  if (id && token) {
    url.hash = ''
    window.history.replaceState(window.history.state, '', url.pathname + url.search)
    if (!/^[\w-]{32}$/.test(id) || !/^[\w-]{32}$/.test(token)) return null
    const pair = { id, token }
    try { sessionStorage.setItem('karaoke-guide-pair', JSON.stringify(pair)) } catch { /* Reload pairing is optional. */ }
    return pair
  }
  try {
    const pair = JSON.parse(sessionStorage.getItem('karaoke-guide-pair') || 'null')
    return pair && /^[\w-]{32}$/.test(pair.id) && /^[\w-]{32}$/.test(pair.token) ? pair : null
  } catch { return null }
}
function formatTime(value: number) {
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`
}
function stopGuide() {
  enabled.value = false
  audio.value?.pause()
  wakeLock.setAuto(false)
  if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused'
}
function play() {
  const element = audio.value
  if (!element || playing || !element.paused) return
  playing = true
  void element.play().then(() => {
    if (disposed || !enabled.value || !hostOnline.value || !snapshot.value?.playing) element.pause()
    element.muted = false
  }).catch(reason => {
    if (disposed || reason?.name === 'AbortError') return
    stopGuide(); error.value = reason?.name === 'NotAllowedError' ? 'tapAgain' : 'audioFailed'
  }).finally(() => { playing = false })
}
function startGuide() {
  if (!audio.value || !snapshot.value?.song || ended.value || !hostOnline.value) return
  error.value = ''; enabled.value = true
  wakeLock.setAuto(true)
  if (audio.value.error) audio.value.load()
  // Invoke play directly inside the tap, including when the host is paused, to
  // unlock mobile audio. Keep the initial paused-host unlock silent.
  audio.value.muted = !snapshot.value.playing
  sync(true)
  play()
}
function sync(force = false) {
  const element = audio.value, state = snapshot.value
  if (!element || !state || disposed) return
  const fresh = performance.now() - lastReply < 2500 && hostOnline.value
  const target = guidePosition(state, clock.serverNow(performance.now()), offset.value)
  position.value = state.playing && fresh ? target : state.position
  if (!enabled.value || !fresh || !state.song) { element.pause(); return }
  if (element.readyState >= 1) {
    const correction = guideCorrection(element.currentTime, target, state.rate, state.playing)
    if ((force || correction.seek) && !element.seeking) {
      element.currentTime = Number.isFinite(element.duration) ? Math.min(target, Math.max(0, element.duration - 0.01)) : target
    }
    element.playbackRate = correction.rate
  }
  if (state.playing) play()
  else element.pause()
  if (navigator.mediaSession) navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused'
}
function audioFailed() {
  if (!source || disposed) return
  stopGuide(); error.value = 'audioFailed'
}
async function poll() {
  if (!credentials || disposed || ended.value || polling) return
  polling = true
  try {
    const result = await guideRequest<KaraokeGuideReply>(clock, `/${credentials.id}?device=${deviceId}`, credentials.token)
    if (disposed) return
    snapshot.value = result.state; hostOnline.value = result.hostOnline; lastReply = performance.now()
    if (error.value === 'reconnecting') error.value = ''
    const url = result.state?.song?.url || ''
    if (audio.value && source !== url) {
      source = url
      audio.value.pause()
      if (url) audio.value.src = url
      else audio.value.removeAttribute('src')
      audio.value.load()
      if (navigator.mediaSession && typeof MediaMetadata === 'function') {
        navigator.mediaSession.metadata = new MediaMetadata({ title: result.state?.song?.title || '', artist: 'Karaoke · Vocal guide' })
      }
    }
    sync()
  } catch (reason) {
    if (disposed) return
    hostOnline.value = false
    audio.value?.pause()
    if (reason instanceof KaraokeGuideError && [403, 410].includes(reason.status)) {
      ended.value = true; error.value = reason.code === 'invalidPair' ? 'invalidPair' : 'expired'; stopGuide()
    } else error.value = 'reconnecting'
  } finally {
    polling = false
    if (!disposed && !ended.value) pollTimer = window.setTimeout(() => { void poll() }, 500)
  }
}
function resumeSync() {
  if (document.visibilityState !== 'visible') return
  sync(true)
  window.clearTimeout(pollTimer)
  // The normal request loop resumes without starting overlapping requests.
  pollTimer = window.setTimeout(() => { void poll() }, 0)
}
watch(volume, value => { if (audio.value) audio.value.volume = value })
watch(offset, value => {
  try { localStorage.setItem('karaoke-guide-offset', String(value)) } catch { /* Optional preference. */ }
  sync(true)
})
onMounted(() => {
  if (audio.value) audio.value.volume = volume.value
  credentials = readCredentials()
  if (!credentials) { ended.value = true; error.value = 'invalidPair'; return }
  document.addEventListener('visibilitychange', resumeSync)
  if (navigator.mediaSession) {
    for (const [action, handler] of [['play', startGuide], ['pause', stopGuide], ['stop', stopGuide]] as const) {
      try { navigator.mediaSession.setActionHandler(action, handler) } catch { /* Optional API. */ }
    }
  }
  syncTimer = window.setInterval(() => sync(), 100)
  void poll()
})
onBeforeUnmount(() => {
  disposed = true; stopGuide()
  window.clearTimeout(pollTimer); window.clearInterval(syncTimer)
  document.removeEventListener('visibilitychange', resumeSync)
  if (audio.value) { audio.value.removeAttribute('src'); audio.value.load() }
  if (navigator.mediaSession) {
    for (const action of ['play', 'pause', 'stop'] as const) {
      try { navigator.mediaSession.setActionHandler(action, null) } catch { /* Optional API. */ }
    }
    navigator.mediaSession.metadata = null
  }
})
</script>
