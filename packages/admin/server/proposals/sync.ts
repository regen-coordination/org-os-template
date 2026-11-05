// packages/admin/server/proposals/sync.ts
//
// Sync (0.6 P2 spec §3.12, P2-R18, P2-R31): a button, never automatic. POST /api/sync takes the nonce of the `fetch`
// operation's plan (the person's confirmation), runs that fetch as a job through the executor, and then, under the
// repository's write lock, does the local part: nothing to do; a fast-forward when the trunk is behind and the tree is
// clean; or, when the two histories diverged, one merge commit, computed first with `merge-tree` so that a conflict is
// found without touching the tree. The only conflict it resolves is `data/proposals.yaml`, by id (`mergeLedgers`); any
// other is refused in words and nothing is touched. The merge commit carries no `Org-Proposal`: the validator expands
// it along its second parent (§3.10). GET /api/sync reads the last fetch and never reaches the network.
//
// A sibling of routes.ts, not a route in it: Sync is about the trunk, not one proposal, and it needs the executor, the
// jobs and the plans the operation routes hold.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { Context, Hono } from 'hono'
import { HttpError } from '../errors.ts'
import { Refusal } from '../changes/apply.ts'
import { FINAL, type JobRecord, type JobStore } from '../state.ts'
import { CATALOGUE, type Operation } from '../operations/catalogue.ts'
import type { Executor } from '../operations/executor.ts'
import type { Plans } from '../operations/plans.ts'
import type { ResourceStore } from '../resources/index.ts'
import { createdText, entriesFromText, updatedText } from '../registry.ts'
import {
  commitMerge, gitVersion, lastFetch, recordRemoteTrunkAbsent, remoteUrl, mergeAbort, mergeBase, mergeFfOnly, mergeInProgress, mergeNoFf, mergeTree, resolveRev,
  showFile, stageMergeFiles, trackedChanges, treeDiffNames, unmergedPaths, type FetchState,
} from '../git.ts'
import { guardTrunk, resolveTrunk } from './ledger.ts'
import { mergeLedgers } from '../../lib/proposals.mjs'
import { validTrunkName } from '../../lib/rules.mjs'

export interface SyncDeps {
  repo: string
  /** The repository's one write lock (app.ts). */
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  store: ResourceStore
  jobs: JobStore
  executor: Executor
  /** The confirmations the operation routes issue: the fetch's nonce comes from POST /api/operations/fetch/plan. */
  plans: Plans
  /** The branch the server started on: the trunk when `governance.trunk` names none (P2-R17). */
  startBranch?: string
  catalogue?: Operation[]
  /** Sent after a Sync that moved the trunk. */
  notify?: (msg: { type: 'changes' }) => void
  /** The clock the absence record and its age are read by. */
  now?: () => Date
}

export type SyncState = 'up-to-date' | 'fast-forwarded' | 'merged' | 'refused'

const REMOTE = 'origin'
const LEDGER = 'data/proposals.yaml'
const NOTHING = 'Nothing was changed.'
export const NO_REMOTE = 'There is no remote: nothing to sync.'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const firstLine = (err: unknown): string => (err instanceof Error ? err.message : String(err)).trim().split('\n')[0] ?? ''
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
const refuse = (code: string, error: string, more: Record<string, unknown> = {}): Refusal => new Refusal(409, { state: 'refused', code, error, ...more })
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

const noTrunkSentence = (trunk: string): string => `The remote has no ${trunk} yet: nothing to bring in. Share publishes it.`

/** What the last fetch says, in the Governance head's words: "2 commits not shared · 1 new from the remote". */
function sentenceOf(f: FetchState, trunk: string): string {
  if (f.state === 'no remote') return NO_REMOTE
  if (f.state === 'remote has no trunk') return noTrunkSentence(trunk)
  if (f.state === 'never fetched') return `Never fetched from ${REMOTE}: Sync to see what is new.`
  if (f.state === 'the last fetch was not of the trunk') return `The last fetch was not of the trunk, "${trunk}": Sync to see what is new.`
  if (f.state === 'no local trunk') return `There is no local branch "${trunk}".`
  const parts = [...(f.ahead > 0 ? [`${plural(f.ahead, 'commit')} not shared`] : []), ...(f.behind > 0 ? [`${f.behind} new from the remote`] : [])]
  return parts.length > 0 ? parts.join(' · ') : `Up to date with ${REMOTE}/${trunk} as of the last fetch.`
}

const counts = (f: FetchState) => ({ remote: f.state === 'no remote' ? null : REMOTE, ahead: f.ahead, behind: f.behind })

