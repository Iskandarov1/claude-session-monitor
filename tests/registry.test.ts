import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseRegistryFile, RegistryWatcher } from '@main/registry'
import { reg } from './fixtures/sessions'

const waitFor = async (cond: () => boolean, ms = 4000) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

let dir: string
let watcher: RegistryWatcher | undefined

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'csm-reg-'))
})
afterEach(async () => {
  await watcher?.stop()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('RegistryWatcher', () => {
  it('parses registry entries and ignores invalid JSON', () => {
    expect(parseRegistryFile(reg())).toMatchObject({ pid: 73708, name: 'maydon-api-2b', status: 'busy' })
    expect(parseRegistryFile('{')).toBeNull()
    expect(parseRegistryFile('{"name":"x"}')).toBeNull()
  })

  it('loads existing entries, ignores key files, reports liveness, and emits changes', async () => {
    await fs.writeFile(path.join(dir, '1.json'), reg({ pid: 1, name: 'one' }))
    await fs.writeFile(path.join(dir, '2.abc.key'), 'secret')
    watcher = new RegistryWatcher(dir, { isAlive: (pid) => pid === 1, tickMs: 50, usePolling: true })
    const upserts: any[] = []
    const removes: number[] = []
    watcher.on('upsert', (payload) => upserts.push(payload))
    watcher.on('remove', (pid) => removes.push(pid))
    await watcher.start()
    expect(watcher.list()).toHaveLength(1)
    expect(watcher.list()[0]).toMatchObject({ entry: { name: 'one' }, alive: true })

    await fs.writeFile(path.join(dir, '5.json'), reg({ pid: 5, name: 'five', status: 'idle' }))
    await waitFor(() => upserts.some((payload) => payload.entry.pid === 5))
    await fs.unlink(path.join(dir, '5.json'))
    await waitFor(() => removes.includes(5))
  })
})
