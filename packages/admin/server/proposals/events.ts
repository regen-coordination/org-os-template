// packages/admin/server/proposals/events.ts
//
// Events on a proposal (0.6 P2 spec §3.1, §3.2, §3.15): approve, object, vote, comment, retract, attach and withdraw,
// and the `system` events the server appends when it reads an outside outcome (§3.11, P2-R12). The
// actor is the one the route resolved; `by`, `id` and `at` are the server's. The proposal machine decides whether the
// event may be written now (its guards ask `eventPermission`, the one place who may write what is written), and a
// refusal is its sentence, in a 409 `REFUSED`. Then the ledger writes: one commit with trailers, or, for a withdraw,
// the event and the closing together. Callers hold the repository's write lock.

import { HttpError } from '../errors.ts'
import { commitIdent, unreadAccount, type Actor } from '../actor.ts'
import { MachineRefusal } from '../machines.ts'
import { staleOps } from '../changes/stage.ts'
import type { Op } from '../changes/types.ts'
import { readRuleContext } from '../governance/effective.ts'
import { resolveRev } from '../git.ts'
import { Refusal } from '../changes/apply.ts'
import { readRegistryOrEmpty } from '../registry.ts'
import type { SystemReader } from '../systems/reader.ts'
import type { ForeignRef, OutcomeReading, OutcomeRef, SystemRef } from '../systems/driver.ts'
import { DRIVERS } from '../systems/drivers.ts'
import { actObservations, appendEvent, bookOf, readLedger, setState, type LedgerOptions, type LedgerWho } from './ledger.ts'
import { derivedState, knownIds, leadMethod, liveEvents, methodOf, type LedgerEvent, type Proposal } from '../../lib/proposals.mjs'
import { observationsOf, type HatAct, type HatObservation } from '../../lib/hat-readings.mjs'
import { safeTxHash, chainIdOf } from '../../lib/safe-tx.mjs'
import { chainsOf } from '../systems/safe.ts'
import { evaluateAll } from '../../lib/evaluate.mjs'
import { gitOpsOf } from '../../lib/ops.mjs'
import type { RoleBook } from '../../lib/rules.mjs'
import { transition } from '../../lib/machines/run.mjs'
import { proposal as machine, proposalGuards } from '../../lib/machines/proposal.mjs'

/** The kinds this route writes. The other events have routes of their own (revise, replay, ratify, close), and a
 *  `system` event is the server's, appended by POST …/check: a request that names one is answered by the machine's
 *  refusal (`eventPermission`'s sentence), never written. */
export const EVENT_KINDS_HERE = ['approve', 'object', 'vote', 'comment', 'retract', 'attach', 'withdraw', 'system'] as const
export type EventKindHere = typeof EVENT_KINDS_HERE[number]

export interface EventInput { kind: EventKindHere; text?: string; vote?: string; of?: string; ref?: unknown }

/** What the route answers: the entry as it now stands, with what the page needs to draw it. */
export interface EventResult {
  proposal: Proposal
  commit: string
  branch: 'built' | 'missing'
  evaluation: ReturnType<typeof evaluateAll>
  /** The events the actor may write now, as the machine says. */
  can: string[]
}

type KnownActor = Extract<Actor, { id: string }>

/** The machine event each member-written event is, and back. `replayed` is the event kind `replay`. */
const EVENT_OF: Record<string, string> = { REPLAYED: 'replay' }
const kindOf = (type: string): string => EVENT_OF[type] ?? type.toLowerCase()

const seconds = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

/** What the machine's context holds beyond the ledger and the rules: whether the trunk changed one of the ops' files since
 *  the proposal's base (`trunkMovedUnder`, a git read the caller makes); absent, a mechanical replay is not offered. And
 *  the reading of the act being judged (`as`, L5 spec §7.2), which the book holds beside the proposal's own; and `seen`,
 *  the fresh readings a ratify took of every counted actor (`closed.checked`, §7.4), which stand over older ones. */
