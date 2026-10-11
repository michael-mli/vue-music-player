<template>
  <section class="stage-song-picker" :aria-label="$t('karaoke.guide.browseSongs')" @keydown.esc.stop.prevent="$emit('close')">
    <header class="picker-header">
      <h2>{{ $t('karaoke.guide.browseSongs') }}</h2>
      <button type="button" data-action="close-songs" @click="$emit('close')">{{ $t('common.close') }}</button>
    </header>
    <label class="picker-search">
      <span>{{ $t('karaoke.guide.findSong') }}</span>
      <input ref="searchInput" v-model="query" type="search" maxlength="160" :placeholder="$t('karaoke.guide.searchPlaceholder')" />
    </label>
    <p v-if="loading" role="status">{{ $t('karaoke.loading') }}</p>
    <p v-else-if="loadFailed" role="alert">{{ $t('common.error') }} <button type="button" @click="loadSongs">{{ $t('common.retry') }}</button></p>
    <template v-else>
      <div class="picker-results-header">
        <p>{{ $t('karaoke.available', { count: filteredSongs.length }) }}</p>
        <p v-if="notice" role="status" class="picker-notice">{{ notice }}</p>
      </div>
      <KaraokeSongBatch :count="selected.size" :eligible="selectablePage.length > 0" :all-selected="allPageSelected" :disabled="player.partyAudioOwned"
        @select-page="selectPage(pageSongs)" @clear="selected.clear()" @add="enqueueSelected" />
      <p v-if="!filteredSongs.length" class="picker-empty">{{ $t(query ? 'search.noResults' : 'karaoke.empty') }}</p>
      <ul v-else class="picker-list">
        <li v-for="song in pageSongs" :key="song.id" :data-song-id="song.id" :class="{ 'is-current': player.currentSong?.id === song.id }">
          <label class="picker-select">
            <input type="checkbox" :checked="selected.has(song.id)" :disabled="player.partyAudioOwned || queued(song.id)"
              :aria-label="$t('karaoke.selectSong', { title: song.title, id: song.id })" @change="toggle(song)" />
          </label>
          <div class="picker-cover"><SongCover :song-id="song.id" :alt="song.title" /></div>
          <div class="picker-song">
            <p>{{ song.title }}</p>
            <p class="picker-song-info">{{ $t('music.songId') }}: {{ song.id }}<template v-if="song.artist"> · {{ song.artist }}</template></p>
          </div>
          <div class="picker-actions">
            <button type="button" data-action="enqueue" :disabled="player.partyAudioOwned || queued(song.id)" @click="enqueue(song)">
              {{ $t(queued(song.id) ? 'karaoke.guide.queued' : 'karaoke.guide.addSong') }}
            </button>
            <button type="button" data-action="singNow" :disabled="player.partyAudioOwned || busy" @click="sing(song)">{{ $t('karaoke.guide.singNow') }}</button>
          </div>
        </li>
      </ul>
      <nav v-if="totalPages > 1" class="picker-pagination" :aria-label="$t('karaoke.songPages')">
        <button type="button" data-action="previous-page" :disabled="page <= 1" @click="changePage(-1)">{{ $t('player.previous') }}</button>
        <span>{{ $t('karaoke.songPage', { page, total: totalPages }) }}</span>
        <button type="button" data-action="next-page" :disabled="page >= totalPages" @click="changePage(1)">{{ $t('player.next') }}</button>
      </nav>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SongCover from '@/components/UI/SongCover.vue'
import KaraokeSongBatch from '@/components/UI/KaraokeSongBatch.vue'
import { useSongSelection } from '@/composables/useSongSelection'
import { usePlayerStore } from '@/stores/player'
import { useSongsStore } from '@/stores/songs'
import { karaokeService } from '@/services/karaokeService'
import { normalizeForSearch } from '@/utils/chineseSearch'
import type { Song } from '@/types'

