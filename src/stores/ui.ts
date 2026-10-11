// Cross-page UI panel state (lyrics side panel, visualizer overlay) so views like the
// shared-song Music page can toggle them, not just the bottom player bar.
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

export const useUiStore = defineStore('ui', () => {
  // Lyrics default open on desktop where it's a side panel, closed on mobile where it's
  // a full overlay (matches Tailwind's `lg`, see App.vue).
  const showLyrics = ref(
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  )
  const showVisualizer = ref(false)
  // Move the existing visualizer into the native fullscreen element without
  // creating another audio source or interrupting playback.
  const fullscreenStage = shallowRef<HTMLElement | null>(null)

  function toggleLyrics() {
    showLyrics.value = !showLyrics.value
  }

  function toggleVisualizer() {
    showVisualizer.value = !showVisualizer.value
  }

  return { showLyrics, showVisualizer, fullscreenStage, toggleLyrics, toggleVisualizer }
})
