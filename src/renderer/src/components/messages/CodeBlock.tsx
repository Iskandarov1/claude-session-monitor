import { useState } from 'react'

export function CodeBlock({ code, title }: { code: string; title?: string }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mt-[7px] overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center border-b border-border px-[11px] py-[5px] font-mono text-[10px] text-muted-foreground">
        <span className="truncate">{title ?? 'code'}</span>
        <span className="ml-auto flex gap-2 text-faint">
          <button className="hover:text-foreground" onClick={() => void navigator.clipboard?.writeText(code)}>Copy</button>
          <button className="hover:text-foreground" onClick={() => setOpen((value) => !value)}>{open ? 'Collapse' : 'Expand'}</button>
        </span>
      </div>
      {open && <pre className="m-0 overflow-x-auto whitespace-pre px-[13px] py-[10px] font-mono text-[11.5px] leading-[1.55] text-body">{code}</pre>}
    </div>
  )
}
