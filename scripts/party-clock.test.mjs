import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { createKtvClock } from '../server/ktv-clock.js'

const source = fs.readFileSync(new URL('../src/utils/partyClock.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } })
const { PartyClockEstimator } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`)

function sample(estimator, sentMs, outgoingMs = 10, incomingMs = 10, clockId = 'epoch-1', offset = 5000) {
  const processingMs = 2
  const receivedMs = sentMs + outgoingMs + processingMs + incomingMs
  const accepted = estimator.add({ clockId, clientSendMs: sentMs,
    serverReceiveMs: sentMs + offset + outgoingMs, serverSendMs: sentMs + offset + outgoingMs + processingMs }, receivedMs)
  return { accepted, receivedMs }
}

test('clock mapping removes server processing and prefers consistent low-round-trip samples', () => {
  const clock = new PartyClockEstimator()
  for (let i = 0; i < 5; i++) sample(clock, i * 1000)
  const { receivedMs } = sample(clock, 5000, 10, 700)
  const estimate = clock.estimate(receivedMs)
  assert.equal(estimate.offsetMs, 5000)
  assert.equal(estimate.roundTripMs, 20)
  assert.equal(estimate.uncertaintyMs, 10)
  assert.equal(estimate.status, 'healthy')
  assert.equal(estimate.samples, 6)
})

test('a new server epoch drops old samples and aging estimates stop being healthy', () => {
  const clock = new PartyClockEstimator()
  for (let i = 0; i < 3; i++) sample(clock, i * 1000)
  assert.equal(clock.estimate(2100).status, 'healthy')
  assert.equal(clock.estimate(33000).status, 'stale')
  assert.equal(clock.estimate(63000), null)
  const { receivedMs } = sample(clock, 64000, 10, 10, 'epoch-2', 9000)
  const estimate = clock.estimate(receivedMs)
  assert.equal(estimate.samples, 1)
  assert.equal(estimate.clockId, 'epoch-2')
  assert.equal(estimate.offsetMs, 9000)
  assert.equal(estimate.status, 'collecting')
  clock.reset()
  assert.equal(clock.estimate(receivedMs), null)
})

test('invalid probes and large delays cannot create a healthy clock estimate', () => {
  const clock = new PartyClockEstimator()
  const reply = { clockId: 'epoch', clientSendMs: 100, serverReceiveMs: 5100, serverSendMs: 5102 }
  assert.equal(clock.add({ ...reply, serverSendMs: 5099 }, 130), false)
  assert.equal(clock.add({ ...reply, clientSendMs: NaN }, 130), false)
  assert.equal(clock.add(reply, 90), false)
  assert.equal(clock.add(reply, 5000), false)
  for (let i = 0; i < 3; i++) sample(clock, i * 1000, 80, 80)
  assert.equal(clock.estimate(2200).status, 'uncertain')
  assert.ok(clock.estimate(2200).uncertaintyMs >= 80)
})

test('server clocks use an independent monotonic origin and a new epoch per service', () => {
  let nowMs = 1200
  const first = createKtvClock(() => nowMs)
  assert.equal(first.nowMs(), 0)
  nowMs += 25
  assert.equal(first.nowMs(), 25)
  const second = createKtvClock(() => nowMs)
  assert.notEqual(second.id, first.id)
  assert.equal(second.nowMs(), 0)
})
