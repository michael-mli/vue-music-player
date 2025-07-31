<template>
  <div class="app flex flex-col h-screen bg-spotify-black dark:bg-spotify-black bg-light-bg text-white dark:text-white text-light-text-primary">
    <!-- Main Content -->
    <div class="flex flex-1 overflow-hidden relative">
      <!-- Desktop Sidebar -->
      <Sidebar class="hidden md:flex" />
      
      <!-- Mobile Sidebar Overlay -->
      <div 
        v-if="showMobileSidebar"
        class="md:hidden fixed inset-0 z-50 flex"
      >
        <div 
          @click="showMobileSidebar = false"
          class="fixed inset-0 bg-black/50"
        ></div>
        <Sidebar class="relative z-50" />
      </div>
      
      <!-- Main View -->
      <main class="flex-1 flex flex-col bg-gradient-to-b from-spotify-dark dark:from-spotify-dark from-light-surface to-spotify-black dark:to-spotify-black to-light-bg pb-28 sm:pb-0">
        <!-- Header -->
        <Header @toggle-sidebar="showMobileSidebar = !showMobileSidebar" />
        
        <!-- Content Area with Lyrics -->
        <div class="flex-1 overflow-hidden flex flex-col lg:flex-row">
          <!-- Router View -->
          <div class="flex-1 overflow-hidden">
            <RouterView />
          </div>
          
          <!-- Lyrics Panel - Desktop: sidebar, Mobile: overlay -->
          <LyricsPanel 
            v-if="showLyrics" 
            class="lg:relative lg:w-80 absolute inset-x-0 bottom-28 top-0 lg:top-auto lg:bottom-auto z-30 lg:z-auto"
            @close="showLyrics = false"
          />
        </div>
      </main>
    </div>
    
    <!-- Bottom Player -->
    <PlayerControls 
      @toggle-lyrics="showLyrics = !showLyrics" 
      @add-to-playlist="openAddToPlaylistFromPlayer"
    />
    
    <!-- PWA Install Prompt -->
    <InstallPrompt 
      v-if="showInstallPrompt" 
      @close="hideInstallPrompt" 
      @install="handleInstall"
    />
    
    <!-- Update Available Notification -->
    <UpdateNotification 
      v-if="updateAvailable" 
      @update="handleUpdate" 
      @dismiss="updateAvailable = false"
    />
    
    <!-- Add to Playlist Modal from Player -->
    <AddToPlaylistModal 
      v-if="showPlayerAddToPlaylistModal"
      :song="selectedSongFromPlayer"
      @close="closePlayerAddToPlaylistModal"
      @create-playlist="openCreatePlaylistFromPlayer"
    />
    
    <!-- Create Playlist Modal from Player -->
    <CreatePlaylistModal 
      v-if="showPlayerCreatePlaylistModal"
      @close="closePlayerCreatePlaylistModal"
      @created="onPlayerPlaylistCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterView } from 'vue-router'
import { usePlayerStore } from '@/stores/player'
import { useSongsStore } from '@/stores/songs'
import { usePlaylistsStore } from '@/stores/playlists'

// Components
import Sidebar from '@/components/UI/Sidebar.vue'
import Header from '@/components/UI/Header.vue'
import PlayerControls from '@/components/Player/PlayerControls.vue'
import LyricsPanel from '@/components/Lyrics/LyricsPanel.vue'
import InstallPrompt from '@/components/UI/InstallPrompt.vue'
import UpdateNotification from '@/components/UI/UpdateNotification.vue'
import AddToPlaylistModal from '@/components/UI/AddToPlaylistModal.vue'
import CreatePlaylistModal from '@/components/UI/CreatePlaylistModal.vue'

// Stores
const playerStore = usePlayerStore()
const songsStore = useSongsStore()
const playlistsStore = usePlaylistsStore()

// Reactive state
const showLyrics = ref(true)
const showInstallPrompt = ref(false)
const updateAvailable = ref(false)
const showMobileSidebar = ref(false)
const deferredPrompt = ref<any>(null)

// Player modals state
const showPlayerAddToPlaylistModal = ref(false)
const showPlayerCreatePlaylistModal = ref(false)
const selectedSongFromPlayer = ref<any>(null)

onMounted(async () => {
  // Initialize audio
  playerStore.initializeAudio()
  
  // Load initial data
  await Promise.all([
    songsStore.fetchSongs(),
    playlistsStore.fetchPlaylists()
  ])
  
  // Auto-play a random song after data is loaded
  await startRandomSong()
  
  // Check for PWA install prompt
  checkInstallPrompt()
  
  // Check for app updates
  checkForUpdates()
})

async function startRandomSong() {
  try {
    // Get a random song from the loaded songs
    const randomSongs = songsStore.getRandomSongs(1)
    if (randomSongs.length > 0) {
      const randomSong = randomSongs[0]
      
      // Create a queue with more random songs for continuous playback
      const queue = songsStore.getRandomSongs(20)
      
      // Play the random song
      await playerStore.playSong(randomSong, queue, 0)
      
      console.log(`Auto-started playing: ${randomSong.title}`)
    }
  } catch (error) {
    console.warn('Could not auto-start random song:', error)
  }
}

function checkInstallPrompt() {
  // Check if app can be installed
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt.value = e
    showInstallPrompt.value = true
  })
  
  // Check if app is already installed
  window.addEventListener('appinstalled', () => {
    showInstallPrompt.value = false
    deferredPrompt.value = null
    console.log('PWA was installed')
  })
}

function hideInstallPrompt() {
  showInstallPrompt.value = false
}

async function handleInstall() {
  if (!deferredPrompt.value) return
  
  try {
    // Show the install prompt
    deferredPrompt.value.prompt()
    
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.value.userChoice
    
    if (outcome === 'accepted') {
      console.log('User accepted the install prompt')
    } else {
      console.log('User dismissed the install prompt')
    }
    
    // Hide the install prompt
    hideInstallPrompt()
    deferredPrompt.value = null
  } catch (error) {
    console.error('Error during PWA installation:', error)
  }
}

function checkForUpdates() {
  // Listen for SW updates
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      updateAvailable.value = true
    })
  }
}

function handleUpdate() {
  window.location.reload()
}

// Player modal handlers
function openAddToPlaylistFromPlayer(song: any) {
  selectedSongFromPlayer.value = song
  showPlayerAddToPlaylistModal.value = true
}

function closePlayerAddToPlaylistModal() {
  showPlayerAddToPlaylistModal.value = false
  selectedSongFromPlayer.value = null
}

function openCreatePlaylistFromPlayer() {
  showPlayerAddToPlaylistModal.value = false
  showPlayerCreatePlaylistModal.value = true
}

function closePlayerCreatePlaylistModal() {
  showPlayerCreatePlaylistModal.value = false
}

function onPlayerPlaylistCreated() {
  // Playlist was created, reopen the add to playlist modal
  showPlayerCreatePlaylistModal.value = false
  showPlayerAddToPlaylistModal.value = true
}

// Global keyboard shortcuts
window.addEventListener('keydown', async (e) => {
  if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return
  
  switch (e.code) {
    case 'Space':
      e.preventDefault()
      await playerStore.togglePlay()
      break
    case 'ArrowRight':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        await playerStore.nextSong()
      }
      break
    case 'ArrowLeft':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        await playerStore.previousSong()
      }
      break
    case 'KeyL':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        showLyrics.value = !showLyrics.value
      }
      break
  }
})
</script>

<style scoped>
.app {
  font-family: 'Inter', sans-serif;
}
</style>