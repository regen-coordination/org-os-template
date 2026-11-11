// packages/admin/server/workspace/sessions.ts
//
// Editing sessions (DAO-OS L6 spec §6, §16): one commit per session. Opening a page to edit opens a session `{ id: ses_<hex>,
// page, actor, base, opened }`, `base` the blob id of the file at HEAD (a private page: its store `rev`). Each save keeps the
// whole Markdown as the session's draft: a git page's in the admin state directory (`<state>/drafts/<ses>.json`, outside the
// repository), a private page's in the store's `drafts` (C-18); answered `{ save: 'direct' }` once durable. The session ends,
// and its draft becomes one commit (a private page: one store write, its history row, no commit), when it is closed, after
// PAGE_IDLE_MS without a save, after PAGE_MAX_MS (the next follows at once), when the server stops (`flushAll`), or at the
// next start for drafts a crash left (`reconcile`). An unchanged draft commits nothing. A save never runs beside its
// session's end (each session has its own lock): one that meets a timer's end waits, then lands in the session that follows
// (at PAGE_MAX_MS opened at once, idle opened by that save), whose base is the text the member's editor holds on the version
// just committed; after a close it is the 404 of a session that is not there. Never acknowledged, then lost.
//
// A newer version (HEAD's file is no longer the session's base) is merged three ways with `git merge-file -p` (git.ts
// `mergeThree`): clean, the merge is what the session commits; not clean, nothing is committed and the save state is
// `conflict` (409 CONFLICT, NEWER_VERSION, with Compare's base, theirs and mine). Keep mine commits the draft over theirs;
// Take theirs drops it. A private page has no merge: any change since `rev` is a conflict. Two sessions of one member on one
// page are two sessions, each with its own base: the second to end merges or reaches Compare, never overwrites.
//
// Under a raised tree each save stages a `file` op in the actor's change instead (one op per page, merged by `mergeFileOp`),
// answered `{ save: 'staged' }`; the session commits nothing. Every save passes `guardPageRefs` (§4.5) and PAGE_MAX_BYTES.
// The walk's I4 (review G5): a git page's session opens on the member's own staged text of the page when their change holds
// one (its base stays the op's), and each staged save says what it started from: where the change holds another text, the
// save is merged three ways over it (`overPending`), refused where both change the same lines, never a silent replacement.
// With the store down, git pages keep working; a private page's open answers the store's sentence (L5 §10.1).
//
//   POST /api/pages/:id/sessions          { session, base, markdown }
//   PUT  /api/sessions/:sid               { markdown, title? } → { save: 'direct' | 'staged' }; 409 CONFLICT { compare }
//   POST /api/sessions/:sid/close         { commit } | { staged: true }; 409 CONFLICT { conflict }
//   POST /api/sessions/:sid/resolve       { keep: 'mine' | 'theirs' } → { commit }
//   GET  /api/sessions/:sid/compare       { base, theirs, mine }
//   POST /api/sessions/:sid/suggest       (mounted with the proposal routes, server/proposals/routes.ts) → 201 the proposal
//
// Suggest (ruling R-L6-SUGGEST, Task 16b; R-L6-SUGGEST-2, Task 16c: everywhere): a session of a page its member may
// write ends as a proposal instead of in the tray or a commit. Under a raised tree the text is staged as the page's file
// op, as a raised save stages it, and that one op (the rest of the tray stays) is proposed; where the member saves the
// page directly, the session's draft is proposed as the page's file op and never committed. The caller proposes it through
// the proposal machinery Propose uses (`propose`, told it is a suggestion), under the repository's write lock; then the
// session ends. A private page cannot take a suggestion (409 PRIVATE_PAGE: L5's private path stages records, not a
// page's file op), and a page the member may no longer read is the 404.

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context, Hono } from 'hono'
import { HttpError } from '../errors.ts'
import type { KnownActor } from '../actor.ts'
import { knownActorOf, viewerOf } from '../request.ts'
import { effectiveRule, readRuleContext } from '../governance/effective.ts'
import { Refusal, StageRefusal } from '../changes/apply.ts'
import { refuseRevising } from '../changes/routes.ts'
import { baseOf } from '../changes/canonical.ts'
import { classesOf, stage, targetsOfOps } from '../changes/stage.ts'
import { ChangeStore, newChangeId } from '../changes/store.ts'
import type { Change, FileOp } from '../changes/types.ts'
import { mergeThree } from '../git.ts'
import { stateDir } from '../state.ts'
import { heldMove, MOVE_PROPOSED, NO_STORE, reach, unavailable, type PrivateAccess } from '../private/ops.ts'
import { StoreUnavailable, type PrivateStore } from '../private/store.ts'
import type { Viewer } from '../../lib/visibility.mjs'
import { joinPage, NO_PAGE, PRIVATE_PAGE_ID, splitPage, type PageFront } from '../../lib/workspace/pages.mjs'
import { blobId, fileText, overPending, pendingText } from './files.ts'
import { commitOrStage, guarded, levelIn, mayWritePrivate, pagePath, sizeOk, targetsIn, treeOf, visiblePage } from './pages.ts'

export { mergeThree }

/** The client sends the whole Markdown after this long without typing (§6). */
export const DRAFT_DEBOUNCE_MS = 800
/** A session ends after this long without a save (§6). */
export const PAGE_IDLE_MS = 60000
/** A session ends after this long whatever happens, and the next follows at once (§6). */
export const PAGE_MAX_MS = 1800000

// Copy (§6 gives NEWER_VERSION's words; the rest are this task's, rulings log Task 8).
export const NEWER_VERSION = 'Someone saved a newer version.'
export const NO_SESSION = (sid: string): string => `There is no editing session ${sid}.`
export const PAGE_GONE = 'This page was deleted, or left the repository, since the session opened, so the draft cannot be written over it. ' +
  'Copy what you need from Compare. Nothing was written.'