defineEmits<{ close: [] }>()
const player = usePlayerStore(), songs = useSongsStore(), { t } = useI18n()
const query = ref(''), page = ref(1), loading = ref(false), loadFailed = ref(false), busy = ref(false), notice = ref('')
const searchInput = ref<HTMLInputElement>()
const availableSongs = computed(() => songs.songs.filter(song => karaokeService.isAvailable(song.id)))
const filteredSongs = computed(() => {
  const words = normalizeForSearch(query.value.trim()).split(/\s+/).filter(Boolean)
  if (!words.length) return availableSongs.value
  return availableSongs.value.filter(song => {
    const text = normalizeForSearch([song.id, song.title, song.artist, song.album].filter(value => value != null).join(' '))
    return words.every(word => text.includes(word))
  })
})
const totalPages = computed(() => Math.max(1, Math.ceil(filteredSongs.value.length / 25)))
const pageSongs = computed(() => filteredSongs.value.slice((page.value - 1) * 25, page.value * 25))
watch(query, () => { page.value = 1 })
watch(totalPages, count => { page.value = Math.min(page.value, count) })
const queued = (id: number) => player.requestedQueue.some(song => song.id === id)
const { selected, selectedSongs, toggle, selectPage } = useSongSelection<Song>(queued)
const selectablePage = computed(() => pageSongs.value.filter(song => !queued(song.id)))
const allPageSelected = computed(() => selectablePage.value.length > 0 && selectablePage.value.every(song => selected.value.has(song.id)))
function enqueueSelected() {
  const added = player.enqueueSongs(selectedSongs.value)
  for (const song of selectedSongs.value) if (queued(song.id)) selected.value.delete(song.id)
  notice.value = t(selected.value.size ? 'karaoke.batchPartial' : 'karaoke.batchAdded', { count: added.length, remaining: selected.value.size })
}
function enqueue(song: Song) {
  notice.value = player.enqueueSong(song) ? t('karaoke.stageSongAdded', { title: song.title }) : t('karaoke.guide.queueFull')
  if (queued(song.id)) selected.value.delete(song.id)
}
async function sing(song: Song) {
  if (busy.value || player.partyAudioOwned) return
  busy.value = true; notice.value = ''
  try {
    player.setKaraokeMode(true)
    player.removeQueuedSong(song.id)
    await player.playSong(song, availableSongs.value, availableSongs.value.findIndex(item => item.id === song.id))
  } catch { notice.value = t('karaoke.guide.songUnavailable') }
  finally { busy.value = false }
}
function changePage(direction: number) {
  page.value += direction
  searchInput.value?.closest('section')?.scrollTo({ top: 0 })
}
async function loadSongs() {
  loading.value = true; loadFailed.value = false
  try {
    await Promise.all([songs.songs.length ? Promise.resolve() : songs.fetchSongs(), karaokeService.ensureLoaded()])
    loadFailed.value = !!songs.error && !songs.songs.length
  }
  catch { loadFailed.value = true }
  finally { loading.value = false }
}
onMounted(() => { searchInput.value?.focus(); void loadSongs() })
</script>

<style scoped>
.stage-song-picker { color: #f8fafc; }
.picker-header, .picker-results-header, .picker-actions, .picker-pagination { display: flex; align-items: center; gap: 12px; }
.picker-header, .picker-results-header, .picker-pagination { justify-content: space-between; flex-wrap: wrap; }
.picker-header h2 { font-size: 20px; font-weight: 700; }
.picker-search { display: block; margin: 16px 0; font-size: 13px; }
.picker-search input { display: block; width: 100%; min-height: 44px; margin-top: 8px; padding: 10px 12px; background: #ffffff0d; border: 1px solid #56716b; border-radius: 10px; color: #fff; }
.picker-results-header, .picker-song-info { font-size: 12px; color: #b6cdc5; }
.picker-notice { color: #7ef0b6; }
.picker-list { margin-top: 12px; }
.picker-list li { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 14px 0; border-top: 1px solid #38534f; }
.picker-cover { width: 44px; height: 44px; border-radius: 6px; overflow: hidden; flex-shrink: 0; }
.picker-select { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex-shrink: 0; cursor: pointer; }
.picker-select input { width: 20px; height: 20px; accent-color: #1db954; }
.picker-song { min-width: 0; flex: 1; overflow-wrap: anywhere; }
.picker-song-info { margin-top: 4px; }
.is-current .picker-song > p:first-child { color: #7ef0b6; }
.picker-actions { flex-wrap: wrap; }
.picker-pagination { margin-top: 16px; font-size: 12px; }
.picker-empty { padding: 24px 0; color: #b6cdc5; }
button { min-height: 44px; padding: 8px 12px; border: 1px solid #56716b; border-radius: 8px; font-size: 12px; }
button:disabled { opacity: .4; }
button:not(:disabled):hover { background: #ffffff15; }
button:focus-visible, input:focus-visible { outline: 2px solid #ffe0a4; outline-offset: 2px; }
@media (max-width: 600px) { .picker-actions { width: 100%; } .picker-header h2 { font-size: 16px; } }
</style>
