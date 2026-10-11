<template>
  <div class="karaoke-vocal-guide h-full overflow-y-auto p-4 sm:p-8" @pointerdown="pair.touch()" @keydown="pair.touch()">
    <div class="mx-auto max-w-lg rounded-2xl border border-light-border dark:border-white/10 bg-light-card dark:bg-white/5 p-4 sm:p-6">
      <p class="text-sm font-medium text-spotify-green">{{ $t('navigation.karaoke') }}</p>
      <h1 class="mt-3 text-3xl font-bold">{{ $t('karaoke.guide.title') }}</h1>
      <p class="mt-3 text-sm text-light-text-secondary dark:text-gray-400">{{ $t('karaoke.guide.listenerHint') }}</p>
      <div class="my-6 rounded-xl bg-light-bg dark:bg-black/20 p-4">
        <p class="break-words text-lg font-semibold">{{ snapshot?.song?.title || $t('karaoke.guide.noSong') }}</p>
        <p v-if="snapshot?.song" class="mt-1 text-xs text-light-text-secondary dark:text-gray-400 guide-current-song-id">{{ $t('music.songId') }}: {{ snapshot.song.id }}</p>
        <p class="mt-2 text-sm text-light-text-secondary dark:text-gray-400" role="status">{{ $t(`karaoke.guide.${status}`) }}</p>
        <p v-if="snapshot?.song" class="mt-2 text-sm tabular-nums">{{ formatTime(position) }} / {{ formatTime(snapshot.duration) }}</p>
      </div>
      <button type="button" :disabled="ended || (!enabled && (!snapshot?.song || !hostOnline))"
        class="min-h-[48px] w-full rounded-full bg-spotify-green px-5 py-3 font-semibold text-black disabled:opacity-50"
        @click="enabled ? stopGuide() : startGuide()">{{ $t(enabled ? 'karaoke.guide.stop' : 'karaoke.guide.start') }}</button>
      <button v-if="enabled" type="button" :disabled="ended || !hostOnline || !snapshot?.song"
        class="mt-2 min-h-[44px] w-full text-sm text-spotify-green underline disabled:opacity-40"
        data-action="repair-audio" @click="repairGuide">{{ $t('karaoke.guide.repairAudio') }}</button>
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
        <div class="mt-4" role="group" :aria-label="$t('karaoke.guide.hostAudioMode')">
          <p class="text-sm">{{ $t('karaoke.guide.hostAudioMode') }}</p>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button v-for="mode in (['karaoke', 'original'] as const)" :key="mode" type="button" :data-remote-mode="mode"
              :aria-pressed="mode === 'karaoke' ? snapshot?.karaoke !== false : snapshot?.karaoke === false"
              :disabled="!pair.canControl || !snapshot?.canSwitchMode"
              class="min-h-[44px] rounded-lg border px-2 text-sm disabled:opacity-40"
              :class="(mode === 'karaoke' ? snapshot?.karaoke !== false : snapshot?.karaoke === false) ? 'bg-spotify-green/15 text-spotify-green border-spotify-green' : 'border-light-border dark:border-white/20'"
              @click="pair.command('setMode', { karaoke: mode === 'karaoke' })">{{ $t(mode === 'karaoke' ? 'karaoke.switchKaraoke' : 'karaoke.switchOriginal') }}</button>
          </div>
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
        <KaraokeRemoteSongList v-if="pair.catalog?.ready" :songs="pair.catalog.songs" data-song-search-results />
        <div v-if="pair.catalog && pair.catalog.total > 25" class="mt-3 flex items-center justify-between gap-2 text-sm">
          <button type="button" :disabled="pair.searching || pair.catalog.page <= 1" class="min-h-[44px] disabled:opacity-40" @click="searchSongs(pair.catalog.page - 1)">{{ $t('karaoke.guide.previousPage') }}</button>
          <span>{{ pair.catalog.page }} / {{ Math.ceil(pair.catalog.total / 25) }}</span>
          <button type="button" :disabled="pair.searching || pair.catalog.page * 25 >= pair.catalog.total" class="min-h-[44px] disabled:opacity-40" @click="searchSongs(pair.catalog.page + 1)">{{ $t('karaoke.guide.nextPage') }}</button>
        </div>
        <section class="mt-6 border-t border-light-border dark:border-white/10 pt-5" aria-labelledby="guide-browse-songs" :aria-busy="pair.browsing">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 id="guide-browse-songs" class="font-semibold">{{ $t('karaoke.guide.browseSongs') }}</h3>
            <button type="button" :disabled="pair.browsing" data-action="refresh-catalog" class="min-h-[44px] text-sm text-spotify-green disabled:opacity-40"
              @click="browseSongs(1)">{{ $t('karaoke.guide.refreshSongs') }}</button>
          </div>
          <p v-if="pair.browsing" role="status" class="mt-2 text-sm text-light-text-secondary dark:text-gray-400">{{ $t('karaoke.guide.loadingSongs') }}</p>
          <p v-if="pair.browseError" role="alert" class="mt-2 text-sm text-red-500 dark:text-red-300">{{ $t(`karaoke.guide.${pair.browseError}`) }}</p>
          <p v-else-if="pair.browseCatalog && !pair.browseCatalog.ready" role="status" class="mt-2 text-sm">{{ $t('karaoke.guide.catalogUnavailable') }}</p>
          <template v-if="pair.browseCatalog?.ready">
            <p class="mt-2 text-xs text-light-text-secondary dark:text-gray-400">{{ $t('library.totalSongs', { count: pair.browseCatalog.total }) }}</p>
            <p v-if="!pair.browseCatalog.total" class="mt-3 text-sm">{{ $t('karaoke.guide.noResults') }}</p>
            <KaraokeRemoteSongList :songs="pair.browseCatalog.songs" data-song-browser />
            <div v-if="pair.browseCatalog.total > 25" class="mt-3 flex items-center justify-between gap-2 text-sm" data-browse-pagination>
              <button type="button" data-action="previous-page" :disabled="pair.browsing || pair.browseCatalog.page <= 1" class="min-h-[44px] disabled:opacity-40"
                @click="browseSongs(pair.browseCatalog.page - 1)">{{ $t('karaoke.guide.previousPage') }}</button>
              <span>{{ pair.browseCatalog.page }} / {{ Math.ceil(pair.browseCatalog.total / 25) }}</span>
              <button type="button" data-action="next-page" :disabled="pair.browsing || pair.browseCatalog.page * 25 >= pair.browseCatalog.total" class="min-h-[44px] disabled:opacity-40"
                @click="browseSongs(pair.browseCatalog.page + 1)">{{ $t('karaoke.guide.nextPage') }}</button>
            </div>
          </template>
        </section>
        <h3 class="mt-5 font-semibold">{{ $t('karaoke.guide.songQueue') }}</h3>
        <p v-if="!pair.queue.length" class="mt-2 text-sm text-light-text-secondary dark:text-gray-400">{{ $t('karaoke.guide.emptyQueue') }}</p>
        <ol class="mt-2 space-y-2">
          <li v-for="(song, index) in pair.queue" :key="song.id" :data-queued-song-id="song.id" class="flex items-center gap-2 text-sm">
            <span class="min-w-0 flex-1 break-words">{{ index + 1 }}. {{ song.title }}
              <span class="mt-1 block text-xs text-light-text-secondary dark:text-gray-400 remote-queue-song-id">{{ $t('music.songId') }}: {{ song.id }}</span>
            </span>
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
      <audio ref="audio" preload="auto" playsinline @loadedmetadata="sync(true)" @canplay="sync()" @seeked="playback?.seeked()" @ended="sync()" @error="audioFailed" />
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
import { guidePosition } from '@/utils/karaokeGuideSync'
import { KaraokeGuidePlayback } from '@/utils/karaokeGuidePlayback'
import KaraokeRemoteSongList from '@/components/UI/KaraokeRemoteSongList.vue'

