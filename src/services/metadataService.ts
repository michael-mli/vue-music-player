// Loads the song metadata index (/data/metadata.json) built offline by
// scripts/build_metadata.py — artist / album / year / genre / language / duration per id.
// Missing file is fine: search simply falls back to title-only filtering.
import type { SongMeta } from '@/types'

export const metadataService = {
  async load(): Promise<Map<number, SongMeta>> {
    const map = new Map<number, SongMeta>()
    // Hourly cache-buster: metadata changes rarely (admin batch runs), file can be ~100KB+
    const bust = Math.floor(Date.now() / 3600000)
    // Same fallback chain style as song_number.txt: /data/ first, then web root
    for (const url of ['/data/metadata.json', '/metadata.json']) {
      try {
        const response = await fetch(`${url}?v=${bust}`)
        if (!response.ok) continue
        const json = await response.json()
        const entries = (json && typeof json === 'object' && json.songs) ? json.songs : json
        for (const [key, value] of Object.entries(entries || {})) {
          const id = parseInt(key, 10)
          if (Number.isInteger(id) && id > 0 && value && typeof value === 'object') {
            map.set(id, value as SongMeta)
          }
        }
        if (map.size > 0) return map
      } catch {
        // try next location — no metadata yet just means title-only search
      }
    }
    return map
  }
}
