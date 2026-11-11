// packages/admin/server/workspace/pages.ts
//
// Pages (DAO-OS L6 spec §4, §16): a git page is one file, `pages/<id>.md` (members or public); a page stricter than
// members is a private record of the collection `pages` in the store, and its write makes no commit (§4.3). The tree is in
// front matter; a page's level is its own, else its parent's, else `collections.pages.default`, else members, and a child is
// never looser than its parent (lib/workspace/pages.mjs `pageLevel`, `looserThanParent`, shared with validate:data and
// validate:governance, controller ruling P-14). Every read goes through the gate (`Levels.pages`, `gateItems`): a page the
// viewer may not see has no title, no count, no backlink (rule 7). Every page write passes `guardRefs` (§4.5).
//
// A git page write is a workspace write judged at the page's tree (§3.2): under `workspace/direct` one commit at once
// (subject `page: <title>`, `Org-Rule: workspace/direct`); raised, its file op staged in the actor's change. A private
// page's write applies at once where the rule lets this actor write alone, and is refused with the rule's sentence where
// it is raised (a raised private page's staging is a carry, rulings log Task 7).
//
//   GET    /api/pages                    the tree the viewer may see (the public: public pages only)
//   GET    /api/pages/:id                one page, how the viewer may write it, and its backlinks; 404 alike for absent
//                                        and invisible
//   POST   /api/pages                    a new page (201)
//   POST   /api/pages/:id/move           a page put under another, or among its siblings
//   DELETE /api/pages/:id                a page deleted (refused while it holds subpages)
//   POST   /api/pages/:id/assets         an attachment, base64 in JSON (201)
//   POST   /api/meetings                 Record a meeting: the meeting and its notes page in one workspace write (201)

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Context, Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { actorTrailer, commitIdent, isKnown, type KnownActor } from '../actor.ts'
import { actorOf, knownActorOf, viewerOf } from '../request.ts'
import { effectiveRule, hatsActedUnder, readRuleContext, ruleIds } from '../governance/effective.ts'
import { applyOps, guardFiles, Refusal, StageRefusal } from '../changes/apply.ts'
import { baseOf } from '../changes/canonical.ts'
import { classesOf, currentEntries, stage, targetsOfOps } from '../changes/stage.ts'
import { ChangeStore, newChangeId } from '../changes/store.ts'
import type { FileOp, RecordError, RuleSummary, StageOp } from '../changes/types.ts'
import { assertWritablePath, commitPaths, restageDataPaths } from '../git.ts'
import { lastCommit } from '../resources/changed.ts'
import { fileBase, gitPages, pendingText, registerFileCheck } from './files.ts'
import { gitDefinitions } from './collections.ts'
import { fromOf } from './sources.ts'
import { gateItems, Levels, MAINTAINERS, NOBODY } from '../visibility/gate.ts'
import { readConfig } from '../visibility/config.ts'
import { gitNames, heldMove, MOVE_PROPOSED, reach, storeAccess, unavailable, type PrivateAccess } from '../private/ops.ts'
import { narrow } from '../visibility/narrow.ts'
import { levelOfToken, NO_PRIVATE, privateReads } from '../private/reads.ts'
import type { PrivateRecord, PrivateStore } from '../private/store.ts'
import { admits, formatLevel, fullLevel, gitAllows, narrowerOrEqual, parseLevel, type ParsedLevel, type Viewer, type VisibilityPolicy } from '../../lib/visibility.mjs'
import { refsOf } from '../../lib/workspace/markdown.mjs'
import { ancestorsOf, pageTargets } from '../../lib/workspace/targets.mjs'
import { displayNames } from '../session/names.ts'
import type { Membership } from '../session/membership.ts'
import {
  ASSET_MAX_BYTES, CANNOT_LINK, childrenOf, descendantsOf, guardRefs, HAS_SUBPAGES, joinPage, labelledLinks, looserThanParent, LOOSER_THAN_PARENT, NAMED_BY,
  newPageId, NO_PAGE, NO_PRIVATE_ASSETS, orderBetween, ORDER_EPSILON, ORDER_STEP, PAGE_MAX_BYTES, pageEntries, pageLevel, pagesMadePublic, PARENT_MISSING,
  PRIVATE_PAGE_ID, slugOf, splitPage, staleOf, type PageEntry, type PageFront,
} from '../../lib/workspace/pages.mjs'

export {
  ASSET_MAX_BYTES, CANNOT_LINK, guardRefs, HAS_SUBPAGES, LOOSER_THAN_PARENT, NO_PAGE, NO_PRIVATE_ASSETS, PAGE_MAX_BYTES, pageLevel, PARENT_MISSING,
}

/** One page in the tree as GET /api/pages answers it (§16). `stale`: shown at the root, its parent missing (§4.2). */
export interface PageNode {
  id: string; title: string; parent: string | null; order: number; visibility: string; from?: unknown; stale?: 'missing-parent'
  /** Walk I9: GET /api/pages?write, for a known member: how their write under this page goes. */
  write?: 'direct' | 'approval' | 'none'
}

export type PageAct =
  | { kind: 'create'; title: string; parent: string | null; visibility?: string; markdown?: string; meeting?: string }
  | { kind: 'move'; id: string; parent: string | null; before?: string }
  | { kind: 'remove'; id: string }

export interface PagesDeps {
  repo: string
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  notify: (msg: { type: 'changes' }) => void
  privateStore: PrivateAccess
  /** Membership from the Hats tree, so "Edited by" names a CAIP-10 actor by the hat they wear (walk fix wave 4, G9). */
  membership?: Membership | null
}

/** What a page write needs besides the actor: the store (null: it cannot be reached, `why` says why), and the change
 *  tray's notice for a raised write. */
export interface WriteDeps { store: PrivateStore | null; why?: unknown; notify?: (msg: { type: 'changes' }) => void }

