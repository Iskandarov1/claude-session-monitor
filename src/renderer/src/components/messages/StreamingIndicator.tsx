import { shortTokens } from '../../lib/format'

export function StreamingIndicator({ tokens }: { tokens: number }) {
  return (
    <div className="max-w-[82%]">
      <div className="mb-[3px] flex gap-2 font-mono text-[10px] text-faint"><span className="text-claude">Claude</span><span>now</span></div>
      <div className="text-[12.5px] text-body">Working<span className="ml-[3px] inline-block h-[13px] w-[7px] bg-claude align-[-2px] animate-blink" /></div>
      <div className="mt-[5px] flex items-center gap-[7px] font-mono text-[10px] text-faint"><span className="h-[5px] w-[5px] rounded-full bg-working animate-pulse-dot" />streaming - {shortTokens(tokens)} tokens</div>
    </div>
  )
}