export const NO_CONFLICT = 'This session has no newer version to resolve: close it to save the draft. Nothing was written.'
// Suggest's words (Task 16b, R-L6-SUGGEST; rulings log).
/** The proposal's title the form starts from. */
export const suggestTitle = (pageTitle: string): string => `Suggested edit to ${pageTitle}`
export const SUGGEST_PRIVATE = 'A private page cannot take a suggestion yet. Nothing was proposed.'
export const SUGGEST_NOTHING = 'There is no edit to suggest: the page is as the repository holds it. Nothing was proposed.'
const SAVE_BODY = 'The body must be {"markdown", "title"?}.'
const KEEP_BODY = 'The body must be {"keep": "mine" or "theirs"}.'

/** One editing session (§6). `base`: the blob id of the text it started from (a private page: the store `rev`). */
export interface Session { id: string; page: string; actor: string; base: string; opened: string; updated: string }
/** Compare's three texts, each the page's Markdown (its body): as the session opened, as it is now, as the draft holds it. */
export interface Compare { base: string; theirs: string; mine: string }
export type CloseResult = { commit: string | null } | { staged: true } | { conflict: Compare }
export type SaveResult = { save: 'direct' | 'staged'; session?: string }
/** Runs `fn` once, `ms` from now; the answer cancels it. Tests pass a fake one with a fake clock. */
export type Schedule = (fn: () => void, ms: number) => () => void
/** What `onCommit` hears (Task 9 adds `more`: the text the session started from, and its author). */
export type CommitListener = (page: string, base: string, text: string, more: { baseText: string; by: string }) => void

export interface SessionDeps {
  /** The one private store, or the access to it (which throws why it cannot be reached), or none. */
  store: PrivateStore | null | PrivateAccess
  now?: () => Date
  idleMs?: number
  maxMs?: number
  schedule?: Schedule
  /** The repository's one write lock (app.ts); absent, one of this object's own. */
  withLock?: <T>(fn: () => Promise<T>) => Promise<T>
  /** Sent after a save that stages into a change, so every open tab refreshes its tray. */
  notify?: (msg: { type: 'changes' }) => void
}

export const newSessionId = (): string => `ses_${randomBytes(8).toString('hex')}`

const realSchedule: Schedule = (fn, ms) => {
  const t = setTimeout(fn, ms)
  t.unref?.()
  return () => clearTimeout(t)
}

/** A lock of one's own: each call runs after the one before has finished. */
export function ownLock(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn)
    chain = run.catch(() => {})
    return run
  }
}

const accessOf = (dep: SessionDeps['store']): PrivateAccess =>
  typeof dep === 'function' ? dep : () => { if (dep) return dep; throw new StoreUnavailable(NO_STORE) }

const logged = (what: string) => (err: unknown) =>
  console.error(`org-os admin: ${what}: ${err instanceof Error ? err.message : String(err)}`)

interface Draft { markdown: string; title?: string }

/** Where the next session of a page starts when this one ends on a timer (§6): the text the member's editor holds
 *  (`baseText`, `baseTitle`, what the merge reads as base), and `base`, the blob id of the page's file at HEAD then (a
 *  private page: its `rev`), a real version. */
interface Seed { who: KnownActor; page: string; where: 'git' | 'store'; baseText: string; baseTitle: string; base: string }

/** A session as this server holds it. `baseText`: what the member's editor started from (a git page's whole file, a private
 *  page's Markdown, its title in `baseTitle`): the merge's base. `conflict` is Compare as last shown, and `conflictAt` the
 *  version of theirs it showed (a blob id, a rev, or '' for a page that is gone or no longer the member's to read). `lock`:
 *  the session's own, so a save never runs beside its end. `over`: ended. `after`: where a following session starts. */
interface Live {
  s: Session
  who: KnownActor
  where: 'git' | 'store'
  baseText: string
  baseTitle: string
  draft: Draft | null
  staged: boolean
  conflict: Compare | null
  conflictAt: string | null
  idle: (() => void) | null
  max: (() => void) | null
  wrote: boolean
  over: boolean
  after: Omit<Seed, 'who' | 'page' | 'where'> | null
  lock: <T>(fn: () => Promise<T>) => Promise<T>
  /** The walk's G5: the text the member's change holds for the page (a git page's staged file op) when the session started,
   *  then the text each staged save left there; null for none. The editor starts from it (open lays it over the trunk), a
   *  draft is written over its front matter, and a staged save says it started from it (`overPending`, `mergeFileOp`). */
  stagedFrom: string | null
}

/** A git page's draft on disk (`<state>/drafts/<ses>.json`). */
interface DraftFile { session: Session; who: KnownActor; baseText: string; draft: Draft | null }
/** A private page's draft as the store's `drafts.body` holds it: the Markdown, the title when one was sent, and what the
 *  session started from (Compare's base). */
interface StoreDraftBody { markdown: string; title?: string; was: { markdown: string; title: string } }

export class EditSessions {
  private readonly access: PrivateAccess
  private readonly now: () => Date
  private readonly idleMs: number
  private readonly maxMs: number
  private readonly schedule: Schedule
  private readonly withLock: <T>(fn: () => Promise<T>) => Promise<T>
  private readonly notify: (msg: { type: 'changes' }) => void
  private readonly live = new Map<string, Live>()
  /** A session that ended on a timer → the one that followed it: a save sent to the first lands in the next. */
  private readonly next = new Map<string, string>()
  /** A session that ended idle → where the next starts, opened by the first save sent to it (the member came back). */
  private readonly seeds = new Map<string, Seed>()
  private readonly inflight = new Set<Promise<unknown>>()
  private readonly listeners: CommitListener[] = []

