<template>
  <div class="h-full overflow-y-auto spotify-scrollbar p-4 sm:p-6">
    <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between gap-4 mb-3">
        <h1 class="text-3xl font-bold text-light-text-primary dark:text-white">{{ t('dig.title') }}</h1>
        <RouterLink to="/library" class="text-sm text-spotify-green hover:underline">{{ t('navigation.library') }}</RouterLink>
      </div>
      <p class="text-light-text-secondary dark:text-gray-400 mb-2">{{ t('dig.description') }}</p>

      <form class="flex flex-col sm:flex-row gap-3 my-6" @submit.prevent="search(1)">
        <label for="dig-query" class="sr-only">{{ t('dig.placeholder') }}</label>
        <input id="dig-query" v-model="query" type="search" maxlength="200" :placeholder="t('dig.placeholder')"
          class="flex-1 min-w-0 px-4 py-3 rounded-lg bg-light-surface dark:bg-spotify-dark text-light-text-primary dark:text-white border border-light-border dark:border-spotify-light focus:outline-none focus:ring-2 focus:ring-spotify-green" />
        <button :disabled="searching || importing || !query.trim()" class="px-6 py-3 rounded-lg bg-spotify-green text-black font-semibold hover:bg-green-400 disabled:opacity-50">
          {{ searching ? t('dig.searching') : t('dig.search') }}
        </button>
      </form>
      <label class="flex items-center gap-2 mb-4 text-sm text-light-text-secondary dark:text-gray-400">
        <input v-model="includeUnavailable" type="checkbox" :disabled="searching || importing"
          @change="searched && query.trim() && search(1)" class="accent-spotify-green" />
        {{ t('dig.includeUnavailable') }}
      </label>
      <p v-if="error" role="alert" class="mb-4 p-3 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400">{{ error }}</p>
      <div v-if="activeJob" role="status" class="mb-4 p-3 rounded-lg bg-spotify-green/10 text-light-text-primary dark:text-white">
        {{ t('dig.importingSong', { title: activeJob.title }) }}
        <button v-if="pollPaused" @click="resumePolling" class="ml-3 text-spotify-green underline">{{ t('dig.retryStatus') }}</button>
      </div>
      <p v-if="notice" role="status" class="mb-4 text-spotify-green">{{ notice }}</p>
      <form v-if="manualSong" @submit.prevent="add(manualSong, manualLyrics)"
        class="mb-5 rounded-xl border border-spotify-green/40 bg-spotify-green/10 p-4" :aria-label="t('dig.manualTitle')">
        <h2 class="font-semibold text-light-text-primary dark:text-white">{{ t('dig.manualTitle') }} · {{ manualSong.title }}</h2>
        <p class="my-2 text-sm text-light-text-secondary dark:text-gray-300">{{ t('dig.manualHelp') }}</p>
        <p class="my-2 text-sm text-light-text-primary dark:text-white">{{ t('dig.manualFirstLine', { title: manualSong.title }) }}</p>
        <label for="manual-lyrics" class="block text-sm mb-2 text-light-text-primary dark:text-white">{{ t('dig.manualLabel') }}</label>
        <textarea id="manual-lyrics" ref="manualInput" v-model="manualLyrics" rows="8" maxlength="20000" :disabled="importing"
          class="w-full rounded-lg p-3 bg-light-surface dark:bg-spotify-dark text-light-text-primary dark:text-white border border-light-border dark:border-spotify-light" />
        <p v-if="!manualLyrics.trim()" role="alert" class="mt-2 text-sm text-amber-700 dark:text-amber-300">{{ t('dig.manualBlankWarning') }}</p>
        <div class="flex flex-wrap gap-3 mt-3">
          <button type="submit" :disabled="importing" class="px-4 py-2 rounded-full bg-spotify-green text-black font-semibold disabled:opacity-50">{{ t(manualLyrics.trim() ? 'dig.manualAdd' : 'dig.manualAddTitleOnly') }}</button>
          <button type="button" @click="cancelManualLyrics" :disabled="importing" class="px-4 py-2 rounded-full border border-light-border dark:border-gray-600 text-light-text-primary dark:text-white disabled:opacity-50">{{ t('dig.manualCancel') }}</button>
        </div>
      </form>
      <p v-if="searched && !searching && excluded > 0" class="mb-4 text-xs text-light-text-secondary dark:text-gray-400">{{ t('dig.excludedHidden', { count: excluded }, excluded) }}</p>
      <div v-show="previewSong" class="mb-5 rounded-xl border border-spotify-green/40 bg-spotify-green/10 p-4">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="min-w-0">
            <p class="text-xs text-spotify-green mb-1">{{ t('dig.preview') }}</p>
            <p class="font-medium break-words text-light-text-primary dark:text-white">{{ previewSong?.title }}</p>
            <p class="text-sm text-light-text-secondary dark:text-gray-400">{{ previewSong?.artist }}</p>
          </div>
          <button @click="stopPreview" :aria-label="t('dig.closePreview')" class="p-1 text-light-text-secondary dark:text-gray-400 hover:text-spotify-green">
            <XMarkIcon class="w-5 h-5" />
          </button>
        </div>
        <audio ref="previewAudio" controls preload="none" class="w-full h-10" :aria-label="t('dig.preview')"
          @play="onPreviewPlay" @playing="onPreviewPlaying" @pause="previewPlaying = false; previewLoading = false"
          @waiting="previewLoading = Boolean(previewSong)" @ended="previewPlaying = false; previewLoading = false"
          @timeupdate="onPreviewTimeupdate" @error="onPreviewError" />
        <p v-if="previewLoading" role="status" class="mt-2 text-sm text-light-text-secondary dark:text-gray-400">{{ t('dig.loadingPreview') }}</p>
        <p v-if="previewError" role="alert" class="mt-2 text-sm text-red-600 dark:text-red-400">{{ previewError }}</p>
        <p v-if="previewLyricsLoading" role="status" class="mt-3 text-sm text-light-text-secondary dark:text-gray-400">{{ t('dig.loadingLyrics') }}</p>
        <p v-else-if="previewLyricsError" role="alert" class="mt-3 text-sm text-red-600 dark:text-red-400">{{ previewLyricsError }}</p>
        <div v-else-if="previewLyrics?.length" ref="previewLyricsBox" :aria-label="t('dig.lyrics')"
          class="mt-3 max-h-56 overflow-y-auto spotify-scrollbar rounded-lg bg-black/20 dark:bg-black/30 p-3 space-y-1.5">
          <p v-for="(line, i) in previewLyrics" :key="i" :data-line="i" @click="seekPreview(line)"
            :class="['leading-snug text-sm', line.time >= 0 ? 'cursor-pointer' : '',
              i === activePreviewLine ? 'text-spotify-green font-semibold' : 'text-light-text-secondary dark:text-gray-300']">{{
              line.text || '♪' }}</p>
        </div>
      </div>
      <p v-if="searched && !searching && !results.length && !error" class="py-12 text-center text-light-text-secondary dark:text-gray-400">{{ t('dig.noResults') }}</p>

      <ul class="space-y-3" :aria-busy="searching">
        <li v-for="song in results" :key="song.key" class="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border border-light-border dark:border-spotify-light bg-light-surface dark:bg-spotify-dark">
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-light-text-primary dark:text-white break-words">{{ song.title }}</p>
            <p class="text-sm text-light-text-secondary dark:text-gray-400 break-words">{{ [song.artist, song.album].filter(Boolean).join(' · ') }}</p>
            <p class="mt-1 text-xs text-light-text-secondary dark:text-gray-400">{{ song.source }}<span v-if="song.duration"> · {{ duration(song.duration) }}</span></p>
            <p v-if="song.verification" class="mt-1 text-xs" :class="song.verification === 'verified' ? 'text-spotify-green' : 'text-light-text-secondary dark:text-gray-400'">
              {{ t(`dig.verification.${song.verification}`) }}
            </p>
          </div>
          <button @click="togglePreview(song)" :disabled="searching" :aria-label="`${previewLabel(song)}: ${song.title}`"
            :aria-pressed="previewSong?.key === song.key && previewPlaying"
            class="flex items-center justify-center gap-2 flex-shrink-0 px-4 py-2 rounded-full border border-light-border dark:border-gray-600 text-light-text-primary dark:text-white text-sm font-semibold hover:border-spotify-green hover:text-spotify-green disabled:opacity-50">
            <PauseIcon v-if="previewSong?.key === song.key && previewPlaying" class="w-4 h-4" />
            <PlayIcon v-else class="w-4 h-4" />
            {{ previewLabel(song) }}
          </button>
          <RouterLink v-if="song.libraryId" :to="{ path: '/music', query: { song: song.libraryId } }" class="text-sm text-spotify-green font-medium">
            {{ t('dig.inLibrary', { id: song.libraryId }) }}
          </RouterLink>
          <button v-else @click="add(song)" :disabled="importing || searching" class="flex-shrink-0 px-4 py-2 rounded-full bg-spotify-green text-black text-sm font-semibold hover:bg-green-400 disabled:opacity-50">
            {{ activeJob?.key === song.key ? t('dig.adding') : t('dig.add') }}
          </button>
        </li>
      </ul>
      <nav v-if="totalPages > 1" :aria-label="t('dig.pages')" class="flex justify-center items-center gap-4 mt-6">
        <button @click="search(page - 1)" :disabled="page <= 1 || searching || importing" class="px-3 py-2 rounded bg-light-border dark:bg-spotify-light text-light-text-primary dark:text-white disabled:opacity-40">{{ t('dig.previous') }}</button>
        <span class="text-sm text-light-text-secondary dark:text-gray-400">{{ page }} / {{ totalPages }}</span>
        <button @click="search(page + 1)" :disabled="page >= totalPages || searching || importing" class="px-3 py-2 rounded bg-light-border dark:bg-spotify-light text-light-text-primary dark:text-white disabled:opacity-40">{{ t('dig.next') }}</button>
      </nav>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { digService } from '@/services/digService'
