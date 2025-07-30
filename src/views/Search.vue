<template>
  <div class="search-view h-full overflow-y-auto spotify-scrollbar">
    <div class="p-6">
      <div class="mb-6">
        <input 
          v-model="searchQuery"
          type="text" 
          class="w-full px-4 py-3 bg-spotify-light text-white rounded-full border border-gray-600 focus:border-spotify-green focus:outline-none"
          :placeholder="$t('library.search')"
          autofocus
        />
      </div>
      
      <div v-if="filteredSongs.length > 0">
        <h2 class="text-xl font-bold text-white mb-4">{{ $t('library.songs') }}</h2>
        <div class="space-y-2">
          <div 
            v-for="song in filteredSongs" 
            :key="song.id"
            @click="playSong(song)"
            class="flex items-center p-3 rounded-lg hover:bg-spotify-light cursor-pointer group transition-colors duration-200"
          >
            <div class="w-10 h-10 bg-spotify-dark rounded mr-3 flex items-center justify-center">
              <MusicalNoteIcon class="w-5 h-5 text-gray-400" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-white font-medium truncate">{{ song.title }}</p>
              <p class="text-gray-400 text-sm">Song {{ song.id }}</p>
            </div>
          </div>
        </div>
      </div>
      
      <div v-else-if="searchQuery" class="text-center text-gray-400 mt-12">
        {{ $t('library.noResults') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { MusicalNoteIcon } from '@heroicons/vue/24/outline'
import { usePlayerStore } from '@/stores/player'
import { useSongsStore } from '@/stores/songs'
import type { Song } from '@/types'

const playerStore = usePlayerStore()
const songsStore = useSongsStore()

const searchQuery = ref('')

const filteredSongs = computed(() => {
  if (!searchQuery.value) return []
  
  const query = searchQuery.value.toLowerCase()
  return songsStore.songs.filter(song => 
    song.title.toLowerCase().includes(query) ||
    song.lyrics?.toLowerCase().includes(query)
  )
})

function playSong(song: Song) {
  playerStore.playSong(song, filteredSongs.value, filteredSongs.value.findIndex(s => s.id === song.id))
}
</script>