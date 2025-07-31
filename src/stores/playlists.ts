import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Playlist } from '@/types'
import { playlistService } from '@/services/playlistService'

export const usePlaylistsStore = defineStore('playlists', () => {
  // State
  const playlists = ref<Playlist[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Getters
  const playlistCount = computed(() => playlists.value.length)

  // Actions
  async function fetchPlaylists() {
    try {
      loading.value = true
      error.value = null
      const response = await playlistService.getPlaylists()
      playlists.value = response.data
    } catch (err) {
      error.value = 'Failed to load playlists'
      console.error('Error fetching playlists:', err)
    } finally {
      loading.value = false
    }
  }

  async function createPlaylist(name: string): Promise<Playlist | null> {
    try {
      const response = await playlistService.createPlaylist({ name, songs: [] })
      const newPlaylist = response.data
      playlists.value.push(newPlaylist)
      return newPlaylist
    } catch (err) {
      error.value = 'Failed to create playlist'
      console.error('Error creating playlist:', err)
      return null
    }
  }

  async function updatePlaylist(id: string, updates: Partial<Playlist>) {
    try {
      const response = await playlistService.updatePlaylist(id, updates)
      const updatedPlaylist = response.data
      const index = playlists.value.findIndex(p => p.id === id)
      if (index !== -1) {
        playlists.value[index] = updatedPlaylist
      }
      return updatedPlaylist
    } catch (err) {
      error.value = 'Failed to update playlist'
      console.error('Error updating playlist:', err)
      return null
    }
  }

  async function deletePlaylist(id: string) {
    try {
      await playlistService.deletePlaylist(id)
      playlists.value = playlists.value.filter(p => p.id !== id)
    } catch (err) {
      error.value = 'Failed to delete playlist'
      console.error('Error deleting playlist:', err)
    }
  }

  async function addSongToPlaylist(playlistId: string, songId: number) {
    const playlist = playlists.value.find(p => p.id === playlistId)
    if (playlist && !playlist.songs.includes(songId)) {
      const updatedSongs = [...playlist.songs, songId]
      await updatePlaylist(playlistId, { 
        songs: updatedSongs,
        updatedAt: new Date()
      })
    }
  }

  async function removeSongFromPlaylist(playlistId: string, songId: number) {
    const playlist = playlists.value.find(p => p.id === playlistId)
    if (playlist) {
      const updatedSongs = playlist.songs.filter(id => id !== songId)
      await updatePlaylist(playlistId, { 
        songs: updatedSongs,
        updatedAt: new Date()
      })
    }
  }

  function getPlaylistById(id: string): Playlist | undefined {
    return playlists.value.find(p => p.id === id)
  }

  return {
    // State
    playlists,
    loading,
    error,
    
    // Getters
    playlistCount,
    
    // Actions
    fetchPlaylists,
    createPlaylist,
    updatePlaylist,
    deletePlaylist,
    addSongToPlaylist,
    removeSongFromPlaylist,
    getPlaylistById
  }
})