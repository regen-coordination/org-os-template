// packages/admin/server/proposals/close.ts
//
// The other closings of a proposal (0.6 P2 spec §3.8): `rejected` (the rule failed), `expired` (its time ran out) and
// `withdrawn` (its author takes it back). Like ratify, an act of a person (P2-R3): the clock never closes anything. Each
// is ONE commit on the trunk, no merge, and the proposal's branch is kept.
//
//   withdrawn      served by `writeEvent` (events.ts): the event and the closing in one commit, no decision row. This
//                  module only puts the preflight ratify has in front of it, so the three closings refuse alike.
//   rejected,      two halves, as ratify's, without the merge. The new texts of `data/proposals.yaml` and
//   expired        `data/governance.yaml` (the decision row) are computed from `HEAD`'s texts (with no merge, HEAD is the
//                  tree-to-be) by `planClosing`, and the whole tree is validated, before anything is written. Then each
//                  file is written and staged at once and the commit is made. A failure after the first write puts the
//                  original bytes back and stages them again, so every tracked file is as it was. There is no merge in
//                  progress and so no `merge --abort`.
//
// Callers hold the write lock.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commitIdent, type Actor } from '../actor.ts'
import { Refusal } from '../changes/apply.ts'
import { MachineRefusal } from '../machines.ts'
import { commitDataPaths, resolveRev, restageDataPaths, showFile, trackedChanges, type CommitOptions } from '../git.ts'
import { readLedger, type LedgerOptions } from './ledger.ts'
import { closingPreflight } from './preflight.ts'
import { canWrite, machineContext, writeEvent } from './events.ts'
import { newProblems, planClosing, type DecisionRow, type RatifyDeps } from './ratify.ts'
import { methodOf, type Proposal } from '../../lib/proposals.mjs'
import { evaluateAll } from '../../lib/evaluate.mjs'
import { transition } from '../../lib/machines/run.mjs'
import { proposal as machine, proposalGuards } from '../../lib/machines/proposal.mjs'
import type { TrailerValues } from '../../lib/trailers.mjs'

const LEDGER = 'data/proposals.yaml'
const GOVERNANCE = 'data/governance.yaml'

export const CLOSE_OUTCOMES = ['rejected', 'expired', 'withdrawn'] as const
export type CloseOutcome = typeof CLOSE_OUTCOMES[number]

type KnownActor = Extract<Actor, { id: string }>

/** The steps of a reject or expire that touch the repository; tests replace one to force a failure. */
export interface CloseGit {
  /** How a file is written. */
  write?: (path: string, text: string) => void
  /** `git add` of a file just written. */
  stage?: (repo: string, paths: string[]) => Promise<void>
  /** How the original bytes are put back. */
  restore?: (path: string, bytes: Buffer) => void
  /** `git add` of the original bytes, putting the index back. */
  restage?: (repo: string, paths: string[]) => Promise<void>
  commit?: (repo: string, paths: string[], message: string, trailers: TrailerValues, opts?: CommitOptions) => Promise<string>
}

export interface CloseDeps extends LedgerOptions {
  closeGit?: CloseGit
  /** The whole-tree check over a scratch directory. Default: `validateRepo`. */
  validate?: RatifyDeps['validate']
}

export interface CloseResult {
  proposal: Proposal
  commit: string
  /** The decision row; null for a withdrawal (nobody decided). */
  decision: DecisionRow | null
  branch: 'built' | 'missing'
  evaluation: ReturnType<typeof evaluateAll>
  can: string[]
}

const refuse = (status: 400 | 409 | 500 | 503, code: string, error: string): Refusal => new Refusal(status, { code, error })
const firstLine = (err: unknown): string => (err instanceof Error ? err.message : String(err)).trim().split('\n')[0] ?? ''
const EVENT = { rejected: 'REJECT', expired: 'EXPIRE', withdrawn: 'WITHDRAW' } as const
const KIND = { rejected: 'reject', expired: 'expire' } as const

/**
 * Close proposal `id` as `outcome`, as `actor`. Refuses, in words and before anything is written: a tracked file with
 * uncommitted changes, a merge in progress, a repository off the trunk, a ledger that cannot be read, a proposal that is
 * not there or no longer open, files git does not track, a fetch that is old or behind, a clock behind the ledger, and
 * what the proposal machine says (the rule has not failed, the time has not run out, only the author withdraws, a
 * closing is a person's act).
 */
