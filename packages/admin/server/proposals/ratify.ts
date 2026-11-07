// packages/admin/server/proposals/ratify.ts
//
// Ratify (0.6 P2 spec §3.8): a met proposal becomes ONE merge commit on the trunk, holding the proposal's change,
// the ledger closed as `ratified`, the decision row and, with a statement, the DECISIONS.md entry. It is an act of a
// person (P2-R3), judged again here at the whole second of the server's clock (LOW-5); the client's word counts for
// nothing. It is written in two halves (H2):
//
//   `ratify`          steps 1 to 4: the preflight, the branch rebuilt if needed, and every new text computed from the
//                     tree-to-be (`git show <C>:<file>`, never HEAD: N1) and validated. Nothing in the repository's
//                     working tree, index or HEAD changes.
//   `planRatify`      the computation of step 3 and the text checks of step 4: pure, texts in, texts out.
//   `applyRatifyMerge` steps 5 to 8: `merge --no-ff --no-commit`, each file written and staged at once, the staged set
//                     checked, the commit. A failure after the merge started ends in `merge --abort` (P2-R15), the
//                     platform's one undo, with the step-5 bytes put back and staged first (N2); the result is verified.
//
// It never runs generate:schemas (P2-R20), never fetches (P2-R31) and never pushes. Callers hold the write lock.

import { narrowedOps, narrowedSinceProposed } from '../private/guard.ts'
import { readConfig } from '../visibility/config.ts'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { HttpError } from '../errors.ts'
import { commitIdent, type Actor } from '../actor.ts'
import { Refusal } from '../changes/apply.ts'
import { MachineRefusal } from '../machines.ts'
import { parseRecord } from '../changes/records.ts'
import { entriesFromText } from '../registry.ts'
import { REGISTRIES } from '../registries.ts'
import {
  commitMerge, isAncestor, mergeAbort, mergeInProgress, mergeNoFf, resolveRev, showFile,
  stageMergeFiles, stagedNames, trackedChanges, unmergedPaths, type CommitOptions, type GitIdent, type MergeStart,
} from '../git.ts'
import { buildBranch, buildFailureWords, type BranchProposal, type BuildResult } from './branch.ts'
import { closedLedgerText, readLedger, type LedgerOptions } from './ledger.ts'
import { closingPreflight } from './preflight.ts'
import { canWrite, judgedBy, machineContext } from './events.ts'
import { readRuleContext } from '../governance/effective.ts'
import { actUnreadable } from '../session/membership.ts'
import { shortAddress } from '../systems/safe.ts'
import { parseCaip10 } from '../../lib/caip.mjs'
import { hatRef, parseHatRef } from '../../lib/hats.mjs'
import { actorIdOf, observationsOf, walletsOf, type HatAct, type HatObservation } from '../../lib/hat-readings.mjs'
import { eventId, eventPermission, leadMethod, methodOf, type LedgerEvent, type Proposal } from '../../lib/proposals.mjs'
import { evaluateAll } from '../../lib/evaluate.mjs'
import { insertDecisionRow, insertDecisionsMdEntry, nextDecisionId } from '../../lib/decision-write.mjs'
import { decisionRowFor } from '../../lib/decision-row.mjs'
import { validateRepo } from '../../lib/data-validate.mjs'
import { transition } from '../../lib/machines/run.mjs'
import { proposal as machine, proposalGuards } from '../../lib/machines/proposal.mjs'
import type { TrailerValues } from '../../lib/trailers.mjs'
import { gitOpsOf } from '../../lib/ops.mjs'
import { applyPrivate, aroundGit, clearsOf, noStore, reach, STORE_FAILED, unavailable, type PrivateAccess, type StagedPrivateOp } from '../private/ops.ts'
import { decidedWrites, pendingOps, placeholdersOf } from '../private/proposals.ts'
import type { StageOp } from '../changes/types.ts'

const LEDGER = 'data/proposals.yaml'
const GOVERNANCE = 'data/governance.yaml'
const DECISIONS = 'DECISIONS.md'

type KnownActor = Extract<Actor, { id: string }>
type Evaluation = ReturnType<typeof evaluateAll>

/** The row of `governance.decisions` a decided proposal gets (spec §3.9; `status` is the outcome, the schema's word). */
export interface DecisionRow {
  id: string; proposal: string; rule: string; method: string; outcome: 'ratified' | 'rejected' | 'expired'; status: string
  by: string[]; date: string; title: string; summary: string
}

/** The three files ratify writes, as the tree-to-be holds them. `decisions` is null when the proposal has no statement. */
export interface RatifyTexts { proposals: string; governance: string; decisions: string | null }

