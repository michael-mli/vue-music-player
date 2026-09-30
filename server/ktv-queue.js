// Materialize one turn per singer per round while retaining each singer's request order.
export function orderQueue(entries, servedSingerIds = []) {
  const ready = entries.filter((entry) => entry.state === 'queued' && entry.singerAccepted !== false)
  const priority = ready.filter((entry) => entry.priorityApproved)
  const regular = ready.filter((entry) => !entry.priorityApproved)
  const singers = new Map()
  for (const entry of regular) {
    if (!singers.has(entry.singerMemberId)) singers.set(entry.singerMemberId, [])
    singers.get(entry.singerMemberId).push(entry)
  }
  const fair = []
  const served = new Set(servedSingerIds)
  // A served singer waits for everyone still eligible in this round. Cancelling
  // and requesting again cannot erase their durable turn history.
  for (const [singerId, songs] of singers) if (!served.has(singerId) && songs.length) fair.push(songs.shift())
  let remaining = true
  while (remaining) {
    remaining = false
    for (const songs of singers.values()) {
      if (songs.length) {
        fair.push(songs.shift())
        remaining = true
      }
    }
  }
  return [...priority, ...fair,
    ...entries.filter((entry) => entry.state === 'queued' && entry.singerAccepted === false),
    ...entries.filter((entry) => entry.state === 'held')]
}