export async function close(repo: string, actor: KnownActor, id: string, outcome: CloseOutcome, deps: CloseDeps = {}, text?: string): Promise<CloseResult> {
  const clock = (deps.now ?? (() => new Date()))()
  const now = new Date(Math.floor(clock.getTime() / 1000) * 1000) // git dates a commit in whole seconds (LOW-5)
  const nothing = 'Nothing was written.'

  // preflight: the one ratify has (preflight.ts), without the merge
  const { entry } = await closingPreflight(repo, id, now, {
    not: 'Not closed', act: 'a proposal is closed',
    clean: 'a closing starts from a clean tree, because it puts the files back from what git holds if it fails.',
    untracked: 'A closing writes it, and it cannot be put back if git does not track it.',
  }, () => (outcome === 'withdrawn' ? [LEDGER] : [LEDGER, GOVERNANCE]), deps.startBranch, deps.hosted)

  // the machine decides, with the evaluation at the whole second
  const { state, context, evaluation } = machineContext(repo, actor, entry, now, { as: deps.as })
  const type = EVENT[outcome]
  const decided = transition(machine, proposalGuards, state, { type, by: actor.id }, context)
  if (!decided.ok) throw new MachineRefusal(machine.id, state, type, decided.reason)

  if (outcome === 'withdrawn') {
    // already one commit: the event and the closing together, no row (events.ts)
    const done = await writeEvent(repo, actor, id, { kind: 'withdraw', ...(text !== undefined ? { text } : {}) }, { ...deps, now: () => now })
    return { ...done, decision: null }
  }

  // reject, expire: the texts of the tree-to-be, which is HEAD's (no merge), computed and validated first
  const kind = KIND[outcome]
  let texts: { proposals: string; governance: string }
  try { texts = { proposals: await showFile(repo, 'HEAD', LEDGER), governance: await showFile(repo, 'HEAD', GOVERNANCE) } } catch (err) {
    throw refuse(409, 'CANNOT_RECORD', `Not closed: ${firstLine(err)} ${nothing}`)
  }
  let planned: ReturnType<typeof planClosing>
  try { planned = planClosing({ entry, proposals: texts.proposals, governance: texts.governance, evaluation, actor: actor.id, now, kind, as: deps.as }) } catch (err) {
    throw refuse(409, 'CANNOT_RECORD', `Not closed: ${firstLine(err)} ${nothing}`)
  }
  if (!planned.ok) throw refuse(409, 'CANNOT_RECORD', `Not closed: ${planned.reason} ${nothing}`)
  const plan = [{ path: LEDGER, text: planned.ledger }, { path: GOVERNANCE, text: planned.governance }]
  const problems = await newProblems(repo, 'HEAD', { files: plan }, deps.validate)
  if (problems.length > 0) {
    throw new Refusal(422, { code: 'INVALID', error: `Not closed: the trunk would not hold valid data after this closing (${problems[0]!.file}: ${problems[0]!.message}). ${nothing}`, errors: problems })
  }

  // each file written and staged at once, then the commit; the bytes read now are what a failure puts back
  const write = deps.closeGit?.write ?? ((path: string, text: string) => writeFileSync(path, text))
  const stage = deps.closeGit?.stage ?? restageDataPaths
  const restore = deps.closeGit?.restore ?? ((path: string, bytes: Buffer) => writeFileSync(path, bytes))
  const restage = deps.closeGit?.restage ?? restageDataPaths
  const commitIt = deps.closeGit?.commit ?? ((r: string, p: string[], m: string, t: TrailerValues, o?: CommitOptions) => commitDataPaths(r, p, m, t, o))
  const rollback = new Map<string, Buffer>()
  for (const f of plan) {
    const path = join(repo, f.path)
    const working = existsSync(path) ? readFileSync(path) : null
    if (working === null || working.toString('utf8') !== (f.path === LEDGER ? texts.proposals : texts.governance)) {
      throw refuse(409, 'TREE_DIFFERS', `Not closed: ${f.path} in the working tree differs from the one HEAD holds (a conversion of line endings, or a filter, changed it), so a closing will not guess which to write. ${nothing}`)
    }
    rollback.set(f.path, working)
  }
  const written: string[] = []
  const undo = async (why: string): Promise<never> => {
    const lost: string[] = []
    const back: string[] = []
    for (const p of written) {
      try { restore(join(repo, p), rollback.get(p) as Buffer); back.push(p) } catch { lost.push(p) }
    }
    let said = lost.length > 0 ? `${lost.join(', ')} could not be put back` : ''
    // only a file whose bytes are back is added again: adding a file that still holds the closing's text would stage it
    try { if (back.length > 0) await restage(repo, back) } catch (err) { said = `${said}${said ? '; ' : ''}the index could not be put back (${firstLine(err)})` }
    if (said === '') {
      try {
        const left = await trackedChanges(repo)
        if (left.length > 0) said = `changes are left in ${left.join(', ')}`
      } catch (err) { said = `the repository could not be read afterwards (${firstLine(err)})` }
    }
    throw said !== ''
      ? refuse(500, 'CLOSE_STUCK', `Not closed: ${why}. Putting the files back did not leave the repository as it was: ${said}. Nothing else was run to repair it; \`git status\` in the repository shows where it stands.`)
      : refuse(503, 'CLOSE_UNDONE', `Not closed: ${why}. The files are as they were.`)
  }
  for (const f of plan) {
    written.push(f.path)
    try {
      write(join(repo, f.path), f.text)
      await stage(repo, [f.path])
    } catch (err) {
      return undo(`${f.path} could not be written or staged (${firstLine(err)})`)
    }
  }
  const message = `proposals: ${kind} ${id} — ${entry.title}`
  const trailers: TrailerValues = { actor: actor.id, rule: entry.rules.map(r => `${r.id}/${methodOf(r)}`).join(','), proposal: id, decision: planned.decision.id }
  let commit: string
  try { commit = await commitIt(repo, [LEDGER, GOVERNANCE], message, trailers, { ident: commitIdent(actor) }) } catch (err) {
    return undo(`git refused the commit (${firstLine(err)}); if a commit hook refused it, the reason is the hook's`)
  }

  const after = readLedger(repo).entries.find(e => String(e.id) === id) as Proposal
  const now2 = machineContext(repo, actor, after, now)
  const branch = (await resolveRev(repo, `refs/heads/${after.branch ?? `proposal/${id}`}`)) === null ? 'missing' : 'built'
  return { proposal: after, commit, decision: planned.decision, branch, evaluation: now2.evaluation, can: canWrite(now2.state, now2.context, after, actor.id) }
}
