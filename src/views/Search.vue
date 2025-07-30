<template>
  <div class="search-view h-full overflow-y-auto spotify-scrollbar">
    <div class="p-6">
      <div class="mb-6">
        <input 
          v-model="searchQuery"
          @input="handleSearch"
          type="text" 
          class="w-full px-4 py-3 bg-spotify-light text-white rounded-full border border-gray-600 focus:border-spotify-green focus:outline-none"
          :placeholder="$t('library.search') + ' (min 2 characters - searches titles and lyrics)'"
          autofocus
        />
      </div>
      
      <!-- Loading state -->
      <div v-if="isSearching" class="text-center text-spotify-green mt-8">
        <div class="flex flex-col items-center">
          <div class="flex items-center mb-4">
            <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-spotify-green" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Searching lyrics...
          </div>
          <p class="text-sm text-gray-400 mb-2">
            Title matches appear first, lyrics matches will appear as they're found
          </p>
          <button 
            @click="cancelSearch"
            class="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-500 transition-colors text-sm"
          >
            Cancel Search
          </button>
        </div>
      </div>
      
      <!-- Search results (shown even during loading for progressive results) -->
      <div v-if="filteredSongs.length > 0">
        <h2 class="text-xl font-bold text-white mb-4">
          {{ $t('library.songs') }} ({{ filteredSongs.length }} {{ filteredSongs.length === 1 ? 'result' : 'results' }}{{ isSearching ? ' - searching...' : '' }})
        </h2>
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
              <p class="text-white font-medium truncate">{{ song.title }} (#{{ song.id }})</p>
              <p class="text-gray-400 text-sm" v-if="song.matchType === 'lyrics'">
                {{ getMatchingLyricPreview(song, searchQuery) }}
              </p>
              <p class="text-gray-400 text-sm" v-else>
                Title match
              </p>
            </div>
          </div>
        </div>
      </div>
      
      <!-- No results -->
      <div v-else-if="searchQuery && !isSearching" class="text-center text-gray-400 mt-12">
        {{ $t('library.noResults') }}
      </div>
      
      <!-- Initial state -->
      <div v-else-if="!searchQuery" class="text-center text-gray-400 mt-12">
        <p class="text-lg mb-2">🎵 Search for songs</p>
        <p class="text-sm">Search by song title or lyrics content</p>
        <p class="text-xs mt-2 text-gray-500">Type at least 2 characters to start searching</p>
      </div>
      
      <!-- Too short query -->
      <div v-else-if="searchQuery && searchQuery.trim().length < 2" class="text-center text-gray-400 mt-12">
        <p class="text-lg mb-2">⌨️ Keep typing...</p>
        <p class="text-sm">Need at least 2 characters to search</p>
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

const filteredSongs = computed(() => songsStore.filteredSongs)
const isSearching = computed(() => songsStore.isSearching)

let searchTimeout: ReturnType<typeof setTimeout> | null = null

function handleSearch() {
  // Clear previous timeout
  if (searchTimeout) {
    clearTimeout(searchTimeout)
  }
  
  // Debounce search to avoid too many requests
  searchTimeout = setTimeout(async () => {
    await songsStore.searchSongs(searchQuery.value)
  }, 300)
}

function cancelSearch() {
  // Clear the search timeout
  if (searchTimeout) {
    clearTimeout(searchTimeout)
    searchTimeout = null
  }
  
  // Clear the search
  songsStore.clearSearch()
  searchQuery.value = ''
}

async function playSong(song: Song) {
  await playerStore.playSong(song, filteredSongs.value, filteredSongs.value.findIndex(s => s.id === song.id))
}

function getMatchingLyricPreview(song: Song, query: string): string {
  if (!song.lyrics || !query) return 'Lyrics match'
  
  const queryWords = query.toLowerCase().trim().split(/\s+/).filter(word => word.length > 0)
  const lyrics = song.lyrics.toLowerCase()
  
  // Find the first occurrence of any query word
  let bestMatch = { index: -1, word: '' }
  for (const word of queryWords) {
    const index = lyrics.indexOf(word)
    if (index !== -1 && (bestMatch.index === -1 || index < bestMatch.index)) {
      bestMatch = { index, word }
    }
  }
  
  if (bestMatch.index === -1) return 'Lyrics match'
  
  // Get some context around the match
  const start = Math.max(0, bestMatch.index - 30)
  const end = Math.min(song.lyrics.length, bestMatch.index + bestMatch.word.length + 30)
  const originalPreview = song.lyrics.substring(start, end).trim()
  
  // Clean up the preview (remove excessive whitespace and line breaks)
  const cleanPreview = originalPreview.replace(/\s+/g, ' ').trim()
  
  return start > 0 ? `...${cleanPreview}...` : `${cleanPreview}...`
}
</script>