import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useStore, useTargets } from '../store'

export function TargetPicker() {
  const sessions = useStore((state) => state.sessions)
  const multiIds = useStore((state) => state.multiIds)
  const targets = useTargets()
  const live = Object.values(sessions).filter((session) => session.state !== 'ended')
  const name = (id: string) => sessions[id]?.name ?? id
  const setMulti = (ids: string[]) => useStore.setState({ multiIds: ids, selectedId: ids[ids.length - 1] ?? useStore.getState().selectedId })

  if (multiIds.length > 1) {
    return (
      <div className="rounded-md border border-input bg-background px-[9px] py-[6px]">
        <div className="mb-1 text-[10.5px] text-muted-foreground">Send to - multiple</div>
        <div className="flex flex-wrap gap-1">
          {multiIds.map((id) => (
            <Badge key={id} variant="secondary" className="gap-1 text-[10.5px] font-normal">
              {name(id)}
              <button aria-label={`remove ${name(id)}`} className="text-muted-foreground hover:text-foreground" onClick={() => setMulti(multiIds.filter((candidate) => candidate !== id))}>x</button>
            </Badge>
          ))}
          <AddMenu exclude={multiIds} onPick={(id) => setMulti([...multiIds, id])} options={live} />
        </div>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-7 w-full items-center gap-2 rounded-md border border-input bg-background px-[9px] text-left">
        <span className="text-[10.5px] text-muted-foreground">Send to</span>
        <span className="truncate text-[11.5px] font-medium text-foreground">{targets[0] ? name(targets[0]) : 'none'}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">v</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[260px] text-[11.5px]">
        {live.map((session) => <DropdownMenuItem key={session.sessionId} onSelect={() => useStore.getState().select(session.sessionId)}>{session.name}</DropdownMenuItem>)}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-muted-foreground" onSelect={() => setMulti(live.map((session) => session.sessionId))}>All sessions</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AddMenu({ exclude, onPick, options }: { exclude: string[]; onPick: (id: string) => void; options: { sessionId: string; name: string }[] }) {
  const rest = options.filter((option) => !exclude.includes(option.sessionId))
  if (!rest.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full border border-border px-2 py-[1px] text-[10.5px] text-muted-foreground hover:text-foreground">+ add</DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-[200px] text-[11.5px]">
        {rest.map((option) => <DropdownMenuItem key={option.sessionId} onSelect={() => onPick(option.sessionId)}>{option.name}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
