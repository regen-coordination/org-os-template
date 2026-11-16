// packages/admin/server/private/proposals.ts
//
// Rule 8 in the ledger (L5 spec §9.6, §10.3): a proposal whose change touches private data holds, in git, only a
// placeholder per private op, `{ op: private, ref: prv_<16 hex>, class, digest: sha256:<hex> }`; the real ops wait in the
// private store's `pending` table, with a random salt the digest is taken over, until the proposal is decided. Ratify
// writes them in the store transaction around its merge commit and marks the proposal `applied`; a closing drops them;
// on start the server applies what a ratify left unapplied (`reconcilePrivate`). What each viewer is shown of such a
// proposal is decided here too (`shownTo`): its real ops to those admitted to every level they write at, and to anyone
// else "A change to a restricted collection" and its rule, with no op list.
//
// The ops kept in `pending` are the staged deltas (ops.ts `StagedPrivateOp`), composed at staging, and resolved against
// the store only when they are applied (`resolvePrivate`): one source of the composition logic, as for a direct apply.

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REGISTRIES } from '../registries.ts'
import { currentEntries } from '../changes/stage.ts'
import { readConfig } from '../visibility/config.ts'
import { Refusal } from '../changes/apply.ts'
import { resolveRev } from '../git.ts'
import { readLedger } from '../proposals/ledger.ts'
import { canonicalJson, type Proposal } from '../../lib/proposals.mjs'
import { isPlaceholder } from '../../lib/ops.mjs'
import { sha256Hex } from '../../lib/sha256.mjs'
import { admits, formatLevel, restrictedFields, type Viewer, type VisibilityPolicy } from '../../lib/visibility.mjs'
import { levelOfToken } from './reads.ts'
import { splitPage } from '../../lib/workspace/pages.mjs'
import {
  applyPrivate, asUnavailable, isMove, movedWrites, MOVES, moveSplit, privateClass, reach, resolvePrivate, RESTRICTED_SUBJECT, shownOp, unavailable,
  type MoveToGit, type PrivateAccess, type StagedPrivateOp,
} from './ops.ts'
import type { PendingRow, PrivateStore } from './store.ts'

/** A private op as the ledger holds it (§9.6): no record, no value. */
export type LedgerPlaceholder = { op: 'private'; ref: string; class: string; digest: string }
/** One private op as an admitted viewer is shown it: its placeholder's ref and class, and the op itself; a move into the
 *  repository (DAO-OS L6 §12) also says what it does (`MOVES`). */
export interface ShownPrivate { ref: string; class: string; op: StagedPrivateOp; says?: string }

/** What a viewer not admitted to a proposal's private part reads where its changes would be (rule 8). */
export const RESTRICTED_NOTE = 'This proposal changes a restricted collection: what it changes is shown only to those admitted to it.'

/** The digest of a private op (§9.6): SHA-256 over the salt and the canonical JSON of the real ops, both kept in the store,
 *  so neither the value nor a guess at it can be checked against git. */
export const digestOf = (salt: string, ops: readonly unknown[]): string => `sha256:${sha256Hex(salt + canonicalJson(ops))}`

/** The private placeholders among a proposal's ops, in their order. */
export function placeholdersOf(ops: readonly unknown[] | undefined): LedgerPlaceholder[] {
  return (ops ?? []).filter(isPlaceholder) as LedgerPlaceholder[]
}

/** A proposal's private part as git and the store will hold it: one placeholder and one `pending` row per op, each with a
 *  fresh ref and a fresh salt (so the same value proposed twice has two digests). */
export function pendingPart(proposal: string, ops: readonly StagedPrivateOp[]): { rows: PendingRow[]; placeholders: LedgerPlaceholder[] } {
  const rows: PendingRow[] = []
  const placeholders: LedgerPlaceholder[] = []
  for (const op of ops) {
    const ref = `prv_${randomBytes(8).toString('hex')}`
    const salt = randomBytes(32).toString('hex')
    const digest = digestOf(salt, [op])
    rows.push({ ref, proposal, salt, ops: [op], digest })
    placeholders.push({ op: 'private', ref, class: privateClass(op), digest })
  }
  return { rows, placeholders }
}

/** A ledger whose placeholders the store does not hold as written: the same words whatever is missing, naming nothing. */
const lost = (id: string) => new Refusal(409, { code: 'PRIVATE_LOST',
  error: `Proposal ${id}'s restricted part is not in the private store as the ledger records it, so it cannot be shown, revised or applied. ` +
    'Withdraw it, and propose the change again. Nothing was written.' })

