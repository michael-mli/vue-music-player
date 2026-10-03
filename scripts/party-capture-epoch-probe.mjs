// Owned capability evidence: independently relate encoded capture timestamps
// from each worker to native delivery sources. Never guess an arbitrary offset.
export function probeCaptureEpoch(records, stream, peers, Clock) {
  const result = [], now = performance.now(), wall = Date.now()
  for (const kind of ['audio','video']) {
    const row = { kind, status: 'missing', epoch: null, residualMs: null }
    result.push(row)
    const track = stream.getTracks().find(item => item.kind === kind)
    const receiver = peers.flatMap(peer => peer.getReceivers()).find(item => item.track === track)
    if (!receiver) continue
    const samples = records.filter(record => record.direction === 'receive' && record.kind === kind &&
      Number.isFinite(record.realmTimeOrigin) && Number.isFinite(record.values?.captureTime))
    if (samples.length < 2 || new Set(samples.map(sample => sample.worker)).size !== 1) continue
    const clock = new Clock(kind === 'audio' ? 48000 : 90000)
    for (const sample of samples) clock.observe(sample.rtpTimestamp, sample.realmTimeOrigin + sample.values.captureTime, now)
    row.clock = clock.snapshot(now)
    const sources = receiver.getSynchronizationSources().filter(source => Number.isFinite(source.captureTimestamp) &&
      Number.isInteger(source.rtpTimestamp) && Number.isFinite(source.timestamp))
    if (sources.length !== 1) continue
    const source = sources[0], age = wall-source.timestamp
    if (age < -20 || age > 120) { row.status = 'stale'; continue }
    const projected = clock.estimate(source.rtpTimestamp, now)
    if (projected === null) { row.status = 'clock'; continue }
    const offset = source.captureTimestamp-projected
    const candidates = [{ epoch:'unix', offset:0 },{ epoch:'ntp', offset:2208988800000 }]
    const matched = candidates.find(candidate => Math.abs(offset-candidate.offset) <= 80)
    if (!matched) { row.status = 'unknown-epoch'; continue }
    row.epoch = matched.epoch; row.residualMs = offset-matched.offset
    row.captureAgeMs = wall-projected
    row.status = row.clock.status === 'ready' && row.captureAgeMs >= -80 && row.captureAgeMs <= 5000 ? 'verified' : 'clock'
  }
  return result
}