// Copy (rulings log, Task 7). §4.2, §4.5 and §16 give LOOSER_THAN_PARENT, HAS_SUBPAGES, CANNOT_LINK, NO_PRIVATE_ASSETS and
// the 404; the rest are this task's.
export const HAS_HIDDEN_SUBPAGES = 'This page still holds subpages. Move or delete them before deleting it. Nothing was written.'
export const INTO_ITSELF = 'A page cannot be moved into itself or one of its subpages. Nothing was written.'
export const NOT_A_SIBLING = (id: string) => `${id} is not a page in that place, so nothing can be put before it. Nothing was written.`
/** The final review's I-1 (PF-R115): a renumbering that finds no room between the siblings it may not write. Names none. */
export const NO_ROOM = "This page can't be placed there now. Nothing was changed."
export const NOT_A_LEVEL = (token: string) => `${token} is not a level: public, members, hat:<hat ref> or role:<role id>. Nothing was written.`
export const NOT_ADMITTED = (level: string) => `A page kept at ${level} would be one you could not read yourself, so it cannot be written here. Nothing was written.`
export const PAGE_TOO_BIG = (n: number) => `A page is at most ${PAGE_MAX_BYTES} bytes, and this one would be ${n}. Nothing was written.`
export const ASSET_TOO_BIG = (n: number) => `An attachment is at most ${ASSET_MAX_BYTES} bytes, and this one is ${n}. Nothing was written.`
export const ASSET_NAME = 'An attachment\'s name is 1 to 100 letters, digits, dots, hyphens and underscores, beginning with a letter or a digit.'
export const ASSET_RAISED = 'This page\'s tree needs approval for its changes, and an attachment cannot be staged for approval yet. Nothing was written.'
export const PRIVATE_PARENT = (path: string) => `Not staged: ${path} names a private page as its parent, and a page in the repository never sits under one. Nothing was staged.`
export const RESTRICTED_PAGE = (path: string, level: string) =>
  `Not staged: ${path} would be kept at ${level}, and git holds nothing stricter than members. Nothing was staged.`
export const STRICT_LINK_IN_FILE = (path: string) =>
  `Not staged: ${path} links to a page fewer people may read with a label that shows its title; label that link ↗. Nothing was staged.`
const UNCHANGED = 'Nothing changed: the page already holds this. Nothing was written.'
const BODY = 'The body must be {"title", "parent"?, "visibility"?, "markdown"?, "meeting"?}.'
const MOVE_BODY = 'The body must be {"parent": <page id or null>, "before"?: <page id>}.'
const ASSET_BODY = 'The body must be {"name", "data": <the file, base64>}.'
const MEETING_BODY = 'The body must be {"title", "date": "YYYY-MM-DD", "type"?}.'

export const pagePath = (id: string): string => `pages/${id}.md`
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ── reading ───────────────────────────────────────────────────────────────────────────────────────────

export interface Tree { levels: Levels; byId: ReadonlyMap<string, PageEntry>; policy: VisibilityPolicy }

/** Every page, git's and the store's (none when it cannot be reached), with the gate's levels. */
export function treeOf(repo: string, store: PrivateStore | null): Tree {
  const policy = readConfig(repo)
  const levels = new Levels(repo, policy, MAINTAINERS, store ? privateReads(() => store) : NO_PRIVATE)
  return { levels, byId: levels.pages(), policy }
}

export const levelIn = (tree: Tree, id: string): ParsedLevel => tree.levels.page(id) ?? fullLevel(tree.policy, 'pages', null)

/** The page `id` when `viewer` may see it; else the 404 of one that is not there (rule 7). */
export function visiblePage(tree: Tree, id: string, viewer: Viewer): PageEntry {
  const e = tree.byId.get(id)
  if (!e || !admits(levelIn(tree, id), viewer)) throw new HttpError(404, NO_PAGE(id))
  return e
}

const nodeOf = (e: PageEntry): Omit<PageNode, 'visibility'> =>
  ({ id: e.id, title: e.title, parent: e.parent, order: e.order, ...(e.from !== undefined ? { from: e.from } : {}) })

/** The pages `viewer` may see, gated (§4.2, §16), in order. A page whose parent names no page, whose chain loops, or whose
 *  parent the viewer may not see is at the root with `stale: 'missing-parent'` (never hidden). */
export function readPages(repo: string, store: PrivateStore | null, viewer: Viewer): PageNode[] {
  const tree = treeOf(repo, store)
  const seen = gateItems(viewer, [...tree.byId.values()].map(nodeOf), n => levelIn(tree, n.id))
  const visible = new Set(seen.map(n => n.id))
  return seen.map((n): PageNode => (n.parent !== null && (staleOf(n.id, tree.byId) !== null || !visible.has(n.parent))
    ? { ...n, parent: null, stale: 'missing-parent' } : n))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}

/** The pages a page's body links to or mentions, per page, read once per version of it (§4.6: cached). */
const REFS = new Map<string, { key: string; ids: ReadonlySet<string> }>()
function pagesNamedBy(e: PageEntry): ReadonlySet<string> {
  const slot = `${e.where}:${e.id}`
  const key = e.where === 'git' ? (e.text ?? '') : `${e.rev ?? ''}\u0000${e.markdown}`
  const hit = REFS.get(slot)
  if (hit && hit.key === key) return hit.ids
  const refs = refsOf(e.markdown)
  const ids = new Set([...refs.links, ...refs.mentions.filter(m => m.kind === 'page').map(m => m.ref)])
  REFS.set(slot, { key, ids })
  return ids
}

/** §4.6: the pages whose body links to or mentions `id`, git's and the private ones `viewer` is admitted to, gated: a
 *  backlink from a page they may not see is not listed, and not counted. */
export function backlinks(repo: string, id: string, viewer: Viewer, store: PrivateStore | null): PageNode[] {
  const tree = treeOf(repo, store)
  const from = [...tree.byId.values()].filter(e => e.id !== id && pagesNamedBy(e).has(id)).map(nodeOf)
  return gateItems(viewer, from, n => levelIn(tree, n.id))
}

/** L9's input (§4.7; controller ruling P-15: L9 itself names its own `publishedPages`): the git pages whose level is
 *  public, with their front matter and body. The store is not read: a private page is never public. */
export function publicPagesOf(repo: string): { front: PageFront; body: string }[] {
  const tree = treeOf(repo, null)
  return [...tree.byId.values()]
    .filter(e => e.where === 'git' && levelIn(tree, e.id).level === 'public')
    .map(e => ({ front: e.front!, body: e.markdown }))
}

// ── links (§4.5) ─────────────────────────────────────────────────────────────────────────────────────

/** `guardRefs` over the instance: a page's level from the tree, a private collection's from the store. A collection git
 *  does not know, while the store cannot be reached, cannot be judged: the store's 503. */
