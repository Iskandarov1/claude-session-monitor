import type { MouseEvent } from 'react'
import type { Session } from '@shared/types'
import { cn, cwdTail, stateLabel } from '../lib/format'
import { StatusDot } from './StatusDot'

export function SessionRow({ session, selected, multi, onSelect, onPin }: { session: Session; selected: boolean; multi: boolean; onSelect: (event: MouseEvent) => void; onPin: () => void }) {
  const labelColor = session.state === 'waiting' ? 'text-waiting' : session.state === 'ended' ? 'text-faint' : 'text-muted-foreground'
  return (
    <div className={cn('group relative flex items-center gap-2 rounded-md px-2 py-[5px]', (selected || multi) && 'bg-secondary', multi && 'ring-1 ring-cross/50')}>
      <button aria-label={`select ${session.name}`} onClick={onSelect} className="absolute inset-0 rounded-md" />
      <StatusDot state={session.state} />
      <div className="pointer-events-none min-w-0 flex-1">
        <div className={cn('truncate text-[12px] font-medium', selected ? 'text-foreground' : session.state === 'idle' || session.state === 'ended' ? 'text-muted-foreground' : 'text-body')}>{session.name}</div>
        <div className={cn('truncate font-mono text-[10px] group-hover:hidden', labelColor)}>{stateLabel(session)}</div>
        <div className="hidden truncate font-mono text-[10px] text-muted-foreground group-hover:block">{cwdTail(session.cwd)}</div>
      </div>
      <span className="relative rounded border border-border px-1 font-mono text-[8.5px] font-semibold text-muted-foreground group-hover:hidden">{session.origin.toUpperCase()}</span>
      <button
        aria-label={session.pinned ? 'unpin' : 'pin'}
        onClick={(event) => {
          event.stopPropagation()
          onPin()
        }}
        className={cn('relative hidden px-1 text-[11px] leading-none group-hover:block', session.pinned ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
      >
        *
      </button>
    </div>
  )
}