export interface ContextExtra { trunkMoved?: boolean; as?: HatAct; seen?: readonly HatObservation[] }

/** The proposal as the machine reads it: where it stands and what its guards ask. Its book is the proposal's own
 *  observations, the act being judged (`extra.as`) and the actor's reading (read now for an act, §5.2): L5 spec §7.3. */
export function machineContext(repo: string, actor: KnownActor, entry: Proposal, now: Date, extra: ContextExtra = {}) {
  const rc = readRuleContext(repo, actor)
  if (rc.governance === null) {
    throw new HttpError(409, `Not written: data/governance.yaml cannot be read (${rc.problems[0] ?? rc.shape}), so no rule can be applied. Nothing was written.`)
  }
  const members = rc.members ?? [{ id: actor.id, kind: actor.kind }]
  const { book, known } = judgedBy(rc.governance, members, entry, [...actObservations(entry, extra.as), ...(rc.observations ?? []), ...(extra.seen ?? [])], unreadAccount(actor))
  return proposalContext(repo, entry, now, book, known, extra)
}

/** The book a proposal is judged by and who may write to it (`knownIds`), from what was read: its own observations
 *  and `extra`, less every observation of `unread` (an actor whose wallet could not be read now: R-L5-8.10, so an act
 *  admitted without a reading never counts under a hat on what the proposal saw of them before). */
export function judgedBy(governance: Record<string, unknown> | null, members: Record<string, unknown>[], entry: Proposal, extra: readonly HatObservation[], unread: string | null = null): { book: RoleBook; known: string[] } {
  const observed = [...observationsOf(entry), ...extra].filter(o => o.account !== unread)
  return { book: bookOf(governance, members, null, observed), known: knownIds(members, observed) }
}

/** The same, from roles and member ids already read. `stale` holds the positions, among its git ops (every op but a
 *  private placeholder, L5 §9.6), of the ops whose record changed on the trunk; an open proposal with any is in the state
 *  `stale`. */
export function proposalContext(repo: string, entry: Proposal, now: Date, book: RoleBook, known: string[], extra: ContextExtra = {}) {
  const stale = entry.state === 'open' ? staleOps(repo, gitOpsOf(entry.ops).map(op => ({ ...op, before: null }) as unknown as Op)) : []
  const evaluation = evaluateAll({ proposal: entry as never, book, now })
  const state = derivedState(entry, { stale: stale.length > 0 })
  const context = {
    outcome: evaluation.state, method: leadMethod(entry.rules) ?? undefined, author: entry.author,
    proposal: entry, rules: entry.rules, book, known, trunkMoved: extra.trunkMoved === true,
  }
  return { state, context, evaluation, stale }
}

/** The events `actor` may write now. A retract is offered when the actor has an event of their own to take back; a
 *  replay is asked as one with a choice, which a stale proposal needs (the page then asks Keep mine or Take theirs). */
export function canWrite(state: string, context: Record<string, unknown>, entry: Proposal, actor: string): string[] {
  return Object.entries(answers(state, context, entry, actor)).filter(([, r]) => r === true).map(([k]) => k)
}

/** The events `actor` may not write now, each with the machine's sentence (its guard's, or the state's): what a disabled
 *  action says (spec §3.14). Asked exactly as `canWrite` asks, so the two never disagree. */
export function cannotWrite(state: string, context: Record<string, unknown>, entry: Proposal, actor: string): Record<string, string> {
  return Object.fromEntries(Object.entries(answers(state, context, entry, actor)).flatMap(([k, r]) => (r === true ? [] : [[k, r]])))
}

