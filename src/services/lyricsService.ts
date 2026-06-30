/**
 * Synced-lyrics service (LRCLIB).
 *
 * Fetches time-synced lyrics from LRCLIB (https://lrclib.net), a free, no-auth synced-lyrics
 * API, parses the LRC into LyricLine[], and caches results (including misses) in localStorage.
 *
 * Honest limitation: LRCLIB matches on metadata (artist + title + duration). This catalog has
 * no artist and titles are derived from the first lyric line, so match rate is modest. When no
 * synced lyrics are found, callers fall back to the existing plain-text lyrics. See KARAOKE.md.
 */
import config from '@/config'
import { songService } from '@/services/songService'
import type { LyricLine, Song } from '@/types'

const CACHE_KEY = 'music-player-synced-lyrics'
const CACHE_VERSION = 1

interface CacheEntry {
  v: number
  lines: LyricLine[] | null // null = looked up, none found
}

/** Parse standard LRC text ("[mm:ss.xx] words") into sorted, de-duplicated lyric lines. */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []
  const timeTag = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g

  for (const raw of lrc.split(/\r?\n/)) {
    timeTag.lastIndex = 0
    const tags: number[] = []
    let m: RegExpExecArray | null
    let lastIndex = 0
    // A line may carry multiple timestamps that share the same text.
    while ((m = timeTag.exec(raw)) !== null) {
      const min = parseInt(m[1], 10)
      const sec = parseInt(m[2], 10)
      const fracStr = m[3] ?? '0'
      const frac = parseInt(fracStr, 10) / Math.pow(10, fracStr.length)
      tags.push(min * 60 + sec + frac)
      lastIndex = timeTag.lastIndex
    }
    if (!tags.length) continue
    const text = raw.slice(lastIndex).trim()
    for (const time of tags) lines.push({ time, text })
  }

  lines.sort((a, b) => a.time - b.time)
  return lines
}

/** Find the index of the active line for a given playback time (binary search). -1 if before first. */
export function activeLineIndex(lines: LyricLine[], currentTime: number): number {
  let lo = 0
  let hi = lines.length - 1
  let result = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= currentTime) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}

class LyricsService {
  private mem = new Map<number, LyricLine[] | null>()
  private cache: Record<string, CacheEntry> | null = null

  private loadCache(): Record<string, CacheEntry> {
    if (this.cache) return this.cache
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      this.cache = raw ? (JSON.parse(raw) as Record<string, CacheEntry>) : {}
    } catch {
      this.cache = {}
    }
    return this.cache
  }

  private saveCache() {
    if (!this.cache) return
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(this.cache))
    } catch {
      /* quota — ignore */
    }
  }

  /**
   * Get synced lyrics for a song, or null if none are available. Cached (incl. misses).
   * `duration` (seconds) sharpens the LRCLIB match when known.
   */
  async getSyncedLyrics(song: Song, duration?: number): Promise<LyricLine[] | null> {
    if (!config.karaokeEnabled) return null
    if (this.mem.has(song.id)) return this.mem.get(song.id)!

    const cache = this.loadCache()
    const cached = cache[song.id]
    if (cached && cached.v === CACHE_VERSION) {
      this.mem.set(song.id, cached.lines)
      return cached.lines
    }

    const lines = await this.fetchFromLrclib(song, duration)
    this.mem.set(song.id, lines)
    cache[song.id] = { v: CACHE_VERSION, lines }
    this.saveCache()
    return lines
  }

  private async fetchFromLrclib(song: Song, duration?: number): Promise<LyricLine[] | null> {
    let title = (song.title || '').trim()
    // Title may still be the "Song N" placeholder if it hasn't been resolved yet — resolve
    // it from the lyrics file (first line) so the LRCLIB match isn't skipped.
    if (!title || title.startsWith('Song ')) {
      title = (await songService.getTitleFromLyrics(song.id)).trim()
    }
    if (!title || title.startsWith('Song ')) return null // no usable metadata to match on

    const base = config.lrclibBaseUrl.replace(/\/$/, '')
    try {
      // Search by track name; pick the best result that actually has synced lyrics.
      const url = `${base}/api/search?q=${encodeURIComponent(title)}`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) return null
      const results = (await res.json()) as Array<{
        syncedLyrics?: string | null
        duration?: number
      }>
      if (!Array.isArray(results) || !results.length) return null

      const withSynced = results.filter((r) => r.syncedLyrics && r.syncedLyrics.trim())
      if (!withSynced.length) return null

      // Prefer the closest duration match when we know the song's duration.
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
    } catch (err) {
      console.warn(`LRCLIB lookup failed for "${title}":`, err)
      return null
    }
  }
}

export const lyricsService = new LyricsService()
