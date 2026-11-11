/** Who and what an `@` may name (§10.4): a person (their hat beside them), a role (how many wear it), or a record or
 *  a page. `canSee` is whether it may see the thing being written (for a person or a role) or whether the author may
 *  see it (for a record or a page) — the caller answers it from the visibility source; L6 wires it. */
export interface Mentionable {
  kind: 'person' | 'role' | 'record' | 'page'
  id: string
  label: string
  /** A person's hat, by name ("Ops"). */
  hat?: string
  /** A role's wearers, counted ("8 people"). */
  count?: number
  canSee: boolean
  /** DAO-OS L6 (Task 9 serves it): a record's collection, which its glyph is drawn from (never its id). */
  recordKind?: string
  /** DAO-OS L6: the Markdown target a mention of it is written with (`hub:member/<id>`, `./<id>.md` …). */
  href?: string
}

/** The words a name is matched on: its own words, lower case. */
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** What the picker offers for a query typed after `@` (the `@` itself is not part of it): those whose name has a
 *  word starting with it, or whose id does, whatever the case. A member who may not see the thing stays, after the
 *  rest, to be drawn disabled (C-21); a role, a record or a page that may not be seen is never offered (§6.3:
 *  absent, not disabled). The order given is kept within each part. */
export function mentionables(people: Mentionable[], query: string): Mentionable[] {
  const q = query.trim().replace(/^@/, '').trim().toLowerCase()
  const matches = (m: Mentionable) => q === '' || m.id.toLowerCase().startsWith(q) || m.label.toLowerCase().startsWith(q) || words(m.label).some(w => w.startsWith(q))
  const offered = people.filter(m => (m.canSee || m.kind === 'person') && matches(m))
  return [...offered.filter(m => m.canSee), ...offered.filter(m => !m.canSee)]
}

// --- DAO-OS L6 Task 18: an `@` in a comment's text box (the composer's caret), and the mentions it picked

/** What is typed after an `@` that starts a word, up to the caret; null when the caret is not in one. */
export function mentionQuery(text: string, caret: number): string | null {
  const m = /(?:^|\s)@([^\s@[\]()]*)$/u.exec(text.slice(0, caret))
  return m ? m[1]! : null
}

/** A mention picked in the composer: written `@<label>` in the box, sent as `markdown`. */
export interface MentionPick { label: string; markdown: string }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The text as sent: each picked `@<label>` still in it becomes its mention's Markdown (`[@Label](hub:member/<id>)`), the
 *  longest label first so a shorter name inside a longer one is not taken for it; one already written as a link (after a
 *  `[`) is left alone. What was not picked stays as typed. */
export function expandMentions(text: string, picks: readonly MentionPick[]): string {
  if (picks.length === 0) return text
  const by = new Map(picks.map(p => [p.label, p.markdown]))
  const labels = [...by.keys()].sort((a, b) => b.length - a.length).map(escape)
  return text.replace(new RegExp(`(?<!\\[)@(${labels.join('|')})(?![\\p{L}\\p{N}])`, 'gu'), (_all, label: string) => by.get(label) ?? _all)
}

/** A mention's Markdown, as the editor writes one (§5.2): `[@<label>](<href>)`. */
export const mentionMarkdown = (m: { label: string; href: string }): string => `[@${m.label.replace(/[[\]]/g, '')}](${m.href})`
// --- end L6 Task 18
