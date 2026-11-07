// packages/admin/lib/machines/proposal.mjs
//
// A change sent for decision (architecture §4.4). A draft is the actor's open Change, not a
// proposal state. Open has four states (group 'open'): approving, objecting (a consent window
// running), voting, and stale (the trunk moved under its ops). Closed has four, each final:
// ratified (the merge and decision included), rejected, withdrawn, expired. Defined in P4, switched
// on by P2 (spec §3.3), whose rule evaluator supplies `outcome` and whose `eventPermission` is the one
// place who may write which event is written: the guards below call it and answer with its sentence.

import { defineMachine } from './run.mjs'
import { eventPermission } from '../proposals.mjs'

/** @typedef {import('../proposals.mjs').Proposal} Proposal */
/**
 * What a guard reads. `outcome` is `evaluateAll`'s state; `proposal`, `rules` (the proposal's rule
 * snapshot), `book` (the roles now) and `known` (the member ids) are what `eventPermission` asks.
 * `trunkMoved` says whether the trunk changed one of the ops' files since the proposal's base; absent reads as no.
 * @typedef {{ outcome?: 'met' | 'failed' | 'pending' | 'expired', method?: string, author?: string,
 *   proposal?: Pick<Proposal, 'author' | 'events'>, rules?: readonly object[], book?: import('../rules.mjs').RoleBook, known?: readonly string[],
 *   trunkMoved?: boolean }} ProposalContext
 */

const CLOSE = { WITHDRAW: { to: 'withdrawn', when: 'byAuthor' }, EXPIRE: { to: 'expired', when: ['pastDue', 'mayRatify'] }, TRUNK_MOVED: 'stale' }
/** Written in every open state a proposal can still be talked about in: a loop, never a move. */
const TALK = { COMMENT: { to: '', when: 'mayWrite' }, RETRACT: { to: '', when: 'mayWrite' }, REVISE: { to: '', when: 'mayWrite' } }
/** In the open states that are not stale: an attach, a system reading, and the mechanical replay any known actor may ask
 *  for (spec §3.5): the branch built again on the trunk tip, its new base recorded. Loops. A mechanical replay is wanted
 *  only when the trunk changed one of the ops' files since the proposal's base (`trunkMoved`, final review I4): its own
 *  event moves the trunk in the ledger alone, so a replay is a fixed point. */
const CURRENT = { ...TALK, ATTACH: { to: '', when: 'mayWrite' }, SYSTEM: { to: '', when: 'mayWrite' }, REPLAYED: { to: '', when: ['mayWrite', 'trunkMoved'] } }
const OPEN = 'open'

/** A loop in `state`. @param {string} state @param {Record<string, { to: string, when: string }>} events */
const loops = (state, events) => Object.fromEntries(Object.entries(events).map(([type, t]) => [type, { ...t, to: state }]))
/** The three ways a person closes a proposal whose rule has spoken. @type {Record<string, { to: string, when: string[] }>} */
const CLOSINGS = {
  RATIFY: { to: 'ratified', when: ['ruleMet', 'mayRatify'] },
  REJECT: { to: 'rejected', when: ['ruleFailed', 'mayRatify'] },
}

export const proposal = defineMachine({
  id: 'proposal',
  initial: 'approving',
  events: ['APPROVE', 'OBJECT', 'VOTE', 'COMMENT', 'RETRACT', 'ATTACH', 'SYSTEM', 'REVISE', 'TRUNK_MOVED', 'REPLAYED', 'RATIFY', 'REJECT', 'WITHDRAW', 'EXPIRE'],
  guards: ['ruleMet', 'ruleFailed', 'byAuthor', 'methodApprove', 'methodConsent', 'mayJudge', 'notAuthor', 'mayWrite', 'pastDue', 'mayRatify', 'authorChooses', 'trunkMoved'],
  states: {
    approving: {
      group: OPEN, shows: { mark: 'needs', text: 'Open: waiting for approvals.' },
      on: {
        APPROVE: { to: 'approving', when: ['mayJudge', 'notAuthor'] }, OBJECT: { to: 'approving', when: 'mayJudge' },
        ...loops('approving', CURRENT),
        ...CLOSINGS, ...CLOSE,
      },
    },
    objecting: {
      group: OPEN, shows: { mark: 'needs', text: 'Open: the objection window is running.' },
      on: {
        OBJECT: { to: 'objecting', when: 'mayJudge' },
        ...loops('objecting', CURRENT),
        ...CLOSINGS, ...CLOSE,
      },
    },
    voting: {
      group: OPEN, shows: { mark: 'needs', text: 'Open: voting.' },
      on: {
        VOTE: { to: 'voting', when: 'mayJudge' },
        ...loops('voting', CURRENT),
        ...CLOSINGS, ...CLOSE,
      },
    },
    stale: {
      group: OPEN, shows: { mark: 'stale', text: 'Open, but the trunk moved under it: it is replayed before anything is decided.' },
      on: {
        ...loops('stale', { COMMENT: TALK.COMMENT, RETRACT: TALK.RETRACT }),
        // A stale proposal cannot be re-based mechanically: an op's record changed, and only its author says what stands.
        REPLAYED: [{ to: 'approving', when: ['mayWrite', 'authorChooses', 'methodApprove'] }, { to: 'objecting', when: ['mayWrite', 'authorChooses', 'methodConsent'] }, { to: 'voting', when: ['mayWrite', 'authorChooses'] }],
        REVISE: [{ to: 'approving', when: ['mayWrite', 'methodApprove'] }, { to: 'objecting', when: ['mayWrite', 'methodConsent'] }, { to: 'voting', when: 'mayWrite' }],
        WITHDRAW: CLOSE.WITHDRAW, EXPIRE: CLOSE.EXPIRE, TRUNK_MOVED: 'stale',
      },
    },
    ratified: { shows: { mark: 'done', text: 'Ratified: merged and recorded as a decision.' }, final: true },
    rejected: { shows: { mark: null, text: 'Rejected. Its branch is kept.' }, final: true },
    withdrawn: { shows: { mark: null, text: 'Withdrawn by its author. Its branch is kept.' }, final: true },
    expired: { shows: { mark: null, text: 'Expired without a decision. Its branch is kept.' }, final: true },
  },
})

