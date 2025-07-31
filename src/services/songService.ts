import api from './api'
import type { Song, APIResponse } from '@/types'
import config, { getLyricsUrl } from '@/config'

export const songService = {
  async getAllSongs(): Promise<APIResponse<Song[]>> {
    return api.get('/songs')
  },

  async getSong(id: number): Promise<APIResponse<Song>> {
    return api.get(`/songs/${id}`)
  },

  async getLyrics(id: number): Promise<APIResponse<string>> {
    return api.get(`/lyrics/${id}`)
  },

  async searchSongs(query: string): Promise<APIResponse<Song[]>> {
    return api.get(`/search?q=${encodeURIComponent(query)}`)
  },

  async toggleFavorite(id: number): Promise<APIResponse<Song>> {
    return api.post(`/songs/${id}/favorite`)
  },

  // Helper function to get song title from lyrics
  async getTitleFromLyrics(id: number): Promise<string> {
    try {
      const lyricsUrl = getLyricsUrl(`link.${id}.mp3.l`)
      const response = await fetch(lyricsUrl)
      if (response.ok) {
        const lyricsText = await response.text()
        const firstLine = lyricsText.split('\n')[0].trim()
        if (firstLine && firstLine.length > 0 && !firstLine.includes('link.') && !firstLine.includes('mp3')) {
          return firstLine
        }
      }
    } catch (error) {
      // Keep fallback title if lyrics can't be loaded
    }
    return `Song ${id}` // fallback
  },

  // Mock data for development - remove when backend is ready
  async getMockSongs(): Promise<APIResponse<Song[]>> {
    const mockSongs: Song[] = []
    
    // Load last 50 songs (highest numbers) with titles from lyrics for better UX
    const promises = []
    for (let i = 1233; i <= 1282; i++) { // Last 50 songs (1233-1282)
      promises.push(this.getTitleFromLyrics(i))
    }
    
    const last50Titles = await Promise.all(promises)
    
    // Create all songs first, then sort in descending order
    for (let i = 1; i <= 1282; i++) {
      const title = i >= 1233 ? last50Titles[i - 1233] : `Song ${i}`
      
      mockSongs.push({
        id: i,
        title: title,
        filename: `link.${i}.mp3`,
        duration: Math.floor(Math.random() * 300) + 60, // 1-5 minutes
        isFavorite: Math.random() > 0.8,
        lyrics: undefined // Will be loaded separately when needed
      })
    }
    
    // Sort songs in descending order by ID (highest first)
    mockSongs.sort((a, b) => b.id - a.id)
    
    return {
      success: true,
      data: mockSongs
    }
  },

  // Method to update song title on demand
  async updateSongTitle(song: Song): Promise<Song> {
    if (song.title.startsWith('Song ')) {
      const newTitle = await this.getTitleFromLyrics(song.id)
      song.title = newTitle
    }
    return song
  },

  async getMockLyrics(id: number): Promise<APIResponse<string>> {
    // Try to fetch from actual lyrics file first
    try {
      const lyricsUrl = getLyricsUrl(`link.${id}.mp3.l`)
      const response = await fetch(lyricsUrl)
      if (response.ok) {
        const lyrics = await response.text()
        return {
          success: true,
          data: lyrics
        }
      }
    } catch (error) {
      console.warn(`Could not fetch lyrics for song ${id}:`, error)
    }

    // Fallback to mock lyrics
    return {
      success: true,
      data: `Mock lyrics for song ${id}\n\nVerse 1:\nThis is a sample song\nWith some lyrics to show\n\nChorus:\nLa la la la la\nLa la la la la\n\nVerse 2:\nAnother verse here\nWith more content\n\nChorus:\nLa la la la la\nLa la la la la`
    }
  }
}