import { computed, ref, type Ref } from 'vue'

/** Keep selections across search results and pages, in the order they were picked. */
export function useSongSelection<T extends { id: number }>(queued: (id: number) => boolean) {
  const selected = ref(new Map<number, T>()) as Ref<Map<number, T>>
  const selectedSongs = computed(() => Array.from(selected.value.values()))
  function toggle(song: T) {
    if (selected.value.has(song.id)) selected.value.delete(song.id)
    else if (!queued(song.id)) selected.value.set(song.id, song)
  }
  function selectPage(songs: T[]) {
    const eligible = songs.filter(song => !queued(song.id))
    const allSelected = eligible.length > 0 && eligible.every(song => selected.value.has(song.id))
    for (const song of eligible) {
      if (allSelected) selected.value.delete(song.id)
      else if (!selected.value.has(song.id)) toggle(song)
    }
  }
  return { selected, selectedSongs, toggle, selectPage }
}
