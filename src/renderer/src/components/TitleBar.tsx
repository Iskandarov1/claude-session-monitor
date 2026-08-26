import { Kbd } from '@/components/ui/kbd'
import { cn, isMac } from '../lib/format'
import { useStore, type View } from '../store'

const VIEWS: { id: View; label: string }[] = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'feed', label: 'Feed' },
  { id: 'history', label: 'History' },
]

export function TitleBar() {
  const view = useStore((state) => state.view)
  const setView = useStore((state) => state.setView)
  const setSearchOpen = useStore((state) => state.setSearchOpen)
  const mac = isMac()
  return (
    <div className={cn('drag flex h-10 shrink-0 items-center gap-3 border-b border-border bg-card px-[14px]', mac && 'pl-[86px]')}>
      {!mac && <span className="no-drag text-[13px] text-claude">CSM</span>}
      <div className="text-[12.5px] font-semibold text-foreground">Claude Session Monitor</div>
      <div className="no-drag flex flex-1 justify-center">
        <button onClick={() => setSearchOpen(true)} className="flex h-[26px] w-[340px] items-center gap-2 rounded-md border border-input bg-background px-[10px] text-left">
          <span className="text-[12px] text-muted-foreground">Search all sessions...</span>
          <Kbd className="ml-auto">{mac ? 'Cmd+K' : 'Ctrl+K'}</Kbd>
        </button>
      </div>
      <div className="no-drag flex gap-[6px]">
        {VIEWS.map((item) => (
          <button key={item.id} onClick={() => setView(item.id)} className={cn('h-[26px] rounded-md px-[10px] text-[11.5px] font-medium', view === item.id ? 'bg-secondary text-foreground' : 'border border-border text-muted-foreground hover:text-foreground')}>{item.label}</button>
        ))}
      </div>
      {!mac && (
        <div className="no-drag ml-2 flex">
          <button aria-label="minimize" onClick={() => window.csm.windowControl('minimize')} className="-my-[1px] h-10 w-11 text-muted-foreground hover:bg-white/10">_</button>
          <button aria-label="maximize" onClick={() => window.csm.windowControl('maximize')} className="-my-[1px] h-10 w-11 text-muted-foreground hover:bg-white/10">□</button>
          <button aria-label="close" onClick={() => window.csm.windowControl('close')} className="-my-[1px] h-10 w-11 text-muted-foreground hover:bg-[#e81123] hover:text-white">x</button>
        </div>
      )}
    </div>
  )
}
