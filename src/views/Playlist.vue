<template>
  <div class="playlist-view h-full overflow-y-auto spotify-scrollbar">
    <div class="p-4 sm:p-6">
      <div v-if="playlist">
        <h1 class="text-3xl font-bold text-light-text-primary dark:text-white mb-2">{{ playlist.name }}</h1>
        <p class="text-light-text-secondary dark:text-gray-400 mb-6">{{ playlist.songs.length }} songs</p>
        
        <div v-if="playlistSongs.length > 0" class="space-y-2">
          <div 
            v-for="(song, index) in playlistSongs" 
            :key="song.id"
            @click="playSong(song, index)"
            class="flex items-center p-3 rounded-lg hover:bg-light-border dark:hover:bg-spotify-light cursor-pointer group transition-colors duration-200"
          >
            <div class="w-8 text-center mr-4">
              <span class="text-light-text-secondary dark:text-gray-400 text-sm">{{ index + 1 }}</span>
            </div>
            <div class="w-10 h-10 bg-light-border dark:bg-spotify-dark rounded mr-3 flex items-center justify-center">
              <MusicalNoteIcon class="w-5 h-5 text-gray-400" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-light-text-primary dark:text-white font-medium break-words">{{ song.title }}</p>
              <p class="text-light-text-secondary dark:text-gray-400 text-sm">{{ formatDuration(song.duration) }}</p>
            </div>
            <button 
              @click.stop="removeSong(song)"
              class="p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            >
              <XMarkIcon class="w-4 h-4 text-gray-400 hover:text-red-500" />
            </button>
          </div>
        </div>
        
        <div v-else class="text-center text-light-text-secondary dark:text-gray-400 mt-12">
          {{ $t('playlist.emptyPlaylist') }}
        </div>
      </div>
      
      <div v-else class="text-center text-light-text-secondary dark:text-gray-400 mt-12">
        Playlist not found
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { MusicalNoteIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { usePlayerStore } from '@/stores/player'
import { useSongsStore } from '@/stores/songs'
import { usePlaylistsStore } from '@/stores/playlists'
import type { Song } from '@/types'

interface Props {
  id: string
}

const props = defineProps<Props>()

const playerStore = usePlayerStore()
const songsStore = useSongsStore()
const playlistsStore = usePlaylistsStore()

const playlist = computed(() => playlistsStore.getPlaylistById(props.id))

const playlistSongs = computed(() => {
  if (!playlist.value) return []
  return playlist.value.songs
    .map(songId => songsStore.songs.find(s => s.id === songId))
    .filter(Boolean) as Song[]
})

function playSong(song: Song, index: number) {
  playerStore.playSong(song, playlistSongs.value, index)
}

function removeSong(song: Song) {
  if (playlist.value) {
    playlistsStore.removeSongFromPlaylist(playlist.value.id, song.id)
  }
}

function formatDuration(duration?: number): string {
  if (!duration) return '0:00'
  const minutes = Math.floor(duration / 60)
  const seconds = Math.floor(duration % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
</script>