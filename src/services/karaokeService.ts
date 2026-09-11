/**
 * Karaoke availability service.
 *
 * Instrumentals are generated offline (scripts/karaoke) and listed in karaoke_manifest.json
 * served next to the music files. This service refreshes that manifest periodically, caches the set of
 * available song ids, and exposes isAvailable(id) so the UI can enable the karaoke toggle
 * only for songs that actually have an instrumental. Avoids 404-prone per-song probing.
 */
import config, { getKaraokeManifestUrl } from '@/config'
import { shallowRef } from 'vue'

interface KaraokeManifest {
  version: number
  generatedAt?: string
  ids: number[]
}

class KaraokeService {
  private availableIds = shallowRef(new Set<number>())
  private loadPromise: Promise<void> | null = null
  private loaded = false
  private lastFetched = 0
  private refreshTimer: number | null = null

  /** Kick off (or reuse) the manifest fetch. Safe to call repeatedly. */
  ensureLoaded(): Promise<void> {
    if (!config.karaokeEnabled) return Promise.resolve()
    // Automatic ingestion can publish an instrumental while the app stays open.
    // Refresh visible sessions and make membership reactive for player controls.
    if (this.refreshTimer === null && typeof window !== 'undefined') {
      this.refreshTimer = window.setInterval(() => {
        if (!document.hidden) void this.ensureLoaded()
      }, 60000)
    }
    if (this.loadPromise) return this.loadPromise
    if (Date.now() - this.lastFetched < 60000) return Promise.resolve()
    this.lastFetched = Date.now()

    this.loadPromise = (async () => {
      try {
        const res = await fetch(getKaraokeManifestUrl(), { cache: 'no-cache' })
        if (res.ok) {
          const data = (await res.json()) as KaraokeManifest
          if (Array.isArray(data?.ids)) {
            this.availableIds.value = new Set(data.ids)
          }
        }
      } catch (err) {
        // No manifest (feature not provisioned yet) — treat as "no instrumentals".
        console.warn('Karaoke manifest unavailable:', err)
      } finally {
        this.loaded = true
        this.loadPromise = null
      }
    })()

    return this.loadPromise
  }

  /** Whether a given song has a generated instrumental. */
  isAvailable(id: number): boolean {
    return this.availableIds.value.has(id)
  }

  /** True once the manifest fetch has settled (success or failure). */
  isLoaded(): boolean {
    return this.loaded
  }

  /** Number of songs with instrumentals (for diagnostics/UI). */
  get count(): number {
    return this.availableIds.value.size
  }
}

export const karaokeService = new KaraokeService()
