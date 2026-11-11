// DAO-OS L6 Task 20: the level a change in flight gives a record or a page — your staged change first, else an open
// proposal's the viewer is shown — read from every op that can carry one: a git record op's `visibility` (L5 §11.4), a
// private op's (R-L5-16.8: a widening between hats is staged in the store), a move into the repository (`move-to-git`,
// L6 §12) and a page file's front matter (L6 §4.4, Task 16's carry). Pure: the record page, its marker and the page's bar
// read it alike.
import type { Op, ProposalView, StageOp } from '../api.ts'
import { splitPage } from '../../../lib/workspace/pages.mjs'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A private op as the tray (`ChangeView.private[].op`) and a proposal (`ProposalView.private[].op`) show it. */
export type PrivateShown = { op: string; collection?: unknown; id?: unknown; level?: unknown; visibility?: unknown; set?: unknown; value?: unknown }
/** One of the tray's or a proposal's private entries; `op` is null when the store could not be read. */
export interface PrivateEntryLike { op: PrivateShown | null; says?: string }

/** What is in flight for the thing: the level, whether it is a move into the repository, and the open proposal that holds
 *  it (none while it is only staged in your change). */
export interface InFlight { level: string; move: boolean; proposal?: { id: string; derived: string } }

/** The thing a change may give a level to: a record (`<registry>:<id>`) or a page (its id, and its file when git holds it). */
export type Subject = { record: string } | { page: string; path: string | null }

/** The `visibility` a git op gives the subject, if it gives one. */
function gitLevel(op: Record<string, unknown>, s: Subject): string | null {
  if (op.op === 'file') {
    if (!('page' in s) || s.path === null || op.path !== s.path || typeof op.text !== 'string') return null
    // A page's level in flight is what its file's front matter says it is (an absent `visibility` inherits: not read here).
    const said = splitPage(op.text).front.visibility
    return typeof said === 'string' ? said : null
  }
  if (!('record' in s) || op.record !== s.record) return null
  const said = op.op === 'update' && isObj(op.set) ? op.set.visibility : (op.op === 'replace' || op.op === 'create') && isObj(op.value) ? op.value.visibility : undefined
  return typeof said === 'string' ? said : null
}

/** The level a private op gives the subject, and whether it is a move. */
function privateLevel(op: PrivateShown | null, s: Subject): { level: string; move: boolean } | null {
  if (!op) return null
  const [collection, id] = 'page' in s ? ['pages', s.page] : [s.record.slice(0, s.record.indexOf(':')), s.record.slice(s.record.indexOf(':') + 1)]
  if (op.collection !== collection || op.id !== id) return null
  if (op.op === 'move-to-git' && typeof op.level === 'string') return { level: op.level, move: true }
  if ((op.op === 'update-record' || op.op === 'replace-record') && typeof op.visibility === 'string') return { level: op.visibility, move: false }
  return null
}

/** The level in flight for `s`: your staged ops and private entries first (the last one that gives a level), else the
 *  first open proposal's. Null for none. With `current` (the thing's own level, as the server writes it; Task 20 review
 *  M3), an op that gives that same level is no level in flight and the search goes on, so an unrelated staged op that
 *  restates the level never hides an open proposal that changes it; a move is in flight whatever level it names. */
export function inFlightOf(s: Subject, staged: readonly (Op | StageOp)[], priv: readonly PrivateEntryLike[] | undefined,
  proposals: readonly ProposalView[], current?: string): InFlight | null {
  const counts = (t: { level: string; move: boolean } | null): boolean => t !== null && (t.move || current === undefined || t.level !== current)
  for (const e of [...(priv ?? [])].reverse()) { const t = privateLevel(e.op, s); if (counts(t)) return t }
  for (const op of [...staged].reverse()) {
    const t = isObj(op) ? gitLevel(op as Record<string, unknown>, s) : null
    if (t !== null && counts({ level: t, move: false })) return { level: t, move: false }
  }
  for (const p of proposals) {
    if (p.state !== 'open') continue
    const where = { id: String(p.id), derived: String(p.derived ?? p.state) }
    for (const e of ((p as { private?: PrivateEntryLike[] }).private ?? [])) { const t = privateLevel(e.op, s); if (counts(t)) return { ...t!, proposal: where } }
    if (!Array.isArray(p.ops)) continue
    for (const op of p.ops as unknown[]) {
      const t = isObj(op) ? gitLevel(op, s) : null
      if (t !== null && counts({ level: t, move: false })) return { level: t, move: false, proposal: where }
    }
  }
  return null
}

/** L6 carries K5: what a page or record says while an open proposal holds its move into the repository (the server's
 *  MOVE_PROPOSED, without its last sentence): an edit would leave the move stale, so the editor holds still. */
export const MOVE_PROPOSED = (what: 'page' | 'record', proposal: string) =>
  `A move of this ${what} into the repository is proposed in ${proposal}: an edit now would leave the move stale. Decide or withdraw the proposal first.`
