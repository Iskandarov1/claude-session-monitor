import { useEffect, useState } from 'react'
import { cn, isMac, relTime, STATE_COLOR } from '../lib/format'
import { useStore } from '../store'

const BRIDGE_COLOR = { connected: 'text-working', reconnecting: 'text-waiting', unavailable: 'text-error', relaying: 'text-cross' } as const

export function StatusBar() {
  const stats = useStore((state) => state.stats)
  const bridge = useStore((state) => state.bridge)
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 5000)
    return () => clearInterval(timer)
  }, [])
  const item = (n: number, label: string, color: string) => (
    <span className="inline-flex items-center gap-[5px]"><span className="h-[6px] w-[6px] rounded-full" style={{ background: color }} />{n} {label}</span>
  )
  return (
    <div className="flex h-7 shrink-0 items-center gap-[14px] border-t border-border bg-card px-[14px] font-mono text-[10.5px] text-muted-foreground">
      {item(stats.working, 'working', STATE_COLOR.working)}
      {item(stats.waiting, 'waiting', STATE_COLOR.waiting)}
      {item(stats.idle, 'idle', STATE_COLOR.idle)}
      {item(stats.ended, 'ended', STATE_COLOR.ended)}
      <span className="ml-auto">refreshed {relTime(stats.refreshedAt)}</span>
      <span className={cn(BRIDGE_COLOR[bridge.status])}>bridge ●</span>
      {!isMac() && <span className="text-faint">Ctrl+Enter to send</span>}
      <button aria-label="logs" className="hover:text-foreground" onClick={() => void window.csm.openLogs()}>logs</button>
      <button aria-label="reload" className="hover:text-foreground" onClick={() => void window.csm.reload()}>reload</button>
    </div>
  )
}
