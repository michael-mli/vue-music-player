const hour = 60 * 60 * 1000
export function ktvPolicy(options = {}) {
  const defaults = { members: 20, queue: 100, singerRequests: 3, deviceGrants: 2,
    roomLifetimeMs: 12 * hour, emptyRoomMs: hour / 2, receiptRetentionMs: 24 * hour,
    historyRetentionMs: 7 * 24 * hour, eventsPerRoom: 1000 }
  const bounds = { members: [2, 20], queue: [1, 100], singerRequests: [1, 10], deviceGrants: [0, 2],
    roomLifetimeMs: [60_000, 24 * hour], emptyRoomMs: [60_000, 24 * hour],
    receiptRetentionMs: [24 * hour, 7 * 24 * hour], historyRetentionMs: [24 * hour, 30 * 24 * hour],
    eventsPerRoom: [10, 10_000] }
  const result = { ...defaults }
  for (const [name, range] of Object.entries(bounds)) {
    const value = options[name] ?? defaults[name]
    if (!Number.isSafeInteger(value) || value < range[0] || value > range[1]) throw new Error(`Invalid KTV ${name}`)
    result[name] = value
  }
  if (result.historyRetentionMs < result.receiptRetentionMs) throw new Error('KTV history retention must cover the receipt retry window')
  return Object.freeze(result)
}
