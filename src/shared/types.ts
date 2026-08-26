export type SessionState = 'working' | 'idle' | 'waiting' | 'ended'
export type Origin = 'local' | 'cloud' | 'remote'
export type RegistryStatus = 'busy' | 'idle'

export interface RegistryEntry {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  version: string
  kind: string
  entrypoint: string
  name: string
  nameSource?: string
  status: RegistryStatus
  updatedAt: number
  statusUpdatedAt?: number
  messagingSocketPath?: string
}

export interface Session {
  sessionId: string
  pid: number
  name: string
  nameSource?: string
  cwd: string
  gitBranch?: string
  startedAt: number
  version: string
  registryStatus: RegistryStatus
  state: SessionState
  origin: Origin
  alive: boolean
  lastActivityAt: number
  lastActivityPreview: string
  model?: string
  permissionMode?: string
  aiTitle?: string
  totalCostUSD?: number
  transcriptPath?: string
  pinned: boolean
  turnOutputTokens: number
}

interface EventBase {
  id: string
  ts: number
}

export type TranscriptEvent =
  | (EventBase & { kind: 'user'; text: string })
  | (EventBase & { kind: 'claude'; text: string; model?: string; outputTokens?: number; messageId?: string })
  | (EventBase & { kind: 'tool'; name: string; input: unknown; resultText?: string; isError?: boolean })
  | (EventBase & { kind: 'cross'; fromName: string; fromMode?: string; text: string })
  | (EventBase & { kind: 'sent'; to: string[]; text: string })
  | (EventBase & { kind: 'system'; text: string; level?: string })
  | (EventBase & { kind: 'divider'; text: string })

export type EventKind = TranscriptEvent['kind']

export interface EventUpdate {
  id: string
  patch: Partial<TranscriptEvent> & { appendText?: string }
}

export interface TranscriptMeta {
  permissionMode?: string
  aiTitle?: string
  totalCostUSD?: number
  model?: string
  gitBranch?: string
}

export interface FeedItem {
  id: string
  ts: number
  from: string
  to: string[]
  text: string
  senderSessionId?: string
  receiverSessionIds: string[]
  viaBridge: boolean
}

export type BridgeState =
  | { status: 'connected'; latencyMs?: number; bridgeName: string }
  | { status: 'reconnecting'; attempt: number; max: number }
  | { status: 'unavailable'; reason: string }
  | { status: 'relaying'; targets: string[] }

export interface RelayResult {
  sent: string[]
  failed: { to: string; error: string }[]
  latencyMs: number
}

export interface Bookmark {
  sessionId: string
  eventId: string
  ts: number
  preview: string
}

export interface Prefs {
  pinned: string[]
  bookmarks: Bookmark[]
  promptHistory: string[]
  window?: { x: number; y: number; width: number; height: number }
  selectedSessionId?: string
}

export interface SearchHit {
  sessionId: string
  sessionName: string
  eventId: string
  ts: number
  snippet: string
}

export interface Stats {
  working: number
  waiting: number
  idle: number
  ended: number
  refreshedAt: number
}

export const IPC = {
  sessionsList: 'sessions:list',
  transcriptLoad: 'transcript:load',
  transcriptExport: 'transcript:export',
  relaySend: 'relay:send',
  bridgeRetry: 'bridge:retry',
  bridgeState: 'bridge:state',
  feedList: 'feed:list',
  searchQuery: 'search:query',
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  appOpenLogs: 'app:openLogs',
  appReload: 'app:reload',
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
} as const

export const PUSH = {
  sessionUpsert: 'session:upsert',
  sessionRemove: 'session:remove',
  transcriptReset: 'transcript:reset',
  transcriptAppend: 'transcript:append',
  feedUpdate: 'feed:update',
  bridgeState: 'bridge:state',
  statsUpdate: 'stats:update',
} as const

export interface TranscriptResetPayload {
  sessionId: string
  events: TranscriptEvent[]
  meta: TranscriptMeta
}

export interface TranscriptAppendPayload {
  sessionId: string
  events: TranscriptEvent[]
  updates: EventUpdate[]
  meta: TranscriptMeta
}

export interface CsmApi {
  platform: NodeJS.Platform
  listSessions(): Promise<Session[]>
  loadTranscript(sessionId: string): Promise<TranscriptResetPayload | null>
  exportTranscript(sessionId: string): Promise<{ saved: boolean; path?: string }>
  relay(targets: string[], text: string): Promise<RelayResult>
  bridgeRetry(): Promise<void>
  bridgeState(): Promise<BridgeState>
  listFeed(): Promise<FeedItem[]>
  search(q: string): Promise<SearchHit[]>
  getPrefs(): Promise<Prefs>
  setPrefs(patch: Partial<Prefs>): Promise<Prefs>
  openLogs(): Promise<void>
  reload(): Promise<void>
  windowControl(action: 'minimize' | 'maximize' | 'close'): void
  on<T>(channel: (typeof PUSH)[keyof typeof PUSH], cb: (payload: T) => void): () => void
}

declare global {
  interface Window {
    csm: CsmApi
  }
}
