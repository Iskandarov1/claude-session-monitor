import type { TranscriptEvent } from '@shared/types'
import { toolSummary } from './state'

const hhmm = (ts: number): string => {
  const date = new Date(ts)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const quote = (text: string): string => text.split('\n').map((line) => `> ${line}`).join('\n')

export function transcriptToMarkdown(session: { name: string; cwd: string; startedAt: number }, events: TranscriptEvent[]): string {
  const parts: string[] = [`# ${session.name}`, '', `cwd: \`${session.cwd}\``, `started: ${new Date(session.startedAt).toISOString()}`, '', '---', '']
  for (const event of events) {
    switch (event.kind) {
      case 'divider':
        parts.push(`_${event.text}_`)
        break
      case 'user':
        parts.push(`**You** · ${hhmm(event.ts)}`, '', event.text)
        break
      case 'claude':
        parts.push(`**Claude** · ${hhmm(event.ts)}`, '', event.text)
        break
      case 'tool': {
        const summary = toolSummary(event.name, event.input)
        const arg = summary.startsWith(`${event.name}: `) ? summary.slice(event.name.length + 2) : ''
        parts.push(`> **Tool · ${event.name}**${arg ? ` \`${arg}\`` : ''}`)
        if (event.resultText) parts.push('>', '> ```', quote(event.resultText), '> ```')
        break
      }
      case 'cross':
        parts.push(`**from ${event.fromName}**`, '', quote(event.text))
        break
      case 'sent':
        parts.push(`**to ${event.to.join(', ')}**`, '', quote(event.text))
        break
      case 'system':
        parts.push(`_system: ${event.text}_`)
        break
    }
    parts.push('')
  }
  return parts.join('\n')
}
