import { firstLine, hhmm } from '../lib/format'
import { useStore } from '../store'

export function FeedMini() {
  const feed = useStore((state) => state.feed)
  const setView = useStore((state) => state.setView)
  const jump = useStore((state) => state.jump)
  const top = [...feed].sort((a, b) => b.ts - a.ts).slice(0, 3)
  return (
    <div className="flex h-full min-h-0 flex-col gap-[7px] px-3 py-[10px]">
      <div className="flex items-baseline gap-2">
        <span className="text-[11.5px] font-semibold text-foreground">Cross-session feed</span>
        <button className="ml-auto text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setView('feed')}>Open tab</button>
      </div>
      <div className="flex flex-col gap-[5px] overflow-y-auto">
        {top.length === 0 && <div className="text-[10.5px] text-faint">No cross-session messages yet</div>}
        {top.map((item) => (
          <button key={item.id} onClick={() => { const target = item.receiverSessionIds[0] ?? item.senderSessionId; if (target) jump({ sessionId: target, ts: item.ts }) }} className="rounded-[7px] border border-border/80 bg-background px-[9px] py-[7px] text-left hover:border-input">
            <div className="flex gap-[6px] font-mono text-[9.5px] text-cross"><span className="truncate">{item.from} -&gt; {item.to.join(', ')}</span><span className="ml-auto text-faint">{hhmm(item.ts)}</span></div>
            <div className="mt-[2px] truncate text-[11px] text-muted-foreground">{firstLine(item.text, 60)}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
