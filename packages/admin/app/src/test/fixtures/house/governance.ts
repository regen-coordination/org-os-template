/** The house's governance (spec §17), as /parts draws it: open proposals in the shape GET /api/proposals gives them
 *  (`ProposalView`, with `needsYou` and `evaluation`), the proposals as the resource store lists them, and the Systems
 *  Needs you reads beside them. B3 draws Needs you from these; B5, B4 and B6 extend the file (prepared transactions, the
 *  proposal timeline and its rows, the role tree and the fund flow). Placeholder roles only (`council-steward` is the member /parts is drawn for); ledger ids (G-7); every
 *  date is relative to FIXED_NOW. */
import type { ProposalView, Resource } from '../../../api.ts'
import type { DriverRead } from '../../../../../server/systems/driver.ts'
import type { HatFact } from '../../../../../server/systems/hats.ts'
import { childHatId, hatRef, prettyHatId, topHatId } from '../../../../../lib/hats.mjs'
import type { Flow } from '../../../elements/governance/fundflow.ts'
import type { PreparedView } from '../../../elements/governance/prepared.ts'
import { roleTreeFrom, type RoleNode } from '../../../elements/governance/roles.ts'
import { FIXED_NOW } from '../parts.ts'
import { ROLES as PEOPLE, SAFE, fakeAddress } from './org.ts'
import { ROLES as ROLES_SYSTEM, SYSTEMS, TREASURY_SYSTEM, hatRefOf, minutesBefore } from './systems.ts'

/** The member /parts is drawn for: Needs you is theirs. */
export const ACTOR = 'council-steward'

const DAY = 86_400_000
/** An instant this many days after the fixtures' clock (before it when negative). */
export const daysFrom = (days: number) => new Date(FIXED_NOW.getTime() + days * DAY).toISOString()

type Tally = { for?: string[]; needed?: number }
type Method = 'approve' | 'system'
interface Draft {
  id: string; title: string; author: string; method: Method; sentence: string; systems: string[]
  needsYou?: boolean; tally?: Tally; closesAt: string | null; events?: Record<string, unknown>[]; system?: string
  /** Its change classes; a Safe transaction's are `treasury` too (B4: the timeline prepares one only for those). */
  classes?: string[]
}

const REV = 'b7c1d2e3f4a5'

/** A proposal as GET /api/proposals gives it: open, one rule, its ops on the named Systems. */
function proposal(d: Draft): ProposalView {
  const decide = d.method === 'system' ? { system: d.system, method: 'system' } : { by: 'council', method: 'approve' }
  const lead = { state: 'pending', missing: d.method === 'system' ? 'waiting for the system' : 'needs more approvals', tally: d.tally ?? {}, closesAt: d.closesAt }
  return {
    id: d.id, title: d.title, author: d.author, classes: d.classes ?? ['systems'], state: 'open', opened: daysFrom(-3), rev: REV,
    ops: d.systems.map(s => ({ op: 'update', record: `systems:${s}`, set: {}, base: 'h1' })),
    events: [{ id: `${d.id}-e1`, at: daysFrom(-3), by: d.author, kind: 'comment', text: 'Opened for the Council.' }, ...(d.events ?? [])],
    rules: [{ direct: false, sentence: d.sentence, source: `data/proposals.yaml ${d.id} rules: r1` }],
    derived: d.method === 'system' ? 'waiting' : 'approving',
    evaluation: { state: 'pending', missing: lead.missing, parts: [{ rule: { id: 'r1', applies_to: ['systems'], decide }, evaluation: lead }], closesAt: d.closesAt },
    stale: [], needsYou: d.needsYou ?? false, can: d.needsYou ? ['approve', 'object', 'comment'] : ['comment'], cannot: {}, branchState: 'built',
    check: true,
  } as unknown as ProposalView
}

/** Waits on this member's approval: 2 of 4 approved, it closes in 5 days. Its ops return the two pools' funds. */
export const RETURN_POOLS = proposal({
  id: 'p-2026-10-17-001', title: 'Return the Gardens pools to the treasury', author: 'treasury-steward', method: 'approve',
  sentence: 'four Council stewards approve', systems: ['network-projects', 'local-starter'], needsYou: true,
  tally: { for: ['steward-a', 'steward-b'], needed: 4 }, closesAt: daysFrom(5), classes: ['systems', 'treasury'],
})

