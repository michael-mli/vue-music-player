import test from 'node:test'
import assert from 'node:assert/strict'
import { ktvTiming, KTV_TIMING_DEFAULTS } from './ktv-timing.js'

test('timing policy retains legacy defaults and rejects unsafe coordinated values', () => {
  assert.deepEqual(ktvTiming(), KTV_TIMING_DEFAULTS)
  assert.equal(Object.isFrozen(ktvTiming()), true)
  for (const options of [{ outputLeaseMs: 5999 }, { outputLeaseMs: 15001 }, { outputMarginMs: 499 },
    { playbackLeadMs: 0 }, { prepareTimeoutMs: 5000 }, { onlineLeadMs: 8000 },
    { socketAuthTimeoutMs: 10000, ticketLifetimeMs: 5000 }, { hostGraceMs: 1000.5 },
    { pairingLifetimeMs: Infinity }, { ticketLifetimeMs: NaN }, { outputMarginMs: '500' }]) {
    assert.throws(() => ktvTiming(options), /KTV/)
  }
  const changed = ktvTiming({ outputLeaseMs: 6000, onlineLeadMs: 4000, prepareTimeoutMs: 5000,
    playbackLeadMs: 1000, outputMarginMs: 1000, socketAuthTimeoutMs: 1000, ticketLifetimeMs: 5000 })
  assert.equal(changed.outputLeaseMs, 6000)
})