  constructor(private readonly repo: string, deps: SessionDeps) {
    this.access = accessOf(deps.store)
    this.now = deps.now ?? (() => new Date())
    this.idleMs = deps.idleMs ?? PAGE_IDLE_MS
    this.maxMs = deps.maxMs ?? PAGE_MAX_MS
    this.schedule = deps.schedule ?? realSchedule
    this.withLock = deps.withLock ?? ownLock()
    this.notify = deps.notify ?? (() => {})
  }

  /** Heard after each session's write: the page, the base it started from, and the text written (a private page: its
   *  Markdown). Task 9 tells page mentions here (preflight row 43): `more` holds the text the session started from
   *  (`baseText`, in the same form as `text`) and who wrote it (`by`). */
  onCommit(fn: CommitListener): void { this.listeners.push(fn) }

  // ── open, save ──────────────────────────────────────────────────────────────────────────────────

  async open(actor: KnownActor, viewer: Viewer, page: string): Promise<{ session: string; base: string; markdown: string }> {
    const { store, why } = reach(this.access)
    const tree = treeOf(this.repo, store)
    // A private page's id with the store down: the store's sentence, for any id of that shape (nothing is told by it).
    if (!store && PRIVATE_PAGE_ID.test(page) && !tree.byId.has(page)) throw unavailable(why)
    const e = visiblePage(tree, page, viewer)
    let seed: Seed
    if (e.where === 'git') {
      const text = fileText(this.repo, pagePath(page)) ?? e.text ?? ''
      seed = { who: actor, page, where: 'git', baseText: text, baseTitle: e.title, base: blobId(text) }
    } else {
      const s = store!
      let r
      try { r = s.record('pages', page) } catch (err) { throw unavailable(err, s) }
      if (!r) throw new HttpError(404, NO_PAGE(page))
      seed = { who: actor, page, where: 'store', baseText: String(r.body.markdown ?? ''), baseTitle: String(r.body.title ?? ''), base: r.rev }
    }
    const live = this.start(seed)
    // The walk's I4 (G5): the editor starts from the member's own staged edit of the page, never from the trunk under it.
    return { session: live.s.id, base: live.s.base, markdown: live.stagedFrom !== null ? splitPage(live.stagedFrom).body : e.markdown }
  }

  /** The draft saved (§6), as `actor`; with `viewer`, judged again on who they are now (§3.2: a page they may no longer read
   *  is the 404 of one that is not there). A save that meets its session's end waits for it, then lands in the session that
   *  follows (a timer's end), answered with that session's id; after a close it is the 404 of a session not there. */
  async save(sid: string, actor: KnownActor, body: { markdown: string; title?: string }, viewer?: Viewer): Promise<SaveResult> {
    if (typeof body?.markdown !== 'string' || (body.title !== undefined && typeof body.title !== 'string')) throw new HttpError(400, SAVE_BODY)
    return this.inSession(sid, actor, true, live => this.saveIn(sid, live, actor, body, viewer))
  }

  private async saveIn(sid: string, live: Live, actor: KnownActor, body: { markdown: string; title?: string }, viewer?: Viewer): Promise<SaveResult> {
    const { store, why } = reach(this.access)
    if (live.where === 'store' && !store) throw unavailable(why)
    const tree = treeOf(this.repo, store)
    const page = live.s.page
    if (viewer) visiblePage(tree, page, viewer)
    const level = levelIn(tree, page)
    const draft: Draft = { markdown: guarded(this.repo, { store, why }, body.markdown, level), ...(body.title !== undefined ? { title: body.title } : {}) }
    const moved = sid !== live.s.id ? { session: live.s.id } : {}
    if (live.where === 'store') {
      sizeOk(draft.markdown)
      mayWritePrivate(this.repo, actor, [targetsIn(tree, page, tree.byId.get(page)?.parent ?? null)])
      live.draft = draft
      live.s.updated = this.now().toISOString()
      await this.putStoreDraft(store!, live)
      this.touch(live)
      let now
      try { now = store!.record('pages', page) } catch (err) { throw unavailable(err, store) }
      if (!now || now.rev !== live.s.base) this.refuseNewer(live, String(now?.body.markdown ?? ''), now?.rev ?? '')
      live.conflict = null
      return { save: 'direct', ...moved }
    }
    const text = this.mineOf(live, draft)
    sizeOk(text)
    const path = pagePath(page)
    const theirs = fileText(this.repo, path)
    const rule = effectiveRule(readRuleContext(this.repo, actor), classesOf([{ op: 'file', path, text, base: null }], this.repo),
      targetsOfOps([{ op: 'file', path, text, base: null }], this.repo))
    if (!rule.direct) {
      if (!rule.proposable) throw new Refusal(403, { reason: rule.sentence, error: rule.sentence })
      // Staged on the version that is there now: a newer one is merged first (or is Compare), so a staged op never undoes it.
      let staged = text
      if (theirs !== live.baseText) {
        const merged = theirs === null ? { clean: false as const } : await mergeThree(this.repo, live.baseText, theirs, text)
        if (!merged.clean) { live.draft = draft; this.refuseNewer(live, theirs === null ? '' : splitPage(theirs).body, theirs === null ? '' : blobId(theirs)) }
        staged = merged.text
      }
      // What the staged text started from (G5): the change's text the editor opened on or last staged, else the trunk.
      const from = live.stagedFrom ?? theirs ?? ''
      live.stagedFrom = await this.withLock(async () => this.stageFile(actor, { op: 'file', path, text: staged, base: theirs === null ? null : blobId(theirs) }, from))
      live.staged = true
      live.draft = null
      rmSync(this.draftFile(live.s.id), { force: true })
      this.touch(live)
      return { save: 'staged', ...moved }
    }
    live.draft = draft
    live.s.updated = this.now().toISOString()
    this.writeDraftFile(live)
    this.touch(live)
    // A newer version: merged now, to say whether it can be; committed when the session ends.
    if (theirs !== live.baseText) {
      const merged = theirs === null ? { clean: false as const } : await mergeThree(this.repo, live.baseText, theirs, text)
      if (!merged.clean) this.refuseNewer(live, theirs === null ? '' : splitPage(theirs).body, theirs === null ? '' : blobId(theirs))
    }
    live.conflict = null
    return { save: 'direct', ...moved }
  }

