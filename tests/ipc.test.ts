import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import { FeedBuilder } from '@main/feed'
import { registerIpc, wirePush } from '@main/ipc'
import { PrefsStore } from '@main/prefs'
import { SearchIndex } from '@main/search'
import { IPC, PUSH } from '@shared/types'

class FakeIpc {
  handlers = new Map<string, Function>()
  listeners = new Map<string, Function>()
  handle(channel: string, fn: Function) {
    this.handlers.set(channel, fn)
  }
  on(channel: string, fn: Function) {
    this.listeners.set(channel, fn)
  }
  invoke(channel: string, ...args: any[]) {
    return this.handlers.get(channel)!({}, ...args)
  }
}

function deps() {
  const store = Object.assign(new EventEmitter(), {
    sessions: () => [{ sessionId: 'A', name: 'a', cwd: '/x', startedAt: 0 }],
    session: (id: string) => (id === 'A' ? { sessionId: 'A', name: 'a', cwd: '/x', startedAt: 0 } : undefined),
    transcript: (id: string) => (id === 'A' ? { events: [{ kind: 'user', id: 'u', ts: 1, text: 'hi' }], meta: {} } : undefined),
    setPinned: vi.fn(),
    stats: () => ({ working: 0, waiting: 0, idle: 0, ended: 0, refreshedAt: 0 }),
  })
  const bridge = Object.assign(new EventEmitter(), {
    state: { status: 'connected', bridgeName: 'csm-bridge' },
    relay: vi.fn(async (targets: string[]) => ({ sent: targets, failed: [], latencyMs: 5 })),
    retry: vi.fn(),
  })
  const feed = new FeedBuilder({ bridgeName: 'csm-bridge' })
  const search = new SearchIndex()
  const prefs = new PrefsStore(path.join(os.tmpdir(), `csm-ipc-${Date.now()}.json`), { debounceMs: 10 })
  return {
    store: store as any,
    bridge: bridge as any,
    feed,
    search,
    prefs,
    projectsRoot: '/p',
    send: vi.fn(),
    saveMarkdown: vi.fn(async () => ({ saved: true, path: '/tmp/a.md' })),
    openPath: vi.fn(async () => undefined),
    reload: vi.fn(),
    windowControl: vi.fn(),
    now: () => 1234,
  }
}

describe('ipc', () => {
  it('serves invoke channels and relays through the bridge', async () => {
    const d = deps()
    const ipc = new FakeIpc()
    registerIpc(ipc, d)
    expect(await ipc.invoke(IPC.sessionsList)).toHaveLength(1)
    expect(await ipc.invoke(IPC.transcriptLoad, 'A')).toMatchObject({ sessionId: 'A', events: [{ id: 'u' }] })
    await ipc.invoke(IPC.prefsSet, { pinned: ['A'] })
    expect(d.store.setPinned).toHaveBeenCalledWith(['A'])
    d.search.upsert('A', 'a', [{ kind: 'user', id: 'u', ts: 1, text: 'find me' }])
    expect(await ipc.invoke(IPC.searchQuery, 'find')).toHaveLength(1)
    expect(await ipc.invoke(IPC.transcriptExport, 'A')).toEqual({ saved: true, path: '/tmp/a.md' })
    const relay = await ipc.invoke(IPC.relaySend, ['x'], 'status?')
    expect(relay.sent).toEqual(['x'])
    expect(d.feed.items()[0]).toMatchObject({ from: 'you', to: ['x'] })
    expect(d.send).toHaveBeenCalledWith(PUSH.feedUpdate, expect.any(Array))
  })

  it('forwards push events through search/feed and utility commands', async () => {
    const d = deps()
    const ipc = new FakeIpc()
    registerIpc(ipc, d)
    wirePush(d)
    d.store.emit('session', { sessionId: 'A', name: 'a' })
    expect(d.send).toHaveBeenCalledWith(PUSH.sessionUpsert, { sessionId: 'A', name: 'a' })
    d.store.emit('transcript:reset', { sessionId: 'A', events: [{ kind: 'sent', id: 's', ts: 1, to: ['b'], text: 'ping' }], meta: {} })
    expect(d.search.query('ping')).toHaveLength(1)
    expect(d.feed.items()[0]).toMatchObject({ from: 'a', to: ['b'] })
    d.bridge.emit('state', { status: 'relaying', targets: ['b'] })
    expect(d.send).toHaveBeenCalledWith(PUSH.bridgeState, { status: 'relaying', targets: ['b'] })
    ipc.listeners.get(IPC.windowMinimize)!({})
    expect(d.windowControl).toHaveBeenCalledWith('minimize')
    await ipc.invoke(IPC.appOpenLogs)
    expect(d.openPath).toHaveBeenCalledWith('/p')
  })
})