import type { DigJob, DigSong } from '@/services/digService'
import { parseLrc, activeLineIndex } from '@/services/lyricsService'
import type { LyricLine } from '@/types'
import { useAuthStore } from '@/stores/auth'
import { useSongsStore } from '@/stores/songs'
import { usePlayerStore } from '@/stores/player'
import { getApiUrl } from '@/config'
import { PlayIcon, PauseIcon, XMarkIcon } from '@heroicons/vue/24/outline'

const { t, te } = useI18n()
const auth = useAuthStore()
const songsStore = useSongsStore()
const playerStore = usePlayerStore()
const previewAudio = ref<HTMLAudioElement | null>(null)
const previewSong = ref<DigSong | null>(null)
const previewLoading = ref(false)
const previewPlaying = ref(false)
const previewError = ref('')
const previewLyricsBox = ref<HTMLElement | null>(null)
const previewLyrics = ref<LyricLine[] | null>(null)
const previewLyricsLoading = ref(false)
const previewLyricsError = ref('')
const previewTime = ref(0)
const activePreviewLine = computed(() => {
  const lines = previewLyrics.value
  if (!lines?.length || !lines.some((line) => line.time >= 0)) return -1
  return activeLineIndex(lines, previewTime.value)
})
let previewRequest: AbortController | null = null
let lyricsRequest: AbortController | null = null
let previewSequence = 0
// Current upstream stream URL, kept so an audio-element failure can be probed
// for the real JSON error code (the element itself hides HTTP failures).
let previewStreamUrl: string | null = null
const query = ref('')
const results = ref<DigSong[]>([])
const excluded = ref(0)
const includeUnavailable = ref(false)
const page = ref(1)
const totalPages = ref(1)
const searching = ref(false)
const starting = ref(false)
const searched = ref(false)
const error = ref('')
const notice = ref('')
const manualSong = ref<Pick<DigSong, 'key' | 'title'> | null>(null)
const manualLyrics = ref('')
const manualInput = ref<HTMLTextAreaElement | null>(null)
function cancelManualLyrics() {
  manualSong.value = null
  manualLyrics.value = ''
}
const activeJob = ref<{ id: string; key: string; title: string } | null>(null)
const pollPaused = ref(false)
const importing = computed(() => starting.value || Boolean(activeJob.value))
let lastQuery = ''
let disposed = false
let timer: ReturnType<typeof setTimeout> | undefined
const storageKey = () => `dig-import-${auth.user?.id}`

