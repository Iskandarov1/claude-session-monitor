import { describe, expect, it } from 'vitest'
import { cwdTail, firstLine, relTime, shortTokens, STATE_COLOR } from '@renderer/lib/format'

describe('format helpers', () => {
  it('formats relative time, paths, tokens, and text', () => {
    const now = 1_000_000
    expect(relTime(now - 20_000, now)).toBe('now')
    expect(relTime(now - 24 * 60_000, now)).toBe('24 min')
    expect(cwdTail('/Users/dev/acme-api')).toBe('~/acme-api')
    expect(cwdTail('C:\\Users\\dev\\acme-api')).toBe('~\\acme-api')
    expect(shortTokens(2100)).toBe('2.1k')
    expect(firstLine('a\nb', 10)).toBe('a')
    expect(Object.keys(STATE_COLOR).sort()).toEqual(['ended', 'idle', 'waiting', 'working'])
  })
})