/** The trunk, or a refusal: its name becomes part of a ref here, so it is checked before any git reads it. */
async function trunkOf(repo: string, startBranch?: string): Promise<string> {
  const trunk = await resolveTrunk(repo, startBranch)
  const named = validTrunkName(trunk)
  if (named !== true) throw refuse('TRUNK', `Not synced: "${trunk}" cannot be the trunk: ${named} Name another in data/governance.yaml (governance.trunk). ${NOTHING}`)
  return trunk
}

/** The job once it has ended. The executor owns the work and its time limit; this only waits. */
async function ended(jobs: JobStore, id: string, timeoutMs: number): Promise<JobRecord> {
  const deadline = Date.now() + timeoutMs + 10_000
  for (;;) {
    const job = jobs.get(id)
    if (job && FINAL.includes(job.status)) return job
    if (Date.now() > deadline) throw new HttpError(500, 'The fetch did not finish in time. Nothing was merged; look at its job before you Sync again.')
    await wait(25)
  }
}

/** Why a job did not end ok, in its own first line, without the executor's "Failed: … ." frame. */
const whyJob = (job: JobRecord): string => (job.sentence ?? job.status).split('\n')[0]!.replace(/^Failed: /, '').replace(/\.$/, '')

/** A file's text at a revision, or null when the revision does not hold it. */
async function textAt(repo: string, rev: string | null, path: string): Promise<string | null> {
  if (rev === null) return null
  try { return await showFile(repo, rev, path) } catch { return null }
}

/** Our ledger's text with the merged entries in it, every entry the merge did not change kept byte for byte: a changed
 *  entry is a verified whole-entry update, a new one is appended. Refuses when the text read back is not the merge. */
function mergedLedgerText(ours: string, entries: Record<string, unknown>[]): string {
  const have = new Map(entriesFromText(ours, 'proposals').map(e => [String(e.id), e]))
  let text = ours
  for (const entry of entries) {
    const id = String(entry.id)
    const mine = have.get(id)
    if (mine === undefined) text = createdText(text, 'proposals', entry)
    else if (!isDeepStrictEqual(mine, entry)) text = updatedText(text, 'proposals', id, entry)
  }
  const back = new Map(entriesFromText(text, 'proposals').map(e => [String(e.id), e]))
  const exact = back.size === entries.length && entries.every(e => isDeepStrictEqual(back.get(String(e.id)), e))
  if (!exact) throw refuse('LEDGER', `Not synced: the ledger merged by id could not be written exactly into ${LEDGER}. Merge it with git yourself. ${NOTHING}`)
  return text
}

/** The ledger merged by id, as text, before anything is touched; a refusal when it cannot be. */
async function ledgerMerge(repo: string, head: string, tip: string): Promise<string> {
  const base = await mergeBase(repo, head, tip)
  const [b, o, t] = await Promise.all([textAt(repo, base, LEDGER), textAt(repo, head, LEDGER), textAt(repo, tip, LEDGER)])
  if (o === null || t === null) {
    throw refuse('LEDGER', `Not synced: ${LEDGER} was deleted on one side and changed on the other; resolve it with git, then Sync again. ${NOTHING}`)
  }
  let read: Record<string, unknown>[][]
  try { read = [b, o, t].map(text => (text === null ? [] : entriesFromText(text, 'proposals'))) } catch (err) {
    throw refuse('LEDGER', `Not synced: one side's ${LEDGER} cannot be read (${firstLine(err)}); resolve it with git, then Sync again. ${NOTHING}`)
  }
  const merged = mergeLedgers(read[0], read[1], read[2])
  if (!merged.ok) throw refuse('LEDGER', `Not synced: the ledger cannot be merged by id: ${merged.reason}. ${NOTHING}`)
  return mergedLedgerText(o, merged.entries)
}

/** One merge commit of `tip` into the checked-out trunk, with `ledger` (when given) written over the conflicted ledger.
 *  Every failure once the merge has begun ends in `git merge --abort` (P2-R15, the one undo). */
