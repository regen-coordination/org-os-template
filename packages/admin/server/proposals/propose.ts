// packages/admin/server/proposals/propose.ts
//
// Propose (0.6 P2 spec §3.4): the actor's staged change becomes a proposal. Every refusal is in words and
// happens before anything is written; then one commit on the trunk holds the new ledger entry (P2-R25: the
// commit first), then the branch is built, and a failure to build it does not undo the proposal. Clearing the
// change is the caller's, once this returns. Callers hold the repository's write lock.

import { HttpError } from '../errors.ts'
import { commitIdent, type Actor } from '../actor.ts'
import { Refusal, StageRefusal } from '../changes/apply.ts'
import { refuseOthersLink } from '../visibility/widen.ts'
import { readConfig } from '../visibility/config.ts'
import { refuseNarrowed } from '../private/guard.ts'
import { changeClasses, staleOps, validateChange } from '../changes/stage.ts'
import type { Change, Op } from '../changes/types.ts'
import { effectiveRule, readRuleContext } from '../governance/effective.ts'
import { sealReceipts } from '../library/seal.ts'
import { FETCH_FRESH_MS, lastFetch, resolveRev } from '../git.ts'
import { buildBranch, buildFailureWords, type BranchProposal, type BuildOptions, type BuildResult } from './branch.ts'
import { actObservations, bookOf, createEntry, readLedger, resolveTrunk, type LedgerOptions } from './ledger.ts'
import { proposalId, revOf, methodOf, type Proposal } from '../../lib/proposals.mjs'
import { effectiveRules, mayPropose, rulesForClasses, validTrunkName, type Rule } from '../../lib/rules.mjs'
import type { Viewer } from '../../lib/visibility.mjs'
import { aroundGit, privateClasses, resolvePrivate, STORE_FAILED, type StagedPrivateOp } from '../private/ops.ts'
import { pendingPart } from '../private/proposals.ts'
import type { PrivateStore } from '../private/store.ts'

/** How old the last fetch may be before Propose asks for a Sync first (spec §3.12). */
export { FETCH_FRESH_MS }

export interface ProposeInput {
  title: string
  rationale?: string
  /** Present means the proposal is recorded as a decision (§3.9); checked by the ledger's schema. */
  statement?: Record<string, unknown>
}

export interface ProposeDeps extends LedgerOptions {
  /** Builds `proposal/<id>`; tests pass one that fails. Default: `buildBranch`. */
  build?: (repo: string, proposal: BranchProposal, from: string, opts: BuildOptions) => Promise<BuildResult>
}

/** A change's private part as Propose (or Revise) carries it (L5 spec §9.6, §10.3): the store, the staged ops read back from
 *  it, and who proposes them, judged on the levels they write at now. */
export interface ProposedPrivate { store: PrivateStore; ops: StagedPrivateOp[]; viewer: Viewer }

export interface ProposeResult {
  /** The entry as written. */
  proposal: Proposal
  /** The trunk commit that holds it. */
  commit: string
  /** Whether `proposal/<id>` stands; when it does not, `note` says it will be built. */
  branch: 'built' | 'missing'
  note?: string
}

const seconds = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z')
const refuse = (status: 403 | 409, code: string, error: string): Refusal => new Refusal(status, { code, error })
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** "Sync first" (P2-R31): Propose reads the last fetch and never fetches. With no remote, or a remote that has no trunk
 *  (F-L3-2), there is nothing to be behind; hosted, the check does not apply. */
export async function guardFetched(repo: string, trunk: string, now: Date, act = 'a proposal is opened', opts: { hosted?: boolean } = {}): Promise<void> {
  if (opts.hosted) return // hosted, the platform holds the trunk: there is no clone to be behind
  const fetch = await lastFetch(repo, trunk, now)
  if (fetch.state === 'no remote' || fetch.state === 'remote has no trunk') return
  const sync = 'Sync first, then try again. Nothing was written.'
  if (fetch.state === 'never fetched') throw refuse(409, 'SYNC_FIRST', `Sync first: this repository has never fetched from its remote, so it cannot tell whether the trunk is behind. ${sync}`)
  if (fetch.state === 'the last fetch was not of the trunk') {
    throw refuse(409, 'SYNC_FIRST', `Sync first: the last fetch was not of the trunk, "${trunk}", so it says nothing about whether the trunk is behind. ${sync}`)
  }
  if (fetch.state === 'no local trunk') throw refuse(409, 'SYNC_FIRST', `Sync first: this repository has no local branch "${trunk}" to propose on. ${sync}`)
  const age = now.getTime() - (fetch.fetchedAt as Date).getTime()
  if (age > FETCH_FRESH_MS) {
    // rounded up, so the sentence never says "15 minutes ago" of a fetch older than the 15 allowed
    const minutes = Math.ceil(age / 60e3)
    throw refuse(409, 'SYNC_FIRST', `Sync first: the last fetch was ${minutes} minutes ago, and ${act} on a fetch no older than ${FETCH_FRESH_MS / 60e3} minutes. ${sync}`)
  }
  if (fetch.behind > 0) {
    throw refuse(409, 'SYNC_FIRST', `Sync first: the remote has ${plural(fetch.behind, 'commit', 'commits')} you have not merged. ${sync}`)
  }
}

