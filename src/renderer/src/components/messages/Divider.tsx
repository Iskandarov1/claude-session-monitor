import { hhmm } from '../../lib/format'

export function Divider({ text, ts }: { text: string; ts: number }) {
  const label = text.replace(/\d\d:\d\d$/, hhmm(ts))
  return (
    <div className="self-center flex items-center gap-2 font-mono text-[10.5px] text-faint">
      <span className="h-px w-[60px] bg-border" />
      {label}
      <span className="h-px w-[60px] bg-border" />
    </div>
  )
}