  // ── close, resolve, compare ─────────────────────────────────────────────────────────────────────

  /** The session ends (the member left the page): its draft committed, merged with a newer version where it can be. A
   *  conflict keeps the draft, for Compare. With `actor`, a session of someone else's is the 404 of one that is not there;
   *  with `viewer`, a page the member may no longer read is answered as gone, nothing of it sent and nothing written. */
  async close(sid: string, actor?: KnownActor, viewer?: Viewer): Promise<CloseResult> {
    return this.inSession(sid, actor, false, live => this.endIn(live, 'close', viewer))
  }

  /** After a conflict: Keep mine commits the draft over the version Compare showed (the page's front matter as it holds
   *  it, the draft's title and body); if a newer one landed since, Compare again with it (409). Take theirs drops the draft.
   *  Either ends the session; a session with no conflict is refused (409 NO_CONFLICT). */
  async resolve(sid: string, keep: 'mine' | 'theirs', actor?: KnownActor, viewer?: Viewer): Promise<{ commit: string | null; staged?: true }> {
    if (keep !== 'mine' && keep !== 'theirs') throw new HttpError(400, KEEP_BODY)
    return this.inSession(sid, actor, false, async live => {
      if (!live.conflict || !live.draft) throw new Refusal(409, { code: 'NO_CONFLICT', error: NO_CONFLICT })
      if (keep === 'theirs') { await this.finish(live); return { commit: null } }
      const draft = live.draft
      if (viewer && !this.admitted(live, viewer)) throw new Refusal(409, { code: 'GONE', error: PAGE_GONE })
      if (live.where === 'store') {
        const store = this.needStore()
        return this.withLock(async () => {
          let now
          try { now = store.record('pages', live.s.page) } catch (err) { throw unavailable(err, store) }
          if (!now) throw new Refusal(409, { code: 'GONE', error: PAGE_GONE })
          if (now.rev !== live.conflictAt) this.refuseNewer(live, String(now.body.markdown ?? ''), now.rev)
          await this.writeStore(store, live, now, draft)
          return { commit: null }
        })
      }
      return this.withLock(async () => {
        const theirs = fileText(this.repo, pagePath(live.s.page))
        if (theirs === null) throw new Refusal(409, { code: 'GONE', error: PAGE_GONE })
        if (blobId(theirs) !== live.conflictAt) this.refuseNewer(live, splitPage(theirs).body, blobId(theirs))
        const text = this.over(theirs, draft)
        if (text === theirs) { await this.finish(live); return { commit: null } }
        const out = await this.commitText(live, text, theirs)
        return 'staged' in out ? { commit: null, staged: true as const } : out
      })
    })
  }

  /** Compare's three texts for the session (§6): base, theirs (the page now) and mine (the draft). With `viewer`, theirs is
   *  empty for a page the member may no longer read (rule 7). */
  async compare(sid: string, actor?: KnownActor, viewer?: Viewer): Promise<Compare> {
    return this.inSession(sid, actor, false, async live => {
      if (viewer && !this.admitted(live, viewer)) return this.compareOf(live, '')
      if (live.conflict) return live.conflict
      if (live.where === 'git') {
        const theirs = fileText(this.repo, pagePath(live.s.page))
        return this.compareOf(live, theirs === null ? '' : splitPage(theirs).body)
      }
      const store = this.needStore()
      let now
      try { now = store.record('pages', live.s.page) } catch (err) { throw unavailable(err, store) }
      return this.compareOf(live, String(now?.body.markdown ?? ''))
    })
  }

  // ── suggest (R-L6-SUGGEST) ──────────────────────────────────────────────────────────────────────

  /** The page of `actor`'s live session `sid` (the 404 of one that is not there): what Suggest judges before its lock. */
  pageOf(sid: string, actor: KnownActor): string {
    return this.find(sid, actor, false).s.page
  }

