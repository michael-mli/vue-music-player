<template>
  <aside class="w-64 bg-spotify-black flex flex-col">
    <!-- Logo -->
    <div class="p-6">
      <h1 class="text-white text-xl font-bold">{{ $t('app.title') }}</h1>
    </div>
    
    <!-- Navigation -->
    <nav class="flex-1 px-2">
      <ul class="space-y-2">
        <li>
          <RouterLink 
            to="/" 
            class="flex items-center px-4 py-3 rounded-md text-sm font-medium transition-colors duration-200 hover:bg-spotify-light"
            :class="{ 'bg-spotify-light text-white': $route.name === 'Home', 'text-gray-300': $route.name !== 'Home' }"
          >
            <HomeIcon class="w-5 h-5 mr-3" />
            {{ $t('navigation.home') }}
          </RouterLink>
        </li>
        <li>
          <RouterLink 
            to="/search" 
            class="flex items-center px-4 py-3 rounded-md text-sm font-medium transition-colors duration-200 hover:bg-spotify-light"
            :class="{ 'bg-spotify-light text-white': $route.name === 'Search', 'text-gray-300': $route.name !== 'Search' }"
          >
            <MagnifyingGlassIcon class="w-5 h-5 mr-3" />
            {{ $t('navigation.search') }}
          </RouterLink>
        </li>
        <li>
          <RouterLink 
            to="/library" 
            class="flex items-center px-4 py-3 rounded-md text-sm font-medium transition-colors duration-200 hover:bg-spotify-light"
            :class="{ 'bg-spotify-light text-white': $route.name === 'Library', 'text-gray-300': $route.name !== 'Library' }"
          >
            <BuildingLibraryIcon class="w-5 h-5 mr-3" />
            {{ $t('navigation.library') }}
          </RouterLink>
        </li>
      </ul>
      
      <!-- Playlists Section -->
      <div class="mt-8">
        <div class="flex items-center justify-between px-4 py-2">
          <h3 class="text-sm font-medium text-gray-300 uppercase tracking-wider">
            {{ $t('navigation.playlists') }}
          </h3>
          <button 
            @click="showCreatePlaylist = true"
            class="p-1 rounded hover:bg-spotify-light transition-colors duration-200"
          >
            <PlusIcon class="w-4 h-4 text-gray-400" />
          </button>
        </div>
        
        <ul class="mt-2 space-y-1">
          <li v-for="playlist in playlists" :key="playlist.id">
            <RouterLink 
              :to="`/playlist/${playlist.id}`"
              class="block px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-spotify-light rounded-md transition-colors duration-200"
            >
              {{ playlist.name }}
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>
    
    <!-- User Menu -->
    <div class="p-4 border-t border-spotify-light">
      <div class="flex items-center">
        <div class="w-8 h-8 bg-spotify-green rounded-full flex items-center justify-center">
          <UserIcon class="w-5 h-5 text-white" />
        </div>
        <div class="ml-3 flex-1">
          <p class="text-sm font-medium text-white">User</p>
        </div>
        <LanguageSwitcher />
      </div>
    </div>
    
    <!-- Create Playlist Modal -->
    <CreatePlaylistModal 
      v-if="showCreatePlaylist" 
      @close="showCreatePlaylist = false"
      @created="handlePlaylistCreated"
    />
  </aside>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { 
  HomeIcon, 
  MagnifyingGlassIcon, 
  BuildingLibraryIcon,
  PlusIcon,
  UserIcon 
} from '@heroicons/vue/24/outline'
import { usePlaylistsStore } from '@/stores/playlists'
import LanguageSwitcher from './LanguageSwitcher.vue'
import CreatePlaylistModal from './CreatePlaylistModal.vue'

const $route = useRoute()
const playlistsStore = usePlaylistsStore()

const showCreatePlaylist = ref(false)

const playlists = computed(() => playlistsStore.playlists)

function handlePlaylistCreated() {
  showCreatePlaylist.value = false
}
</script>