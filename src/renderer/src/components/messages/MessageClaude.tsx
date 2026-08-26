import { hhmm } from '../../lib/format'
import { splitRich } from '../../lib/rich'
import { CodeBlock } from './CodeBlock'

export function MessageClaude({ text, ts }: { text: string; ts: number }) {
  return (
    <div className="max-w-[82%]">
      <div className="mb-[3px] flex gap-2 font-mono text-[10px] text-faint"><span className="text-claude">Claude</span><span>{hhmm(ts)}</span></div>
      {splitRich(text).map((part, index) => part.type === 'text' ? (
        <div key={index} className="whitespace-pre-wrap text-[12.5px] leading-[1.55] text-body">{part.text}</div>
      ) : (
        <CodeBlock key={index} code={part.code} title={part.lang} />
      ))}
    </div>
  )
}