export function guardPageRefs(body: string, level: ParsedLevel, deps: { repo: string; store: PrivateStore | null; why?: unknown }): { body: string; refused: string | null } {
  const tree = treeOf(deps.repo, deps.store)
  const names = gitNames(deps.repo)
  return guardRefs(body, level, {
    pageLevel: id => tree.levels.page(id),
    collectionLevel: name => {
      if (names.has(name)) return null
      if (!deps.store) throw unavailable(deps.why)
      let listed: { id: string; visibility: string } | undefined
      try { listed = deps.store.collections().find(c => c.id === name) } catch (err) { throw unavailable(err, deps.store) }
      return listed ? levelOfToken(listed.visibility) : null
    },
    // DAO-OS L6 R-9b (Task 9): a record's level and its title's; one git does not hold, read from the store (none: it is
    // taken as stricter, so its title is never shown while the store cannot say).
    recordLevels: (registry, id) => {
      const found = names.has(registry) ? tree.levels.records(registry).find(e => String(e.id) === id) : undefined
      if (found) return ['title', 'name'].map(f => fullLevel(tree.policy, registry, found, f))
      if (!deps.store) return [NOBODY]
      const kept = tree.levels.priv.records(registry).find(r => r.id === id)
      return kept ? [levelOfToken(kept.visibility), ...['title', 'name'].map(f => fullLevel(tree.policy, registry, kept.body, f))] : []
    },
  })
}

/** The body as it is written into a page at `level`: §4.5's labels, or 422 CANNOT_LINK. */
export function guarded(repo: string, deps: WriteDeps, body: string, level: ParsedLevel): string {
  const out = guardPageRefs(body, level, { repo, store: deps.store, why: deps.why })
  if (out.refused !== null) throw new Refusal(422, { code: 'CANNOT_LINK', error: out.refused })
  return out.body
}

// ── writing ───────────────────────────────────────────────────────────────────────────────────────────

/** The store, or its 503 in L5's words. */
function needStore(deps: WriteDeps): PrivateStore {
  if (!deps.store) throw unavailable(deps.why)
  return deps.store
}
const storeWrite = async (store: PrivateStore, fn: () => Promise<void>) => { try { await fn() } catch (err) { throw unavailable(err, store) } }

/** A page's targets (§3.2) read from the whole tree, the store's pages included: a private page is judged at its tree. */
export function targetsIn(tree: Tree, id: string, parent: string | null): string[] {
  const read = (p: string) => (p === id ? { parent } : (tree.byId.get(p) ?? null))
  return pageTargets(id, ancestorsOf(id, read))
}

/** A private page's write applies at once, where the rule for its tree lets this actor write alone; raised, refused with
 *  the rule's sentence (a raised private page is staged through L5's private path, a carry). */
export function mayWritePrivate(repo: string, actor: KnownActor, lists: string[][]): void {
  const rule = effectiveRule(readRuleContext(repo, actor), ['workspace'], lists)
  if (!rule.direct) throw new Refusal(403, { reason: rule.sentence, error: rule.sentence })
}

type GitWrite = { commit: string } | { staged: true }

/** One workspace write of git files and records (§3.2, §3.4), judged at their targets: direct, one commit (its
 *  `Org-Change` is `change`, an editing session's id, else a new change id); raised, staged in the actor's change. The
 *  caller holds the repository's write lock. */
export async function commitOrStage(repo: string, actor: KnownActor, ops: StageOp[], message: string, notify?: WriteDeps['notify'], change?: string): Promise<GitWrite> {
  const classes = classesOf(ops, repo)
  const targets = targetsOfOps(ops, repo)
  const ctx = readRuleContext(repo, actor)
  const rule = effectiveRule(ctx, classes, targets)
  if (!rule.direct) {
    if (!rule.proposable) throw new Refusal(403, { reason: rule.sentence, error: rule.sentence })
    const changes = new ChangeStore(repo)
    const now = new Date().toISOString()
    const change = changes.load(actor.id) ?? { id: newChangeId(), actor: actor.id, created: now, updated: now, ops: [] }
    const { ops: staged, errors } = stage(repo, change.ops, ops)
    if (errors.length > 0) throw new StageRefusal(errors)
    changes.save({ ...change, ops: staged, updated: now })
    notify?.({ type: 'changes' })
    return { staged: true }
  }
  const hat = hatsActedUnder(ctx, classes, targets).join(', ')
  const { commit } = await applyOps(repo, ops, {
    message,
    trailers: { actor: actorTrailer(actor), change: change ?? newChangeId(), rule: ruleIds(ctx, classes, targets).map(id => `${id}/direct`).join(','), ...(hat !== '' ? { hat } : {}) },
    ident: commitIdent(actor),
    precheck: () => {
      const now = effectiveRule(readRuleContext(repo, actor), classes, targets)
      if (!now.direct) throw new Refusal(403, { reason: now.sentence, error: now.sentence })
    },
  })
  if (commit === null) throw new HttpError(409, UNCHANGED, 'UNCHANGED')
  return { commit }
}

/** A git page's file with `front` changed (its bytes kept where they are not, lib/workspace/pages.mjs `joinPage`); a front
 *  matter that cannot be read is refused in UNREADABLE_FRONT's words (Task 5), nothing written. */
function rewritten(repo: string, e: PageEntry, front: PageFront): FileOp {
  let text: string
  try { text = joinPage(front, e.markdown, e.text) } catch (err) {
    if ((err as { code?: unknown }).code === 'UNREADABLE_FRONT') throw new Refusal(422, { code: 'UNREADABLE_FRONT', error: (err as Error).message })
    throw err
  }
  const path = pagePath(e.id)
  return { op: 'file', path, text, base: fileBase(repo, path) }
}

/** The siblings in `parent` (null: the root), in order. */
const siblingsIn = (tree: Tree, parent: string | null, but?: string): PageEntry[] =>
  [...tree.byId.values()].filter(e => e.parent === parent && e.id !== but).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

/** The level a body asks for: undefined/null inherits; a level token, else 422. */
function askedLevel(raw: unknown): ParsedLevel | null {
  if (raw === undefined || raw === null) return null
  const l = typeof raw === 'string' ? parseLevel(raw) : null
  if (!l) throw new Refusal(422, { code: 'NOT_A_LEVEL', error: NOT_A_LEVEL(String(raw)) })
  return l
}

export const sizeOk = (text: string): void => {
  const n = Buffer.byteLength(text, 'utf8')
  if (n > PAGE_MAX_BYTES) throw new HttpError(413, PAGE_TOO_BIG(n), 'TOO_BIG')
}

