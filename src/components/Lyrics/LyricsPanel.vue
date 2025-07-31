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
      
      <div v-else-if="lyrics" class="text-light-text-primary dark:text-white leading-relaxed whitespace-pre-line">
        {{ lyrics }}
      </div>
      
      <div v-else class="text-center text-light-text-secondary dark:text-gray-400">
        {{ $t('lyrics.noLyrics') }}
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { XMarkIcon } from '@heroicons/vue/24/outline'
import { usePlayerStore } from '@/stores/player'
import { useSongsStore } from '@/stores/songs'

// Define emits
defineEmits<{
  close: []
}>()

const playerStore = usePlayerStore()
const songsStore = useSongsStore()

const lyrics = ref('')
const loading = ref(false)

const currentSong = computed(() => playerStore.currentSong)

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