  /** The session ends as a proposal (Task 16b; R-L6-SUGGEST-2): `body` (the editor's whole text) is saved as a save would
   *  save it, and `proposeIt` is given a change holding the page's one file op, under the repository's write lock (the
   *  caller's proposal machinery: `propose`, told it is a suggestion). Under a raised tree that op is the one the save
   *  staged, and it leaves the actor's change once proposed (the rest stays). Where the actor saves the page directly the
   *  op is the session's draft over the page as it is now, never committed: the page does not change, and the draft goes
   *  with the session. Refused, before anything is proposed: a page `viewer` may not read (404), a private page (409
   *  PRIVATE_PAGE), a page the actor may not write (403, the rule's sentence), a change that revises a proposal
   *  (409 REVISES), and a text the repository already holds (409 NOTHING). A newer version that cannot be merged is
   *  Compare (409 CONFLICT), as a save meets it. A proposal refused (no maintainer, SYNC_FIRST, a hat's 403) leaves the
   *  session open with what was saved: staged under a raised tree, the draft where the page is saved directly. */
  async suggest<T>(sid: string, actor: KnownActor, viewer: Viewer, body: { markdown: string; title?: string }, proposeIt: (change: Change) => Promise<T>): Promise<T> {
    if (typeof body?.markdown !== 'string' || (body.title !== undefined && typeof body.title !== 'string')) throw new HttpError(400, SAVE_BODY)
    return this.inSession(sid, actor, false, async live => {
      const { store, why } = reach(this.access)
      if (live.where === 'store' && !store) throw unavailable(why)
      visiblePage(treeOf(this.repo, store), live.s.page, viewer)
      if (live.where === 'store') throw new Refusal(409, { code: 'PRIVATE_PAGE', error: SUGGEST_PRIVATE })
      const path = pagePath(live.s.page)
      const text = this.mineOf(live, { markdown: body.markdown, ...(body.title !== undefined ? { title: body.title } : {}) })
      const probe: FileOp[] = [{ op: 'file', path, text, base: null }]
      const rule = effectiveRule(readRuleContext(this.repo, actor), classesOf(probe, this.repo), targetsOfOps(probe, this.repo))
      if (!rule.direct && !rule.proposable) throw new Refusal(403, { reason: rule.sentence, error: rule.sentence })
      const changes = new ChangeStore(this.repo)
      // A tray that revises a proposal is refused on every page, direct ones included (16b's contract; fix round 1,
      // review S4): one change at a time is the member's, not the page's.
      refuseRevising(changes.load(actor.id))
      if (text === fileText(this.repo, path)) throw new Refusal(409, { code: 'NOTHING', error: SUGGEST_NOTHING })
      const saved = await this.saveIn(sid, live, actor, body, viewer)
      const out = await this.withLock(async () => {
        const at = this.now().toISOString()
        const change = (ops: Change['ops']): Change => ({ id: live.s.id, actor: actor.id, created: at, updated: at, ops })
        if (saved.save === 'direct') {
          // The draft over the page as it is now (merged with a newer version, as the session's end would merge it).
          const theirs = fileText(this.repo, path)
          let next = this.mineOf(live, live.draft ?? { markdown: body.markdown })
          if (theirs !== live.baseText) {
            const merged = theirs === null ? { clean: false as const } : await mergeThree(this.repo, live.baseText, theirs, next)
            if (!merged.clean) this.refuseNewer(live, theirs === null ? '' : splitPage(theirs).body, theirs === null ? '' : blobId(theirs))
            next = merged.text
          }
          if (next === theirs) throw new Refusal(409, { code: 'NOTHING', error: SUGGEST_NOTHING })
          const result = await proposeIt(change([{ op: 'file', path, text: next, base: theirs === null ? null : blobId(theirs) }]))
          live.draft = null
          return result
        }
        const tray = changes.load(actor.id)
        const op = tray?.ops.find(o => o.op === 'file' && o.path === path)
        if (!tray || !op) throw new Refusal(409, { code: 'NOTHING', error: SUGGEST_NOTHING })
        const result = await proposeIt(change([op]))
        const rest = tray.ops.filter(o => o !== op)
        if (rest.length === 0 && !tray.private?.length && !tray.revises) changes.clear(actor.id)
        else changes.save({ ...tray, ops: rest, updated: at })
        this.notify({ type: 'changes' })
        return result
      })
      live.staged = false
      await this.finish(live)
      return out
    })
  }

  // ── the server's start and stop ─────────────────────────────────────────────────────────────────

  /** On stop: every open session ends now, as if each member had left the page. A session that cannot be committed keeps
   *  its draft (the next start's `reconcile` tries again); its failure is logged. */
  async flushAll(): Promise<void> {
    await this.settled()
    for (const live of [...this.live.values()]) {
      this.quiet(live)
      try { await live.lock(async () => { if (!live.over) await this.endIn(live, 'stop') }) } catch (err) {
        logged(`the editing session ${live.s.id} could not be committed at stop`)(err)
      }
    }
  }

  /** At start: the drafts a crash left (in the state directory, and in the store's `drafts` when it can be reached) are
   *  committed as their sessions' ends; answers the sessions written. A draft that conflicts stays, for Compare. */
  async reconcile(): Promise<string[]> {
    const done: string[] = []
    for (const file of existsSync(this.draftsDir()) ? readdirSync(this.draftsDir()).filter(f => /^ses_[0-9a-f]+\.json$/.test(f)).sort() : []) {
      const sid = file.slice(0, -'.json'.length)
      if (this.live.has(sid)) continue
      const path = join(this.draftsDir(), file)
      let saved: DraftFile
      try { saved = JSON.parse(readFileSync(path, 'utf8')) as DraftFile } catch {
        // Someone's work, unreadable: kept beside, never removed (as a change file is).
        try { renameSync(path, `${path}.unreadable-${Date.now()}`) } catch { /* gone already */ }
        continue
      }
      const live = this.blank(saved.session, saved.who, 'git', saved.baseText, '')
      live.draft = saved.draft
      this.live.set(sid, live)
      try {
        const out = await live.lock(() => this.endIn(live, 'stop'))
        if (('commit' in out && out.commit !== null) || 'staged' in out) done.push(sid)
      } catch (err) { logged(`the draft of editing session ${sid} could not be committed at start`)(err) }
    }
    const { store } = reach(this.access)
    let rows: ReturnType<PrivateStore['drafts']> = []
    try { rows = store ? store.drafts() : [] } catch (err) { logged('the private store\'s drafts could not be read at start')(err) }
    for (const d of rows) {
      if (this.live.has(d.session) || !d.target.startsWith('pages/')) continue
      let body: StoreDraftBody
      try { body = JSON.parse(d.body) as StoreDraftBody } catch { continue }
      const who: KnownActor = { id: d.actor, name: d.actor, kind: 'person', via: 'git' }
      const live = this.blank({ id: d.session, page: d.target.slice('pages/'.length), actor: d.actor, base: d.base ?? '', opened: d.opened, updated: d.updated },
        who, 'store', body.was.markdown, body.was.title)
      live.draft = { markdown: body.markdown, ...(body.title !== undefined ? { title: body.title } : {}) }
      this.live.set(d.session, live)
      try {
        await live.lock(() => this.endIn(live, 'stop'))
        if (live.wrote) done.push(d.session)
      } catch (err) { logged(`the draft of editing session ${d.session} could not be written at start`)(err) }
    }
    return done
  }

