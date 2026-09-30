import { randomUUID } from 'node:crypto'

// A service restart creates a new epoch. Wall time is never a scheduling clock.
export function createKtvClock(now = () => performance.now()) {
  const originMs = now()
  return { id: randomUUID(), nowMs: () => now() - originMs }
}
