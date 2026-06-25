<template>
  <div class="home-view h-full overflow-y-auto spotify-scrollbar">
    <div class="p-4 sm:p-6">
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
            <div class="aspect-square bg-light-border dark:bg-spotify-light rounded-md mb-3 overflow-hidden relative">
              <SongCover :song-id="song.id" :alt="song.title" />
              <div class="absolute inset-0 bg-black/60 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
                <PlayIcon class="w-6 h-6 text-white" />
              </div>
            </div>
            <h3 class="font-medium text-light-text-primary dark:text-white text-sm break-words">{{ song.title }}</h3>
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
            <div class="w-10 h-10 bg-light-border dark:bg-spotify-light rounded mr-3 overflow-hidden flex-shrink-0">
              <SongCover :song-id="song.id" :alt="song.title" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-light-text-primary dark:text-white font-medium break-words">{{ song.title }}</p>
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

        <!-- Show More -->
        <button
          v-if="hasMorePopular"
          @click="showMorePopular"
          class="mt-4 mx-auto flex flex-col items-center text-light-text-secondary dark:text-gray-400 hover:text-spotify-green transition-colors duration-200"
        >
          <span class="text-sm font-medium">{{ $t('library.showMore') }}</span>
          <ChevronDownIcon class="w-6 h-6 animate-bounce" />
        </button>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ArrowsRightLeftIcon,
  HeartIcon,
  MusicalNoteIcon,
  PlayIcon,
  ChevronDownIcon
} from '@heroicons/vue/24/outline'
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player'
import { useSongsStore } from '@/stores/songs'
import SongCover from '@/components/UI/SongCover.vue'
import type { Song } from '@/types'

const { t } = useI18n()
const playerStore = usePlayerStore()
const songsStore = useSongsStore()

const recentSongs = computed(() => 
  songsStore.songs.slice(0, 12)
)

const POPULAR_PAGE_SIZE = 10
const popularLimit = ref(POPULAR_PAGE_SIZE)

const popularSongs = computed(() =>
  songsStore.songs.slice(0, popularLimit.value)
)

const hasMorePopular = computed(() =>
  popularLimit.value < songsStore.songs.length
)

function showMorePopular() {
  popularLimit.value += POPULAR_PAGE_SIZE
}

onMounted(() => {
  // Load songs if not already loaded
  if (songsStore.songs.length === 0) {
    songsStore.fetchSongs()
  }
})

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return t('greeting.morning')
  if (hour < 18) return t('greeting.afternoon')
  return t('greeting.evening')
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
  if (!duration) return '—'
  const minutes = Math.floor(duration / 60)
  const seconds = Math.floor(duration % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
</script>