/** A new id no page holds. */
function freshId(tree: Tree, title: string, where: 'git' | 'private'): string {
  for (;;) { const id = newPageId(title, where); if (!tree.byId.has(id)) return id }
}

/** L6 carries K5's tail (PF-R110): a store page the tree is about to write (moved, renumbered or removed) whose move into
 *  the repository an open proposal holds refuses the whole write, 409 `MOVE_HELD` in the move's words, before anything is
 *  written; the write would leave the move stale (PRIVATE_STALE at ratify). */
function refuseHeldPages(store: PrivateStore, ids: Iterable<string>): void {
  for (const id of ids) {
    const proposal = heldMove(store, 'pages', id)
    if (proposal !== null) throw new Refusal(409, { code: 'MOVE_HELD', error: MOVE_PROPOSED('page', proposal) })
  }
}

/**
 * One page write (§4, §16): create, move or remove, as `actor`, judged with `viewer` (rule 7: a page they may not see is
 * the 404 of one that is not there). A git page is a workspace write (one commit, or staged under a raised tree); a private
 * page a store write and no commit. The caller holds the repository's write lock.
 */
export async function pageWrite(repo: string, actor: KnownActor, viewer: Viewer, act: PageAct, deps: WriteDeps):
  Promise<{ id: string; commit: string | null } | { id: string; staged: true }> {
  const tree = treeOf(repo, deps.store)
  if (act.kind === 'create') return create(repo, actor, viewer, act, deps, tree)
  if (act.kind === 'move') return move(repo, actor, viewer, act, deps, tree)
  return remove(repo, actor, viewer, act, deps, tree)
}

async function create(repo: string, actor: KnownActor, viewer: Viewer, act: Extract<PageAct, { kind: 'create' }>, deps: WriteDeps, tree: Tree) {
  const parent = act.parent ?? null
  if (parent !== null) visiblePage(tree, parent, viewer)
  const asked = askedLevel(act.visibility)
  const parentLevel = parent === null ? null : levelIn(tree, parent)
  if (asked && parentLevel && !narrowerOrEqual(asked, parentLevel)) {
    throw new Refusal(409, { code: 'LOOSER_THAN_PARENT', error: LOOSER_THAN_PARENT(formatLevel(parentLevel)) })
  }
  const level = asked ?? parentLevel ?? fullLevel(tree.policy, 'pages', null)
  if (!admits(level, viewer)) throw new Refusal(403, { code: 'NOT_ADMITTED', error: NOT_ADMITTED(formatLevel(level)) })
  const body = guarded(repo, deps, act.markdown ?? '', level)
  const last = siblingsIn(tree, parent).at(-1)
  const order = orderBetween(last?.order ?? null, null) as number
  const title = act.title
  if (gitAllows(level)) {
    const id = freshId(tree, title, 'git')
    const front: PageFront = { id, title, parent, order, ...(asked ? { visibility: formatLevel(asked) as 'public' } : {}), ...(act.meeting ? { meeting: act.meeting } : {}) }
    const text = joinPage(front, body)
    sizeOk(text)
    const out = await commitOrStage(repo, actor, [{ op: 'file', path: pagePath(id), text, base: null }], `page: ${title}`, deps.notify)
    return 'staged' in out ? { id, staged: true as const } : { id, commit: out.commit }
  }
  const store = needStore(deps)
  const id = freshId(tree, title, 'private')
  sizeOk(body)
  mayWritePrivate(repo, actor, [targetsIn(tree, id, parent)])
  const record = { title, parent, order, ...(act.meeting ? { meeting: act.meeting } : {}), markdown: body }
  await storeWrite(store, () => store.putRecord({ collection: 'pages', id, visibility: formatLevel(level), body: record, rev: baseOf(record) ?? '' }, actor.id, null))
  return { id, commit: null }
}

async function move(repo: string, actor: KnownActor, viewer: Viewer, act: Extract<PageAct, { kind: 'move' }>, deps: WriteDeps, tree: Tree) {
  const e = visiblePage(tree, act.id, viewer)
  const parent = act.parent ?? null
  if (parent !== null) {
    visiblePage(tree, parent, viewer)
    if (parent === e.id || descendantsOf(e.id, tree.byId).includes(parent)) throw new Refusal(409, { code: 'INTO_ITSELF', error: INTO_ITSELF })
  }
  // The tree as the move leaves it: no page in it looser than its parent, and no git page under a private one.
  const after = new Map(tree.byId)
  after.set(e.id, { ...e, parent })
  const moved = [e.id, ...descendantsOf(e.id, after)]
  for (const id of moved) {
    const looser = looserThanParent(id, after, tree.policy)
    if (looser !== null) throw new Refusal(409, { code: 'LOOSER_THAN_PARENT', error: LOOSER_THAN_PARENT(looser) })
  }
  // DAO-OS L6 Task 8 (controller ruling R-7c): a move that makes a git page stricter is judged as a narrowing is. Below
  // members (a git page put under a private one, its own level inherited), it leaves git by the narrowing's own path.
  const leaves = e.where === 'git' && !gitAllows(pageLevel(e.id, after, tree.policy))
  if (!leaves) {
    for (const id of moved) {
      if (after.get(id)!.where === 'git' && !gitAllows(pageLevel(id, after, tree.policy))) {
        throw new Refusal(409, { code: 'LOOSER_THAN_PARENT', error: LOOSER_THAN_PARENT(formatLevel(pageLevel(id, after, tree.policy))) })
      }
    }
    // Still in git, but stricter: another git page that would now name it by its title refuses the move (R-7a's check).
    const ids = new Set(moved)
    const was = new Set(labelledLinks(tree.byId, ids, d => pageLevel(d, tree.byId, tree.policy), tree.policy))
    const naming = labelledLinks(after, ids, d => pageLevel(d, after, tree.policy), tree.policy).filter(n => !was.has(n))
    if (naming.length > 0) throw new Refusal(409, { code: 'REFERRED', error: NAMED_BY(naming.map(n => tree.byId.get(n)!.title || n)) })
  }
  // Its order: the mean of its neighbours there; the siblings renumbered 1000, 2000, … when they are too close (§4.1).
  const siblings = siblingsIn(tree, parent, e.id)
  let at = siblings.length
  if (act.before !== undefined) {
    at = siblings.findIndex(s => s.id === act.before)
    if (at < 0 || !admits(levelIn(tree, act.before), viewer)) throw new Refusal(422, { code: 'NOT_A_SIBLING', error: NOT_A_SIBLING(act.before) })
  }
  const between = orderBetween(siblings[at - 1]?.order ?? null, siblings[at]?.order ?? null)
  const orders = between === 'renumber'
    ? renumbered([...siblings.slice(0, at), e, ...siblings.slice(at)], e.id, s => s.id !== e.id && s.where === 'store' && !mayRenumber(repo, actor, viewer, tree, s))
    : new Map([[e.id, between]])

  const lists = [targetsIn(tree, e.id, e.parent), targetsIn(tree, e.id, parent)]
  if (leaves) return moveOutOfGit(repo, actor, viewer, deps, e, parent, pageLevel(e.id, after, tree.policy), orders, lists)
  const gitOps: FileOp[] = []
  const storeOps: PrivateRecord[] = []
  for (const [id, order] of orders) {
    const s = tree.byId.get(id)!
    const nextParent = id === e.id ? parent : s.parent
    if (s.where === 'git') gitOps.push(rewritten(repo, s, { ...s.front!, parent: nextParent, order }))
    else {
      const store = needStore(deps)
      let kept: PrivateRecord | null
      try { kept = store.record('pages', id) } catch (err) { throw unavailable(err, store) }
      if (!kept) continue
      const body = { ...kept.body, parent: nextParent, order }
      storeOps.push({ ...kept, body, rev: baseOf(body) ?? '' })
    }
  }
  if (e.where === 'store') mayWritePrivate(repo, actor, lists)
  if (storeOps.length > 0) refuseHeldPages(needStore(deps), storeOps.map(r => r.id))
  let out: { commit: string | null } | { staged: true } = { commit: null }
  if (gitOps.length > 0) {
    out = await commitOrStage(repo, actor, gitOps, gitOps.length === 1 ? `page: ${tree.byId.get(e.id)!.title}` : `pages: ${gitOps.length} pages`, deps.notify)
  }
  if (!('staged' in out) && storeOps.length > 0) {
    const store = needStore(deps)
    for (const r of storeOps) await storeWrite(store, () => store.putRecord(r, actor.id, null))
  }
  return 'staged' in out ? { id: e.id, staged: true as const } : { id: e.id, commit: out.commit }
}

