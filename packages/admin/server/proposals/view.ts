// packages/admin/server/proposals/view.ts
//
// What a proposal looks like to the one who asks (0.6 P2 spec §3.14, §3.15): the ledger entry with where it stands
// (`derived`), what its rules say (`evaluation`, and each rule as a sentence), which ops are stale, whether its branch
// stands, whether it waits on the actor (`needsYou`), and what the actor may write now (`can`, the machine's answer).
// Reading never writes, with two exceptions the spec asks for, both made inside the write lock: the page of a proposal
// whose branch is missing builds it (the branch is a cache, §3.5), and the page of a proposal waiting on an outside
// system reads it and records what changed (P2-R12, §3.11 "Who triggers a read").

import { HttpError } from '../errors.ts'
import { isKnown, type Actor } from '../actor.ts'
import { Refusal } from '../changes/apply.ts'
import { MachineRefusal } from '../machines.ts'
import { readRuleContext } from '../governance/effective.ts'
import { diffText, resolveRev } from '../git.ts'
import type { RuleSummary } from '../changes/types.ts'
import { currentOf } from '../changes/stage.ts'
import { OUTCOME_TTL_MS } from '../systems/reader.ts'
import { buildBranch, buildFailureWords, builtRev, trunkMovedUnder, type BranchProposal } from './branch.ts'
import { readLedger, resolveTrunk } from './ledger.ts'
import { canWrite, cannotWrite, mayCheck, currentAttach, judgedBy, proposalContext, readOutcome, recordOutcome, type OutcomeSource } from './events.ts'
import type { ProposeDeps } from './propose.ts'
import { actHats, decidersOf, liveEvents, methodOf, type Proposal } from '../../lib/proposals.mjs'
import { HOUSE_IDENT } from '../../lib/trailers.mjs'
import { gitOpsOf } from '../../lib/ops.mjs'
import type { ShownPrivate } from '../private/proposals.ts'
import { hatRef, parseHatRef } from '../../lib/hats.mjs'
import { describeRule, validTrunkName, type Rule, type RoleBook } from '../../lib/rules.mjs'
import type { HatObservation } from '../../lib/hat-readings.mjs'
import type { evaluateAll } from '../../lib/evaluate.mjs'

export type BranchState = 'built' | 'missing'

/** The entry, its rule snapshot replaced by sentences (each rule as `evaluation.parts` holds it, too), and the rest. */
export interface ProposalView extends Omit<Proposal, 'rules'> {
  derived: string
  evaluation: ReturnType<typeof evaluateAll>
  rules: RuleSummary[]
  /** The positions of the ops whose record changed on the trunk since they were staged. */
  stale: number[]
  /** The actor's say is still wanted: a decider whose approval or ballot would count, who has not given one. */
  needsYou: boolean
  /** The events the actor may write now, as the proposal machine says (P4 §3.2: the client never decides). */
  can: string[]
  /** Each event the actor may not write now, with the machine's sentence: what a disabled action says (spec §3.14).
   *  Empty for one who is no member (they only read, and the page says why). */
  cannot: Record<string, string>
  /** Whether Check now may ask the outside system for a reading: true, or why not (POST …/check's guards). */
  check: true | string
  /** Whether `proposal/<id>` stands and, while the proposal is open, holds its current rev (an outdated branch is missing). */
  branchState: BranchState
  /** A read of the outside system failed, or its reading could not be recorded. */
  attention?: { level: 'warn' | 'alert'; text: string }
  /** A proposal on private data (L5 §9.6), as shown to a viewer admitted to all of it: its private ops, merged from the
   *  store, beside its git `ops` (routes.ts, private/proposals.ts `shownTo`). */
  private?: ShownPrivate[]
  /** A proposal on private data shown to a viewer not admitted to it (rule 8): its title is "A change to a restricted
   *  collection" and it carries no op list. */
  restricted?: true
  /** The wearer list that stands for a deciding role's hat was not read whole (L2-C4: a tree off Celo, Ethereum and
   *  Sepolia, or a list that could not be read): the page says "wearer list partial" beside the tally, so "2 of 3" never
   *  reads as the whole role (L5 spec §7.3, Review Focus 5). Absent otherwise. */
  partial?: true
  /** With `partial`: the ids of the rules whose deciding role's hat has that list, so the page says it beside their
   *  tally only, never beside a rule decided by a role written with members (Task 9 M3). */
  partialRules?: string[]
}

