import { cn, cwdTail, hhmm, STATE_COLOR } from '../lib/format'
import { useSelected, useStore } from '../store'
import { StatusDot } from './StatusDot'

export function SessionHeader() {
  const session = useSelected()
  const togglePin = useStore((state) => state.togglePin)
  if (!session) return <div className="h-[50px] border-b border-border" />
  const color = STATE_COLOR[session.state]
  return (
    <div className="flex h-[50px] shrink-0 items-center gap-3 border-b border-border px-[18px]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-foreground">{session.name}</span>
          <span className="inline-flex items-center gap-[5px] rounded-full border px-[7px] py-[1px] font-mono text-[10px] font-medium" style={{ color, background: `${color}1a`, borderColor: `${color}40` }}>
            <StatusDot state={session.state} size={5} />
            {session.state.toUpperCase()}
          </span>
        </div>
        <div className="mt-[1px] truncate font-mono text-[10.5px] text-faint">{cwdTail(session.cwd)} - {session.model ?? 'unknown model'} - started {hhmm(session.startedAt)}{session.aiTitle ? ` - ${session.aiTitle}` : ''}</div>
      </div>
      <div className="ml-auto flex gap-[6px]">
        <button aria-label="export markdown" onClick={() => void window.csm.exportTranscript(session.sessionId)} className="h-6 rounded-md border border-border px-[9px] text-[11px] font-medium text-muted-foreground hover:text-foreground">Export .md</button>
        <button aria-label={session.pinned ? 'unpin session' : 'pin session'} onClick={() => void togglePin(session.sessionId)} className={cn('h-6 rounded-md border border-border px-[9px] text-[11px] font-medium', session.pinned ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {session.pinned ? 'Pinned' : 'Pin'}
        </button>
      </div>
    </div>
  )
}
