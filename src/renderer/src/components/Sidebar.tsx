import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { NewSessionPopover } from './NewSessionPopover'
import { SessionRow } from './SessionRow'

export function Sidebar() {
  const sessions = useStore((state) => state.sessions)
  const selectedId = useStore((state) => state.selectedId)
  const multiIds = useStore((state) => state.multiIds)
  const select = useStore((state) => state.select)
  const togglePin = useStore((state) => state.togglePin)
  const [filter, setFilter] = useState('')

  const { pinned, all, total } = useMemo(() => {
    const term = filter.trim().toLowerCase()
    const list = Object.values(sessions).filter((session) => !term || session.name.toLowerCase().includes(term) || session.cwd.toLowerCase().includes(term))
    const sorted = list.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    return { pinned: sorted.filter((session) => session.pinned), all: sorted.filter((session) => !session.pinned), total: Object.keys(sessions).length }
  }, [sessions, filter])

  const row = (session: (typeof all)[number]) => (
    <SessionRow
      key={session.sessionId}
      session={session}
      selected={session.sessionId === selectedId && multiIds.length === 0}
      multi={multiIds.includes(session.sessionId)}
      onSelect={(event) => select(session.sessionId, event.metaKey || event.ctrlKey)}
      onPin={() => void togglePin(session.sessionId)}
    />
  )

  return (
    <>
      <div className="p-[10px] pb-[6px]">
        <div className="flex h-[26px] items-center gap-2 rounded-md border border-input bg-background px-2">
          <span className="text-[11px] text-muted-foreground">Search</span>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter sessions" className="min-w-0 flex-1 bg-transparent text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-[1px] overflow-y-auto px-[6px]">
        {pinned.length > 0 && (
          <div data-testid="group-pinned">
            <div className="px-2 pb-[3px] pt-[5px] font-mono text-[9.5px] font-semibold tracking-[.1em] text-faint">PINNED</div>
            {pinned.map(row)}
          </div>
        )}
        <div data-testid="group-all">
          <div className="px-2 pb-[3px] pt-2 font-mono text-[9.5px] font-semibold tracking-[.1em] text-faint">ALL SESSIONS</div>
          {all.map(row)}
          {all.length === 0 && pinned.length === 0 && <div className="px-2 py-4 text-[11px] text-faint">No sessions{filter ? ' match' : ' yet - start one with claude'}</div>}
        </div>
      </div>
      <div className="mt-auto flex items-center border-t border-border px-3 py-2 text-[10.5px] text-muted-foreground">
        <span>{total} session{total === 1 ? '' : 's'}</span>
        <span className="ml-auto"><NewSessionPopover /></span>
      </div>
    </>
  )
}
