/**
 * Karaoke availability service.
 *
 * Instrumentals are generated offline (scripts/karaoke) and listed in karaoke_manifest.json
 * served next to the music files. This service fetches that manifest once, caches the set of
 * available song ids, and exposes isAvailable(id) so the UI can enable the karaoke toggle
 * only for songs that actually have an instrumental. Avoids 404-prone per-song probing.
 */
import config, { getKaraokeManifestUrl } from '@/config'

interface KaraokeManifest {
  version: number
  generatedAt?: string
  ids: number[]
}

class KaraokeService {
  private availableIds = new Set<number>()
  private loadPromise: Promise<void> | null = null
  private loaded = false

  /** Kick off (or reuse) the manifest fetch. Safe to call repeatedly. */
  ensureLoaded(): Promise<void> {
    if (!config.karaokeEnabled) return Promise.resolve()
    if (this.loadPromise) return this.loadPromise

    this.loadPromise = (async () => {
      try {
        const res = await fetch(getKaraokeManifestUrl(), { cache: 'no-cache' })
        if (res.ok) {
          const data = (await res.json()) as KaraokeManifest
          if (Array.isArray(data?.ids)) {
            this.availableIds = new Set(data.ids)
          }
        }
      } catch (err) {
        // No manifest (feature not provisioned yet) — treat as "no instrumentals".
        console.warn('Karaoke manifest unavailable:', err)
      } finally {
        this.loaded = true
      }
    })()

    return this.loadPromise
  }

  /** Whether a given song has a generated instrumental. */
  isAvailable(id: number): boolean {
    return this.availableIds.has(id)
  }

  /** True once the manifest fetch has settled (success or failure). */
  isLoaded(): boolean {
    return this.loaded
  }

  /** Number of songs with instrumentals (for diagnostics/UI). */
  get count(): number {
    return this.availableIds.size
  }
}

export const karaokeService = new KaraokeService()
