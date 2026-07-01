/**
 * Synced-lyrics service.
 *
 * Reads time-synced lyrics from the SERVER-side .lrc cache (link.{id}.lrc), populated
 * offline by scripts/karaoke/fetch_synced_lyrics.py. That same-origin file is the primary
 * source — no API call for cached songs. When the cache misses, it falls back to the LRCLIB
 * API (unless disabled via VITE_LRCLIB_FALLBACK=false), so songs not yet in the cache still
 * sync. Results are cached in memory for the session. When neither has synced lyrics, callers
 * fall back to the plain-text lyrics. See KARAOKE.md.
 */
import config, { getSyncedLyricsUrl } from '@/config'
import { songService } from '@/services/songService'
import type { LyricLine, Song } from '@/types'

/** Parse standard LRC text ("[mm:ss.xx] words") into sorted, de-duplicated lyric lines. */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []
  const timeTag = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g

  for (const raw of lrc.split(/\r?\n/)) {
    timeTag.lastIndex = 0
    const tags: number[] = []
    let m: RegExpExecArray | null
    let lastIndex = 0
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

  /**
   * Get synced lyrics for a song: server .lrc cache first, then the LRCLIB API as a
   * fallback (unless disabled). Cached in memory for the session. `duration` sharpens the
   * LRCLIB fallback match when the server cache misses.
   */
  async getSyncedLyrics(song: Song, duration?: number): Promise<LyricLine[] | null> {
    if (this.mem.has(song.id)) return this.mem.get(song.id)!

    let lines = await this.fetchFromServer(song.id)
    if (!lines && config.lrclibFallback) {
      lines = await this.fetchFromLrclib(song, duration)
    }

    this.mem.set(song.id, lines)
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
    try {
      const res = await fetch(`${base}/api/search?q=${encodeURIComponent(title)}`, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) return null
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
      return null
    }
  }
}

export const lyricsService = new LyricsService()
