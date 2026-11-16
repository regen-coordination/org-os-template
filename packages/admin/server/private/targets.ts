// packages/admin/server/private/targets.ts
//
// Where a write to private data is judged (DAO-OS L6 spec §3.2; Task 15 review I-1, closing Task 1's carry): at its own
// targets, as a git write is and as an import's private part is (server/workspace/imports.ts): a record at its
// collection's (`recordTargets(<collection>)`, read off the file it would have in git, as its class is: a registry's, a
// custom or private collection's), a private page at its tree (itself, its ancestors as the store, git and the write
// leave them, then `workspace:pages`), a definition at `workspace:collections`, a restricted field at its registry's file;
// and Council memory at the agent layer's targets as well (`workspace:agent`, R-L6-T15-2). A record that widens adds
// `['publication']`, as its class does. The change file names no private collection or page (a placeholder is its ref and
// class), so a change's private targets are read from the store's staged ops each time it is judged
// (`changePrivateTargets`), and a proposal's from its pending ops.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classOf } from '../../lib/change-classes.mjs'
import { AGENT_TARGETS, ancestorsOf, pageReader, pageTargets, targetsOfPath } from '../../lib/workspace/targets.mjs'
import { privateFileOf, privateWidens, reach, registryOf, type PrivateAccess, type StagedPrivateOp } from './ops.ts'
import type { PrivateStore } from './store.ts'
import type { Change } from '../changes/types.ts'

/** The private collection Council memory is kept in (§14). */
export const COUNCIL_MEMORY = 'council-memory'

/** A page's parent as a reader of the tree answers it; null when there is no such page. */
export type ReadPage = (id: string) => { parent: string | null } | null

const parentOf = (body: Record<string, unknown>): string | null =>
  (typeof body.parent === 'string' && body.parent !== '' ? body.parent : null)

/**
 * The page tree as a private write sees it: `written` (a page's parent as this write leaves it) first, then the store's
 * private pages, then git's files (`readText`, the worktree by default). A store that cannot be read is judged on what
 * git and the write hold (its write fails on that store anyway).
 */
export function treeReader(repo: string, store: PrivateStore | null, written: ReadonlyMap<string, string | null> = new Map(),
  readText: (rel: string) => string | null = rel => { try { return readFileSync(join(repo, rel), 'utf8') } catch { return null } }): ReadPage {
  const fromFiles = pageReader(readText)
  const parents = new Map<string, string | null>()
  if (store) { try { for (const r of store.records('pages')) parents.set(r.id, parentOf(r.body)) } catch { /* judged on git and the write */ } }
  for (const [id, parent] of written) parents.set(id, parent)
  return id => (parents.has(id) ? { parent: parents.get(id) ?? null } : fromFiles(id))
}

/** One staged private op's target lists, through `readPage`. */
export function privateOpTargets(op: StagedPrivateOp, readPage: ReadPage): string[][] {
  const name = registryOf(op)
  if (name === 'pages' && 'id' in op) return [pageTargets(op.id, ancestorsOf(op.id, readPage))]
  const file = privateFileOf(op)
  const own = targetsOfPath(file, readPage) ?? [String(classOf({ path: file }))]
  return name === COUNCIL_MEMORY ? [own, [...AGENT_TARGETS]] : [own]
}

/** The parents of the pages `ops` create or move, as they leave them. */
function writtenParents(ops: readonly StagedPrivateOp[]): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const op of ops) {
    if (op.op !== 'create-record' && op.op !== 'replace-record' && op.op !== 'update-record') continue
    if (op.collection !== 'pages') continue
    const typed = op.op === 'update-record' ? op.set : op.value
    if (op.op !== 'update-record' || Object.hasOwn(typed, 'parent')) out.set(op.id, parentOf(typed))
  }
  return out
}

/** A judge of single ops against one reading of the tree (stagePrivate's `targetsFor`). */
export function privateJudge(repo: string, store: PrivateStore | null, ops: readonly StagedPrivateOp[] = []): (op: StagedPrivateOp) => string[][] {
  const readPage = treeReader(repo, store, writtenParents(ops))
  return op => privateOpTargets(op, readPage)
}

/** Every target list `ops` are judged at, and `['publication']` when one widens a private record (§9.7). */
export function privateTargetsOf(repo: string, store: PrivateStore | null, ops: readonly StagedPrivateOp[]): string[][] {
  if (ops.length === 0) return []
  const judge = privateJudge(repo, store, ops)
  const lists = ops.flatMap(judge)
  if (store && ops.some(op => privateWidens(store, op))) lists.push(['publication'])
  return lists
}

/**
 * The private part of `change` at its own targets, read from the store's staged ops (the tray's answer, an apply's
 * judgement); undefined when the change has none, or the store cannot say (the placeholders' classes are judged then, and
 * anything with a private part is refused where the store cannot be reached anyway).
 */
export function changePrivateTargets(repo: string, access: PrivateAccess, change: Pick<Change, 'id' | 'private'> | null): string[][] | undefined {
  const placeholders = change?.private ?? []
  if (placeholders.length === 0) return undefined
  const { store } = reach(access)
  if (!store) return undefined
  let rows: Map<number, StagedPrivateOp>
  try { rows = new Map(store.staged(change!.id).map(r => [r.seq, r.op as StagedPrivateOp])) } catch { return undefined }
  const ops = placeholders.map(p => rows.get(Number(/^stg-(\d+)$/.exec(p.ref)?.[1] ?? NaN)))
  if (ops.some(op => op === undefined)) return undefined
  const judge = privateJudge(repo, store, ops as StagedPrivateOp[])
  return (ops as StagedPrivateOp[]).flatMap(judge)
}