/** The machine's answer to each event a member could ask for (every event but TRUNK_MOVED, which the server sends). */
function answers(state: string, context: Record<string, unknown>, entry: Proposal, actor: string): Record<string, true | string> {
  const mine = liveEvents(entry as never).filter(e => e.by === actor && e.kind !== 'retract').at(-1)
  const ask = (type: string) => ({ type, by: actor, of: mine?.id, ...(type === 'REPLAYED' && state === 'stale' ? { choose: 'mine' } : {}) })
  return Object.fromEntries(machine.events.filter(type => type !== 'TRUNK_MOVED').map(type => {
    const r = transition(machine, proposalGuards, state, ask(type), context)
    return [kindOf(type), r.ok ? true : r.reason]
  }))
}

/**
 * Write one event on proposal `id` as `actor`. 404 when the ledger has no such proposal; 409 `REFUSED` with the
 * machine's sentence when the event may not be written now; the ledger's own refusals after that (a time that ran out,
 * a clock behind, a ledger that would not be valid). A `withdraw` also closes the proposal, in the same commit.
 * `deps.as`, the reading of an act under a hat (L5 spec §7.2), is judged with the event and written beside it.
 */
export async function writeEvent(repo: string, actor: KnownActor, id: string, input: EventInput, deps: LedgerOptions = {}): Promise<EventResult> {
  const now = (deps.now ?? (() => new Date()))()
  const entry = readLedger(repo).entries.find(e => String(e.id) === id)
  if (!entry) throw new HttpError(404, `The ledger has no proposal ${id}.`)

  const { state, context } = machineContext(repo, actor, entry, now, { as: deps.as })
  const type = input.kind.toUpperCase()
  const decided = transition(machine, proposalGuards, state, { type, by: actor.id, ...(input.of !== undefined ? { of: input.of } : {}) }, context)
  if (!decided.ok) throw new MachineRefusal(machine.id, state, type, decided.reason)

  // One clock reading for the event, the closing and the answer, so they cannot differ by a second.
  const opts: LedgerOptions = { ...deps, now: () => now }
  const who: LedgerWho = { actor: actor.id, rule: entry.rules.map(r => `${r.id}/${methodOf(r)}`).join(','), ident: commitIdent(actor) }
  const { kind } = input
  // Only the server writes a system event (§3.2); a member never passes the machine's guard, and an actor whose id
  // happens to begin with `system:` is not the server either.
  if (kind === 'system') throw new MachineRefusal(machine.id, state, type, 'only the server writes a system event, from an outside system it read.')
  let commit: string
  if (kind === 'withdraw') {
    const draft = { kind, ...(input.text !== undefined ? { text: input.text } : {}) }
    ;({ commit } = await setState(repo, id, { state: 'withdrawn', closed: { at: seconds(now), by: actor.id, decision: null }, event: draft }, who, opts))
  } else {
    const content =
      kind === 'approve' ? { rev: entry.rev }
      : kind === 'object' ? { rev: entry.rev, ...(input.text !== undefined ? { text: input.text } : {}) }
      : kind === 'vote' ? { rev: entry.rev, ...(input.vote !== undefined ? { vote: input.vote } : {}) }
      : kind === 'comment' ? (input.text !== undefined ? { text: input.text } : {})
      : kind === 'attach' ? { rev: entry.rev, ref: attachRef(repo, entry, input.ref) }
      : { of: input.of }
    ;({ commit } = await appendEvent(repo, id, { kind, ...content }, who, opts))
  }

  const written = readLedger(repo).entries.find(e => String(e.id) === id) as Proposal
  const after = machineContext(repo, actor, written, now)
  const branch = (await resolveRev(repo, `refs/heads/${written.branch ?? `proposal/${id}`}`)) === null ? 'missing' : 'built'
  return { proposal: written, commit, branch, evaluation: after.evaluation, can: canWrite(after.state, after.context, written, actor.id) }
}

// ── a proposal that waits on an outside system (spec §3.11; DAO-OS L2 for other drivers than a Safe) ──────────────