/** The final review's I-1 (PF-R115): a store sibling a renumbering may write. One the viewer is not admitted to (rule 7:
 *  it is not there for them), or whose tree's rule does not let this actor write alone, is kept where it is: the rest are
 *  renumbered around it. A held one the viewer may read is still written, and refused MOVE_HELD in the move's words. */
function mayRenumber(repo: string, actor: KnownActor, viewer: Viewer, tree: Tree, s: PageEntry): boolean {
  if (!admits(levelIn(tree, s.id), viewer)) return false
  try { mayWritePrivate(repo, actor, [targetsIn(tree, s.id, s.parent)]) } catch { return false }
  return true
}

/** §4.1's renumbering, around the siblings `pinned` keeps (I-1, PF-R115): the others, in `placed`'s order, take ORDER_STEP
 *  multiples where they fit, else evenly spaced values between the kept orders on either side (gaps are fine). Only an
 *  order that changes is returned, `moved`'s always. No room (two neighbours closer than ORDER_EPSILON): 409 NO_ROOM. */
function renumbered(placed: PageEntry[], moved: string, pinned: (s: PageEntry) => boolean): Map<string, number> {
  const orders = new Map<string, number>()
  const room = () => new Refusal(409, { code: 'NO_ROOM', error: NO_ROOM })
  let lo: number | null = null
  let run: PageEntry[] = []
  const place = (hi: number | null) => {
    const k = run.length
    if (k === 0) return
    let values: number[]
    if (lo === null && hi === null) values = run.map((_, i) => ORDER_STEP * (i + 1))
    else if (hi === null) {
      let base = Math.floor(lo! / ORDER_STEP) * ORDER_STEP
      if (base + ORDER_STEP - lo! < ORDER_EPSILON) base += ORDER_STEP
      values = run.map((_, i) => base + ORDER_STEP * (i + 1))
    } else if (lo === null) {
      let top = (Math.ceil(hi / ORDER_STEP) - 1) * ORDER_STEP
      if (hi - top < ORDER_EPSILON) top -= ORDER_STEP
      values = run.map((_, i) => top - ORDER_STEP * (k - 1 - i))
    } else {
      const from = lo, step = (hi - from) / (k + 1)
      values = run.map((_, i) => from + step * (i + 1))
    }
    const all = [lo, ...values, hi]
    for (let i = 1; i < all.length; i++) {
      const [a, b] = [all[i - 1], all[i]]
      if (a !== null && b !== null && !(b - a >= ORDER_EPSILON)) throw room()
    }
    run.forEach((s, i) => { if (s.id === moved || s.order !== values[i]) orders.set(s.id, values[i]!) })
    run = []
  }
  for (const s of placed) {
    if (pinned(s)) { place(s.order); lo = s.order } else run.push(s)
  }
  place(null)
  return orders
}

/** R-7c: a git page moved under a private one leaves git as a narrowing to the level it inherits there does (§4.4: with its
 *  git subpages, in one commit, `Org-Rule: visibility/narrow`; refused while another git page names it by its title, or an
 *  open proposal edits it; a closed proposal's file op on it held as a placeholder); then, in the store, it takes its new
 *  parent and order, its private siblings renumbered as a move renumbers them. Judged first as the private page it becomes. */
async function moveOutOfGit(repo: string, actor: KnownActor, viewer: Viewer, deps: WriteDeps, e: PageEntry, parent: string | null,
  level: ParsedLevel, orders: ReadonlyMap<string, number>, lists: string[][]): Promise<{ id: string; commit: string | null }> {
  const store = needStore(deps)
  mayWritePrivate(repo, actor, lists)
  refuseHeldPages(store, [...orders.keys()].filter(id => id !== e.id))
  const out = await narrow(repo, actor, { target: { page: e.id }, level: formatLevel(level) }, { viewer, privateStore: storeAccess(store, '') })
  for (const [id, order] of orders) {
    let kept: PrivateRecord | null
    try { kept = store.record('pages', id) } catch (err) { throw unavailable(err, store) }
    if (!kept) continue
    const body = { ...kept.body, ...(id === e.id ? { parent } : {}), order }
    await storeWrite(store, () => store.putRecord({ ...kept!, body, rev: baseOf(body) ?? '' }, actor.id, null))
  }
  return { id: e.id, commit: out.commit }
}

