<template>
  <div class="karaoke-view h-full overflow-y-auto spotify-scrollbar">
    <div class="p-4 sm:p-6">
      <!-- Header -->
      <div class="flex items-center gap-3 mb-2">
        <MicrophoneIcon class="w-8 h-8 text-spotify-green" />
        <h1 class="text-3xl font-bold text-light-text-primary dark:text-white">{{ $t('navigation.karaoke') }}</h1>
      </div>
      <p class="text-light-text-secondary dark:text-gray-400 mb-6">{{ $t('karaoke.subtitle') }}</p>

      <!-- Karaoke mode banner / toggle -->
      <div
        class="flex items-center justify-between p-4 mb-6 rounded-lg border"
        :class="karaokeMode
          ? 'bg-spotify-green/10 border-spotify-green/40'
          : 'bg-light-card dark:bg-spotify-dark border-light-border dark:border-spotify-light'"
      >
        <div class="flex items-center gap-3">
          <MicrophoneIcon class="w-5 h-5" :class="karaokeMode ? 'text-spotify-green' : 'text-gray-400'" />
          <div>
            <p class="text-sm font-medium text-light-text-primary dark:text-white">
              {{ karaokeMode ? $t('karaoke.modeOn') : $t('karaoke.modeOff') }}
            </p>
            <p class="text-xs text-light-text-secondary dark:text-gray-400">{{ $t('karaoke.modeHint') }}</p>
          </div>
        </div>
        <button
          @click="playerStore.setKaraokeMode(!karaokeMode)"
          class="px-3 py-1.5 rounded-full text-sm font-medium transition-colors duration-200"
          :class="karaokeMode
            ? 'bg-spotify-green text-black hover:bg-spotify-green/80'
            : 'bg-white/10 text-light-text-primary dark:text-white hover:bg-white/20'"
        >
          {{ karaokeMode ? $t('karaoke.turnOff') : $t('karaoke.turnOn') }}
        </button>
      </div>

      <!-- Mic monitor (sing into your microphone and hear yourself) -->
      <div
        v-if="mic.supported"
        class="p-4 mb-6 rounded-lg border"
        :class="mic.active.value
          ? 'bg-spotify-green/10 border-spotify-green/40'
          : 'bg-light-card dark:bg-spotify-dark border-light-border dark:border-spotify-light'"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <MicrophoneIcon class="w-5 h-5" :class="mic.active.value ? 'text-spotify-green' : 'text-gray-400'" />
            <div>
              <p class="text-sm font-medium text-light-text-primary dark:text-white">
                {{ mic.active.value ? $t('karaoke.micOn') : $t('karaoke.micOff') }}
              </p>
              <p class="text-xs text-light-text-secondary dark:text-gray-400">⚠️ {{ $t('karaoke.micHint') }}</p>
            </div>
          </div>
          <button
            @click="mic.toggle()"
            :disabled="mic.starting.value"
            class="px-3 py-1.5 rounded-full text-sm font-medium transition-colors duration-200 disabled:opacity-50"
            :class="mic.active.value
              ? 'bg-spotify-green text-black hover:bg-spotify-green/80'
              : 'bg-white/10 text-light-text-primary dark:text-white hover:bg-white/20'"
          >
            {{ mic.active.value ? $t('karaoke.micStop') : $t('karaoke.micStart') }}
          </button>
        </div>

        <!-- Mic level + reverb -->
        <div v-if="mic.active.value" class="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label class="text-xs text-light-text-secondary dark:text-gray-400">
            {{ $t('karaoke.micVolume') }}
            <input
              type="range" min="0" max="1.5" step="0.05" :value="mic.gain.value"
              @input="mic.setGain(+($event.target as HTMLInputElement).value)"
              class="w-full accent-spotify-green"
            />
          </label>
          <label class="text-xs text-light-text-secondary dark:text-gray-400">
            {{ $t('karaoke.micReverb') }}
            <input
              type="range" min="0" max="0.8" step="0.05" :value="mic.reverb.value"
              @input="mic.setReverb(+($event.target as HTMLInputElement).value)"
              class="w-full accent-spotify-green"
            />
          </label>
        </div>

        <p v-if="mic.error.value" class="mt-3 text-xs text-red-400">
          {{ $t(`karaoke.mic_${mic.error.value}`) }}
        </p>
      </div>

      <!-- Now-singing lyrics stage -->
      <div
        v-if="currentSong"
        class="mb-8 rounded-xl bg-gradient-to-b from-light-card to-light-bg dark:from-spotify-dark dark:to-spotify-black border border-light-border dark:border-spotify-light p-5"
      >
        <div class="flex items-center gap-3 mb-4">
          <div class="w-12 h-12 rounded overflow-hidden flex-shrink-0 bg-light-border dark:bg-spotify-light">
            <SongCover :song-id="currentSong.id" :alt="currentSong.title" />
          </div>
          <div class="min-w-0">
            <p class="text-lg font-bold text-light-text-primary dark:text-white truncate">{{ currentSong.title }}</p>
            <p class="text-xs text-light-text-secondary dark:text-gray-400">
              <span v-if="syncedLines.length" class="text-spotify-green">♪ {{ $t('lyrics.synced') }}</span>
              <span v-else>{{ karaokeMode && karaokeAvailable ? $t('karaoke.modeOn') : '' }}</span>
            </p>
          </div>

          <!-- Quick switch: instrumental (karaoke) vs original (with vocals). Swaps live. -->
          <div
            v-if="karaokeAvailable"
            class="ml-auto flex rounded-full bg-light-bg dark:bg-spotify-black border border-light-border dark:border-spotify-light p-0.5 text-xs font-medium flex-shrink-0"
          >
            <button
              @click="switchMode(true)"
              class="px-3 py-1.5 rounded-full transition-colors duration-200"
              :class="karaokeMode ? 'bg-spotify-green text-black' : 'text-light-text-secondary dark:text-gray-400 hover:text-light-text-primary dark:hover:text-white'"
            >{{ $t('karaoke.switchKaraoke') }}</button>
            <button
              @click="switchMode(false)"
              class="px-3 py-1.5 rounded-full transition-colors duration-200"
              :class="!karaokeMode ? 'bg-spotify-green text-black' : 'text-light-text-secondary dark:text-gray-400 hover:text-light-text-primary dark:hover:text-white'"
            >{{ $t('karaoke.switchOriginal') }}</button>
          </div>
        </div>

        <!-- Synced lyrics: line-by-line highlight, click to seek -->
        <div
          v-if="syncedLines.length"
          ref="lyricsBox"
          class="h-56 overflow-y-auto spotify-scrollbar text-center space-y-3 py-12"
        >
          <p
            v-for="(line, i) in syncedLines"
            :key="i"
            :data-kline="i"
            @click="playerStore.seek(line.time)"
            class="cursor-pointer transition-all duration-200"
            :class="i === activeIndex
              ? 'text-spotify-green font-bold text-2xl'
              : 'text-light-text-secondary dark:text-gray-500 text-lg hover:text-light-text-primary dark:hover:text-gray-300'"
          >{{ line.text || '♪' }}</p>
        </div>

        <!-- Plain lyrics fallback -->
        <div
          v-else-if="plainLyrics"
          class="h-56 overflow-y-auto spotify-scrollbar text-center text-light-text-secondary dark:text-gray-300 whitespace-pre-line leading-relaxed py-4"
        >{{ plainLyrics }}</div>

        <div v-else class="h-56 flex items-center justify-center text-light-text-secondary dark:text-gray-400 text-sm text-center px-4">
          {{ lyricsLoading ? $t('lyrics.loading') : $t('karaoke.noSynced') }}
        </div>

        <!-- Record your performance (mic + instrumental -> MP3) -->
        <div v-if="recorder.supported.value && karaokeAvailable" class="mt-4 pt-4 border-t border-light-border dark:border-spotify-light">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div class="flex items-center gap-2 text-xs text-light-text-secondary dark:text-gray-400">
              <span
                v-if="recorder.recording.value"
                class="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"
              ></span>
              <span>{{ recorder.recording.value ? $t('karaoke.recording', { time: recElapsed }) : $t('karaoke.recordHint') }}</span>
            </div>
            <button
              @click="toggleRecord"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors duration-200"
              :class="recorder.recording.value
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-white/10 text-light-text-primary dark:text-white hover:bg-white/20'"
            >
              <span class="inline-block w-2.5 h-2.5 rounded-full" :class="recorder.recording.value ? 'bg-white' : 'bg-red-500'"></span>
              {{ recorder.recording.value ? $t('karaoke.recordStop') : $t('karaoke.record') }}
            </button>
          </div>

          <p v-if="recorder.error.value" class="mt-2 text-xs text-red-400">
            {{ $t(`karaoke.record_${recorder.error.value}`) }}
          </p>

          <!-- Finished recording: play + download -->
          <div v-if="recorder.resultUrl.value && !recorder.recording.value" class="mt-3 flex items-center gap-3 flex-wrap">
            <audio :src="recorder.resultUrl.value" controls class="h-9 max-w-full"></audio>
            <a
              :href="recorder.resultUrl.value"
              :download="recorder.resultName.value"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-spotify-green text-black text-sm font-medium hover:bg-spotify-green/80"
            >
              <ArrowDownTrayIcon class="w-4 h-4" />
              {{ $t('karaoke.recordDownload') }}
            </a>
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="!manifestReady" class="text-center text-light-text-secondary dark:text-gray-400 py-12">
        {{ $t('karaoke.loading') }}
      </div>

      <!-- Empty state -->
      <div
        v-else-if="availableSongs.length === 0"
        class="text-center text-light-text-secondary dark:text-gray-400 py-12"
      >
        <MicrophoneIcon class="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>{{ $t('karaoke.empty') }}</p>
      </div>

      <!-- Available songs -->
      <template v-else>
        <p class="text-light-text-secondary dark:text-gray-400 mb-4 text-sm">
          {{ $t('karaoke.available', { count: availableSongs.length }) }}
        </p>
        <div class="space-y-2">
          <div
            v-for="(song, index) in availableSongs"
            :key="song.id"
            @click="sing(song, index)"
            class="flex items-center p-3 rounded-lg hover:bg-light-border dark:hover:bg-spotify-light cursor-pointer group transition-colors duration-200"
            :class="{ 'bg-light-border dark:bg-spotify-light': currentSongId === song.id }"
          >
            <div class="w-8 text-center mr-4">
              <span class="text-light-text-secondary dark:text-gray-400 text-sm">{{ song.id }}</span>
            </div>
            <div class="w-10 h-10 bg-light-border dark:bg-spotify-dark rounded mr-3 overflow-hidden flex-shrink-0">
              <SongCover :song-id="song.id" :alt="song.title" />
            </div>
            <div class="flex-1 min-w-0">
              <p
                class="font-medium break-words"
                :class="currentSongId === song.id ? 'text-spotify-green' : 'text-light-text-primary dark:text-white'"
              >{{ song.title }}</p>
              <p class="text-light-text-secondary dark:text-gray-400 text-sm">{{ formatDuration(song.duration) }}</p>
            </div>
            <button
              @click.stop="sing(song, index)"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-spotify-green text-black text-sm font-medium opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 hover:bg-spotify-green/80"
              :title="$t('karaoke.sing')"
            >
              <MicrophoneIcon class="w-4 h-4" />
              {{ $t('karaoke.sing') }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { MicrophoneIcon, ArrowDownTrayIcon } from '@heroicons/vue/24/outline'
import SongCover from '@/components/UI/SongCover.vue'
import { usePlayerStore } from '@/stores/player'
import { useSongsStore } from '@/stores/songs'
import { karaokeService } from '@/services/karaokeService'
import { lyricsService, activeLineIndex } from '@/services/lyricsService'
import { songService } from '@/services/songService'
import { useMicMonitor } from '@/composables/useMicMonitor'
import { useKaraokeRecorder } from '@/composables/useKaraokeRecorder'
import { getInstrumentalUrl } from '@/config'
import type { LyricLine, Song } from '@/types'

const playerStore = usePlayerStore()
const songsStore = useSongsStore()
const mic = useMicMonitor()
const recorder = useKaraokeRecorder()

const recElapsed = computed(() => {
  const s = recorder.elapsed.value
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
})

function toggleRecord() {
  const song = playerStore.currentSong
  if (!song) return
  if (recorder.recording.value) {
    const safe = (song.title || `song-${song.id}`).replace(/[^\p{L}\p{N} _-]/gu, '').trim() || `song-${song.id}`
    recorder.stop(`karaoke-${safe}.mp3`)
  } else {
    recorder.start({
      instrumentalUrl: getInstrumentalUrl(song.id),
      positionSec: playerStore.currentTime,
      getPosition: () => playerStore.currentTime,
      name: `karaoke-${song.id}.mp3`,
    })
  }
}

const manifestReady = ref(false)

// Now-singing lyrics state
const syncedLines = ref<LyricLine[]>([])
const plainLyrics = ref('')
const activeIndex = ref(-1)
const lyricsLoading = ref(false)
const lyricsBox = ref<HTMLElement>()

const karaokeMode = computed(() => playerStore.karaokeMode)
const karaokeAvailable = computed(() => playerStore.karaokeAvailable)
const currentSong = computed(() => playerStore.currentSong)
const currentSongId = computed(() => playerStore.currentSong?.id)

const availableSongs = computed<Song[]>(() => {
  void manifestReady.value
  return songsStore.songs.filter((s) => karaokeService.isAvailable(s.id))
})

// Load lyrics (synced + plain fallback) for whatever song is currently playing.
watch(currentSong, async (song) => {
  syncedLines.value = []
  plainLyrics.value = ''
  activeIndex.value = -1
  if (!song) return
  lyricsLoading.value = true
  const reqId = song.id
  try {
    const duration = playerStore.duration > 0
      ? playerStore.duration
      : songService.getCachedDuration(song.id)
    const [lines, plain] = await Promise.all([
      lyricsService.getSyncedLyrics(song, duration),
      songsStore.getSongLyrics(song.id).catch(() => ''),
    ])
    if (playerStore.currentSong?.id !== reqId) return
    syncedLines.value = lines ?? []
    plainLyrics.value = plain ?? ''
    if (lines) activeIndex.value = activeLineIndex(lines, playerStore.currentTime)
  } finally {
    if (playerStore.currentSong?.id === reqId) lyricsLoading.value = false
  }
}, { immediate: true })

// Highlight + center the active synced line as playback advances.
watch(() => playerStore.currentTime, (t) => {
  if (!syncedLines.value.length) return
  const idx = activeLineIndex(syncedLines.value, t + 0.2)
  if (idx !== activeIndex.value) {
    activeIndex.value = idx
    const el = lyricsBox.value?.querySelector(`[data-kline="${idx}"]`) as HTMLElement | null
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
})

onMounted(async () => {
  if (songsStore.songs.length === 0) {
    await songsStore.fetchSongs()
  }
  await karaokeService.ensureLoaded()
  manifestReady.value = true

  // Fill in real titles for the (small) set of karaoke-ready songs that still show a placeholder.
  for (const song of availableSongs.value) {
    if (song.title.startsWith('Song ')) {
      const title = await songService.getTitleFromLyrics(song.id)
      if (title && !title.startsWith('Song ')) song.title = title
    }
  }
})

async function sing(song: Song, index: number) {
  playerStore.setKaraokeMode(true) // ensure the instrumental loads from the start
  await playerStore.playSong(song, availableSongs.value, index)
}

// Switch the currently-playing song between instrumental (karaoke) and original (vocals),
// live — toggleKaraoke preserves playback position and play/pause state.
function switchMode(toKaraoke: boolean) {
  if (toKaraoke !== karaokeMode.value) playerStore.toggleKaraoke()
}

function formatDuration(duration?: number): string {
  if (!duration) return '—'
  const minutes = Math.floor(duration / 60)
  const seconds = Math.floor(duration % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
</script>