const ATTACH_SHAPE = 'An attach carries {"ref": {"system": "<id>", "id": "0x…", "chain"?: "<CAIP-2>", "payload": {"to", "value", "data_hash", "operation", "nonce"}, ' +
  '"also"?: [{"chain", "id", "payload"}, …]}}, as prepare gives it'
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const sameId = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
const refOf = (e: LedgerEvent | undefined): OutcomeRef | null => (e && isObject(e.ref) ? (e.ref as unknown as OutcomeRef) : null)
/** A ref of another driver than a Safe: its payload names a `kind` (driver.ts `isForeignRef`, safe on a malformed ledger ref). */
const foreign = (ref: OutcomeRef): ref is ForeignRef => isObject(ref.payload) && 'kind' in ref.payload
/** Every Safe transaction id a Safe ref holds: its own and its `also` steps'. None for another driver's ref. */
const idsOf = (ref: OutcomeRef | null): string[] =>
  ref === null || foreign(ref) ? [] : [ref.id, ...(Array.isArray(ref.also) ? ref.also.map(a => (isObject(a) ? a.id : undefined)) : [])].filter((x): x is string => typeof x === 'string')
/** What makes a foreign ref the same outside fact: its system, its id without case, and its payload (keys in order) —
 *  except a Snapshot vote, which is its system and id alone, whatever passing choice the payload names: one vote decides
 *  at most one proposal (controller ruling), so a second proposal attaching it with another label is ATTACHED_ELSEWHERE.
 *  Two proposals may wait on one hat for different wearers; never on the same hat for the same wearer. */
const foreignKey = (ref: ForeignRef): string => {
  const payload = ref.payload as Record<string, unknown>
  if (payload.kind === 'snapshot-proposal') return JSON.stringify([ref.system, String(ref.id).toLowerCase()])
  return JSON.stringify([ref.system, String(ref.id).toLowerCase(), Object.keys(payload).sort().map(k => [k, payload[k]])])
}
/** How a sentence names what a ref waits on. */
const named = (ref: OutcomeRef | null): string => (ref === null ? '(unnamed)' : foreign(ref) ? `${ref.id} on ${ref.system}` : `transaction ${ref.id}`)

type Refuse = (code: string, error: string) => Refusal

/** A ref's payload as an attach must give it, or null. */
function payloadOf(raw: unknown): SystemRef['payload'] | null {
  const p = isObject(raw) ? raw : null
  if (p === null || typeof p.to !== 'string' || typeof p.value !== 'string' || typeof p.data_hash !== 'string' ||
    typeof p.operation !== 'number' || typeof p.nonce !== 'number') return null
  return { to: p.to, value: p.value, data_hash: p.data_hash, operation: p.operation, nonce: p.nonce }
}

/** The system record `id` in data/systems.yaml, or null. */
function systemRecord(repo: string, id: string): Record<string, unknown> | null {
  return (readRegistryOrEmpty(repo, 'systems').entries ?? []).find(s => isObject(s) && String(s.id) === id) ?? null
}

/**
 * The ref an `attach` records, after the checks of spec §3.11: a system the proposal's rules wait on, in
 * data/systems.yaml. A Safe's ref (0.6, with DAO-OS L2's `chain` and `also`) is a transaction of the shape `prepare`
 * gives, each step's id the hash of its payload on its own chain (no network: the nonce is in the payload). Any other
 * system's ref is checked by its driver's `checkRef` (no network); a driver without one reads no outcomes, so nothing can
 * be attached for it. A Snapshot space's passing choice is the waiting rule's `decide.passes.choice` (ruling K2), filled
 * in here. Then: no other proposal holding the same outside fact, and, on this proposal, no reading yet of an earlier
 * attach (a second attach replaces the first only before a system event).
 */
