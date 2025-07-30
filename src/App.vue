<template>
  <div class="app flex flex-col h-screen bg-spotify-black text-white">
    <!-- Main Content -->
    <div class="flex flex-1 overflow-hidden relative">
      <!-- Desktop Sidebar -->
      <Sidebar class="hidden md:flex" />
      
      <!-- Mobile Sidebar Overlay -->
      <div 
        v-if="showMobileSidebar"
        class="md:hidden fixed inset-0 z-40 flex"
      >
        <div 
          @click="showMobileSidebar = false"
          class="fixed inset-0 bg-black/50"
        ></div>
        <Sidebar class="relative z-50" />
      </div>
      
      <!-- Main View -->
      <main class="flex-1 flex flex-col bg-gradient-to-b from-spotify-dark to-spotify-black">
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
            class="lg:relative lg:w-80 absolute inset-x-0 bottom-0 top-0 lg:top-auto lg:bottom-auto z-50 lg:z-auto"
            @close="showLyrics = false"
          />
        </div>
      </main>
    </div>
    
    <!-- Bottom Player -->
    <PlayerControls @toggle-lyrics="showLyrics = !showLyrics" />
    
    <!-- PWA Install Prompt -->
    <InstallPrompt v-if="showInstallPrompt" @close="hideInstallPrompt" />
    
    <!-- Update Available Notification -->
    <UpdateNotification v-if="updateAvailable" @update="handleUpdate" />
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

// Stores
const playerStore = usePlayerStore()
const songsStore = useSongsStore()
const playlistsStore = usePlaylistsStore()

// Reactive state
const showLyrics = ref(true)
const showInstallPrompt = ref(false)
const updateAvailable = ref(false)
const showMobileSidebar = ref(false)

onMounted(async () => {
  // Initialize audio
  playerStore.initializeAudio()
  
  // Load initial data
  await Promise.all([
    songsStore.fetchSongs(),
    playlistsStore.fetchPlaylists()
  ])
  
  // Check for PWA install prompt
  checkInstallPrompt()
  
  // Check for app updates
  checkForUpdates()
})

function checkInstallPrompt() {
  // Check if app can be installed
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    showInstallPrompt.value = true
  })
}

function hideInstallPrompt() {
  showInstallPrompt.value = false
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

// Global keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target as HTMLElement).tagName === 'INPUT') return
  
  switch (e.code) {
    case 'Space':
      e.preventDefault()
      playerStore.togglePlay()
      break
    case 'ArrowRight':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        playerStore.nextSong()
      }
      break
    case 'ArrowLeft':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        playerStore.previousSong()
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