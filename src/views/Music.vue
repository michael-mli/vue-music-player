<template>
  <div class="music-view h-full overflow-y-auto spotify-scrollbar">
    <div class="p-4 sm:p-6">
      <!-- Loading state -->
      <div v-if="loading" class="text-center text-spotify-green mt-8">
        <div class="flex flex-col items-center">
          <div class="flex items-center mb-4">
            <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-spotify-green" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Loading song...
          </div>
        </div>
      </div>

      <!-- Song found and playing -->
      <div v-else-if="currentSong" class="text-center">
        <h1 class="text-3xl font-bold text-light-text-primary dark:text-white mb-2">
          Now Playing
        </h1>
        <div class="max-w-md mx-auto bg-light-card dark:bg-spotify-dark rounded-lg p-6 mb-6">
          <div class="w-32 h-32 bg-light-border dark:bg-spotify-light rounded-lg mx-auto mb-4 flex items-center justify-center">
            <MusicalNoteIcon class="w-16 h-16 text-gray-400" />
          </div>
          <h2 class="text-xl font-bold text-light-text-primary dark:text-white mb-2">{{ currentSong.title }}</h2>
          <p class="text-light-text-secondary dark:text-gray-400">Song ID: {{ currentSong.id }}</p>
        </div>
        
        <div class="flex justify-center space-x-4">
          <button 
            @click="$router.push('/library')"
            class="btn-secondary"
          >
            Go to Library
          </button>
          <button 
            @click="$router.push('/')"
            class="btn-primary"
          >
            Go to Home
          </button>
        </div>
      </div>

      <!-- Song not found -->
      <div v-else-if="error" class="text-center text-light-text-secondary dark:text-gray-400 mt-12">
        <h1 class="text-2xl font-bold mb-4">Song Not Found</h1>
        <p class="mb-4">{{ error }}</p>
        <div class="flex justify-center space-x-4">
          <button 
            @click="$router.push('/library')"
            class="btn-secondary"
          >
            Browse Library
          </button>
          <button 
            @click="$router.push('/')"
            class="btn-primary"
          >
            Go to Home
          </button>
        </div>
      </div>

      <!-- No song parameter -->
      <div v-else class="text-center text-light-text-secondary dark:text-gray-400 mt-12">
        <h1 class="text-2xl font-bold mb-4">Music Player</h1>
        <p class="mb-4">Use ?song=ID to play a specific song</p>
        <p class="text-sm mb-6">Example: /music/?song=124</p>
        <div class="flex justify-center space-x-4">
          <button 
            @click="$router.push('/library')"
            class="btn-secondary"
          >
            Browse Library
          </button>
          <button 
            @click="$router.push('/')"
            class="btn-primary"
          >
            Go to Home
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { MusicalNoteIcon } from '@heroicons/vue/24/outline'
import { usePlayerStore } from '@/stores/player'
import { useSongsStore } from '@/stores/songs'
import type { Song } from '@/types'

const route = useRoute()
const playerStore = usePlayerStore()
const songsStore = useSongsStore()

const loading = ref(false)
const error = ref('')

const currentSong = computed(() => playerStore.currentSong)

onMounted(async () => {
  const songIdParam = route.query.song as string
  
  if (songIdParam) {
    loading.value = true
    error.value = ''
    
    try {
      const songId = parseInt(songIdParam)
      
      if (isNaN(songId)) {
        error.value = 'Invalid song ID. Please provide a valid number.'
        return
      }

      // Wait for songs to be loaded
      if (songsStore.songs.length === 0) {
        await songsStore.fetchSongs()
      }

      // Find the song
      const song = songsStore.songs.find(s => s.id === songId)
      
      if (song) {
        // Play the song with the full songs list as queue
        const songIndex = songsStore.songs.findIndex(s => s.id === songId)
        await playerStore.playSong(song, songsStore.songs, songIndex)
        console.log(`Playing song from URL: ${song.title} (ID: ${songId})`)
      } else {
        error.value = `Song with ID ${songId} not found. Please check the song ID and try again.`
      }
    } catch (err) {
      console.error('Error loading song:', err)
      error.value = 'Failed to load the song. Please try again.'
    } finally {
      loading.value = false
    }
  }
})
</script>