/** This member approved; it waits on two more: 2 of 4, one of them theirs. */
export const ADD_SIGNER = proposal({
  id: 'p-2026-10-15-001', title: 'Add a Treasury signer', author: 'steward-a', method: 'approve',
  sentence: 'four Council stewards approve', systems: ['treasury'],
  tally: { for: ['steward-a', ACTOR], needed: 4 }, closesAt: daysFrom(9), classes: ['systems', 'treasury'],
  events: [{ id: 'p-2026-10-15-001-e2', at: daysFrom(-1), by: ACTOR, kind: 'approve', rev: REV }],
})

/** Waits on this member, and its window closed two days ago. */
export const CLOSE_CALL = proposal({
  id: 'p-2026-10-09-001', title: 'Close the spring call for local nodes', author: 'ops-lead', method: 'approve',
  sentence: 'three Council stewards approve', systems: ['roles'], needsYou: true,
  tally: { for: ['ops-lead'], needed: 3 }, closesAt: daysFrom(-2),
})

/** The Treasury's waiting transaction (nonce 18 on Celo), attached to a proposal decided by the Safe: its latest
 *  reading says 2 of 4 signatures. Nobody approves it, so it is not itself a need; it gives the signature its meter.
 *  `TX` is its attach ref, for the prepared card's tests (B5). */
export const TX = { chain: 'eip155:42220', id: `0x${'18'.padStart(64, 'a')}`, payload: { to: fakeAddress(19), value: '1271000000000000000000', data_hash: `0x${'0'.repeat(64)}`, operation: 0, nonce: 18 } }
export const PAY_KIT = proposal({
  id: 'p-2026-10-16-001', title: 'Pay the local node kit grant', author: 'treasury-steward', method: 'system', system: 'treasury',
  sentence: 'the Treasury Safe executes it', systems: ['treasury'], closesAt: daysFrom(12), classes: ['systems', 'treasury'],
  events: [
    { id: 'p-2026-10-16-001-e2', at: daysFrom(-2), by: 'treasury-steward', kind: 'attach', rev: REV, ref: { system: 'treasury', ...TX } },
    { id: 'p-2026-10-16-001-e3', at: daysFrom(-1), by: 'system:treasury', kind: 'system', rev: REV, outcome: 'pending', ref: { system: 'treasury', ...TX },
      confirmations: 1, required: 4, text: '1 of 4 signatures' },
    { id: 'p-2026-10-16-001-e4', at: new Date(FIXED_NOW.getTime() - 3 * 3_600_000).toISOString(), by: 'system:treasury', kind: 'system', rev: REV,
      outcome: 'pending', ref: { system: 'treasury', ...TX }, confirmations: 2, required: 4, text: '2 of 4 signatures' },
  ],
})

/** The open proposals Needs you reads. */
export const PROPOSALS: ProposalView[] = [RETURN_POOLS, ADD_SIGNER, CLOSE_CALL, PAY_KIT]

/** The proposals as the resource store lists them (server/resources/adapters/proposals.ts): what a need carries as
 *  its facts. */
export const PROPOSAL_RESOURCES: Resource[] = PROPOSALS.map(v => ({
  id: `proposal:${v.id}`, kind: 'proposal', board: 'organization', name: String(v.title), status: v.derived,
  attention: { level: 'warn', text: `open: ${v.evaluation.missing}` }, changed: null,
  facts: { author: v.author, opened: v.opened, evaluation: v.evaluation.state, missing: v.evaluation.missing, closesAt: v.evaluation.closesAt, stale: v.stale, ops: (v.ops as unknown[]).length },
  source: { path: 'data/proposals.yaml', editable: false, registry: 'proposals', entityId: String(v.id) },
}))

/** The Treasury as Needs you finds it: as systems.ts reads it, but Gnosis still lists a ninth owner, so its chains
 *  disagree (6 of 7) while one transaction waits on Celo. */
