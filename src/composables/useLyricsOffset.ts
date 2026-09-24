import { computed, ref, type Ref } from 'vue'
import { LYRICS_OFFSET_KEY, LYRICS_START_LINE_KEY, normalizeLyricsOffset, parseLyricsOffsets, parseLyricsStartLines, type LyricsStartLine } from '@/utils/lyricsOffset'

function loadOffsets() {
  try { return parseLyricsOffsets(localStorage.getItem(LYRICS_OFFSET_KEY)) }
  catch { return {} }
}

// Shared by both lyric views. Storage is touched only at startup and on edits,
// never on playback updates; source lyric arrays remain unchanged.
const offsets = ref(loadOffsets())
const startLines = ref((() => {
  try { return parseLyricsStartLines(localStorage.getItem(LYRICS_START_LINE_KEY)) }
  catch { return {} }
})())
const saveFailed = ref(false)

function persist() {
  try {
    localStorage.setItem(LYRICS_OFFSET_KEY, JSON.stringify(offsets.value))
    localStorage.setItem(LYRICS_START_LINE_KEY, JSON.stringify(startLines.value))
    saveFailed.value = false
  } catch { saveFailed.value = true }
}

export function useLyricsOffset(songId: Readonly<Ref<number | undefined>>) {
  const offset = computed(() => songId.value === undefined ? 0 : offsets.value[String(songId.value)] ?? 0)
  const startLine = computed(() => songId.value === undefined ? undefined : startLines.value[String(songId.value)])

  function setOffset(seconds: number, reference?: LyricsStartLine) {
    const id = songId.value
    if (id === undefined || !Number.isFinite(seconds)) return
    const next = { ...offsets.value }
    const value = normalizeLyricsOffset(seconds)
    if (value === 0) delete next[String(id)]
    else next[String(id)] = value
    offsets.value = next
    if (reference) startLines.value = { ...startLines.value, [String(id)]: { time: reference.time, text: reference.text } }
    persist()
  }

  function setStartLine(line: LyricsStartLine) {
    if (songId.value === undefined) return
    startLines.value = { ...startLines.value, [String(songId.value)]: { time: line.time, text: line.text } }
    persist()
  }

  return { offset, setOffset, startLine, setStartLine, saveFailed }
}
