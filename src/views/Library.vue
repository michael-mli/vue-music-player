<template>
  <div class="library-view h-full overflow-y-auto spotify-scrollbar">
    <div class="p-4 sm:p-6">
      <h1 class="text-3xl font-bold text-light-text-primary dark:text-white mb-4">{{ $t('navigation.library') }}</h1>

      <SearchBar class="mb-4" />

      <!-- Category cards (genre) — click to browse one category, All is the default -->
      <div v-if="hasCategories" class="mb-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <button
          @click="selectCategory('all')"
          class="relative overflow-hidden rounded-lg p-3 text-left text-white bg-gradient-to-br from-spotify-green to-emerald-700 transition-transform duration-150 hover:scale-105"
          :class="selectedCategory === 'all' ? 'ring-2 ring-spotify-green ring-offset-2 ring-offset-light-bg dark:ring-offset-spotify-black' : 'opacity-90'"
        >
          <p class="font-bold text-sm break-words">{{ $t('search.scope.all') }}</p>
          <p class="text-xs text-white/80 mt-1">{{ $t('library.totalSongs', { count: songs.length }) }}</p>
        </button>
        <button
          v-for="cat in visibleCategories"
          :key="cat.key"
          @click="selectCategory(cat.key)"
          class="relative overflow-hidden rounded-lg p-3 text-left text-white bg-gradient-to-br transition-transform duration-150 hover:scale-105"
          :class="[gradientFor(cat.key), selectedCategory === cat.key ? 'ring-2 ring-spotify-green ring-offset-2 ring-offset-light-bg dark:ring-offset-spotify-black' : 'opacity-90']"
        >
          <p class="font-bold text-sm break-words">{{ cat.key === '__none__' ? $t('library.uncategorized') : cat.key }}</p>
          <p class="text-xs text-white/80 mt-1">{{ $t('library.totalSongs', { count: cat.count }) }}</p>
        </button>
        <button
          v-if="categories.length > COLLAPSED_CATEGORY_COUNT"
          @click="categoriesExpanded = !categoriesExpanded"
          class="rounded-lg p-3 text-left border border-dashed border-light-border dark:border-spotify-light text-light-text-secondary dark:text-gray-400 hover:text-spotify-green hover:border-spotify-green transition-colors duration-150"
        >
          <p class="font-bold text-sm">
            {{ categoriesExpanded ? $t('library.showLess') : `+${categories.length - COLLAPSED_CATEGORY_COUNT}` }}
          </p>
          <p class="text-xs mt-1">{{ categoriesExpanded ? '' : $t('library.showMore') }}</p>
        </button>
      </div>

      <div class="mb-6 flex items-center justify-between">
        <p class="text-light-text-secondary dark:text-gray-400">
          {{ $t('library.totalSongs', { count: filteredCount }) }}
          <span v-if="isFiltering" class="text-xs"> / {{ songs.length }}</span>
        </p>
        <div v-if="isLoadingTitles" class="text-spotify-green text-sm flex items-center">
          <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-spotify-green" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {{ $t('library.loadingTitles') }}
        </div>
      </div>
      
      <div class="space-y-2">
        <div 
          v-for="(song, index) in paginatedSongs" 
          :key="song.id"
          @click="playSong(song, index)"
          class="flex items-center p-3 rounded-lg hover:bg-light-border dark:hover:bg-spotify-light cursor-pointer group transition-colors duration-200"
        >
          <div class="w-8 text-center mr-4">
            <span class="text-light-text-secondary dark:text-gray-400 text-sm">{{ song.id }}</span>
          </div>
          <div class="w-10 h-10 bg-light-border dark:bg-spotify-dark rounded mr-3 overflow-hidden flex-shrink-0">
            <SongCover :song-id="song.id" :alt="song.title" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-light-text-primary dark:text-white font-medium break-words">{{ song.title }}</p>
            <p class="text-light-text-secondary dark:text-gray-400 text-sm">{{ songSubtitle(song) }}</p>
          </div>
          <div class="flex items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200">
            <button 
              @click.stop="toggleFavorite(song)"
              class="p-2"
            >
              <HeartIcon 
                :class="[
                  'w-4 h-4',
                  song.isFavorite ? 'text-spotify-green fill-current' : 'text-gray-400'
                ]" 
              />
            </button>
            <button 
              @click.stop="openAddToPlaylistModal(song)"
              class="p-2"
            >
              <EllipsisHorizontalIcon class="w-4 h-4 text-gray-400 hover:text-white" />
            </button>
          </div>
        </div>
      </div>

      <!-- No results for the current quick filter -->
      <div v-if="isFiltering && filteredCount === 0" class="text-center text-light-text-secondary dark:text-gray-400 mt-12">
        {{ $t('search.noResults') }}
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex flex-col items-center mt-8 space-y-4">
        <!-- Page Numbers -->
        <div class="flex flex-wrap justify-center gap-1 sm:gap-2">
          <!-- First Page -->
          <button 
            v-if="currentPage > 3"
            @click="setPage(1)"
            class="w-8 h-8 sm:w-10 sm:h-10 bg-light-border text-light-text-primary dark:bg-spotify-light dark:text-white rounded hover:bg-spotify-green dark:hover:bg-spotify-green transition-colors duration-200 text-sm"
          >
            1
          </button>
          
          <!-- Ellipsis -->
          <span v-if="currentPage > 4" class="px-2 py-1 text-gray-400">...</span>
          
          <!-- Page Numbers Around Current -->
          <button 
            v-for="page in visiblePages" 
            :key="page"
            @click="setPage(page)"
            :class="[
              'w-8 h-8 sm:w-10 sm:h-10 rounded transition-colors duration-200 text-sm',
              page === currentPage 
                ? 'bg-spotify-green text-white' 
                : 'bg-light-border text-light-text-primary dark:bg-spotify-light dark:text-white hover:bg-spotify-green dark:hover:bg-spotify-green'
            ]"
          >
            {{ page }}
          </button>
          
          <!-- Ellipsis -->
          <span v-if="currentPage < totalPages - 3" class="px-2 py-1 text-gray-400">...</span>
          
          <!-- Last Page -->
          <button 
            v-if="currentPage < totalPages - 2"
            @click="setPage(totalPages)"
            class="w-8 h-8 sm:w-10 sm:h-10 bg-light-border text-light-text-primary dark:bg-spotify-light dark:text-white rounded hover:bg-spotify-green dark:hover:bg-spotify-green transition-colors duration-200 text-sm"
          >
            {{ totalPages }}
          </button>
        </div>
        
        <!-- Navigation Controls -->
        <div class="flex items-center space-x-4">
          <button 
            @click="previousPage"
            :disabled="currentPage === 1"
            class="px-4 py-2 bg-light-border text-light-text-primary dark:bg-spotify-light dark:text-white rounded disabled:opacity-50 hover:bg-spotify-green dark:hover:bg-spotify-green transition-colors duration-200"
          >
            Previous
          </button>
          
          <span class="text-light-text-secondary dark:text-gray-400 text-sm">
            Page {{ currentPage }} of {{ totalPages }}
          </span>
          
          <button 
            @click="nextPage"
            :disabled="currentPage === totalPages"
            class="px-4 py-2 bg-light-border text-light-text-primary dark:bg-spotify-light dark:text-white rounded disabled:opacity-50 hover:bg-spotify-green dark:hover:bg-spotify-green transition-colors duration-200"
          >
            Next
          </button>
        </div>
        
        <!-- Jump to Page Input -->
        <div class="flex items-center space-x-2">
          <span class="text-light-text-secondary dark:text-gray-400 text-sm">Go to page:</span>
          <input 
            v-model.number="jumpToPageInput"
            @keyup.enter="jumpToPage"
            type="number" 
            :min="1" 
            :max="totalPages"
            class="w-16 px-2 py-1 bg-light-surface text-light-text-primary dark:bg-spotify-dark dark:text-white border border-light-border dark:border-spotify-light rounded text-sm text-center"
            placeholder="1"
          >
          <button 
            @click="jumpToPage"
            class="px-3 py-1 bg-spotify-green text-white rounded hover:bg-green-500 transition-colors duration-200 text-sm"
          >
            Go
          </button>
        </div>
      </div>
    </div>
    
    <!-- Add to Playlist Modal -->
    <AddToPlaylistModal 
      v-if="showAddToPlaylistModal"
      :song="selectedSong"
      @close="closeAddToPlaylistModal"
      @create-playlist="openCreatePlaylistModal"
    />
    
    <!-- Create Playlist Modal -->
    <CreatePlaylistModal 
      v-if="showCreatePlaylistModal"
      @close="closeCreatePlaylistModal"
      @created="onPlaylistCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { HeartIcon, EllipsisHorizontalIcon } from '@heroicons/vue/24/outline'
