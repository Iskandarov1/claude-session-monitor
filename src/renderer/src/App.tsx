import { useEffect } from 'react'
import { cn, isMac } from './lib/format'
import { useHotkeys } from './lib/useHotkeys'
import { useStore } from './store'
import { FeedTab } from './components/FeedTab'
import { HistoryTab } from './components/HistoryTab'
import { RelayPanel } from './components/RelayPanel'
import { SearchOverlay } from './components/SearchOverlay'
import { SessionHeader } from './components/SessionHeader'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { Transcript } from './components/Transcript'

export default function App() {
  const init = useStore((state) => state.init)
  const ready = useStore((state) => state.ready)
  const view = useStore((state) => state.view)
  useHotkeys()
  useEffect(() => {
    void init()
  }, [init])

  if (!ready) return <div className="flex h-full items-center justify-center text-muted-foreground">Loading sessions...</div>

  return (
    <div className="flex h-full flex-col bg-background">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <aside className={cn('flex w-[236px] shrink-0 flex-col border-r border-border', isMac() ? 'bg-card' : 'bg-background')}><Sidebar /></aside>
        <main className="flex min-w-0 flex-1 flex-col bg-background">
          {view === 'sessions' && <><SessionHeader /><Transcript /></>}
          {view === 'feed' && <FeedTab />}
          {view === 'history' && <HistoryTab />}
        </main>
        <aside className="flex w-[292px] shrink-0 flex-col border-l border-border bg-card"><RelayPanel /></aside>
      </div>
      <StatusBar />
      <SearchOverlay />
    </div>
  )
}
