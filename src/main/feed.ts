import type { FeedItem, TranscriptEvent } from '@shared/types'

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase()

export class FeedBuilder {
  private list: FeedItem[] = []
  private seq = 0
  private readonly windowMs: number
  private readonly bridgeName: string

  constructor(opts: { bridgeName: string; windowMs?: number }) {
    this.bridgeName = opts.bridgeName
    this.windowMs = opts.windowMs ?? 10_000
  }

  items(): FeedItem[] {
    return [...this.list].sort((a, b) => b.ts - a.ts)
  }

  rename(sessionId: string, name: string): void {
    for (const item of this.list) {
      if (item.senderSessionId === sessionId) item.from = name
    }
  }

  recordRelay(targets: string[], text: string, ts: number): FeedItem {
    const match = this.find('you', text, ts)
    if (match) {
      for (const target of targets) if (!match.to.includes(target)) match.to.push(target)
      match.viaBridge = true
      return match
    }
    const item: FeedItem = { id: `relay-${++this.seq}`, ts, from: 'you', to: [...targets], text, receiverSessionIds: [], viaBridge: true }
    this.list.push(item)
    return item
  }

  ingest(sessionId: string, sessionName: string, events: TranscriptEvent[]): boolean {
    let changed = false
    for (const event of events) {
      if (event.kind === 'sent') {
        const from = sessionName === this.bridgeName ? 'you' : sessionName
        const match = this.find(from, event.text, event.ts)
        if (match) {
          match.senderSessionId = match.senderSessionId ?? sessionId
          for (const target of event.to) if (!match.to.includes(target)) match.to.push(target)
          match.ts = Math.min(match.ts, event.ts)
        } else {
          this.list.push({
            id: `feed-${++this.seq}`,
            ts: event.ts,
            from,
            to: [...event.to],
            text: event.text,
            senderSessionId: sessionId,
            receiverSessionIds: [],
            viaBridge: from === 'you',
          })
        }
        changed = true
      } else if (event.kind === 'cross') {
        const from = event.fromName === this.bridgeName ? 'you' : event.fromName
        const match = this.find(from, event.text, event.ts)
        if (match) {
          if (!match.receiverSessionIds.includes(sessionId)) match.receiverSessionIds.push(sessionId)
          if (!match.to.includes(sessionName)) match.to.push(sessionName)
        } else {
          this.list.push({
            id: `feed-${++this.seq}`,
            ts: event.ts,
            from,
            to: [sessionName],
            text: event.text,
            receiverSessionIds: [sessionId],
            viaBridge: from === 'you',
          })
        }
        changed = true
      }
    }
    return changed
  }

  private find(from: string, text: string, ts: number): FeedItem | undefined {
    const normalized = normalize(text)
    return this.list.find((item) => item.from === from && normalize(item.text) === normalized && Math.abs(item.ts - ts) <= this.windowMs)
  }
}