/** The files of a git page's attachments (`pages/assets/<id>/…`). */
function assetsOf(repo: string, id: string): string[] {
  const dir = join(repo, 'pages', 'assets', id)
  const walk = (rel: string): string[] => {
    let names: { name: string; isDirectory: () => boolean }[]
    try { names = readdirSync(join(repo, rel), { withFileTypes: true }) } catch { return [] }
    return names.flatMap(n => (n.isDirectory() ? walk(`${rel}/${n.name}`) : [`${rel}/${n.name}`]))
  }
  return existsSync(dir) ? walk(`pages/assets/${id}`) : []
}

async function remove(repo: string, actor: KnownActor, viewer: Viewer, act: Extract<PageAct, { kind: 'remove' }>, deps: WriteDeps, tree: Tree) {
  const e = visiblePage(tree, act.id, viewer)
  const kids = childrenOf(e.id, tree.byId)
  if (kids.length > 0) {
    // Rule 7: a number only when every subpage is one the viewer may see (as the collections' removal, R-3a).
    const seen = kids.filter(k => admits(levelIn(tree, k), viewer)).length
    throw new Refusal(409, { code: 'HAS_SUBPAGES', error: seen < kids.length ? HAS_HIDDEN_SUBPAGES : HAS_SUBPAGES(kids.length) })
  }
  if (e.where === 'git') {
    const ops: FileOp[] = [pagePath(e.id), ...assetsOf(repo, e.id)].map(path => ({ op: 'file', path, text: null, base: fileBase(repo, path) }))
    const out = await commitOrStage(repo, actor, ops, `page: ${e.title}`, deps.notify)
    return 'staged' in out ? { id: e.id, staged: true as const } : { id: e.id, commit: out.commit }
  }
  const store = needStore(deps)
  mayWritePrivate(repo, actor, [targetsIn(tree, e.id, e.parent)])
  refuseHeldPages(store, [e.id])
  await storeWrite(store, () => store.deleteRecord('pages', e.id, actor.id, null))
  return { id: e.id, commit: null }
}

/**
 * Record a meeting (§7.2): the meeting record (with `notes`, its notes page's id) and its notes page (`meeting: <id>` in
 * its front matter, under the page `collections.meetings.notes_parent` names, else at the root) in one workspace write.
 * A notes parent that is not a git page the viewer may see puts the page at the root.
 */
export async function recordMeeting(repo: string, actor: KnownActor, viewer: Viewer, m: { title: string; date: string; type?: string }, deps: WriteDeps = { store: null }):
  Promise<{ meeting: string; page: string; commit: string | null; staged?: true }> {
  const tree = treeOf(repo, deps.store)
  const named = gitDefinitions(repo).collections.find(d => d.id === 'meetings')?.notes_parent
  const parent = typeof named === 'string' && tree.byId.get(named)?.where === 'git' && admits(levelIn(tree, named), viewer)
    && gitAllows(levelIn(tree, named)) ? named : null
  let ids: Set<string>
  try { ids = new Set(currentEntries(repo, 'meetings').map(e => String(e.id))) } catch { ids = new Set() }
  const base = slugOf(`${m.date} ${m.title}`)
  let meeting = base
  for (let n = 2; ids.has(meeting); n++) meeting = `${base}-${n}`
  const page = freshId(tree, m.title, 'git')
  const order = orderBetween(siblingsIn(tree, parent).at(-1)?.order ?? null, null) as number
  const text = joinPage({ id: page, title: m.title, parent, order, meeting }, '')
  const value = { id: meeting, title: m.title, date: m.date, ...(m.type ? { type: m.type } : {}), notes: page }
  const out = await commitOrStage(repo, actor, [{ op: 'create', record: `meetings:${meeting}`, value }, { op: 'file', path: pagePath(page), text, base: null }],
    `meetings: ${m.title}`, deps.notify)
  return 'staged' in out ? { meeting, page, commit: null, staged: true } : { meeting, page, commit: out.commit }
}

const ASSET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/**
 * An attachment of a git page (§4.1): `pages/assets/<page id>/<name>`, at most ASSET_MAX_BYTES, class workspace, one commit
 * under the page's tree. A private page holds none (409 NO_PRIVATE_ASSETS); one under a raised tree cannot be staged yet
 * (its bytes are no file op's text). The caller holds the repository's write lock.
 */
export async function putAsset(repo: string, actor: KnownActor, page: string, a: { name: string; data: string },
  ctx: { viewer: Viewer; store: PrivateStore | null } = { viewer: { kind: 'public' }, store: null }): Promise<{ path: string; commit: string | null }> {
  const tree = treeOf(repo, ctx.store)
  const e = visiblePage(tree, page, ctx.viewer)
  if (e.where === 'store') throw new Refusal(409, { code: 'NO_PRIVATE_ASSETS', error: NO_PRIVATE_ASSETS(formatLevel(levelIn(tree, page))) })
  if (!ASSET_NAME_RE.test(a.name)) throw new Refusal(422, { code: 'ASSET_NAME', error: ASSET_NAME })
  if (!BASE64.test(a.data)) throw new HttpError(400, ASSET_BODY)
  const bytes = Buffer.from(a.data, 'base64')
  if (bytes.length > ASSET_MAX_BYTES) throw new HttpError(413, ASSET_TOO_BIG(bytes.length), 'TOO_BIG')
  const rel = `pages/assets/${page}/${a.name}`
  assertWritablePath(repo, rel)
  const lists = [targetsIn(tree, page, e.parent)]
  const ctxRule = readRuleContext(repo, actor)
  const rule = effectiveRule(ctxRule, ['workspace'], lists)
  if (!rule.direct) throw new Refusal(403, { reason: rule.proposable ? ASSET_RAISED : rule.sentence, error: rule.proposable ? ASSET_RAISED : rule.sentence })
  await guardFiles(repo, [rel])
  const abs = join(repo, rel)
  const before = existsSync(abs) ? readFileSync(abs) : null
  const hat = hatsActedUnder(ctxRule, ['workspace'], lists).join(', ')
  try {
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, bytes)
    const commit = await commitPaths(repo, [rel], `page: ${e.title}`, {
      actor: actorTrailer(actor), change: newChangeId(), rule: ruleIds(ctxRule, ['workspace'], lists).map(id => `${id}/direct`).join(','), ...(hat !== '' ? { hat } : {}),
    }, { ident: commitIdent(actor) })
    return { path: rel, commit }
  } catch (err) {
    if (before) writeFileSync(abs, before); else rmSync(abs, { force: true })
    await restageDataPaths(repo, [rel]).catch(() => {})
    throw new HttpError(503, `Not saved: git refused the commit to ${rel} (${(err instanceof Error ? err.message : String(err)).split('\n')[0]}). Nothing was changed in the files.`)
  }
}

