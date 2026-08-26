import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function NewSessionPopover() {
  const [name, setName] = useState('')
  const command = `claude -n ${name.trim() || '<name>'}`
  return (
    <Popover>
      <PopoverTrigger className="text-[10.5px] text-muted-foreground hover:text-foreground">+ New</PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-64 space-y-2 text-[11.5px]">
        <div className="font-medium text-foreground">Start a named session</div>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="session name" className="h-7" />
        <code className="block truncate rounded bg-background px-2 py-1 font-mono text-[10.5px] text-muted-foreground">{command}</code>
        <Button size="sm" className="w-full" onClick={() => void navigator.clipboard?.writeText(command)}>Copy command</Button>
        <div className="text-[10px] text-faint">Run it in a terminal; the session appears here automatically.</div>
      </PopoverContent>
    </Popover>
  )
}
