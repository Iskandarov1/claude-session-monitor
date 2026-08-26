export function SystemRow({ text }: { text: string }) {
  const clean = text.replace(/<[^>]+>/g, '').trim() || text
  return <div className="self-center rounded-md border border-border bg-secondary/40 px-[11px] py-[3px] font-mono text-[10.5px] text-faint">{clean}</div>
}
