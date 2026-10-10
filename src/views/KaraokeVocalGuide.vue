<template>
  <div class="karaoke-vocal-guide h-full overflow-y-auto p-4 sm:p-8" @pointerdown="pair.touch()" @keydown="pair.touch()">
    <div class="mx-auto max-w-lg rounded-2xl border border-light-border dark:border-white/10 bg-light-card dark:bg-white/5 p-4 sm:p-6">
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
      <section v-if="pair.grant" class="mt-6 border-t border-light-border dark:border-white/10 pt-5" aria-labelledby="remote-controls-title">
        <h2 id="remote-controls-title" class="font-semibold">{{ $t('karaoke.guide.remoteControls') }}</h2>
        <p v-if="!pair.device?.canControl" class="mt-2 text-sm" role="status">{{ $t('karaoke.guide.controlsDisabled') }}</p>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <button v-for="action in (['play', 'pause', 'stop', 'skip'] as const)" :key="action" type="button"
            :disabled="!pair.canControl || !snapshot?.song" class="min-h-[44px] rounded-lg border border-light-border dark:border-white/20 px-2 text-sm disabled:opacity-40"
            :data-command="action" @click="pair.command(action)">{{ $t(`karaoke.guide.remote${action}`) }}</button>
        </div>
        <label for="karaoke-remote-seek" class="mt-4 block text-sm">{{ $t('karaoke.guide.seek') }}</label>
        <input id="karaoke-remote-seek" type="range" min="0" :max="snapshot?.duration || 0" :value="position" step="1"
          :disabled="!pair.canControl || !snapshot?.duration" class="min-h-[44px] w-full accent-spotify-green disabled:opacity-40"
          @change="pair.command('seek', { position: Number(($event.target as HTMLInputElement).value) })" />
        <p v-if="pair.pending" class="mt-2 text-sm" role="status">{{ $t('karaoke.guide.commandPending') }}</p>
        <p v-else-if="pair.commandNotice" class="mt-2 text-sm text-spotify-green" role="status">{{ $t(`karaoke.guide.${pair.commandNotice}`) }}</p>
        <p v-if="pair.commandError" class="mt-2 text-sm text-red-500 dark:text-red-300" role="alert">{{ $t(`karaoke.guide.${pair.commandError}`) }}</p>
      </section>
      <section v-if="pair.grant" class="mt-6 border-t border-light-border dark:border-white/10 pt-5" aria-labelledby="guide-song-search">
        <h2 id="guide-song-search" class="font-semibold">{{ $t('karaoke.guide.findSong') }}</h2>
        <form class="mt-3 flex gap-2" @submit.prevent="searchSongs(1)">
          <input v-model="query" type="search" maxlength="160" :aria-label="$t('karaoke.guide.searchPlaceholder')" :placeholder="$t('karaoke.guide.searchPlaceholder')"
            class="min-h-[44px] min-w-0 flex-1 rounded-lg border border-light-border dark:border-white/20 bg-transparent px-3 text-sm" />
          <button type="submit" :disabled="pair.searching" class="min-h-[44px] rounded-lg bg-spotify-green px-3 text-sm font-semibold text-black disabled:opacity-40">{{ $t('karaoke.guide.search') }}</button>
        </form>
        <p v-if="pair.searchError" role="alert" class="mt-2 text-sm text-red-500 dark:text-red-300">{{ $t(`karaoke.guide.${pair.searchError}`) }}</p>
        <p v-if="pair.catalog && !pair.catalog.ready" class="mt-3 text-sm" role="status">{{ $t('karaoke.guide.catalogUnavailable') }}</p>
        <p v-else-if="pair.catalog?.total === 0" class="mt-3 text-sm">{{ $t('karaoke.guide.noResults') }}</p>
        <ul v-if="pair.catalog?.ready" class="mt-3 space-y-3">
          <li v-for="song in pair.catalog.songs" :key="song.id" class="rounded-lg bg-light-bg dark:bg-black/20 p-3" :data-song-id="song.id">
            <p class="break-words text-sm font-medium">{{ song.title }}</p>
            <p v-if="song.artist" class="break-words text-xs text-light-text-secondary dark:text-gray-400">{{ song.artist }}</p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button type="button" :disabled="!pair.canControl || pair.queue.some(item => item.id === song.id)" data-action="enqueue"
                class="min-h-[44px] rounded-lg border border-light-border dark:border-white/20 px-3 text-sm disabled:opacity-40"
                @click="pair.command('enqueue', { songId: song.id })">{{ $t(pair.queue.some(item => item.id === song.id) ? 'karaoke.guide.queued' : 'karaoke.guide.addSong') }}</button>
              <button type="button" :disabled="!pair.canControl" data-action="singNow"
                class="min-h-[44px] rounded-lg border border-light-border dark:border-white/20 px-3 text-sm disabled:opacity-40"
                @click="pair.command('singNow', { songId: song.id })">{{ $t('karaoke.guide.singNow') }}</button>
            </div>
          </li>
        </ul>
        <div v-if="pair.catalog && pair.catalog.total > 25" class="mt-3 flex items-center justify-between gap-2 text-sm">
          <button type="button" :disabled="pair.searching || pair.catalog.page <= 1" class="min-h-[44px] disabled:opacity-40" @click="searchSongs(pair.catalog.page - 1)">{{ $t('karaoke.guide.previousPage') }}</button>
          <span>{{ pair.catalog.page }} / {{ Math.ceil(pair.catalog.total / 25) }}</span>
          <button type="button" :disabled="pair.searching || pair.catalog.page * 25 >= pair.catalog.total" class="min-h-[44px] disabled:opacity-40" @click="searchSongs(pair.catalog.page + 1)">{{ $t('karaoke.guide.nextPage') }}</button>
        </div>
        <h3 class="mt-5 font-semibold">{{ $t('karaoke.guide.songQueue') }}</h3>
        <p v-if="!pair.queue.length" class="mt-2 text-sm text-light-text-secondary dark:text-gray-400">{{ $t('karaoke.guide.emptyQueue') }}</p>
        <ol class="mt-2 space-y-2">
          <li v-for="(song, index) in pair.queue" :key="song.id" class="flex items-center gap-2 text-sm">
            <span class="min-w-0 flex-1 break-words">{{ index + 1 }}. {{ song.title }}</span>
            <button type="button" :disabled="!pair.canControl" class="min-h-[44px] px-2 text-red-500 dark:text-red-300 disabled:opacity-40"
              :aria-label="$t('karaoke.guide.removeSong', { title: song.title })" @click="pair.command('removeQueued', { songId: song.id })">{{ $t('karaoke.guide.remove') }}</button>
          </li>
        </ol>
        <form class="mt-6 flex gap-2" @submit.prevent="pair.rename(deviceName)">
          <label class="min-w-0 flex-1 text-sm">{{ $t('karaoke.guide.deviceName') }}
            <input v-model="deviceName" maxlength="40" required class="mt-2 min-h-[44px] w-full rounded-lg border border-light-border dark:border-white/20 bg-transparent px-3" />
          </label>
          <button type="submit" class="mt-7 min-h-[44px] px-2 text-sm text-spotify-green">{{ $t('karaoke.guide.saveName') }}</button>
        </form>
      </section>
      <button v-if="!pair.grant && !ended" type="button" class="mt-3 min-h-[44px] text-sm text-spotify-green underline" @click="pair.openPair()">{{ $t('karaoke.guide.retry') }}</button>
      <p class="mt-6 text-xs text-light-text-secondary dark:text-gray-400">{{ $t('karaoke.guide.keepOpen') }}</p>
      <RouterLink to="/sing" class="mt-4 inline-flex min-h-[44px] items-center text-sm text-spotify-green">← {{ $t('karaoke.guide.back') }}</RouterLink>
      <audio ref="audio" preload="auto" playsinline @loadedmetadata="sync(true)" @canplay="sync()" @error="audioFailed" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useWakeLock } from '@/composables/useWakeLock'
