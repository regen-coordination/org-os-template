import { createElement, type ReactNode } from 'react'
import type { ProposalView } from '../../api.ts'
import { chainName } from '../atoms/chain.ts'
import { num, record, str } from '../rows/systemState.ts'
import type { PreparedView } from './prepared.ts'

/** Where a step of a proposal's path stands (§9.5): `yours` is the step you completed while it still waits on others
 *  (your approval). */
export type StepState = 'done' | 'current' | 'waiting' | 'yours' | 'failed' | 'not-needed'
/** A meter on a step's second line (§7.13): its words follow it ("2 of 4 · you approved"). */
export interface StepMeter { done: number; of: number; yours?: number; words: string }
/** One step of the path: its title, its state, and its second line — a meter and words, a date, who, a reference. */
export interface Step {
  id: 'proposed' | 'approvals' | 'decided' | 'prepared' | 'signed' | 'read-back'
  title: string
  state: StepState
  line?: ReactNode
  meter?: StepMeter
}

/** What the signed step always says (§9.5): the Hub never signs. */
export const NEVER_HERE = 'signers sign in the Safe app, never here'
/** Classes of action, not of record (lib/change-classes.mjs): only these need a transaction. */
const ACTION_CLASSES: ReadonlySet<string> = new Set(['treasury', 'operations'])
const CLOSED_WORD: Record<string, string> = { rejected: 'Rejected', withdrawn: 'Withdrawn', expired: 'Expired' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "16 Oct 2026", in local time; "" for a date that cannot be read. A path is read at any time, so its dates are whole. */
function dateOf(iso: unknown): string {
  const d = new Date(String(iso ?? ''))
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
const joined = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ')
const names = (chains: string[]) => [...new Set(chains.map(chainName))].join(', ')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

type Part = ProposalView['evaluation']['parts'][number]
/** A rule a system decides (a Safe that executes), not a person. */
const bySystem = (p: Part) => { const d = record(p.rule.decide); return d.by === 'system' || d.method === 'system' }

/** A rule's count as a meter: approvals against the number needed, or ballots cast against the quorum. The actor's
 *  own is the moss segment, with "you approved". None for a rule that counts nothing (a consent window). RuleStatus
 *  draws the same count. */
export function ruleMeter(t: Part['evaluation']['tally'], actor: string | null): StepMeter | undefined {
  const needed = num(t.needed)
  if (needed === null || !Array.isArray(t.for)) return undefined
  if (Array.isArray(t.against)) {
    const cast = [...t.for, ...t.against, ...(t.abstain ?? [])]
    const yours = actor !== null && cast.includes(actor) ? { yours: 1 } : {}
    return { done: cast.length, of: needed, ...yours, words: cast.length < needed ? `${cast.length} of ${needed} voted` : `${cast.length} voted · quorum ${needed}` }
  }
  const mine = actor !== null && t.for.includes(actor)
  return { done: t.for.length, of: needed, ...(mine ? { yours: 1 } : {}), words: `${t.for.length} of ${needed}${mine ? ' · you approved' : ' approved'}` }
}

/** The approvals step's title from its first people rule: "Council approvals", "Members vote", "Council consent". */
function approvalsTitle(part: Part | undefined): string {
  const d = record(part?.rule.decide)
  const who = cap(str(d.by) ?? '')
  const what = d.method === 'vote' ? 'vote' : d.method === 'consent' ? 'consent' : 'approvals'
  return who ? `${who} ${what}` : cap(what)
}

/** The step for the people's say, and whether every rule a person decides is met (CC-10). */
function approvalsStep(view: ProposalView, people: Part[], actor: string | null): { step: Step; met: boolean } {
  const title = approvalsTitle(people[0])
  const met = people.every(p => p.evaluation.state === 'met')
  if (people.length === 0) return { step: { id: 'approvals', title: 'Approvals', state: 'not-needed', line: 'No person’s approval: a system decides' }, met }
  const meter = people.map(p => ruleMeter(p.evaluation.tally, actor)).find(m => m !== undefined)
  const withMeter = meter ? { meter } : {}
  const closed = CLOSED_WORD[String(view.state)]
  const missing = people.find(p => p.evaluation.state !== 'met')?.evaluation.missing
  if (!met && closed) {
    const by = str(record(view.closed).by)
    const line = view.state === 'withdrawn' && by ? `${by} withdrew it` : missing || view.evaluation.missing
    return { step: { id: 'approvals', title: closed, state: 'failed', line, ...withMeter }, met }
  }
  if (met) return { step: { id: 'approvals', title, state: 'done', ...withMeter }, met }
  const lost = people.find(p => p.evaluation.state === 'failed' || p.evaluation.state === 'expired')
  if (lost) return { step: { id: 'approvals', title: lost.evaluation.state === 'expired' ? 'Expired' : 'Not approved', state: 'failed', line: lost.evaluation.missing, ...withMeter }, met }
  const yours = meter?.yours === 1
  return { step: { id: 'approvals', title, state: yours ? 'yours' : 'current', ...withMeter, ...(meter ? {} : { line: missing }) }, met }
}

/** When the people decided: the closing of a ratified proposal, else the last approval or ballot at its rev. */
function decidedAt(view: ProposalView): string {
  if (view.state === 'ratified') return dateOf(record(view.closed).at)
  const said = (view.events as unknown as Record<string, unknown>[]).filter(e => e.rev === view.rev && (e.kind === 'approve' || e.kind === 'vote'))
  return said.length > 0 ? dateOf(said.at(-1)!.at) : ''
}

/** How one chain's transaction stands for signing, and for reading back. */
type Sign = 'waiting' | 'pending' | 'done'
function signOf(tx: PreparedView): Sign {
  switch (tx.state) {
    case 'unsigned': case 'partly-signed': return 'pending'
    case 'ready': case 'executed': case 'mismatch': return 'done'
    default: return 'waiting' // preparing, stale, replaced: nothing to sign (a used nonce, an outdated payload)
  }
}
/** A read back's failure, in its title and words; null when the read back did not fail. */
function readBackFailure(tx: PreparedView): { title: string; line: string } | null {
  const on = chainName(tx.safe.chain)
  if (tx.state === 'replaced') return { title: 'Read back: replaced', line: `Nonce ${tx.nonce} was used by another transaction. Prepare again.` }
  if (tx.state === 'mismatch') return { title: 'Read back: not what was prepared', line: tx.outcome?.differs?.filter(Boolean).join(' ') || 'What ran differs from what was prepared.' }
  if (tx.state === 'executed' && tx.outcome?.failed) return { title: 'Read back: the transaction failed', line: `Executed on ${on}, and the transaction failed. Nothing it would have moved has moved.` }
  return null
}
const executed = (tx: PreparedView) => tx.state === 'executed' && !tx.outcome?.failed

/** The prepared, signed and read-back steps from the per-chain cards (L2-C3): each step is done only when every
 *  chain's is, failed if any chain's failed, else current (or waiting), naming the chains still waiting. */
function chainSteps(prepared: PreparedView[], decided: boolean): Step[] {
  const many = prepared.length > 1
  const where = (tx: PreparedView, line: string) => (many ? `On ${chainName(tx.safe.chain)}: ${line}` : line)

  const stale = prepared.find(tx => tx.state === 'stale')
  const preparing = prepared.some(tx => tx.state === 'preparing')
  const preparedStep: Step = stale
    ? { id: 'prepared', title: 'Transaction prepared', state: 'failed', line: where(stale, 'The proposal changed after this was prepared. Prepare again.') }
    : preparing
      ? { id: 'prepared', title: 'Transaction prepared', state: 'current', line: 'Reading the nonce from the Safe…' }
      : { id: 'prepared', title: 'Transaction prepared', state: 'done', line: cap(prepared.map(tx => `nonce ${tx.nonce} on ${chainName(tx.safe.chain)}`).join(' · ')) }

  const signs = prepared.map(signOf)
  const pending = prepared.filter((_, i) => signs[i] === 'pending')
  let signed: Step
  if (signs.every(s => s === 'done')) signed = { id: 'signed', title: 'Signed in the Safe', state: 'done', line: joined(many ? `Signed on ${names(prepared.map(tx => tx.safe.chain))}` : `${prepared[0]!.signed} of ${prepared[0]!.of}`, NEVER_HERE) }
  else if (preparedStep.state === 'done' && pending.length > 0) {
    const one = pending.length === 1 && !many ? pending[0]! : null
    signed = one
      ? { id: 'signed', title: 'Signed in the Safe', state: 'current', line: NEVER_HERE, meter: { done: one.signed, of: one.of, ...(one.yours ? { yours: one.yours } : {}), words: `${one.signed} of ${one.of}` } }
      : { id: 'signed', title: 'Signed in the Safe', state: 'current', line: joined(`Waiting on ${names(pending.map(tx => tx.safe.chain))}`, NEVER_HERE) }
  } else signed = { id: 'signed', title: 'Signed in the Safe', state: 'waiting', line: NEVER_HERE }

  const failure = prepared.map(tx => ({ tx, f: readBackFailure(tx) })).find(x => x.f !== null)
  const unread = prepared.filter(tx => !executed(tx))
  const watching = `The Hub watches ${names(unread.map(tx => tx.safe.chain))} for the result`
  const lostRead = prepared.some(tx => tx.readFailed) ? 'Couldn’t read the Safe; the last reading stands' : null
  // an outdated payload, or one still being prepared, will not run as it is: nothing is watched for yet (review M-1)
  const nothingYet = stale !== undefined || prepared.every(tx => tx.state === 'preparing') ? 'Nothing to read back yet' : null
  let readBack: Step
  if (failure) readBack = { id: 'read-back', title: failure.f!.title, state: 'failed', line: where(failure.tx, failure.f!.line) }
  else if (unread.length === 0) readBack = { id: 'read-back', title: 'Read back', state: 'done', line: `Executed on ${names(prepared.map(tx => tx.safe.chain))} · matched what was prepared` }
  else readBack = { id: 'read-back', title: 'Read back', state: signed.state === 'done' && decided ? 'current' : 'waiting', line: nothingYet ?? lostRead ?? watching }
  return [preparedStep, signed, readBack]
}

/** A proposal's path (§9.5, CC-10): Proposed → approvals → Decided → Transaction prepared → Signed in the Safe → Read
 *  back. `prepared` is one card per chain (`preparedFromProposal`, or the prepare reply); `actor` makes their approval
 *  theirs. Decided is done when every rule a person decides is met: a rule that waits on a Safe ratifies only after
 *  read back. With nothing prepared and only records changed, no transaction is needed. */
export function timelineOf(view: ProposalView, prepared: PreparedView[], actor: string | null): Step[] {
  const people = view.evaluation.parts.filter(p => !bySystem(p))
  const proposed: Step = { id: 'proposed', title: 'Proposed', state: 'done', line: joined(dateOf(view.opened), String(view.author ?? '')) }
  const { step: approvals, met } = approvalsStep(view, people, actor)
  const decision = str(record(view.closed).decision)
  const decided: Step = met
    ? { id: 'decided', title: 'Decided', state: 'done',
        line: people.length === 0 ? undefined : createElement('span', null, joined(decidedAt(view), people.length === 1 ? 'rule met' : 'every rule met'),
          decision ? ' · ' : null, decision ? createElement('span', { className: 'mono' }, decision) : null) }
    : { id: 'decided', title: 'Decided', state: 'waiting' }

  // the people said no (or it closed without them): nothing after them will happen (review M-2); the signed step still
  // says where signers sign
  if (approvals.state === 'failed') {
    return [proposed, approvals, decided,
      { id: 'prepared', title: 'Transaction prepared', state: 'not-needed' },
      { id: 'signed', title: 'Signed in the Safe', state: 'not-needed', line: NEVER_HERE },
      { id: 'read-back', title: 'Read back', state: 'not-needed' }]
  }
  const action = ((view.classes as string[] | undefined) ?? []).some(c => ACTION_CLASSES.has(c))
  if (prepared.length === 0 && !action) {
    return [proposed, approvals, decided,
      { id: 'prepared', title: 'No transaction needed', state: 'not-needed', line: 'This decision changes records only' },
      { id: 'signed', title: 'Signed in the Safe', state: 'not-needed', line: joined('Nothing to sign', NEVER_HERE) },
      { id: 'read-back', title: 'Read back', state: 'not-needed', line: 'Nothing to read back' }]
  }
  if (prepared.length === 0) {
    return [proposed, approvals, decided,
      met ? { id: 'prepared', title: 'Transaction prepared', state: 'current', line: 'Waiting to be prepared' }
        : { id: 'prepared', title: 'Transaction prepared', state: 'waiting', line: 'Prepared once the proposal is decided' },
      { id: 'signed', title: 'Signed in the Safe', state: 'waiting', line: NEVER_HERE },
      { id: 'read-back', title: 'Read back', state: 'waiting', line: 'The Hub reads the result back from the chain' }]
  }
  return [proposed, approvals, decided, ...chainSteps(prepared, met)]
}

const DOING: Partial<Record<Step['id'], string>> = { approvals: 'Approving', decided: 'Deciding', prepared: 'Preparing', signed: 'Signing', 'read-back': 'Reading back' }

/** The compact form's one phrase (§9.5): the step under way and its count ("Signing · 2 of 4"); a failed step's title;
 *  "Done" once read back, "Decided" when nothing more is needed. */
export function compactPhrase(steps: Step[]): string {
  const at = steps.find(s => s.state === 'failed' || s.state === 'current' || s.state === 'yours')
  if (at?.state === 'failed') return at.title
  if (at) {
    const doing = at.id === 'approvals' && /vote$/.test(at.title) ? 'Voting' : at.id === 'approvals' && /consent$/.test(at.title) ? 'Consent window' : DOING[at.id] ?? at.title
    return at.meter ? `${doing} · ${at.meter.done} of ${at.meter.of}` : doing
  }
  const last = [...steps].reverse().find(s => s.state === 'done')
  return last?.id === 'read-back' ? 'Done' : last?.title ?? ''
}
