import fs from 'node:fs/promises'
import path from 'node:path'
import type { EventUpdate, SearchHit, TranscriptEvent } from '@shared/types'
import { toolSummary } from './state'
import { createParseContext, parseLines } from './transcript/parser'
import { splitLines } from './transcript/tailer'

interface Doc {
  sessionId: string
  sessionName: string
  eventId: string
  ts: number
  text: string
}

function textOf(event: TranscriptEvent): string | undefined {
  switch (event.kind) {
    case 'user':
    case 'claude':
    case 'cross':
    case 'sent':
      return event.text
    case 'tool':
      return toolSummary(event.name, event.input)
    default:
      return undefined
  }
}

export class SearchIndex {
  private docs = new Map<string, Doc[]>()

  get size(): number {
    let n = 0
    for (const docs of this.docs.values()) n += docs.length
    return n
  }

  replace(sessionId: string, sessionName: string, events: TranscriptEvent[]): void {
    const docs: Doc[] = []
    for (const event of events) {
      const text = textOf(event)
      if (text !== undefined) docs.push({ sessionId, sessionName, eventId: event.id, ts: event.ts, text })
    }
    this.docs.set(sessionId, docs)
  }

  upsert(sessionId: string, sessionName: string, events: TranscriptEvent[]): void {
    const docs = this.docs.get(sessionId) ?? []
    for (const event of events) {
      const text = textOf(event)
      if (text === undefined) continue
      const i = docs.findIndex((doc) => doc.eventId === event.id)
      const doc: Doc = { sessionId, sessionName, eventId: event.id, ts: event.ts, text }
      if (i >= 0) docs[i] = doc
      else docs.push(doc)
    }
    for (const doc of docs) doc.sessionName = sessionName
    this.docs.set(sessionId, docs)
  }

  applyUpdates(sessionId: string, updates: EventUpdate[]): void {
    const docs = this.docs.get(sessionId)
    if (!docs) return
    for (const update of updates) {
      const doc = docs.find((candidate) => candidate.eventId === update.id)
      if (!doc) continue
      const patch = update.patch as any
      if (typeof patch.appendText === 'string') doc.text += patch.appendText
      if (typeof patch.text === 'string') doc.text = patch.text
    }
  }

  remove(sessionId: string): void {
    this.docs.delete(sessionId)
  }

  query(q: string, limit = 200): SearchHit[] {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    const hits: SearchHit[] = []
    for (const docs of this.docs.values()) {
      for (const doc of docs) {
        const at = doc.text.toLowerCase().indexOf(needle)
        if (at < 0) continue
        hits.push({ sessionId: doc.sessionId, sessionName: doc.sessionName, eventId: doc.eventId, ts: doc.ts, snippet: snippet(doc.text, at, needle.length) })
      }
    }
    return hits.sort((a, b) => b.ts - a.ts).slice(0, limit)
  }
}

export function snippet(text: string, at: number, len: number, radius = 40): string {
  const start = Math.max(0, at - radius)
  const end = Math.min(text.length, at + len + radius)
  return `${start > 0 ? '...' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '...' : ''}`
}

export async function loadRecentTranscripts(
  projectsRoot: string,
  days: number,
  skip: Set<string>,
): Promise<{ sessionId: string; name: string; events: TranscriptEvent[] }[]> {
  const cutoff = Date.now() - days * 86_400_000
  const out: { sessionId: string; name: string; events: TranscriptEvent[] }[] = []
  let dirs: string[]
  try {
    dirs = await fs.readdir(projectsRoot)
  } catch {
    return out
  }
  for (const dirName of dirs) {
    const dir = path.join(projectsRoot, dirName)
    let files: string[]
    try {
      files = (await fs.readdir(dir)).filter((file) => file.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const file of files) {
      const sessionId = file.slice(0, -'.jsonl'.length)
      if (skip.has(sessionId)) continue
      const full = path.join(dir, file)
      let stat
      try {
        stat = await fs.stat(full)
      } catch {
        continue
      }
      if (stat.mtimeMs < cutoff) continue
      const { lines } = splitLines(await fs.readFile(full, 'utf8'))
      const parsed = parseLines(lines, createParseContext())
      out.push({ sessionId, name: parsed.meta.aiTitle ?? sessionId.slice(0, 8), events: parsed.events })
    }
  }
  return out
}
