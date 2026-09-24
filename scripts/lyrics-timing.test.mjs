import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Exercise the pure timing module without booting Vue or depending on Node's TS support.
const source = await readFile(new URL('../src/utils/lyricsTiming.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
})
const { parseLrc, activeLineIndex, singingGuideState } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)
const offsetSource = await readFile(new URL('../src/utils/lyricsOffset.ts', import.meta.url), 'utf8')
const offsetModule = ts.transpileModule(offsetSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
})
const { normalizeLyricsOffset, parseLyricsOffsets, lyricSeekTime, MAX_LYRICS_OFFSET,
  offsetFromSingingStart, singingStartLineIndex, parseLyricsStartLines, singingLineTime } = await import(
  `data:text/javascript;base64,${Buffer.from(offsetModule.outputText).toString('base64')}`
)

test('standard LRC preserves repeated lines, blank breaks, fractions, and offsets', () => {
  assert.deepEqual(parseLrc('[ar:Artist]\n[offset:200]\n[00:10.50][00:20.500]Hello\n[00:15.00]\n[00:00.1]Start'), [
    { time: 0, text: 'Start' }, { time: 10.3, text: 'Hello' },
    { time: 14.8, text: '' }, { time: 20.3, text: 'Hello' },
  ])
})

test('enhanced LRC preserves real segment timing and an explicit vocal end', () => {
  const [line] = parseLrc('[offset:500]\n[00:10.00]<00:10.00>Hello <00:11.00>world<00:12.00>')
  assert.deepEqual(line, {
    time: 9.5, text: 'Hello world', endTime: 11.5,
    words: [{ time: 9.5, text: 'Hello ', endTime: 10.5 }, { time: 10.5, text: 'world', endTime: 11.5 }],
  })
  assert.equal(singingGuideState([line, { time: 20, text: 'Next' }], 12, 30).countdown, 8)
})

test('inline square timestamps highlight words without duplicating the sentence', () => {
  const [line] = parseLrc('[00:01]你[00:02]好[00:03]')
  assert.equal(line.text, '你好')
  assert.equal(line.words.length, 2)
  assert.equal(line.words[1].time, 2)
  assert.equal(line.endTime, 3)
  assert.equal(parseLrc('[00:01]Hello <00:02>world')[0].words[0].text, 'Hello ')
})

test('malformed backward word timing falls back to readable line timing', () => {
  const [line] = parseLrc('[00:01]<00:03>Hello <00:02>world')
  assert.equal(line.text, 'Hello world')
  assert.equal(line.words, undefined)
  assert.equal(parseLrc('[00:01]<00:03>Hello<00:02>')[0].endTime, undefined)
})

const lines = parseLrc('[00:10]First\n[00:15]Second\n[00:20]\n[00:30]Third\n[00:35]Fourth\n[00:40]')
test('intro gives an exact countdown and upcoming lyrics', () => {
  const state = singingGuideState(lines, 6.2, 45)
  assert.equal(state.index, -1)
  assert.equal(state.singing, false)
  assert.equal(state.countdown, 4)
  assert.deepEqual(state.upcoming.map(({ line }) => line.text), ['First', 'Second'])
})

test('line changes occur at their timestamps; progress and backward seeks stay correct', () => {
  assert.equal(activeLineIndex(lines, 9.99), -1)
  assert.equal(activeLineIndex(lines, 10), 0)
  assert.equal(activeLineIndex(lines, 15), 1)
  assert.equal(singingGuideState(lines, 12.5, 45).progress, .5)
  assert.equal(singingGuideState(lines, 32, 45).previous, 1)
  assert.equal(singingGuideState(lines, 10, 45).progress, 0)
})

test('explicit breaks count down; long line intervals do not invent a break', () => {
  const state = singingGuideState(lines, 22, 45)
  assert.equal(state.singing, false)
  assert.equal(state.countdown, 8)
  assert.equal(state.previous, 1)
  assert.equal(state.upcoming[0].line.text, 'Third')
  assert.equal(singingGuideState([{ time: 0, text: 'Long phrase' }, { time: 30, text: 'Next' }], 22, 40).singing, true)
})

test('outro, end of playback, missing duration, and empty lyrics stay bounded', () => {
  assert.equal(singingGuideState(lines, 41, 45).finished, true)
  assert.equal(singingGuideState(lines, 45, 45).countdown, 0)
  const lastLine = [{ time: 10, text: 'Last' }]
  assert.equal(singingGuideState(lastLine, 20, 20).finished, true)
  assert.equal(singingGuideState(lastLine, 12).progress, 0)
  assert.equal(singingGuideState([], 0).finished, true)
})

test('playback updates inspect nearby lyrics rather than scanning a long transcript', () => {
  let reads = 0
  const transcript = new Proxy(Array.from({ length: 10_000 }, (_, i) => ({ time: i * 5, text: `Line ${i}` })), {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++
      return Reflect.get(target, key, receiver)
    },
  })
  const state = singingGuideState(transcript, 25002, 50000)
  assert.equal(state.index, 5000)
  assert.deepEqual(state.upcoming.map(({ index }) => index), [5001, 5002])
  assert.ok(reads < 40, `Expected a bounded lookup, observed ${reads} lyric reads`)
})