import { useKaraokeDeviceStore } from '@/stores/karaokeDevice'
import { guidePosition, guideCorrection } from '@/utils/karaokeGuideSync'

const pair = useKaraokeDeviceStore(), { snapshot, hostOnline } = storeToRefs(pair), { t } = useI18n()
const audio = ref<HTMLAudioElement | null>(null), enabled = ref(false), audioError = ref(''), position = ref(0)
const ended = computed(() => ['expired', 'invalidPair', 'removed', 'idleExpired', 'deviceLimit'].includes(pair.error))
const error = computed(() => pair.error || audioError.value)
const volume = ref(0.6), offset = ref(readOffset()), query = ref(''), deviceName = ref(pair.grant?.name || '')
const wakeLock = useWakeLock()
const status = computed(() => ended.value ? pair.error : pair.error === 'reconnecting' ? 'reconnecting' :
  !snapshot.value ? 'connecting' : !hostOnline.value ? 'hostOffline' : !enabled.value ? 'ready' :
    snapshot.value.playing ? 'following' : 'paused')
let syncTimer: number | undefined, disposed = false, playing = false, source = ''

function readOffset() {
  try { return Math.max(-2000, Math.min(2000, Number(localStorage.getItem('karaoke-guide-offset')) || 0)) }
  catch { return 0 }
}
function searchSongs(page: number) { void pair.search(query.value, page) }
function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!pair.grant) return
  event.preventDefault(); event.returnValue = ''
}
onBeforeRouteLeave(() => !pair.grant || window.confirm(t('karaoke.guide.leaveWarning')))
function formatTime(value: number) {
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`
}
function stopGuide() {
  enabled.value = false; pair.listening = false
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
    stopGuide(); audioError.value = reason?.name === 'NotAllowedError' ? 'tapAgain' : 'audioFailed'
  }).finally(() => { playing = false })
}
function startGuide() {
  if (!audio.value || !snapshot.value?.song || ended.value || !hostOnline.value) return
  audioError.value = ''; enabled.value = true; pair.listening = true; pair.touch()
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
  const fresh = performance.now() - pair.lastReply < 2500 && hostOnline.value
  const target = guidePosition(state, pair.clock.serverNow(performance.now()), offset.value)
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
  stopGuide(); audioError.value = 'audioFailed'
}
function resumeSync() {
  if (document.visibilityState !== 'visible') return
  sync(true); pair.resume()
}
function updateSource() {
  const url = snapshot.value?.song?.url
  if (!audio.value || source === (url || '')) return
  source = url || ''; audio.value.pause()
  if (url) audio.value.src = url
  else audio.value.removeAttribute('src')
  audio.value.load()
  if (navigator.mediaSession && typeof MediaMetadata === 'function') {
    navigator.mediaSession.metadata = new MediaMetadata({ title: snapshot.value?.song?.title || '', artist: 'Karaoke · Vocal guide' })
  }
}
watch(() => snapshot.value?.song?.url, updateSource)
watch(() => pair.grant?.name, value => { if (value) deviceName.value = value })
watch(() => pair.grant, value => { if (!value) stopGuide() })
watch(hostOnline, online => { if (!online) audio.value?.pause() })
watch(volume, value => { if (audio.value) audio.value.volume = value })
watch(offset, value => {
  try { localStorage.setItem('karaoke-guide-offset', String(value)) } catch { /* Optional preference. */ }
  sync(true)
})
onMounted(() => {
  if (audio.value) audio.value.volume = volume.value
  updateSource()
  void pair.openPair()
  window.addEventListener('beforeunload', warnBeforeUnload)
  document.addEventListener('visibilitychange', resumeSync)
  if (navigator.mediaSession) {
    for (const [action, handler] of [['play', startGuide], ['pause', stopGuide], ['stop', stopGuide]] as const) {
      try { navigator.mediaSession.setActionHandler(action, handler) } catch { /* Optional API. */ }
    }
  }
  syncTimer = window.setInterval(() => sync(), 100)

})
onBeforeUnmount(() => {
  disposed = true; stopGuide()
  pair.setInGuide(false)
  window.clearInterval(syncTimer)
  window.removeEventListener('beforeunload', warnBeforeUnload)
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
