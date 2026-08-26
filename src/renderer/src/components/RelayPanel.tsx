import { useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import type { RelayResult } from '@shared/types'
import { cn, modKey } from '../lib/format'
import { useStore, useTargets } from '../store'
import { BridgeStatusChip } from './BridgeStatusChip'
import { FeedMini } from './FeedMini'
import { TargetPicker } from './TargetPicker'

export const QUICK_PROMPTS = [
  { label: 'Ask status', text: 'What are you working on right now, and what is blocking you?' },
  { label: 'List sessions', text: 'Call ListAgents and tell me which other sessions you can see.' },
  { label: 'Pause work', text: 'Pause after the current step and wait for further instructions.' },
]

export const needsApproval = (mode?: string) => !(mode === 'bypassPermissions' || mode === 'acceptEdits')

export function RelayPanel() {
  const sessions = useStore((state) => state.sessions)
  const bridge = useStore((state) => state.bridge)
  const draft = useStore((state) => state.draft)
  const setDraft = useStore((state) => state.setDraft)
  const history = useStore((state) => state.prefs.promptHistory)
  const targets = useTargets()
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null)

  const names = targets.map((id) => sessions[id]?.name ?? id).filter(Boolean)
  const offline = bridge.status === 'unavailable'
  const canSend = !offline && !busy && bridge.status !== 'reconnecting' && draft.trim().length > 0 && names.length > 0
  const warn = targets.some((id) => needsApproval(sessions[id]?.permissionMode))

  const send = async () => {
    if (!canSend) return
    setBusy(true)
    setLast(null)
    try {
      const result: RelayResult = await window.csm.relay(names, draft.trim())
      const ok = result.failed.length === 0
      setLast({ ok, text: ok ? `Sent to ${result.sent.join(', ')} - ${result.latencyMs} ms` : `Failed: ${result.failed.map((failure) => `${failure.to} (${failure.error})`).join('; ')}` })
      if (ok) setDraft('')
    } catch (err: any) {
      setLast({ ok: false, text: String(err?.message ?? err) })
    } finally {
      setBusy(false)
    }
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 px-3 pt-3">
        <div className="flex items-center gap-2"><span className="text-[11.5px] font-semibold text-foreground">Prompt relay</span><span className="ml-auto"><BridgeStatusChip state={bridge} /></span></div>
        {offline && (
          <div className="rounded-lg border border-error/40 bg-error/10 p-[10px] text-[11px]">
            <div className="font-semibold text-error">Relay offline</div>
            <div className="mt-[2px] text-muted-foreground">The headless bridge session is not reachable. Prompts are disabled until it reconnects.{'reason' in bridge && bridge.reason ? ` (${bridge.reason})` : ''}</div>
            <Button variant="outline" size="sm" className="mt-2 h-6" onClick={() => void window.csm.bridgeRetry()}>Retry connection</Button>
          </div>
        )}
        <TargetPicker />
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKey}
          disabled={offline}
          placeholder={offline ? 'Prompt input disabled...' : names.length > 1 ? `Message ${names.length} sessions...` : `Message ${names[0] ?? 'session'}...`}
          className="max-h-[220px] min-h-[64px] resize-y bg-background text-[12px] leading-[1.5]"
        />
        <div className="flex flex-wrap gap-[5px]">
          {QUICK_PROMPTS.map((prompt) => <button key={prompt.label} disabled={offline} onClick={() => setDraft(prompt.text)} className="rounded-full border border-border px-[9px] py-[2px] text-[10.5px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50">{prompt.label}</button>)}
        </div>
        {warn && !offline && <div className="text-[10px] text-waiting">Needs approval in target session</div>}
        <div className="flex items-center gap-[7px]">
          <Button aria-label={names.length > 1 ? `Broadcast to ${names.length} sessions` : 'Send prompt'} onClick={() => void send()} disabled={!canSend} className="h-[30px] flex-1 gap-2 text-[11.5px] font-semibold">
            {names.length > 1 ? `Broadcast to ${names.length} sessions` : 'Send'}<Kbd className="bg-black/10 text-primary-foreground/70">{modKey()}+Enter</Kbd>
          </Button>
          <Popover>
            <PopoverTrigger aria-label="prompt history" className="h-[30px] w-[30px] rounded-[7px] border border-border font-mono text-[11px] text-muted-foreground hover:text-foreground">H</PopoverTrigger>
            <PopoverContent align="end" className="max-h-64 w-72 overflow-y-auto p-1 text-[11.5px]">
              {history.length === 0 && <div className="px-2 py-1 text-faint">No prompts sent yet</div>}
              {history.map((entry, index) => <button key={index} className="block w-full truncate rounded px-2 py-1 text-left hover:bg-secondary" onClick={() => setDraft(entry)}>{entry}</button>)}
            </PopoverContent>
          </Popover>
        </div>
        {last && <div className={cn('font-mono text-[10.5px]', last.ok ? 'text-working' : 'text-error')}>{last.text}</div>}
      </div>
      <div className="mt-3 min-h-0 flex-1 border-t border-border"><FeedMini /></div>
    </div>
  )
}
