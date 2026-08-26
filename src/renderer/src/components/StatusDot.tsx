import type { SessionState } from '@shared/types'
import { cn, STATE_COLOR } from '../lib/format'

export function StatusDot({ state, size = 7, className }: { state: SessionState; size?: number; className?: string }) {
  const color = STATE_COLOR[state]
  return (
    <span
      data-testid="dot"
      className={cn('inline-block shrink-0 rounded-full', state === 'working' && 'animate-pulse-dot', className)}
      style={{ width: size, height: size, background: color, boxShadow: state === 'working' ? `0 0 6px ${color}99` : undefined }}
    />
  )
}
