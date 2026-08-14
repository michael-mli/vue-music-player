/**
 * Lyrics display mode, shared by LyricsPanel (regular play) and the Karaoke screen.
 *
 * Two modes:
 *  - "auto"   (default): render time-synced lyrics line-by-line when available, falling
 *                        back to the plain lyric file when the song has no sync data.
 *  - "manual": always show the original plain-text lyric file, even when synced lyrics
 *              exist for the song. Useful when the synced/karaoke timing feels off.
 *
 * Persisted in localStorage and wired to a single shared ref so a toggle in one screen
 * (karaoke or regular play) immediately carries over to the other.
 */
import { ref } from 'vue'

export type LyricsMode = 'auto' | 'manual'

const STORAGE_KEY = 'lyrics-mode'

const mode = ref<LyricsMode>(
  typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'manual'
    ? 'manual'
    : 'auto'
)

export function useLyricsMode() {
  function setMode(next: LyricsMode) {
    mode.value = next
    localStorage.setItem(STORAGE_KEY, next)
  }

  return { mode, setMode }
}