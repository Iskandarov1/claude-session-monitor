import { describe, expect, it } from 'vitest'
import { splitRich } from '@renderer/lib/rich'

describe('splitRich', () => {
  it('splits fenced code from prose', () => {
    expect(splitRich('Here:\n```ts\nconst a = 1\n```\nafter')).toEqual([
      { type: 'text', text: 'Here:' },
      { type: 'code', lang: 'ts', code: 'const a = 1' },
      { type: 'text', text: 'after' },
    ])
  })
})
