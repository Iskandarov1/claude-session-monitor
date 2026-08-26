import { EventEmitter } from 'node:events'
import type {
  EventUpdate,
  RegistryEntry,
  Session,
  Stats,
  TranscriptAppendPayload,
  TranscriptEvent,
  TranscriptMeta,
  TranscriptResetPayload,
} from '@shared/types'
import type { RegistryWatcher } from './registry'
import { deriveState, lastActivity } from './state'
import { findTranscript } from './transcript/locate'
import { TranscriptTailer } from './transcript/tailer'

export interface StoreOptions {
  registry: RegistryWatcher
  projectsRoot: string
  excludeNames?: string[]
  isExcludedPid?: (pid: number) => boolean
  now?: () => number
  tailerPollMs?: number
  tickMs?: number
}

export function applyUpdates(events: TranscriptEvent[], updates: EventUpdate[]): void {
  if (updates.length === 0) return
  const byId = new Map(events.map((event) => [event.id, event]))
  for (const update of updates) {
    const event = byId.get(update.id) as any
    if (!event) continue
    const { appendText, ...rest } = update.patch as any
    if (typeof appendText === 'string' && typeof event.text === 'string') event.text += appendText
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) event[key] = value
    }
  }
}

interface Rec {
  session: Session
  events: TranscriptEvent[]
  meta: TranscriptMeta
  tailer?: TranscriptTailer
  alive: boolean
}

export class SessionStore extends EventEmitter {
  private recs = new Map<string, Rec>()
  private recByPid = new Map<number, Rec>()
  private pinned = new Set<string>()
  private timer?: NodeJS.Timeout
  private registryListeners: (() => void)[] = []
  private readonly now: () => number
  private readonly excludeNames: Set<string>

  constructor(private readonly opts: StoreOptions) {
    super()
    this.now = opts.now ?? Date.now
    this.excludeNames = new Set(opts.excludeNames ?? [])
  }

  sessions(): Session[] {
    return [...this.recs.values()].map((rec) => ({ ...rec.session }))
  }

  session(id: string): Session | undefined {
    const session = this.recs.get(id)?.session
    return session ? { ...session } : undefined
  }

  transcript(id: string): { events: TranscriptEvent[]; meta: TranscriptMeta } | undefined {
    const rec = this.recs.get(id)
    return rec ? { events: rec.events.map((event) => ({ ...event } as TranscriptEvent)), meta: { ...rec.meta } } : undefined
  }

  stats(): Stats {
    const stats: Stats = { working: 0, waiting: 0, idle: 0, ended: 0, refreshedAt: this.now() }
    for (const rec of this.recs.values()) stats[rec.session.state]++
    return stats
  }

  setPinned(ids: string[]): void {
    this.pinned = new Set(ids)
    for (const rec of this.recs.values()) {
      const pinned = this.pinned.has(rec.session.sessionId)
      if (pinned !== rec.session.pinned) {
        rec.session.pinned = pinned
        this.emit('session', { ...rec.session })
      }
    }
    this.emit('stats', this.stats())
  }

  async start(): Promise<void> {
    const onUpsert = (payload: { entry: RegistryEntry; alive: boolean }) => void this.onUpsert(payload.entry, payload.alive)
    const onRemove = (pid: number) => this.onRemove(pid)
    this.opts.registry.on('upsert', onUpsert)
    this.opts.registry.on('remove', onRemove)
    this.registryListeners = [
      () => this.opts.registry.off('upsert', onUpsert),
      () => this.opts.registry.off('remove', onRemove),
    ]
    for (const { entry, alive } of this.opts.registry.list()) await this.onUpsert(entry, alive)
    this.timer = setInterval(() => this.recompute(), this.opts.tickMs ?? 5000)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    for (const unsub of this.registryListeners.splice(0)) unsub()
    for (const rec of this.recs.values()) rec.tailer?.stop()
  }

  private excluded(entry: RegistryEntry): boolean {
    return this.excludeNames.has(entry.name) || Boolean(this.opts.isExcludedPid?.(entry.pid))
  }

