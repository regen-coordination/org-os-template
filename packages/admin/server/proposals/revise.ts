// packages/admin/server/proposals/revise.ts
//
// The two ways a proposal's content moves while it is open (0.6 P2 spec §3.4 "Revising", §3.5): *revise*, the author's
// new ops from the tray's *Update proposal* (a `revise` event, a new `rev`; approvals on the old one stop counting), and
// *replay*, the branch built again on the trunk's tip, where the author's *Keep mine* or *Take theirs* settles the ops
// whose record the trunk changed (Task 7b's `replayBranch`); and *load*, the page's *Revise*, which puts the proposal's
// ops in the author's tray, marked `revises`, for the tray's Update proposal to send back. All go through the proposal
// machine first, so a refusal is its sentence in a 409 `REFUSED`; every other refusal is in words, before anything is
// written. Callers hold the repository's write lock.

import { HttpError } from '../errors.ts'
import { commitIdent, type Actor } from '../actor.ts'
import { Refusal, StageRefusal } from '../changes/apply.ts'
import { MachineRefusal } from '../machines.ts'
import { classesOf, currentOf, ledgerErrors, staleOps, validateChange } from '../changes/stage.ts'
import { baseOf } from '../changes/canonical.ts'
import { sealReceipts } from '../library/seal.ts'
import { isStale } from '../changes/merge.ts'
import { newChangeId, type ChangeStore } from '../changes/store.ts'
import type { Change, Op } from '../changes/types.ts'
import { resolveRev } from '../git.ts'
import { buildBranch, buildFailureWords, recordAt, replayBranch, trunkMovedUnder, type BranchProposal } from './branch.ts'
import { guardTrunk, readLedger, resolveTrunk, updateEntry, type LedgerWho } from './ledger.ts'
import { guardFetched, type ProposeDeps, type ProposedPrivate } from './propose.ts'
import { machineContext } from './events.ts'
import { canonicalJson, methodOf, revOf, type Proposal } from '../../lib/proposals.mjs'
import { gitOpsOf } from '../../lib/ops.mjs'
import type { Viewer } from '../../lib/visibility.mjs'
import { aroundGit, noStore, privateClasses as privateClassesOf, reach, resolvePrivate, stagePrivate, STORE_FAILED, unavailable, type PrivateAccess } from '../private/ops.ts'
import { admittedTo, pendingOps, pendingPart, placeholdersOf, type LedgerPlaceholder } from '../private/proposals.ts'
import type { PendingRow, PrivateStore } from '../private/store.ts'
import { readConfig } from '../visibility/config.ts'
import { Levels, raisedTouched } from '../visibility/gate.ts'
import { refuseOthersLink } from '../visibility/widen.ts'
import { refuseNarrowed } from '../private/guard.ts'
import { rulesForClasses, validTrunkName } from '../../lib/rules.mjs'
import { transition } from '../../lib/machines/run.mjs'
import type { HatAct } from '../../lib/hat-readings.mjs'
import { proposal as machine, proposalGuards } from '../../lib/machines/proposal.mjs'

type KnownActor = Extract<Actor, { id: string }>

export interface ReviseResult {
  /** The trunk commit that holds the revise event. */
  commit: string
  /** Set when the branch could not be built on the new ops: the revision stands, the branch is built when needed. */
  note?: string
}

const refuse = (code: string, error: string, more: Record<string, unknown> = {}): Refusal => new Refusal(409, { code, error, ...more })
const NOTHING = 'Nothing was written.'

/** The open proposal `id`, or a 404. */
function entryOf(repo: string, id: string): Proposal {
  const entry = readLedger(repo).entries.find(e => String(e.id) === id)
  if (!entry) throw new HttpError(404, `The ledger has no proposal ${id}.`)
  return entry
}

/** The machine's answer to `type` from `actor` now, or its refusal. `choose` goes with a replay (a stale one needs it);
 *  `trunkMoved` says whether a mechanical replay has anything to bring (`trunkMovedUnder`); `as` is the reading of an act
 *  under a hat (L5 spec §7.2), judged with it. */
