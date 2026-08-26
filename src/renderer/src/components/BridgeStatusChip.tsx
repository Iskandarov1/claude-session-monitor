import type { BridgeState } from '@shared/types'
import { cn } from '../lib/format'

export function BridgeStatusChip({ state }: { state: BridgeState }) {
  const item = {
    connected: { color: 'text-working', dot: 'bg-working', text: `Bridge connected${'latencyMs' in state && state.latencyMs !== undefined ? ` - ${state.latencyMs} ms` : ''}` },
    reconnecting: { color: 'text-waiting', dot: 'bg-waiting animate-pulse-dot', text: `Reconnecting attempt ${'attempt' in state ? state.attempt : 0}/${'max' in state ? state.max : 5}` },
    unavailable: { color: 'text-error', dot: 'bg-error', text: 'Bridge unavailable' },
    relaying: { color: 'text-cross', dot: 'bg-cross animate-pulse-dot', text: `Relaying prompt to ${'targets' in state ? state.targets.length : 0} target${'targets' in state && state.targets.length === 1 ? '' : 's'}` },
  }[state.status]
  return <span className={cn('inline-flex items-center gap-[5px] font-mono text-[9.5px] font-medium', item.color)}><span className={cn('h-[6px] w-[6px] rounded-full', item.dot)} />{item.text}</span>
}
