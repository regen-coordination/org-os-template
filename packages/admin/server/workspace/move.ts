// packages/admin/server/workspace/move.ts
//
// DAO-OS L6 §12 (L5 Task 16 I3), Task 11: a private record of a git collection, or a private page, moved into the
// repository by a publication decision. The staged op is `move-to-git` (private/ops.ts `MoveToGit`), split from an update
// that gives a private record a `visibility` git allows and nothing else. It carries `publication`, so it is judged as
// R-L5-16.8 judges a widening: applied where the rule for `publication` lets the actor decide alone, otherwise proposed,
// its placeholder alone in the ledger until it is decided (rule 8).
//
// Applying it (a direct apply, a ratify, or the reconcile at start) reads the store's record, splits it by the policy
// (`moveSplit`: the fields the policy still restricts stay in the store as `fields` rows), writes the rest in the one
// commit (a record's `create` with its `visibility`, or a page's file at `pages/<id>.md` with its links to stricter pages
// labelled ↗, §4.5), and deletes the store's record with a history row naming the change or the decision. Subpages stay
// where they are (§20 Q12): each is moved by its own decision.
//
// Rulings (L6 rulings log, Task 11): a move is staged alone (R-L6-T11-1); the level is always written (R-L6-T11-2); a
// record with comments written while it was private does not move until they are deleted (R-L6-T11-3); a move is judged
// where it lands as well as at its class (R-L6-T11-4).

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { StageError } from '../../lib/ops.mjs'
import { admits, formatLevel, narrowerOrEqual, parseLevel, type ParsedLevel, type Viewer, type VisibilityPolicy } from '../../lib/visibility.mjs'
import { joinPage, LOOSER_THAN_PARENT, PAGE_MAX_BYTES, parentLevelOf, type PageFront } from '../../lib/workspace/pages.mjs'
import { Refusal } from '../changes/apply.ts'
import { currentEntries, targetsOfOps } from '../changes/stage.ts'
import type { FileOp, RecordOp, StageOp } from '../changes/types.ts'
import { showFile } from '../git.ts'
import { registryDef, registryFileOf } from '../registries.ts'
import { createdText, entriesFromText } from '../registry.ts'
import { levelOfToken } from '../private/reads.ts'
import {
  gitNames, isMove, MOVE_ALONE, MOVE_CHANGED, moveDigest, MOVES, moveSplit, noRecord, PRIVATE_COLLECTION_STAYS, registerMoveCheck, resolvePrivate, unavailable,
  type MovedPart, type MoveToGit, type StagedPrivateOp,
} from '../private/ops.ts'
import type { CommentRow, PrivateRecord, PrivateStore } from '../private/store.ts'
import { guardPageRefs, pagePath, treeOf } from './pages.ts'
import { readableRows } from './written.ts'

export { isMove, MOVE_ALONE, MOVES, PRIVATE_COLLECTION_STAYS, type MoveToGit }

/** §12's refusal at stage for an id git already holds in that collection. */
export const ID_TAKEN = (collection: string, id: string) =>
  `${collection} already has a record ${id} in the repository, so this private record cannot move there under that id. Nothing was staged.`
/** R-L6-T11-3: comments written while a record was private would be read by everyone it moves to. */
export const HAS_CONVERSATION = (label: string) =>
  `${label} has comments written while it was private, which everyone it moves to would read: delete them first, or keep it private. Nothing was staged.`
/** A knowledge entry is kms's (Task 10): the Hub moves nothing into the canon. */
export const NOT_MOVABLE = (record: string) => `${record} cannot be moved into the repository from the Hub. Nothing was staged.`
const PAGE_TOO_BIG = (n: number) => `A page is at most ${PAGE_MAX_BYTES} bytes, and this one would be ${n}. Nothing was staged.`

/** One move as planned against the store and the repository: the store's side (`MovedPart`, for `movedWrites`), the git
 *  op that writes the rest, and the label rule 8 names it by to those admitted. */
export interface PlannedMove extends MovedPart { move: MoveToGit; git: RecordOp | FileOp; label: string }

