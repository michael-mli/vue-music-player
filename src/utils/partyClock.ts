export interface PartyClockReply {
  clockId: string
  clientSendMs: number
  serverReceiveMs: number
  serverSendMs: number
}

export interface PartyClockEstimate {
  clockId: string
  offsetMs: number
  roundTripMs: number
  uncertaintyMs: number
  samples: number
  ageMs: number
  status: 'collecting' | 'healthy' | 'uncertain' | 'stale'
}

interface Sample { offsetMs: number; roundTripMs: number; receivedMs: number }
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

// All times use monotonic milliseconds. This estimates network clock mapping;
// it does not measure speaker/Bluetooth delay or acoustic audio alignment.
export class PartyClockEstimator {
  private clockId = ''
  private samples: Sample[] = []

  reset(clockId = '') { this.clockId = clockId; this.samples = [] }

  add(reply: PartyClockReply, clientReceiveMs: number): boolean {
    const { clientSendMs: c0, serverReceiveMs: s1, serverSendMs: s2 } = reply
    if (typeof reply.clockId !== 'string' || !reply.clockId || reply.clockId.length > 64 ||
      ![c0, s1, s2, clientReceiveMs].every(Number.isFinite) ||
      c0 < 0 || s1 < 0 || clientReceiveMs < c0 || s2 < s1) return false
    const roundTripMs = (clientReceiveMs - c0) - (s2 - s1)
    if (roundTripMs < 0 || roundTripMs > 2000) return false
    if (reply.clockId !== this.clockId) this.reset(reply.clockId)
    this.samples = this.samples.filter(sample => clientReceiveMs - sample.receivedMs <= 60_000)
    this.samples.push({ offsetMs: ((s1 - c0) + (s2 - clientReceiveMs)) / 2, roundTripMs, receivedMs: clientReceiveMs })
    this.samples = this.samples.slice(-24)
    return true
  }

  estimate(nowMs: number): PartyClockEstimate | null {
    const recent = this.samples.filter(sample => nowMs >= sample.receivedMs && nowMs - sample.receivedMs <= 60_000)
    if (!recent.length) return null
    const selected = [...recent].sort((a, b) => a.roundTripMs - b.roundTripMs)
      .slice(0, Math.max(3, Math.ceil(recent.length / 3)))
    const offsetMs = median(selected.map(sample => sample.offsetMs))
    const roundTripMs = median(selected.map(sample => sample.roundTripMs))
    const uncertaintyMs = roundTripMs / 2 + Math.max(...selected.map(sample => Math.abs(sample.offsetMs - offsetMs)))
    const ageMs = nowMs - recent[recent.length - 1]!.receivedMs
    return { clockId: this.clockId, offsetMs, roundTripMs, uncertaintyMs, samples: recent.length, ageMs,
      status: ageMs > 30_000 ? 'stale' : recent.length < 3 ? 'collecting' : uncertaintyMs <= 50 ? 'healthy' : 'uncertain' }
  }
}
