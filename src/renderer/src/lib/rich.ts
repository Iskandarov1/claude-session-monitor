export type RichPart = { type: 'text'; text: string } | { type: 'code'; lang?: string; code: string }

export function splitRich(text: string): RichPart[] {
  const parts: RichPart[] = []
  const re = /```([^\n`]*)\n([\s\S]*?)(?:\n```|$)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const before = text.slice(last, match.index).trim()
    if (before) parts.push({ type: 'text', text: before })
    parts.push({ type: 'code', lang: match[1]?.trim() || undefined, code: match[2] ?? '' })
    last = match.index + match[0].length
  }
  const rest = text.slice(last).trim()
  if (rest) parts.push({ type: 'text', text: rest })
  return parts.length ? parts : [{ type: 'text', text: '' }]
}