const PAGE_KEYS = new Set(['id', 'title', 'parent', 'order', 'markdown', 'meeting', 'from', 'visibility'])
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** How rule 8 names a record to those admitted (§12): its title, else `<collection>:<id>`. */
export function moveLabel(collection: string, id: string, body: Record<string, unknown>): string {
  return typeof body.title === 'string' && body.title.trim() !== '' ? body.title : `${collection}:${id}`
}

/**
 * Move `move` as planned now (§12), for `viewer` (null: a decided proposal, nobody's admission asked again). Throws a
 * StageError for what cannot move: a record that is not there or that `viewer` may not read (the same words for both), a
 * private collection's record, an id git holds, comments written while private, a page whose parent is stricter than the
 * level, a link from it the level cannot hold, a page over the size limit.
 */
export function planMove(repo: string, store: PrivateStore, move: MoveToGit, policy: VisibilityPolicy, viewer: Viewer | null): PlannedMove {
  const { collection, id } = move
  const record = `${collection}:${id}`
  let kept: PrivateRecord | null
  try { kept = store.record(collection, id) } catch (err) { throw unavailable(err, store) }
  if (!kept || (viewer !== null && !admits(levelOfToken(kept.visibility), viewer))) throw new StageError('', noRecord(collection, id))
  // Task 11 review I-1: a move publishes exactly what was staged (and proposed). A record edited since is refused here: 409
  // at a direct apply, Propose and Revise; PRIVATE_STALE at ratify, which names nothing.
  if (move.digest !== moveDigest(kept)) throw new Refusal(409, { code: 'PRIVATE_CONFLICT', error: MOVE_CHANGED(record) })
  const level: ParsedLevel = parseLevel(move.level) ?? { level: 'members' }
  const label = moveLabel(collection, id, kept.body)
  let comments: CommentRow[]
  try { comments = store.comments(collection === 'pages' ? `page:${id}` : `record:${collection}:${id}`) } catch (err) { throw unavailable(err, store) }
  // PR7-R45: only talk the mover may read holds the move (they may resolve it, or ask for it to go); talk they may not read
  // is not named to them, and keeps the level it was written at wherever the record goes. A decided proposal's (no viewer)
  // counts every comment, and is PRIVATE_STALE, which names nothing.
  const holding = viewer === null ? comments : readableRows(comments, viewer, levelOfToken(kept.visibility))
  if (holding.some(c => c.deleted === null)) throw new StageError('', HAS_CONVERSATION(label))
  const base = { move, label, collection, id, visibility: kept.visibility, body: kept.body }

  if (collection === 'pages') {
    if (existsSync(join(repo, pagePath(id)))) throw new StageError('id', ID_TAKEN(collection, id))
    const tree = treeOf(repo, store)
    const entry = tree.byId.get(id)
    if (entry) {
      // The tree as the move leaves it: this page in git at the level asked. Its parent may not be stricter (§4.2).
      const after = new Map(tree.byId)
      after.set(id, { ...entry, own: formatLevel(level), where: 'git' })
      const parent = parentLevelOf(id, after, tree.policy)
      if (parent !== null && !narrowerOrEqual(level, parent)) throw new StageError('visibility', LOOSER_THAN_PARENT(formatLevel(parent)))
    }
    const { value, fields } = moveSplit(policy, collection, id, kept.body)
    const guard = guardPageRefs(typeof value.markdown === 'string' ? value.markdown : '', level, { repo, store })
    if (guard.refused !== null) throw new StageError('markdown', guard.refused)
    const front: PageFront = {
      id, title: typeof value.title === 'string' ? value.title : '',
      parent: typeof value.parent === 'string' && value.parent !== '' ? value.parent : null,
      order: typeof value.order === 'number' && Number.isFinite(value.order) ? value.order : 0,
      visibility: formatLevel(level) as PageFront['visibility'],
      ...(typeof value.meeting === 'string' ? { meeting: value.meeting } : {}),
      ...(isObj(value.from) ? { from: value.from } : {}),
      ...Object.fromEntries(Object.entries(value).filter(([k]) => !PAGE_KEYS.has(k))),
    }
    const text = joinPage(front, guard.body)
    const n = Buffer.byteLength(text, 'utf8')
    if (n > PAGE_MAX_BYTES) throw new StageError('markdown', PAGE_TOO_BIG(n))
    return { ...base, fields, git: { op: 'file', path: pagePath(id), text, base: null } }
  }

  if (!gitNames(repo).has(collection)) throw new StageError('visibility', PRIVATE_COLLECTION_STAYS)
  if (registryDef(collection, repo).filesGlob !== undefined) throw new StageError('visibility', NOT_MOVABLE(record))
  if (currentEntries(repo, collection).some(e => String(e.id) === id)) throw new StageError('id', ID_TAKEN(collection, id))
  const { value, fields } = moveSplit(policy, collection, id, kept.body)
  // R-L6-T11-2: the level is written, members as well as public, so a looser default later never widens it.
  return { ...base, fields, git: { op: 'create', record, value: { ...value, visibility: formatLevel(level) } } }
}