test('positive user offsets delay lyrics and negative offsets advance them', () => {
  assert.equal(singingGuideState(lines, 11, 45, 2).index, -1)
  assert.equal(singingGuideState(lines, 11, 45, 2).countdown, 1)
  assert.equal(singingGuideState(lines, 8, 45, -2).index, 0)
  assert.equal(singingGuideState(lines, 17, 45, 2).index, 1)
  assert.equal(singingGuideState(lines, 14.5, 45, 2).progress, .5)
  assert.equal(singingGuideState(lines, 1, 45, 2).index, -1)
})

test('offsets also shift explicit vocal ends and breaks, without extending the audio', () => {
  const enhanced = parseLrc('[00:10]<00:10>Hello<00:12>\n[00:20]Next')
  assert.equal(singingGuideState(enhanced, 13, 30, 2).singing, true)
  assert.equal(singingGuideState(enhanced, 14, 30, 2).countdown, 8)
  assert.equal(singingGuideState(enhanced, 30, 30, 120).finished, true)
  assert.equal(singingGuideState(enhanced, 30, 30, 120).countdown, 0)
  const last = [{ time: 10, text: 'Last line' }]
  assert.equal(singingGuideState(last, 16, 20, 2).progress, .5)
  assert.equal(singingGuideState(last, 14, 20, -2).progress, .5)
})

test('line seeking and replay translate back to audio time and clamp to the track', () => {
  assert.equal(lyricSeekTime(10, 2, 60), 12)
  assert.equal(lyricSeekTime(10, -2, 60), 8)
  assert.equal(lyricSeekTime(10, 2, 60, 2), 10)
  assert.equal(lyricSeekTime(1, -5, 60), 0)
  assert.equal(lyricSeekTime(59, 5, 60), 60)
  assert.equal(lyricSeekTime(59, 5), 64)
})

test('offset settings round, clamp and tolerate invalid persisted data', () => {
  assert.equal(normalizeLyricsOffset(.30000000000004), .3)
  assert.equal(normalizeLyricsOffset(300), 300)
  assert.equal(normalizeLyricsOffset(MAX_LYRICS_OFFSET + 1), MAX_LYRICS_OFFSET)
  assert.equal(normalizeLyricsOffset(-MAX_LYRICS_OFFSET - 1), -MAX_LYRICS_OFFSET)
  assert.equal(normalizeLyricsOffset(NaN), 0)
  assert.deepEqual(parseLyricsOffsets('{"42":1.2,"43":-2,"44":999,"45":"bad","bad":2}'), { 42: 1.2, 43: -2, 44: 999 })
  for (const raw of [null, 'bad json', 'null', '[]', '42']) assert.deepEqual(parseLyricsOffsets(raw), {})
})

test('absolute singing start calculates the whole correction in either direction', () => {
  assert.equal(offsetFromSingingStart(10, 25.5, 180), 15.5)
  assert.equal(offsetFromSingingStart(10, 4, 180), -6)
  assert.equal(offsetFromSingingStart(10, 0, 180), -10)
  assert.equal(offsetFromSingingStart(10, 180, 180), 170)
  const offset = offsetFromSingingStart(10, 25.5, 180)
  assert.equal(singingGuideState(lines, 25.5, 180, offset).index, 0)
  assert.equal(lyricSeekTime(10, offset, 180), 25.5)
})

test('invalid singing times are rejected rather than silently changing the target', () => {
  for (const value of [-1, NaN, Infinity, 180.1]) assert.equal(offsetFromSingingStart(10, value, 180), null)
  assert.equal(offsetFromSingingStart(-1, 10, 180), null)
  assert.equal(offsetFromSingingStart(0, MAX_LYRICS_OFFSET + 1), null)
})

test('default vocal reference skips blanks, common credits and intro labels', () => {
  const intro = parseLrc('[00:00]\n[00:01]作词：Someone\n[00:02]Composer: Someone\n[00:03](Intro)\n[00:12]First sung words\n[00:20]Next')
  assert.equal(singingStartLineIndex(intro), 4)
  assert.equal(singingStartLineIndex(intro, intro[5]), 5)
  assert.equal(singingStartLineIndex(intro, { time: 100, text: 'Old version' }), 4)
  assert.equal(singingStartLineIndex([]), -1)
})

test('start-line choices persist independently per song and ignore malformed storage', () => {
  const saved = { 42: { time: 12, text: 'First sung words' }, 43: { time: 20, text: 'Other song' } }
  assert.deepEqual(parseLyricsStartLines(JSON.stringify(saved)), saved)
  assert.deepEqual(parseLyricsStartLines('{"42":{"time":-1,"text":"Bad"},"43":{"time":1,"text":""}}'), {})
  for (const raw of [null, 'bad json', 'null', '[]', '42']) assert.deepEqual(parseLyricsStartLines(raw), {})
})

test('enhanced lyrics align the first sung word even when the line tag is earlier', () => {
  const [line] = parseLrc('[00:10]<00:12>Hello <00:14>world<00:16>')
  assert.equal(singingLineTime(line), 12)
  assert.equal(offsetFromSingingStart(singingLineTime(line), 20, 180), 8)
  assert.equal(singingLineTime({ time: 10, text: 'Standard line' }), 10)
})