/**
 * The private ops proposal `entry`'s placeholders stand for, each placeholder with its own: every placeholder must have its
 * `pending` row, of this proposal, whose digest is the placeholder's and is the digest of the row's salt and ops; otherwise
 * 409 `PRIVATE_LOST`. A store that fails to read is its 503 (ops.ts `unavailable`).
 */
export function pendingOf(store: PrivateStore, entry: Pick<Proposal, 'id' | 'ops'>): { placeholder: LedgerPlaceholder; ops: StagedPrivateOp[] }[] {
  const id = String(entry.id)
  let rows: PendingRow[]
  try { rows = store.pending(id) } catch (err) { throw unavailable(err, store) }
  const byRef = new Map(rows.map(r => [r.ref, r]))
  return placeholdersOf(entry.ops as unknown[]).map(placeholder => {
    const row = byRef.get(placeholder.ref)
    if (!row || row.proposal !== id || row.digest !== placeholder.digest || digestOf(row.salt, row.ops) !== row.digest) throw lost(id)
    return { placeholder, ops: row.ops as StagedPrivateOp[] }
  })
}

/** The private ops of proposal `entry`, in their order (`pendingOf`). */
export function pendingOps(store: PrivateStore, entry: Pick<Proposal, 'id' | 'ops'>): StagedPrivateOp[] {
  return pendingOf(store, entry).flatMap(p => p.ops)
}

const KNOWN = new Set(REGISTRIES.map(r => r.name))

/** Every level `op` writes at or reads from, as the store and the policy hold things now: a field's staged and stored
 *  levels and the level data/visibility.yaml gives it now (so a field narrowed after the proposal opened is shown only to
 *  those admitted to its new level: R-L5-16.4); a record's private collection's level, the level the op gives it and the
 *  level it is stored at. Null when no level is known (a record of a git collection the store no longer keeps): nobody is
 *  admitted to an op whose level is not known. */
function levelsOf(store: PrivateStore, op: StagedPrivateOp, policy: VisibilityPolicy): string[] | null {
  const out: string[] = []
  if (op.op === 'put-field' || op.op === 'delete-field') {
    const f = op.op === 'put-field' ? op.field : op
    const at = op.op === 'put-field' ? op.field.visibility : op.visibility
    if (at !== undefined) out.push(at)
    const stored = store.fields(f.registry, f.record).find(x => x.field === f.field)
    if (stored) out.push(stored.visibility)
    const now = restrictedFields(policy, f.registry)
    if (Object.hasOwn(now, f.field)) out.push(formatLevel(now[f.field]!))
    return out.length > 0 ? out : null
  }
  if (op.op === 'clear-fields') return null
  // DAO-OS L6 §12: a move reads the record at the level it is kept at (its own collection may be `pages`, or a custom one).
  if (op.op === 'move-to-git') {
    const kept = store.record(op.collection, op.id)
    return kept ? [kept.visibility] : null
  }
  if (!KNOWN.has(op.collection)) {
    const listed = store.collections().find(c => c.id === op.collection)
    if (!listed) return null
    out.push(listed.visibility)
  }
  if ('visibility' in op && op.visibility !== undefined) out.push(op.visibility)
  const kept = store.record(op.collection, op.id)
  if (kept) out.push(kept.visibility)
  return out.length > 0 ? out : null
}

/** Rule 8's words for a move (§12), to a viewer admitted to it: the record by its title (move.ts `moveLabel`). */
function movesSays(store: PrivateStore, op: MoveToGit): string {
  const body = store.record(op.collection, op.id)?.body ?? {}
  const label = typeof body.title === 'string' && body.title.trim() !== '' ? body.title : `${op.collection}:${op.id}`
  return MOVES(label, op.level)
}

/** Whether `viewer` is admitted to every level `ops` write at or read from, `policy` being data/visibility.yaml as it is
 *  now (fails closed: the public, an unknown level). */
export function admittedTo(store: PrivateStore, ops: readonly StagedPrivateOp[], viewer: Viewer, policy: VisibilityPolicy): boolean {
  if (viewer.kind !== 'member') return false
  return ops.every(op => {
    const levels = levelsOf(store, op, policy)
    return levels !== null && levels.every(l => admits(levelOfToken(l), viewer))
  })
}

/** The private part of proposal `view` as `viewer` may be shown it: its ops when they are admitted to all of them; null
 *  when they are not, when the store cannot be read, or when it does not hold the part as the ledger records it. */