export const TREASURY_SPLIT: Resource = (() => {
  const r = structuredClone(TREASURY_SYSTEM)
  const read = r.facts.driver as { facts: Record<string, unknown>; sections: { title: string; note?: string }[] }
  read.facts.agree = false
  const gnosis = (read.facts.chains as { chain: string; owners: string[] }[]).find(c => c.chain === 'eip155:100')!
  gnosis.owners = [...gnosis.owners, `eip155:100:${fakeAddress(20)}`]
  read.sections.find(s => s.title === 'Chains')!.note = '6 of 7 chains agree'
  return r
})()

/** The Systems Needs you reads on /parts: the house's, the Treasury split across its chains. */
export const NEEDS_SYSTEMS: Resource[] = SYSTEMS.map(r => (r.id === TREASURY_SYSTEM.id ? TREASURY_SPLIT : r))

// ---------------------------------------------------------------------------------------------------------------
// Prepared transactions (B5, §9.6): the gallery's card, returning the two Gardens pools to the Treasury on Celo, in
// each of its states. `replaced` and `stale` have no reader in L2 (brief B5): they are drawn from these only.

const CELO = 'eip155:42220'
const onCelo = (address: string) => `${CELO}:${address}`
/** Hex digits drawn from generated addresses: a fixture's hashes and call data, never a real transaction's. */
function hexOf(seed: number, length: number): string {
  let out = ''
  for (let i = 0; out.length < length; i++) out += fakeAddress(seed + i).slice(2)
  return out.slice(0, length)
}
/** The MultiSend contract the two calls go through (a generated address standing in for it). */
const MULTISEND = fakeAddress(92)
const RETURN_TX_HASH = `0x5b1c${hexOf(100, 56)}e93a`

/** The Treasury's prepared return of the two pools: nonce 18 on Celo, 2 of 4 signed, two calls through MultiSend. */
export const PREPARED_RETURN: PreparedView = {
  state: 'partly-signed', safe: { name: 'Treasury', address: SAFE, chain: CELO }, nonce: 18, signed: 2, of: 4,
  calls: [
    { title: 'Return Network Projects to the Safe', from: onCelo(fakeAddress(72)), to: onCelo(SAFE), amount: { raw: '1271000000000000000000', unit: 'USDGLO', decimals: 18 } },
    { title: 'Return Local Starter to the Safe', from: onCelo(fakeAddress(73)), to: onCelo(SAFE), amount: { raw: '1829000000000000000000', unit: 'USDGLO', decimals: 18 } },
  ],
  total: 'Back to the treasury',
  payload: { to: MULTISEND, toName: 'MultiSend', value: '0', operation: 1, data: `0x8d80ff0a${hexOf(120, 328)}`, safeTxHash: RETURN_TX_HASH },
  openHref: `https://app.safe.global/transactions/tx?safe=celo:${SAFE}&id=multisig_${SAFE}_${RETURN_TX_HASH}`,
}

const prepared = (v: Partial<PreparedView>): PreparedView => ({ ...PREPARED_RETURN, ...v })
/** The transaction hash the execution was read back with. */
export const EXECUTED_TX_HASH = `0x9e4b${hexOf(110, 56)}1c07`

/** The card in each of its states (§9.6's table, with the failed execution the brief adds), by name. */
export const PREPARED_IN: Record<string, PreparedView> = {
  preparing: prepared({ state: 'preparing', signed: 0 }),
  unsigned: prepared({ state: 'unsigned', signed: 0 }),
  'partly-signed': PREPARED_RETURN,
  ready: prepared({ state: 'ready', signed: 4 }),
  executed: prepared({ state: 'executed', signed: 4, outcome: { block: '31204118', txHash: EXECUTED_TX_HASH, readAt: minutesBefore(2) } }),
  'executed-failed': prepared({ state: 'executed', signed: 4, outcome: { readAt: minutesBefore(2), failed: true } }),
  mismatch: prepared({ state: 'mismatch', outcome: { readAt: minutesBefore(2), differs: ['Not the transaction the proposal prepared: its data differs.'] } }),
  replaced: prepared({ state: 'replaced' }),
  stale: prepared({ state: 'stale', rev: { current: 3, prepared: 2 } }),
  // a failed read keeps the state it lays over (here, partly signed): the meter mute, the failed age
  'read-failed': prepared({ readFailed: true, failedAge: minutesBefore(12) }),
}