function permitted(repo: string, actor: KnownActor, entry: Proposal, now: Date, type: 'REVISE' | 'REPLAYED', choose?: Choice, trunkMoved = false, as?: HatAct): void {
  const { state, context, stale } = machineContext(repo, actor, entry, now, { trunkMoved, as })
  const decided = transition(machine, proposalGuards, state, { type, by: actor.id, ...(choose !== undefined ? { choose } : {}) }, context)
  if (decided.ok) return
  // The author asking to replay a stale proposal without a choice is told which ops need one, as Propose and Apply say it.
  if (type === 'REPLAYED' && state === 'stale' && choose === undefined && actor.id === entry.author) {
    const records = stale.map(i => String(gitOpsOf(entry.ops)[i]!.record))
    throw refuse('STALE', `Not replayed: ${stale.length === 1 ? 'one op was' : `${stale.length} ops were`} staged against a record that has changed on the trunk since (${records.join(', ')}). ` +
      `Choose Keep mine or Take theirs for ${stale.length === 1 ? 'it' : 'them'}, then replay. ${NOTHING}`, { stale, records })
  }
  throw new MachineRefusal(machine.id, state, type, decided.reason)
}

const isEntry = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The day a receipt was proposed (R-6): the `at` the proposal's stored op on that record was sealed with (a create's
 *  `value.at`, a removal's `set.removed.at`); for a receipt new in this revision, the day the proposal was opened. */
const proposedOn = (entry: Proposal) => (record: string): string => {
  const stored = entry.ops.find(o => o.record === record) as Record<string, unknown> | undefined
  const sealed = stored?.op === 'create' && isEntry(stored.value) ? stored.value.at
    : stored?.op === 'update' && isEntry(stored.set) && isEntry(stored.set.removed) ? stored.set.removed.at : undefined
  return typeof sealed === 'string' && sealed !== '' ? sealed : String(entry.opened).slice(0, 10)
}

const ruleTrailer = (entry: Proposal): string => entry.rules.map(r => `${r.id}/${methodOf(r)}`).join(',')

/**
 * Revise proposal `id` with `ops` (each with the `base` it was staged against), as its author. Refuses, in this order and
 * before anything is written: what the machine refuses (not the author, a closed proposal: 409 `REFUSED`); an op on the
 * ledger itself (422); an op of a class the proposal was not opened for, or that no rule of its snapshot covers (409
 * `CLASSES`: a revision cannot reach past the rules it is decided by); an op staged against a record that has changed
 * (409 `STALE`); ops that do not validate as they would be (422); a new private part the reviser may not write now (409,
 * as Propose judges it); ops that are the proposal's own (409 `UNCHANGED`: a revise restarts the clock, so it must change
 * something); a trunk the platform cannot build refs from (409 `TRUNK`); and a last fetch that is old or behind (409
 * `SYNC_FIRST`), as Propose does. Then one commit: the new `ops`, `rev` and `base`, and a `revise` event `{ rev, ops }`;
 * then the branch, from the trunk tip the ops were checked against. A failure to build it leaves the revision, and `note`
 * says so (P2-R25).
 *
 * The private part (L5 §9.6, R-L5-15.4): with `priv`, the revising tray's (its staged ops), which replaces the proposal's;
 * when it holds the ops the proposal already holds, the placeholders stay as they are, else each gets a new ref, salt and
 * digest, and the store's `pending` rows are replaced in one store transaction around the ledger's commit. Without `priv`
 * (no tray revises it), the proposal's own placeholders are kept as they are.
 */
