import api from './api'
import type { Playlist, APIResponse } from '@/types'

export const playlistService = {
  async getPlaylists(): Promise<APIResponse<Playlist[]>> {
    return api.get('/playlists')
  },

  async createPlaylist(playlist: Omit<Playlist, 'id' | 'createdAt' | 'updatedAt'>): Promise<APIResponse<Playlist>> {
    return api.post('/playlists', playlist)
  },

  async updatePlaylist(id: string, updates: Partial<Playlist>): Promise<APIResponse<Playlist>> {
    return api.put(`/playlists/${id}`, updates)
  },

  async deletePlaylist(id: string): Promise<APIResponse<void>> {
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