import type { FeedItem } from '@shared/types'
import { hhmm } from '../lib/format'

export function FeedItemRow({ item, onJumpSender, onJumpReceiver, onBookmark }: { item: FeedItem; onJumpSender?: () => void; onJumpReceiver?: () => void; onBookmark: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="flex items-baseline gap-2 font-mono text-[10px]">
        <span className="text-cross">{item.from} -&gt; {item.to.join(', ')}</span>
        <span className="ml-auto text-faint">{hhmm(item.ts)}</span>
      </div>
      <div className="mt-1 whitespace-pre-wrap text-[12px] leading-[1.5] text-body">{item.text}</div>
      <div className="mt-[6px] flex gap-3 text-[10px] text-faint">
        {onJumpSender && <button className="hover:text-foreground" onClick={onJumpSender}>Open in sender</button>}
        {onJumpReceiver && <button className="hover:text-foreground" onClick={onJumpReceiver}>Open in receiver</button>}
        <button className="hover:text-foreground" onClick={onBookmark}>Bookmark</button>
        {item.viaBridge && <span className="ml-auto text-cross/70">broadcast - relayed via bridge</span>}
      </div>
    </div>
  )
}
