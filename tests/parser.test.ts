import { describe, expect, it } from 'vitest'
import { createParseContext, parseLine, parseLines } from '@main/transcript/parser'
import { L } from './fixtures/lines'

const run = (lines: string[]) => parseLines(lines, createParseContext())
const kinds = (lines: string[]) => run(lines).events.map((event) => event.kind)

describe('transcript parser', () => {
  it('maps user, assistant, tool, cross-session, system, and meta lines', () => {
    const out = run([L.userText, L.userTextBlocks, L.assistantText, L.assistantText2, L.assistantTool, L.toolResult, L.assistantSend, L.cross, L.systemLocal, L.permissionMode, L.aiTitle, L.costState])
    expect(out.events.map((event) => event.kind)).toEqual(['divider', 'user', 'user', 'claude', 'tool', 'sent', 'cross', 'system'])
    expect(out.events[1]).toMatchObject({ kind: 'user', id: 'u1', text: 'Refactor the token store.' })
    expect(out.updates).toContainEqual({ id: 'a1', patch: { appendText: ' Then the shim.', outputTokens: 180 } })
    expect(out.updates).toContainEqual({ id: 'toolu_1', patch: { resultText: '12 passed', isError: false } })
    expect(out.events[6]).toMatchObject({ kind: 'cross', fromName: 'perf-query-cache', fromMode: 'bypass' })
    expect(out.meta).toMatchObject({ model: 'claude-sonnet-4-6', permissionMode: 'bypassPermissions', aiTitle: 'Token store refactor', totalCostUSD: 1.25 })
  })

  it('drops ignored and malformed shapes', () => {
    expect(kinds([L.userText, L.userMeta, L.userSystemTag, L.assistantThinking, L.dequeue, L.systemTurn, L.attachment, L.garbage, ''])).toEqual(['divider', 'user'])
  })

  it('inserts a resumed divider after a gap', () => {
    expect(kinds([L.userText, L.userAfterGap])).toEqual(['divider', 'user', 'divider', 'user'])
  })

  it('parseLine returns the same output shape', () => {
    const ctx = createParseContext()
    expect(parseLine(L.userText, ctx).events).toHaveLength(2)
    expect(ctx.sawFirst).toBe(true)
  })
})