export interface RatifyPlan {
  /** The new texts, in the order they are written. */
  files: { path: string; text: string }[]
  /** What the merge may stage: the files the ops name and the ledger files (spec §3.8 step 7). */
  allowed: string[]
  decision: DecisionRow
  event: LedgerEvent
  message: string
  trailers: TrailerValues
}

/** The git steps of `applyRatifyMerge`; tests replace one to force a failure, or spy on it. */
export interface MergeDeps {
  merge?: (repo: string, rev: string) => Promise<MergeStart>
  abort?: (repo: string) => Promise<void>
  stage?: (repo: string, paths: string[], allowed: string[]) => Promise<void>
  commit?: (repo: string, message: string, allowed: string[], trailers: TrailerValues, opts?: CommitOptions) => Promise<string>
  /** How a file is written. */
  write?: (path: string, text: string) => void
  /** The reads after the merge began: C's blob (step 5), the staged set and the unmerged entries (step 7), and the
   *  tracked changes the verification after an abort reads. */
  show?: (repo: string, rev: string, path: string) => Promise<string>
  staged?: (repo: string) => Promise<string[]>
  unmerged?: (repo: string) => Promise<string[]>
  tracked?: (repo: string) => Promise<string[]>
  /** Step 2's "already in the trunk" question. */
  isAncestor?: (repo: string, a: string, b: string) => Promise<boolean>
}

/** A row of `closed.checked` (L5 spec §7.2, §7.4): a fresh `wearer` reading of an actor whose act is counted, for one hat
 *  of a deciding role they were counted under. */
export interface DeciderCheck { account: string; hat: string; wears: boolean; block: number; readAt: string }

/** Reads an account's hats now (`Membership.forAct`: a reading no older than the reader's window). */
export type ReadWearer = (account: string) => Promise<{ ok: true; hats: string[]; block: number; readAt: string } | { ok: false; error: string }>

export interface RatifyDeps extends LedgerOptions {
  /** The fresh readings of every counted actor (`readDeciders`), taken before the write lock (Q1, §7.4). Ratify judges the
   *  book with them and records them as `closed.checked`; a counted actor they do not cover refuses the ratify. */
  checked?: DeciderCheck[]
  /** Builds `proposal/<id>` when its parent is not the trunk tip. Default: `buildBranch`. */
  build?: (repo: string, proposal: BranchProposal, from: string) => Promise<BuildResult>
  ratifyGit?: MergeDeps
  /** Step 4's whole-tree check over a scratch directory. Default: `validateRepo`. */
  validate?: (root: string) => { file?: string; id?: string; path: string; message: string; level: string }[]
  /** The private store (L5 §10.3): a proposal's private part is applied in its transaction around the merge commit. Absent:
   *  none (a proposal with a private part is then refused 503, and nothing is merged). */
  privateStore?: PrivateAccess
}

export interface RatifyResult {
  proposal: Proposal
  commit: string
  decision: DecisionRow
  branch: 'built'
  evaluation: Evaluation
  can: string[]
}

const seconds = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z')
const refuse = (status: 400 | 403 | 409 | 422 | 500 | 503, code: string, error: string, more: Record<string, unknown> = {}): Refusal =>
  new Refusal(status, { code, error, ...more })
const firstLine = (err: unknown): string => (err instanceof Error ? err.message : String(err)).trim().split('\n')[0] ?? ''
const unique = <T>(list: T[]): T[] => [...new Set(list)]
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** Data compared by value, key order aside. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).filter(k => (v as Record<string, unknown>)[k] !== undefined).sort()
      .map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

// ── the closing's texts, shared by ratify and the other closings (spec §3.8): pure ───────────────────

/** The kinds of closing that decide: the event each writes, and the state and outcome it sets. */
const CLOSINGS = {
  ratify: { state: 'ratified', outcome: 'ratified' },
  reject: { state: 'rejected', outcome: 'rejected' },
  expire: { state: 'expired', outcome: 'expired' },
} as const
export type ClosingKind = keyof typeof CLOSINGS

/**
 * The decision row, the ledger closed and `governance.decisions` with the row in it, as texts: `entry` is the open
 * proposal as `proposals` (the ledger text of the tree-to-be) holds it. The ledger is re-parsed and compared with the
 * entry plus the closing; the row by its own splice's proof. Nothing is read from disk, nothing written.
 */