const pair = useKaraokeDeviceStore(), { snapshot, hostOnline } = storeToRefs(pair), { t } = useI18n()
const audio = ref<HTMLAudioElement | null>(null), enabled = ref(false), audioError = ref(''), position = ref(0)
const recoveringAudio = ref(false)
const ended = computed(() => ['expired', 'invalidPair', 'removed', 'idleExpired', 'deviceLimit'].includes(pair.error))
const error = computed(() => pair.error || audioError.value)
const volume = ref(0.6), offset = ref(readOffset()), query = ref(''), deviceName = ref(pair.grant?.name || '')
const wakeLock = useWakeLock()
const status = computed(() => ended.value ? pair.error : pair.error === 'reconnecting' ? 'reconnecting' :
  !snapshot.value ? 'connecting' : !hostOnline.value ? 'hostOffline' : !enabled.value ? 'ready' : recoveringAudio.value ? 'recoveringAudio' :
    snapshot.value.playing ? 'following' : 'paused')
let syncTimer: number | undefined, disposed = false, source = ''
let playback: KaraokeGuidePlayback | null = null
let catalogRetry: number | undefined, catalogAttempts = 0

function readOffset() {
  try { return Math.max(-2000, Math.min(2000, Number(localStorage.getItem('karaoke-guide-offset')) || 0)) }
  catch { return 0 }
}
function searchSongs(page: number) { void pair.search(query.value, page) }
async function browseSongs(page: number) {
  window.clearTimeout(catalogRetry)
  await pair.browse(page)
  if (!disposed && pair.grant && pair.browseCatalog && !pair.browseCatalog.ready && ++catalogAttempts < 15) {
    catalogRetry = window.setTimeout(() => { void browseSongs(page) }, 2000)
  }
}
watch(() => pair.grant?.token, token => {
  window.clearTimeout(catalogRetry); catalogAttempts = 0
  if (token) void browseSongs(1)
}, { immediate: true })
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
  playback?.stop()
  wakeLock.setAuto(false)
  if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused'
}
function startGuide() {
  if (!audio.value || !snapshot.value?.song || ended.value || !hostOnline.value) return
  audioError.value = ''; enabled.value = true; pair.listening = true; pair.touch()
  wakeLock.setAuto(true)
  if (audio.value.error) playback?.repair()
  sync(true)
  playback?.unlock()
}
function repairGuide() {
  if (!snapshot.value?.song || ended.value || !hostOnline.value) return
  playback?.repair()
  startGuide()
}
function sync(force = false) {
  const element = audio.value, state = snapshot.value
  if (!element || !state || disposed) return
  const fresh = performance.now() - pair.lastReply < 2500 && hostOnline.value
  const target = guidePosition(state, pair.clock.serverNow(performance.now()), offset.value)
  position.value = state.playing && fresh ? target : state.position
  const allowed = enabled.value && fresh && !!state.song && !!pair.grant
  playback?.sync({ allowed, playing: state.playing, position: target, rate: state.rate }, force)
  if (navigator.mediaSession) navigator.mediaSession.playbackState = allowed && state.playing ? 'playing' : 'paused'
}
function audioFailed() {
  if (!source || disposed) return
  playback?.handleError()
}
function resumeSync() {
  if (document.visibilityState !== 'visible') return
  pair.resume(); sync(true)
}
function updateSource() {
  const url = snapshot.value?.song?.url
  if (!audio.value || !playback || source === (url || '')) return
  source = url || ''; playback?.setSource(source)
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
  if (audio.value) {
    audio.value.volume = volume.value
    playback = new KaraokeGuidePlayback(audio.value, notice => {
      recoveringAudio.value = notice === 'recoveringAudio'
      if (notice === 'audioFailed' || notice === 'tapAgain') { stopGuide(); audioError.value = notice }
      else if (notice === 'recoveringAudio') audioError.value = ''
    })
  }
  updateSource()
  void pair.openPair()
  window.addEventListener('beforeunload', warnBeforeUnload)
  window.addEventListener('online', resumeSync)
  window.addEventListener('pageshow', resumeSync)
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
  playback?.dispose()
  pair.setInGuide(false)
  window.clearInterval(syncTimer)
  window.clearTimeout(catalogRetry)
  window.removeEventListener('beforeunload', warnBeforeUnload)
  window.removeEventListener('online', resumeSync)
  window.removeEventListener('pageshow', resumeSync)
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
