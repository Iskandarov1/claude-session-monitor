import { describe, expect, it } from 'vitest'
import { transcriptToMarkdown } from '@main/export'

describe('transcriptToMarkdown', () => {
  it('renders the transcript as markdown', () => {
    const md = transcriptToMarkdown({ name: 'auth-refactor', cwd: '/x', startedAt: Date.UTC(2026, 7, 26, 11, 2) }, [
      { kind: 'divider', id: 'd', ts: 1, text: 'session started 11:02' },
      { kind: 'user', id: 'u', ts: Date.UTC(2026, 7, 26, 11, 4), text: 'Do it' },
      { kind: 'claude', id: 'c', ts: Date.UTC(2026, 7, 26, 11, 5), text: 'Done.' },
      { kind: 'tool', id: 't', ts: 3, name: 'Bash', input: { command: 'npm test' }, resultText: 'ok' },
      { kind: 'cross', id: 'x', ts: 4, fromName: 'perf', text: 'heads up' },
      { kind: 'sent', id: 's', ts: 5, to: ['perf'], text: 'thanks' },
      { kind: 'system', id: 'sy', ts: 6, text: '/rename' },
    ])
    expect(md).toContain('# auth-refactor')
    expect(md).toContain('cwd: `/x`')
    expect(md).toContain('**You**')
    expect(md).toContain('**Claude**')
    expect(md).toContain('**Tool')
    expect(md).toContain('from perf')
    expect(md).toContain('to perf')
  })
})
