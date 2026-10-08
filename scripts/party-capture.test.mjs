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
  assert.deepEqual(text, []); assert.equal(forced, 5)
  render(300); assert.deepEqual(text, [])
  assert.equal(forced, 5)
  capture.close(); capture.close()
  assert.equal(stopped, true); assert.equal(callbacks.size, 0)
})

function cadenceFixture(t, manual = true) {
  const previous = { document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame }
  const callbacks = new Map(), rates = [], stopped = [], captured = []
  let next = 0, draws = 0, now = 0
  globalThis.document = Object.assign(new EventTarget(), { hidden: false })
  globalThis.requestAnimationFrame = work => { const id = ++next; callbacks.set(id, work); return id }
  globalThis.cancelAnimationFrame = id => callbacks.delete(id)
  t.after(() => Object.assign(globalThis, previous))
  const context = { fillRect() {}, fillText() {}, measureText: () => ({ width: 0 }) }
  const canvas = { getContext: () => context, captureStream(rate) {
    rates.push(rate)
    const track = { stop() { stopped.push(rate) }, ...(manual ? { requestFrame() { captured.push(now) } } : {}) }
    return { getVideoTracks: () => [track], getTracks: () => [track] }
  } }
  const capture = new PartyLyricCapture(canvas, () => { draws++; return null })
  const render = time => {
    now = time
    const work = callbacks.values().next().value
    callbacks.clear(); work(time)
  }
  return { capture, render, rates, stopped, captured, callbacks, draws: () => draws }
}

for (const refreshRate of [60, 120]) {
  test(`25 fps capture preserves cadence on ${refreshRate} Hz animation frames`, t => {
    const fixture = cadenceFixture(t)
    for (let index = 0; index < refreshRate; index++) fixture.render(index * 1000 / refreshRate)
    assert.equal(fixture.draws(), 25)
    assert.equal(fixture.captured.length, 26) // Initial blank, then 25 complete frames.
    assert.deepEqual(fixture.rates, [0])
    fixture.render(5000)
    assert.equal(fixture.draws(), 26, 'a stall captures only the latest frame')
    fixture.render(5001)
    assert.equal(fixture.draws(), 26, 'no catch-up burst after a stall')
    fixture.capture.close()
    assert.deepEqual(fixture.stopped, [0])
    assert.equal(fixture.callbacks.size, 0)
  })
}

test('automatic capture fallback releases its probe and preserves drawing cadence', t => {
  const fixture = cadenceFixture(t, false)
  assert.deepEqual(fixture.rates, [0, 25])
  assert.deepEqual(fixture.stopped, [0])
  for (let index = 0; index < 60; index++) fixture.render(index * 1000 / 60)
  assert.equal(fixture.draws(), 25)
  assert.equal(fixture.captured.length, 0)
  fixture.capture.close(); fixture.capture.close()
  assert.deepEqual(fixture.stopped, [0, 25])
})

test('unsupported capture and unsafe frame rates fail before creating a publisher', () => {
  assert.throws(() => new PartyLyricCapture({}, () => null), /LYRIC_CAPTURE_UNSUPPORTED/)
  assert.throws(() => new PartyLyricCapture({ captureStream() {} }, () => null, 120), /LYRIC_CAPTURE_UNSUPPORTED/)
})