export async function revise(repo: string, actor: KnownActor, id: string, ops: Op[], deps: ProposeDeps = {}, priv?: ProposedPrivate): Promise<ReviseResult> {
  const now = (deps.now ?? (() => new Date()))()
  const entry = entryOf(repo, id)
  permitted(repo, actor, entry, now, 'REVISE', undefined, false, deps.as)
  const held = placeholdersOf(entry.ops as unknown[])
  if (ops.length === 0 && (priv ? priv.ops.length === 0 : held.length === 0)) {
    throw new Refusal(400, { code: 'EMPTY', error: 'A revision holds the new ops; this one holds none.' })
  }

  const ledgered = ledgerErrors(ops)
  if (ledgered.length > 0) throw new StageRefusal(ledgered)
  refuseNarrowed(ops, readConfig(repo), 'Not revised') // a field narrowed since it was staged (R-L5-16.10)
  refuseOthersLink(repo, ops, actor.id) // a wallet link is widened only by its own person (L5 §9.7)
  const privateClasses = priv ? privateClassesOf(priv.store, priv.ops) : held.map(h => h.class)
  const classes = [...new Set([...classesOf(ops, repo), ...privateClasses])]
  const opened = (entry.classes ?? []).map(String)
  const covered = rulesForClasses(entry.rules, classes)
  for (const cls of classes) {
    if (opened.includes(cls) && covered.find(c => c.class === cls)?.rule) continue
    const op = ops.find(o => classesOf([o], repo).includes(cls))
    throw refuse('CLASSES', `Not revised: ${op ? `the op on ${op.record}` : 'its restricted part'} is of the class ${cls}, and proposal ${id} was opened for ${opened.join(', ') || 'no class'}, ` +
      `under ${entry.rules.map(r => `rule "${r.id}"`).join(' and ')}. A revision keeps to the classes its rules decide; propose the rest on its own. ${NOTHING}`)
  }
  const stale = staleOps(repo, ops)
  if (stale.length > 0) {
    throw refuse('STALE', `Not revised: ${stale.length === 1 ? 'one op was' : `${stale.length} ops were`} staged against a record that has changed since. ` +
      `${NOTHING} Take theirs or keep mine on ${stale.length === 1 ? 'it' : 'each'}, then update the proposal again.`, { stale })
  }
  const errors = validateChange(repo, ops)
  if (errors.length > 0) throw new StageRefusal(errors)
  // Sealed again, as Propose seals: the reviser (the author) and the same proposal, and the day each receipt was proposed
  // (R-6), so a proposal sent back unchanged on a later day is still unchanged.
  const sealed = sealReceipts(ops.map(({ before: _before, ...op }) => op), { by: actor.id, at: proposedOn(entry), decision: { proposal: id } })
  // The private part: the proposal's own placeholders, unless the revising tray's ops differ from what they stand for.
  let placeholders: LedgerPlaceholder[] = held
  let rows: PendingRow[] | null = null
  if (priv) {
    let was: unknown[] | null = null
    // A part the store no longer holds as recorded (a revision whose store write failed) is replaced, never compared.
    try { was = held.length > 0 ? pendingOps(priv.store, entry) : [] } catch (err) { if (!(err instanceof Refusal && err.body.code === 'PRIVATE_LOST')) throw err }
    if (was === null || canonicalJson(was) !== canonicalJson(priv.ops)) {
      resolvePrivate(priv.store, priv.ops, priv.viewer) // judged for the reviser now, as Propose judges it
      const part = pendingPart(id, priv.ops)
      placeholders = part.placeholders
      rows = part.rows
    }
  }
  const ledgerOps = [...sealed, ...placeholders]
  const rev = revOf(ledgerOps)
  if (rev === entry.rev) throw refuse('UNCHANGED', `Not revised: these are the ops proposal ${id} already holds (rev ${rev}). ${NOTHING}`)

  const trunk = await resolveTrunk(repo, deps.startBranch)
  const named = validTrunkName(trunk)
  if (named !== true) {
    throw refuse('TRUNK', `Not written: "${trunk}" cannot be the trunk: ${named} Name another in data/governance.yaml (governance.trunk), or switch to a branch with an ordinary name.`)
  }
  await guardFetched(repo, trunk, now, 'a proposal is revised', { hosted: deps.hosted })

  const from = await resolveRev(repo, 'HEAD')
  if (from === null) throw new HttpError(409, 'This repository has no commit yet, so there is no trunk to revise on.')
  const who: LedgerWho = { actor: actor.id, rule: ruleTrailer(entry), ident: commitIdent(actor) }
  // `touched` is only ever raised (L9 Ruling T12-1).
  const touched = raisedTouched(entry as unknown as Record<string, unknown>, [...ops, ...placeholders], new Levels(repo))
  const write = () => updateEntry(repo, id, { fields: { ops: ledgerOps, rev, base: from, touched }, event: { kind: 'revise', rev, ops: ledgerOps } }, who, { ...deps, now: () => now })
  const { commit } = priv && rows
    ? await aroundGit(priv.store, {
      before: w => { w.deletePending(id); for (const row of rows!) w.putPending(row) },
      git: write,
      late: out => {
        throw new Refusal(503, { code: 'PRIVATE_STORE', commit: out.commit, error:
          `Proposal ${id} was revised in commit ${out.commit}, but the private store could not keep its new restricted part, so the proposal holds ` +
          `placeholders the store does not: update it again from your tray, which still holds the change. ${STORE_FAILED}` })
      },
    })
    : await write()
  try {
    await (deps.build ?? buildBranch)(repo, { id, author: entry.author, ops: ledgerOps as BranchProposal['ops'] }, from, { ident: commitIdent(actor) })
    return { commit }
  } catch (err) {
    // The author reads the note: the failure in words, never the local path the build used, which is logged here.
    const { words: why, left } = buildFailureWords(err instanceof Error ? err : new Error(String(err)))
    if (left) console.warn(`proposal/${id} could not be built when it was revised: ${left}`)
    return { commit, note: `The proposal ${id} is revised, but its branch proposal/${id} could not be built (${why}). The branch will be built again when it is first needed.` }
  }
}

