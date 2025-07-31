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
            {{ loadingMessage }}
          </div>
        </div>
      </div>

      <!-- Song found and playing -->
      <div v-else-if="currentSong" class="text-center">
        <h1 class="text-3xl font-bold text-light-text-primary dark:text-white mb-2">
          {{ t('music.nowPlaying') }}
        </h1>
        <div class="max-w-md mx-auto bg-light-card dark:bg-spotify-dark rounded-lg p-6 mb-6">
          <div class="w-32 h-32 bg-light-border dark:bg-spotify-light rounded-lg mx-auto mb-4 flex items-center justify-center">
            <MusicalNoteIcon class="w-16 h-16 text-gray-400" />
          </div>
          <h2 class="text-xl font-bold text-light-text-primary dark:text-white mb-2">{{ currentSong.title }}</h2>
          <p class="text-light-text-secondary dark:text-gray-400">{{ t('music.songId') }}: {{ currentSong.id }}</p>
        </div>
        
        <div class="flex justify-center space-x-4">
          <button 
            @click="$router.push('/library')"
            class="btn-secondary"
          >
            {{ t('music.goToLibrary') }}
          </button>
          <button 
            @click="$router.push('/')"
            class="btn-primary"
          >
            {{ t('music.goToHome') }}
          </button>
        </div>
      </div>

      <!-- Song not found -->
      <div v-else-if="error" class="text-center text-light-text-secondary dark:text-gray-400 mt-12">
        <h1 class="text-2xl font-bold mb-4">{{ t('music.songNotFound') }}</h1>
        <p class="mb-4">{{ error }}</p>
        <div class="flex justify-center space-x-4">
          <button 
            @click="$router.push('/library')"
            class="btn-secondary"
          >
            {{ t('music.browseLibrary') }}
          </button>
          <button 
            @click="$router.push('/')"
            class="btn-primary"
          >
            {{ t('music.goToHome') }}
          </button>
        </div>
      </div>

      <!-- No song parameter -->
      <div v-else class="text-center text-light-text-secondary dark:text-gray-400 mt-12">
        <h1 class="text-2xl font-bold mb-4">{{ t('music.musicPlayer') }}</h1>
        <p class="mb-4">{{ t('music.useSongId') }}</p>
        <p class="text-sm mb-6">{{ t('music.example') }}</p>
        <div class="flex justify-center space-x-4">
          <button 
            @click="$router.push('/library')"
            class="btn-secondary"
          >
            {{ t('music.browseLibrary') }}
          </button>
          <button 
            @click="$router.push('/')"
            class="btn-primary"
          >
            {{ t('music.goToHome') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MusicalNoteIcon } from '@heroicons/vue/24/outline'
import { usePlayerStore } from '@/stores/player'
import { useSongsStore } from '@/stores/songs'
import type { Song } from '@/types'

const route = useRoute()
const playerStore = usePlayerStore()
const songsStore = useSongsStore()
const { t } = useI18n()

const loading = ref(false)
const loadingMessage = ref('')
const error = ref('')

const currentSong = computed(() => playerStore.currentSong)

onMounted(async () => {
  const songIdParam = route.query.song as string
  
  if (songIdParam) {
    loading.value = true
    error.value = ''
    loadingMessage.value = t('music.loadingSong')
    
    try {
      const songId = parseInt(songIdParam)
      
      if (isNaN(songId)) {
        error.value = t('music.invalidSongId')
        loading.value = false
        return
      }

      // Wait for songs to be loaded if they haven't been loaded yet
      if (songsStore.songs.length === 0) {
        loadingMessage.value = t('music.loadingLibrary')
        console.log('Loading songs library...')
        await songsStore.fetchSongs()
      }

      loadingMessage.value = t('music.searchingSong')
      console.log(`Searching for song with ID: ${songId}`)
      
      // First try to find the song in the already loaded songs
      let song = songsStore.songs.find(s => s.id === songId)
      
      // If not found in the loaded songs, try to fetch it individually
      if (!song) {
        console.log(`Song ${songId} not found in library, attempting individual fetch...`)
        song = await songsStore.getSongById(songId)
      }
      
      if (song) {
        loadingMessage.value = t('music.loadingSong')
        console.log(`Found song: ${song.title} (ID: ${songId}), starting playback...`)
        // Play the song with the full songs list as queue
        const songIndex = songsStore.songs.findIndex(s => s.id === songId)
        await playerStore.playSong(song, songsStore.songs, songIndex >= 0 ? songIndex : 0)
        console.log(`Successfully playing song from URL: ${song.title} (ID: ${songId})`)
      } else {
        console.log(`Song with ID ${songId} not found`)
        error.value = t('music.songNotFoundWithId', { id: songId })
      }
    } catch (err) {
      console.error('Error loading song:', err)
      error.value = t('music.failedToLoad')
    } finally {
      loading.value = false
      loadingMessage.value = ''
    }
  }
})
</script>