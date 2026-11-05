import type { ProposalDetail, ProposalView, Resource } from '../../api.ts'
import type { LedgerEvent } from '../../../../lib/proposals.mjs'

/** Proposal fixtures: synthetic members ana, bruno, carla. /parts, the block contract test and the
 *  proposal parts' tests draw from these, never from an instance. */
export const PROPOSAL_NOW = new Date('2026-10-17T12:00:00Z')
const iso = (hours: number) => new Date(PROPOSAL_NOW.getTime() + hours * 3_600_000).toISOString()

export type Result = ProposalView['evaluation']['parts'][number]['evaluation']
export const result = (over: Partial<Result> = {}): Result =>
  ({ state: 'pending', missing: 'needs 1 more approval from a maintainer', tally: { for: ['ana'], needed: 2 }, closesAt: iso(120), ...over })

/** One rule result in each status the parts draw. */
export const RESULTS = {
  met: result({ state: 'met', missing: '', tally: { for: ['ana', 'bruno'], needed: 2 }, closesAt: null }),
  waiting: result(),
  window: result({ missing: 'the objection window closes in 2 days', tally: { objecting: [] }, closesAt: iso(48) }),
  held: result({ missing: 'held by an objection from bruno: answer it, or retract it', tally: { objecting: ['bruno'] }, closesAt: iso(72) }),
  failed: result({ state: 'failed', missing: '1 of 3 votes for or against were yes, and the rule asks for 66%',
    tally: { for: ['ana'], against: ['bruno', 'carla'], abstain: [], needed: 2 }, closesAt: null }),
  expired: result({ state: 'expired', missing: 'nobody decided it within 14 days, so it expired', tally: { for: [] }, closesAt: null }),
} satisfies Record<string, Result>

const SENTENCE = {
  approve: 'two maintainers approve',
  consent: 'a maintainer decides unless a member objects within 3 days',
  vote: 'members vote; two thirds of the votes for or against decide',
}

let n = 0
/** A proposal as GET /api/proposals gives it. */
export function proposalView(over: Partial<ProposalView> & { lead?: Result; method?: keyof typeof SENTENCE } = {}): ProposalView {
  const { lead = RESULTS.waiting, method = 'approve', ...rest } = over
  n += 1
  const id = rest.id ?? `p-2026-10-1${(n % 5) + 1}-00${(n % 3) + 1}`
  const base = {
    id, title: 'Move the garden seat to the board', author: 'carla', classes: ['records'], state: 'open', opened: iso(-30), rev: 'a1b2c3d4e5f6',
    ops: [{ op: 'update', record: 'projects:garden', set: { lead: 'ana' }, base: 'h1' }],
    events: [{ id: 'e-1', at: iso(-30), by: 'carla', kind: 'comment', text: 'Opened for review.' }],
    rules: [{ direct: false, sentence: SENTENCE[method], source: `data/proposals.yaml ${id} rules: r1` }],
    derived: method === 'vote' ? 'voting' : method === 'consent' ? 'objecting' : 'approving',
    evaluation: { state: lead.state === 'pending' ? 'pending' : lead.state, missing: lead.missing, parts: [{ rule: { id: 'r1', applies_to: ['all'], decide: { by: 'maintainer', method } }, evaluation: lead }], closesAt: lead.closesAt },
    stale: [], needsYou: false, can: [], cannot: {}, branchState: 'built',
    check: `Nothing to check: proposal ${id} waits on no outside system; its rules are decided by people.`,
  }
  return { ...base, ...rest } as unknown as ProposalView
}

/** A proposal as GET /api/proposals/:id gives it: the view, the diff, and each op's record on the trunk now. */
export function proposalDetail(over: Partial<ProposalDetail> & { lead?: Result; method?: keyof typeof SENTENCE } = {}): ProposalDetail {
  const { diff = '--- a/data/projects.yaml\n+++ b/data/projects.yaml\n-    lead: "carla"\n+    lead: "ana"\n', current, note, ...rest } = over
  const v = proposalView(rest)
  return { ...v, diff, ...(note !== undefined ? { note } : {}),
    current: current ?? (v.ops as unknown[]).map(() => ({ id: 'garden', title: 'Garden seat', lead: 'carla' })) } as ProposalDetail
}

