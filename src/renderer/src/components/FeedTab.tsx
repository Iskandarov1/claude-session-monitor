import { useMemo, useState } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty'
import type { FeedItem } from '@shared/types'
import { cn, firstLine } from '../lib/format'
import { useStore } from '../store'
import { FeedItemRow } from './FeedItemRow'

export function groupByDay(items: FeedItem[], now = Date.now()): { day: string; items: FeedItem[] }[] {
  const key = (ts: number) => new Date(ts).toDateString()
  const today = key(now)
  const yesterday = key(now - 86_400_000)
  const map = new Map<string, FeedItem[]>()
  for (const item of [...items].sort((a, b) => b.ts - a.ts)) {
    const day = key(item.ts)
    map.set(day, [...(map.get(day) ?? []), item])
  }
  return [...map.entries()].map(([day, list]) => ({ day: day === today ? 'TODAY' : day === yesterday ? 'YESTERDAY' : day.toUpperCase(), items: list }))
}

export function FeedTab() {
  const feed = useStore((state) => state.feed)
  const sessions = useStore((state) => state.sessions)
  const jump = useStore((state) => state.jump)
  const addBookmark = useStore((state) => state.addBookmark)
  const [mode, setMode] = useState<'cross' | 'all'>('all')
  const [session, setSession] = useState<string | undefined>()

  const filtered = useMemo(() => feed.filter((item) => {
    if (mode === 'cross' && item.viaBridge) return false
    if (!session) return true
    const name = sessions[session]?.name
    return item.senderSessionId === session || item.receiverSessionIds.includes(session) || (name !== undefined && (item.from === name || item.to.includes(name)))
  }), [feed, mode, session, sessions])
  const groups = groupByDay(filtered)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[50px] shrink-0 items-center gap-3 border-b border-border px-[18px]">
        <span className="text-[14px] font-semibold text-foreground">Inter-session feed</span>
        <div className="ml-auto flex gap-[6px] text-[11px]">
          <button onClick={() => setMode('cross')} className={cn('h-6 rounded-md border px-[9px]', mode === 'cross' ? 'border-transparent bg-secondary text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>Cross-session only</button>
          <button onClick={() => setMode('all')} className={cn('h-6 rounded-md border px-[9px]', mode === 'all' ? 'border-transparent bg-secondary text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}>All activity</button>
          <DropdownMenu>
            <DropdownMenuTrigger className="h-6 rounded-md border border-border px-[9px] text-muted-foreground hover:text-foreground">{session ? sessions[session]?.name : 'Session'} v</DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[200px] text-[11.5px]">
              <DropdownMenuItem onSelect={() => setSession(undefined)}>All sessions</DropdownMenuItem>
              {Object.values(sessions).map((candidate) => <DropdownMenuItem key={candidate.sessionId} onSelect={() => setSession(candidate.sessionId)}>{candidate.name}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[18px] py-3">
        {groups.length === 0 && (
          <Empty className="mt-8">
            <EmptyTitle>No messages between sessions yet</EmptyTitle>
            <EmptyDescription>When one session messages another or you relay a prompt, it appears here.</EmptyDescription>
          </Empty>
        )}
        {groups.map((group) => (
          <div key={group.day} className="flex flex-col gap-2">
            <div className="font-mono text-[9.5px] font-semibold tracking-[.1em] text-faint">{group.day}</div>
            {group.items.map((item) => (
              <FeedItemRow
                key={item.id}
                item={item}
                onJumpSender={item.senderSessionId ? () => jump({ sessionId: item.senderSessionId!, ts: item.ts }) : undefined}
                onJumpReceiver={item.receiverSessionIds[0] ? () => jump({ sessionId: item.receiverSessionIds[0]!, ts: item.ts }) : undefined}
                onBookmark={() => void addBookmark({ sessionId: item.receiverSessionIds[0] ?? item.senderSessionId ?? '', eventId: item.id, ts: item.ts, preview: firstLine(item.text, 80) })}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
