import { describe, expect, it } from 'vitest'
import { deriveState, lastActivity, WAITING_MS } from '@main/state'
import type { TranscriptEvent } from '@shared/types'

const t0 = 1_000_000
const tool = (ts: number, done = false): TranscriptEvent => ({ kind: 'tool', id: 't', ts, name: 'Bash', input: {}, ...(done ? { resultText: 'ok' } : {}) })

describe('state helpers', () => {
  it('derives session state', () => {
    expect(deriveState({ alive: false, registryStatus: 'busy', now: t0 })).toBe('ended')
    expect(deriveState({ alive: true, registryStatus: 'idle', now: t0 })).toBe('idle')
    expect(deriveState({ alive: true, registryStatus: 'busy', now: t0, lastEvent: tool(t0 - 1000) })).toBe('working')
    expect(deriveState({ alive: true, registryStatus: 'busy', now: t0, lastEvent: tool(t0 - WAITING_MS - 1) })).toBe('waiting')
  })

  it('summarizes last activity', () => {
    const long = 'x'.repeat(100)
    expect(lastActivity([{ kind: 'claude', id: 'c', ts: 2, text: long }]).preview).toBe(`${'x'.repeat(59)}...`)
    expect(lastActivity([{ kind: 'tool', id: 't', ts: 5, name: 'Bash', input: { command: 'npm test' } }]).preview).toBe('Bash: npm test')
    expect(lastActivity([])).toEqual({ ts: 0, preview: '' })
  })
})
