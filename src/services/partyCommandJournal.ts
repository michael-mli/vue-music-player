interface PendingCommand { id: string; createdAt: number }
const prefix = 'party-command-v1:'
const lifetimeMs = 24 * 60 * 60 * 1000
const memory = new Map<string, PendingCommand>()

function storage(): Storage | null { try { return window.sessionStorage } catch { return null } }
function valid(record: PendingCommand | null, now: number): record is PendingCommand {
  return !!record && typeof record.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id) &&
    Number.isFinite(record.createdAt) && record.createdAt <= now && now - record.createdAt < lifetimeMs
}

// Store command IDs and hashes only. Do not persist invitation codes, pairing
// credentials, display names or room snapshots in the retry journal.
export async function runPartyMutation<T>(principal: string, route: string, payload: Record<string, unknown>,
  send: (body: Record<string, unknown>) => Promise<T>): Promise<T> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  const key = `${prefix}${principal}:${route}:${hash}`, now = Date.now(), store = storage()
  // Retention is bounded even if an offline page leaves failed commands behind.
  for (const [name, record] of memory) if (!valid(record, now)) memory.delete(name)
  if (store) try {
    const names = Array.from({ length: store.length }, (_, index) => store.key(index)).filter((name): name is string => !!name?.startsWith(prefix))
    for (const name of names) {
      let record: PendingCommand | null = null
      try { record = JSON.parse(store.getItem(name) || 'null') } catch { /* Invalid journal entry. */ }
      if (!valid(record, now)) store.removeItem(name)
    }
  } catch { /* Continue with the in-memory journal when storage is unavailable. */ }
  let pending = memory.get(key) || null
  if (!valid(pending, now) && store) try { pending = JSON.parse(store.getItem(key) || 'null') } catch { /* Use a fresh command. */ }
  if (!valid(pending, now)) pending = { id: crypto.randomUUID(), createdAt: now }
  const command = pending
  if (!memory.has(key)) while (memory.size >= 100) memory.delete(memory.keys().next().value!)
  memory.set(key, command)
  try { store?.setItem(key, JSON.stringify(command)) } catch { /* In-memory retries remain safe. */ }
  if (store) try {
    const names = Array.from({ length: store.length }, (_, index) => store.key(index))
      .filter((name): name is string => !!name?.startsWith(prefix) && name !== key)
    for (const name of names.slice(0, Math.max(0, names.length - 99))) store.removeItem(name)
  } catch { /* Storage may have become unavailable. */ }
  const clear = () => {
    if (memory.get(key)?.id !== command.id) return
    memory.delete(key)
    try { store?.removeItem(key) } catch { /* Storage may have become unavailable. */ }
  }
  try {
    const result = await send({ ...payload, commandId: command.id })
    clear(); return result
  } catch (error) {
    const status = (error as { status?: number })?.status
    // Network/gateway/timeout/rate-limit failures can follow a successful commit.
    // Keep the original ID for a retry, including after a tab refresh.
    if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) clear()
    throw error
  }
}
