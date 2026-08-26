import type { EventUpdate, TranscriptEvent } from '@shared/types'

export function applyUpdates(events: TranscriptEvent[], updates: EventUpdate[]): void {
  if (!updates.length) return
  const byId = new Map(events.map((event) => [event.id, event as any]))
  for (const update of updates) {
    const event = byId.get(update.id)
    if (!event) continue
    const { appendText, ...rest } = update.patch as any
    if (typeof appendText === 'string' && typeof event.text === 'string') event.text += appendText
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) event[key] = value
    }
  }
}

export function nearestIndex(events: TranscriptEvent[], ts: number): number {
  let best = -1
  let bestDistance = Infinity
  events.forEach((event, index) => {
    const distance = Math.abs(event.ts - ts)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}
