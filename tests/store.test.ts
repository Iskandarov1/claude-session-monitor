import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { applyUpdates, SessionStore } from '@main/store'
import type { RegistryEntry, TranscriptEvent } from '@shared/types'
import { L } from './fixtures/lines'

class FakeRegistry extends EventEmitter {
  rows: { entry: RegistryEntry; alive: boolean }[] = []
  list() {
    return this.rows
  }
  upsert(entry: RegistryEntry, alive = true) {
    this.rows = this.rows.filter((row) => row.entry.pid !== entry.pid).concat({ entry, alive })
    this.emit('upsert', { entry, alive })
  }
  remove(pid: number) {
    this.rows = this.rows.filter((row) => row.entry.pid !== pid)
    this.emit('remove', pid)
  }
}

const waitFor = async (cond: () => boolean, ms = 4000) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  pid: 1,
  sessionId: 'db0dacce-7b5f-4f61-a04e-c8fc48f9aafd',
  cwd: '/Users/dev/acme-api',
  startedAt: 1,
  version: '2.1.246',
  kind: 'interactive',
  entrypoint: 'cli',
  name: 'auth-refactor',
  status: 'busy',
  updatedAt: 1,
  ...over,
})

let dir: string
let store: SessionStore | undefined
let registry: FakeRegistry

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'csm-store-'))
  await fs.mkdir(path.join(dir, '-Users-dev-acme-api'), { recursive: true })
  registry = new FakeRegistry()
})
afterEach(async () => {
  await store?.stop()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('SessionStore', () => {
  it('applies updates in place', () => {
    const events: TranscriptEvent[] = [{ kind: 'claude', id: 'a', ts: 1, text: 'Hi' }, { kind: 'tool', id: 't', ts: 2, name: 'Bash', input: {} }]
    applyUpdates(events, [{ id: 'a', patch: { appendText: ' there', outputTokens: 9 } }, { id: 't', patch: { resultText: 'ok', isError: false } }])
    expect(events[0]).toMatchObject({ text: 'Hi there', outputTokens: 9 })
    expect(events[1]).toMatchObject({ resultText: 'ok', isError: false })
  })

  it('builds sessions from registry plus transcript and keeps removed sessions as ended', async () => {
    const file = path.join(dir, '-Users-dev-acme-api', 'db0dacce-7b5f-4f61-a04e-c8fc48f9aafd.jsonl')
    await fs.writeFile(file, `${[L.userText, L.permissionMode, L.aiTitle, L.assistantText].join('\n')}\n`)
    store = new SessionStore({ registry: registry as any, projectsRoot: dir, tailerPollMs: 30, tickMs: 30 })
    const resets: any[] = []
    store.on('transcript:reset', (payload) => resets.push(payload))
    await store.start()
    registry.upsert(entry())
    await waitFor(() => resets.length === 1)
    expect(store.session('db0dacce-7b5f-4f61-a04e-c8fc48f9aafd')).toMatchObject({ name: 'auth-refactor', state: 'working', permissionMode: 'bypassPermissions', aiTitle: 'Token store refactor', transcriptPath: file })
    registry.remove(1)
    await waitFor(() => store!.session('db0dacce-7b5f-4f61-a04e-c8fc48f9aafd')?.state === 'ended')
  })
})
