/**
 * Audio Cache Service
 * Pre-loads audio files to improve playback experience by eliminating network delays
 */

import type { Song } from '@/types'
import { getMusicUrl } from '@/config'
import config from '@/config'

interface CachedAudio {
  songId: number
  audio: HTMLAudioElement
  isLoaded: boolean
  isLoading: boolean
  lastAccessed: number
  error?: string
}

class AudioCacheService {
  private cache = new Map<number, CachedAudio>()
  private readonly maxCacheSize: number
  private readonly preloadCount = 2 // Number of songs to pre-load ahead

  constructor() {
    this.maxCacheSize = config.maxCachedSongs
  }

  /**
   * Pre-loads audio for upcoming songs
   */
  async preloadSongs(upcomingSongs: Song[]): Promise<void> {
    const songsToPreload = upcomingSongs.slice(0, this.preloadCount)
    
    // Start preloading in parallel
    const preloadPromises = songsToPreload.map(song => this.preloadSong(song))
    await Promise.allSettled(preloadPromises)
  }

  /**
   * Pre-loads a single song
   */
  private async preloadSong(song: Song): Promise<void> {
    // Skip if already cached or currently loading
    const existing = this.cache.get(song.id)
    if (existing && (existing.isLoaded || existing.isLoading)) {
      existing.lastAccessed = Date.now()
      return
    }

    // Clean up cache if needed
    this.cleanupCache()

    // Create new audio element for preloading
    const audio = new Audio()
    const cachedEntry: CachedAudio = {
      songId: song.id,
      audio,
      isLoaded: false,
      isLoading: true,
      lastAccessed: Date.now()
    }

    this.cache.set(song.id, cachedEntry)

    return new Promise((resolve) => {
      const handleLoad = () => {
        cachedEntry.isLoaded = true
        cachedEntry.isLoading = false
        cachedEntry.lastAccessed = Date.now()
        console.log(`🎵 Pre-loaded song ${song.id}: ${song.title}`)
        cleanup()
        resolve()
      }

      const handleError = (error: Event) => {
        cachedEntry.isLoading = false
        cachedEntry.error = `Failed to preload song ${song.id}`
        console.warn(`⚠️ Failed to pre-load song ${song.id}:`, error)
        cleanup()
        resolve() // Resolve anyway, don't block other preloads
      }

      const cleanup = () => {
        audio.removeEventListener('canplaythrough', handleLoad)
        audio.removeEventListener('error', handleError)
        audio.removeEventListener('abort', handleError)
      }

      // Set up event listeners
      audio.addEventListener('canplaythrough', handleLoad)
      audio.addEventListener('error', handleError)
      audio.addEventListener('abort', handleError)

      // Start loading
      audio.preload = 'auto'
      audio.src = getMusicUrl(`link.${song.id}.mp3`)
      audio.load()
    })
  }

  /**
   * Gets a cached audio element if available
   */
  getCachedAudio(songId: number): HTMLAudioElement | null {
    const cached = this.cache.get(songId)
    if (cached && cached.isLoaded && !cached.error) {
      cached.lastAccessed = Date.now()
      console.log(`🚀 Using cached audio for song ${songId}`)
      return cached.audio
    }
    return null
  }

  /**
   * Transfers properties from one audio element to another
   */
  transferAudioState(fromAudio: HTMLAudioElement, toAudio: HTMLAudioElement): void {
    toAudio.volume = fromAudio.volume
    toAudio.muted = fromAudio.muted
    toAudio.currentTime = fromAudio.currentTime
  }

  /**
   * Removes a song from cache (called when song starts playing to free memory)
   */
  removeSongFromCache(songId: number): void {
    const cached = this.cache.get(songId)
    if (cached) {
      // Don't actually remove immediately, let it stay for potential replay
      // Just mark it as less priority for cleanup
      cached.lastAccessed = Date.now() - (24 * 60 * 60 * 1000) // Make it old
    }
  }

  /**
   * Cleans up old entries when cache is full
   */
  private cleanupCache(): void {
    if (this.cache.size < this.maxCacheSize) {
      return
    }

    // Remove oldest entries that aren't currently loading
    const entries = Array.from(this.cache.entries())
      .filter(([_, cached]) => !cached.isLoading)
      .sort(([_, a], [__, b]) => a.lastAccessed - b.lastAccessed)

    const entriesToRemove = entries.slice(0, Math.max(1, entries.length - this.maxCacheSize + 5))
    
    entriesToRemove.forEach(([songId, cached]) => {
      cached.audio.src = '' // Free memory
      this.cache.delete(songId)
      console.log(`🗑️ Removed cached audio for song ${songId}`)
    })
  }

  /**
   * Gets cache statistics for debugging
   */
  getCacheStats() {
    const loaded = Array.from(this.cache.values()).filter(c => c.isLoaded).length
    const loading = Array.from(this.cache.values()).filter(c => c.isLoading).length
    const errored = Array.from(this.cache.values()).filter(c => c.error).length
    
    return {
      total: this.cache.size,
      loaded,
      loading,
      errored,
      maxSize: this.maxCacheSize
    }
  }

  /**
   * Clears all cached audio
   */
  clearCache(): void {
    this.cache.forEach(cached => {
      cached.audio.src = ''
    })
    this.cache.clear()
    console.log('🗑️ Cleared all cached audio')
  }
}

// Export singleton instance
export const audioCacheService = new AudioCacheService()