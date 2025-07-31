<template>
  <div class="home-view h-full overflow-y-auto spotify-scrollbar">
    <div class="p-6">
      <!-- Welcome Section -->
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-light-text-primary dark:text-white mb-2">
          {{ getGreeting() }}
        </h1>
        <p class="text-light-text-secondary dark:text-gray-400">{{ $t('app.subtitle') }}</p>
      </div>
      
      <!-- Quick Actions -->
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <button 
          @click="playRandomSongs"
          class="card flex items-center p-4 hover:scale-105 transform transition-all duration-200"
        >
          <ArrowsRightLeftIcon class="w-6 h-6 text-spotify-green mr-3" />
          <span class="font-medium">{{ $t('player.shuffle') }}</span>
        </button>
        
        <button 
          @click="playFavorites"
          class="card flex items-center p-4 hover:scale-105 transform transition-all duration-200"
        >
          <HeartIcon class="w-6 h-6 text-red-500 mr-3" />
          <span class="font-medium">{{ $t('navigation.favorites') }}</span>
        </button>
        
        <button 
          @click="$router.push('/library')"
          class="card flex items-center p-4 hover:scale-105 transform transition-all duration-200"
        >
          <MusicalNoteIcon class="w-6 h-6 text-blue-500 mr-3" />
          <span class="font-medium">{{ $t('library.songs') }}</span>
        </button>
      </div>
      
      <!-- Recently Played -->
      <section class="mb-8">
        <h2 class="text-xl font-bold text-light-text-primary dark:text-white mb-4">
          {{ $t('library.recentlyPlayed') }}
        </h2>
        <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div 
            v-for="song in recentSongs" 
            :key="song.id"
            @click="playSong(song)"
            class="card cursor-pointer group"
          >
            <div class="aspect-square bg-light-border dark:bg-spotify-light rounded-md mb-3 flex items-center justify-center relative">
              <MusicalNoteIcon class="w-8 h-8 text-gray-400" />
              <div class="absolute inset-0 bg-black/60 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                <PlayIcon class="w-6 h-6 text-white" />
              </div>
            </div>
            <h3 class="font-medium text-light-text-primary dark:text-white text-sm truncate">{{ song.title }}</h3>
            <p class="text-light-text-secondary dark:text-gray-400 text-xs">Song {{ song.id }}</p>
          </div>
        </div>
      </section>
      
      <!-- Popular Songs -->
      <section class="mb-8">
        <h2 class="text-xl font-bold text-light-text-primary dark:text-white mb-4">Popular Songs</h2>
        <div class="space-y-2">
          <div 
            v-for="(song, index) in popularSongs" 
            :key="song.id"
            @click="playSong(song)"
            class="flex items-center p-3 rounded-lg hover:bg-light-border dark:hover:bg-spotify-light cursor-pointer group transition-colors duration-200"
          >
            <div class="w-8 h-8 flex items-center justify-center mr-4">
              <span class="text-light-text-secondary dark:text-gray-400 font-medium">{{ index + 1 }}</span>
            </div>
            <div class="w-10 h-10 bg-light-border dark:bg-spotify-light rounded mr-3 flex items-center justify-center">
              <MusicalNoteIcon class="w-5 h-5 text-gray-400" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-light-text-primary dark:text-white font-medium truncate">{{ song.title }}</p>
              <p class="text-light-text-secondary dark:text-gray-400 text-sm">{{ formatDuration(song.duration) }}</p>
            </div>
            <button 
              @click.stop="toggleFavorite(song)"
              class="p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            >
              <HeartIcon 
                :class="[
                  'w-4 h-4',
                  song.isFavorite ? 'text-spotify-green fill-current' : 'text-gray-400'
                ]" 
              />
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { 
  ArrowsRightLeftIcon, 
  HeartIcon, 
  MusicalNoteIcon,
  PlayIcon
} from '@heroicons/vue/24/outline'
import { usePlayerStore } from '@/stores/player'
import { useSongsStore } from '@/stores/songs'
import type { Song } from '@/types'

const playerStore = usePlayerStore()
const songsStore = useSongsStore()

const recentSongs = computed(() => 
  songsStore.songs.slice(0, 12)
)

const popularSongs = computed(() => 
  songsStore.songs.slice(0, 10)
)

onMounted(() => {
  // Load songs if not already loaded
  if (songsStore.songs.length === 0) {
    songsStore.fetchSongs()
  }
})

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function playSong(song: Song) {
  playerStore.playSong(song, songsStore.songs, songsStore.songs.findIndex(s => s.id === song.id))
}

function playRandomSongs() {
  const randomSongs = songsStore.getRandomSongs(50)
  if (randomSongs.length > 0) {
    playerStore.playSong(randomSongs[0], randomSongs, 0)
  }
}

function playFavorites() {
  const favorites = songsStore.favoriteSongs
  if (favorites.length > 0) {
    playerStore.playSong(favorites[0], favorites, 0)
  }
}

function toggleFavorite(song: Song) {
  songsStore.toggleFavorite(song.id)
}

function formatDuration(duration?: number): string {
  if (!duration) return '0:00'
  const minutes = Math.floor(duration / 60)
  const seconds = Math.floor(duration % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
</script>