function privateShown(view: { id?: unknown; ops?: unknown }, viewer: Viewer, access: PrivateAccess, policy: VisibilityPolicy): ShownPrivate[] | null {
  if (viewer.kind !== 'member') return null
  const { store } = reach(access)
  if (!store) return null
  try {
    const part = pendingOf(store, { id: String(view.id), ops: view.ops as Proposal['ops'] })
    if (!admittedTo(store, part.flatMap(p => p.ops), viewer, policy)) return null
    return part.flatMap(p => p.ops.map(op => ({ ref: p.placeholder.ref, class: p.placeholder.class, op: shownOp(op), ...(isMove(op) ? { says: movesSays(store, op) } : {}) })))
  } catch (err) {
    if (!(err instanceof Refusal)) asUnavailable(err, store) // a failure of the store is its attention; the view goes on
    return null
  }
}

/**
 * A proposal view (list or page) as `viewer` is shown it (§9.5, §9.6, rule 8). A proposal with no private placeholder is
 * as it is. One with some is shown its git ops as `ops` (so `stale` and `current` keep their positions) and:
 * - to a viewer admitted to every level its private ops write at, those ops, merged from the store, as `private`;
 * - to anyone else, "A change to a restricted collection" in place of its title, its rules and where it stands, and no op
 *   list: no `ops`, no rationale or statement, no revise event's ops, and on the page no diff and no records.
 */
export function shownTo<V extends object>(view: V, viewer: Viewer, access: PrivateAccess, policy: VisibilityPolicy): V {
  const v = view as Record<string, unknown>
  const ops = Array.isArray(v.ops) ? (v.ops as unknown[]) : []
  if (!ops.some(isPlaceholder)) return view
  const git = ops.filter(op => !isPlaceholder(op))
  const shown = privateShown(v, viewer, access, policy)
  if (shown) return { ...v, ops: git, private: shown } as V
  const { rationale: _r, statement: _s, private: _p, ...rest } = v
  const events = Array.isArray(v.events)
    ? v.events.map(e => {
      if (typeof e !== 'object' || e === null || (e as { kind?: unknown }).kind !== 'revise') return e
      const { ops: _o, ...event } = e as Record<string, unknown>
      return event
    })
    : v.events
  return {
    ...rest, title: RESTRICTED_SUBJECT, ops: [], events, restricted: true,
    ...(Object.hasOwn(v, 'diff') ? { diff: null, note: RESTRICTED_NOTE } : {}),
    ...(Object.hasOwn(v, 'current') ? { current: [] } : {}),
  } as V
}

/** The words a ratify answers when its private part no longer applies (a record gone, one already there, a collection
 *  gone): the same whatever happened, naming nothing, since the ratifier may not be admitted to it (R-L5-15.3). */
export const PRIVATE_STALE = 'Not ratified: the restricted part of this proposal no longer applies to the private store as it was proposed ' +
  '(something it changes is gone, or something it creates is already there). Revise it, or withdraw it. Nothing was written.'

/** `resolvePrivate` for a decided proposal (no one's admission asked again, R-L5-15.3), its refusals answered with
 *  `PRIVATE_STALE`. */
export function decidedWrites(store: PrivateStore, ops: StagedPrivateOp[]) {
  try { return resolvePrivate(store, ops.filter(op => !isMove(op)), null) } catch (err) {
    if (err instanceof Refusal && err.status === 409) throw new Refusal(409, { code: 'PRIVATE_STALE', error: PRIVATE_STALE })
    throw err
  }
}

/** A closing (withdraw, reject, expire) drops the proposal's `pending` rows (§10.2: the private part of an *open*
 *  proposal), after its commit. When the store cannot be reached or fails, the rows stay and the next start drops them
 *  (`reconcilePrivate`): a closing never waits on the store. */
export async function closingDropsPending<T>(access: PrivateAccess, id: string, closing: () => Promise<T>): Promise<T> {
  const out = await closing()
  const { store } = reach(access)
  if (!store) return out
  try {
    if (store.pending(id).length > 0) await store.tx(w => w.deletePending(id))
  } catch (err) { asUnavailable(err, store) }
  return out
}

/** A ratified move's store part, at start (§12): the record as the store holds it, and the fields it keeps. Throws (and
 *  the reconcile leaves the part) when the store no longer holds it or git does not hold what the merge moved.
 *
 *  The fields kept (Task 11 review M-2): every key of the record that git's copy does not hold, at the level the policy
 *  gives it now, else (a field no longer restricted, which the merge kept out) the level the record was kept at; a field
 *  the store already holds a row of (the narrow control moved git's value there since the merge) is never overwritten.
 *  So whatever the policy did between the merge and the restart, nothing of the record is lost and nothing enters git. */
