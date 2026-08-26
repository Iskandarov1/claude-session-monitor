import { hhmm } from '../../lib/format'

export function MessageUser({ text, ts }: { text: string; ts: number }) {
  return (
    <div className="self-end max-w-[68%]">
      <div className="mb-[3px] flex justify-end gap-2 font-mono text-[10px] text-faint"><span>You</span><span>{hhmm(ts)}</span></div>
      <div className="rounded-[10px_10px_3px_10px] bg-secondary px-3 py-2 text-[12.5px] leading-[1.5] text-foreground whitespace-pre-wrap">{text}</div>
    </div>
  )
}
