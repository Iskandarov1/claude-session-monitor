import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import type { EventUpdate, TranscriptEvent, TranscriptMeta } from '@shared/types'
import { createParseContext, parseLines, type ParseContext } from './parser'

export interface TailerOptions {
  pollMs?: number
}

export interface TailerResetPayload {
  events: TranscriptEvent[]
  meta: TranscriptMeta
}

export interface TailerAppendPayload {
  events: TranscriptEvent[]
  updates: EventUpdate[]
  meta: TranscriptMeta
}

export class TranscriptTailer extends EventEmitter {
  private offset = 0
  private partial = ''
  private ctx: ParseContext = createParseContext()
  private meta: TranscriptMeta = {}
  private timer?: NodeJS.Timeout
  private watcher?: fs.FSWatcher
  private reading = false
  private dirty = false
  private readonly pollMs: number

  constructor(readonly sessionId: string, readonly filePath: string, opts: TailerOptions = {}) {
    super()
    this.pollMs = opts.pollMs ?? 1000
  }

  get currentMeta(): TranscriptMeta {
    return { ...this.meta }
  }

  async start(): Promise<void> {
    await this.reset()
    try {
      this.watcher = fs.watch(this.filePath, () => void this.readNew())
      this.watcher.on('error', () => undefined)
    } catch {
      // Polling below is enough when fs.watch cannot attach.
    }
    this.timer = setInterval(() => void this.readNew(), this.pollMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.watcher?.close()
    this.timer = undefined
    this.watcher = undefined
  }

  private async reset(): Promise<void> {
    this.ctx = createParseContext()
    this.meta = {}
    this.partial = ''
    const content = await fsp.readFile(this.filePath, 'utf8')
    const { lines, rest } = splitLines(content)
    this.partial = rest
    this.offset = Buffer.byteLength(content, 'utf8')
    const parsed = parseLines(lines, this.ctx)
    Object.assign(this.meta, parsed.meta)
    this.emit('reset', { events: parsed.events, meta: { ...this.meta } } satisfies TailerResetPayload)
  }

  private async readNew(): Promise<void> {
    if (this.reading) {
      this.dirty = true
      return
    }
    this.reading = true
    try {
      let stat: fs.Stats
      try {
        stat = await fsp.stat(this.filePath)
      } catch {
        return
      }
      if (stat.size < this.offset) {
        await this.reset()
        return
      }
      if (stat.size === this.offset) return

      const handle = await fsp.open(this.filePath, 'r')
      try {
        const len = stat.size - this.offset
        const buffer = Buffer.alloc(len)
        await handle.read(buffer, 0, len, this.offset)
        this.offset = stat.size
        const { lines, rest } = splitLines(this.partial + buffer.toString('utf8'))
        this.partial = rest
        if (lines.length === 0) return
        const parsed = parseLines(lines, this.ctx)
        Object.assign(this.meta, parsed.meta)
        if (parsed.events.length || parsed.updates.length || Object.keys(parsed.meta).length) {
          this.emit('append', { events: parsed.events, updates: parsed.updates, meta: { ...this.meta } } satisfies TailerAppendPayload)
        }
      } finally {
        await handle.close()
      }
    } catch (err) {
      this.emit('error', err)
    } finally {
      this.reading = false
      if (this.dirty) {
        this.dirty = false
        void this.readNew()
      }
    }
  }
}

export function splitLines(text: string): { lines: string[]; rest: string } {
  const parts = text.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts.filter((line) => line.length > 0), rest }
}