// ── a page edited whole: §4's checks for the file op (§11.2; preflight row 26, Task 4's hook) ──────────────────────

const PAGE_FILE = /^pages\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.md$/

/**
 * The checks a file op on `pages/<id>.md` passes, at stage and again at apply: at most PAGE_MAX_BYTES; nothing stricter than
 * members in git (its own `visibility` public or members, its parent no private page); no page looser than its parent, it
 * or a subpage whose level it changes; and §4.5's labels (a link to a stricter page labelled ↗). A delete of a page that
 * holds subpages is refused with HAS_SUBPAGES. As Task 4's checks do, only what the op brings is refused: a problem the
 * page already holds is not refused again. The store is not read here: a private collection's record is judged by the page
 * routes, which hold it.
 */
export function pageFileErrors(repo: string, op: FileOp): RecordError[] {
  const m = PAGE_FILE.exec(op.path)
  if (!m) return []
  const id = m[1]!
  const all = gitPages(repo)
  const others = all.filter(p => p.id !== id)
  if (op.text === null) {
    const kids = childrenOf(id, pageEntries(others, []))
    return kids.length > 0 ? [{ record: op.path, field: '', message: HAS_SUBPAGES(kids.length) }] : []
  }
  const bytes = Buffer.byteLength(op.text, 'utf8')
  if (bytes > PAGE_MAX_BYTES) return [{ record: op.path, field: 'text', message: PAGE_TOO_BIG(bytes).replace('Nothing was written.', 'Nothing was staged.') }]
  const policy = readConfig(repo)
  const was = all.find(p => p.id === id)
  const key = (e: RecordError) => `${e.record}\u0000${e.field}\u0000${e.message}`
  const known = new Set(was ? pageChecks(op.path, id, all, policy).map(key) : [])
  return pageChecks(op.path, id, [...others, { id, text: op.text }], policy).filter(e => !known.has(key(e)))
}

/** §4's checks of page `id` in the git pages `pages` (pageFileErrors reads them before and after the op). */
function pageChecks(path: string, id: string, pages: { id: string; text: string }[], policy: VisibilityPolicy): RecordError[] {
  const no = (field: string, message: string): RecordError[] => [{ record: path, field, message }]
  const byId = pageEntries(pages, [])
  const e = byId.get(id)!
  const own = e.front?.visibility
  if (own !== undefined && own !== null && own !== 'public' && own !== 'members') return no('visibility', RESTRICTED_PAGE(path, String(own)))
  if (e.parent !== null && !byId.has(e.parent) && PRIVATE_PAGE_ID.test(e.parent)) return no('parent', PRIVATE_PARENT(path))
  const errors: RecordError[] = []
  for (const at of [id, ...descendantsOf(id, byId)]) {
    const looser = looserThanParent(at, byId, policy)
    if (looser !== null) errors.push({ record: pagePath(at), field: 'visibility', message: LOOSER_THAN_PARENT(looser) })
  }
  if (errors.length > 0) return errors
  const g = guardRefs(e.markdown, pageLevel(id, byId, policy), { pageLevel: p => (byId.has(p) ? pageLevel(p, byId, policy) : null), collectionLevel: () => null })
  if (g.refused !== null) return no('text', `Not staged: ${g.refused} Nothing was staged.`)
  if (g.body !== e.markdown) return no('text', STRICT_LINK_IN_FILE(path))
  return []
}
registerFileCheck(pageFileErrors)

// ── routes ──────────────────────────────────────────────────────────────────────────────────────────

async function body(c: Context): Promise<unknown> {
  try { return await c.req.json() } catch { return undefined }
}

/** The git subpages of git page `e` that its file given `visibility: public` would make public with it (Task 20 review
 *  I2): `pagesMadePublic` over the git pages as they are, the page itself not counted. A front matter that cannot be
 *  written counts none. */
export function subpagesMadePublic(repo: string, e: PageEntry): number {
  let text: string
  try { text = joinPage({ ...(e.front as PageFront), visibility: 'public' }, e.markdown, e.text) } catch { return 0 }
  return pagesMadePublic(gitPages(repo), e.id, text, readConfig(repo)).filter(p => p !== e.id).length
}

/** The page as `actor`'s own change holds it (its file op on `path`): the title and body, or null (none, a deletion, a
 *  front matter that does not read, no known actor). The walk's G5. */
function stagedPage(repo: string, actor: ReturnType<typeof actorOf>, path: string): { title?: string; markdown: string } | null {
  if (!actor || !isKnown(actor)) return null
  let text: string | undefined
  try { text = pendingText(new ChangeStore(repo).load(actor.id)?.ops ?? [], path) } catch { return null }
  if (text === undefined) return null
  try {
    const { front, body } = splitPage(text)
    return { ...(typeof front.title === 'string' && front.title !== '' ? { title: front.title } : {}), markdown: body }
  } catch { return null }
}

/** How the viewer may write a page (§16): at once, by approval, or not at all; and the rule that says so. */
function writeMode(repo: string, c: Context, tree: Tree, e: PageEntry): { mode: 'direct' | 'approval' | 'none'; rule: RuleSummary | null } {
  const actor = actorOf(c)
  if (viewerOf(c).kind !== 'member' || !actor || !isKnown(actor)) return { mode: 'none', rule: null }
  const rule = effectiveRule(readRuleContext(repo, actor), ['workspace'], [targetsIn(tree, e.id, e.parent)])
  return { mode: rule.direct ? 'direct' : rule.proposable ? 'approval' : 'none', rule }
}

