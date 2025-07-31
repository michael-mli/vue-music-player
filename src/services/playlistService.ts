import api from './api'
import type { Playlist, APIResponse } from '@/types'
import config from '@/config'

const PLAYLISTS_STORAGE_KEY = 'mics-music-playlists'

// Helper functions for localStorage
function getStoredPlaylists(): Playlist[] {
  try {
    const stored = localStorage.getItem(PLAYLISTS_STORAGE_KEY)
    if (stored) {
      const playlists = JSON.parse(stored)
      // Convert date strings back to Date objects
      return playlists.map((p: any) => ({
        ...p,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt)
      }))
    }
  } catch (error) {
    console.error('Error reading playlists from localStorage:', error)
  }
  return []
}

function savePlaylistsToStorage(playlists: Playlist[]): void {
  try {
    localStorage.setItem(PLAYLISTS_STORAGE_KEY, JSON.stringify(playlists))
  } catch (error) {
    console.error('Error saving playlists to localStorage:', error)
  }
}

function initializeDefaultPlaylists(): void {
  const existing = getStoredPlaylists()
  if (existing.length === 0) {
    // Create default playlists on first run
    const defaultPlaylists: Playlist[] = [
      {
        id: '1',
        name: 'My Favorites',
        songs: [1, 5, 10, 15, 20],
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-15')
      },
      {
        id: '2',
        name: 'Rock Classics',
        songs: [2, 7, 12, 18, 25],
        createdAt: new Date('2024-01-05'),
        updatedAt: new Date('2024-01-10')
      },
      {
        id: '3',
        name: 'Chill Vibes',
        songs: [3, 8, 13, 22, 30],
        createdAt: new Date('2024-01-10'),
        updatedAt: new Date('2024-01-20')
      }
    ]
    savePlaylistsToStorage(defaultPlaylists)
  }
}

export const playlistService = {
  async getPlaylists(): Promise<APIResponse<Playlist[]>> {
    if (config.enableMockData) {
      // Initialize default playlists if none exist
      initializeDefaultPlaylists()
      // In mock mode, use localStorage
      const playlists = getStoredPlaylists()
      return {
        success: true,
        data: playlists
      }
    }
    return api.get('/playlists')
  },

  async createPlaylist(playlist: Omit<Playlist, 'id' | 'createdAt' | 'updatedAt'>): Promise<APIResponse<Playlist>> {
    if (config.enableMockData) {
      // In mock mode, create playlist in localStorage
      const playlists = getStoredPlaylists()
      const newPlaylist: Playlist = {
        ...playlist,
        id: Date.now().toString(), // Simple ID generation
        createdAt: new Date(),
        updatedAt: new Date()
      }
      playlists.push(newPlaylist)
      savePlaylistsToStorage(playlists)
      
      return {
        success: true,
        data: newPlaylist
      }
    }
    return api.post('/playlists', playlist)
  },

  async updatePlaylist(id: string, updates: Partial<Playlist>): Promise<APIResponse<Playlist>> {
    if (config.enableMockData) {
      // In mock mode, update playlist in localStorage
      const playlists = getStoredPlaylists()
      const index = playlists.findIndex(p => p.id === id)
      if (index !== -1) {
        playlists[index] = {
          ...playlists[index],
          ...updates,
          updatedAt: new Date()
        }
        savePlaylistsToStorage(playlists)
        return {
          success: true,
          data: playlists[index]
        }
      }
      throw new Error('Playlist not found')
    }
    return api.put(`/playlists/${id}`, updates)
  },

  async deletePlaylist(id: string): Promise<APIResponse<void>> {
    if (config.enableMockData) {
      // In mock mode, delete playlist from localStorage
      const playlists = getStoredPlaylists()
      const filteredPlaylists = playlists.filter(p => p.id !== id)
      savePlaylistsToStorage(filteredPlaylists)
      
      return {
        success: true,
        data: undefined
      }
    }
    return api.delete(`/playlists/${id}`)
  },

  // Mock data for development
  async getMockPlaylists(): Promise<APIResponse<Playlist[]>> {
    const mockPlaylists: Playlist[] = [
      {
        id: '1',
        name: 'My Favorites',
        songs: [1, 5, 10, 15, 20],
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-15')
      },
      {
        id: '2',
        name: 'Rock Classics',
        songs: [2, 7, 12, 18, 25],
        createdAt: new Date('2024-01-05'),
        updatedAt: new Date('2024-01-10')
      },
      {
        id: '3',
        name: 'Chill Vibes',
        songs: [3, 8, 13, 22, 30],
        createdAt: new Date('2024-01-10'),
        updatedAt: new Date('2024-01-20')
      }
    ]

    await new Promise(resolve => setTimeout(resolve, 300))
    
    return {
      success: true,
      data: mockPlaylists
    }
  }
}