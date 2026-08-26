import { describe, expect, it } from 'vitest'
import { claudeHome, projectsDir, projectSlug, sessionsDir, transcriptPath } from '@main/paths'

describe('paths', () => {
  it('resolves Claude config directories and transcript paths', () => {
    expect(claudeHome({}, '/Users/me')).toBe('/Users/me/.claude')
    expect(claudeHome({ CLAUDE_CONFIG_DIR: '/x/cfg' }, '/Users/me')).toBe('/x/cfg')
    expect(sessionsDir('/h/.claude')).toBe('/h/.claude/sessions')
    expect(projectsDir('/h/.claude')).toBe('/h/.claude/projects')
    expect(projectSlug('/tmp/my.app_v2')).toBe('-tmp-my-app-v2')
    expect(transcriptPath('/a/b', 'abc-123', '/h/.claude')).toBe('/h/.claude/projects/-a-b/abc-123.jsonl')
  })
})