import SongCover from '@/components/UI/SongCover.vue'
import SearchBar from '@/components/UI/SearchBar.vue'
import { usePlayerStore } from '@/stores/player'
import { useSongsStore } from '@/stores/songs'
import { usePlaylistsStore } from '@/stores/playlists'
import AddToPlaylistModal from '@/components/UI/AddToPlaylistModal.vue'
import CreatePlaylistModal from '@/components/UI/CreatePlaylistModal.vue'
import type { Song } from '@/types'

const playerStore = usePlayerStore()
const songsStore = useSongsStore()
const playlistsStore = usePlaylistsStore()

// Modal state
const showAddToPlaylistModal = ref(false)
const showCreatePlaylistModal = ref(false)
const selectedSong = ref<Song | null>(null)

// Clear any search state when entering library mode
onMounted(() => {
  songsStore.resetToLibraryMode()
  // Load playlists when component mounts
  playlistsStore.fetchPlaylists()
})

const songs = computed(() => songsStore.songs)
const paginatedSongs = computed(() => songsStore.paginatedSongs)
const currentPage = computed(() => songsStore.currentPage)
const totalPages = computed(() => songsStore.totalPages)
const isFiltering = computed(() => songsStore.quickQuery.trim().length > 0 || songsStore.category !== 'all')
const filteredCount = computed(() => songsStore.libraryFilteredSongs.length)

