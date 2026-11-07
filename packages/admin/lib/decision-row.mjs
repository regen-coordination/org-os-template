// packages/admin/lib/decision-row.mjs
//
// The row of `governance.decisions` a decided proposal gets (P2 spec §3.9): ratified, rejected or expired. Plain ESM,
// no `node:*` import and no `server/` import, because the root validator reads it too (Task 14a). It takes the
// proposal and the evaluation that decided it and answers the row; the splice into the file is `decision-write.mjs`.

import { leadMethod, methodOf } from './proposals.mjs'

/** @typedef {import('./decision-write.mjs').DecisionRow} DecisionRow */
/** @typedef {import('./proposals.mjs').Proposal} Proposal */
/** @typedef {import('./evaluate.mjs').Evaluation} Evaluation */
/** @typedef {{ state: string, missing: string, parts: { rule: any, evaluation: Evaluation }[] }} EvaluatedAll */

/** @template T @param {T[]} list @returns {T[]} */
const unique = list => [...new Set(list)]
/** @param {number} n @param {string} one @param {string} [many] */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A list of members in words: "carla", "carla and bruno", "ana, carla and bruno". @param {string[]} names */
const named = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

/** One rule's tally in words, true to how the proposal ended: "1 approval (bruno); no objection.", or, for a proposal
 *  that lapsed under an objection, "0 approvals; held by an objection (carla) until it expired."
 *  @param {object} rule @param {Evaluation} evaluation @param {'ratified' | 'rejected' | 'expired'} outcome */
function summaryOf(rule, evaluation, outcome) {
  const t = /** @type {Record<string, string[] | undefined>} */ (/** @type {unknown} */ (evaluation.tally))
  const method = methodOf(/** @type {never} */ (rule))
  const objecting = t.objecting ?? []
  const lapsed = outcome === 'expired'
  const held = objecting.length > 0 ? `held by an objection (${named(objecting)}) until it expired.` : ''
  if (method === 'consent') {
    if (!lapsed) return 'no objection within the window.'
    return held || 'the objection window did not close before it expired.'
  }
  if (method === 'vote') {
    const ballots = `${t.for?.length ?? 0} yes, ${t.against?.length ?? 0} no, ${t.abstain?.length ?? 0} abstaining`
    return lapsed ? `${ballots}; it expired without a decision.` : `${ballots}.`
  }
  if (method === 'system') {
    if (outcome === 'rejected') return 'the system reported the transaction failed.'
    return lapsed ? 'the system had not executed it before it expired.' : 'executed by the system.'
  }
  const approvers = t.for ?? []
  const counted = `${plural(approvers.length, 'approval')}${approvers.length > 0 ? ` (${approvers.join(', ')})` : ''}`
  if (!lapsed) return `${counted}; no objection.`
  return `${counted}; ${held || 'nobody decided it before it expired.'}`
}

/**
 * The decision row of a proposal decided with `outcome`, from the evaluation that decided it. `status` equals
 * `outcome` (the governance schema requires it). Throws when the proposal's rules name no method.
 * @param {Proposal} proposal @param {EvaluatedAll} evaluation
 * @param {{ id: string, date: string, outcome: 'ratified' | 'rejected' | 'expired' }} at
 * @returns {DecisionRow & { outcome: 'ratified' | 'rejected' | 'expired' }}
 */
export function decisionRowFor(proposal, evaluation, at) {
  const several = evaluation.parts.length > 1
  const method = leadMethod(proposal.rules)
  if (method === null) throw new Error(`the rules of ${proposal.id} name no method, so no decision row can say how it was decided`)
  return {
    id: at.id,
    proposal: proposal.id,
    rule: proposal.rules.map(r => r.id).join(','),
    method,
    outcome: at.outcome,
    status: at.outcome,
    by: unique(evaluation.parts.flatMap(p => /** @type {string[]} */ (/** @type {any} */ (p.evaluation.tally).for ?? []))),
    date: at.date,
    title: proposal.title,
    summary: evaluation.parts.map(p => `${several ? `rule "${p.rule.id}": ` : ''}${summaryOf(p.rule, p.evaluation, at.outcome)}`).join(' '),
  }
}