function attachRef(repo: string, entry: Proposal, raw: unknown): OutcomeRef {
  if (!isObject(raw) || typeof raw.system !== 'string') throw new HttpError(400, `${ATTACH_SHAPE}.`)
  const refuse: Refuse = (code, error) => new Refusal(409, { code, error: `Not attached: ${error} Nothing was written.` })
  const waits = systemIds(entry)
  if (!waits.includes(raw.system)) {
    throw refuse('ATTACH', `this proposal waits on ${waits.length > 0 ? `the system ${waits.join(', ')}` : 'no outside system'}, not "${raw.system}".`)
  }
  const system = systemRecord(repo, raw.system)
  if (!system) throw refuse('ATTACH', `data/systems.yaml has no system "${raw.system}".`)
  const ref = (typeof system.driver === 'string' ? system.driver : 'link') === 'safe'
    ? safeRef(raw, system, refuse)
    : foreignRef(entry, raw, system, refuse)

  for (const other of readLedger(repo).entries) {
    if (String(other.id) === String(entry.id)) continue
    for (const e of liveEvents(other as never)) {
      if (e.kind !== 'attach') continue
      const held = refOf(e)
      if (held === null) continue
      if (foreign(ref)) {
        if (foreign(held) && foreignKey(held) === foreignKey(ref)) {
          throw refuse('ATTACHED_ELSEWHERE', ref.payload.kind === 'snapshot-proposal'
            ? `${ref.id} on ${ref.system} is already attached to proposal ${String(other.id)}; one vote decides at most one proposal.`
            : `${ref.id} on ${ref.system} is already attached to proposal ${String(other.id)} for the same outcome; one outside outcome decides one proposal.`)
        }
        continue
      }
      const taken = idsOf(ref).find(id => idsOf(held).some(h => sameId(h, id)))
      if (taken !== undefined) {
        throw refuse('ATTACHED_ELSEWHERE', `transaction ${taken} is already attached to proposal ${String(other.id)}; one transaction decides one proposal.`)
      }
    }
  }
  // The lock is per revision: a revision asks for a new attach (spec §3.11, LOW-6). A reading of a transaction the
  // service has not seen yet is never recorded, so it locks nothing.
  const current = currentAttach(entry)
  if (current && readingsFor(entry, current).length > 0) {
    throw refuse('ATTACHED', `this proposal already waits on ${named(refOf(current))}, and the system has been read for it. Withdraw the proposal and propose again, or revise it.`)
  }
  return ref
}

/** A Safe's ref: the shape `prepare` gives, every step's id the hash of its payload on its own chain, no id twice. */
function safeRef(raw: Record<string, unknown>, system: Record<string, unknown>, refuse: Refuse): SystemRef {
  const payload = payloadOf(raw.payload)
  if (typeof raw.id !== 'string' || payload === null ||
    (raw.chain !== undefined && typeof raw.chain !== 'string') || (raw.also !== undefined && !Array.isArray(raw.also))) {
    throw new HttpError(400, `${ATTACH_SHAPE}.`)
  }
  const also: NonNullable<SystemRef['also']> = []
  for (const a of (raw.also ?? []) as unknown[]) {
    const p = isObject(a) ? payloadOf(a.payload) : null
    if (!isObject(a) || typeof a.chain !== 'string' || typeof a.id !== 'string' || p === null) {
      throw new HttpError(400, `${ATTACH_SHAPE}; every step in "also" names its chain, its id and its payload.`)
    }
    also.push({ chain: a.chain, id: a.id.toLowerCase(), payload: p })
  }
  const ref: SystemRef = {
    system: String(raw.system), id: raw.id.toLowerCase(), ...(typeof raw.chain === 'string' ? { chain: raw.chain } : {}), payload,
    ...(also.length > 0 ? { also } : {}),
  }
  let chains: string[]
  try { chains = chainsOf(system) } catch (err) { throw refuse('ATTACH', `"${ref.system}" cannot be read: ${err instanceof Error ? err.message : String(err)}.`) }
  // Every step is checked on its own chain: the ref's own on its `chain` (absent: the record's), each `also` on its.
  const steps = [{ chain: ref.chain ?? String(system.chain), id: ref.id, payload: ref.payload, given: raw.id }, ...also.map(a => ({ ...a, given: a.id }))]
  for (const step of steps) {
    if (!chains.includes(step.chain)) {
      throw refuse('ATTACH', `${step.given} names the chain ${step.chain}, which is not one of ${ref.system}'s chains (${chains.join(', ')}).`)
    }
    const chainId = chainIdOf(step.chain)
    if (chainId === null) throw refuse('ATTACH', `"${ref.system}" names the chain ${step.chain}, which has no EIP-155 chain id.`)
    let hash: string
    try {
      hash = safeTxHash({ chainId, safe: String(system.address), to: step.payload.to, value: step.payload.value, dataHash: step.payload.data_hash, operation: step.payload.operation, nonce: step.payload.nonce })
    } catch (err) { throw new HttpError(400, `${ATTACH_SHAPE}: ${err instanceof Error ? err.message : String(err)}.`) }
    if (hash !== step.id) {
      throw refuse('ATTACH', `${step.given} is not the hash of its payload on ${ref.system} (chain ${step.chain}, Safe ${String(system.address)}): that payload's hash is ${hash}. Prepare the transaction again and attach what it gives.`)
    }
  }
  const mine = idsOf(ref)
  const twice = mine.find((id, i) => mine.indexOf(id) !== i)
  if (twice !== undefined) throw refuse('ATTACH', `transaction ${twice} is named twice in this ref.`)
  return ref
}

