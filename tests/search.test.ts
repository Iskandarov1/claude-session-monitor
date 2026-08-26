import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadRecentTranscripts, SearchIndex } from '@main/search'
import { L } from './fixtures/lines'

describe('SearchIndex', () => {
  it('searches, updates, limits, removes, and replaces stale reset content', () => {
    const index = new SearchIndex()
    index.upsert('A', 'auth', [{ kind: 'user', id: 'u', ts: 1, text: 'Token store' }, { kind: 'claude', id: 'c', ts: 2, text: 'hello' }])
    index.applyUpdates('A', [{ id: 'c', patch: { appendText: ' token' } }])
    expect(index.query('TOKEN').map((hit) => hit.eventId)).toEqual(['c', 'u'])
    index.replace('A', 'auth', [{ kind: 'user', id: 'fresh', ts: 3, text: 'new text' }])
    expect(index.query('token')).toEqual([])
    expect(index.query('new')).toHaveLength(1)
    index.remove('A')
    expect(index.size).toBe(0)
  })
})

describe('loadRecentTranscripts', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'csm-search-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('loads recent non-live transcripts', async () => {
    await fs.mkdir(path.join(dir, '-p1'), { recursive: true })
    await fs.writeFile(path.join(dir, '-p1', 'fresh.jsonl'), `${L.userText}\n${L.aiTitle}\n`)
    await fs.writeFile(path.join(dir, '-p1', 'live.jsonl'), `${L.userText}\n`)
    const rows = await loadRecentTranscripts(dir, 7, new Set(['live']))
    expect(rows.map((row) => [row.sessionId, row.name])).toEqual([['fresh', 'Token store refactor']])
  })
})