  private async onUpsert(entry: RegistryEntry, alive: boolean): Promise<void> {
    if (this.excluded(entry)) return

    let rec = this.recs.get(entry.sessionId)
    if (!rec) {
      rec = {
        alive,
        events: [],
        meta: {},
        session: {
          sessionId: entry.sessionId,
          pid: entry.pid,
          name: entry.name,
          nameSource: entry.nameSource,
          cwd: entry.cwd,
          startedAt: entry.startedAt,
          version: entry.version,
          registryStatus: entry.status,
          state: 'idle',
          origin: 'local',
          alive,
          lastActivityAt: entry.updatedAt || entry.startedAt,
          lastActivityPreview: '',
          pinned: this.pinned.has(entry.sessionId),
          turnOutputTokens: 0,
        },
      }
      this.recs.set(entry.sessionId, rec)
      this.recByPid.set(entry.pid, rec)
      this.refresh(rec)
      await this.attachTailer(rec)
    } else {
      this.recByPid.delete(rec.session.pid)
      this.recByPid.set(entry.pid, rec)
      Object.assign(rec.session, {
        pid: entry.pid,
        name: entry.name,
        nameSource: entry.nameSource,
        cwd: entry.cwd,
        registryStatus: entry.status,
        version: entry.version,
      })
      rec.alive = alive
      this.refresh(rec)
      if (!rec.tailer) await this.attachTailer(rec)
    }
  }

  private onRemove(pid: number): void {
    const rec = this.recByPid.get(pid)
    if (!rec) return
    rec.alive = false
    rec.tailer?.stop()
    rec.tailer = undefined
    this.refresh(rec)
  }

  private async attachTailer(rec: Rec): Promise<void> {
    const filePath = await findTranscript(rec.session.sessionId, rec.session.cwd, this.opts.projectsRoot)
    if (!filePath) {
      this.emit('session', { ...rec.session })
      return
    }

    rec.session.transcriptPath = filePath
    const tailer = new TranscriptTailer(rec.session.sessionId, filePath, { pollMs: this.opts.tailerPollMs })
    rec.tailer = tailer
    tailer.on('reset', (payload: { events: TranscriptEvent[]; meta: TranscriptMeta }) => {
      rec.events = payload.events
      rec.meta = payload.meta
      this.refresh(rec)
      const reset: TranscriptResetPayload = { sessionId: rec.session.sessionId, events: rec.events.map((event) => ({ ...event } as TranscriptEvent)), meta: { ...rec.meta } }
      this.emit('transcript:reset', reset)
    })
    tailer.on('append', (payload: { events: TranscriptEvent[]; updates: EventUpdate[]; meta: TranscriptMeta }) => {
      rec.events.push(...payload.events)
      applyUpdates(rec.events, payload.updates)
      rec.meta = payload.meta
      this.refresh(rec)
      const append: TranscriptAppendPayload = {
        sessionId: rec.session.sessionId,
        events: payload.events.map((event) => ({ ...event } as TranscriptEvent)),
        updates: payload.updates,
        meta: { ...rec.meta },
      }
      this.emit('transcript:append', append)
    })
    tailer.on('error', (err) => this.emit('tailer:error', err))
    try {
      await tailer.start()
    } catch (err) {
      rec.tailer = undefined
      this.emit('tailer:error', err)
    }
  }

  private refresh(rec: Rec): void {
    const session = rec.session
    session.alive = rec.alive
    session.pinned = this.pinned.has(session.sessionId)
    session.model = rec.meta.model ?? session.model
    session.permissionMode = rec.meta.permissionMode ?? session.permissionMode
    session.aiTitle = rec.meta.aiTitle ?? session.aiTitle
    session.totalCostUSD = rec.meta.totalCostUSD ?? session.totalCostUSD
    const activity = lastActivity(rec.events)
    if (activity.ts) {
      session.lastActivityAt = activity.ts
      session.lastActivityPreview = activity.preview
    }
    session.turnOutputTokens = currentTurnTokens(rec.events)
    const lastEvent = [...rec.events].reverse().find((event) => event.kind !== 'divider')
    session.state = deriveState({ alive: rec.alive, registryStatus: session.registryStatus, lastEvent, now: this.now() })
    this.emit('session', { ...session })
    this.emit('stats', this.stats())
  }

  recompute(): void {
    let changed = false
    for (const rec of this.recs.values()) {
      const lastEvent = [...rec.events].reverse().find((event) => event.kind !== 'divider')
      const state = deriveState({ alive: rec.alive, registryStatus: rec.session.registryStatus, lastEvent, now: this.now() })
      if (state !== rec.session.state) {
        rec.session.state = state
        this.emit('session', { ...rec.session })
        changed = true
      }
    }
    this.emit('stats', this.stats())
    if (changed) this.emit('changed')
  }
}

export function currentTurnTokens(events: TranscriptEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.kind === 'user') return 0
    if (event.kind === 'claude' && typeof event.outputTokens === 'number') return event.outputTokens
  }
  return 0
}