/** Another driver's ref, checked by that driver's `checkRef`; for a Snapshot space, with the waiting rule's passing choice. */
function foreignRef(entry: Proposal, raw: Record<string, unknown>, system: Record<string, unknown>, refuse: Refuse): ForeignRef {
  const id = String(raw.system)
  const name = typeof system.driver === 'string' ? system.driver : 'link'
  const driver = DRIVERS.find(d => d.name === name)
  if (!driver) throw refuse('ATTACH', `${id} is read by the ${name} driver, which is not installed.`)
  if (!driver.checkRef) throw refuse('ATTACH', `${id} is read by the ${name} driver, which reads no outcomes.`)
  const candidate = name === 'snapshot-space' ? withPassingChoice(entry, raw, refuse) : raw
  const checked = driver.checkRef(system, candidate)
  if (!checked.ok) throw refuse('ATTACH', `${checked.error.replace(/\.$/, '')}.`)
  return checked.ref
}

/** The ref with `payload.choice` set to the label the waiting rule passes on (`decide.passes.choice`, ruling K2). A rule
 *  that names none, rules that name different ones, or a body that names another, refuse the attach. */
function withPassingChoice(entry: Proposal, raw: Record<string, unknown>, refuse: Refuse): Record<string, unknown> {
  const rules = entry.rules.filter(r => methodOf(r) === 'system' && String(r.decide?.system) === raw.system)
  const choices: string[] = []
  for (const r of rules) {
    const choice = (r.decide as { passes?: { choice?: unknown } } | undefined)?.passes?.choice
    if (typeof choice !== 'string' || choice === '') throw refuse('ATTACH', `rule ${r.id} names no passing choice (decide.passes.choice).`)
    if (!choices.includes(choice)) choices.push(choice)
  }
  if (choices.length > 1) {
    throw refuse('ATTACH', `rules ${rules.map(r => r.id).join(', ')} pass on different choices (${choices.map(c => JSON.stringify(c)).join(', ')}); one vote cannot be read for both.`)
  }
  const choice = choices[0]!
  const payload = isObject(raw.payload) ? raw.payload : {}
  if (payload.choice !== undefined && payload.choice !== choice) {
    throw refuse('ATTACH', `rule ${rules[0]!.id} passes on ${JSON.stringify(choice)}, not ${JSON.stringify(payload.choice)}.`)
  }
  return { ...raw, payload: { kind: 'snapshot-proposal', ...payload, choice } }
}

/** The attach that counts now: the latest live one written at the proposal's current `rev`. A revision clears it, as
 *  it clears approvals: the author prepares again and attaches what that gives. */
