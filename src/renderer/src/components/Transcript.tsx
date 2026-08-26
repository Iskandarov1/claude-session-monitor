import { useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import type { TranscriptEvent } from '@shared/types'
import { firstLine } from '../lib/format'
import { nearestIndex } from '../lib/events'
import { useSelected, useStore } from '../store'
import { Divider } from './messages/Divider'
import { MessageClaude } from './messages/MessageClaude'
import { MessageCross } from './messages/MessageCross'
import { MessageSent } from './messages/MessageSent'
import { MessageTool } from './messages/MessageTool'
import { MessageUser } from './messages/MessageUser'
import { StreamingIndicator } from './messages/StreamingIndicator'
import { SystemRow } from './messages/SystemRow'

const textOf = (event: TranscriptEvent) => ('text' in event ? event.text : event.kind === 'tool' ? `${event.name} ${JSON.stringify(event.input)}` : '')

export function Transcript() {
  const session = useSelected()
  const transcript = useStore((state) => (state.selectedId ? state.transcripts[state.selectedId] : undefined))
  const sessions = useStore((state) => state.sessions)
  const jumpTarget = useStore((state) => state.jumpTarget)
  const consumeJump = useStore((state) => state.consumeJump)
  const setDraft = useStore((state) => state.setDraft)
  const addBookmark = useStore((state) => state.addBookmark)
  const jump = useStore((state) => state.jump)
  const ref = useRef<VirtuosoHandle>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [pending, setPending] = useState(0)

  const events = transcript?.events ?? []
  const last = events[events.length - 1]
  const streaming = session?.state === 'working' && last !== undefined && (last.kind === 'claude' || last.kind === 'tool' || last.kind === 'sent')
  const items = useMemo<(TranscriptEvent | { kind: 'streaming'; id: string; ts: number })[]>(() => (streaming ? [...events, { kind: 'streaming', id: '__streaming', ts: Date.now() }] : events), [events, streaming])
  const prevLen = useRef(items.length)

  useEffect(() => {
    if (items.length > prevLen.current) {
      if (atBottom) ref.current?.scrollToIndex({ index: items.length - 1, align: 'end' })
      else setPending((value) => value + items.length - prevLen.current)
    }
    prevLen.current = items.length
  }, [items.length, atBottom])

  useEffect(() => {
    if (atBottom) setPending(0)
  }, [atBottom])

  useEffect(() => {
    if (!jumpTarget || jumpTarget.sessionId !== session?.sessionId || events.length === 0) return
    const index = jumpTarget.eventId ? events.findIndex((event) => event.id === jumpTarget.eventId) : jumpTarget.ts !== undefined ? nearestIndex(events, jumpTarget.ts) : -1
    if (index >= 0) ref.current?.scrollToIndex({ index, align: 'center', behavior: 'smooth' })
    consumeJump()
  }, [jumpTarget, session?.sessionId, events, consumeJump])

  if (!session) return <div className="flex flex-1 items-center justify-center text-faint">Select a session</div>
  if (!session.transcriptPath && events.length === 0) return <div className="flex flex-1 items-center justify-center text-[12px] text-faint">Transcript not found for this session yet</div>

  const senderId = (name: string) => Object.values(sessions).find((candidate) => candidate.name === name)?.sessionId
  const reply = (fromName: string) => {
    const id = senderId(fromName)
    if (id) useStore.setState({ multiIds: [id], selectedId: id })
    setDraft(`@${fromName} `)
  }

  const render = (item: (typeof items)[number]) => {
    switch (item.kind) {
      case 'streaming':
        return <StreamingIndicator tokens={session.turnOutputTokens} />
      case 'divider':
        return <Divider text={item.text} ts={item.ts} />
      case 'user':
        return <MessageUser text={item.text} ts={item.ts} />
      case 'claude':
        return <MessageClaude text={item.text} ts={item.ts} />
      case 'cross': {
        const id = senderId(item.fromName)
        return <MessageCross fromName={item.fromName} text={item.text} ts={item.ts} onReply={() => reply(item.fromName)} onJump={id ? () => jump({ sessionId: id, ts: item.ts }) : undefined} />
      }
      case 'tool':
        return <MessageTool name={item.name} input={item.input} resultText={item.resultText} isError={item.isError} />
      case 'sent':
        return <MessageSent to={item.to} text={item.text} ts={item.ts} />
      case 'system':
        return <SystemRow text={item.text} />
    }
  }

  return (
    <div className="relative min-h-0 flex-1">
      <Virtuoso
        ref={ref}
        data={items}
        className="h-full"
        atBottomStateChange={setAtBottom}
        followOutput={atBottom ? 'smooth' : false}
        initialTopMostItemIndex={Math.max(0, items.length - 1)}
        computeItemKey={(_, item) => item.id}
        itemContent={(_, item) => (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="flex flex-col px-5 py-[5px]">{render(item)}</div>
            </ContextMenuTrigger>
            {item.kind !== 'streaming' && (
              <ContextMenuContent className="min-w-40 text-[11.5px]">
                <ContextMenuItem onSelect={() => void navigator.clipboard?.writeText(textOf(item))}>Copy</ContextMenuItem>
                <ContextMenuItem onSelect={() => void addBookmark({ sessionId: session.sessionId, eventId: item.id, ts: item.ts, preview: firstLine(textOf(item), 80) })}>Bookmark</ContextMenuItem>
                {item.kind === 'cross' && senderId(item.fromName) && <ContextMenuItem onSelect={() => jump({ sessionId: senderId(item.fromName)!, ts: item.ts })}>Jump to sender</ContextMenuItem>}
              </ContextMenuContent>
            )}
          </ContextMenu>
        )}
      />
      {!atBottom && pending > 0 && (
        <button onClick={() => ref.current?.scrollToIndex({ index: items.length - 1, align: 'end', behavior: 'smooth' })} className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground shadow">
          {pending} new
        </button>
      )}
    </div>
  )
}
