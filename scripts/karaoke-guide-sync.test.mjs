import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../src/utils/karaokeGuideSync.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } })
const { KaraokeGuideClock, guidePosition, guideCorrection } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

test('separate device clocks map onto one timeline independent of wall-clock skew', () => {
  const host = new KaraokeGuideClock(), phone = new KaraokeGuideClock()
  host.add(100, 124, 5110, 5114)
  phone.add(80000, 80024, 5110, 5114)
  assert.equal(host.serverNow(124), 5124)
  assert.equal(phone.serverNow(80024), 5124)
  const state = { position: 30, duration: 120, playing: true, rate: 1, sampledAt: host.serverNow(124) }
  assert.equal(guidePosition(state, phone.serverNow(80524)), 30.5)
})

test('slow network samples do not destabilize the clock; old estimates roll over', () => {
  const clock = new KaraokeGuideClock()
  clock.add(100, 120, 5110, 5110)
  clock.add(200, 900, 5210, 5210)
  assert.equal(clock.serverNow(900), 5900)
  clock.add(1000, 999, 0, 1)
  assert.equal(clock.serverNow(1000), 6000)
  clock.add(31000, 31020, 32010, 32010)
  assert.equal(clock.serverNow(31020), 32020)
})

test('paused positions freeze, rates project correctly and offsets respect track boundaries', () => {
  const state = { position: 20, duration: 120, playing: false, rate: 1.5, sampledAt: 1000 }
  assert.equal(guidePosition(state, 5000), 20)
  assert.equal(guidePosition({ ...state, playing: true }, 5000), 26)
  assert.equal(guidePosition(state, 5000, 250), 20.25)
  assert.equal(guidePosition({ ...state, position: 0 }, 5000, -1000), 0)
  assert.equal(guidePosition({ ...state, position: 119, playing: true }, 5000, 2000), 120)
})

test('small drift uses bounded speed correction while seeks and paused drift snap', () => {
  assert.deepEqual(guideCorrection(10, 10.01, 1, true), { seek: false, rate: 1 })
  const behind = guideCorrection(10, 10.2, 1, true)
  assert.equal(behind.seek, false); assert.ok(behind.rate > 1 && behind.rate <= 1.04)
  const ahead = guideCorrection(10.2, 10, 1, true)
  assert.ok(ahead.rate < 1 && ahead.rate >= 0.96)
  assert.equal(guideCorrection(10, 45, 1, true).seek, true)
  assert.deepEqual(guideCorrection(10, 10.1, 1, false), { seek: true, rate: 1 })
})
