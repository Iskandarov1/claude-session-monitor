import { vi } from 'vitest'
import type { CsmApi } from '@shared/types'

export function installMockCsm(over: Partial<CsmApi> = {}) {
  const listeners = new Map<string, (payload: any) => void>()
  const csm: CsmApi = {
    platform: 'darwin',
    listSessions: vi.fn(async () => []),
    loadTranscript: vi.fn(async () => null),
    exportTranscript: vi.fn(async () => ({ saved: false })),
    relay: vi.fn(async (targets: string[]) => ({ sent: targets, failed: [], latencyMs: 1 })),
    bridgeRetry: vi.fn(async () => undefined),
    bridgeState: vi.fn(async () => ({ status: 'connected' as const, bridgeName: 'csm-bridge' })),
    listFeed: vi.fn(async () => []),
    search: vi.fn(async () => []),
    getPrefs: vi.fn(async () => ({ pinned: [], bookmarks: [], promptHistory: [] })),
    setPrefs: vi.fn(async (patch) => ({ pinned: [], bookmarks: [], promptHistory: [], ...patch })),
    openLogs: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
    windowControl: vi.fn(),
    on: vi.fn((channel: string, cb: (payload: any) => void) => {
      listeners.set(channel, cb)
      return () => listeners.delete(channel)
    }),
    ...over,
  }
  ;(globalThis as any).window.csm = csm
  return { csm, push: (channel: string, payload: unknown) => listeners.get(channel)?.(payload) }
}
