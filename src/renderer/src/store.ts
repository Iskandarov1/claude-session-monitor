import { useMemo } from 'react'
import { create } from 'zustand'
import {
  PUSH,
  type Bookmark,
  type BridgeState,
  type FeedItem,
  type Prefs,
  type Session,
  type Stats,
  type TranscriptAppendPayload,
  type TranscriptEvent,
  type TranscriptMeta,
  type TranscriptResetPayload,
} from '@shared/types'
import { applyUpdates } from './lib/events'

export type View = 'sessions' | 'feed' | 'history'
export interface JumpTarget {
  sessionId: string
  eventId?: string
  ts?: number
}

export interface AppState {
  sessions: Record<string, Session>
  transcripts: Record<string, { events: TranscriptEvent[]; meta: TranscriptMeta }>
  feed: FeedItem[]
  bridge: BridgeState
  stats: Stats
  prefs: Prefs
  selectedId?: string
  multiIds: string[]
  view: View
  searchOpen: boolean
  draft: string
  jumpTarget?: JumpTarget
  ready: boolean
  init(): Promise<void>
  reset(): void
  select(id: string, additive?: boolean): void
  setView(view: View): void
  setSearchOpen(open: boolean): void
  setDraft(text: string): void
  jump(target: JumpTarget): void
  consumeJump(): void
  togglePin(id: string): Promise<void>
  addBookmark(bookmark: Bookmark): Promise<void>
  setPrefs(patch: Partial<Prefs>): Promise<void>
}

const EMPTY_STATS: Stats = { working: 0, waiting: 0, idle: 0, ended: 0, refreshedAt: 0 }
const EMPTY_PREFS: Prefs = { pinned: [], bookmarks: [], promptHistory: [] }
const EMPTY_TARGETS: string[] = []
let unsubscribe: (() => void)[] = []
let initPromise: Promise<void> | undefined

export const useStore = create<AppState>((set, get) => ({
  sessions: {},
  transcripts: {},
  feed: [],
  bridge: { status: 'reconnecting', attempt: 0, max: 5 },
  stats: EMPTY_STATS,
  prefs: EMPTY_PREFS,
  multiIds: [],
  view: 'sessions',
  searchOpen: false,
  draft: '',
  ready: false,

  reset() {
    for (const unsub of unsubscribe) unsub()
    unsubscribe = []
    initPromise = undefined
    set({
      sessions: {},
      transcripts: {},
      feed: [],
      bridge: { status: 'reconnecting', attempt: 0, max: 5 },
      stats: EMPTY_STATS,
      prefs: EMPTY_PREFS,
      selectedId: undefined,
      multiIds: [],
      view: 'sessions',
      searchOpen: false,
      draft: '',
      jumpTarget: undefined,
      ready: false,
    })
  },

  async init() {
    if (initPromise) return initPromise
    initPromise = (async () => {
      const csm = window.csm
      const [list, prefs, feed, bridge] = await Promise.all([csm.listSessions(), csm.getPrefs(), csm.listFeed(), csm.bridgeState()])
      const sessions: Record<string, Session> = {}
      for (const session of list) sessions[session.sessionId] = { ...session, pinned: prefs.pinned.includes(session.sessionId) }
      set({ sessions, prefs, feed, bridge, ready: true })
      unsubscribe.push(
        csm.on<Session>(PUSH.sessionUpsert, (session) => set((state) => ({ sessions: { ...state.sessions, [session.sessionId]: { ...session, pinned: state.prefs.pinned.includes(session.sessionId) } } }))),
        csm.on<string>(PUSH.sessionRemove, (id) => set((state) => {
          const { [id]: _removed, ...rest } = state.sessions
          return { sessions: rest }
        })),
        csm.on<TranscriptResetPayload>(PUSH.transcriptReset, (payload) => set((state) => ({ transcripts: { ...state.transcripts, [payload.sessionId]: { events: [...payload.events], meta: payload.meta } } }))),
        csm.on<TranscriptAppendPayload>(PUSH.transcriptAppend, (payload) => set((state) => {
          const current = state.transcripts[payload.sessionId]
          if (!current) return {}
          const events = [...current.events, ...payload.events]
          applyUpdates(events, payload.updates)
          return { transcripts: { ...state.transcripts, [payload.sessionId]: { events, meta: { ...current.meta, ...payload.meta } } } }
        })),
        csm.on<FeedItem[]>(PUSH.feedUpdate, (feedItems) => set({ feed: feedItems })),
        csm.on<BridgeState>(PUSH.bridgeState, (bridgeState) => set({ bridge: bridgeState })),
        csm.on<Stats>(PUSH.statsUpdate, (stats) => set({ stats })),
      )
      const remembered = prefs.selectedSessionId && sessions[prefs.selectedSessionId] ? prefs.selectedSessionId : undefined
      const mostRecent = list.slice().sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0]?.sessionId
      const first = remembered ?? mostRecent
      if (first) get().select(first)
    })()
    return initPromise
  },

  select(id, additive = false) {
    const state = get()
    if (additive) {
      const base = state.multiIds.length ? state.multiIds : state.selectedId ? [state.selectedId] : []
      const multiIds = base.includes(id) ? base.filter((candidate) => candidate !== id) : [...base, id]
      set({ multiIds, selectedId: multiIds[multiIds.length - 1] ?? state.selectedId })
    } else {
      set({ selectedId: id, multiIds: [] })
      void window.csm.setPrefs({ selectedSessionId: id })
    }
    if (!state.transcripts[id]) {
      set((current) => ({ transcripts: { ...current.transcripts, [id]: { events: [], meta: {} } } }))
      void window.csm.loadTranscript(id).then((transcript) => {
        if (transcript) set((current) => ({ transcripts: { ...current.transcripts, [id]: { events: [...transcript.events], meta: transcript.meta } } }))
      })
    }
  },

  setView: (view) => set({ view }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setDraft: (draft) => set({ draft }),
  jump(target) {
    get().select(target.sessionId)
    set({ jumpTarget: target, view: 'sessions', searchOpen: false })
  },
  consumeJump: () => set({ jumpTarget: undefined }),

  async togglePin(id) {
    const current = get().prefs.pinned
    const pinned = current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]
    await get().setPrefs({ pinned })
  },

  async addBookmark(bookmark) {
    const bookmarks = [bookmark, ...get().prefs.bookmarks.filter((candidate) => !(candidate.sessionId === bookmark.sessionId && candidate.eventId === bookmark.eventId))]
    await get().setPrefs({ bookmarks })
  },

  async setPrefs(patch) {
    const prefs = await window.csm.setPrefs(patch)
    set((state) => {
      const sessions = { ...state.sessions }
      for (const session of Object.values(sessions)) sessions[session.sessionId] = { ...session, pinned: prefs.pinned.includes(session.sessionId) }
      return { prefs, sessions }
    })
  },
}))

export const useSelected = () => useStore((state) => (state.selectedId ? state.sessions[state.selectedId] : undefined))
export const useTargets = () => {
  const multiIds = useStore((state) => state.multiIds)
  const selectedId = useStore((state) => state.selectedId)
  return useMemo(() => (multiIds.length ? multiIds : selectedId ? [selectedId] : EMPTY_TARGETS), [multiIds, selectedId])
}
