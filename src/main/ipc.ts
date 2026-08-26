import type { BridgeState, FeedItem, Prefs, RelayResult, Session, TranscriptAppendPayload, TranscriptResetPayload } from '@shared/types'
import { IPC, PUSH } from '@shared/types'
import type { Bridge } from './bridge'
import { transcriptToMarkdown } from './export'
import type { FeedBuilder } from './feed'
import type { PrefsStore } from './prefs'
import type { SearchIndex } from './search'
import type { SessionStore } from './store'

export interface IpcLike {
  handle(channel: string, fn: (event: unknown, ...args: any[]) => unknown): void
  on(channel: string, fn: (event: unknown, ...args: any[]) => void): void
}

export interface IpcDeps {
  store: SessionStore
  bridge: Bridge
  feed: FeedBuilder
  search: SearchIndex
  prefs: PrefsStore
  projectsRoot: string
  send(channel: string, payload: unknown): void
  saveMarkdown(defaultName: string, content: string): Promise<{ saved: boolean; path?: string }>
  openPath(path: string): Promise<void>
  reload(): void
  windowControl(action: 'minimize' | 'maximize' | 'close'): void
  now?: () => number
}

export type WireDeps = Pick<IpcDeps, 'store' | 'bridge' | 'feed' | 'search' | 'send'>

export function registerIpc(ipc: IpcLike, deps: IpcDeps): void {
  const now = deps.now ?? Date.now

  ipc.handle(IPC.sessionsList, (): Session[] => deps.store.sessions())
  ipc.handle(IPC.transcriptLoad, (_event, sessionId: string): TranscriptResetPayload | null => {
    const transcript = deps.store.transcript(sessionId)
    return transcript ? { sessionId, events: transcript.events, meta: transcript.meta } : null
  })
  ipc.handle(IPC.transcriptExport, async (_event, sessionId: string) => {
    const session = deps.store.session(sessionId)
    const transcript = deps.store.transcript(sessionId)
    if (!session || !transcript) return { saved: false }
    return deps.saveMarkdown(safeFileName(`${session.name}.md`), transcriptToMarkdown(session, transcript.events))
  })
  ipc.handle(IPC.relaySend, async (_event, targets: string[], text: string): Promise<RelayResult> => {
    const cleanText = String(text ?? '').trim()
    if (!cleanText) throw new Error('empty relay message')
    const history = [cleanText, ...deps.prefs.get().promptHistory.filter((entry) => entry !== cleanText)]
    deps.prefs.set({ promptHistory: history })
    deps.feed.recordRelay(targets, cleanText, now())
    deps.send(PUSH.feedUpdate, deps.feed.items())
    return deps.bridge.relay(targets, cleanText)
  })
  ipc.handle(IPC.bridgeRetry, () => deps.bridge.retry())
  ipc.handle(IPC.bridgeState, (): BridgeState => deps.bridge.state)
  ipc.handle(IPC.feedList, (): FeedItem[] => deps.feed.items())
  ipc.handle(IPC.searchQuery, (_event, q: string) => deps.search.query(String(q ?? '')))
  ipc.handle(IPC.prefsGet, (): Prefs => deps.prefs.get())
  ipc.handle(IPC.prefsSet, (_event, patch: Partial<Prefs>): Prefs => {
    const prefs = deps.prefs.set(patch)
    if (patch.pinned) deps.store.setPinned(prefs.pinned)
    return prefs
  })
  ipc.handle(IPC.appOpenLogs, () => deps.openPath(deps.projectsRoot))
  ipc.handle(IPC.appReload, () => deps.reload())
  ipc.on(IPC.windowMinimize, () => deps.windowControl('minimize'))
  ipc.on(IPC.windowMaximize, () => deps.windowControl('maximize'))
  ipc.on(IPC.windowClose, () => deps.windowControl('close'))
}

export function wirePush(deps: WireDeps): () => void {
  const onSession = (session: Session) => {
    deps.feed.rename(session.sessionId, session.name)
    deps.send(PUSH.sessionUpsert, session)
  }
  const onRemoved = (sessionId: string) => {
    deps.search.remove(sessionId)
    deps.send(PUSH.sessionRemove, sessionId)
  }
  const onReset = (payload: TranscriptResetPayload) => {
    const name = deps.store.session(payload.sessionId)?.name ?? payload.sessionId
    deps.search.replace(payload.sessionId, name, payload.events)
    if (deps.feed.ingest(payload.sessionId, name, payload.events)) deps.send(PUSH.feedUpdate, deps.feed.items())
    deps.send(PUSH.transcriptReset, payload)
  }
  const onAppend = (payload: TranscriptAppendPayload) => {
    const name = deps.store.session(payload.sessionId)?.name ?? payload.sessionId
    deps.search.upsert(payload.sessionId, name, payload.events)
    deps.search.applyUpdates(payload.sessionId, payload.updates)
    if (deps.feed.ingest(payload.sessionId, name, payload.events)) deps.send(PUSH.feedUpdate, deps.feed.items())
    deps.send(PUSH.transcriptAppend, payload)
  }
  const onStats = (stats: unknown) => deps.send(PUSH.statsUpdate, stats)
  const onBridge = (state: BridgeState) => deps.send(PUSH.bridgeState, state)

  deps.store.on('session', onSession)
  deps.store.on('removed', onRemoved)
  deps.store.on('transcript:reset', onReset)
  deps.store.on('transcript:append', onAppend)
  deps.store.on('stats', onStats)
  deps.bridge.on('state', onBridge)

  return () => {
    deps.store.off('session', onSession)
    deps.store.off('removed', onRemoved)
    deps.store.off('transcript:reset', onReset)
    deps.store.off('transcript:append', onAppend)
    deps.store.off('stats', onStats)
    deps.bridge.off('state', onBridge)
  }
}

function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
}
