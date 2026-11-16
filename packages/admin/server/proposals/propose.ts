// packages/admin/server/proposals/propose.ts
//
// Propose (0.6 P2 spec §3.4): the actor's staged change becomes a proposal. Every refusal is in words and
// happens before anything is written; then one commit on the trunk holds the new ledger entry (P2-R25: the
// commit first), then the branch is built, and a failure to build it does not undo the proposal. Clearing the
// change is the caller's, once this returns. Callers hold the repository's write lock.

import { HttpError } from '../errors.ts'
import { commitIdent, type Actor } from '../actor.ts'
import { Refusal, StageRefusal, narrowedHereErrors } from '../changes/apply.ts'
import { refuseOthersLink } from '../visibility/widen.ts'
import { readConfig } from '../visibility/config.ts'
import { Levels } from '../visibility/gate.ts'
import { refuseNarrowed } from '../private/guard.ts'
import { changeClasses, knowledgeOpErrors, staleOps, targetsOf, validateChange } from '../changes/stage.ts'
import { registriesOf } from '../registries.ts'
import type { Change, Op } from '../changes/types.ts'
import { withoutBefore } from '../workspace/files.ts'
import { effectiveRule, noRuleCovers, readRuleContext } from '../governance/effective.ts'
import { sealReceipts } from '../library/seal.ts'
import { FETCH_FRESH_MS, lastFetch, resolveRev } from '../git.ts'
import { buildBranch, buildFailureWords, type BranchProposal, type BuildOptions, type BuildResult } from './branch.ts'
import { actObservations, bookOf, createEntry, readLedger, resolveTrunk, type LedgerOptions } from './ledger.ts'
import { proposalId, revOf, methodOf, type Proposal } from '../../lib/proposals.mjs'
import { WORKSPACE_DIRECT, WORKSPACE_SUGGEST, SUGGEST_WEARERS_PARTIAL, SUGGEST_WEARERS_UNREAD, effectiveRules, maintainerHat, mayPropose, rulesForTargets, suggestDecidable, validTrunkName, type Rule } from '../../lib/rules.mjs'
import type { HatObservation } from '../../lib/hat-readings.mjs'
import type { HatWearers } from '../session/membership.ts'
import type { Viewer } from '../../lib/visibility.mjs'
import { aroundGit, privateClasses, STORE_FAILED, type StagedPrivateOp } from '../private/ops.ts'
import { pendingPart } from '../private/proposals.ts'
import { privateTargetsOf } from '../private/targets.ts'
import { refuseCouncilProposed } from '../workspace/memory.ts'
import { judgePrivate, moveTargets, planMoves } from '../workspace/move.ts'
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
  /** DAO-OS L6 R-L6-SUGGEST-2: the change comes from Suggest (POST /api/sessions/:sid/suggest), a proposal its author chose
   *  instead of saving. A change they may apply alone is then proposed, not refused DIRECT: under the rule that raises
   *  its target when there is one, else under WORKSPACE_SUGGEST. The entry is marked `suggested: true`. Never read from a
   *  request body. */
  suggested?: boolean
  /** Who wears a hat now (`hatWearersReadOf`, through the app's Membership): a suggestion's `maintainer` role, when it is
   *  sourced from a hat, is judged by the org's wearers of it, as Ratify judges its deciders — never by the suggester's own
   *  reading (fix round 1, review S1). Absent, or answering a refusal: the wearers are not known, and a suggestion that
   *  role decides is refused with SUGGEST_WEARERS_UNREAD, never with NO_SUGGEST_DECIDERS. */
  wearers?: HatWearers
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
  // Council memory is written at once or not at all (R-L6-T15-2, Task 15 review I-1).
  if (priv) refuseCouncilProposed(priv.ops)
  // A git op writing a field narrowed since it was staged is told what to do (R-L5-16.10).
  refuseNarrowed(ops, readConfig(repo), 'Not proposed')
  // A value typed beside a narrowing of its field in the same change is refused as Apply refuses it (PF-R15, L6 carries K1),
  // so it never sits in a ledger op.
  const narrowedHere = narrowedHereErrors(repo, ops, 'Not proposed')
  if (narrowedHere.length > 0) throw new StageRefusal(narrowedHere)
  // A wallet link is widened only by its own person (L5 §9.7).
  refuseOthersLink(repo, ops, actor.id)
  // A knowledge op on a canon kms reads differently from the house is not proposed either (PF-R2): its classes would be
  // judged on a reading kms does not share.
  const canon = knowledgeOpErrors(ops, registriesOf(repo), repo, 'Nothing was written.')
  if (canon.length > 0) throw new StageRefusal(canon)

  // 1. which rules (spec §3.4 step 1), then whether a proposal is needed at all (step 2)
  const ctx = readRuleContext(repo, actor)
  if (ctx.governance === null) {
    throw refuse(409, 'GOVERNANCE', `Not proposed: ${ctx.org}'s data/governance.yaml cannot be read (${ctx.problems[0] ?? ctx.shape}). Nothing was written.`)
  }
  // Its git ops' classes, then its private part's (L5 §10.3: the rule judged is the class of the registry or private collection).
  // A private record's widening (R-L5-16.8) is read from the store's op as staged now, beside the placeholders' flags.
  const classes = [...new Set([...changeClasses(change, repo), ...(priv ? privateClasses(priv.store, priv.ops) : [])])]
  // Where each op is judged (L6 §3.2): a workspace op at its targets. workspace/direct is no written rule, so a proposal
  // never holds it: what it covers rides along under the rules the rest is decided by.
  // A move into git (L6 §12) is judged where it lands as well (R-L6-T11-4); one that cannot be planned is refused at step 3.
  let landing: string[][] = []
  if (priv) { try { landing = moveTargets(repo, planMoves(repo, priv.store, priv.ops, readConfig(repo), priv.viewer)) } catch { landing = [] } }
  // The private part at its own targets, read from the store's ops as they stand now (Task 15 review I-1).
  const targets = [...targetsOf(change, repo), ...(priv ? privateTargetsOf(repo, priv.store, priv.ops) : []), ...landing]
  // The book holds the actor's reading and the act's own (L5 spec §7.3): a proposer under a role sourced from a hat.
  const members = ctx.members ?? [{ id: actor.id, kind: actor.kind }]
  const observed: HatObservation[] = [...actObservations(null, deps.as), ...(ctx.observations ?? [])]
  let book = bookOf(ctx.governance, members, null, observed)
  const rules: Rule[] = []
  for (const { targets: [cls], rule } of rulesForTargets(effectiveRules(ctx.governance).rules, targets)) {
    if (rule === null) {
      throw refuse(409, 'NO_RULE', `${noRuleCovers(cls)} Nothing was written.`)
    }
    if (rule !== WORKSPACE_DIRECT && !rules.some(r => r.id === rule.id)) rules.push(rule)
  }
  for (const rule of rules) {
    const may = mayPropose(rule, actor.id, book)
    if (may !== true) throw new Refusal(403, { reason: may, error: may })
  }
  const judged = effectiveRule(ctx, classes, targets)
  if (judged.direct && !deps.suggested) {
    const under = [...rules.map(r => r.id), ...(rules.length === 0 ? [WORKSPACE_DIRECT.id] : [])]
    throw refuse(409, 'DIRECT', `You may apply this change yourself under ${under.map(id => `rule "${id}"`).join(' and ')}, so no proposal was opened. Use Apply.`)
  }
  // A suggestion of what workspace/direct covers (R-L6-SUGGEST-2): decided by the org's maintainers under the built-in
  // rule, never by its author alone; refused in words when nobody else would decide it. A `maintainer` role sourced from a
  // hat is worn by whoever wears it, which one actor's reading cannot say (fix round 1, review S1): its wearers are read as
  // Ratify reads its deciders, and a read that fails is not the claim that nobody decides it.
  if (judged.direct && rules.length === 0) {
    const hat = maintainerHat(book)
    let partial = false
    if (hat !== undefined) {
      const worn = await deps.wearers?.(hat)
      if (worn === undefined || !worn.ok) {
        throw new Refusal(502, { code: 'HATS_UNREADABLE', error: SUGGEST_WEARERS_UNREAD })
      }
      book = bookOf(ctx.governance, members, null, [
        ...observed,
        ...worn.accounts.map(account => ({ hat, account, wears: true, block: worn.block, at: worn.readAt })),
      ])
      partial = !worn.complete
    }
    const decidable = suggestDecidable(book, actor.id)
    // A list not read whole names some wearers, not all (fix round 2, review I3): another wearer on it decides, and with
    // none on it who would is not known, which is never "nobody" nor "only you".
    if (decidable !== true && partial) throw new Refusal(502, { code: 'HATS_UNREADABLE', error: SUGGEST_WEARERS_PARTIAL })
    if (decidable !== true) throw refuse(409, 'NO_DECIDERS', decidable)
    rules.push(WORKSPACE_SUGGEST as Rule)
  }
  // A workspace write the actor may not make (L6 §3.2, `mayWriteWorkspace`) has no rule to be proposed under.
  if (rules.length === 0) throw new Refusal(403, { reason: judged.sentence, error: judged.sentence })

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
  // A move is planned as its apply will plan it (L6 §12): refused 409 `MOVE` in its own words.
  if (priv) judgePrivate(repo, priv.store, priv.ops, priv.viewer, readConfig(repo))

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
  const sealed = sealReceipts(ops, { by: actor.id, at: now.toISOString().slice(0, 10), decision: { proposal: id } }).map(withoutBefore)
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
    // A proposal made by Suggest (R-L6-SUGGEST-2): what decides it may be the built-in workspace/suggest.
    ...(deps.suggested ? { suggested: true } : {}),
    rev: revOf(ledgerOps),
    base: from,
    branch: `proposal/${id}`,
    ops: ledgerOps,
    // What its ops touch, kept for good: a revision records only the ops it writes (L9 Ruling T12-1). Judged on the ops as
    // staged (the record each saw), the placeholders included.
    touched: new Levels(repo).touched([...ops, ...(part?.placeholders ?? [])]),
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
