// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '@renderer/App'
import { useStore } from '@renderer/store'
import { PUSH, type Session } from '@shared/types'
import { installMockCsm } from './mockCsm'

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: any) => <div>{data.map((item: any, index: number) => <div key={item.id ?? index}>{itemContent(index, item)}</div>)}</div>,
}))

const session = (id: string, name: string, over: Partial<Session> = {}): Session => ({
  sessionId: id,
  pid: 1,
  name,
  cwd: '/Users/dev/acme-api',
  startedAt: Date.now(),
  version: '',
  registryStatus: 'busy',
  state: 'working',
  origin: 'local',
  alive: true,
  lastActivityAt: Date.now(),
  lastActivityPreview: 'working',
  pinned: false,
  turnOutputTokens: 100,
  permissionMode: 'bypassPermissions',
  transcriptPath: '/tmp/t.jsonl',
  ...over,
})

beforeEach(() => useStore.getState().reset())

describe('App', () => {
  it('boots, lists sessions, shows transcript, and relays', async () => {
    const { csm, push } = installMockCsm({
      listSessions: async () => [session('a', 'auth-refactor'), session('b', 'perf-query-cache', { state: 'idle', registryStatus: 'idle' })],
      loadTranscript: async (id: string) => ({ sessionId: id, events: [{ kind: 'user', id: 'u', ts: Date.now(), text: 'Refactor it' }], meta: {} }) as any,
    })
    render(<App />)
    await waitFor(() => expect(screen.getAllByText('auth-refactor').length).toBeGreaterThan(0))
    expect(screen.getByText('perf-query-cache')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Refactor it')).toBeInTheDocument())
    push(PUSH.transcriptAppend, { sessionId: useStore.getState().selectedId, events: [{ kind: 'cross', id: 'x', ts: Date.now(), fromName: 'perf-query-cache', text: 'Heads up' }], updates: [], meta: {} })
    await waitFor(() => expect(screen.getByText('⇄ from perf-query-cache')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Message auth-refactor...'), { target: { value: 'status?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send prompt' }))
    await waitFor(() => expect(csm.relay).toHaveBeenCalled())
    expect(csm.relay).toHaveBeenCalledWith(['auth-refactor'], 'status?')
    push(PUSH.bridgeState, { status: 'unavailable', reason: 'claude not found' })
    await waitFor(() => expect(screen.getByText(/Relay offline/)).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Prompt input disabled...')).toBeDisabled()
  })
})