function movedPartOf(repo: string, store: PrivateStore, m: MoveToGit) {
  const kept = store.record(m.collection, m.id)
  if (!kept) throw new Refusal(409, { code: 'PRIVATE_STALE', error: PRIVATE_STALE })
  const inGit = gitKeysOf(repo, m)
  if (inGit === null) throw new Refusal(409, { code: 'MOVE_NOT_IN_GIT', error: `${m.collection}:${m.id} is not in the repository` })
  let levels = new Map<string, string>()
  try { levels = new Map(moveSplit(readConfig(repo), m.collection, m.id, kept.body).fields.map(f => [f.field, f.visibility])) } catch { /* the record's level */ }
  const rows = new Set(store.fields(m.collection, m.id).map(f => f.field))
  const isMarker = (k: string, v: unknown) => k === 'restricted' && typeof v === 'object' && v !== null && !Array.isArray(v)
  const fields = Object.entries(kept.body)
    .filter(([k, v]) => k !== 'id' && k !== 'visibility' && !isMarker(k, v) && v !== null && v !== undefined && !inGit.has(k) && !rows.has(k))
    .map(([field, value]) => ({ registry: m.collection, record: m.id, field, visibility: levels.get(field) ?? kept.visibility, value }))
  return { collection: m.collection, id: m.id, visibility: kept.visibility, body: kept.body, fields }
}

/** The keys git's copy of a moved record holds (a page's front matter and its markdown), or null when git holds none. */
function gitKeysOf(repo: string, m: MoveToGit): Set<string> | null {
  if (m.collection === 'pages') {
    const path = join(repo, 'pages', `${m.id}.md`)
    if (!existsSync(path)) return null
    const { front } = splitPage(readFileSync(path, 'utf8'))
    return new Set([...Object.keys(front), 'markdown'])
  }
  const entry = currentEntries(repo, m.collection).find(e => String(e.id) === m.id)
  return entry ? new Set(Object.keys(entry)) : null
}

const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).trim().split('\n')[0] ?? ''

/**
 * On start (§10.3): every ratified proposal whose placeholders have no `applied` row (its transaction was never committed)
 * has its private part applied now, in one transaction, by its ratifier and under its decision, and is marked applied
 * with the trunk's tip; every closed proposal's leftover `pending` rows are dropped. Answers the ids applied. A part that
 * cannot be applied (the store no longer holds it as the ledger records it, or it no longer applies) is logged and left
 * for the operator: nothing of it is written.
 */
export async function reconcilePrivate(repo: string, store: PrivateStore): Promise<string[]> {
  const ledger = readLedger(repo)
  if (ledger.problems.length > 0) return []
  const done: string[] = []
  const tip = await resolveRev(repo, 'HEAD')
  for (const entry of ledger.entries) {
    const id = String(entry.id)
    if (entry.state === 'open') continue
    const closed = (entry.closed ?? null) as { by?: unknown; decision?: unknown } | null
    if (entry.state === 'ratified' && placeholdersOf(entry.ops as unknown[]).length > 0 && store.applied(id) === null) {
      try {
        const ops = pendingOps(store, entry)
        // DAO-OS L6 §12: a move's git part is in the merge; its store part (the restricted fields kept, the record gone) is
        // written now, and only when git holds what was moved (else it is left for the operator, as any part that fails).
        const moves = ops.filter(isMove).map(m => movedPartOf(repo, store, m))
        const writes = [...decidedWrites(store, ops), ...movedWrites(store, moves)]
        const by = typeof closed?.by === 'string' && closed.by !== '' ? closed.by : String(entry.author)
        const decision = typeof closed?.decision === 'string' && closed.decision !== '' ? closed.decision : null
        await store.tx(w => {
          applyPrivate(w, writes, by, null, store, decision)
          w.deletePending(id)
          w.putApplied({ proposal: id, commit: tip ?? 'unknown', at: new Date().toISOString() })
        })
        done.push(id)
      } catch (err) {
        const code = err instanceof Refusal ? String(err.body.code ?? err.status) : firstLine(err)
        console.error(`org-os admin: the restricted part of ratified proposal ${id} was not applied at start (${code}); it is left as it is.`)
      }
      continue
    }
    if (store.pending(id).length > 0) await store.tx(w => w.deletePending(id))
  }
  return done
}