async function mergeCommit(repo: string, trunk: string, head: string, tip: string, tree: string, ledger: string | null): Promise<string> {
  const allowed = [...new Set([...(await treeDiffNames(repo, head, tree)), ...(ledger !== null ? [LEDGER] : [])])]
  let started = false
  try {
    try { await mergeNoFf(repo, tip) } catch (err) {
      // a conflict leaves the merge pending (the ledger's, expected); a refusal to start leaves nothing to undo
      if (!(await mergeInProgress(repo))) throw refuse('MERGE_FAILED', `Not synced: git would not start the merge (${firstLine(err)}). ${NOTHING}`)
    }
    started = await mergeInProgress(repo)
    if (!started) throw refuse('MERGE_FAILED', `Not synced: git started no merge of ${REMOTE}/${trunk}. ${NOTHING}`)
    const unmerged = [...new Set(await unmergedPaths(repo))].sort()
    const expected = ledger !== null ? [LEDGER] : []
    if (!isDeepStrictEqual(unmerged, expected)) {
      throw new Error(`git left ${unmerged.join(', ') || 'nothing'} unmerged, where merge-tree had found ${expected.join(', ') || 'nothing'}`)
    }
    if (ledger !== null) {
      writeFileSync(join(repo, LEDGER), ledger)
      await stageMergeFiles(repo, [LEDGER], allowed)
    }
    const message = `sync: merge ${REMOTE}/${trunk} into ${trunk}${ledger !== null ? `\n\nThe ledger, ${LEDGER}, merged by id.` : ''}`
    return await commitMerge(repo, message, allowed)
  } catch (err) {
    if (!started) throw err
    try { await mergeAbort(repo) } catch (again) {
      throw new Refusal(500, { state: 'refused', code: 'SYNC_STUCK', error:
        `Not synced, and the merge could not be undone (${firstLine(again)}): a merge is still in progress. Run \`git merge --abort\` yourself, then Sync again.` })
    }
    if (err instanceof Refusal) throw err
    throw refuse('MERGE_FAILED', `Not synced: the merge failed (${firstLine(err)}) and was undone with git merge --abort. ${NOTHING}`)
  }
}

type LocalResult = { state: SyncState; moved: boolean } & Record<string, unknown>

