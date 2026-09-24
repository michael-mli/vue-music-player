/**
 * Synced-lyrics service.
 *
 * Reads time-synced lyrics from the SERVER-side .lrc cache (link.{id}.lrc), populated
 * offline by scripts/karaoke/fetch_synced_lyrics.py. That same-origin file is the primary
 * source — no API call for cached songs. When the cache misses, it falls back to the LRCLIB
 * API (unless disabled via VITE_LRCLIB_FALLBACK=false), so songs not yet in the cache still
 * sync. Successful results are cached in memory for the session. When neither has synced lyrics, callers
 * fall back to the plain-text lyrics. See KARAOKE.md.
 */
import config, { getSyncedLyricsUrl, hasManualLyrics } from '@/config'
import { songService } from '@/services/songService'
import type { LyricLine, Song } from '@/types'
import { parseLrc } from '@/utils/lyricsTiming'
export { parseLrc, activeLineIndex } from '@/utils/lyricsTiming'

const LRCLIB_TIMEOUT_MS = 10_000
const LRCLIB_RETRY_DELAY_MS = 800
const LRCLIB_MAX_ATTEMPTS = 2

class LyricsService {
  // Cache successful lyrics only; transient failures must remain retryable.
  private mem = new Map<number, LyricLine[]>()
  private inFlight = new Map<number, Promise<LyricLine[] | null>>()

  /**
   * Get synced lyrics for a song: server .lrc cache first, then the LRCLIB API as a
   * fallback (unless disabled). Cached in memory for the session. `duration` sharpens the
   * LRCLIB fallback match when the server cache misses.
   */
  async getSyncedLyrics(song: Song, duration?: number): Promise<LyricLine[] | null> {
    if (song.lyricsMode === 'manual' || hasManualLyrics(song.id)) return null
    const cached = this.mem.get(song.id)
    if (cached) return cached

    // The karaoke screen and global lyrics panel can request the same song together.
    // Share that work while still allowing a later call to retry if this one fails.
    const activeRequest = this.inFlight.get(song.id)
    if (activeRequest) return activeRequest

    const request = this.loadLyrics(song, duration).finally(() => {
      this.inFlight.delete(song.id)
    })
    this.inFlight.set(song.id, request)
    return request
  }

  private async loadLyrics(song: Song, duration?: number): Promise<LyricLine[] | null> {
    let lines = await this.fetchFromServer(song.id)
    if (!lines && config.lrclibFallback) {
      lines = await this.fetchFromLrclib(song, duration)
    }

    if (lines) this.mem.set(song.id, lines)
    return lines
  }

  /** Read the pre-fetched .lrc from the server cache. Null if absent/unparseable. */
  private async fetchFromServer(id: number): Promise<LyricLine[] | null> {
    try {
      const res = await fetch(getSyncedLyricsUrl(id))
      if (!res.ok) return null
      // Missing files fall through nginx's SPA rewrite to index.html (HTML has no
      // [mm:ss] tags), so parseLrc yields [] and we correctly treat it as "no match".
      const parsed = parseLrc(await res.text())
      return parsed.length ? parsed : null
    } catch {
      return null
    }
  }

  /** Fallback: query LRCLIB by title (+ closest duration) for songs not yet cached. */
  private async fetchFromLrclib(song: Song, duration?: number): Promise<LyricLine[] | null> {
    let title = (song.title || '').trim()
    if (!title || title.startsWith('Song ')) {
      title = (await songService.getTitleFromLyrics(song.id)).trim()
    }
    if (!title || title.startsWith('Song ')) return null

    const base = config.lrclibBaseUrl.replace(/\/$/, '')
    for (let attempt = 0; attempt < LRCLIB_MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), LRCLIB_TIMEOUT_MS)
      try {
        const res = await fetch(base + '/api/search?q=' + encodeURIComponent(title), {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('LRCLIB ' + res.status)
        const results = (await res.json()) as Array<{ syncedLyrics?: string | null; duration?: number }>
        if (!Array.isArray(results)) return null
        const withSynced = results.filter((r) => r.syncedLyrics && r.syncedLyrics.trim())
        if (!withSynced.length) return null

        let best = withSynced[0]
        if (duration && duration > 0) {
          best = withSynced.reduce((a, b) => {
            const da = Math.abs((a.duration ?? 0) - duration)
            const db = Math.abs((b.duration ?? 0) - duration)
            return db < da ? b : a
          }, withSynced[0])
        }
        const lines = parseLrc(best.syncedLyrics as string)
        return lines.length ? lines : null
      } catch {
        if (attempt + 1 < LRCLIB_MAX_ATTEMPTS) {
          await new Promise((resolve) => window.setTimeout(resolve, LRCLIB_RETRY_DELAY_MS))
        }
      } finally {
        window.clearTimeout(timeout)
      }
    }
    return null
  }
}

export const lyricsService = new LyricsService()
