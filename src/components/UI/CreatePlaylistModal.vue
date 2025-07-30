<template>
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div class="bg-spotify-dark rounded-lg p-6 w-96 max-w-full mx-4">
      <h2 class="text-xl font-bold text-white mb-4">{{ $t('playlist.create') }}</h2>
      
      <form @submit.prevent="createPlaylist">
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-300 mb-2">
            {{ $t('playlist.name') }}
          </label>
          <input 
            v-model="playlistName"
            type="text" 
            class="w-full px-3 py-2 bg-spotify-light text-white rounded border border-gray-600 focus:border-spotify-green focus:outline-none"
            :placeholder="$t('playlist.name')"
            required
            autofocus
          />
        </div>
        
        <div class="flex justify-end space-x-3">
          <button 
            type="button"
            @click="$emit('close')"
            class="px-4 py-2 text-gray-400 hover:text-white transition-colors duration-200"
          >
            {{ $t('common.cancel') }}
          </button>
          <button 
            type="submit"
            :disabled="!playlistName.trim()"
            class="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ $t('common.save') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { usePlaylistsStore } from '@/stores/playlists'

const emit = defineEmits(['close', 'created'])

const playlistsStore = usePlaylistsStore()
const playlistName = ref('')

async function createPlaylist() {
  if (!playlistName.value.trim()) return
  
  const playlist = await playlistsStore.createPlaylist(playlistName.value.trim())
  if (playlist) {
    emit('created', playlist)
    emit('close')
  }
}
</script>