export function planClosing(input: { entry: Proposal; proposals: string; governance: string; evaluation: Evaluation; actor: string; now: Date; kind: ClosingKind; as?: HatAct; checked?: DeciderCheck[] }):
  { ok: true; decision: DecisionRow; event: LedgerEvent; ledger: string; governance: string; date: string } | { ok: false; reason: string } {
  const { entry, proposals, evaluation, actor, now, kind } = input
  const no = (reason: string) => ({ ok: false as const, reason })
  const id = String(entry.id)
  const entries = entriesFromText(proposals, 'proposals') as unknown as Proposal[]
  // the decision row
  const date = now.toISOString().slice(0, 10)
  let rows: { id?: unknown }[] = []
  try {
    const listed = (parse(input.governance) as { governance?: { decisions?: unknown } } | null)?.governance?.decisions
    if (Array.isArray(listed)) rows = listed as { id?: unknown }[]
  } catch { rows = [] } // the splice below says what is wrong with the file
  const decision = decisionRowFor(entry, evaluation, { id: nextDecisionId(rows, date), date, outcome: CLOSINGS[kind].outcome })
  const governance = insertDecisionRow(input.governance, decision)
  if (!governance.ok) return no(governance.reason)

  // the ledger: state, closed, and the ratify event
  const taken = new Set((entry.events ?? []).map(e => e.id))
  let eid = eventId(now)
  for (let tries = 0; taken.has(eid) && tries < 1000; tries++) eid = eventId(now)
  const event: LedgerEvent = { id: eid, at: seconds(now), by: actor, kind }
  // The reading the closing was judged on, for a closer under a hat or at an address (L5 spec §7.2), sits on `closed.as`;
  // a ratify's fresh readings of the counted actors (§7.4) on `closed.checked`.
  const checked = input.checked && input.checked.length > 0 ? { checked: input.checked } : {}
  const fields = { state: CLOSINGS[kind].state, closed: { at: seconds(now), by: actor, decision: decision.id, ...(input.as ? { as: input.as } : {}), ...checked } }
  let ledger: string
  try { ledger = closedLedgerText(proposals, id, fields, event) } catch (err) {
    return no(`closing ${id} in ${LEDGER} would not be a clean edit (${firstLine(err)}).`)
  }
  const expected = entries.map(e => (String(e.id) === id ? { ...e, ...fields, events: [...(e.events ?? []), event] } : e))
  let reread: unknown
  try { reread = entriesFromText(ledger, 'proposals') } catch { reread = null }
  if (canonical(reread) !== canonical(expected)) {
    return no(`closing ${id} would not leave ${LEDGER} as it was plus the closing, so nothing was written.`)
  }

  return { ok: true, decision, event, ledger, governance: governance.text, date }
}

// ── step 3 and the text checks of step 4: pure ──────────────────────────────────────────────────

/**
 * The three new texts of a ratification, computed from the tree-to-be's texts (never HEAD's: N1), each checked whole:
 * the ledger re-parsed and compared with the entry plus the closing; the decision row and the DECISIONS.md entry by
 * their own splices' proofs. No repository, no revision, no clock but `now`. A refusal is a sentence; nothing was written.
 */
export function planRatify(input: { id: string; actor: string; now: Date; evaluation: Evaluation; texts: RatifyTexts; as?: HatAct; checked?: DeciderCheck[] }):
  { ok: true; plan: RatifyPlan } | { ok: false; reason: string } {
  const { id, actor, now, evaluation, texts } = input
  const no = (reason: string) => ({ ok: false as const, reason })
  let entries: Proposal[]
  try { entries = entriesFromText(texts.proposals, 'proposals') as unknown as Proposal[] } catch (err) {
    return no(`${LEDGER} in the branch cannot be read (${firstLine(err)}).`)
  }
  const entry = entries.find(e => String(e.id) === id)
  if (!entry) return no(`${LEDGER} in the branch has no proposal ${id}.`)
  if (entry.state !== 'open') return no(`proposal ${id} is already ${entry.state} in the branch.`)
  if (evaluation.state !== 'met') return no(`the rule is not met: ${evaluation.missing}.`)
  const statement = entry.statement as { title: string; decision: string; why: string; scope?: string } | null | undefined
  if (statement && texts.decisions === null) return no(`proposal ${id} carries a statement, and the branch has no ${DECISIONS} to record it in.`)
  if (leadMethod(entry.rules) === null) return no(`the rules of ${id} name no method (decide.method), so no decision row can say how it was decided.`)

  const closing = planClosing({ entry, proposals: texts.proposals, governance: texts.governance, evaluation, actor, now, kind: 'ratify', as: input.as, checked: input.checked })
  if (!closing.ok) return no(closing.reason)
  const { decision, event, ledger, governance, date } = closing

  const files = [{ path: LEDGER, text: ledger }, { path: GOVERNANCE, text: governance }]
  if (statement) {
    const md = insertDecisionsMdEntry(texts.decisions as string, {
      date, title: statement.title, scope: statement.scope ?? entry.classes.join(', '), decision: statement.decision, why: statement.why,
      proposal: id, decisionId: decision.id,
    })
    if (!md.ok) return no(md.reason)
    files.push({ path: DECISIONS, text: md.text })
  }
  // The git ops' files: a private placeholder names none (L5 §9.6).
  const opsFiles = gitOpsOf(entry.ops ?? []).map(op => `data/${parseRecord(op.record).registry}.yaml`)
  return {
    ok: true,
    plan: {
      files,
      allowed: unique([...opsFiles, LEDGER, GOVERNANCE, ...(statement ? [DECISIONS] : [])]),
      decision,
      event,
      message: `proposals: ratify ${id} — ${entry.title}`,
      trailers: { actor, rule: entry.rules.map(r => `${r.id}/${methodOf(r)}`).join(','), proposal: id, decision: decision.id },
    },
  }
}

