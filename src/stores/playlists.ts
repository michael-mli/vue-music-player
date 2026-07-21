import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Playlist } from '@/types'
import { playlistService } from '@/services/playlistService'
import { useAuthStore } from '@/stores/auth'

export const usePlaylistsStore = defineStore('playlists', () => {
  const auth = useAuthStore()
  const playlists = ref<Playlist[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  let fetchSequence = 0

  const playlistCount = computed(() => playlists.value.length)
  const storageMode = computed<'server' | 'local'>(() =>
    auth.isRegistered ? 'server' : 'local',
  )

  function sourceKey(): string {
    return auth.isRegistered ? `server:${auth.user?.id || ''}` : 'local'
  }

  async function fetchPlaylists() {
    const sequence = ++fetchSequence
    const source = sourceKey()
    const registered = auth.isRegistered
    try {
      loading.value = true
      error.value = null
      const response = await playlistService.getPlaylists(registered)
      // Login/logout may finish while a request is in flight. Never let an old
      // source overwrite the newly selected account or device-local source.
      if (sequence === fetchSequence && source === sourceKey()) {
        playlists.value = response.data
      }
    } catch (err) {
      if (sequence === fetchSequence) error.value = 'Failed to load playlists'
      console.error('Error fetching playlists:', err)
    } finally {
      if (sequence === fetchSequence) loading.value = false
    }
  }

  async function createPlaylist(name: string): Promise<Playlist | null> {
    try {
      error.value = null
      const registered = auth.isRegistered
      const response = await playlistService.createPlaylist({ name, songs: [] }, registered)
      if (registered === auth.isRegistered) playlists.value.push(response.data)
      return response.data
    } catch (err) {
      error.value = 'Failed to create playlist'
      console.error('Error creating playlist:', err)
      return null
    }
  }

  async function updatePlaylist(
    id: string,
    updates: Partial<Pick<Playlist, 'name' | 'songs'>>,
  ): Promise<Playlist | null> {
    try {
      error.value = null
      const registered = auth.isRegistered
      const response = await playlistService.updatePlaylist(id, updates, registered)
      const index = playlists.value.findIndex((playlist) => playlist.id === id)
      if (index !== -1 && registered === auth.isRegistered) {
        playlists.value[index] = response.data
      }
      return response.data
    } catch (err) {
      error.value = 'Failed to update playlist'
      console.error('Error updating playlist:', err)
      return null
    }
  }

  async function deletePlaylist(id: string): Promise<boolean> {
    const playlist = playlists.value.find((item) => item.id === id)
    if (!playlist || playlist.isDefault) return false
    try {
      error.value = null
      const registered = auth.isRegistered
      await playlistService.deletePlaylist(id, registered)
      if (registered === auth.isRegistered) {
        playlists.value = playlists.value.filter((item) => item.id !== id)
      }
      return true
    } catch (err) {
      error.value = 'Failed to delete playlist'
      console.error('Error deleting playlist:', err)
      return false
    }
  }

  async function addSongToPlaylist(playlistId: string, songId: number) {
    const playlist = playlists.value.find((item) => item.id === playlistId)
    if (!playlist || playlist.songs.includes(songId)) return false
    return Boolean(await updatePlaylist(playlistId, {
      songs: [...playlist.songs, songId],
    }))
  }

  async function removeSongFromPlaylist(playlistId: string, songId: number) {
    const playlist = playlists.value.find((item) => item.id === playlistId)
    if (!playlist) return false
    return Boolean(await updatePlaylist(playlistId, {
      songs: playlist.songs.filter((id) => id !== songId),
    }))
  }

  function getPlaylistById(id: string): Playlist | undefined {
    return playlists.value.find((playlist) => playlist.id === id)
  }

  return {
    playlists,
    loading,
    error,
    playlistCount,
    storageMode,
    fetchPlaylists,
    createPlaylist,
    updatePlaylist,
    deletePlaylist,
    addSongToPlaylist,
    removeSongFromPlaylist,
    getPlaylistById,
  }
})