/** GET /api/proposals/:id: the view and the diff `git diff <trunk>...proposal/<id>`, null with `note` when there is none. */
export interface ProposalDetail extends ProposalView {
  diff: string | null
  note?: string
  /** Each op's record as the trunk holds it now (null when there is none): what an op changes, and what a stale op finds. */
  current: (Record<string, unknown> | null)[]
}

type Book = RoleBook

/** What every view of one request reads once: the governance and members now, the reading of who asks (their hats, as
 *  observations), the moment, and who asks (null: no member). Each proposal's book is built from these and its own
 *  observations (`judge`, L5 spec §7.3). */
export interface ViewContext { governance: Record<string, unknown>; members: Record<string, unknown>[]; extra: HatObservation[]; now: Date; actor: string | null }

export function viewContext(repo: string, actor: Actor, now: Date): ViewContext {
  const rc = readRuleContext(repo, actor)
  if (rc.governance === null) {
    throw new HttpError(409, `data/governance.yaml cannot be read (${rc.problems[0] ?? rc.shape}), so no proposal can be evaluated.`)
  }
  return { governance: rc.governance, members: rc.members ?? [], extra: rc.observations ?? [], now, actor: isKnown(actor) ? actor.id : null }
}

/** The book proposal `entry` is judged by in this view, and who may write to it. */
export function judge(vc: ViewContext, entry: Proposal): { book: Book; known: string[] } {
  return judgedBy(vc.governance, vc.members, entry, vc.extra)
}

/**
 * The ids of the proposal's rules whose deciding role's hat has a partial wearer list (§7.3; per rule, Task 9 M3): of the
 * readings the proposal recorded on that hat (`opened_as`, each event's `as`, `closed.as`), the one with the highest
 * block, then the latest read time, then the later in the ledger, holds a list that was not read whole (`complete` not true). A complete list read later
 * says, for every account the proposal observed, whether it wears the hat, so it stands over an earlier partial one.
 */
export function partialRules(entry: Proposal, book: Book): string[] {
  const rules = entry.rules ?? []
  const partial = partialHats(entry, actHats(rules, book, 'approve'))
  return rules.filter(r => partial.includes(actHats([r], book, 'approve')[0] ?? '')).map(r => String(r.id))
}

/** Of `hats`, those whose standing list (the latest reading the proposal recorded on it) was not read whole. */
function partialHats(entry: Proposal, hats: string[]): string[] {
  if (hats.length === 0) return []
  const closed = entry.closed as { as?: unknown } | null | undefined
  const acts = [entry.opened_as, ...(entry.events ?? []).map(e => (e as { as?: unknown }).as), closed?.as]
    .filter((a): a is { hat: string; block: number; readAt: string; complete?: unknown } =>
      a !== null && typeof a === 'object' && typeof (a as { block?: unknown }).block === 'number' && typeof (a as { hat?: unknown }).hat === 'string')
  return hats.filter(hat => {
    let held: (typeof acts)[number] | null = null
    for (const a of acts) {
      const p = parseHatRef(a.hat)
      if (!p || hatRef(p.chain, p.hatId) !== hat) continue
      if (!held || a.block > held.block || (a.block === held.block && Date.parse(a.readAt) >= Date.parse(held.readAt))) held = a
    }
    return held !== null && held.complete !== true
  })
}

