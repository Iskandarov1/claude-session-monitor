import { hhmm } from '../../lib/format'

export function MessageSent({ to, text, ts }: { to: string[]; text: string; ts: number }) {
  return (
    <div className="self-end max-w-[68%]">
      <div className="mb-[3px] flex justify-end gap-2 font-mono text-[10px]"><span className="text-cross">→ {to.join(', ')}</span><span className="text-faint">{hhmm(ts)}</span></div>
      <div className="whitespace-pre-wrap rounded-l-lg border-r-[3px] border-cross bg-cross/[.06] px-3 py-2 text-[12.5px] leading-[1.5] text-cross-fg">{text}</div>
    </div>
  )
}
