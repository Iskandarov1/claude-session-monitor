import type { Session, SessionState } from '@shared/types'

export { cn } from '@/lib/utils'

export function hhmm(ts: number): string {
  const date = new Date(ts)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function relTime(ts: number, now = Date.now()): string {
  const seconds = Math.max(0, now - ts) / 1000
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h`
  return `${Math.floor(seconds / 86_400)} d`
}

export function cwdTail(cwd: string): string {
  return cwd.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~')
}

export function shortTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}

export const STATE_COLOR: Record<SessionState, string> = {
  working: '#34d399',
  waiting: '#fbbf24',
  idle: '#8a8a8a',
  ended: '#60a5fa',
}

export function stateLabel(session: Session, now = Date.now()): string {
  switch (session.state) {
    case 'working':
      return session.lastActivityPreview || 'Working...'
    case 'waiting':
      return 'Waiting - likely permission'
    case 'idle':
      return `Idle - ${relTime(session.lastActivityAt, now)}`
    case 'ended':
      return `Ended - ${hhmm(session.lastActivityAt)}`
  }
}

export function firstLine(text: string, max = 80): string {
  const line = text.split('\n')[0] ?? ''
  return line.length > max ? `${line.slice(0, max - 3)}...` : line
}

export const isMac = () => window.csm?.platform === 'darwin'
export const modKey = () => (isMac() ? 'Cmd' : 'Ctrl')