/**
 * Turn `change` (the actor's staged ops) into a proposal. Refuses, in the order of spec §3.4 and before anything is
 * written: a change with no ops (400), a class no rule covers (409 `NO_RULE`), an actor who may not propose under a rule
 * (403 with its sentence), a change the actor may apply alone (409 `DIRECT`: use Apply, nothing opens), an op staged
 * against a record that has changed (409 `STALE`), ops that do not validate as they would be (422 with the fields), a
 * private part the proposer may not write now (409, as a direct apply judges it: L5 §5.2, R-L5-14.11), a trunk name the
 * platform cannot build refs from (409 `TRUNK`), and a last fetch that is old or behind the remote (409 `SYNC_FIRST`). The
 * ledger's own guards then speak (off the trunk, a dirty ledger, the clock, the schema, nothing stricter than members).
 *
 * With `priv`, the change's private part (L5 §9.6, §10.3): the ledger holds a placeholder per op, the store's `pending`
 * the ops, and both are written in one store transaction around the ledger's commit, which also takes the change's staged
 * rows; a store that fails after the commit is a 503 naming it (the change is kept, to withdraw and propose again).
 */
export async function propose(repo: string, actor: Extract<Actor, { id: string }>, change: Change, input: ProposeInput, deps: ProposeDeps = {},
  priv?: ProposedPrivate): Promise<ProposeResult> {
  const now = (deps.now ?? (() => new Date()))()
  const ops: Op[] = change.ops
  if (ops.length === 0 && !priv?.ops.length) throw new Refusal(400, { code: 'EMPTY', error: 'Nothing is staged: the change holds no ops to propose.' })
  // A git op writing a field narrowed since it was staged is told what to do (R-L5-16.10).
  refuseNarrowed(ops, readConfig(repo), 'Not proposed')
  // A wallet link is widened only by its own person (L5 §9.7).
  refuseOthersLink(repo, ops, actor.id)

  // 1. which rules (spec §3.4 step 1), then whether a proposal is needed at all (step 2)
  const ctx = readRuleContext(repo, actor)
  if (ctx.governance === null) {
    throw refuse(409, 'GOVERNANCE', `Not proposed: ${ctx.org}'s data/governance.yaml cannot be read (${ctx.problems[0] ?? ctx.shape}). Nothing was written.`)
  }
  // Its git ops' classes, then its private part's (L5 §10.3: the rule judged is the class of the registry or private collection).
  // A private record's widening (R-L5-16.8) is read from the store's op as staged now, beside the placeholders' flags.
  const classes = [...new Set([...changeClasses(change, repo), ...(priv ? privateClasses(priv.store, priv.ops) : [])])]
  // The book holds the actor's reading and the act's own (L5 spec §7.3): a proposer under a role sourced from a hat.
  const book = bookOf(ctx.governance, ctx.members ?? [{ id: actor.id, kind: actor.kind }], null, [...actObservations(null, deps.as), ...(ctx.observations ?? [])])
  const rules: Rule[] = []
  for (const { class: cls, rule } of rulesForClasses(effectiveRules(ctx.governance).rules, classes)) {
    if (rule === null) {
      throw refuse(409, 'NO_RULE', `No rule in data/governance.yaml covers the class ${cls}; nobody can propose it until a rule does. Nothing was written.`)
    }
    if (!rules.some(r => r.id === rule.id)) rules.push(rule)
  }
  for (const rule of rules) {
    const may = mayPropose(rule, actor.id, book)
    if (may !== true) throw new Refusal(403, { reason: may, error: may })
  }
  if (effectiveRule(ctx, classes).direct) {
    throw refuse(409, 'DIRECT', `You may apply this change yourself under ${rules.map(r => `rule "${r.id}"`).join(' and ')}, so no proposal was opened. Use Apply.`)
  }

  // 3. the change as it stands (spec §3.4 step 3: after the rules and the direct answer, so a member who may not propose, or a change that applies alone, is told that first)
  const stale = staleOps(repo, ops)
  if (stale.length > 0) {
    throw new Refusal(409, { stale, code: 'STALE', error:
      `Not proposed: ${stale.length === 1 ? 'one op was' : `${stale.length} ops were`} staged against a record that has changed since. ` +
      `Nothing was written. Take theirs or keep mine on ${stale.length === 1 ? 'it' : 'each'}, then propose again.` })
  }
  const errors = validateChange(repo, ops)
  if (errors.length > 0) throw new StageRefusal(errors)
  // The private part, judged now for the one who proposes it, against the store as it is (its writes are discarded: the
  // ops are applied when the proposal is ratified).
  if (priv) resolvePrivate(priv.store, priv.ops, priv.viewer)

  // 4. the trunk, and the last fetch
  const trunk = await resolveTrunk(repo, deps.startBranch)
  const named = validTrunkName(trunk)
  if (named !== true) {
    throw refuse(409, 'TRUNK', `Not written: "${trunk}" cannot be the trunk: ${named} Name another in data/governance.yaml (governance.trunk), or switch to a branch with an ordinary name.`)
  }
  await guardFetched(repo, trunk, now, 'a proposal is opened', { hosted: deps.hosted })

  // 5. the entry: one commit on the trunk (spec §3.4 step 4). `base` is the trunk tip the ops were checked against and
  // the branch is built on; the entry's own commit comes after it.
  const from = await resolveRev(repo, 'HEAD')
  if (from === null) throw new HttpError(409, 'This repository has no commit yet, so there is no trunk to propose on.')
  const id = proposalId(now, readLedger(repo).entries)
  // A library receipt is proposed sealed: its author, today, and this proposal (the decision row is found by it).
  const sealed = sealReceipts(ops.map(({ before: _before, ...op }) => op), { by: actor.id, at: now.toISOString().slice(0, 10), decision: { proposal: id } })
  // The private part: a placeholder per op after the git ops, its real op in `pending` (§9.6).
  const part = priv ? pendingPart(id, priv.ops) : null
  const ledgerOps = [...sealed, ...(part?.placeholders ?? [])]
  const entry: Record<string, unknown> = {
    id,
    title: input.title,
    ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
    author: actor.id,
    classes,
    rules: JSON.parse(JSON.stringify(rules)) as Rule[],
    state: 'open',
    opened: seconds(now),
    // The reading it was opened on, for an author under a role sourced from a hat or at an address (L5 spec §7.2).
    ...(deps.as ? { opened_as: deps.as } : {}),
    rev: revOf(ledgerOps),
    base: from,
    branch: `proposal/${id}`,
    ops: ledgerOps,
    ...(input.statement !== undefined ? { statement: input.statement } : {}),
    events: [],
    closed: null,
  }
  const who = { actor: actor.id, change: change.id, rule: rules.map(r => `${r.id}/${methodOf(r)}`).join(','), ident: commitIdent(actor) }
  const { commit } = priv && part
    ? await aroundGit(priv.store, {
      before: w => { for (const row of part.rows) w.putPending(row); w.deleteStaged(change.id) },
      git: () => createEntry(repo, entry, who, deps),
      late: out => {
        throw new Refusal(503, { code: 'PRIVATE_STORE', commit: out.commit, proposal: id, error:
          `Proposal ${id} was opened in commit ${out.commit}, but the private store could not keep its restricted part, so the proposal holds ` +
          `placeholders the store does not: withdraw it, then propose the change again from your tray, which still holds it. ${STORE_FAILED}` })
      },
    })
    : await createEntry(repo, entry, who, deps)

  // 6. then the branch; a failure leaves the proposal (P2-R25)
  try {
    await (deps.build ?? buildBranch)(repo, { id, author: actor.id, ops: ledgerOps as BranchProposal['ops'] }, from, { change: change.id, ident: commitIdent(actor) })
    return { proposal: entry as unknown as Proposal, commit, branch: 'built' }
  } catch (err) {
    // The author reads the note: the failure in words, never the local path the build used, which is logged here.
    const { words: why, left } = buildFailureWords(err instanceof Error ? err : new Error(String(err)))
    if (left) console.warn(`proposal/${id} could not be built when it was proposed: ${left}`)
    return {
      proposal: entry as unknown as Proposal, commit, branch: 'missing',
      note: `The proposal ${id} is open, but its branch proposal/${id} could not be built (${why}). The branch will be built again when it is first needed.`,
    }
  }
}
