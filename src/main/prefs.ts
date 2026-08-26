import fs from 'node:fs/promises'
import path from 'node:path'
import type { Prefs } from '@shared/types'

export const DEFAULT_PREFS: Prefs = { pinned: [], bookmarks: [], promptHistory: [] }
const HISTORY_MAX = 50

export class PrefsStore {
  private prefs: Prefs = { ...DEFAULT_PREFS }
  private timer?: NodeJS.Timeout
  private writing: Promise<void> = Promise.resolve()
  private readonly debounceMs: number

  constructor(private readonly filePath: string, opts: { debounceMs?: number } = {}) {
    this.debounceMs = opts.debounceMs ?? 300
  }

  async load(): Promise<Prefs> {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8'))
      this.prefs = sanitizePrefs(raw)
    } catch {
      this.prefs = { ...DEFAULT_PREFS }
    }
    return this.get()
  }

  get(): Prefs {
    return {
      ...this.prefs,
      pinned: [...this.prefs.pinned],
      bookmarks: this.prefs.bookmarks.map((bookmark) => ({ ...bookmark })),
      promptHistory: [...this.prefs.promptHistory],
      window: this.prefs.window ? { ...this.prefs.window } : undefined,
    }
  }

  set(patch: Partial<Prefs>): Prefs {
    this.prefs = sanitizePrefs({ ...this.prefs, ...patch })
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), this.debounceMs)
    return this.get()
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    const data = JSON.stringify(this.prefs, null, 2)
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp`
      await fs.writeFile(tmp, data, 'utf8')
      await fs.rename(tmp, this.filePath)
    })
    await this.writing
  }
}

function sanitizePrefs(value: unknown): Prefs {
  const data = value && typeof value === 'object' ? (value as Partial<Prefs>) : {}
  return {
    pinned: Array.isArray(data.pinned) ? data.pinned.map(String) : [],
    bookmarks: Array.isArray(data.bookmarks)
      ? data.bookmarks
          .filter((bookmark: any) => bookmark && typeof bookmark.sessionId === 'string' && typeof bookmark.eventId === 'string')
          .map((bookmark: any) => ({ sessionId: bookmark.sessionId, eventId: bookmark.eventId, ts: Number(bookmark.ts ?? 0), preview: String(bookmark.preview ?? '') }))
      : [],
    promptHistory: Array.isArray(data.promptHistory) ? data.promptHistory.map(String).slice(0, HISTORY_MAX) : [],
    window: data.window && typeof data.window === 'object' ? sanitizeWindow(data.window as any) : undefined,
    selectedSessionId: typeof data.selectedSessionId === 'string' ? data.selectedSessionId : undefined,
  }
}

function sanitizeWindow(value: any): Prefs['window'] {
  const x = Number(value.x)
  const y = Number(value.y)
  const width = Number(value.width)
  const height = Number(value.height)
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height) ? { x, y, width, height } : undefined
}
