import type { LyricLine } from '../types'

// Allow long intros/recordings while still rejecting pathological stored values.
export const MAX_LYRICS_OFFSET = 24 * 60 * 60
export const LYRICS_OFFSET_KEY = 'music-player-lyrics-offsets'
export const LYRICS_START_LINE_KEY = 'music-player-lyrics-start-lines'
export type LyricsStartLine = Pick<LyricLine, 'time' | 'text'>

export function singingLineTime(line: LyricLine): number {
  return line.words?.find((word) => word.text.trim())?.time ?? line.time
}

/** Positive offsets delay lyrics; negative offsets make them appear earlier. */
export function normalizeLyricsOffset(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0
  return Math.round(Math.max(-MAX_LYRICS_OFFSET, Math.min(MAX_LYRICS_OFFSET, seconds)) * 10) / 10
}

export function parseLyricsOffsets(raw: string | null): Record<string, number> {
  try {
    const data: unknown = JSON.parse(raw ?? '{}')
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    return Object.fromEntries(Object.entries(data)
      .filter(([id, value]) => /^\d+$/.test(id) && typeof value === 'number' && Number.isFinite(value))
      .map(([id, value]) => [id, normalizeLyricsOffset(value as number)]))
  } catch { return {} }
}

/** Convert a source lyric timestamp back to the audio timeline for click/replay. */
export function lyricSeekTime(time: number, offset: number, duration = 0, leadIn = 0): number {
  const target = Math.max(0, time + offset - leadIn)
  return duration > 0 ? Math.min(duration, target) : target
}

/** Convert the observed vocal entry to an absolute correction, never add it twice. */
export function offsetFromSingingStart(lineTime: number, singingStart: number, duration = 0): number | null {
  if (!Number.isFinite(lineTime) || !Number.isFinite(singingStart) || lineTime < 0 || singingStart < 0) return null
  if (duration > 0 && singingStart > duration) return null
  const difference = singingStart - lineTime
  if (Math.abs(difference) > MAX_LYRICS_OFFSET) return null
  return normalizeLyricsOffset(difference)
}

export function parseLyricsStartLines(raw: string | null): Record<string, LyricsStartLine> {
  try {
    const data: unknown = JSON.parse(raw ?? '{}')
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    const result: Record<string, LyricsStartLine> = {}
    for (const [id, value] of Object.entries(data)) {
      if (!/^\d+$/.test(id) || !value || typeof value !== 'object') continue
      const line = value as Partial<LyricsStartLine>
      if (typeof line.time === 'number' && Number.isFinite(line.time) && line.time >= 0 &&
        typeof line.text === 'string' && line.text.trim()) result[id] = { time: line.time, text: line.text }
    }
    return result
  } catch { return {} }
}

/** Prefer the saved reference, otherwise skip empty lines and common opening credits. */
export function singingStartLineIndex(lines: LyricLine[], saved?: LyricsStartLine): number {
  if (saved) {
    const exact = lines.findIndex((line) => line.time === saved.time && line.text === saved.text)
    if (exact >= 0) return exact
  }
  const credit = /^(?:作[词詞曲]|[词詞曲]|[编編][曲詞词]|[编編]配|混音|母带|母帶|制作人|製作人|录音|錄音|演唱|歌手|出品|发行|發行|监制|監製|策划|策劃|统筹|統籌|吉他|贝斯|貝斯|和声|和聲|封面|lyrics?|composer|composed by|words by|written by|music|artist|album|title|arrang(?:er|ement)|producer|vocals?)\s*[:：]/i
  const section = /^(?:[（(\[]\s*)?(?:intro|instrumental|verse\s*\d*|chorus|前奏|间奏|間奏)(?:\s*[）)\]])?$/i
  const first = lines.findIndex((line) => line.text.trim() && !credit.test(line.text.trim()) && !section.test(line.text.trim()))
  return first >= 0 ? first : lines.findIndex((line) => line.text.trim())
}
