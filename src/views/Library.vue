<template>
  <div class="library-view h-full overflow-y-auto spotify-scrollbar">
    <div class="p-6">
      <h1 class="text-3xl font-bold text-white dark:text-white text-light-text-primary mb-6">{{ $t('navigation.library') }}</h1>
      
      <div class="mb-6 flex items-center justify-between">
        <p class="text-gray-400 dark:text-gray-400 text-light-text-secondary">{{ $t('library.totalSongs', { count: songs.length }) }}</p>
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
          class="flex items-center p-3 rounded-lg hover:bg-spotify-light dark:hover:bg-spotify-light hover:bg-light-border cursor-pointer group transition-colors duration-200"
        >
          <div class="w-8 text-center mr-4">
            <span class="text-gray-400 dark:text-gray-400 text-light-text-secondary text-sm">{{ song.id }}</span>
          </div>
          <div class="w-10 h-10 bg-spotify-dark dark:bg-spotify-dark bg-light-border rounded mr-3 flex items-center justify-center">
            <MusicalNoteIcon class="w-5 h-5 text-gray-400" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-white dark:text-white text-light-text-primary font-medium truncate">{{ song.title }}</p>
            <p class="text-gray-400 dark:text-gray-400 text-light-text-secondary text-sm">{{ formatDuration(song.duration) }}</p>
          </div>
          <div class="flex items-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
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
      
      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex flex-col items-center mt-8 space-y-4">
        <!-- Page Numbers -->
        <div class="flex flex-wrap justify-center gap-1 sm:gap-2">
          <!-- First Page -->
          <button 
            v-if="currentPage > 3"
            @click="setPage(1)"
            class="w-8 h-8 sm:w-10 sm:h-10 bg-spotify-light text-white rounded hover:bg-spotify-green transition-colors duration-200 text-sm"
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
                : 'bg-spotify-light text-white hover:bg-spotify-green'
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
            class="w-8 h-8 sm:w-10 sm:h-10 bg-spotify-light text-white rounded hover:bg-spotify-green transition-colors duration-200 text-sm"
          >
            {{ totalPages }}
          </button>
        </div>
        
        <!-- Navigation Controls -->
        <div class="flex items-center space-x-4">
          <button 
            @click="previousPage"
            :disabled="currentPage === 1"
            class="px-4 py-2 bg-spotify-light text-white rounded disabled:opacity-50 hover:bg-spotify-green transition-colors duration-200"
          >
            Previous
          </button>
          
          <span class="text-gray-400 text-sm">
            Page {{ currentPage }} of {{ totalPages }}
          </span>
          
          <button 
            @click="nextPage"
            :disabled="currentPage === totalPages"
            class="px-4 py-2 bg-spotify-light text-white rounded disabled:opacity-50 hover:bg-spotify-green transition-colors duration-200"
          >
            Next
          </button>
        </div>
        
        <!-- Jump to Page Input -->
        <div class="flex items-center space-x-2">
          <span class="text-gray-400 text-sm">Go to page:</span>
          <input 
            v-model.number="jumpToPageInput"
            @keyup.enter="jumpToPage"
            type="number" 
            :min="1" 
            :max="totalPages"
            class="w-16 px-2 py-1 bg-spotify-dark text-white border border-spotify-light rounded text-sm text-center"
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
import { MusicalNoteIcon, HeartIcon, EllipsisHorizontalIcon } from '@heroicons/vue/24/outline'
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
  const startIndex = (currentPage.value - 1) * songsStore.pageSize + index
  await playerStore.playSong(song, songs.value, startIndex)
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
  if (!duration) return '0:00'
  const minutes = Math.floor(duration / 60)
  const seconds = Math.floor(duration % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

// Modal handlers
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