import api from './api'
import type { Song, APIResponse } from '@/types'
import config, { getLyricsUrl } from '@/config'

export const songService = {
  // Title cache backed by localStorage — avoids per-song network fetches during playback
  _titleCache: null as Map<number, string> | null,
  _TITLE_CACHE_KEY: 'music-player-title-cache',

  _loadTitleCache(): Map<number, string> {
    if (this._titleCache) return this._titleCache
    try {
      const raw = localStorage.getItem(this._TITLE_CACHE_KEY)
      this._titleCache = raw ? new Map(JSON.parse(raw) as [number, string][]) : new Map()
    } catch {
      this._titleCache = new Map()
    }
    return this._titleCache
  },

  _saveTitleCache() {
    if (!this._titleCache) return
    localStorage.setItem(this._TITLE_CACHE_KEY, JSON.stringify([...this._titleCache]))
  },

  getCachedTitle(id: number): string | undefined {
    return this._loadTitleCache().get(id)
  },
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
    // Return cached title if available
    const cached = this.getCachedTitle(id)
    if (cached) return cached

    try {
      const lyricsUrl = getLyricsUrl(`link.${id}.mp3.l`)
      const response = await fetch(lyricsUrl)
      if (response.ok) {
        const lyricsText = await response.text()
        const firstLine = lyricsText.split('\n')[0].trim()
        if (firstLine && firstLine.length > 0 && !firstLine.includes('link.') && !firstLine.includes('mp3')) {
          // Cache the title
          this._loadTitleCache().set(id, firstLine)
          this._saveTitleCache()
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
    const cache = this._loadTitleCache()

    // Build song list immediately using cached titles (no blocking network calls)
    for (let i = 1; i <= maxSongNumber; i++) {
      mockSongs.push({
        id: i,
        title: cache.get(i) || `Song ${i}`,
        filename: `link.${i}.mp3`,
        duration: Math.floor(Math.random() * 300) + 60,
        isFavorite: Math.random() > 0.8,
        lyrics: undefined
      })
    }

    mockSongs.sort((a, b) => b.id - a.id)

    return {
      success: true,
      data: mockSongs
    }
  },

  // Fetch titles for songs not yet in cache. Calls onProgress(fetched, total) after each batch.
  // Returns the IDs that were fetched.
  async fetchUncachedTitles(
    maxSongNumber: number,
    onProgress?: (fetched: number, total: number) => void
  ): Promise<number[]> {
    const cache = this._loadTitleCache()
    const uncachedIds: number[] = []
    for (let i = maxSongNumber; i >= 1; i--) {
      if (!cache.has(i)) uncachedIds.push(i)
    }
    if (uncachedIds.length === 0) return []

    console.log(`Fetching titles for ${uncachedIds.length} new songs...`)
    const BATCH = 50
    let fetched = 0
    for (let b = 0; b < uncachedIds.length; b += BATCH) {
      const batch = uncachedIds.slice(b, b + BATCH)
      await Promise.all(batch.map(id => this.getTitleFromLyrics(id)))
      fetched += batch.length
      onProgress?.(fetched, uncachedIds.length)
    }
    return uncachedIds
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