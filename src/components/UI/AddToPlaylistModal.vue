<template>
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div class="bg-spotify-dark dark:bg-spotify-dark bg-light-surface rounded-lg p-6 w-96 max-w-full mx-4">
      <h2 class="text-xl font-bold text-white dark:text-white text-light-text-primary mb-4">
        {{ $t('playlist.addToPlaylist') }}
      </h2>
      
      <div class="mb-4">
        <p class="text-gray-400 dark:text-gray-400 text-light-text-secondary text-sm mb-2">
          Adding "{{ song?.title }}" to playlist:
        </p>
      </div>
      
      <div v-if="playlists.length === 0" class="text-center py-8">
        <p class="text-gray-400 dark:text-gray-400 text-light-text-secondary mb-4">
          No playlists available
        </p>
        <button 
          @click="$emit('create-playlist')"
          class="btn-primary"
        >
          {{ $t('playlist.create') }}
        </button>
      </div>
      
      <div v-else class="max-h-64 overflow-y-auto spotify-scrollbar">
        <div class="space-y-2">
          <button
            v-for="playlist in playlists"
            :key="playlist.id"
            @click="addToPlaylist(playlist.id)"
            :disabled="isInPlaylist(playlist.id)"
            class="w-full text-left p-3 rounded-lg transition-colors duration-200 flex items-center justify-between"
            :class="[
              isInPlaylist(playlist.id) 
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed' 
                : 'hover:bg-spotify-light dark:hover:bg-spotify-light hover:bg-light-border text-white dark:text-white text-light-text-primary'
            ]"
          >
            <div>
              <p class="font-medium">{{ playlist.name }}</p>
              <p class="text-sm text-gray-400 dark:text-gray-400 text-light-text-secondary">
                {{ playlist.songs.length }} songs
              </p>
            </div>
            <CheckIcon 
              v-if="isInPlaylist(playlist.id)" 
              class="w-5 h-5 text-spotify-green" 
            />
          </button>
        </div>
      </div>
      
      <div class="flex justify-end space-x-3 mt-6">
        <button 
          @click="$emit('close')"
          class="px-4 py-2 text-gray-400 hover:text-white transition-colors duration-200"
        >
          {{ $t('common.close') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { CheckIcon } from '@heroicons/vue/24/outline'
import { usePlaylistsStore } from '@/stores/playlists'
import type { Song } from '@/types'

interface Props {
  song: Song | null
}

const props = defineProps<Props>()
const emit = defineEmits(['close', 'create-playlist'])

const playlistsStore = usePlaylistsStore()

const playlists = computed(() => playlistsStore.playlists)

function isInPlaylist(playlistId: string): boolean {
  if (!props.song) return false
  const playlist = playlists.value.find(p => p.id === playlistId)
  return playlist ? playlist.songs.includes(props.song.id) : false
}

async function addToPlaylist(playlistId: string) {
  if (!props.song || isInPlaylist(playlistId)) return
  
  try {
    await playlistsStore.addSongToPlaylist(playlistId, props.song.id)
    emit('close')
  } catch (error) {
    console.error('Failed to add song to playlist:', error)
  }
}
</script>