export function currentAttach(entry: Proposal): LedgerEvent | undefined {
  return liveEvents(entry as never).filter(e => e.kind === 'attach' && e.rev === entry.rev).at(-1)
}

/** The system events recorded for `attach` at the current `rev`, in order. */
function readingsFor(entry: Proposal, attach: LedgerEvent): LedgerEvent[] {
  const id = refOf(attach)?.id
  return liveEvents(entry as never).filter(e => e.kind === 'system' && e.rev === entry.rev && sameId(refOf(e)?.id, id))
}

/** A reading after which nothing changes: the transaction was executed on chain, successfully or not. */
const FINAL = ['executed', 'failed']

/** What a check reads with: the server's SystemReader, or a test's stand-in. */
export type OutcomeSource = Pick<SystemReader, 'outcome'>

/** What a check read, outside the write lock: which attach it read for, and the reading. Null `reading`: nothing attached. */
export interface OutcomeRead { attach: string | null; system: string | null; ref: OutcomeRef | null; reading: OutcomeReading | null }

const systemIds = (entry: Proposal): string[] => [...new Set(entry.rules.filter(r => methodOf(r) === 'system').map(r => String(r.decide?.system)))]
const NO_SYSTEM = (entry: Proposal): string => `Nothing to check: proposal ${entry.id} waits on no outside system; its rules are decided by people.`
/** Said when a check would have nothing to read. */
export const NOTHING_ATTACHED = 'Nothing is attached to read yet.'

/** The system rules' system ids a proposal waits on, or the refusal when it waits on none. */
function systemsOf(entry: Proposal): string[] {
  const ids = systemIds(entry)
  if (ids.length === 0) throw new Refusal(409, { code: 'NO_SYSTEM', error: NO_SYSTEM(entry) })
  return ids
}

/** Whether a reading can be asked for now (the page's Check now), by readOutcome's guards in its order: a system the
 *  proposal waits on, the machine's SYSTEM event in this state, then an attach on the current rev to read. */
export function mayCheck(entry: Proposal, state: string, context: Record<string, unknown>): true | string {
  const ids = systemIds(entry)
  if (ids.length === 0) return NO_SYSTEM(entry)
  const decided = transition(machine, proposalGuards, state, { type: 'SYSTEM', by: `system:${ids[0]}` }, context)
  if (!decided.ok) return decided.reason
  return currentAttach(entry) ? true : NOTHING_ATTACHED
}

/**
 * Read the outcome of the transaction attached to proposal `id` (spec §3.11 "Read"): a network read, so it is made
 * outside the write lock, and writes nothing. 404 for a proposal not in the ledger, 409 for one that waits on no system
 * or cannot take a system event now (closed, stale: the machine's sentence).
 */
export async function readOutcome(repo: string, actor: KnownActor, id: string, systems: OutcomeSource | undefined, now: Date): Promise<OutcomeRead> {
  const entry = readLedger(repo).entries.find(e => String(e.id) === id)
  if (!entry) throw new HttpError(404, `The ledger has no proposal ${id}.`)
  const ids = systemsOf(entry)
  const { state, context } = machineContext(repo, actor, entry, now)
  const decided = transition(machine, proposalGuards, state, { type: 'SYSTEM', by: `system:${ids[0]}` }, context)
  if (!decided.ok) throw new MachineRefusal(machine.id, state, 'SYSTEM', decided.reason)
  const attach = currentAttach(entry)
  const ref = refOf(attach)
  if (!attach || !ref) return { attach: null, system: null, ref: null, reading: null }
  const system = systemRecord(repo, ref.system)
  if (!system) return { attach: attach.id, system: ref.system, ref, reading: { ok: false, error: `data/systems.yaml has no system "${ref.system}"` } }
  if (!systems) return { attach: attach.id, system: ref.system, ref, reading: { ok: false, error: 'this server was given no network access' } }
  return { attach: attach.id, system: ref.system, ref, reading: await systems.outcome(system, ref, String(entry.opened)) }
}

