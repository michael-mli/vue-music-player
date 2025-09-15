<template>
  <aside class="w-full lg:w-80 bg-light-card dark:bg-spotify-dark border-l border-light-border dark:border-spotify-light flex flex-col">
    <div class="p-4 border-b border-light-border dark:border-spotify-light flex items-center justify-between">
      <h2 class="text-lg font-bold text-light-text-primary dark:text-white">{{ $t('lyrics.title') }}</h2>
      <button 
        @click="$emit('close')"
        class="lg:hidden p-1 rounded-full text-light-text-secondary dark:text-gray-400 hover:text-light-text-primary dark:hover:text-white transition-colors duration-200"
        aria-label="Close lyrics"
      >
        <XMarkIcon class="w-5 h-5" />
      </button>
    </div>
    
    <div class="flex-1 overflow-y-auto spotify-scrollbar p-4 pb-8 lg:pb-4">
      <div v-if="loading" class="text-center text-light-text-secondary dark:text-gray-400">
        {{ $t('lyrics.loading') }}
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
import { ref, computed, watch, reactive } from 'vue'
import { XMarkIcon } from '@heroicons/vue/24/outline'
import { usePlayerStore } from '@/stores/player'
import { useSongsStore } from '@/stores/songs'
import ImageModal from '@/components/UI/ImageModal.vue'
import { processLyricsContent } from '@/utils/htmlSanitizer'

// Define emits
defineEmits<{
  close: []
}>()

const playerStore = usePlayerStore()
const songsStore = useSongsStore()

const lyrics = ref('')
const loading = ref(false)

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
  
  // Use the utility function to process lyrics content
  return processLyricsContent(lyrics.value)
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
  } else {
    lyrics.value = ''
  }
}, { immediate: true })
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