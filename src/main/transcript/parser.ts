import type { EventUpdate, TranscriptEvent, TranscriptMeta } from '@shared/types'

export const GAP_MS = 30 * 60_000

export interface ParseContext {
  sawFirst: boolean
  lastTs?: number
  claudeEventByMsg: Map<string, string>
  crossSeq: number
}

export interface ParseOutput {
  events: TranscriptEvent[]
  updates: EventUpdate[]
  meta: Partial<TranscriptMeta>
}

export function createParseContext(): ParseContext {
  return { sawFirst: false, claudeEventByMsg: new Map(), crossSeq: 0 }
}

const CROSS_RE = /<cross-session-message\b([^>]*)>\n?([\s\S]*?)\n?<\/cross-session-message>/

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1]
}

function hhmm(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function validTs(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const ts = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ts) ? ts : undefined
}

function maybeDivider(ctx: ParseContext, ts: number, out: ParseOutput): void {
  if (!ctx.sawFirst) {
    out.events.push({ kind: 'divider', id: `div-${ts}`, ts, text: `session started ${hhmm(ts)}` })
    ctx.sawFirst = true
  } else if (ctx.lastTs !== undefined && ts - ctx.lastTs > GAP_MS) {
    out.events.push({ kind: 'divider', id: `div-${ts}`, ts, text: `session resumed ${hhmm(ts)}` })
  }
  ctx.lastTs = ts
}

function textOfBlocks(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: 'text'; text: string } => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((block) => (typeof block === 'string' ? block : typeof block?.text === 'string' ? block.text : '')).join('\n')
  }
  return ''
}

function parseTargets(to: unknown): string[] {
  if (typeof to === 'string') return [to]
  if (Array.isArray(to)) return to.map(String).filter(Boolean)
  return []
}

export function parseLine(raw: string, ctx: ParseContext): ParseOutput {
  const out: ParseOutput = { events: [], updates: [], meta: {} }
  if (!raw.trim()) return out

  let data: any
  try {
    data = JSON.parse(raw)
  } catch {
    return out
  }
  if (!data || typeof data !== 'object') return out

  switch (data.type) {
    case 'user': {
      const content = data.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            out.updates.push({
              id: block.tool_use_id,
              patch: { resultText: resultText(block.content), isError: Boolean(block.is_error) },
            })
          }
        }
        if (content.some((block: any) => block?.type === 'tool_result')) return out
      }
      if (data.isMeta) return out
      const text = textOfBlocks(content).trim()
      if (!text || text.startsWith('<')) return out
      const ts = validTs(data.timestamp)
      if (ts === undefined) return out
      maybeDivider(ctx, ts, out)
      out.events.push({ kind: 'user', id: String(data.uuid ?? `user-${ts}`), ts, text })
      return out
    }

    case 'assistant': {
      const message = data.message ?? {}
      const ts = validTs(data.timestamp)
      if (ts === undefined) return out
      if (typeof message.model === 'string') out.meta.model = message.model
      const blocks: any[] = Array.isArray(message.content) ? message.content : []
      const outputTokens = typeof message.usage?.output_tokens === 'number' ? message.usage.output_tokens : undefined
      for (const block of blocks) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          const existing = message.id ? ctx.claudeEventByMsg.get(message.id) : undefined
          if (existing) {
            out.updates.push({ id: existing, patch: { appendText: block.text, outputTokens } })
          } else {
            maybeDivider(ctx, ts, out)
            const id = String(data.uuid ?? `claude-${ts}`)
            out.events.push({ kind: 'claude', id, ts, text: block.text, model: message.model, outputTokens, messageId: message.id })
            if (message.id) ctx.claudeEventByMsg.set(message.id, id)
          }
        } else if (block?.type === 'tool_use') {
          maybeDivider(ctx, ts, out)
          if (block.name === 'SendMessage') {
            out.events.push({ kind: 'sent', id: String(block.id ?? `sent-${ts}`), ts, to: parseTargets(block.input?.to), text: String(block.input?.message ?? '') })
          } else {
            out.events.push({ kind: 'tool', id: String(block.id ?? `tool-${ts}`), ts, name: String(block.name ?? 'Tool'), input: block.input })
          }
        }
      }
      return out
    }

    case 'queue-operation': {
      if (data.operation !== 'enqueue' || typeof data.content !== 'string') return out
      const match = CROSS_RE.exec(data.content)
      if (!match) return out
      const ts = validTs(data.timestamp)
      if (ts === undefined) return out
      maybeDivider(ctx, ts, out)
      out.events.push({
        kind: 'cross',
        id: `cross-${ts}-${ctx.crossSeq++}`,
        ts,
        fromName: attr(match[1]!, 'from-name') ?? 'unknown',
        fromMode: attr(match[1]!, 'from-mode'),
        text: match[2]!.trim(),
      })
      return out
    }

    case 'system': {
      if (data.subtype !== 'local_command') return out
      const ts = validTs(data.timestamp)
      if (ts === undefined) return out
      maybeDivider(ctx, ts, out)
      out.events.push({ kind: 'system', id: String(data.uuid ?? `system-${ts}`), ts, text: String(data.content ?? ''), level: data.level })
      return out
    }

    case 'permission-mode':
      if (typeof data.permissionMode === 'string') out.meta.permissionMode = data.permissionMode
      return out

    case 'ai-title':
      if (typeof data.aiTitle === 'string') out.meta.aiTitle = data.aiTitle
      return out

    case 'cost-state':
      if (typeof data.totalCostUSD === 'number') out.meta.totalCostUSD = data.totalCostUSD
      return out

    default:
      return out
  }
}

export function parseLines(lines: string[], ctx: ParseContext): ParseOutput {
  const out: ParseOutput = { events: [], updates: [], meta: {} }
  for (const line of lines) {
    const parsed = parseLine(line, ctx)
    out.events.push(...parsed.events)
    out.updates.push(...parsed.updates)
    Object.assign(out.meta, parsed.meta)
  }
  return out
}
