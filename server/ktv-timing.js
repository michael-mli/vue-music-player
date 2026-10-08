// Operator timing policy, in milliseconds. Client render-clock thresholds and
// acoustic acceptance targets are separate; these options cannot weaken them.
export const KTV_MEDIA_OUTPUT_PERMIT_MS = 5000
export const KTV_TIMING_DEFAULTS = Object.freeze({
  prepareTimeoutMs: 30000, playbackLeadMs: 2000, onlineLeadMs: 6000,
  outputLeaseMs: 8000, outputMarginMs: 500, hostGraceMs: 30000,
  pairingLifetimeMs: 120000, ticketLifetimeMs: 30000, socketAuthTimeoutMs: 5000,
})
const bounds = {
  prepareTimeoutMs: [5000, 60000], playbackLeadMs: [1000, 5000], onlineLeadMs: [4000, 10000],
  outputLeaseMs: [6000, 15000], outputMarginMs: [500, 2000], hostGraceMs: [1000, 300000],
  pairingLifetimeMs: [30000, 300000], ticketLifetimeMs: [5000, 60000], socketAuthTimeoutMs: [1000, 10000],
}
export function ktvTiming(options = {}) {
  const result = { ...KTV_TIMING_DEFAULTS }
  for (const [name, range] of Object.entries(bounds)) {
    const value = options[name] ?? result[name]
    if (!Number.isSafeInteger(value) || value < range[0] || value > range[1]) throw new Error(`Invalid KTV ${name}`)
    result[name] = value
  }
  if (Math.max(result.playbackLeadMs, result.onlineLeadMs) + 1000 > result.outputLeaseMs) {
    throw new Error('KTV output lease must cover start leads plus one second')
  }
  if (result.prepareTimeoutMs < Math.max(result.playbackLeadMs, result.onlineLeadMs)) {
    throw new Error('KTV preparation timeout must cover start leads')
  }
  if (result.socketAuthTimeoutMs > result.ticketLifetimeMs) throw new Error('KTV socket authentication timeout must fit the ticket lifetime')
  return Object.freeze(result)
}

// Monotonic clock epochs cannot be compared across process restarts. Keep the
// greatest configured lease/margin durably, including the legacy 8s/500ms floor.
// It survives repeated restarts during recovery and decreases in configuration.
export function ktvRestartSilenceMs(db, timing) {
  db.prepare(`INSERT INTO ktv_output_safety (id, max_lease_ms, max_margin_ms) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET max_lease_ms = MAX(max_lease_ms, excluded.max_lease_ms),
      max_margin_ms = MAX(max_margin_ms, excluded.max_margin_ms)`)
    .run(Math.max(KTV_TIMING_DEFAULTS.outputLeaseMs, timing.outputLeaseMs),
      Math.max(KTV_TIMING_DEFAULTS.outputMarginMs, timing.outputMarginMs))
  const record = db.prepare('SELECT * FROM ktv_output_safety WHERE id = 1').get()
  return record.max_lease_ms + record.max_margin_ms
}