export const CHOICES = ['mine', 'theirs'] as const
export type Choice = typeof CHOICES[number]

/**
 * Replay proposal `id`: its branch built again on the trunk's tip (spec §3.5), through `replayBranch`. While no op's record
 * changed, the replay is mechanical and any known member may ask for it (the machine's REPLAYED loop): a `replay` event
 * records the new base. It is offered, and acts, only when the trunk changed one of the ops' files since the proposal's
 * base (final review I4); otherwise the machine refuses it, "Already on the trunk: nothing to replay.", and nothing is
 * written, so a replay is a fixed point (its own event touches only the ledger). A stale proposal is replayed only by its author with a
 * `choose` (*Keep mine*, *Take theirs*); the author without one is answered 409 `STALE` naming the ops. A choice can change
 * the ops, which is a revision, so it is also held to the machine's `REVISE` (the author's), and the event is written as
 * the author. Answers the commit of the event, or null when there was nothing to record.
 */
export async function replay(repo: string, actor: KnownActor, id: string, choose: Choice | undefined, deps: ProposeDeps = {}): Promise<{ commit: string | null }> {
  const now = (deps.now ?? (() => new Date()))()
  const entry = entryOf(repo, id)
  const moved = entry.state === 'open' ? await trunkMovedUnder(repo, entry, 'HEAD') : false
  permitted(repo, actor, entry, now, 'REPLAYED', choose, moved, deps.as)
  if (choose !== undefined) permitted(repo, actor, entry, now, 'REVISE', undefined, false, deps.as)
  await guardTrunk(repo, deps.startBranch)
  const from = await resolveRev(repo, 'HEAD')
  if (from === null) throw new HttpError(409, 'This repository has no commit yet, so there is no trunk to replay on.')
  // With a choice, `actor` is the author (the REVISE guard above): the event is the author's.
  const who: LedgerWho = { actor: choose !== undefined ? entry.author : actor.id, rule: ruleTrailer(entry), ident: commitIdent(actor) }
  const { event } = await replayBranch(repo, entry, from, who, { ...deps, now: () => now, ...(choose !== undefined ? { choose } : {}) })
  return { commit: event === null ? null : await resolveRev(repo, 'HEAD') }
}

