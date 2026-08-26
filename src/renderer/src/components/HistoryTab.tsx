import { hhmm } from '../lib/format'
import { useStore } from '../store'

export function HistoryTab() {
  const bookmarks = useStore((state) => state.prefs.bookmarks)
  const history = useStore((state) => state.prefs.promptHistory)
  const sessions = useStore((state) => state.sessions)
  const jump = useStore((state) => state.jump)
  const setDraft = useStore((state) => state.setDraft)
  const setView = useStore((state) => state.setView)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[50px] shrink-0 items-center border-b border-border px-[18px]"><span className="text-[14px] font-semibold text-foreground">History</span></div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-6 overflow-y-auto px-[18px] py-3">
        <div className="flex flex-col gap-2">
          <div className="font-mono text-[9.5px] font-semibold tracking-[.1em] text-faint">BOOKMARKS</div>
          {bookmarks.length === 0 && <div className="text-[11px] text-faint">Right-click any message and bookmark it</div>}
          {bookmarks.map((bookmark) => (
            <button key={`${bookmark.sessionId}-${bookmark.eventId}`} onClick={() => jump({ sessionId: bookmark.sessionId, eventId: bookmark.eventId, ts: bookmark.ts })} className="rounded-lg border border-border bg-card/60 p-2 text-left hover:border-input">
              <div className="font-mono text-[9.5px] text-faint">{sessions[bookmark.sessionId]?.name ?? bookmark.sessionId.slice(0, 8)} - {hhmm(bookmark.ts)}</div>
              <div className="mt-[2px] truncate text-[11.5px] text-body">{bookmark.preview}</div>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <div className="font-mono text-[9.5px] font-semibold tracking-[.1em] text-faint">PROMPTS SENT</div>
          {history.length === 0 && <div className="text-[11px] text-faint">Prompts you relay appear here</div>}
          {history.map((entry, index) => <button key={index} onClick={() => { setDraft(entry); setView('sessions') }} className="truncate rounded-lg border border-border bg-card/60 p-2 text-left text-[11.5px] text-body hover:border-input">{entry}</button>)}
        </div>
      </div>
    </div>
  )
}