/** A rule of the snapshot as the Governance page writes a rule in force: one sentence, and where it is written. */
const summary = (id: string, rule: Rule): RuleSummary =>
  ({ direct: methodOf(rule) === 'direct', sentence: describeRule(rule), source: `data/proposals.yaml ${id} rules: ${rule.id}` })

/**
 * Whether the branch stands for the proposal as it is. While the proposal is open, a branch built from another rev (its
 * tip says which, `revMark`: a revise whose build failed leaves the old tip) is outdated, and reads missing until it is
 * built again. A closed proposal's branch is kept as it is and never rebuilt, so it is built when it is there.
 */
export async function branchStateOf(repo: string, entry: Proposal): Promise<BranchState> {
  if (entry.state === 'open') return (await builtRev(repo, String(entry.id))) === entry.rev ? 'built' : 'missing'
  return (await resolveRev(repo, `refs/heads/proposal/${entry.id}`)) === null ? 'missing' : 'built'
}

/**
 * Whether the proposal waits on `actor`: it is open and not stale, and some rule of it that collects approvals or
 * ballots is still pending, names the actor among its deciders, would count their approval (not the author's unless
 * the rule sets `self_approve`), and the machine lets them give it now; and they have not acted yet (an approval or
 * ballot on the current rev, or an objection it has not answered). A consent window asks nobody to act.
 */
export function needsYou(entry: Proposal, state: string, evaluation: ReturnType<typeof evaluateAll>, can: string[], actor: string, book: Book): boolean {
  if (entry.state !== 'open' || state === 'stale') return false
  const acted = liveEvents(entry as never).some(e => e.by === actor && (e.kind === 'approve' || e.kind === 'vote' || (e.kind === 'object' && !e.answered)))
  if (acted) return false
  return evaluation.parts.some(({ rule, evaluation: ev }) => {
    const method = methodOf(rule)
    if (ev.state !== 'pending' || !['approve', 'direct', 'vote'].includes(String(method))) return false
    if (!decidersOf(rule, book).includes(actor)) return false
    if (method !== 'vote' && actor === entry.author && (rule as { self_approve?: boolean }).self_approve !== true) return false
    return can.includes(method === 'vote' ? 'vote' : 'approve')
  })
}

/** Whether a mechanical replay of an open proposal would bring anything from the trunk's tip (final review I4). */
async function replayWanted(repo: string, entry: Proposal): Promise<boolean> {
  if (entry.state !== 'open') return false
  const trunk = await resolveTrunk(repo)
  return trunkMovedUnder(repo, entry, validTrunkName(trunk) === true ? `refs/heads/${trunk}` : 'HEAD')
}

/** The view of one entry. */
export async function viewOf(repo: string, entry: Proposal, vc: ViewContext): Promise<ProposalView> {
  const trunkMoved = vc.actor !== null && (await replayWanted(repo, entry))
  const { book, known } = judge(vc, entry)
  const { state, context, evaluation, stale } = proposalContext(repo, entry, vc.now, book, known, { trunkMoved })
  const can = vc.actor === null ? [] : canWrite(state, context, entry, vc.actor)
  const cannot = vc.actor === null ? {} : cannotWrite(state, context, entry, vc.actor)
  const { rules, ...rest } = entry
  return {
    ...rest, derived: state, evaluation, rules: (rules ?? []).map(r => summary(String(entry.id), r)), stale,
    needsYou: vc.actor === null ? false : needsYou(entry, state, evaluation, can, vc.actor, book),
    can, cannot, check: vc.actor === null ? 'only a member can ask the system for a reading.' : mayCheck(entry, state, context),
    branchState: await branchStateOf(repo, entry),
    ...(() => { const ids = partialRules(entry, book); return ids.length > 0 ? { partial: true as const, partialRules: ids } : {} })(),
  }
}

/** The entries of the ledger, or a 409 that says why the file cannot be read. */
function entriesOf(repo: string): Proposal[] {
  const read = readLedger(repo)
  if (read.problems.length > 0) throw new Refusal(409, { code: 'LEDGER', error: read.problems[0]! })
  return read.entries
}