function message(cause: any): string {
  const code = cause?.response?.data?.code || cause?.code
  return code && te(`dig.errors.${code}`) ? t(`dig.errors.${code}`) : t('dig.errors.IMPORT_FAILED')
}
async function identity() {
  if (!auth.isAuthenticated) await auth.ensureIdentity()
  if (!auth.isAuthenticated) throw { code: 'IDENTITY_UNAVAILABLE' }
}
function previewLabel(song: DigSong) {
  if (previewSong.value?.key === song.key) {
    if (previewLoading.value) return t('dig.cancelPreview')
    if (previewPlaying.value) return t('dig.pausePreview')
  }
  return t('dig.playPreview')
}
function stopPreview() {
  ++previewSequence
  previewRequest?.abort()
  previewRequest = null
  lyricsRequest?.abort()
  lyricsRequest = null
  previewStreamUrl = null
  previewSong.value = null
  previewLoading.value = false
  previewPlaying.value = false
  previewError.value = ''
  previewLyrics.value = null
  previewLyricsLoading.value = false
  previewLyricsError.value = ''
  previewTime.value = 0
  if (previewAudio.value) {
    previewAudio.value.pause()
    previewAudio.value.removeAttribute('src')
    previewAudio.value.load()
  }
}
// LRC without usable timestamps (should not happen — imports require synced
// lyrics) still renders as static text so the panel is never silently empty.
function plainFallback(lrc: string): LyricLine[] {
  return lrc.split(/\r?\n/)
    .map((line) => line.replace(/\[[^\]]*\]/g, '').replace(/<\d{1,2}:\d{2}(?:\.\d+)?>/g, '').trim())
    .filter((line) => line && !/^(ti|ar|al|au|by|offset|length|re|ve)\s*:/i.test(line))
    .map((text) => ({ time: -1, text }))
}
function startPreviewLyrics(song: DigSong, sequence: number) {
  lyricsRequest?.abort()
  const controller = new AbortController()
  lyricsRequest = controller
  void loadPreviewLyrics(song, controller.signal, sequence)
}
async function loadPreviewLyrics(song: DigSong, signal: AbortSignal, sequence: number) {
  previewLyrics.value = null
  previewLyricsLoading.value = true
  previewLyricsError.value = ''
  try {
    const response = await digService.lyrics(song.key, signal)
    if (disposed || sequence !== previewSequence) return
    const lines = parseLrc(response.data.lrc || '')
    previewLyrics.value = lines.length ? lines : plainFallback(response.data.lrc || '')
  } catch (cause: any) {
    if (disposed || sequence !== previewSequence || signal.aborted) return
    if (cause?.name === 'CanceledError' || cause?.code === 'ERR_CANCELED') return
    previewLyricsLoading.value = false
    previewLyricsError.value = t('dig.lyricsUnavailable')
  } finally {
    if (!disposed && sequence === previewSequence && previewLyrics.value) previewLyricsLoading.value = false
  }
}
function seekPreview(line: LyricLine) {
  if (line.time >= 0 && previewAudio.value?.hasAttribute('src')) {
    previewAudio.value.currentTime = line.time
  }
}
function onPreviewTimeupdate(event: Event) {
  previewTime.value = (event.target as HTMLAudioElement).currentTime || 0
}
watch(activePreviewLine, (index) => {
  if (index < 0 || !previewPlaying.value) return
  previewLyricsBox.value?.querySelector(`[data-line="${index}"]`)?.scrollIntoView({ block: 'nearest' })
})
function onPreviewPlay() {
  playerStore.pause()
  previewPlaying.value = true
}
function onPreviewPlaying() {
  previewPlaying.value = true
  previewLoading.value = false
  previewError.value = ''
  // Lyrics ride on a working stream: fetching here (not on click) avoids an
  // upstream call for previews that never start playing.
  const song = previewSong.value
  if (song && !previewLyrics.value && !previewLyricsLoading.value && !previewLyricsError.value) {
    startPreviewLyrics(song, previewSequence)
  }
}
// The audio element hides HTTP failures, so probe the stream URL for the JSON
// error code and say what actually happened. An expired preview token is
// retried once with a fresh one when the search results are still valid.
async function onPreviewError() {
  const audio = previewAudio.value
  const song = previewSong.value
  if (!song || !audio?.error) return
  const sequence = previewSequence
  previewLoading.value = false
  previewPlaying.value = false
  const code = await previewFailureCode()
  if (disposed || sequence !== previewSequence) return
  if (code === 'SEARCH_EXPIRED' && previewStreamUrl) {
    await retryPreviewWithFreshToken(audio, song, sequence)
    return
  }
  previewError.value = code && te(`dig.errors.${code}`) ? t(`dig.errors.${code}`) : t('dig.previewUnavailable')
}
async function previewFailureCode(): Promise<string> {
  if (!previewStreamUrl) return ''
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    let res: Response
    try {
      // ?probe=1 keeps this diagnosis out of the server's failure memory.
      res = await fetch(previewStreamUrl + '?probe=1', { headers: { Range: 'bytes=0-0' }, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (res.ok) {
      await res.body?.cancel()
      return ''
    }
    try {
      const body = await res.json()
      return typeof body?.code === 'string' ? body.code : ''
    } catch {
      return ''
    }
  } catch {
    return ''
  }
}
async function retryPreviewWithFreshToken(audio: HTMLAudioElement, song: DigSong, sequence: number) {
  try {
    await identity()
    if (disposed || sequence !== previewSequence) return
    const controller = new AbortController()
    previewRequest = controller
    const response = await digService.preview(song.key, controller.signal)
    if (disposed || sequence !== previewSequence) return
    previewStreamUrl = getApiUrl(`/dig/preview/${encodeURIComponent(response.data.token)}`)
    audio.src = previewStreamUrl
    previewLoading.value = true
    previewError.value = ''
    await audio.play()
  } catch (cause: any) {
    if (disposed || sequence !== previewSequence) return
    if (cause?.name === 'CanceledError' || cause?.code === 'ERR_CANCELED') return
    const retryCode = cause?.response?.data?.code
    previewError.value = retryCode && te(`dig.errors.${retryCode}`) ? t(`dig.errors.${retryCode}`) : t('dig.previewUnavailable')
  }
}
async function togglePreview(song: DigSong) {
  const audio = previewAudio.value
  if (!audio || searching.value) return
  if (previewSong.value?.key === song.key && previewLoading.value) { stopPreview(); return }
  if (previewSong.value?.key === song.key && previewPlaying.value) { audio.pause(); return }
  const resume = previewSong.value?.key === song.key && audio.hasAttribute('src') && !audio.error
  if (!resume) stopPreview()
  previewSong.value = song
  previewLoading.value = true
  previewError.value = ''
  playerStore.pause()
  const sequence = previewSequence
  try {
    if (!resume) {
      const controller = new AbortController()
      previewRequest = controller
      await identity()
      if (disposed || sequence !== previewSequence) return
      const response = await digService.preview(song.key, controller.signal)
      if (disposed || sequence !== previewSequence) return
      previewStreamUrl = getApiUrl(`/dig/preview/${encodeURIComponent(response.data.token)}`)
      audio.src = previewStreamUrl
      audio.volume = playerStore.volume
      audio.muted = playerStore.isMuted
    }
    await audio.play()
  } catch (cause: any) {
    if (disposed || sequence !== previewSequence) return
    previewLoading.value = false
    previewPlaying.value = false
    // Some mobile browsers require another tap after the URL request completes.
    previewError.value = cause?.name === 'NotAllowedError'
      ? t('dig.tapToPreview')
      : cause?.response?.data?.code ? message(cause) : t('dig.previewUnavailable')
  }
}
watch(() => playerStore.isPlaying, (playing) => {
  if (playing && previewSong.value) stopPreview()
})
function persistJob() {
  try {
    if (activeJob.value) sessionStorage.setItem(storageKey(), JSON.stringify(activeJob.value))
    else sessionStorage.removeItem(storageKey())
  } catch { /* Import still works when browser storage is unavailable. */ }
}
async function search(targetPage: number) {
  if (searching.value || importing.value) return
  stopPreview()
  searching.value = true
  error.value = ''
  notice.value = ''
  try {
    await identity()
    const searchQuery = targetPage === 1 ? query.value.trim() : lastQuery
    const response = await digService.search(searchQuery, targetPage, includeUnavailable.value)
    results.value = response.data.songs
    excluded.value = response.data.excluded || 0
    page.value = response.data.page
    totalPages.value = response.data.totalPages
    lastQuery = searchQuery
    searched.value = true
  } catch (cause) {
    error.value = message(cause)
  } finally { searching.value = false }
}
async function add(song: Pick<DigSong, 'key' | 'title'>, lyrics?: string) {
  if (importing.value) return
  starting.value = true
  error.value = ''
  notice.value = ''
  try {
    await identity()
    const response = await digService.add(song.key, lyrics)
    activeJob.value = { id: response.data.id, key: song.key, title: song.title }
    persistJob()
    applyJob(response.data)
  } catch (cause) {
    error.value = message(cause)
  } finally { starting.value = false }
}
function applyJob(job: DigJob) {
  if (job.status === 'complete' && job.result) {
    songsStore.addImportedSong(job.result.song)
    const found = results.value.find((song) => song.key === activeJob.value?.key)
    if (found) found.libraryId = job.result.song.id
    notice.value = t(job.result.alreadyAdded ? 'dig.alreadyAdded' : job.result.titleOnlyLyrics ? 'dig.addedTitleOnly' : job.result.song.lyricsMode === 'manual' ? 'dig.addedManual' : 'dig.added', { title: job.result.song.title, id: job.result.song.id })
    cancelManualLyrics()
    activeJob.value = null
    persistJob()
  } else if (job.status === 'failed') {
    if (job.code === 'NO_SYNCED_LYRICS' && activeJob.value) {
      manualSong.value = { key: activeJob.value.key, title: activeJob.value.title }
      manualLyrics.value = ''
      error.value = ''
      void nextTick(() => { manualInput.value?.focus() })
    } else error.value = message(job)
    activeJob.value = null
    persistJob()
  } else if (!disposed) {
    timer = setTimeout(poll, 1500)
  }
}
async function poll() {
  if (disposed || !activeJob.value) return
  try {
    const response = await digService.status(activeJob.value.id)
    applyJob(response.data)
  } catch (cause: any) {
    error.value = message(cause)
    if ([401, 404].includes(cause?.response?.status)) {
      activeJob.value = null
      persistJob()
    } else {
      pollPaused.value = true
    }
  }
}
function resumePolling() {
  error.value = ''
  pollPaused.value = false
  void poll()
}
function duration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
watch(() => auth.user?.id, (userId) => {
  stopPreview()
  cancelManualLyrics()
  clearTimeout(timer)
  activeJob.value = null
  if (!userId) return
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey()) || 'null')
    if (saved?.id && saved?.key && saved?.title) {
      activeJob.value = saved
      void poll()
    }
  } catch { /* Search can retry identity setup. */ }
}, { immediate: true })
onUnmounted(() => {
  disposed = true
  stopPreview()
  clearTimeout(timer)
})
</script>
