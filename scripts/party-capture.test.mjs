import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import ts from 'typescript'

const compile = async file => ts.transpileModule(await fs.readFile(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const timing = moduleUrl(await compile('../src/utils/lyricsTiming.ts'))
const { publishedLyricFrame, PartyLyricCapture } = await import(moduleUrl((await compile('../src/services/partyLyricCapture.ts')).replace("'@/utils/lyricsTiming'", JSON.stringify(timing))))

test('captured lyrics follow the rendered backing delay and room lyric correction', () => {
  const frame = { title: 'Song', singer: 'Singer', renderPositionMs: 10040, backingDelayMs: 75, lyricOffsetMs: 0,
    lines: [{ time: 0, text: 'First' }, { time: 10, text: 'Second' }, { time: 20, text: 'Third' }] }
  assert.deepEqual(publishedLyricFrame(frame), { positionMs: 9965, line: 'First', next: 'Second' })
  assert.equal(publishedLyricFrame({ ...frame, lyricOffsetMs: 50 }).line, 'Second')
  assert.equal(publishedLyricFrame({ ...frame, backingDelayMs: -75 }).positionMs, 10040)
  assert.equal(publishedLyricFrame({ ...frame, renderPositionMs: 0 }).positionMs, 0)
})

test('capture blanks unauthorized/background frames and closes its video track', t => {
  const oldDocument = globalThis.document, oldRaf = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame
  const document = Object.assign(new EventTarget(), { hidden: false }), callbacks = new Map(), text = []
  let next = 0, stopped = false, forced = 0, frame = { title: 'Song', singer: 'Singer', renderPositionMs: 1000, backingDelayMs: 0, lyricOffsetMs: 0, lines: [{ time: 0, text: 'Singing' }] }
  const track = { stop() { stopped = true }, requestFrame() { forced++ } }
  const context = { fillStyle: '', font: '', fillRect() { text.length = 0 }, fillText(value) { text.push(value) }, measureText: value => ({ width: Array.from(value).length * 30 }) }
  const canvas = { width: 0, height: 0, getContext: () => context, captureStream: () => ({ getVideoTracks: () => [track], getTracks: () => [track] }) }
  globalThis.document = document
  globalThis.requestAnimationFrame = work => { const id = ++next; callbacks.set(id, work); return id }
  globalThis.cancelAnimationFrame = id => callbacks.delete(id)
  t.after(() => { globalThis.document = oldDocument; globalThis.requestAnimationFrame = oldRaf; globalThis.cancelAnimationFrame = oldCancel })
  const render = time => { const work = callbacks.values().next().value; callbacks.clear(); work(time) }
  const capture = new PartyLyricCapture(canvas, () => frame)
  render(0); assert.ok(text.includes('Singing'))
  frame = null; render(100); assert.deepEqual(text, [])
  frame = { title: 'Restored', singer: 'Singer', renderPositionMs: 1000, backingDelayMs: 0, lyricOffsetMs: 0, lines: [] }
  render(200); assert.ok(text.includes('Restored'))
  document.hidden = true; document.dispatchEvent(new Event('visibilitychange'))
  assert.deepEqual(text, []); assert.equal(forced, 1)
  render(300); assert.deepEqual(text, [])
  capture.close(); capture.close()
  assert.equal(stopped, true); assert.equal(callbacks.size, 0)
})

test('unsupported capture and unsafe frame rates fail before creating a publisher', () => {
  assert.throws(() => new PartyLyricCapture({}, () => null), /LYRIC_CAPTURE_UNSUPPORTED/)
  assert.throws(() => new PartyLyricCapture({ captureStream() {} }, () => null, 120), /LYRIC_CAPTURE_UNSUPPORTED/)
})
