// packages/admin/server/proposals/branch.ts
//
// The branch of a proposal (0.6 P2 spec §3.5): `proposal/<id>` is a cache of the ledger, built from the
// proposal's ops and never merged. The invariant (H1): its tip is ONE commit whose first parent is a trunk
// commit and whose tree is that parent's tree plus the ops and nothing else, so a later merge into the trunk
// can only bring the proposal's own operations. Building is done in a detached worktree outside the repository,
// so the operator's working tree and index are never touched; the ref is moved by compare-and-swap, only when the
// built tree differs from the branch's.

import { mkdirSync, existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { Refusal, StageRefusal, applyOps, commitEmpty } from '../changes/apply.ts'
import { staleOps } from '../changes/stage.ts'
import { commitMessage } from '../changes/records.ts'
import { addWorktree, removeWorktree, moveProposalBranch, resolveRev, showFile, repoStatus, messageOf, treeDiffNames, GitExit, type GitIdent } from '../git.ts'
import { stateDir } from '../state.ts'
import { entriesFromText } from '../registry.ts'
import { rebaseOp, isStale } from '../changes/merge.ts'
import { named } from '../changes/stage.ts'
import { parseRecord } from '../changes/records.ts'
import { updateEntry, resolveTrunk, type LedgerOptions, type LedgerWho } from './ledger.ts'
import { revOf, type Proposal, type LedgerEvent } from '../../lib/proposals.mjs'
import { gitOpsOf, isPlaceholder } from '../../lib/ops.mjs'
import { RESTRICTED_SUBJECT } from '../private/ops.ts'
import type { Op, StageOp } from '../changes/types.ts'

/** What a build needs of a proposal: its id, its author (the commit's `Org-Actor`) and its ops as the ledger stores them,
 *  a private placeholder among them (L5 §9.6: it changes no file; the store applies it at ratify). */
export interface BranchProposal { id: string; author: string; ops: ((StageOp & { base: string | null }) | { op: 'private'; ref: string; class: string; digest: string })[] }

export interface BuildResult {
  /** The branch tip after the call: the new commit, or the existing one when its tree was the same. */
  tip: string
  /** The commit the branch is built on. */
  from: string
  /** Whether the ref was created or moved. */
  moved: boolean
}

/** The id shape a branch is built for: the one the server mints (final review I5), as `moveProposalBranch` takes it. */
const PROPOSAL_ID = /^p-\d{4}-\d{2}-\d{2}-\d{3}-[0-9a-f]{4}$/

/** The line the content commit carries to say which rev of the ops it holds: a branch whose tip says another rev (or
 *  none) was built from ops the proposal no longer has, and is built again when it is needed. Not a trailer. */
export const revMark = (rev: string): string => `Built from rev ${rev} of the proposal's ops.`

/** The rev the tip of `proposal/<id>` says it was built from; null when the branch is missing or its tip says none. */
export async function builtRev(repo: string, id: string): Promise<string | null> {
  if (!PROPOSAL_ID.test(id)) return null
  const ref = `refs/heads/proposal/${id}`
  if ((await resolveRev(repo, ref)) === null) return null
  return /Built from rev ([0-9a-f]{12}) of the proposal's ops\./.exec(await messageOf(repo, ref))?.[1] ?? null
}

/** The next free `<id>-<n>` under the state directory: a worktree left behind by a failed build never blocks the next. */
function freePath(repo: string, id: string): string {
  const base = join(stateDir(repo), 'proposals')
  mkdirSync(base, { recursive: true })
  for (let n = 1; ; n++) {
    const path = join(base, `${id}-${n}`)
    if (!existsSync(path)) return path
  }
}

/** What each failed build left for the one who runs the server: a sentence naming the worktree it used (removed, or left
 *  behind when git would not remove it), and that path, which never reaches a viewer. The error's own words are untouched. */
const NOTES = new WeakMap<Error, { note: string; paths: string[] }>()

function withNote<E extends Error>(err: E, note: string, paths: string[]): E {
  NOTES.set(err, { note, paths })
  return err
}

/**
 * A failed build in words for anyone reading the proposal: ops that do not validate are named field by field
 * (`projects:p1 · lead: …`), anything else by the first line of its message, with the build's worktree path (which a
 * hook's words can carry) put in words. The worktree note, which holds that local path, is given as `left`, for the
 * server's log, and never in `words`.
 */
export function buildFailureWords(err: Error): { words: string; left: string | null } {
  const noted = NOTES.get(err)
  const hide = (text: string): string => (noted ? noted.paths.reduce((t, p) => t.split(p).join("the build's worktree"), text) : text)
  if (err instanceof StageRefusal && err.errors.length > 0) {
    return { words: hide(err.errors.map(e => `${e.record}${e.field ? ` · ${e.field}` : ''}: ${e.message}`).join('; ')), left: noted?.note ?? null }
  }
  return { words: hide(err.message.trim().split('\n')[0] ?? ''), left: noted?.note ?? null }
}

/** How a build commits: `change` names the content commit's `Org-Change`; `ident` authors and commits it (L5 spec §6.4:
 *  `commitIdent` of the actor whose act builds it, the house for a signed-in actor; absent, git's identity, as 0.6). */
export interface BuildOptions { change?: string; ident?: GitIdent }

/**
 * Build `proposal/<id>` on `fromRev` (the trunk tip `T`), or leave it be when it already holds exactly that.
 * Always builds, in a fresh detached worktree (steps 1 to 3 of spec §3.5), and compares tree ids before the ref is
 * touched: if the branch exists, its tip's first parent is `from` and its tree id equals the new commit's, the ref
 * is not moved, the worktree is already gone, and the existing tip is returned; the new commit stays unreferenced
 * for git to collect. Otherwise the ref is moved with the old tip as the compare-and-swap value (all zeros when
 * it is created), and a branch that moved under us is refused.
 *
 * Refuses, in words, before anything moves: an op staged against a record that has since changed on `from`
 * (409 `STALE`, naming the records), ops that change nothing (409 `NOTHING_TO_BUILD`). A failure inside `applyOps` (a
 * commit hook that refuses, ops that do not validate on `from`) leaves the branch where it was and removes the worktree
 * (applyOps has put its files back, so git removes it without force); the path goes in the note `buildFailureWords`
 * gives for the server's log, never in the error's words, and a worktree git would not remove is left, and the note
 * says so. Callers hold the repository's write lock.
 */
export async function buildBranch(repo: string, proposal: BranchProposal, fromRev: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const { id } = proposal
  if (!PROPOSAL_ID.test(id)) throw new Error(`"${id}" is not a proposal id: expected p-YYYY-MM-DD-NNN-xxxx.`)
  const from = await resolveRev(repo, fromRev)
  if (from === null) throw new Error(`"${fromRev}" names no commit, so no branch can be built on it.`)
  const ref = `refs/heads/proposal/${id}`
  // The branch is a cache; the trunk is where decisions are recorded. A trunk (written, or the branch the repository is
  // on) that carries the branch's own name would be moved to the proposal's commit, with no ratify and no event.
  const [trunk, onBranch] = [await resolveTrunk(repo), (await repoStatus(repo)).branch]
  if (trunk === `proposal/${id}` || onBranch === `proposal/${id}`) {
    throw new Refusal(409, { code: 'BRANCH_IS_TRUNK', error:
      `Cannot build proposal/${id}: it is the trunk (or the branch this repository is on), and the trunk is never a proposal branch. Nothing was built. ` +
      `Switch to your trunk and name it in data/governance.yaml (governance.trunk), then try again.` })
  }
  const old = await resolveRev(repo, ref)

  // 1. a fresh, detached worktree at `from`
  const path = freePath(repo, id)
  await addWorktree(repo, path, from)
  // the path as written and as the filesystem resolves it (a hook that names the directory it runs in gives the second)
  const paths = [...new Set([realpathSync(path), path])]

  // 2. the ops against the records as `from` holds them (a private placeholder names no record)
  const git = gitOpsOf(proposal.ops) as (StageOp & { base: string | null })[]
  const held = proposal.ops.length - git.length
  const stale = staleOps(path, git.map(op => ({ ...op, before: null }) as Op))
  if (stale.length > 0) {
    await removeWorktree(repo, path)
    const records = stale.map(i => git[i]!.record)
    throw new Refusal(409, { code: 'STALE', records, error:
      `Cannot build proposal/${id}: ${stale.length === 1 ? 'one op was' : `${stale.length} ops were`} staged against a record that has changed on the trunk since (${records.join(', ')}). ` +
      `Nothing was built. Keep the proposal's change or take the trunk's, then build again.` })
  }

  // 3. applyOps pointed at the worktree: validates, writes, commits once, with the trailers. A proposal with a private part
  // always has its commit, empty when no file changes, so its ratify merges one (L5 §10.3: git holds only that it changed).
  const rev = revOf(proposal.ops)
  const restricted = `proposal ${id}: ${RESTRICTED_SUBJECT}\n\n${revMark(rev)}`
  const trailers = { actor: proposal.author, change: opts.change, proposal: id }
  let commit: string | null
  try {
    ;({ commit } = git.length > 0
      ? await applyOps(path, git.map(({ base: _base, ...op }) => op as StageOp), {
        message: `proposal ${id}: ${commitMessage(git)}\n\n${revMark(rev)}`, trailers, ident: opts.ident,
        ...(held > 0 ? { emptySubject: restricted } : {}),
      })
      : { commit: held > 0 ? await commitEmpty(path, { message: restricted, trailers, ident: opts.ident }) : null })
  } catch (err) {
    const failed = err instanceof Error ? err : new Error(String(err))
    let removed = true
    try { await removeWorktree(repo, path) } catch { removed = false }
    throw withNote(failed, removed
      ? `The build ran in the worktree ${path}, which was removed.`
      : `The worktree for this build was left behind at ${path}: look at it if you need to, and remove it with \`git worktree remove ${path}\`.`, paths)
  }
  if (commit === null) {
    await removeWorktree(repo, path)
    throw new Refusal(409, { code: 'NOTHING_TO_BUILD', error: `The ops of ${id} change nothing: the trunk already holds the result. Nothing was built.` })
  }

  // 4. the worktree goes; the commit stays
  await removeWorktree(repo, path)

  // 5. the ref moves only when the tree differs (the idempotence rule), or the tip says it holds another rev
  const tree = await resolveRev(repo, `${commit}^{tree}`)
  if (old !== null && (await resolveRev(repo, `${old}^`)) === from && (await resolveRev(repo, `${old}^{tree}`)) === tree && (await builtRev(repo, id)) === rev) {
    return { tip: old, from, moved: false }
  }
  try {
    await moveProposalBranch(repo, id, commit, old)
  } catch (err) {
    if (err instanceof GitExit) {
      throw new Refusal(409, { code: 'MOVED', error:
        `proposal/${id} was moved by someone else while it was being built, so it was left where they put it. Try again. (git said: ${err.message.trim().split('\n')[0]})` })
    }
    throw err
  }
  return { tip: commit, from, moved: true }
}


// ── replay (spec §3.5): the same build, from the new trunk tip, plus the event that says so ──────

export interface ReplayOptions extends LedgerOptions {
  /** The change id for the content commit's `Org-Change`, when the caller knows it. */
  change?: string
  /** What the author chose for ops whose record changed on the trunk: `mine` re-bases them (same `rev`, a `replay`
   *  event), `theirs` drops the fields the trunk also changed and revises (a new `rev`, a `revise` event). Without
   *  it, such a proposal is refused. */
  choose?: 'mine' | 'theirs'
}

export interface ReplayResult extends BuildResult {
  /** The event written, or null when there was nothing to record. */
  event: LedgerEvent | null
  /** The proposal's `rev` after the call. */
  rev: string
}

type LedgerOp = StageOp & { base: string | null }

/**
 * Whether a mechanical replay of `proposal` onto `tip` has anything to bring (final review I4): the trunk changed one of
 * the files its ops name since the proposal's `base` (`diff-tree` base..tip). A replay's own event commits only the
 * ledger, which no op names, so after it this is false: a replay is a fixed point. A base this repository does not hold
 * cannot say, and reads as yes (the replay then records one it does).
 */
export async function trunkMovedUnder(repo: string, proposal: { base?: unknown; ops: Proposal['ops'] }, tip: string): Promise<boolean> {
  const base = typeof proposal.base === 'string' && /^[0-9a-f]{7,64}$/.test(proposal.base) ? await resolveRev(repo, `${proposal.base}^{commit}`) : null
  if (base === null) return true
  const at = await resolveRev(repo, tip)
  if (at === null || at === base) return false
  const files = new Set(gitOpsOf(proposal.ops).map(op => `data/${parseRecord(String(op.record)).registry}.yaml`))
  return (await treeDiffNames(repo, base, at)).some(path => files.has(path))
}

/** The record as the trunk commit `rev` holds it, or null when it is not there. */
export async function recordAt(repo: string, rev: string, record: string): Promise<Record<string, unknown> | null> {
  const { registry, id } = parseRecord(record)
  let text: string
  try { text = await showFile(repo, rev, `data/${registry}.yaml`) } catch { return null }
  return entriesFromText(text, registry).find(e => named(e, id)) ?? null
}

/** The ops after the author's choice, against the trunk at `from`. The record as it was when the ops were staged is
 *  read from the commit the branch was last replayed onto (`proposal.base`); the ledger does not store `before`. A private
 *  placeholder is kept as it is, after the git ops: the trunk changes nothing it stands for. */
async function chosenOps(repo: string, proposal: Proposal, from: string, choose: 'mine' | 'theirs'): Promise<LedgerOp[]> {
  const was = typeof proposal.base === 'string' && proposal.base !== '' ? await resolveRev(repo, proposal.base) : null
  const out: LedgerOp[] = []
  for (const op of gitOpsOf(proposal.ops) as LedgerOp[]) {
    const current = await recordAt(repo, from, op.record)
    if (isStale({ ...op, before: null } as Op, current)) {
      // Keep mine on an update would make a create from the changed fields alone: a record that is not the one the author saw.
      if (choose === 'mine' && op.op === 'update' && current === null) {
        throw new Refusal(409, { code: 'RECORD_DELETED', records: [op.record], error:
          `${op.record} was deleted on the trunk since this proposal was written, so Keep mine has no record to change. ` +
          `Take theirs (the trunk's deletion stands), or Withdraw the proposal and write a new one. Nothing was changed.` })
      }
      // Take theirs reads the record as it was when the ops were staged; without that commit every field would look changed.
      if (choose === 'theirs' && op.op === 'update' && current !== null && was === null) {
        throw new Refusal(409, { code: 'BASE_LOST', error:
          `The commit this proposal was last built on (${proposal.base || 'none recorded'}) names no commit in this repository, so Take theirs cannot tell which fields the trunk changed. ` +
          `Keep mine, or Withdraw the proposal and write a new one. Nothing was changed.` })
      }
    }
    const before = choose === 'theirs' && was !== null ? await recordAt(repo, was, op.record) : null
    const kept = rebaseOp({ ...op, before } as Op, current, choose)
    if (kept === null) continue
    const { before: _before, ...rest } = kept
    out.push(rest as LedgerOp)
  }
  return [...out, ...(proposal.ops as unknown[]).filter(isPlaceholder) as LedgerOp[]]
}

/**
 * Replay is `buildBranch` again from the trunk's current tip, plus a `replay` event that records the new `base`
 * (`rev` unchanged). It never merges the trunk into the branch: that is what lost the trunk's own work in the first
 * draft (H1). When an op's record changed on the trunk it is refused, until `choose` says what the author wants:
 * `mine` re-bases the ops, `theirs` drops the fields the trunk changed. Either is a `revise` event (new `rev` and ops)
 * when it changes the content, as `theirs` always does and `mine` does when it drops a field the trunk already holds or
 * turns an op into another kind (`rebaseOp`); a `replay` only moves the base (spec §3.5, P2-R7: `rev` is the content).
 * A replay that would change nothing writes nothing.
 * Callers hold the repository's write lock; the event is a commit on the trunk, so the trunk tip the branch was
 * built on is the tip before that commit. Ratify does not replay: it calls `buildBranch` inside its preflight, which
 * writes no event and so does not move the trunk it is about to merge into.
 */
export async function replayBranch(repo: string, proposal: Proposal, fromRev: string, who: LedgerWho, opts: ReplayOptions = {}): Promise<ReplayResult> {
  const from = await resolveRev(repo, fromRev)
  if (from === null) throw new Error(`"${fromRev}" names no commit, so no branch can be built on it.`)
  const build = (ops: LedgerOp[]) => buildBranch(repo, { id: proposal.id, author: proposal.author, ops }, from, { change: opts.change, ident: who.ident })
  let ops = proposal.ops as LedgerOp[]
  let built: BuildResult
  try {
    built = await build(ops)
  } catch (err) {
    if (!(err instanceof Refusal) || err.body.code !== 'STALE' || opts.choose === undefined) throw err
    ops = await chosenOps(repo, proposal, from, opts.choose)
    if (ops.length === 0) {
      throw new Refusal(409, { code: 'NOTHING_LEFT', error:
        `Nothing of this proposal is left once the trunk's changes stand: every field it sets was changed there too. Withdraw it, or write a new one. Nothing was changed.` })
    }
    built = await build(ops)
  }
  const base = from // the whole sha: a short one can be ambiguous, and Take theirs reads the record at it
  const rev = revOf(ops)
  const reopened = ops !== proposal.ops
  const kind: 'replay' | 'revise' = reopened && rev !== proposal.rev ? 'revise' : 'replay'
  // Nothing moved and nothing was re-chosen: the branch already stands on `from`, so there is nothing to say. (An event is a
  // commit on the trunk, which moves the tip: a replay that wrote one every time would be needed again at once.)
  if (!reopened && !built.moved) return { ...built, event: null, rev }
  const fields: Record<string, unknown> = { base }
  if (reopened) { fields.ops = ops; fields.rev = rev }
  const { event } = await updateEntry(repo, proposal.id, { fields, event: kind === 'revise' ? { kind, rev, ops } : { kind, base } }, who, opts)
  return { ...built, event, rev }
}
