<template>
  <aside class="w-full lg:w-80 bg-light-card dark:bg-spotify-dark border-l border-light-border dark:border-spotify-light flex flex-col">
    <div class="p-4 border-b border-light-border dark:border-spotify-light flex items-center justify-between">
      <h2 class="text-lg font-bold text-light-text-primary dark:text-white flex items-center gap-2">
        {{ $t('lyrics.title') }}
        <span
          v-if="syncedLines && syncedLines.length"
          class="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-spotify-green/20 text-spotify-green"
        >{{ $t('lyrics.synced') }}</span>
      </h2>
      <div class="flex items-center gap-2">
        <!-- Auto-scroll toggle -->
        <button 
          @click="toggleAutoScroll"
          class="p-1 rounded-full transition-colors duration-200"
          :class="autoScroll 
            ? 'text-spotify-green hover:text-green-400' 
            : 'text-light-text-secondary dark:text-gray-400 hover:text-light-text-primary dark:hover:text-white'"
          :title="autoScroll ? $t('lyrics.scrollOn') : $t('lyrics.scrollOff')"
        >
          <ArrowsUpDownIcon class="w-5 h-5" />
        </button>
        <button 
          @click="$emit('close')"
          class="lg:hidden p-1 rounded-full text-light-text-secondary dark:text-gray-400 hover:text-light-text-primary dark:hover:text-white transition-colors duration-200"
          aria-label="Close lyrics"
        >
          <XMarkIcon class="w-5 h-5" />
        </button>
      </div>
    </div>
    
    <div 
      ref="scrollContainer"
      class="flex-1 overflow-y-auto spotify-scrollbar p-4 pb-8 lg:pb-4"
      @scroll="onUserScroll"
      @touchstart="onUserInteract"
      @mousedown="onUserInteract"
    >
      <div v-if="loading" class="text-center text-light-text-secondary dark:text-gray-400">
        {{ $t('lyrics.loading') }}
      </div>

      <!-- Synced (karaoke-style) lyrics: line-by-line with active highlight + click-to-seek -->
      <div v-else-if="syncedLines && syncedLines.length" class="synced-lyrics space-y-2">
        <p
          v-for="(line, i) in syncedLines"
          :key="i"
          :data-line="i"
          @click="seekToLine(line)"
          :class="[
            'cursor-pointer transition-all duration-200 leading-snug',
            i === activeIndex
              ? 'text-spotify-green font-semibold text-lg'
              : 'text-light-text-secondary dark:text-gray-400 hover:text-light-text-primary dark:hover:text-white'
          ]"
        >{{ line.text || '♪' }}</p>
      </div>

      <div
        v-else-if="lyrics"
        class="text-light-text-primary dark:text-white leading-relaxed whitespace-pre-line lyrics-content"
        v-html="processedLyrics"
        @click="handleLyricsClick"
      ></div>

      <div v-else class="text-center text-light-text-secondary dark:text-gray-400">
        {{ $t('lyrics.noLyrics') }}
      </div>
    </div>
    
    <!-- Image Modal -->
    <ImageModal
      :is-open="imageModal.isOpen"
      :image-src="imageModal.src"
      :image-alt="imageModal.alt"
      :image-title="imageModal.title"
      @close="closeImageModal"
    />
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, watch, reactive, onUnmounted } from 'vue'
import { XMarkIcon, ArrowsUpDownIcon } from '@heroicons/vue/24/outline'
import { usePlayerStore } from '@/stores/player'
import { useSongsStore } from '@/stores/songs'
import ImageModal from '@/components/UI/ImageModal.vue'
import { processLyricsContent } from '@/utils/htmlSanitizer'
import { lyricsService, activeLineIndex } from '@/services/lyricsService'
import { songService } from '@/services/songService'
import type { LyricLine } from '@/types'

// Define emits
defineEmits<{
  close: []
}>()

const playerStore = usePlayerStore()
const songsStore = useSongsStore()

const lyrics = ref('')
const loading = ref(false)
const scrollContainer = ref<HTMLElement>()

// Synced lyrics (LRCLIB). When present, we render the line-by-line karaoke view instead
// of the plain-text view, and highlight the active line driven by playback time.
const syncedLines = ref<LyricLine[] | null>(null)
const activeIndex = ref(-1)

// Auto-scroll state
const autoScroll = ref(localStorage.getItem('lyrics-auto-scroll') !== 'false')
let userScrolling = false
let userScrollTimeout: number | null = null

const currentSong = computed(() => playerStore.currentSong)

// Image modal state
const imageModal = reactive({
  isOpen: false,
  src: '',
  alt: '',
  title: ''
})

// Process lyrics to handle HTML tags safely
const processedLyrics = computed(() => {
  if (!lyrics.value) return ''
  return processLyricsContent(lyrics.value)
})

function toggleAutoScroll() {
  autoScroll.value = !autoScroll.value
  localStorage.setItem('lyrics-auto-scroll', String(autoScroll.value))
  userScrolling = false
}

// Pause auto-scroll briefly when user manually scrolls
function onUserInteract() {
  if (!autoScroll.value) return
  userScrolling = true
  if (userScrollTimeout) clearTimeout(userScrollTimeout)
  userScrollTimeout = window.setTimeout(() => { userScrolling = false }, 5000)
}

function onUserScroll() {
  // Only mark as user-scrolling if triggered by user interaction (not programmatic)
  // We use the userScrolling flag set by touch/mousedown
}

