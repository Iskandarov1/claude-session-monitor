// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { PUSH } from '@shared/types'
import { useStore } from '@renderer/store'
import { installMockCsm } from './mockCsm'

const sess = (id: string, over = {}) => ({
  sessionId: id,
  pid: 1,
  name: id,
  cwd: '/x',
  startedAt: 0,
  version: '',
  registryStatus: 'idle',
  state: 'idle',
  origin: 'local',
  alive: true,
  lastActivityAt: 0,
  lastActivityPreview: '',
  pinned: false,
  turnOutputTokens: 0,
  ...over,
})

describe('renderer store', () => {
  beforeEach(() => useStore.getState().reset())

  it('initializes and applies push updates', async () => {
    const { push } = installMockCsm({
      listSessions: async () => [sess('a', { lastActivityAt: 1 }), sess('b', { lastActivityAt: 9 })] as any,
      loadTranscript: async (id: string) => ({ sessionId: id, events: [{ kind: 'user', id: 'u', ts: 1, text: 'hi' }], meta: {} }) as any,
    })
    await useStore.getState().init()
    expect(useStore.getState().selectedId).toBe('b')
    push(PUSH.sessionUpsert, sess('c'))
    expect(useStore.getState().sessions.c!.name).toBe('c')
    push(PUSH.transcriptReset, { sessionId: 'c', events: [{ kind: 'claude', id: 'm', ts: 1, text: 'Hi' }], meta: {} })
    push(PUSH.transcriptAppend, { sessionId: 'c', events: [], updates: [{ id: 'm', patch: { appendText: ' there' } }], meta: {} })
    expect((useStore.getState().transcripts.c!.events[0] as any).text).toBe('Hi there')
  })

  it('selects, multi-selects, persists pins, and jumps', async () => {
    const { csm } = installMockCsm({ listSessions: async () => [sess('a'), sess('b')] as any, loadTranscript: async (id: string) => ({ sessionId: id, events: [], meta: {} }) as any })
    await useStore.getState().init()
    useStore.getState().select('a')
    useStore.getState().select('b', true)
    expect(useStore.getState().multiIds).toEqual(['a', 'b'])
    await useStore.getState().togglePin('a')
    expect(csm.setPrefs).toHaveBeenCalledWith({ pinned: ['a'] })
    useStore.getState().jump({ sessionId: 'b', ts: 5 })
    expect(useStore.getState().jumpTarget).toEqual({ sessionId: 'b', ts: 5 })
  })
})
