import { useEffect, useState } from 'react'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { SearchHit } from '@shared/types'
import { hhmm } from '../lib/format'
import { useStore } from '../store'

export function SearchOverlay() {
  const open = useStore((state) => state.searchOpen)
  const setOpen = useStore((state) => state.setSearchOpen)
  const jump = useStore((state) => state.jump)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])

  useEffect(() => {
    if (open) {
      setQuery('')
      setHits([])
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      if (query.trim()) void window.csm.search(query.trim()).then(setHits)
      else setHits([])
    }, 120)
    return () => clearTimeout(timer)
  }, [query, open])

  if (!open) return null
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[640px]" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Search all sessions</DialogTitle>
          <DialogDescription>Search every transcript</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search all sessions..." />
          <CommandList className="max-h-[50vh]">
            {query.trim() !== '' && hits.length === 0 && <CommandEmpty>No matches</CommandEmpty>}
            {hits.map((hit) => (
              <CommandItem key={`${hit.sessionId}-${hit.eventId}`} value={`${hit.sessionId}-${hit.eventId}`} onSelect={() => jump({ sessionId: hit.sessionId, eventId: hit.eventId, ts: hit.ts })} className="flex-col items-start gap-0">
                <div className="font-mono text-[9.5px] text-faint">{hit.sessionName} - {hhmm(hit.ts)}</div>
                <div className="w-full truncate text-[12px] text-body">{hit.snippet}</div>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