// ---------------------------------------------------------------------------------------------------------------
// The proposal timeline, its rows and the rule statuses (B4, §9.5): the pools' return approved by the Council and its
// transaction partly signed in the Safe; a records-only proposal ratified; one rule result in each status. Roles only.

/** The four Council stewards who approved the return, this member among them. */
const COUNCIL = ['steward-a', 'steward-b', ACTOR, 'treasury-steward']
const RETURN_ID = 'p-2026-10-17-001'
const ev = (n: number, days: number, by: string, kind: string, extra: Record<string, unknown> = {}) =>
  ({ id: `${RETURN_ID}-e${n}`, at: daysFrom(days), by, kind, rev: REV, ...extra })
/** The return's attach: nonce 18 on Celo, through MultiSend, the ledger keeping only the data's hash. */
const RETURN_ATTACH = { system: 'treasury', chain: CELO, id: RETURN_TX_HASH,
  payload: { to: MULTISEND, value: '0', data_hash: `0x${hexOf(130, 64)}`, operation: 1, nonce: 18 } }

/** The pools' return, decided: the Council's rule met (4 of 4, this member's approval among them), the Treasury Safe's
 *  rule waiting on its transaction, which reads 2 of 4 signed. Its timeline is the gallery's: proposed, approved,
 *  decided, prepared done, signing now, read back waiting. */
export const RETURN_DECIDED: ProposalView = {
  ...RETURN_POOLS, derived: 'waiting', needsYou: false, can: ['comment'], cannot: {},
  rules: [
    { direct: false, sentence: 'four Council stewards approve', source: `data/proposals.yaml ${RETURN_ID} rules: r1` },
    { direct: false, sentence: 'the Treasury Safe executes it', source: `data/proposals.yaml ${RETURN_ID} rules: r2` },
  ],
  evaluation: {
    state: 'pending', missing: 'waiting for the Treasury Safe', closesAt: null, parts: [
      { rule: { id: 'r1', applies_to: ['systems'], decide: { by: 'council', method: 'approve' } }, evaluation: { state: 'met', missing: '', tally: { for: COUNCIL, needed: 4 }, closesAt: null } },
      { rule: { id: 'r2', applies_to: ['treasury'], decide: { system: 'treasury', method: 'system' } }, evaluation: { state: 'pending', missing: 'waiting for the Treasury Safe', tally: {}, closesAt: null } },
    ],
  },
  events: [
    ev(1, -3, 'treasury-steward', 'comment', { text: 'Opened for the Council.' }),
    ev(2, -2.9, 'steward-a', 'approve'),
    ev(3, -2.8, 'ops-lead', 'object', { text: 'Return the pools only after the spring call closes.' }),
    ev(4, -2.5, 'ops-lead', 'retract', { of: `${RETURN_ID}-e3` }),
    ev(5, -2.4, 'steward-b', 'approve'),
    ev(6, -2, ACTOR, 'approve'),
    ev(7, -1, 'treasury-steward', 'approve'),
    ev(8, -0.9, 'treasury-steward', 'attach', { ref: RETURN_ATTACH }),
    { ...ev(9, 0, 'system:treasury', 'system', { outcome: 'pending', ref: RETURN_ATTACH, confirmations: 2, required: 4, text: '2 of 4 signatures' }), at: minutesBefore(30) },
  ],
} as unknown as ProposalView