// Drive synced-line highlighting / fall back to proportional auto-scroll for plain lyrics.
watch(() => playerStore.currentTime, (t) => {
  // Synced mode: highlight the active line and keep it centered.
  if (syncedLines.value && syncedLines.value.length) {
    // Small lookahead so the highlight lands on the line as it's sung, not just after.
    const idx = activeLineIndex(syncedLines.value, t + 0.2)
    if (idx !== activeIndex.value) {
      activeIndex.value = idx
      scrollActiveLineIntoView()
    }
    return
  }

  // Plain mode: move proportionally through lyrics based on playback progress.
  if (!autoScroll.value || userScrolling || !scrollContainer.value || !lyrics.value) return
  if (!playerStore.isPlaying || playerStore.duration <= 0) return

  const progress = playerStore.currentTime / playerStore.duration
  const el = scrollContainer.value
  const maxScroll = el.scrollHeight - el.clientHeight
  if (maxScroll <= 0) return

  const targetScroll = progress * maxScroll
  el.scrollTo({ top: targetScroll, behavior: 'smooth' })
})

// Center the active synced line in the scroll viewport (unless the user is scrolling).
function scrollActiveLineIntoView() {
  if (!autoScroll.value || userScrolling || !scrollContainer.value || activeIndex.value < 0) return
  const el = scrollContainer.value.querySelector(
    `[data-line="${activeIndex.value}"]`
  ) as HTMLElement | null
  if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

// Clicking a synced line seeks playback to that line's timestamp.
function seekToLine(line: LyricLine) {
  playerStore.seek(line.time)
}

// Reset scroll position and synced-lyric state when song changes
watch(currentSong, () => {
  userScrolling = false
  syncedLines.value = null
  activeIndex.value = -1
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = 0
  }
})

// Handle clicks on lyrics content (specifically for images)
function handleLyricsClick(event: Event) {
  const target = event.target as HTMLElement
  
  if (target.tagName === 'IMG' && target.classList.contains('lyrics-image')) {
    const img = target as HTMLImageElement
    
    imageModal.src = img.src
    imageModal.alt = img.alt || 'Lyrics image'
    imageModal.title = img.title || img.alt || 'Lyrics image'
    imageModal.isOpen = true
  }
}

// Close image modal
function closeImageModal() {
  imageModal.isOpen = false
}

watch(currentSong, async (newSong) => {
  if (newSong) {
    loading.value = true
    try {
      lyrics.value = await songsStore.getSongLyrics(newSong.id)
    } catch (error) {
      lyrics.value = ''
    } finally {
      loading.value = false
    }

    // Best-effort: fetch time-synced lyrics from LRCLIB. Runs after the plain lyrics so the
    // panel shows something immediately; if synced lyrics arrive (and the song hasn't
    // changed), the view upgrades to the karaoke line-by-line mode.
    const requestedId = newSong.id
    try {
      const duration = playerStore.duration > 0
        ? playerStore.duration
        : songService.getCachedDuration(newSong.id)
      const lines = await lyricsService.getSyncedLyrics(newSong, duration)
      if (currentSong.value?.id === requestedId) {
        syncedLines.value = lines
        activeIndex.value = lines
          ? activeLineIndex(lines, playerStore.currentTime)
          : -1
      }
    } catch {
      /* keep plain lyrics */
    }
  } else {
    lyrics.value = ''
    syncedLines.value = null
    activeIndex.value = -1
  }
}, { immediate: true })

onUnmounted(() => {
  if (userScrollTimeout) clearTimeout(userScrollTimeout)
})
</script>

<style scoped>
.lyrics-content {
  word-wrap: break-word;
  overflow-wrap: break-word;
}

/* Image styling within lyrics */
.lyrics-content :deep(.lyrics-image) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 12px 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  cursor: pointer;
  display: block;
}

.lyrics-content :deep(.lyrics-image:hover) {
  transform: scale(1.02);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

/* Dark mode adjustments for images */
.dark .lyrics-content :deep(.lyrics-image) {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.dark .lyrics-content :deep(.lyrics-image:hover) {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  border-color: rgba(255, 255, 255, 0.2);
}

/* Error handling for broken images */
.lyrics-content :deep(.lyrics-image) {
  background: linear-gradient(45deg, #f0f0f0 25%, transparent 25%), 
              linear-gradient(-45deg, #f0f0f0 25%, transparent 25%), 
              linear-gradient(45deg, transparent 75%, #f0f0f0 75%), 
              linear-gradient(-45deg, transparent 75%, #f0f0f0 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
  min-height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.dark .lyrics-content :deep(.lyrics-image) {
  background: linear-gradient(45deg, #2a2a2a 25%, transparent 25%), 
              linear-gradient(-45deg, #2a2a2a 25%, transparent 25%), 
              linear-gradient(45deg, transparent 75%, #2a2a2a 75%), 
              linear-gradient(-45deg, transparent 75%, #2a2a2a 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
}

/* Image loading state */
.lyrics-content :deep(.lyrics-image[loading]) {
  opacity: 0.7;
  filter: blur(2px);
  transition: opacity 0.3s ease, filter 0.3s ease;
}

.lyrics-content :deep(.lyrics-image[loading="lazy"]:not([src])) {
  background-color: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
}

.dark .lyrics-content :deep(.lyrics-image[loading="lazy"]:not([src])) {
  background-color: #2a2a2a;
}

/* Text formatting support within lyrics */
.lyrics-content :deep(b), 
.lyrics-content :deep(strong) {
  font-weight: 600;
}

.lyrics-content :deep(i), 
.lyrics-content :deep(em) {
  font-style: italic;
}

.lyrics-content :deep(u) {
  text-decoration: underline;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .lyrics-content :deep(.lyrics-image) {
    margin: 8px 0;
    border-radius: 6px;
  }
}
</style>