export interface OutcomeResult extends Omit<EventResult, 'commit'> {
  commit: string | null
  reading: OutcomeReading | null
  /** Whether a `system` event was appended: only when the reading differs from the latest one (§3.11 "Record"). */
  appended: boolean
  /** A failed read raises attention on the proposal; nothing is recorded. */
  attention?: { level: 'warn'; text: string }
}

/**
 * Record what `readOutcome` read, inside the write lock: one `system` event, `by: system:<id>`, at the current `rev`,
 * with the reading, when it differs from the latest reading of the attach that counts and that attach is still the one
 * read. Nothing is written for a failed read, an unchanged reading, an attach that moved meanwhile, a transaction the
 * service has not seen yet (a 404: no outside fact to record, and it must not lock the attach), or any reading after an
 * executed or failed one (execution is final on chain).
 */
export async function recordOutcome(repo: string, actor: KnownActor, id: string, read: OutcomeRead, deps: LedgerOptions = {}): Promise<OutcomeResult> {
  const now = (deps.now ?? (() => new Date()))()
  const entry = readLedger(repo).entries.find(e => String(e.id) === id)
  if (!entry) throw new HttpError(404, `The ledger has no proposal ${id}.`)
  const { reading } = read
  let commit: string | null = null
  let attention: OutcomeResult['attention']
  if (reading && !reading.ok) attention = { level: 'warn', text: `read failed: ${reading.error}` }
  const attach = currentAttach(entry)
  // Recorded: a reading of the attach that still counts, of a transaction the service has seen.
  if (reading?.ok && reading.submitted !== false && read.ref && read.system && attach && attach.id === read.attach) {
    const draft = {
      kind: 'system', rev: entry.rev, outcome: reading.outcome, ref: read.ref,
      ...(reading.confirmations !== undefined ? { confirmations: reading.confirmations } : {}),
      ...(reading.required !== undefined ? { required: reading.required } : {}),
      // Executed with success not known yet, and each chain's own reading (DAO-OS L7 §11.1, §11.2): kept beside the
      // aggregate for the cards; the evaluator reads the aggregate outcome only.
      ...(reading.executed ? { executed: true as const } : {}),
      ...(reading.chains ? { chains: reading.chains } : {}),
      text: reading.detail,
    }
    const latest = readingsFor(entry, attach).at(-1)
    const same = latest !== undefined && latest.outcome === draft.outcome &&
      latest.confirmations === draft.confirmations && latest.required === draft.required && latest.text === draft.text &&
      latest.executed === draft.executed && JSON.stringify(latest.chains) === JSON.stringify(draft.chains)
    // Execution is final on chain: once the attach reads executed (or failed), a later reading changes nothing.
    const final = latest !== undefined && FINAL.includes(String(latest.outcome))
    if (!same && !final) {
      const by = `system:${read.system}`
      const { state, context } = machineContext(repo, actor, entry, now)
      const decided = transition(machine, proposalGuards, state, { type: 'SYSTEM', by }, context)
      if (!decided.ok) throw new MachineRefusal(machine.id, state, 'SYSTEM', decided.reason)
      const who: LedgerWho = { actor: by, rule: entry.rules.map(r => `${r.id}/${methodOf(r)}`).join(','), ident: commitIdent(actor) }
      ;({ commit } = await appendEvent(repo, id, draft, who, { ...deps, now: () => now }))
    }
  }
  const written = readLedger(repo).entries.find(e => String(e.id) === id) as Proposal
  const after = machineContext(repo, actor, written, now)
  const branch = (await resolveRev(repo, `refs/heads/${written.branch ?? `proposal/${id}`}`)) === null ? 'missing' : 'built'
  return {
    proposal: written, commit, branch, evaluation: after.evaluation, can: canWrite(after.state, after.context, written, actor.id),
    reading, appended: commit !== null, ...(attention ? { attention } : {}),
  }
}
