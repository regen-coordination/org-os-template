import { slug } from '../resources/util.ts'

export interface DecisionSection { date: string; id: string; title: string; status: string; anchor: string; start: number; end: number }

/** `## 2026-10-16 · LD-2026-035 — title`, `## 2026-09-16 · title`, `## 2026-08-21 — title`. */
const HEADING = /^## (\d{4}-\d{2}-\d{2})\s+[·—–-]\s+(.+?)\s*$/
/** An id is one token with a letter first, a digit in it and a hyphen, followed by " — ". */
const WITH_ID = /^((?=\S*\d)[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)\s+[—–]\s+(.+)$/
/** `**Status:** x`, `- **Status:** x`, `**Status**: x`, `**Status** — x`. */
const STATUS = /^\s*(?:[-*]\s+)?\*\*Status(?::\*\*|\*\*\s*(?::|—|–|-))\s*(.*)$/
const WORD = /^`?([A-Za-z][A-Za-z-]*)/

/** The decisions of a DECISIONS.md: every `## <date> …` heading, with the first word of its
 *  Status line. A heading without a date (`## Conventions`) is not a decision. */
export function parseDecisions(text: string): DecisionSection[] {
  const lines = text.split(/\r?\n/)
  const out: DecisionSection[] = []
  const used = new Map<string, number>()
  let open: DecisionSection | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('## ')) {
      if (open) { open.end = i; out.push(open); open = null }
      const m = HEADING.exec(line)
      if (!m) continue
      const date = m[1]!; const rest = m[2]!
      const withId = WITH_ID.exec(rest)
      const id = withId ? withId[1]! : ''
      const title = withId ? withId[2]! : rest
      const key = `${date}-${id ? id.toLowerCase() : slug(title).slice(0, 48).replace(/-+$/, '')}`
      const n = (used.get(key) ?? 0) + 1
      used.set(key, n)
      open = { date, id, title, status: '', anchor: n === 1 ? key : `${key}-${n}`, start: i, end: lines.length }
      continue
    }
    if (open && open.status === '') {
      const s = STATUS.exec(line)
      if (s) open.status = (WORD.exec(s[1]!.trim())?.[1] ?? '').toLowerCase()
    }
  }
  if (open) out.push(open)
  return out
}

/** A decision's section as Markdown: its heading to the line before the next `## `, without the
 *  blank lines and `---` rule that close it. */
export function sectionText(text: string, section: DecisionSection): string {
  const lines = text.split(/\r?\n/).slice(section.start, section.end)
  while (lines.length > 0 && /^\s*(?:-{3,})?\s*$/.test(lines.at(-1)!)) lines.pop()
  return lines.join('\n')
}