/** What is said when the author's tray holds a change that is not this proposal's (spec §3.4 "Revising"). */
export const TRAY_HOLDS = (id: string, n: number): string =>
  `Not loaded: your tray already holds a different change (${n === 1 ? 'one op' : `${n} ops`}), and proposal ${id}'s ops would mix with it: ` +
  'apply, propose or discard it first. Nothing was changed.'

/**
 * *Revise* (spec §3.4, P2-R23): proposal `id`'s current ops staged into its author's open change, marked `revises: <id>`,
 * so the tray's primary action becomes Update proposal. Refuses, before anything is written: what the machine refuses (not
 * the author, a closed proposal: 409 `REFUSED`), and a tray that holds a different change (409 `TRAY_HOLDS`, "apply,
 * propose or discard it first"). A tray that already revises this proposal is answered as it is, so the author's edits on
 * it are never overwritten. Each op keeps the `base` it was proposed against, and its `before` is the entry that base
 * names, read from the commit the proposal was last built on (`proposal.base`, as Take theirs reads it) or, when the record
 * has not changed since, the entry as it is now; so a stale op shows stale in the tray, and its Take theirs drops only
 * what the trunk changed. Nothing is written to the repository: the change lives in the admin state directory.
 */
export async function loadForRevision(repo: string, actor: KnownActor, id: string, store: ChangeStore, deps: Pick<ProposeDeps, 'now'> = {},
  priv?: { access: PrivateAccess; viewer: Viewer }): Promise<Change> {
  const now = (deps.now ?? (() => new Date()))()
  const entry = entryOf(repo, id)
  permitted(repo, actor, entry, now, 'REVISE')
  const held = store.load(actor.id)
  // A tray holds something when it holds a git op or a private one (L5 Task 14: its private part beside its ops).
  const holds = held ? held.ops.length + (held.private?.length ?? 0) : 0
  if (held && holds > 0) {
    if (held.revises === id) return held
    throw refuse('TRAY_HOLDS', TRAY_HOLDS(id, holds), { revises: held.revises ?? null })
  }
  // The private part goes into the tray too (staged again, so the tray shows it and Update proposal sends it back), but only
  // for an author admitted to all of it now: the tray shows its values (R-L5-15.4).
  const placeholders = placeholdersOf(entry.ops as unknown[])
  let privateStore: PrivateStore | null = null
  let privateOps: ReturnType<typeof pendingOps> = []
  if (placeholders.length > 0) {
    const { store: reached, why } = reach(priv?.access ?? noStore)
    if (!reached) throw unavailable(why)
    privateOps = pendingOps(reached, entry)
    // A store that fails while its levels are read is its 503, with its attention (the Task 4 ruling), never a generic error.
    let admitted: boolean
    try { admitted = priv !== undefined && admittedTo(reached, privateOps, priv.viewer, readConfig(repo)) } catch (err) { throw unavailable(err, reached) }
    if (!admitted) {
      throw refuse('NOT_ADMITTED', `Not loaded: proposal ${id} holds a change to a restricted collection that you are not admitted to now, so its ops cannot be ` +
        'put in your tray. You can still withdraw it. Nothing was changed.')
    }
    privateStore = reached
  }
  const was = typeof entry.base === 'string' && entry.base !== '' ? await resolveRev(repo, entry.base) : null
  const ops: Op[] = []
  for (const op of gitOpsOf(entry.ops) as unknown as Op[]) {
    const { before: _before, ...ledgerOp } = op as Op
    let before: Record<string, unknown> | null = null
    if (op.op !== 'create') {
      const then = was === null ? null : await recordAt(repo, was, op.record)
      const current = currentOf(repo, op.record)
      before = then !== null && baseOf(then) === op.base ? then : !isStale({ ...op, before: null }, current) ? current : null
    }
    ops.push({ ...ledgerOp, before } as Op)
  }
  const at = now.toISOString()
  const change: Change = { id: newChangeId(), actor: actor.id, created: at, updated: at, ops, revises: id }
  if (privateStore) change.private = await stagePrivate(privateStore, change, actor.id, privateOps)
  store.save(change)
  return change
}
