import type { LyricLine, LyricWord } from '../types'

/** Standard LRC, repeated line tags, and enhanced LRC word/segment tags. */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []
  // Positive LRC offsets move lyrics earlier.
  const offset = Number(lrc.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000
  const tagPattern = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]|<(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?>/g
  for (const raw of lrc.split(/\r?\n/)) {
    const tags = [...raw.matchAll(tagPattern)].map((match) => {
      const fraction = match[3] ?? match[6] ?? '0'
      return {
        time: Number(match[1] ?? match[4]) * 60 + Number(match[2] ?? match[5])
          + Number(fraction) / 10 ** fraction.length - offset,
        start: match.index!,
        end: match.index! + match[0].length,
        word: match[0][0] === '<',
      }
    })
    if (!tags.length || tags[0].word) continue
    const text = raw.slice(tags[0].end).replace(tagPattern, '').trim()
    const enhanced = tags.some((tag, i) => tag.word ||
      (i > 0 && raw.slice(tags[i - 1].end, tag.start).trim().length > 0))
    if (!enhanced) {
      for (const tag of tags) lines.push({ time: Math.max(0, tag.time), text })
      continue
    }

    const words: LyricWord[] = []
    for (let i = 0; i < tags.length; i++) {
      const segment = raw.slice(tags[i].end, tags[i + 1]?.start ?? raw.length)
      if (!segment) continue
      words.push({
        time: Math.max(0, tags[i].time),
        text: segment,
        ...(tags[i + 1] ? { endTime: Math.max(0, tags[i + 1].time) } : {}),
      })
    }
    const last = tags[tags.length - 1]
    const explicitEnd = tags.length > 1 && !raw.slice(last.end).trim()
    const ordered = tags.every((tag, i) => !i || tag.time >= tags[i - 1].time)
    lines.push({
      time: Math.max(0, tags[0].time), text,
      ...(ordered && words.length ? { words } : {}),
      ...(ordered && explicitEnd ? { endTime: Math.max(0, last.time) } : {}),
    })
  }
  return lines.sort((a, b) => a.time - b.time)
}

/** Last line at or before the playhead; -1 during the intro. */
export function activeLineIndex(lines: LyricLine[], currentTime: number): number {
  let lo = 0
  let hi = lines.length - 1
  let result = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= currentTime) {
      result = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return result
}

/** Do not invent vocal end times or instrumental breaks from long line intervals. */
export function singingGuideState(lines: LyricLine[], playbackTime: number, duration = 0, offset = 0) {
  // Keep audio and lyric clocks separate: a positive offset delays every cue.
  const time = playbackTime - offset
  const index = activeLineIndex(lines, time)
  const line = lines[index]
  const ended = duration > 0 && playbackTime >= duration
  const singing = !ended && !!line?.text.trim() &&
    (line.endTime === undefined || time < line.endTime)
  // Only visit the nearby preview lines. Mapping/filtering the full song here
  // allocates and subscribes to every lyric on each audio timeupdate.
  const upcoming: Array<{ line: LyricLine; index: number }> = []
  for (let next = index + 1; next < lines.length && upcoming.length < 2; next++) {
    if (lines[next].text.trim()) upcoming.push({ line: lines[next], index: next })
  }
  let previous = singing ? index - 1 : index
  while (previous >= 0 && !lines[previous].text.trim()) previous--
  const end = line?.endTime ?? lines[index + 1]?.time ?? (duration > 0 ? duration - offset : 0)
  const progress = singing && end > line.time
    ? Math.max(0, Math.min(1, (time - line.time) / (end - line.time))) : 0
  return {
    index, singing, previous, upcoming, progress,
    end: end > (line?.time ?? 0) ? end : undefined,
    finished: ended || (!singing && upcoming.length === 0),
    countdown: !ended && !singing && upcoming.length
      ? Math.max(0, Math.ceil(upcoming[0].line.time - time)) : 0,
  }
}
