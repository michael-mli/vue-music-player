/**
 * Synced-lyrics service.
 *
 * Reads time-synced lyrics from the SERVER-side .lrc cache (link.{id}.lrc), populated
 * offline by scripts/karaoke/fetch_synced_lyrics.py. The browser never calls the LRCLIB API
 * at runtime — it just fetches a small same-origin file. Parsed results (incl. misses) are
 * cached in memory for the session. When there's no synced .lrc, callers fall back to the
 * plain-text lyrics. See KARAOKE.md.
 */
import { getSyncedLyricsUrl } from '@/config'
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
   * Get synced lyrics for a song from the server .lrc cache, or null if none exist.
   * Cached in memory for the session. The `_duration` param is accepted for call-site
   * compatibility but unused (the server already picked the best match).
   */
  async getSyncedLyrics(song: Song, _duration?: number): Promise<LyricLine[] | null> {
    if (this.mem.has(song.id)) return this.mem.get(song.id)!

    let lines: LyricLine[] | null = null
    try {
      const res = await fetch(getSyncedLyricsUrl(song.id))
      if (res.ok) {
        // Missing files fall through nginx's SPA rewrite to index.html (HTML has no
        // [mm:ss] tags), so parseLrc yields [] and we correctly treat it as "no match".
        const parsed = parseLrc(await res.text())
        lines = parsed.length ? parsed : null
      }
    } catch {
      lines = null
    }

    this.mem.set(song.id, lines)
    return lines
  }
}

export const lyricsService = new LyricsService()
