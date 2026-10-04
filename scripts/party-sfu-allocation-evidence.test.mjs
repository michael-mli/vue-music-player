import test from 'node:test'
import assert from 'node:assert/strict'
import { analyseSfuAllocationLogs, sfuLogByteLimit } from './party-sfu-allocation-evidence.mjs'

const window = { phase: 'impaired', start: 2000, end: 10000, identity: 'private-listener', track: 'private-video' }
function row(time, temporal = 2, changes = {}) {
  return JSON.stringify({ ts: time / 1000, msg: 'stream allocation: optimal', participant: window.identity,
    trackID: window.track, room: 'secret-room', arbitrary: 'secret-token', allocation: {
      TargetLayer: { Spatial: 0, Temporal: temporal }, MaxLayer: { Spatial: 0, Temporal: 2 },
      PauseReason: 'NONE', IsDeficient: false, BandwidthRquested: 350000, BandwidthNeeded: 350000 }, ...changes })
}
test('exact listener/track scope carries initial layer into phase and reports bounded durations without identifiers', () => {
  const raw = [row(1000), row(4000, 0), row(6000, 1), row(8000), row(3000, 0, { participant: 'other' }),
    row(9000, 0, { trackID: 'other' })].join('\n')
  const evidence = analyseSfuAllocationLogs(raw, [window]), phase = evidence.phases[0]
  assert.deepEqual(evidence.errors, [])
  assert.equal(phase.allocationChanges, 3)
  assert.equal(phase.duration.temporal2Ms, 4000)
  assert.equal(phase.duration.temporal0Ms, 2000)
  assert.equal(phase.duration.temporal1Ms, 2000)
  assert.equal(phase.duration.unknownMs, 0)
  assert.deepEqual(phase.requestedBps, { min: 350000, max: 350000 })
  for (const privateValue of ['private-listener', 'private-video', 'secret-room', 'secret-token', 'other'])
    assert.equal(JSON.stringify(evidence).includes(privateValue), false)
})
test('missing, malformed, reversed or oversized evidence remains explicit failure', () => {
  for (const [raw, code] of [
    ['', 'SFU_INITIAL_STATE_MISSING'], [row(4000), 'SFU_INITIAL_STATE_MISSING'],
    ['not-json\nnull', 'SFU_LOG_JSON'], [row(1000, 9), 'SFU_ALLOCATION_SCHEMA'],
    [row(1000, 2, { ts: 'secret-value' }), 'SFU_ALLOCATION_SCHEMA'],
    [row(1000, 2, { allocation: { TargetLayer: { Spatial: 0, Temporal: 2 } } }), 'SFU_ALLOCATION_SCHEMA'],
    [[row(1000), row(5000), row(4000)].join('\n'), 'SFU_ALLOCATION_ORDER'],
    ['x'.repeat(65537), 'SFU_LINE_BOUND'], ['x'.repeat(sfuLogByteLimit + 1), 'SFU_LOG_BOUND'],
    [Array.from({ length: 1025 }, (_, i) => row(i)).join('\n'), 'SFU_ALLOCATION_BOUND'],
  ]) assert.ok(analyseSfuAllocationLogs(raw, [window]).errors.includes(code), code)
  for (const invalid of [null, [], [null], [{ ...window, phase: 'secret' }], [{ ...window, end: 1000 }],
    [window, window], Array(9).fill(window)])
    assert.deepEqual(analyseSfuAllocationLogs('', invalid), { errors: ['SFU_SCOPE'], phases: [] })
})
test('ISO timestamps, terminal pause and fresh listener scope produce separate phase summaries', () => {
  const pause = JSON.parse(row(5000, -1)); pause.ts = new Date(5000).toISOString()
  pause.allocation.TargetLayer.Spatial = -1
  pause.allocation.PauseReason = 'BANDWIDTH'; pause.allocation.IsDeficient = true
  const replacement = { ...window, phase: 'next-singer', start: 11000, end: 15000, identity: 'new-listener', track: 'new-video' }
  const evidence = analyseSfuAllocationLogs([row(1000), JSON.stringify(pause),
    row(10500, 2, { participant: replacement.identity, trackID: replacement.track })].join('\n'), [window, replacement])
  assert.deepEqual(evidence.errors, [])
  assert.equal(evidence.phases[0].duration.inactiveMs, 5000)
  assert.equal(evidence.phases[0].duration.deficientMs, 5000)
  assert.equal(evidence.phases[0].duration.bandwidthPausedMs, 5000)
  assert.equal(evidence.phases[1].duration.temporal2Ms, 4000)
})