// ── step 4, the whole tree: validateRepo over a scratch copy of the tree-to-be ─────────────────────

/** The error-level problems `validateRepo` finds in the tree-to-be with the new texts that it does not find without
 *  them. The copy is written under the OS temp directory, never in the repository, and removed. */
export async function newProblems(repo: string, commit: string, plan: { files: { path: string; text: string }[] }, validate: NonNullable<RatifyDeps['validate']> = validateRepo):
  Promise<{ file: string; path: string; message: string }[]> {
  const scratch = mkdtempSync(join(tmpdir(), 'ratify-tree-'))
  try {
    mkdirSync(join(scratch, 'data'))
    for (const def of REGISTRIES) {
      const rel = `data/${def.name}.yaml`
      let text: string
      try { text = await showFile(repo, commit, rel) } catch { continue }
      writeFileSync(join(scratch, rel), text)
    }
    const key = (p: { file?: string; id?: string; path: string; message: string }) => `${p.file}|${p.id ?? ''}|${p.path}|${p.message}`
    const errors = () => validate(scratch).filter(p => p.level === 'error')
    const before = new Set(errors().map(key))
    for (const f of plan.files) if (f.path.startsWith('data/')) writeFileSync(join(scratch, f.path), f.text)
    return errors().filter(p => !before.has(key(p))).map(p => ({ file: String(p.file), path: p.path, message: p.message }))
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

// ── steps 5 to 8: the merge, the writes, the commit ────────────────────────────────────────────

/**
 * Merge `commit` (the branch tip C, whose parent is `trunk`, T) into the checked-out trunk, write the plan's texts into
 * the pending merge, staging each the moment it is written, check the staged set and commit, with the plan's message and
 * trailers. Answers the merge commit's sha. On a failure after the merge began it undoes with `merge --abort` and says
 * so; "Already up to date" runs nothing. The caller has checked everything steps 1 to 4 check.
 */
export async function applyRatifyMerge(repo: string, at: { trunk: string; commit: string; plan: RatifyPlan; ident?: GitIdent }, deps: MergeDeps = {}): Promise<string> {
  const { trunk, commit, plan } = at
  const merge = deps.merge ?? mergeNoFf
  const abort = deps.abort ?? mergeAbort
  const stage = deps.stage ?? stageMergeFiles
  const commitIt = deps.commit ?? ((r: string, m: string, a: string[], t: TrailerValues, o?: CommitOptions) => commitMerge(r, m, a, t, o))
  const write = deps.write ?? ((path: string, text: string) => writeFileSync(path, text))
  const show = deps.show ?? showFile
  const staged = deps.staged ?? stagedNames
  const unmerged = deps.unmerged ?? unmergedPaths
  const tracked = deps.tracked ?? trackedChanges

  /** The refusals `undo` throws: a catch below that sees one passes it on, and undoes nothing twice. */
  const undoing = new WeakSet<object>()
  /** `merge --abort`, then the check that the repository is as it was; a refusal that says which. A read of the check
   *  that throws is itself a reason the repository cannot be said to be as it was. */
  const undo = async (status: 409 | 503, code: string, what: string): Promise<never> => {
    let said = ''
    try { await abort(repo) } catch (err) { said = (err instanceof Error ? err.message : String(err)).trim() }
    if (said === '') {
      try {
        const left = await tracked(repo)
        const head = await resolveRev(repo, 'HEAD')
        const pending = await mergeInProgress(repo)
        if (left.length > 0 || head !== trunk || pending) {
          said = [left.length > 0 ? `changes are left in ${left.join(', ')}` : '', head !== trunk ? `HEAD is ${head}, not ${trunk}` : '',
            pending ? 'a merge is still in progress' : ''].filter(Boolean).join('; ')
        }
      } catch (err) {
        said = `the repository could not be read after the abort (${firstLine(err)})`
      }
    }
    const refusal = said !== ''
      ? refuse(500, 'RATIFY_STUCK', `Not ratified: ${what}. Undoing the merge with git merge --abort did not leave the repository as it was: ${said}. ` +
        'Nothing else was run to repair it; `git status` in the repository shows where it stands.')
      : refuse(status, code, `Not ratified: ${what}. The merge was undone with git merge --abort, and the trunk is as it was.`)
    undoing.add(refusal)
    throw refusal
  }

  // 5. the merge
  let started: MergeStart
  try { started = await merge(repo, commit) } catch (err) {
    let pending = true // when git cannot even say, the abort is tried and its own words reported
    try { pending = await mergeInProgress(repo) } catch { /* pending stays true */ }
    if (pending) return undo(503, 'MERGE_FAILED', `git could not merge the branch (${firstLine(err)})`)
    throw refuse(503, 'MERGE_FAILED', `Not ratified: git could not start the merge (${firstLine(err)}). Nothing was changed.`)
  }
  if (!started.pending) {
    throw refuse(409, 'NOTHING_TO_MERGE', `Not ratified: git said "${firstLine(started.said) || 'nothing'}", so there is no merge to record. Nothing was changed, so nothing was run to undo it.`)
  }

  // From here a merge is pending: any throw that is not already an undo's refusal is undone (merge --abort).
  try {
    // (a) the working tree holds the tree-to-be; (b) those bytes are the rollback bytes
    const rollback = new Map<string, Buffer>()
    for (const f of plan.files) {
      const path = join(repo, f.path)
      const working = existsSync(path) ? readFileSync(path) : null
      const blob = Buffer.from(await show(repo, commit, f.path), 'utf8')
      if (working === null || !working.equals(blob)) {
        return await undo(409, 'TREE_DIFFERS', `after the merge, ${f.path} in the working tree differs from the branch's ${f.path} (a conversion of line endings, or a filter, changed it), so ratify will not guess which to write`)
      }
      rollback.set(f.path, working)
    }

    // 6. each file written, then staged at once
    const written: string[] = []
    try {
      for (const f of plan.files) {
        written.push(f.path)
        write(join(repo, f.path), f.text)
        await stage(repo, [f.path], plan.allowed)
      }
    } catch (err) {
      const lost: string[] = []
      for (const p of written) {
        try { writeFileSync(join(repo, p), rollback.get(p) as Buffer) } catch { lost.push(p) }
      }
      try { await stage(repo, written, plan.allowed) } catch { /* the bytes are back; the index still holds the merge's own text */ }
      return await undo(503, 'RATIFY_UNDONE', `${written.at(-1)} could not be written or staged (${firstLine(err)})` +
        (lost.length > 0 ? `, and ${lost.join(', ')} could not be put back to the merge's own text` : ''))
    }

    // 7. no unmerged entry, and the staged set
    const conflicted = await unmerged(repo)
    if (conflicted.length > 0) {
      return await undo(409, 'UNMERGED', `the index holds ${conflicted.join(', ')} not merged, so the merge cannot be committed as the proposal's change`)
    }
    const outside = (await staged(repo)).filter(p => !plan.allowed.includes(p))
    if (outside.length > 0) {
      return await undo(409, 'STAGED_OUTSIDE', `the merge would also change ${outside.join(', ')}, which ${outside.length === 1 ? 'is' : 'are'} not a file the proposal's ops name or a ledger file`)
    }

    // 8. the commit
    try { return await commitIt(repo, plan.message, plan.allowed, plan.trailers, { ident: at.ident }) } catch (err) {
      return await undo(503, 'RATIFY_UNDONE', `git refused the commit (${firstLine(err)}); if a commit hook refused it, the reason is the hook's`)
    }
  } catch (err) {
    if (typeof err === 'object' && err !== null && undoing.has(err)) throw err
    return undo(503, 'RATIFY_UNDONE', `ratify stopped after the merge began (${firstLine(err)})`)
  }
}

// ── deciding with fresh readings (L5 spec §7.4, Q1) ──────────────────────────────────────────────

/** An actor counted under a deciding role sourced from a hat: the hat, and the accounts on its chain that are theirs. */
interface Counted { actor: string; role: string; hat: string; accounts: string[] }

const normalHat = (value: string): string => { const p = parseHatRef(value); return p ? hatRef(p.chain, p.hatId) : value }
/** How a sentence names an actor: a member id as it is, a CAIP-10 id by its short address (§6.3). */
const actorName = (id: string): string => { const p = parseCaip10(id); return p ? shortAddress(p.address) : id }
const titled = (role: string): string => role.charAt(0).toUpperCase() + role.slice(1)

/**
 * Every actor whose approval, ballot or objection the evaluator counts now under a deciding role sourced from a hat, with
 * that role's hat and the accounts that can put them in it: a CAIP-10 actor's own, a member's `handles.wallet` and every
 * account the proposal observed that names them, on the hat's chain. Counted by either book that would judge it without
 * the fresh readings: the one the ledger alone gives (what a later reader counts, an approval admitted without a reading
 * included: R-L5-8.10), and the one with the ratifier's own reading and act. A rule decided by a role written with
 * members, or by everyone, asks no reading.
 */
function countedUnderHats(repo: string, actor: KnownActor, entry: Proposal, now: Date, as: HatAct | undefined): Counted[] {
  const rc = readRuleContext(repo, actor)
  const members = rc.members ?? []
  const books = [judgedBy(rc.governance, members, entry, []).book, machineContext(repo, actor, entry, now, { as }).context.book]
  const observed = [...new Set(observationsOf(entry).map(o => o.account))]
  const out: Counted[] = []
  for (const [book, { rule, evaluation: ev }] of books.flatMap(book => evaluateAll({ proposal: entry as never, book, now }).parts.map(p => [book, p] as const))) {
    const role = rule.decide?.by
    const hat = typeof role === 'string' ? book.roles.get(role)?.hat : undefined
    if (!role || !hat) continue
    const chain = parseHatRef(hat)?.chain
    const t = ev.tally as { for?: string[]; against?: string[]; abstain?: string[]; objecting?: string[] }
    for (const id of new Set([...(t.for ?? []), ...(t.against ?? []), ...(t.abstain ?? []), ...(t.objecting ?? [])])) {
      if (out.some(c => c.actor === id && c.hat === hat)) continue
      const own = parseCaip10(id)
      const member = members.find(m => String(m.id) === id)
      const candidates = own ? [`${own.chain}:${own.address}`] : [...new Set([...walletsOf(member), ...observed])]
      const accounts = candidates.filter(a => parseCaip10(a)?.chain === chain && actorIdOf(a, members) === id)
      out.push({ actor: id, role, hat, accounts })
    }
  }
  return out
}

const floorSecond = (d: Date): Date => new Date(Math.floor(d.getTime() / 1000) * 1000)

/**
 * The fresh readings a ratify of proposal `id` by `actor` is judged on (L5 spec §7.2, §7.4; Q1): each counted actor's
 * accounts read again through `read`, one row per account and hat. Taken before the write lock. A read that fails refuses
 * the ratify with §5.2's sentence (502), writing nothing; so does a server with no reader when someone must be read.
 * Empty when nobody is counted under a hat (a 0.6 ledger), or when the ledger has no such proposal (ratify's 404 says so).
 */
export async function readDeciders(repo: string, actor: KnownActor, id: string, o: { read: ReadWearer | null; now: Date; as?: HatAct }): Promise<DeciderCheck[]> {
  const entry = readLedger(repo).entries.find(e => String(e.id) === id)
  if (!entry || entry.state !== 'open') return []
  const counted = countedUnderHats(repo, actor, entry, floorSecond(o.now), o.as)
  const rows: DeciderCheck[] = []
  const readings = new Map<string, { hats: string[]; block: number; readAt: string }>()
  for (const c of counted) {
    for (const account of c.accounts) {
      let r = readings.get(account)
      if (!r) {
        const got = o.read ? await o.read(account) : { ok: false as const, error: 'no reader' }
        if (!got.ok) throw new Refusal(502, { error: actUnreadable(c.role), code: 'HATS_UNREADABLE' })
        r = { hats: got.hats.map(normalHat), block: got.block, readAt: got.readAt }
        readings.set(account, r)
      }
      if (!rows.some(x => x.account === account && x.hat === c.hat)) {
        rows.push({ account, hat: c.hat, wears: r.hats.includes(c.hat), block: r.block, readAt: r.readAt })
      }
    }
  }
  return rows
}

/** "steward-c no longer wears Council; 1 of 2 approvals remain." (§7.4), when the fresh readings are why a rule that was
 *  met is met no more; else null. */
function noLongerWorn(counted: Counted[], checked: DeciderCheck[], evaluation: Evaluation): string | null {
  for (const { rule, evaluation: ev } of evaluation.parts) {
    if (ev.state === 'met') continue
    const off = counted.filter(c => c.role === rule.decide?.by && c.accounts.some(a => checked.some(r => r.account === a && r.hat === c.hat && !r.wears)))
    if (off.length === 0) continue
    const names = off.map(c => actorName(c.actor))
    const who = names.length === 1 ? `${names[0]} no longer wears` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} no longer wear`
    const t = ev.tally as { for?: string[]; against?: string[]; abstain?: string[]; needed?: number }
    const remain = methodOf(rule) === 'vote'
      ? `${(t.for ?? []).length + (t.against ?? []).length + (t.abstain ?? []).length} of ${t.needed ?? 0} votes remain`
      : `${(t.for ?? []).length} of ${t.needed ?? 0} approvals remain`
    return `${who} ${titled(off[0]!.role)}; ${remain}.`
  }
  return null
}

// ── the whole of it ────────────────────────────────────────────────────────────────────────────

/**
 * Ratify proposal `id` as `actor`: spec §3.8, steps 1 to 8, in order. Every refusal before step 5 leaves the working
 * tree, the index and HEAD untouched (the branch ref may have been rebuilt: it is a cache).
 */
export async function ratify(repo: string, actor: KnownActor, id: string, deps: RatifyDeps = {}): Promise<RatifyResult> {
  const clock = (deps.now ?? (() => new Date()))()
  const now = new Date(Math.floor(clock.getTime() / 1000) * 1000) // git dates a commit in whole seconds (LOW-5)
  const git = deps.ratifyGit ?? {}
  const nothing = 'Nothing was written.'

  // 1. preflight
  const { entry } = await closingPreflight(repo, id, now, {
    not: 'Not ratified', act: 'a proposal is ratified',
    clean: 'a ratify starts from a clean tree, because its one undo, git merge --abort, can only restore what git holds.',
    untracked: 'Ratify writes it, and git merge --abort cannot restore a file git does not track.',
  }, e => [LEDGER, GOVERNANCE, ...(e.statement !== undefined && e.statement !== null ? [DECISIONS] : [])], deps.startBranch, deps.hosted)
  const statement = entry.statement !== undefined && entry.statement !== null

  // Q1 (§7.4): an approval, ballot or objection counts only if its author still wears the hat now. Every actor counted under
  // a hat was read again before the lock (`readDeciders`); one this ratify sees counted whom those readings do not cover
  // acted meanwhile, and is not judged on an older reading.
  const counted = countedUnderHats(repo, actor, entry, now, deps.as)
  const checked = deps.checked ?? []
  const uncovered = counted.find(c => c.accounts.length === 0 || c.accounts.some(a => !checked.some(r => r.account === a && r.hat === c.hat)))
  if (uncovered) {
    throw refuse(409, 'NOT_CHECKED', `Not ratified: whether ${actorName(uncovered.actor)} still wears ${titled(uncovered.role)} was not read again for this ratify ` +
      `(an act came in while the deciders were read). Try again. ${nothing}`)
  }
  const seen: HatObservation[] = checked.map(r => ({ hat: r.hat, account: r.account, wears: r.wears, block: r.block, at: r.readAt }))

  // re-evaluated with the server's clock at the whole second, on the book with those readings; the machine decides
  // whether this actor may ratify now
  const { state, context, evaluation } = machineContext(repo, actor, entry, now, { as: deps.as, seen })
  const decided = transition(machine, proposalGuards, state, { type: 'RATIFY', by: actor.id }, context)
  if (!decided.ok) {
    const off = state !== 'stale' && evaluation.state !== 'met' ? noLongerWorn(counted, checked, evaluation) : null
    if (off) throw refuse(409, 'NO_LONGER_WORN', `Not ratified: ${off} ${nothing}`, { evaluation })
    const may = eventPermission('ratify', { actor: actor.id, proposal: entry, rules: entry.rules, book: context.book, known: context.known })
    if (state !== 'stale' && evaluation.state !== 'met' && may === null) {
      const next = evaluateAll({ proposal: entry as never, book: context.book, now: new Date(now.getTime() + 1000) })
      if (next.state === 'met') {
        throw refuse(409, 'NOT_MET', `Not ratified yet: the rule's window closes in 1 second. A ratify is judged at the start of the current second, ` +
          `because git dates a commit in whole seconds; try again in a moment. ${nothing}`, { evaluation })
      }
      throw refuse(409, 'NOT_MET', `Not ratified: the rule is not met: ${evaluation.missing}. ${nothing}`, { evaluation })
    }
    throw new MachineRefusal(machine.id, state, 'RATIFY', decided.reason)
  }

  // The private part (L5 §9.6, §10.3): read back from the store, as the ledger records it, before anything is built or
  // merged; a store that cannot be reached refuses here, so the git part is never merged alone.
  // A git op writing a field narrowed since the proposal was opened (data/visibility.yaml edited by hand: a narrowing
  // substitutes such ops itself) is told what to do, 409, before anything is built (R-L5-16.10).
  const narrowed = narrowedOps(gitOpsOf(entry.ops), readConfig(repo))
  if (narrowed) throw refuse(409, 'NARROWED', narrowedSinceProposed(id, narrowed))
  const held = placeholdersOf(entry.ops as unknown[])
  const { store: privateStore, why } = reach(deps.privateStore ?? noStore)
  if (held.length > 0 && !privateStore) throw unavailable(why)
  const privateOps: StagedPrivateOp[] = held.length > 0 ? pendingOps(privateStore!, entry) : []
  // A git record the proposal deletes takes its restricted fields with it, when the store can be reached (R-L5-14.3).
  const clears = privateStore ? clearsOf(gitOpsOf(entry.ops) as StageOp[]) : []

  // 2. the branch, rebuilt on the trunk tip when it stands elsewhere; then "already in the trunk"; then C^ = T
  const trunk = await resolveRev(repo, 'HEAD')
  if (trunk === null) throw new HttpError(409, 'This repository has no commit yet, so there is no trunk to ratify on.')
  const ref = `refs/heads/proposal/${id}`
  const tip = await resolveRev(repo, ref)
  if (tip === null || (await resolveRev(repo, `${tip}^`)) !== trunk) {
    try {
      // Rebuilt by the ratifier's act: committed as they commit (L5 §6.4, the house for a signed-in actor).
      const build = deps.build ?? ((r: string, p: BranchProposal, f: string) => buildBranch(r, p, f, { ident: commitIdent(actor) }))
      await build(repo, { id, author: entry.author, ops: entry.ops as BranchProposal['ops'] }, trunk)
    } catch (err) {
      // A refusal of the build's own (stale ops, a branch moved meanwhile) is its answer. Anything else (a hook that
      // refused the build's commit) is said in words, never with the local path the build used, which is logged here.
      if (err instanceof Refusal || !(err instanceof Error)) throw err
      const { words, left } = buildFailureWords(err)
      if (left) console.warn(`proposal/${id} could not be built for a ratify: ${left}`)
      throw refuse(409, 'NO_BRANCH', `Not ratified: proposal/${id} could not be built (${words}). ${nothing}`)
    }
  }
  const commit = await resolveRev(repo, ref)
  if (commit === null) throw refuse(409, 'NO_BRANCH', `Not ratified: proposal/${id} could not be built, so there is nothing to merge. ${nothing}`)
  if (await (git.isAncestor ?? isAncestor)(repo, commit, trunk)) {
    throw refuse(409, 'NOTHING_TO_MERGE', `Not ratified: this change is already in the trunk; there is nothing to merge. ${nothing}`)
  }
  if ((await resolveRev(repo, `${commit}^`)) !== trunk) {
    throw refuse(409, 'BRANCH_MOVED', `Not ratified: proposal/${id} does not stand on the trunk's tip after it was built, so the merge could bring more than its change. Try again. ${nothing}`)
  }

  // 3. the texts of the tree-to-be, C's (N1)
  let texts: RatifyTexts
  try {
    texts = {
      proposals: await showFile(repo, commit, LEDGER),
      governance: await showFile(repo, commit, GOVERNANCE),
      decisions: statement ? await showFile(repo, commit, DECISIONS) : null,
    }
  } catch (err) {
    throw refuse(409, 'CANNOT_RECORD', `Not ratified: ${firstLine(err)} ${nothing}`)
  }

  // 4. every new text, then the whole tree, validated before anything is written
  const planned = planRatify({ id, actor: actor.id, now, evaluation, texts, as: deps.as, checked })
  if (!planned.ok) throw refuse(409, 'CANNOT_RECORD', `Not ratified: ${planned.reason} ${nothing}`)
  const problems = await newProblems(repo, commit, planned.plan, deps.validate)
  if (problems.length > 0) {
    throw refuse(422, 'INVALID', `Not ratified: the trunk would not hold valid data after this ratification (${problems[0]!.file}: ${problems[0]!.message}). ${nothing}`, { errors: problems })
  }

  // 5 to 8, inside the store's transaction when there is a private part (§10.3: begin, apply, the merge commit, commit): the
  // private ops written under the decision, the proposal's `pending` rows dropped, then the merge, then `applied` with the
  // merge commit. A merge that fails rolls the store back. A store that fails after the merge was committed leaves the
  // proposal ratified and its private part unapplied, which the next start applies (`reconcilePrivate`).
  const merge = () => applyRatifyMerge(repo, { trunk, commit, plan: planned.plan, ident: commitIdent(actor) }, git)
  const merged = privateStore && privateOps.length + clears.length > 0
    ? await aroundGit(privateStore, {
      before: w => {
        applyPrivate(w, decidedWrites(privateStore, [...clears, ...privateOps]), actor.id, null, privateStore, planned.plan.decision.id)
        if (held.length > 0) w.deletePending(id)
      },
      git: merge,
      after: (w, sha) => { if (held.length > 0) w.putApplied({ proposal: id, commit: sha, at: now.toISOString() }) },
      late: sha => {
        if (held.length === 0) return sha // only a deleted record's restricted fields were left behind
        throw refuse(503, 'PRIVATE_STORE', `Proposal ${id} was ratified in commit ${sha}, but the private store could not keep its restricted part, so ` +
          `nothing private was written yet: it is written when the server next starts. ${STORE_FAILED}`, { commit: sha })
      },
    })
    : await merge()

  const written = readLedger(repo).entries.find(e => String(e.id) === id) as Proposal
  const after = machineContext(repo, actor, written, now)
  return { proposal: written, commit: merged, decision: planned.plan.decision, branch: 'built', evaluation: after.evaluation, can: canWrite(after.state, after.context, written, actor.id) }
}