/** The view of proposal `id` as `actor` sees it now; 404 when the ledger does not hold it. */
export async function viewById(repo: string, id: string, actor: Actor, now: Date): Promise<ProposalView> {
  const entry = entriesOf(repo).find(e => String(e.id) === id)
  if (!entry) throw new HttpError(404, `The ledger has no proposal ${id}.`)
  return viewOf(repo, entry, viewContext(repo, actor, now))
}

/** GET /api/proposals: every proposal the ledger holds, in its order, as the one who asks (`actor`) sees it. */
export async function listViews(repo: string, actor: Actor, now: Date): Promise<ProposalView[]> {
  const vc = viewContext(repo, actor, now)
  const out: ProposalView[] = []
  for (const entry of entriesOf(repo)) out.push(await viewOf(repo, entry, vc))
  return out
}

export interface DetailDeps extends Pick<ProposeDeps, 'build' | 'startBranch'> {
  withLock: <T>(fn: () => Promise<T>) => Promise<T>
  now: Date
  /** The outside systems' reader. Absent: a visit reads nothing and says so. */
  systems?: OutcomeSource
  /** When each attach was last read by a visit, and what it raised: a visit reads at most once per the reader's window. */
  visits: Map<string, { at: number; attention?: ProposalView['attention'] }>
  /** The last build a visit tried that failed, per proposal: the rev and the trunk tip it was tried at, and the note. A
   *  visit does not try again at the same rev and tip, which would fail the same way (and run the hooks again). */
  failedBuilds: Map<string, { rev: string; tip: string; note: string }>
  /** Hosted (L9 §5.5): the branch a visit builds is authored by the Hub. */
  hosted?: boolean
  /** Writes are off (Lane 3 Task 11, C1): a visit builds no branch and records no system reading. */
  readOnly?: boolean
}

/** The note a visit answers while writes are off and the proposal's branch is missing or outdated. */
export const READ_ONLY_NO_DIFF = (id: string) => `There is no diff to show: this Hub is read-only, so it builds no branch for proposal ${id}.`

const firstLine = (err: unknown): string => (err instanceof Error ? err.message : String(err)).trim().split('\n')[0] ?? ''

/**
 * A page visit's system read (P2-R12): when the proposal is open and has a live attach on its current rev, and the one
 * visiting is a member, read the outcome as POST …/check does (outside the write lock), and record a changed reading
 * (inside it). At most once per attach per the reader's window (`OUTCOME_TTL_MS`). A failed read records nothing and is
 * the view's attention; so is a reading that could not be recorded. A proposal the machine takes no system event for now
 * (a stale one) is not read.
 */
async function visitRead(repo: string, actor: Actor, entry: Proposal, deps: DetailDeps): Promise<ProposalView['attention']> {
  const attach = currentAttach(entry)
  // Recording a reading appends to the ledger (ledger 149's path): not while writes are off.
  if (deps.readOnly || !isKnown(actor) || entry.state !== 'open' || !attach) return undefined
  const key = `${entry.id}\0${attach.id}`
  const last = deps.visits.get(key)
  if (last && deps.now.getTime() - last.at < OUTCOME_TTL_MS) return last.attention
  let attention: ProposalView['attention']
  try {
    const read = await readOutcome(repo, actor, String(entry.id), deps.systems, deps.now)
    deps.visits.set(key, { at: deps.now.getTime() })
    const recorded = await deps.withLock(() => recordOutcome(repo, actor, String(entry.id), read, { now: () => deps.now, startBranch: deps.startBranch }))
    attention = recorded.attention
  } catch (err) {
    if (err instanceof MachineRefusal) return undefined
    if (!(err instanceof HttpError)) throw err
    attention = { level: 'warn', text: `the system's reading was not recorded: ${firstLine(err)}` }
  }
  deps.visits.set(key, { at: deps.now.getTime(), ...(attention ? { attention } : {}) })
  return attention
}