/** A records-only proposal the Council ratified two days ago: no transaction is needed. */
const RECORDS = proposal({
  id: 'p-2026-10-12-001', title: 'Record the spring call’s outcome', author: 'ops-lead', method: 'approve',
  sentence: 'three Council stewards approve', systems: ['roles'], closesAt: null, classes: ['records'],
})
export const RECORDS_RATIFIED: ProposalView = {
  ...RECORDS, state: 'ratified', derived: 'ratified', can: [],
  evaluation: { state: 'met', missing: '', closesAt: null, parts: [{ rule: RECORDS.evaluation.parts[0]!.rule,
    evaluation: { state: 'met', missing: '', tally: { for: ['steward-a', 'steward-b', ACTOR], needed: 3 }, closesAt: null } }] },
  closed: { at: daysFrom(-2), by: 'steward-a', decision: 'gov-20261015-001' },
} as unknown as ProposalView

/** The proposals /parts lists as rows: the open ones, the decided return, the ratified records. */
export const PROPOSAL_ROWS: ProposalView[] = [RETURN_POOLS, ADD_SIGNER, CLOSE_CALL, PAY_KIT, RETURN_DECIDED, RECORDS_RATIFIED]

type RuleResult = ProposalView['evaluation']['parts'][number]['evaluation']
/** One rule result in each status RuleStatus draws (met, waiting, held by an objection, failed, expired), with its
 *  sentence. */
export const RULE_RESULTS: { sentence: string; result: RuleResult }[] = [
  { sentence: 'four Council stewards approve', result: { state: 'met', missing: '', tally: { for: COUNCIL, needed: 4 }, closesAt: null } },
  { sentence: 'four Council stewards approve', result: { state: 'pending', missing: 'needs 2 more approvals from Council stewards', tally: { for: ['steward-a', 'steward-b'], needed: 4 }, closesAt: daysFrom(5) } },
  { sentence: 'a Council steward decides unless a member objects within 3 days', result: { state: 'pending', missing: 'held by an objection from ops-lead: answer it, or retract it', tally: { objecting: ['ops-lead'] }, closesAt: daysFrom(2) } },
  { sentence: 'members vote; two thirds of the votes for or against decide', result: { state: 'failed', missing: '1 of 3 votes for or against were yes, and the rule asks for 66%', tally: { for: ['steward-a'], against: ['steward-b', 'ops-lead'], abstain: [], needed: 2 }, closesAt: null } },
  { sentence: 'three Council stewards approve', result: { state: 'expired', missing: 'nobody decided it within 14 days, so it expired', tally: { for: [] }, closesAt: null } },
]

// ---------------------------------------------------------------------------------------------------------------
// The role tree (B6, §9.7): Hats tree #13 as roleTreeFrom reads the Roles System, then what L2 cannot say yet laid on
// it for /parts — the wearers of two hats who made theirs public, the hat this member wears (L5), what three hats do.
// And a deep, wide tree: six levels, a hat of 200 wearers, a hat with no name. Roles and generated addresses only.

/** The Roles System's read: the hats driver's facts, as the Systems page has them. */
export const ROLES_READ = ROLES_SYSTEM.facts.driver as DriverRead
/** Wearers who made theirs public, by handle, with the role /parts names them by. */
const shown = (...handles: string[]) => handles.map(h => ({ handle: h, role: PEOPLE.find(p => p.handle === h)!.name }))
/** What L2 does not read, laid on the tree by hat: the top hat's holder, the Council (this member's hat), the signers. */
const LAID: Record<string, { does?: string; shown?: { handle: string; role: string }[]; yours?: boolean }> = {
  [hatRefOf()]: { does: 'top hat · held by the Safe' },
  [hatRefOf(1)]: { shown: shown(ACTOR, 'steward-a', 'steward-b'), yours: true },
  [hatRefOf(1, 1)]: { shown: shown('treasury-steward', 'steward-a', 'steward-b'), does: 'signs 4 of 8' },
}
const lay = (nodes: RoleNode[]): RoleNode[] => nodes.map(n => {
  const l = LAID[n.id]
  return {
    ...n, children: lay(n.children), ...(l?.does ? { does: l.does } : {}), ...(l?.yours ? { yours: true } : {}),
    ...(l?.shown ? { wearers: { ...n.wearers, shown: l.shown } } : {}),
  }
})
/** Tree #13 as /parts draws it: the gallery's tree, Local nodes closed. */
export const ROLE_TREE: RoleNode[] = lay(roleTreeFrom(ROLES_READ))
/** The hats open when the tree is first drawn: every hat with hats inside but Local nodes (13.3). */
export const ROLE_TREE_OPEN = [hatRefOf(), hatRefOf(1), hatRefOf(2)]

