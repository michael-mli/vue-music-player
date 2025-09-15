import api from './api'
import type { Song, APIResponse } from '@/types'
import config, { getLyricsUrl } from '@/config'

export const songService = {
  // Get the maximum song number from song_number.txt with fallback chain
  async getMaxSongNumber(): Promise<number> {
    const cacheBuster = '?' + Date.now()

    // First try /data/song_number.txt
    try {
      const response = await fetch('/data/song_number.txt' + cacheBuster)
      if (response.ok) {
        const text = await response.text()
        const num = parseInt(text.trim(), 10)
        if (!isNaN(num) && num > 0) {
          return num
        }
      }
    } catch (error) {
      console.warn('Could not fetch /data/song_number.txt:', error)
    }

    // Fallback to /song_number.txt
    try {
      const response = await fetch('/song_number.txt' + cacheBuster)
      if (response.ok) {
        const text = await response.text()
        const num = parseInt(text.trim(), 10)
        if (!isNaN(num) && num > 0) {
          return num
        }
      }
    } catch (error) {
      console.warn('Could not fetch /song_number.txt:', error)
    }

    // Final fallback to 1282 if both files don't exist or are invalid
    console.warn('Using fallback song number 1282')
    return 1282
  },

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
    const maxSongNumber = await this.getMaxSongNumber()

    // Load last 50 songs (highest numbers) with titles from lyrics for better UX
    const promises = []
    const startIndex = Math.max(1, maxSongNumber - 49) // Last 50 songs
    for (let i = startIndex; i <= maxSongNumber; i++) {
      promises.push(this.getTitleFromLyrics(i))
    }

    const last50Titles = await Promise.all(promises)

    // Create all songs first, then sort in descending order
    for (let i = 1; i <= maxSongNumber; i++) {
      const title = i >= startIndex ? last50Titles[i - startIndex] : `Song ${i}`
      
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