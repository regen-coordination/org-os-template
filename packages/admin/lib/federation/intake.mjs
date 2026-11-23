// packages/admin/lib/federation/intake.mjs
//
// How a hub receives a request, under its `join` block (N2, spec §6.5, R17). Pure: it only decides; writing is the
// hub operator's own act. No `join` block means closed, and `open` without a standing `decision` means
// open-with-approval.

import { inviteMatch } from './invite.mjs'

/** @typedef {import('./read.mjs').Join} Join
 *  @typedef {import('./request.mjs').FederationRequest} FederationRequest
 *  @typedef {import('./invite.mjs').Invite} Invite
 *  @typedef {{ kind: 'refuse', reason: string } | { kind: 'accept', by: 'invite', invite: Invite }
 *   | { kind: 'accept', by: 'standing', decision: string } | { kind: 'propose' }} IntakeOutcome */

/** @param {Join | null} join @param {FederationRequest} request @param {readonly Invite[]} invites
 *  @param {string | Date} now @returns {IntakeOutcome} */
export function intakeOutcome(join, request, invites, now) {
  if (!join || join.policy === 'closed') return { kind: 'refuse', reason: "This network isn't taking requests." }
  if (join.types.length > 0 && !join.types.includes(request.from.type)) {
    return { kind: 'refuse', reason: `This network takes ${join.types.join(', ')}.` }
  }
  for (const ask of join.asks) {
    if ((request.answers[ask] ?? '').trim() === '') return { kind: 'refuse', reason: `Answer "${ask}".` }
  }
  if (join.policy === 'invite') {
    const match = inviteMatch(invites, request.invite, request, now)
    if ('problem' in match) return { kind: 'refuse', reason: `This network joins by invite. ${match.problem}` }
    return { kind: 'accept', by: 'invite', invite: match.invite }
  }
  if (join.policy === 'open' && join.decision) return { kind: 'accept', by: 'standing', decision: join.decision }
  return { kind: 'propose' }
}
