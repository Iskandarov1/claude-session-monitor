import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { RegistryEntry } from '@shared/types'

export interface RegistryOptions {
  isAlive?: (pid: number) => boolean
  tickMs?: number
  usePolling?: boolean
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    return err?.code === 'EPERM'
  }
}

export function parseRegistryFile(json: string): RegistryEntry | null {
  let data: any
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  if (!data || typeof data.pid !== 'number' || typeof data.sessionId !== 'string') return null
  return {
    pid: data.pid,
    sessionId: data.sessionId,
    cwd: String(data.cwd ?? ''),
    startedAt: Number(data.startedAt ?? 0),
    version: String(data.version ?? ''),
    kind: String(data.kind ?? 'interactive'),
    entrypoint: String(data.entrypoint ?? 'cli'),
    name: String(data.name ?? `pid-${data.pid}`),
    nameSource: typeof data.nameSource === 'string' ? data.nameSource : undefined,
    status: data.status === 'busy' ? 'busy' : 'idle',
    updatedAt: Number(data.updatedAt ?? 0),
    statusUpdatedAt: typeof data.statusUpdatedAt === 'number' ? data.statusUpdatedAt : undefined,
    messagingSocketPath: typeof data.messagingSocketPath === 'string' ? data.messagingSocketPath : undefined,
  }
}

export class RegistryWatcher extends EventEmitter {
  private entries = new Map<number, { entry: RegistryEntry; alive: boolean }>()
  private watcher?: FSWatcher
  private timer?: NodeJS.Timeout
  private readonly isAlive: (pid: number) => boolean
  private readonly tickMs: number
  private readonly usePolling: boolean

  constructor(readonly dir: string, opts: RegistryOptions = {}) {
    super()
    this.isAlive = opts.isAlive ?? isPidAlive
    this.tickMs = opts.tickMs ?? 5000
    this.usePolling = opts.usePolling ?? false
  }

  list(): { entry: RegistryEntry; alive: boolean }[] {
    return [...this.entries.values()]
  }

  async start(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    for (const file of await fs.readdir(this.dir)) {
      if (file.endsWith('.json')) await this.load(path.join(this.dir, file))
    }
    this.watcher = chokidar.watch(this.dir, {
      depth: 0,
      ignored: (candidate) => candidate !== this.dir && !candidate.endsWith('.json'),
      ignoreInitial: true,
      interval: 50,
      usePolling: this.usePolling,
    })
    this.watcher.on('add', (file) => void this.load(file))
    this.watcher.on('change', (file) => void this.load(file))
    this.watcher.on('unlink', (file) => this.remove(file))
    await new Promise<void>((resolve) => this.watcher?.once('ready', () => resolve()))
    this.timer = setInterval(() => this.tick(), this.tickMs)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    await this.watcher?.close()
    this.timer = undefined
    this.watcher = undefined
  }

  private async load(filePath: string, attempt = 0): Promise<void> {
    let json: string
    try {
      json = await fs.readFile(filePath, 'utf8')
    } catch {
      return
    }
    const entry = parseRegistryFile(json)
    if (!entry) {
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return this.load(filePath, attempt + 1)
      }
      return
    }
    const alive = this.isAlive(entry.pid)
    this.entries.set(entry.pid, { entry, alive })
    this.emit('upsert', { entry, alive })
  }

  private remove(filePath: string): void {
    const pid = Number(path.basename(filePath, '.json'))
    if (!Number.isFinite(pid)) return
    const rec = this.entries.get(pid)
    if (!rec) return
    rec.alive = false
    rec.entry.status = 'idle'
    this.emit('upsert', { entry: rec.entry, alive: false })
    this.emit('remove', pid)
  }

  private tick(): void {
    for (const rec of this.entries.values()) {
      const alive = this.isAlive(rec.entry.pid)
      if (alive !== rec.alive) {
        rec.alive = alive
        this.emit('upsert', { entry: rec.entry, alive })
      }
    }
  }
}