  /** Every session's timers ended, nothing committed (a test's end, or a process that is going away). */
  dispose(): void {
    for (const live of this.live.values()) this.quiet(live)
    this.live.clear()
    this.next.clear()
    this.seeds.clear()
  }

  /** Resolves once every session a timer ended has finished ending (tests, and `flushAll`). */
  async settled(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight])
  }

  // ── inside ──────────────────────────────────────────────────────────────────────────────────────

  private blank(s: Session, who: KnownActor, where: 'git' | 'store', baseText: string, baseTitle: string): Live {
    return { s: { ...s }, who, where, baseText, baseTitle, draft: null, staged: false, conflict: null, conflictAt: null, idle: null, max: null,
      wrote: false, over: false, after: null, lock: ownLock(), stagedFrom: null }
  }

  /** A new session from `seed`, its timers running. */
  private start(seed: Seed): Live {
    const at = this.now().toISOString()
    const live = this.blank({ id: newSessionId(), page: seed.page, actor: seed.who.id, base: seed.base, opened: at, updated: at },
      seed.who, seed.where, seed.baseText, seed.baseTitle)
    if (seed.where === 'git') live.stagedFrom = this.pendingOf(seed.who.id, pagePath(seed.page)) ?? null
    this.live.set(live.s.id, live)
    live.max = this.schedule(() => this.track(this.expire(live, 'max')), this.maxMs)
    this.touch(live)
    return live
  }

  /** The live session `sid` names (or the one that followed it), when it is `actor`'s; else the 404 of one not there.
   *  `revive`: a session that ended idle opens the next from where it ended (a save sent to it: the member came back). */
  private find(sid: string, actor: KnownActor | undefined, revive: boolean): Live {
    let id = sid
    for (let n = 0; n < 1000 && this.next.has(id); n++) id = this.next.get(id)!
    let live = this.live.get(id)
    const seed = this.seeds.get(id)
    if (!live && revive && seed && (actor === undefined || seed.who.id === actor.id)) {
      this.seeds.delete(id)
      live = this.start(seed)
      this.next.set(id, live.s.id)
    }
    if (!live || (actor !== undefined && live.s.actor !== actor.id)) throw new HttpError(404, NO_SESSION(sid), 'NO_SESSION')
    return live
  }

  /** `fn` on the session `sid` names, under that session's own lock; a session that ended while this waited for the lock is
   *  looked up again (the one that followed it, or the 404). */
  private async inSession<T>(sid: string, actor: KnownActor | undefined, revive: boolean, fn: (live: Live) => Promise<T>): Promise<T> {
    for (let n = 0; n < 100; n++) {
      const live = this.find(sid, actor, revive)
      let ended = false
      const out = await live.lock(async () => {
        if (live.over) { ended = true; return null }
        return fn(live)
      })
      if (!ended) return out as T
    }
    throw new HttpError(404, NO_SESSION(sid), 'NO_SESSION')
  }

  private track(p: Promise<unknown>): void {
    const q: Promise<unknown> = p.catch(logged('an editing session could not end')).finally(() => this.inflight.delete(q))
    this.inflight.add(q)
  }

  private touch(live: Live): void {
    live.idle?.()
    live.idle = this.schedule(() => this.track(this.expire(live, 'idle')), this.idleMs)
  }

  private quiet(live: Live): void {
    live.idle?.(); live.idle = null
    live.max?.(); live.max = null
  }

  /** A timer ended the session, under its lock (a session already ended, by another timer or a close, is left as it is). */
  private async expire(live: Live, why: 'idle' | 'max'): Promise<void> {
    await live.lock(async () => {
      if (live.over || this.live.get(live.s.id) !== live) return
      await this.endIn(live, why)
    })
  }

  /** Whether `viewer` may still read the session's page (§3.2, rule 7). A private page with the store down is its 503. */
  private admitted(live: Live, viewer: Viewer): boolean {
    const { store, why } = reach(this.access)
    if (live.where === 'store' && !store) throw unavailable(why)
    try { visiblePage(treeOf(this.repo, store), live.s.page, viewer); return true } catch (err) {
      if (err instanceof HttpError && err.status === 404) return false
      throw err
    }
  }

  /** The session's end (§6), the caller holding the session's lock: a git page's and a private page's both under the
   *  repository's write lock (so two tabs' ends never pass the same check at once). Ended on a timer, the next session
   *  starts where this one ended: at PAGE_MAX_MS at once, idle when a save is next sent to it. With `viewer`, a page the
   *  member may no longer read is a conflict whose theirs is empty: nothing of it is sent, nothing is written. */
  private async endIn(live: Live, why: 'close' | 'idle' | 'max' | 'stop', viewer?: Viewer): Promise<CloseResult> {
    if (viewer && live.draft && !this.admitted(live, viewer)) {
      live.conflict = this.compareOf(live, '')
      live.conflictAt = ''
      this.quiet(live)
      return { conflict: live.conflict }
    }
    const out = await this.withLock(() => (live.where === 'store' ? this.endStore(live) : this.endGit(live)))
    if ((why === 'idle' || why === 'max') && live.over && live.after) {
      const seed: Seed = { who: live.who, page: live.s.page, where: live.where, ...live.after }
      if (why === 'max') this.next.set(live.s.id, this.start(seed).s.id)
      else this.seeds.set(live.s.id, seed)
    }
    return out
  }

  private async endGit(live: Live): Promise<CloseResult> {
    const path = pagePath(live.s.page)
    const theirs = fileText(this.repo, path)
    const at = (text: string | null) => (text === null ? '' : blobId(text))
    if (!live.draft) {
      live.after = { baseText: live.baseText, baseTitle: live.baseTitle, base: at(theirs) }
      await this.finish(live)
      return live.staged ? { staged: true } : { commit: null }
    }
    const mine = this.mineOf(live, live.draft)
    let text = mine
    if (theirs !== live.baseText) {
      const merged = theirs === null ? { clean: false as const } : await mergeThree(this.repo, live.baseText, theirs, mine)
      if (!merged.clean) {
        live.conflict = this.compareOf(live, theirs === null ? '' : splitPage(theirs).body)
        live.conflictAt = at(theirs)
        this.quiet(live)
        return { conflict: live.conflict }
      }
      text = merged.text
    }
    // The next session (a timer's end) starts from the text the member's editor holds, on the version committed now.
    live.after = { baseText: mine, baseTitle: live.baseTitle, base: blobId(text) }
    if (text === theirs) { await this.finish(live); return { commit: null } }
    const out = await this.commitText(live, text, theirs)
    // Staged instead (the tree was raised since): HEAD does not hold the draft, the change does. The next session starts
    // from HEAD's text, so the member's next (raised) save, which holds every edit, replaces the staged op whole.
    if ('staged' in out) live.after = { baseText: theirs ?? live.baseText, baseTitle: live.baseTitle, base: at(theirs) }
    return out
  }

  private async endStore(live: Live): Promise<CloseResult> {
    const store = this.needStore()
    let now
    try { now = store.record('pages', live.s.page) } catch (err) { throw unavailable(err, store) }
    if (!live.draft) {
      live.after = { baseText: live.baseText, baseTitle: live.baseTitle, base: now?.rev ?? live.s.base }
      await this.finish(live)
      return { commit: null }
    }
    const draft = live.draft
    const title = draft.title ?? live.baseTitle
    const holds = now !== null && now.body.markdown === draft.markdown && String(now.body.title ?? '') === title
    if (holds) { // unchanged, or written before a crash took the draft
      live.after = { baseText: draft.markdown, baseTitle: title, base: now!.rev }
      await this.finish(live)
      return { commit: null }
    }
    if (!now || now.rev !== live.s.base) {
      live.conflict = this.compareOf(live, String(now?.body.markdown ?? ''))
      live.conflictAt = now?.rev ?? ''
      this.quiet(live)
      return { conflict: live.conflict }
    }
    await this.writeStore(store, live, now, draft)
    return { commit: null }
  }

  /** A private page written from the draft (one store write and its history row; no commit), the draft gone. The caller
   *  holds the write lock. */
  private async writeStore(store: PrivateStore, live: Live, now: NonNullable<ReturnType<PrivateStore['record']>>, draft: Draft): Promise<void> {
    const tree = treeOf(this.repo, store)
    mayWritePrivate(this.repo, live.who, [targetsIn(tree, live.s.page, tree.byId.get(live.s.page)?.parent ?? null)])
    // L6 carries K5: while an open proposal holds the page's move into the repository, a save would leave it stale.
    const held = heldMove(store, 'pages', live.s.page)
    if (held !== null) throw new Refusal(409, { code: 'MOVE_HELD', error: MOVE_PROPOSED('page', held) })
    const body = { ...now.body, title: draft.title ?? String(now.body.title ?? live.baseTitle), markdown: draft.markdown }
    const rev = baseOf(body) ?? ''
    try { await store.putRecord({ ...now, body, rev }, live.who.id, null) } catch (err) { throw unavailable(err, store) }
    live.wrote = true
    live.after = { baseText: draft.markdown, baseTitle: body.title, base: rev }
    await this.finish(live)
    this.heard(live.s.page, live.s.base, draft.markdown, { baseText: live.baseText, by: live.who.id })
  }

  /** One commit of `text` over `theirs` (the file as it is), as the session's own change (`Org-Change: <ses>`); staged
   *  instead where the page's tree is raised now. The caller holds the write lock. */
  private async commitText(live: Live, text: string, theirs: string | null): Promise<{ commit: string } | { staged: true }> {
    const title = String(splitPage(text).front.title ?? live.s.page)
    const op: FileOp = { op: 'file', path: pagePath(live.s.page), text, base: theirs === null ? null : blobId(theirs) }
    const out = await commitOrStage(this.repo, live.who, [op], `page: ${title}`, this.notify, live.s.id)
    await this.finish(live)
    if ('staged' in out) return { staged: true }
    this.heard(live.s.page, live.s.base, text, { baseText: live.baseText, by: live.who.id })
    return { commit: out.commit }
  }

  private heard(page: string, base: string, text: string, more: { baseText: string; by: string }): void {
    for (const fn of this.listeners) { try { fn(page, base, text, more) } catch (err) { logged('a listener of editing sessions failed')(err) } }
  }

  /** The session is over: its timers, its draft (file or store row) and its place gone. */
  private async finish(live: Live): Promise<void> {
    this.quiet(live)
    live.over = true
    if (this.live.get(live.s.id) === live) this.live.delete(live.s.id)
    live.conflict = null
    if (live.where === 'git') { rmSync(this.draftFile(live.s.id), { force: true }); return }
    const { store } = reach(this.access)
    if (store) await store.deleteDraft(live.s.id).catch(logged(`the draft of editing session ${live.s.id} could not be removed`))
  }

  /** The 409 of a save (or a Keep mine) that meets a newer version it cannot merge (§6): Compare as it is now, and the
   *  version of theirs it shows. */
  private refuseNewer(live: Live, theirs: string, at: string): never {
    live.conflict = this.compareOf(live, theirs)
    live.conflictAt = at
    throw new Refusal(409, { code: 'CONFLICT', error: NEWER_VERSION, compare: live.conflict })
  }

  private compareOf(live: Live, theirs: string): Compare {
    const base = live.where === 'git' ? splitPage(live.baseText).body : live.baseText
    return { base, theirs, mine: live.draft?.markdown ?? base }
  }

  /** The draft as the page's whole file, on the text the session started from: its front matter's bytes kept, its title
   *  the draft's when one was sent. An unreadable front matter is refused in its own words (422). */
  private mineOf(live: Live, draft: Draft): string {
    return this.over(live.stagedFrom ?? live.baseText, draft)
  }

  /** `draft` written over the file `text`: `text`'s front matter (its title the draft's, when one was sent), the draft's body. */
  private over(text: string, draft: Draft): string {
    const { front } = splitPage(text)
    const next: PageFront = draft.title !== undefined && draft.title !== front.title ? { ...front, title: draft.title } : front
    try { return joinPage(next, draft.markdown, text) } catch (err) {
      if ((err as { code?: unknown }).code === 'UNREADABLE_FRONT') throw new Refusal(422, { code: 'UNREADABLE_FRONT', error: (err as Error).message })
      throw err
    }
  }

  /** A save under a raised tree: the page's file op staged in the actor's change, merged into the one op it already holds
   *  for the page (first base kept). `from`: the text the edit started from; where the change holds another, the edit is
   *  merged three ways over it first, or refused (422, PENDING_CONFLICT) where both change the same lines (the walk's G5).
   *  Answers the text the change now holds for the page. The caller holds the write lock. */
  private async stageFile(actor: KnownActor, op: FileOp, from: string): Promise<string | null> {
    const changes = new ChangeStore(this.repo)
    const at = this.now().toISOString()
    const change = changes.load(actor.id) ?? { id: newChangeId(), actor: actor.id, created: at, updated: at, ops: [] }
    let over: { op: FileOp; from: string }
    try { over = await overPending(this.repo, change.ops, op, from) } catch (err) {
      if (err instanceof HttpError && err.code === 'CONFLICT') throw new StageRefusal([{ record: op.path, field: '', message: err.message }])
      throw err
    }
    const { ops, errors } = stage(this.repo, change.ops, [over.op], new Map([[op.path, over.from]]))
    if (errors.length > 0) throw new StageRefusal(errors)
    changes.save({ ...change, ops, updated: at })
    this.notify({ type: 'changes' })
    return pendingText(ops, op.path) ?? null
  }

  /** The text `actor`'s change holds for the git file `path`, or undefined (none, a deletion, or a change unreadable). */
  private pendingOf(actor: string, path: string): string | undefined {
    try { return pendingText(new ChangeStore(this.repo).load(actor)?.ops ?? [], path) } catch { return undefined }
  }

  private needStore(): PrivateStore {
    const { store, why } = reach(this.access)
    if (!store) throw unavailable(why)
    return store
  }

  private async putStoreDraft(store: PrivateStore, live: Live): Promise<void> {
    const body: StoreDraftBody = { markdown: live.draft!.markdown, ...(live.draft!.title !== undefined ? { title: live.draft!.title } : {}),
      was: { markdown: live.baseText, title: live.baseTitle } }
    try {
      await store.putDraft({ session: live.s.id, target: `pages/${live.s.page}`, actor: live.s.actor, base: live.s.base, body: JSON.stringify(body),
        opened: live.s.opened, updated: live.s.updated })
    } catch (err) { throw unavailable(err, store) }
  }

  private draftsDir(): string { return join(stateDir(this.repo), 'drafts') }
  private draftFile(sid: string): string { return join(this.draftsDir(), `${sid}.json`) }

  /** Written whole to a temporary file, then renamed over the old one: a reader never sees half a draft. */
  private writeDraftFile(live: Live): void {
    mkdirSync(this.draftsDir(), { recursive: true })
    const file = this.draftFile(live.s.id)
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    const saved: DraftFile = { session: live.s, who: live.who, baseText: live.baseText, draft: live.draft }
    writeFileSync(tmp, JSON.stringify(saved))
    renameSync(tmp, file)
  }
}