// Category cards
const COLLAPSED_CATEGORY_COUNT = 10
const categoriesExpanded = ref(false)
const categories = computed(() => songsStore.categories)
// Only show the card grid once metadata provides real genres
const hasCategories = computed(() => categories.value.some(c => c.key !== '__none__'))
const selectedCategory = computed(() => songsStore.category)
const visibleCategories = computed(() => {
  if (categoriesExpanded.value) return categories.value
  const shown = categories.value.slice(0, COLLAPSED_CATEGORY_COUNT)
  // keep the selected category visible even when collapsed
  const selected = categories.value.find(c => c.key === selectedCategory.value)
  if (selected && !shown.includes(selected)) shown[shown.length - 1] = selected
  return shown
})

function selectCategory(key: string) {
  songsStore.setCategory(key)
}

// Deterministic card gradient per category name
const CARD_GRADIENTS = [
  'from-purple-500 to-indigo-700',
  'from-rose-500 to-red-700',
  'from-amber-500 to-orange-700',
  'from-sky-500 to-blue-700',
  'from-teal-500 to-cyan-700',
  'from-fuchsia-500 to-pink-700',
  'from-lime-600 to-green-800',
  'from-violet-500 to-purple-800',
  'from-orange-500 to-rose-700',
  'from-blue-500 to-violet-700',
]
function gradientFor(name: string): string {
  if (name === '__none__') return 'from-gray-500 to-gray-700'
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return CARD_GRADIENTS[hash % CARD_GRADIENTS.length]
}

// Jump to page input
const jumpToPageInput = ref<number | null>(null)
const isLoadingTitles = ref(false)

// Visible page numbers around current page
const visiblePages = computed(() => {
  const current = currentPage.value
  const total = totalPages.value
  const pages: number[] = []
  
  // Show 2 pages before and after current page
  const start = Math.max(1, current - 2)
  const end = Math.min(total, current + 2)
  
  for (let i = start; i <= end; i++) {
    pages.push(i)
  }
  
  return pages
})

async function playSong(song: Song, index: number) {
  // Queue is the (possibly filtered) list so next/previous stay within the results
  const queue = songsStore.libraryFilteredSongs
  const startIndex = (currentPage.value - 1) * songsStore.pageSize + index
  await playerStore.playSong(song, queue, startIndex)
}

function toggleFavorite(song: Song) {
  songsStore.toggleFavorite(song.id)
}

async function previousPage() {
  isLoadingTitles.value = true
  try {
    await songsStore.previousPage()
  } finally {
    isLoadingTitles.value = false
  }
}

async function nextPage() {
  isLoadingTitles.value = true
  try {
    await songsStore.nextPage()
  } finally {
    isLoadingTitles.value = false
  }
}

async function setPage(page: number) {
  isLoadingTitles.value = true
  try {
    await songsStore.setPage(page)
  } finally {
    isLoadingTitles.value = false
  }
}

async function jumpToPage() {
  if (jumpToPageInput.value && jumpToPageInput.value >= 1 && jumpToPageInput.value <= totalPages.value) {
    isLoadingTitles.value = true
    try {
      await songsStore.setPage(jumpToPageInput.value)
      jumpToPageInput.value = null
    } finally {
      isLoadingTitles.value = false
    }
  }
}

function formatDuration(duration?: number): string {
  if (!duration) return '—'
  const minutes = Math.floor(duration / 60)
  const seconds = Math.floor(duration % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function songSubtitle(song: Song): string {
  return [song.artist, song.year, formatDuration(song.duration)].filter(Boolean).join(' · ')
}

function openAddToPlaylistModal(song: Song) {
  selectedSong.value = song
  showAddToPlaylistModal.value = true
}

function closeAddToPlaylistModal() {
  showAddToPlaylistModal.value = false
  selectedSong.value = null
}

function openCreatePlaylistModal() {
  showAddToPlaylistModal.value = false
  showCreatePlaylistModal.value = true
}

function closeCreatePlaylistModal() {
  showCreatePlaylistModal.value = false
}

function onPlaylistCreated() {
  // Playlist was created, reopen the add to playlist modal
  showCreatePlaylistModal.value = false
  showAddToPlaylistModal.value = true
}
</script>