/** `git diff <trunk>...proposal/<id>`, building the branch first (inside the write lock) when the proposal is open and
 *  its branch is missing or outdated; null, with the reason, when there is no branch to diff. A build that failed at the
 *  proposal's rev and the trunk's tip is not tried again by a visit until one of them moves: its note is answered. */
async function diffOf(repo: string, id: string, deps: DetailDeps): Promise<{ diff: string | null; note?: string }> {
  const trunk = await resolveTrunk(repo, deps.startBranch)
  const named = validTrunkName(trunk)
  if (named !== true) return { diff: null, note: `There is no diff to show: "${trunk}" cannot be the trunk: ${named}` }
  const ref = `refs/heads/proposal/${id}`
  const outdated = async (entry: Proposal) => entry.state === 'open' && (await branchStateOf(repo, entry)) === 'missing'
  const read = () => entriesOf(repo).find(e => String(e.id) === id) ?? null
  const first = read()
  if (first && deps.readOnly && (await outdated(first))) return { diff: null, note: READ_ONLY_NO_DIFF(id) }
  if (first && (await outdated(first))) {
    // Built only under the lock, and only if, read again there, it still needs it: another request may have built it,
    // or revised the proposal, since the first look.
    const note = await deps.withLock(async (): Promise<string | undefined> => {
      const entry = read()
      if (!entry || !(await outdated(entry))) return undefined
      if (entry.ops.length === 0) return `There is no diff to show: proposal ${id} changes no file.`
      const tip = await resolveRev(repo, `refs/heads/${trunk}`)
      if (tip === null) return `There is no diff to show: this repository has no branch "${trunk}" to build proposal/${id} on.`
      const tried = deps.failedBuilds.get(id)
      if (tried && tried.rev === entry.rev && tried.tip === tip) return tried.note
      try {
        await (deps.build ?? buildBranch)(repo, { id, author: entry.author, ops: entry.ops as BranchProposal['ops'] }, tip, deps.hosted ? { ident: HOUSE_IDENT } : {})
        deps.failedBuilds.delete(id)
        return undefined
      } catch (err) {
        if (!(err instanceof Error)) throw err
        // Every viewer reads the note: the field errors, never the local path a failed build used, which is logged here.
        const { words, left } = buildFailureWords(err)
        if (left) console.warn(`proposal/${id} could not be built for a page visit: ${left}`)
        const failed = `There is no diff to show: proposal/${id} could not be built: ${words}`
        deps.failedBuilds.set(id, { rev: String(entry.rev), tip, note: failed })
        return failed
      }
    })
    if (note) return { diff: null, note }
  }
  if ((await resolveRev(repo, ref)) === null) {
    return { diff: null, note: `There is no diff to show: proposal ${id} is ${first?.state ?? 'not in the ledger'}, and its branch proposal/${id} is not in this repository.` }
  }
  return { diff: await diffText(repo, `refs/heads/${trunk}`, ref) }
}

/** GET /api/proposals/:id: the view, the diff, each op's record now, and a visit's system read. 404 for a proposal the ledger does not hold. */
export async function detailView(repo: string, id: string, actor: Actor, deps: DetailDeps): Promise<ProposalDetail> {
  const found = entriesOf(repo).find(e => String(e.id) === id)
  if (!found) throw new HttpError(404, `The ledger has no proposal ${id}.`)
  const attention = await visitRead(repo, actor, found, deps)
  const diff = await diffOf(repo, id, deps)
  const entry = entriesOf(repo).find(e => String(e.id) === id) ?? found
  const view = await viewOf(repo, entry, viewContext(repo, actor, deps.now))
  // The git ops' records (a private placeholder names none): positions as `stale` counts them.
  const current = gitOpsOf(entry.ops).map(op => currentOf(repo, String(op.record)))
  return { ...view, ...diff, current, ...(attention ? { attention } : {}) }
}