const DEEP_TREE_ID = 14
const deepId = (...path: number[]) => path.reduce((id, n) => childHatId(id, n), topHatId(DEEP_TREE_ID))
const CELO_CHAIN = 'eip155:42220'
/** A hat of the deep tree, by its path under the top hat. */
function deep(path: number[], name: string | null, wearers: RoleNode['wearers'], children: RoleNode[] = []): RoleNode {
  const id = deepId(...path)
  return { id: hatRef(CELO_CHAIN, id), prettyId: prettyHatId(id), name, level: path.length, children, does: '', wearers }
}
/** Six levels deep, three hats wide at the third, a hat of 200 wearers (three made theirs public) with no name. */
export const DEEP_TREE: RoleNode[] = [
  deep([], 'Network', { count: 1, shown: null, address: `${CELO_CHAIN}:${fakeAddress(60)}`, complete: true }, [
    deep([1], 'Regions', { count: 6, shown: null, complete: true }, [
      deep([1, 1], 'Region north', { count: 2, shown: null, complete: true }, [
        deep([1, 1, 1], 'Hub one', { count: 4, shown: null, complete: true }, [
          deep([1, 1, 1, 1], 'Circle one', { count: 9, shown: null, complete: false }, [
            deep([1, 1, 1, 1, 1], null, { count: 200, shown: shown('steward-a', 'steward-b', 'ops-lead'), complete: false }),
          ]),
        ]),
      ]),
      deep([1, 2], 'Region south', { count: 0, shown: null, complete: true }),
      deep([1, 3], 'Region east', { count: 3, shown: null, complete: true }),
    ]),
  ]),
]

/** A hats read with what roleTreeFrom must not take at face value: a hat whose details are an IPFS link (no name), an
 *  inactive hat with no wearer (not an empty hat), a hat of one wearer whose holders are not known, a top hat not first. */
export const ODD_HATS_READ: DriverRead = (() => {
  const r = structuredClone(ROLES_READ)
  const hats = r.facts.hats as HatFact[]
  const at = (ref: string) => hats.find(h => h.id === ref)!
  at(hatRefOf(2, 1)).details = 'ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
  at(hatRefOf(2, 4)).active = false
  Object.assign(at(hatRefOf(2)), { holders: null, holdersComplete: false })
  r.facts.hats = [...hats.slice(1), hats[0]!]
  return r
})()

// ---------------------------------------------------------------------------------------------------------------
// The fund flow (B6, §9.8): where value went through the Treasury in the last 90 days, in one unit (the bands follow
// each flow's share), and a window that mixes units (C-31: equal bands, each amount labelled). No L2 driver reads
// transfers (brief B6, OQ-2): these are fixtures only.

export const FLOW_SAFE = 'Treasury'
export const FLOW_WINDOW = 'the last 90 days'
export const FLOWS: Flow[] = [
  { from: 'Ops wallet', to: FLOW_SAFE, value: '2500', unit: 'USDGLO', status: 'executed' },
  { from: 'Gitcoin round', to: FLOW_SAFE, value: '412', unit: 'USDGLO', status: 'executed' },
  { from: FLOW_SAFE, to: 'Network Projects', value: '1271', unit: 'USDGLO', status: 'proposed' },
  { from: FLOW_SAFE, to: 'Local Starter', value: '1829', unit: 'USDGLO', status: 'prepared' },
]
export const MIXED_FLOWS: Flow[] = [
  { from: 'Ops wallet', to: FLOW_SAFE, value: '27561390.98', unit: 'G$', status: 'executed' },
  { from: 'Gitcoin round', to: FLOW_SAFE, value: '412', unit: 'USDGLO', status: 'executed' },
  { from: FLOW_SAFE, to: 'Network Projects', value: '1271', unit: 'USDGLO', status: 'proposed' },
]