// ── routes ──────────────────────────────────────────────────────────────────────────────────────────

async function body(c: Context): Promise<unknown> {
  try { return await c.req.json() } catch { return undefined }
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function mountSessions(app: Hono, sessions: EditSessions): void {
  app.post('/api/pages/:id/sessions', async c => c.json(await sessions.open(knownActorOf(c), viewerOf(c), c.req.param('id'))))

  app.put('/api/sessions/:sid', async c => {
    const raw = await body(c)
    if (!isObj(raw)) throw new HttpError(400, SAVE_BODY)
    return c.json(await sessions.save(c.req.param('sid'), knownActorOf(c), raw as { markdown: string; title?: string }, viewerOf(c)))
  })

  app.post('/api/sessions/:sid/close', async c => {
    const out = await sessions.close(c.req.param('sid'), knownActorOf(c), viewerOf(c))
    if ('conflict' in out) return c.json({ code: 'CONFLICT', error: NEWER_VERSION, conflict: out.conflict }, 409)
    return c.json(out)
  })

  app.post('/api/sessions/:sid/resolve', async c => {
    const raw = await body(c)
    if (!isObj(raw) || (raw.keep !== 'mine' && raw.keep !== 'theirs')) throw new HttpError(400, KEEP_BODY)
    return c.json(await sessions.resolve(c.req.param('sid'), raw.keep, knownActorOf(c), viewerOf(c)))
  })

  app.get('/api/sessions/:sid/compare', async c => c.json(await sessions.compare(c.req.param('sid'), knownActorOf(c), viewerOf(c))))
}