/** Every move of `ops`, planned (`planMove`), in their order. */
export function planMoves(repo: string, store: PrivateStore, ops: readonly StagedPrivateOp[], policy: VisibilityPolicy, viewer: Viewer | null): PlannedMove[] {
  return ops.filter(isMove).map(m => planMove(repo, store, m, policy, viewer))
}

/** A planned move refused as a 409 in its own words (an apply, a proposal, a revise). */
export function asConflict(err: unknown): never {
  if (err instanceof StageError) throw new Refusal(409, { code: 'MOVE', error: err.message })
  throw err
}

/** Where moves are judged (R-L6-T11-4): where their git ops land, as the tray judges a git op (a page under its tree). */
export function moveTargets(repo: string, planned: readonly PlannedMove[]): string[][] {
  return planned.length > 0 ? targetsOfOps(planned.map(p => p.git as StageOp), repo) : []
}

/** A private part judged now for whoever proposes or revises it, against the store as it is (Propose's check, L5
 *  R-L5-14.11): its ops as `resolvePrivate` resolves them, its moves as `planMove` plans them (refused 409 `MOVE`). */
export function judgePrivate(repo: string, store: PrivateStore, ops: readonly StagedPrivateOp[], viewer: Viewer, policy: VisibilityPolicy): PlannedMove[] {
  resolvePrivate(store, ops.filter(op => !isMove(op)), viewer, gitNames(repo))
  try { return planMoves(repo, store, ops, policy, viewer) } catch (err) { return asConflict(err) }
}

/**
 * The texts a ratify's merge writes for its moves (§12), on the branch tip `commit`: a record's file with the record
 * created in it (its file at `commit`, else an empty list under its top key), a page's file whole. Throws a StageError
 * when `commit` already holds the id (the trunk took it since the proposal opened).
 */
export async function movedTexts(repo: string, commit: string, planned: readonly PlannedMove[]): Promise<{ path: string; text: string; before: string | null }[]> {
  const files = new Map<string, { text: string; before: string | null }>()
  const at = async (path: string): Promise<string | null> => { try { return await showFile(repo, commit, path) } catch { return null } }
  for (const p of planned) {
    if (p.git.op === 'file') {
      if (files.has(p.git.path) || (await at(p.git.path)) !== null) throw new StageError('id', ID_TAKEN(p.collection, p.id))
      files.set(p.git.path, { text: p.git.text as string, before: null })
      continue
    }
    const def = registryDef(p.collection, repo)
    const rel = registryFileOf(def)
    let held = files.get(rel)
    if (!held) {
      const was = await at(rel)
      held = { text: was ?? `${def.topKey}: ${def.shape === 'map' ? '{}' : '[]'}\n`, before: was }
    }
    if (entriesFromText(held.text, def).some(e => String(e.id) === p.id)) throw new StageError('id', ID_TAKEN(p.collection, p.id))
    files.set(rel, { text: createdText(held.text, def, (p.git as Extract<RecordOp, { op: 'create' }>).value as never), before: held.before })
  }
  return [...files].map(([path, f]) => ({ path, ...f }))
}

// Staging checks every move against the repository and the tree before it is staged (private/ops.ts `splitOps`).
registerMoveCheck((repo, store, move, viewer, policy) => { planMove(repo, store, move, policy, viewer) })
