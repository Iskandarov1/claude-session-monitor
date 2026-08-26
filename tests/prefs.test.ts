import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_PREFS, PrefsStore } from '@main/prefs'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'csm-prefs-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('PrefsStore', () => {
  it('loads defaults, sanitizes, caps history, and persists', async () => {
    const file = path.join(dir, 'prefs.json')
    const prefs = new PrefsStore(file, { debounceMs: 10 })
    expect(await prefs.load()).toEqual(DEFAULT_PREFS)
    prefs.set({ pinned: ['a'], promptHistory: Array.from({ length: 60 }, (_, i) => `p${i}`) })
    expect(prefs.get().promptHistory).toHaveLength(50)
    await prefs.flush()
    const again = new PrefsStore(file)
    expect((await again.load()).pinned).toEqual(['a'])
  })
})