export function mountPages(app: Hono, deps: PagesDeps): void {
  const { repo, withLock, privateStore } = deps
  const writeDeps = (): WriteDeps => { const { store, why } = reach(privateStore); return { store, why, notify: deps.notify } }

  // Walk M7: a write in flight (a narrowing deletes a page's files, then commits the store's transaction around the git
  // commit) leaves a page in neither place for a moment; a read waits for the writes queued before it (an empty turn of
  // the one write lock), so it never answers 404 for a page that is only moving.
  const settled = () => withLock(async () => undefined)

  // Walk I9: asked with `?write`, for a known member, each page says how their write under it goes (`write`, the page's own
  // mode, Q77's predicate at its tree), so Move to… offers only parents they may read and write; anyone else, and a preview
  // (`?as`), is given none. Without it, the list is what every reader is given (a preview's answer equals that viewer's).
  app.get('/api/pages', async c => {
    await settled()
    const store = reach(privateStore).store
    const viewer = viewerOf(c)
    const nodes = readPages(repo, store, viewer)
    const actor = actorOf(c)
    if (c.req.query('write') === undefined || viewer.kind !== 'member' || !actor || !isKnown(actor) || c.req.query('as') !== undefined) return c.json(nodes)
    const tree = treeOf(repo, store)
    const ctx = readRuleContext(repo, actor)
    return c.json(nodes.map(n => {
      const e = tree.byId.get(n.id)
      if (!e) return n
      const rule = effectiveRule(ctx, ['workspace'], [targetsIn(tree, e.id, e.parent)])
      return { ...n, write: rule.direct ? 'direct' : rule.proposable ? 'approval' : 'none' }
    }))
  })

  app.get('/api/pages/:id', async c => {
    await settled()
    const id = c.req.param('id')
    const viewer = viewerOf(c)
    const store = reach(privateStore).store
    const tree = treeOf(repo, store)
    const e = visiblePage(tree, id, viewer)
    let edited: { at: string; by: string } | null = null
    // walk fix wave 4 (G9: W1): who edited it is the commit's Org-Actor (or the store's actor), said as a display name
    const display = displayNames(repo, deps.membership ?? null, { viewer })
    if (e.where === 'git') edited = await lastCommit(repo, pagePath(id), display)
    else {
      try { const h = store?.history(`pages/${id}`).at(-1); edited = h ? { at: h.at, by: display(h.by) } : null } catch { edited = null }
    }
    // As the tree shows it (readPages): a parent that is missing, loops, or is one the viewer may not see is not named.
    const stale = e.parent !== null && (staleOf(id, tree.byId) !== null || !admits(levelIn(tree, e.parent), viewer))
    // §10 (Task 14): the page header's from mark; the public is given none.
    const fromMark = await fromOf({ page: id, from: e.from }, { repo, store, reads: {}, viewer, levels: tree.levels })
    // Task 20 review I2 (PF-R97): for a member, the git subpages a widening of this git page to public makes public with it
    // (those that take its level), so the bar says what it exposes before it stages. Every member reads a git page.
    const widens = e.where === 'git' && viewer.kind === 'member' && levelIn(tree, id).level !== 'public' ? subpagesMadePublic(repo, e) : undefined
    // The walk's I4 (G5): a git page reads, for the member who staged an edit of it, as their change holds it (its title and
    // body; the op keeps its base); anyone else, and a preview (`?as`), reads the trunk.
    const mine = e.where === 'git' && c.req.query('as') === undefined ? stagedPage(repo, actorOf(c), pagePath(id)) : null
    return c.json({
      page: {
        id, title: mine?.title ?? e.title, parent: stale ? null : e.parent, path: e.where === 'git' ? pagePath(id) : null, visibility: formatLevel(levelIn(tree, id)),
        markdown: mine?.markdown ?? e.markdown, edited, ...(e.from !== undefined ? { from: e.from } : {}), ...(fromMark ? { fromMark } : {}),
        ...(stale ? { stale: 'missing-parent' } : {}), ...(widens !== undefined ? { widens } : {}),
      },
      write: writeMode(repo, c, tree, e),
      backlinks: backlinks(repo, id, viewer, store),
    })
  })

  app.post('/api/pages', async c => {
    const raw = await body(c)
    if (!isObj(raw) || typeof raw.title !== 'string' || (raw.parent !== undefined && raw.parent !== null && typeof raw.parent !== 'string')
      || (raw.markdown !== undefined && typeof raw.markdown !== 'string') || (raw.meeting !== undefined && typeof raw.meeting !== 'string')) throw new HttpError(400, BODY)
    return withLock(async () => {
      const out = await pageWrite(repo, knownActorOf(c), viewerOf(c), {
        kind: 'create', title: raw.title as string, parent: (raw.parent as string | null | undefined) ?? null,
        ...(raw.visibility !== undefined ? { visibility: raw.visibility as string } : {}),
        ...(raw.markdown !== undefined ? { markdown: raw.markdown as string } : {}), ...(raw.meeting !== undefined ? { meeting: raw.meeting as string } : {}),
      }, writeDeps())
      return c.json(out, 201)
    })
  })

  app.post('/api/pages/:id/move', async c => {
    const raw = await body(c)
    if (!isObj(raw) || !Object.hasOwn(raw, 'parent') || (raw.parent !== null && typeof raw.parent !== 'string')
      || (raw.before !== undefined && typeof raw.before !== 'string')) throw new HttpError(400, MOVE_BODY)
    return withLock(async () => c.json(await pageWrite(repo, knownActorOf(c), viewerOf(c), {
      kind: 'move', id: c.req.param('id'), parent: raw.parent as string | null, ...(raw.before !== undefined ? { before: raw.before as string } : {}),
    }, writeDeps())))
  })

  app.delete('/api/pages/:id', c => withLock(async () => c.json(await pageWrite(repo, knownActorOf(c), viewerOf(c), { kind: 'remove', id: c.req.param('id') }, writeDeps()))))

  app.post('/api/pages/:id/assets', async c => {
    const raw = await body(c)
    if (!isObj(raw) || typeof raw.name !== 'string' || typeof raw.data !== 'string') throw new HttpError(400, ASSET_BODY)
    return withLock(async () => c.json(await putAsset(repo, knownActorOf(c), c.req.param('id'), { name: raw.name as string, data: raw.data as string },
      { viewer: viewerOf(c), store: reach(privateStore).store }), 201))
  })

  app.post('/api/meetings', async c => {
    const raw = await body(c)
    if (!isObj(raw) || typeof raw.title !== 'string' || raw.title.trim() === '' || typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date)
      || (raw.type !== undefined && typeof raw.type !== 'string')) throw new HttpError(400, MEETING_BODY)
    return withLock(async () => c.json(await recordMeeting(repo, knownActorOf(c), viewerOf(c),
      { title: raw.title as string, date: raw.date as string, ...(raw.type !== undefined ? { type: raw.type as string } : {}) }, writeDeps()), 201))
  })
}
