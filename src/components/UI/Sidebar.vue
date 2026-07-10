<template>
  <aside class="w-64 bg-light-bg dark:bg-spotify-black flex flex-col">
    <!-- Logo -->
    <div class="p-6">
      <h1 class="text-light-text-primary dark:text-white text-xl font-bold">{{ $t('app.title') }}</h1>
    </div>
    
    <!-- Navigation -->
    <nav class="flex-1 px-2">
      <ul class="space-y-2">
        <li>
          <RouterLink 
            to="/" 
            @click="emit('close-mobile')"
            class="flex items-center px-4 py-3 rounded-md text-sm font-medium transition-colors duration-200 hover:bg-light-border dark:hover:bg-spotify-light"
            :class="{ 'bg-light-border text-light-text-primary dark:bg-spotify-light dark:text-white': $route.name === 'Home', 'text-light-text-secondary dark:text-gray-300': $route.name !== 'Home' }"
          >
            <HomeIcon class="w-5 h-5 mr-3" />
            {{ $t('navigation.home') }}
          </RouterLink>
        </li>
        <li>
          <RouterLink 
            to="/library" 
            @click="emit('close-mobile')"
            class="flex items-center px-4 py-3 rounded-md text-sm font-medium transition-colors duration-200 hover:bg-light-border dark:hover:bg-spotify-light"
            :class="{ 'bg-light-border text-light-text-primary dark:bg-spotify-light dark:text-white': $route.name === 'Library', 'text-light-text-secondary dark:text-gray-300': $route.name !== 'Library' }"
          >
            <BuildingLibraryIcon class="w-5 h-5 mr-3" />
            {{ $t('navigation.library') }}
          </RouterLink>
        </li>
        <li>
          <RouterLink
            to="/sing"
            @click="emit('close-mobile')"
            class="flex items-center px-4 py-3 rounded-md text-sm font-medium transition-colors duration-200 hover:bg-light-border dark:hover:bg-spotify-light"
            :class="{ 'bg-light-border text-light-text-primary dark:bg-spotify-light dark:text-white': $route.name === 'Karaoke', 'text-light-text-secondary dark:text-gray-300': $route.name !== 'Karaoke' }"
          >
            <MicrophoneIcon class="w-5 h-5 mr-3" />
            {{ $t('navigation.karaoke') }}
          </RouterLink>
        </li>
        <li v-if="auth.isAdmin">
          <RouterLink
            to="/admin"
            @click="emit('close-mobile')"
            class="flex items-center px-4 py-3 rounded-md text-sm font-medium transition-colors duration-200 hover:bg-light-border dark:hover:bg-spotify-light"
            :class="{ 'bg-light-border text-light-text-primary dark:bg-spotify-light dark:text-white': $route.name === 'Admin', 'text-light-text-secondary dark:text-gray-300': $route.name !== 'Admin' }"
          >
            <Cog6ToothIcon class="w-5 h-5 mr-3" />
            {{ $t('admin.title') }}
          </RouterLink>
        </li>
      </ul>
      
      <!-- Playlists Section -->
      <div class="mt-8">
        <div class="flex items-center justify-between px-4 py-2">
          <h3 class="text-sm font-medium text-light-text-secondary dark:text-gray-300 uppercase tracking-wider">
            {{ $t('navigation.playlists') }}
          </h3>
          <button 
            @click="showCreatePlaylist = true"
            class="p-1 rounded hover:bg-light-border dark:hover:bg-spotify-light transition-colors duration-200"
          >
            <PlusIcon class="w-4 h-4 text-gray-400" />
          </button>
        </div>
        
        <ul class="mt-2 space-y-1">
          <li v-for="playlist in playlists" :key="playlist.id">
            <RouterLink 
              :to="`/playlist/${playlist.id}`"
              @click="emit('close-mobile')"
              class="block px-4 py-2 text-sm text-light-text-secondary dark:text-gray-300 hover:text-light-text-primary dark:hover:text-white hover:bg-light-border dark:hover:bg-spotify-light rounded-md transition-colors duration-200"
            >
              {{ playlist.name }}
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>
    
    <!-- User Menu -->
    <div class="p-4 border-t border-light-border dark:border-spotify-light">
      <div class="flex items-center gap-2">
        <div class="flex-1 min-w-0">
          <AuthMenu />
        </div>
        <LanguageSwitcher />
      </div>
      <!-- Build version -->
      <p class="mt-2 text-[10px] tabular-nums text-gray-500 text-right" :title="buildTime">
        Build {{ buildSha }} · {{ buildLabel }}
      </p>
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

const buildTime = __APP_BUILD_TIME__
const buildSha = __APP_BUILD_SHA__
const buildDate = new Date(buildTime)
const buildLabel = buildDate.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  + ' ' + buildDate.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
import { RouterLink, useRoute } from 'vue-router'
import {
  HomeIcon,
  BuildingLibraryIcon,
  MicrophoneIcon,
  PlusIcon,
  Cog6ToothIcon
} from '@heroicons/vue/24/outline'
import { usePlaylistsStore } from '@/stores/playlists'
import { useAuthStore } from '@/stores/auth'
import LanguageSwitcher from './LanguageSwitcher.vue'
import CreatePlaylistModal from './CreatePlaylistModal.vue'
import AuthMenu from './AuthMenu.vue'

// Define emits
const emit = defineEmits<{
  'close-mobile': []
}>()

const $route = useRoute()
const playlistsStore = usePlaylistsStore()
const auth = useAuthStore()

const showCreatePlaylist = ref(false)

const playlists = computed(() => playlistsStore.playlists)

function handlePlaylistCreated() {
  showCreatePlaylist.value = false
}
</script>