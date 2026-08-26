import { hhmm } from '../../lib/format'

export function MessageCross({ fromName, text, ts, onReply, onJump }: { fromName: string; text: string; ts: number; onReply: () => void; onJump?: () => void }) {
  return (
    <div className="max-w-[82%]">
      <div className="mb-[3px] flex items-center gap-2 font-mono text-[10px]">
        <span className="inline-flex items-center gap-1 rounded-full border border-cross/30 bg-cross/10 px-[7px] py-[1px] font-semibold text-cross">⇄ from {fromName}</span>
        <span className="text-faint">{hhmm(ts)}</span>
      </div>
      <div className="whitespace-pre-wrap rounded-r-lg border-l-[3px] border-cross bg-cross/[.06] px-3 py-2 text-[12.5px] leading-[1.5] text-cross-fg">{text}</div>
      <div className="mt-[2px] flex gap-2 text-[10px] text-faint">
        <button className="hover:text-foreground" onClick={onReply}>Reply</button>
        {onJump && <button className="hover:text-foreground" onClick={onJump}>Jump to sender</button>}
      </div>
    </div>
  )
}