/** The local part of Sync, on what the fetch just brought: callers hold the write lock. */
async function localPart(repo: string, trunk: string, startBranch: string | undefined, now: Date): Promise<LocalResult> {
  await guardTrunk(repo, startBranch)
  if (await mergeInProgress(repo)) {
    throw refuse('MERGE_IN_PROGRESS', `Not synced: a merge is already in progress in this repository. Finish it or undo it with git yourself (\`git status\` says which), then Sync again. ${NOTHING}`)
  }
  let f = await lastFetch(repo, trunk, now)
  if (f.state !== 'fetched' && f.state !== 'no remote' && (await resolveRev(repo, `refs/remotes/${REMOTE}/${trunk}`)) === null
    && (await resolveRev(repo, `refs/heads/${trunk}`)) !== null) {
    // the fetch took every branch and left no tracking ref of the trunk: the remote has none, so there is nothing to be behind (F-L3-2); with no local trunk there is nothing to share either
    const url = await remoteUrl(repo)
    if (url !== null) { recordRemoteTrunkAbsent(repo, { url, trunk, at: now }); f = await lastFetch(repo, trunk, now) }
  }
  if (f.state === 'remote has no trunk') {
    return { state: 'up-to-date', moved: false, ...counts(f), sentence: noTrunkSentence(trunk) }
  }
  if (f.state === 'the last fetch was not of the trunk') {
    throw refuse('NO_REMOTE_TRUNK', `Not synced: the fetch brought no branch "${trunk}" from ${REMOTE}, so there is nothing to bring in. ${NOTHING}`)
  }
  if (f.state !== 'fetched') throw refuse('FETCH', `Not synced: after the fetch, ${sentenceOf(f, trunk)} ${NOTHING}`)
  if (f.behind === 0) {
    const shared = f.ahead > 0 ? ` ${plural(f.ahead, 'commit')} not shared.` : ''
    return { state: 'up-to-date', moved: false, ...counts(f), sentence: `Up to date with ${REMOTE}/${trunk}: nothing to do.${shared}` }
  }
  const dirty = await trackedChanges(repo)
  if (dirty.length > 0) {
    throw refuse('DIRTY', `Not synced: ${dirty[0]} has changes that are not committed${dirty.length > 1 ? ` (and ${plural(dirty.length - 1, 'other file')})` : ''}, ` +
      `and Sync moves the trunk under them. Commit or discard them (\`git status\` lists them), then Sync again. ${NOTHING}`, { paths: dirty })
  }
  const remoteRef = `refs/remotes/${REMOTE}/${trunk}`
  const head = await resolveRev(repo, 'HEAD')
  const tip = await resolveRev(repo, remoteRef)
  if (head === null || tip === null) throw refuse('FETCH', `Not synced: ${head === null ? 'the trunk has no commit' : `${remoteRef} is not there`}. ${NOTHING}`)

  if (f.ahead === 0) {
    try { await mergeFfOnly(repo, tip) } catch (err) {
      throw refuse('FF_FAILED', `Not synced: git would not fast-forward ${trunk} (${firstLine(err)}). ${NOTHING}`)
    }
    const after = await lastFetch(repo, trunk)
    return { state: 'fast-forwarded', moved: true, commit: tip, ...counts(after), sentence: `Fast-forwarded ${trunk} by ${plural(f.behind, 'commit')} from ${REMOTE}.` }
  }

  // Diverged. merge-tree --write-tree needs git 2.38 (L5); the fast-forward above does not.
  const v = await gitVersion()
  if (v.major < 2 || (v.major === 2 && v.minor < 38)) {
    throw refuse('GIT_VERSION', `Not synced: ${trunk} and ${REMOTE}/${trunk} have both moved, and this machine's git is ${v.major}.${v.minor}; ` +
      `Sync needs 2.38 to merge two histories safely; update git, or merge with git yourself. ${NOTHING}`)
  }
  const computed = await mergeTree(repo, head, tip)
  const conflicts = [...new Set(computed.conflicts)]
  const others = conflicts.filter(p => p !== LEDGER)
  if (others.length > 0) {
    throw refuse('CONFLICT', `Not synced: both sides changed ${others.map(p => `\`${p}\``).join(' and ')}; resolve ${others.length === 1 ? 'it' : 'them'} with git, then Sync again. ${NOTHING}`,
      { conflicts })
  }
  const ledger = conflicts.includes(LEDGER) ? await ledgerMerge(repo, head, tip) : null
  const commit = await mergeCommit(repo, trunk, head, tip, computed.tree, ledger)
  const after = await lastFetch(repo, trunk)
  return {
    state: 'merged', moved: true, commit, ledger: ledger !== null ? 'merged by id' : null, ...counts(after),
    sentence: `Merged ${REMOTE}/${trunk} into ${trunk}${ledger !== null ? ', the ledger by id' : ''}. ${plural(after.ahead, 'commit')} not shared.`,
  }
}

async function jsonBody(c: Context): Promise<unknown> {
  try { return await c.req.json() } catch { return undefined }
}

export function mountSync(app: Hono, { repo, withLock, store, jobs, executor, plans, startBranch, catalogue = CATALOGUE, notify, now = () => new Date() }: SyncDeps): void {
  app.get('/api/sync', async c => {
    const trunk = await trunkOf(repo, startBranch)
    const f = await lastFetch(repo, trunk, now())
    return c.json({ ...counts(f), trunk, state: f.state, fetchedAt: f.fetchedAt?.toISOString() ?? null, sentence: sentenceOf(f, trunk) })
  })

  app.post('/api/sync', async c => {
    const body = await jsonBody(c)
    const trunk = await trunkOf(repo, startBranch)
    if ((await lastFetch(repo, trunk)).state === 'no remote') {
      return c.json({ state: 'up-to-date', remote: null, trunk, ahead: 0, behind: 0, sentence: NO_REMOTE })
    }
    const nonce = isObject(body) ? body.nonce : undefined
    if (nonce === undefined) {
      throw new HttpError(403, 'Sync starts with a fetch, which reaches the network, so it runs only with a confirmation: ' +
        'POST /api/operations/fetch/plan, then send its nonce here.')
    }
    const plan = plans.take(nonce) // single use: taken whether or not what follows succeeds
    const op = catalogue.find(o => o.id === 'fetch')
    if (plan.op !== 'fetch' || !plan.inProcess || !op) {
      throw new HttpError(409, 'This confirmation is not for a fetch, so Sync does not run on it. Plan the fetch (POST /api/operations/fetch/plan) and send its nonce.')
    }
    const resource = (await store.graph()).nodes.find(n => n.id === plan.resource)
    if (!resource) throw new HttpError(404, `No resource "${plan.resource}".`)

    // The network read, as the job the person confirmed; outside the lock, since it writes no file and may take a while.
    const job = await ended(jobs, executor.submit({ op, resource, planned: { inProcess: plan.inProcess } }).id, op.timeoutMs)
    if (job.status !== 'ok') throw refuse('FETCH_FAILED', `Not synced: the fetch from ${REMOTE} did not succeed (${whyJob(job)}). ${NOTHING}`, { job: job.id })

    return withLock(async () => {
      let result: LocalResult
      try { result = await localPart(repo, trunk, startBranch, now()) } catch (err) {
        // the trunk's own guards speak without a state; Sync's answer always has one
        if (err instanceof Refusal && err.body.state === undefined) throw new Refusal(err.status, { state: 'refused', ...err.body })
        throw err
      }
      const { moved, ...answer } = result
      if (moved) notify?.({ type: 'changes' })
      return c.json({ ...answer, trunk, job: job.id })
    })
  })
}
