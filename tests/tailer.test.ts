import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { findTranscript } from '@main/transcript/locate'
import { TranscriptTailer } from '@main/transcript/tailer'
import { L } from './fixtures/lines'

const waitFor = async (cond: () => boolean, ms = 3000) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'csm-tailer-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('findTranscript', () => {
  it('finds direct, scanned, and absent transcript files', async () => {
    const direct = path.join(dir, '-a-b', 'sid.jsonl')
    await fs.mkdir(path.dirname(direct), { recursive: true })
    await fs.writeFile(direct, '')
    expect(await findTranscript('sid', '/a/b', dir)).toBe(direct)
    const scanned = path.join(dir, '-other', 'sid2.jsonl')
    await fs.mkdir(path.dirname(scanned), { recursive: true })
    await fs.writeFile(scanned, '')
    expect(await findTranscript('sid2', '/a/b', dir)).toBe(scanned)
    expect(await findTranscript('none', '/a/b', dir)).toBeNull()
  })
})

describe('TranscriptTailer', () => {
  it('emits reset, buffers partial lines, appends lines, and resets on truncation', async () => {
    const file = path.join(dir, 't.jsonl')
    await fs.writeFile(file, `${L.userText}\n${L.permissionMode}\n`)
    const tailer = new TranscriptTailer('sid', file, { pollMs: 30 })
    const resets: any[] = []
    const appends: any[] = []
    tailer.on('reset', (payload) => resets.push(payload))
    tailer.on('append', (payload) => appends.push(payload))
    await tailer.start()
    expect(resets).toHaveLength(1)
    expect(resets[0].events.map((event: any) => event.kind)).toEqual(['divider', 'user'])

    await fs.appendFile(file, L.assistantText.slice(0, 40))
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(appends).toHaveLength(0)
    await fs.appendFile(file, `${L.assistantText.slice(40)}\n`)
    await waitFor(() => appends.length === 1)
    expect(appends[0].events.at(-1)).toMatchObject({ kind: 'claude', id: 'a1' })

    await fs.writeFile(file, `${L.cross}\n`)
    await waitFor(() => resets.length === 2)
    expect(resets[1].events.map((event: any) => event.kind)).toEqual(['divider', 'cross'])
    tailer.stop()
  })
})
