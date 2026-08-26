import type { RegistryStatus, SessionState, TranscriptEvent } from '@shared/types'

export const WAITING_MS = 20_000

export function deriveState(input: { alive: boolean; registryStatus: RegistryStatus; lastEvent?: TranscriptEvent; now: number }): SessionState {
  if (!input.alive) return 'ended'
  if (input.registryStatus === 'idle') return 'idle'
  const event = input.lastEvent
  if (event?.kind === 'tool' && event.resultText === undefined && input.now - event.ts > WAITING_MS) return 'waiting'
  return 'working'
}

export function toolSummary(name: string, input: unknown): string {
  const data = (input ?? {}) as Record<string, unknown>
  const arg = data.command ?? data.file_path ?? data.pattern ?? data.query ?? data.to ?? data.url ?? ''
  return arg ? `${name}: ${String(arg)}` : name
}

export function lastActivity(events: TranscriptEvent[]): { ts: number; preview: string } {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    let text: string | undefined
    if (event.kind === 'user' || event.kind === 'claude' || event.kind === 'cross') text = event.text
    else if (event.kind === 'tool') text = toolSummary(event.name, event.input)
    else if (event.kind === 'sent') text = `to ${event.to.join(', ')}: ${event.text}`
    if (text !== undefined) {
      const oneLine = text.replace(/\s+/g, ' ').trim()
      return { ts: event.ts, preview: oneLine.length > 60 ? `${oneLine.slice(0, 59)}...` : oneLine }
    }
  }
  return { ts: 0, preview: '' }
}
