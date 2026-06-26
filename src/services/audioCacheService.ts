/**
 * Audio Cache Service
 *
 * Fully downloads upcoming songs into memory (as Blobs exposed via object URLs) so the
 * next track can be played start-to-finish with NO network access. This is what makes
 * background auto-advance reliable in an installed PWA: once backgrounded, the OS throttles
 * the PWA's network, so anything that still needs to fetch (initial load OR mid-song
 * buffering) stalls. A blob URL is entirely in-memory, so it never touches the network.
 */

import type { Song } from '@/types'
import { getMusicUrl } from '@/config'

interface CachedBlob {
  songId: number
  url: string | null            // object URL once fully downloaded
  loading: Promise<void> | null // in-flight download
  error?: string
  oversize?: boolean            // reachable but too large to hold in memory → will stream
  bytes: number
  lastAccessed: number
}

// Songs bigger than this are streamed instead of buffered fully in memory. Keeps the
// device from holding hundreds of MB (the library has DJ-mix files up to ~290MB) while
// still covering normal tracks (avg ~8MB) comfortably.
const MAX_BLOB_BYTES = 50 * 1024 * 1024 // 50MB

class AudioCacheService {
  private cache = new Map<number, CachedBlob>()
  // Full songs live in memory, so keep this small regardless of the element-cache config.
  private readonly maxCacheSize = 4

  /** Fully downloads a song into memory and exposes it as an object URL. */
  async preloadSong(song: Song): Promise<void> {
    const existing = this.cache.get(song.id)
    if (existing) {
      existing.lastAccessed = Date.now()
      if (existing.url || existing.error) return // already resolved
      if (existing.loading) return existing.loading // download in flight
    }

    this.cleanupCache()

    const entry: CachedBlob = {
      songId: song.id,
      url: null,
      loading: null,
      bytes: 0,
      lastAccessed: Date.now()
    }
    this.cache.set(song.id, entry)

    const download = (async () => {
      try {
        const res = await fetch(getMusicUrl(`link.${song.id}.mp3`))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        // Don't pull a huge file (DJ mixes can be hundreds of MB) into memory — mark it
        // reachable-but-oversize so it still plays, just streamed rather than buffered.
        const len = Number(res.headers.get('content-length') || 0)
        if (len > MAX_BLOB_BYTES) {
          entry.oversize = true
          entry.bytes = len
          res.body?.cancel().catch(() => {}) // abort the body so we don't download it
          console.log(`↪️ Song ${song.id} is ${(len / 1048576).toFixed(0)}MB — too large to cache, will stream`)
          return
        }
        const blob = await res.blob()
        // Reject empty / truncated / obviously-not-audio bodies so broken files are skipped
        if (blob.size < 2048) throw new Error(`too small (${blob.size}b)`)
        entry.url = URL.createObjectURL(blob)
        entry.bytes = blob.size
        entry.lastAccessed = Date.now()
        console.log(`🎵 Pre-loaded song ${song.id} (${(blob.size / 1048576).toFixed(1)}MB): ${song.title}`)
      } catch (e) {
        entry.error = String(e)
        console.warn(`⚠️ Failed to pre-load song ${song.id}:`, e)
      } finally {
        entry.loading = null
      }
    })()

    entry.loading = download
    return download
  }

  /** Downloads several songs (used for legacy call sites). */
  async preloadSongs(songs: Song[]): Promise<void> {
    await Promise.allSettled(songs.map(s => this.preloadSong(s)))
  }

  /** True if the song is fully downloaded and ready to play from memory. */
  isCached(songId: number): boolean {
    const c = this.cache.get(songId)
    return !!(c && c.url && !c.error)
  }

  /**
   * True if the song is confirmed playable — either fully cached in memory, or reachable
   * but too large to cache (it'll stream). Either way it's a valid next-up pick; only
   * broken/unreachable files are excluded.
   */
  isPlayable(songId: number): boolean {
    const c = this.cache.get(songId)
    return !!(c && !c.error && (c.url || c.oversize))
  }

  /**
   * Hands the in-memory object URL to the caller and DETACHES it from the cache, so the
   * cache will never revoke a URL that's now driving the audio element. The caller owns
   * revoking it (the player does so when it loads the following track). Returns null if
   * the song isn't fully downloaded.
   */
  takeCachedUrl(songId: number): string | null {
    const c = this.cache.get(songId)
    if (c && c.url && !c.error) {
      this.cache.delete(songId)
      console.log(`🚀 Playing song ${songId} from in-memory cache`)
      return c.url
    }
    return null
  }

  /** Evicts the oldest fully/failed downloads once over the size cap. */
  private cleanupCache(): void {
    if (this.cache.size < this.maxCacheSize) return
    const entries = Array.from(this.cache.entries())
      .filter(([, c]) => !c.loading)
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed)
    const remove = entries.slice(0, Math.max(1, entries.length - this.maxCacheSize + 1))
    for (const [id, c] of remove) {
      if (c.url) URL.revokeObjectURL(c.url)
      this.cache.delete(id)
    }
  }

  getCacheStats() {
    const ready = Array.from(this.cache.values()).filter(c => c.url).length
    const loading = Array.from(this.cache.values()).filter(c => c.loading).length
    const errored = Array.from(this.cache.values()).filter(c => c.error).length
    return { total: this.cache.size, ready, loading, errored, maxSize: this.maxCacheSize }
  }

  clearCache(): void {
    this.cache.forEach(c => { if (c.url) URL.revokeObjectURL(c.url) })
    this.cache.clear()
  }
}

export const audioCacheService = new AudioCacheService()
