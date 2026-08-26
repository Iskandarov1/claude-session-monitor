import { useState } from 'react'
import { cn } from '../../lib/format'

export function toolDisplay(name: string, input: unknown): string {
  const data = (input ?? {}) as Record<string, unknown>
  const arg = data.command ?? data.file_path ?? data.pattern ?? data.query ?? data.to ?? data.url ?? ''
  return arg ? `${name}: ${String(arg)}` : name
}

export function MessageTool({ name, input, resultText, isError }: { name: string; input: unknown; resultText?: string; isError?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="max-w-[82%]">
      <button onClick={() => setOpen((value) => !value)} className={cn('flex items-center gap-2 font-mono text-[10.5px] text-faint hover:text-muted-foreground', isError && 'text-error')}>
        <span>{open ? 'v' : '>'}</span>
        <span className="truncate">{toolDisplay(name, input)}</span>
        <span className="text-faint">{resultText === undefined ? '- running' : isError ? '- error' : '- done'}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-2 rounded-lg border border-border bg-surface p-2 font-mono text-[10.5px] text-muted-foreground">
          <pre className="m-0 whitespace-pre-wrap break-all">{JSON.stringify(input, null, 2)}</pre>
          {resultText !== undefined && <pre className="m-0 whitespace-pre-wrap break-all border-t border-border pt-2 text-body">{resultText.length > 4000 ? `${resultText.slice(0, 4000)}...` : resultText}</pre>}
        </div>
      )}
    </div>
  )
}