/** The event each machine event writes, for `eventPermission`. */
const KIND = Object.freeze({
  APPROVE: 'approve', OBJECT: 'object', VOTE: 'vote', COMMENT: 'comment', RETRACT: 'retract', ATTACH: 'attach', SYSTEM: 'system',
  REVISE: 'revise', REPLAYED: 'replay', RATIFY: 'ratify', REJECT: 'reject', EXPIRE: 'expire',
})

/** `eventPermission`'s answer to `event` in `ctx`: true, or the sentence. The table is not written here.
 *  @param {ProposalContext} ctx @param {import('./run.mjs').MachineEvent} event @returns {true | string} */
function permit(ctx, event) {
  if (!ctx.proposal || !ctx.book) throw new Error(`the proposal machine's guard for ${event.type} needs the proposal and the role book in its context.`)
  const kind = Object.hasOwn(KIND, event.type) ? KIND[/** @type {keyof typeof KIND} */ (event.type)] : undefined
  if (kind === undefined) return `${event.type} is not an event a member writes.`
  const actor = typeof event.by === 'string' ? event.by : ''
  return eventPermission(kind, {
    actor, proposal: ctx.proposal, rules: ctx.rules ?? ctx.proposal.rules ?? [], book: ctx.book, known: ctx.known,
    of: typeof event.of === 'string' ? event.of : undefined,
  }) ?? true
}

/** @type {import('./run.mjs').Guards} */
export const proposalGuards = {
  ruleMet: (/** @type {ProposalContext} */ ctx) => ctx.outcome === 'met' || 'its rule is not met yet',
  ruleFailed: (/** @type {ProposalContext} */ ctx) => ctx.outcome === 'failed' || 'its rule has not failed',
  pastDue: (/** @type {ProposalContext} */ ctx) => ctx.outcome === 'expired' || 'its time has not run out yet',
  byAuthor: (/** @type {ProposalContext} */ ctx, e) => (e.by !== undefined && e.by === ctx.author) || 'only its author can withdraw a proposal',
  // A stale proposal is replayed with the author's choice for the ops whose record the trunk changed (spec §3.5).
  authorChooses: (/** @type {ProposalContext} */ ctx, e) => {
    if (e.by === undefined || e.by !== ctx.author) return 'only its author can replay a stale proposal: Keep mine or Take theirs, for an op whose record the trunk changed, is their choice'
    return e.choose === 'mine' || e.choose === 'theirs' || 'a stale proposal is replayed with a choice: Keep mine or Take theirs, for each op whose record the trunk changed'
  },
  // A mechanical replay with nothing to bring: the trunk changed none of the ops' files since the base (final review I4).
  trunkMoved: (/** @type {ProposalContext} */ ctx) => ctx.trunkMoved === true || 'Already on the trunk: nothing to replay.',
  methodApprove: (/** @type {ProposalContext} */ ctx) => ctx.method === 'approve' || 'its rule does not collect approvals',
  methodConsent: (/** @type {ProposalContext} */ ctx) => ctx.method === 'consent' || 'its rule does not run an objection window',
  // The one place who may write what is `eventPermission` (lib/proposals.mjs). A decider's event (approve,
  // object, vote), then the author question of the approve contract, then every other event and the closings.
  mayJudge: (/** @type {ProposalContext} */ ctx, e) => permit(ctx, e),
  notAuthor: (/** @type {ProposalContext} */ ctx, e) => (e.by === ctx.proposal?.author ? permit(ctx, e) : true),
  mayWrite: (/** @type {ProposalContext} */ ctx, e) => permit(ctx, e),
  mayRatify: (/** @type {ProposalContext} */ ctx, e) => permit(ctx, e),
}

/** Where a proposal opened under a rule of this method starts (P4a ruling 9).
 *  @param {string} method @returns {'approving' | 'objecting' | 'voting'} */
export function proposalInitial(method) {
  if (method === 'consent') return 'objecting'
  if (method === 'vote') return 'voting'
  return 'approving'
}