/** Every state a proposal is drawn in. */
export const proposalViews: ProposalView[] = [
  proposalView({ id: 'p-2026-10-16-001', title: 'Move the garden seat to the board', needsYou: true, can: ['approve', 'object', 'comment'] }),
  proposalView({ id: 'p-2026-10-16-002', title: 'Open the spring call to non-members', author: 'ana', method: 'consent', lead: RESULTS.held, derived: 'objecting',
    events: [
      { id: 'e-2', at: iso(-30), by: 'ana', kind: 'comment', text: 'Opening this up.' },
      { id: 'e-3', at: iso(-20), by: 'bruno', kind: 'object', rev: 'a1b2c3d4e5f6', text: 'Strangers could vote on the budget: it harms the aim of a closed circle.' },
    ] }),
  proposalView({ id: 'p-2026-10-15-001', title: 'Adopt the new budget line', author: 'bruno', method: 'vote', lead: result({ missing: 'voting closes in 2 days; 1 of 3 have voted, quorum is 2', tally: { for: ['ana'], against: [], abstain: [], needed: 2 }, closesAt: iso(48) }),
    derived: 'voting', needsYou: true, can: ['vote', 'comment'] }),
  proposalView({ id: 'p-2026-10-14-001', title: 'Rename the host cooperative', stale: [0], derived: 'stale', lead: RESULTS.waiting }),
  proposalView({ id: 'p-2026-10-13-001', title: 'Add a second signer', state: 'ratified', derived: 'ratified', lead: RESULTS.met,
    closed: { at: iso(-24), by: 'ana', decision: null } as never }),
  proposalView({ id: 'p-2026-10-12-001', title: 'Pay the retreat deposit', method: 'vote', state: 'rejected', derived: 'rejected', lead: RESULTS.failed,
    closed: { at: iso(-48), by: 'carla', decision: null } as never }),
  proposalView({ id: 'p-2026-10-11-001', title: 'Change the logo', state: 'withdrawn', derived: 'withdrawn', closed: { at: iso(-72), by: 'carla', decision: null } as never }),
  proposalView({ id: 'p-2026-10-01-001', title: 'Join the regional network', state: 'expired', derived: 'expired', lead: RESULTS.expired, closed: { at: iso(-96), by: 'system', decision: null } as never }),
]

/** Every kind of event, in the order a proposal's life gives them. */
export const eventFixtures = [
  { id: 'e-a', at: iso(-30), by: 'carla', kind: 'comment', text: 'Opened for review.' },
  { id: 'e-b', at: iso(-28), by: 'ana', kind: 'approve', rev: 'a1b2c3d4e5f6' },
  { id: 'e-c', at: iso(-26), by: 'bruno', kind: 'object', rev: 'a1b2c3d4e5f6', text: 'It harms the aim: members would lose their say.' },
  { id: 'e-d', at: iso(-25), by: 'bruno', kind: 'object', rev: 'oldrev000000', text: 'An argument about an earlier version.' },
  { id: 'e-e', at: iso(-24), by: 'carla', kind: 'vote', rev: 'a1b2c3d4e5f6', vote: 'yes' },
  { id: 'e-f', at: iso(-23), by: 'bruno', kind: 'vote', rev: 'a1b2c3d4e5f6', vote: 'abstain' },
  { id: 'e-g', at: iso(-22), by: 'bruno', kind: 'retract', of: 'e-c' },
  { id: 'e-h', at: iso(-21), by: 'carla', kind: 'revise', rev: 'a1b2c3d4e5f6' },
  { id: 'e-i', at: iso(-20), by: 'system:replay', kind: 'replay' },
  { id: 'e-j', at: iso(-19), by: 'carla', kind: 'attach', rev: 'a1b2c3d4e5f6', ref: { system: 'safe', id: '0xabc123' } },
  { id: 'e-k', at: iso(-18), by: 'system:safe', kind: 'system', rev: 'a1b2c3d4e5f6', outcome: 'executed', text: 'executed with 2 of 2 confirmations' },
  { id: 'e-l', at: iso(-17), by: 'ana', kind: 'ratify' },
  { id: 'e-m', at: iso(-16), by: 'carla', kind: 'withdraw', text: 'No longer needed.' },
  { id: 'e-n', at: iso(-15), by: 'ana', kind: 'reject' },
  { id: 'e-o', at: iso(-14), by: 'system:clock', kind: 'expire' },
] as LedgerEvent[]

/** The proposals as the resource store gives them (server/resources/adapters/proposals.ts). */
export const proposalResources: Resource[] = proposalViews.map(v => ({
  id: `proposal:${v.id}`, kind: 'proposal', board: 'organization', name: String(v.title), status: v.derived,
  attention: v.state !== 'open' ? null : v.stale.length > 0 ? { level: 'alert', text: 'stale: 1 op was staged against a record that has changed' }
    : { level: 'warn', text: `open: ${v.evaluation.missing}` },
  changed: null, facts: { author: v.author, opened: v.opened, evaluation: v.evaluation.state, missing: v.evaluation.missing, closesAt: v.evaluation.closesAt, stale: v.stale, ops: (v.ops as unknown[]).length },
  source: { path: 'data/proposals.yaml', editable: false, registry: 'proposals', entityId: String(v.id) },
}))
