// The shared fixture of lane L8 (standards output), used by tests/standards/* (Tasks 4–12).
//
// Canaries: every string that must never be published carries `WITHHELD-<n>-xxxxxx`; every public string a builder
// may carry carries `SHOWN-<n>`. A test that finds no `WITHHELD-` in an output and every expected `SHOWN-` in it
// cannot pass vacuously. Placeholders only: members steward-a, steward-b, contributor-c; addresses 0x…a1–0x…a9,
// the Safes 0x…5afe, the pool 0x…b001; org Test DAO at dao.example.org. Deterministic: no clock, no random.
import type { DriverRead } from '../../server/systems/driver.ts'
import type { StandardsInput } from '../../lib/standards/project.mjs'
import { caip10 } from '../../lib/caip.mjs'
import { gardensAppUrl, SOURCE_NOTE } from '../../server/systems/gardens.ts'
import { snapshotLink } from '../../server/systems/snapshot.ts'

export const CELO = 'eip155:42220'
export const ETHEREUM = 'eip155:1'
export const DAO_URI = 'https://dao.example.org/.well-known/dao.json'
export const ORIGIN = 'https://dao.example.org'

/** `0x…<tail>`: a placeholder address, lower case as a record writes it. */
export const addr = (tail: string) => `0x${tail.padStart(40, '0')}`
export const A = {
  a1: addr('a1'), a2: addr('a2'), a3: addr('a3'), a4: addr('a4'), a5: addr('a5'),
  a6: addr('a6'), a7: addr('a7'), a8: addr('a8'), a9: addr('a9'),
} as const
export const SAFE = addr('5afe')
export const POOL = addr('b001')
/** The members-level Safe: its address must never be published. */
export const OPS_SAFE = A.a9

/** Hats: tree 13 on Celo is a public System; tree 14 is no System of this org. */
const hat = (tree: string, child: string) => `${CELO}:0x${tree}${child}${'0'.repeat(52)}`
export const HAT_STEWARD = hat('0000000d', '0001')
export const HAT_CONTRIBUTOR = hat('0000000d', '0002')
export const TOP_HAT = `${CELO}:0x0000000d${'0'.repeat(56)}`
export const HAT_OTHER_TREE = hat('0000000e', '0001')

/** Accounts L5 records beside an act (`as.account`, `as.wearers`): never published. */
export const AS_ACCOUNT = caip10(CELO, A.a7)
export const AS_WEARERS = [caip10(CELO, A.a7), caip10(CELO, A.a8)]
/** A CAIP-10 actor (an event `by` that is an address, not a member): never published as such. */
export const CAIP_ACTOR = caip10(CELO, A.a6)

export const TX_CELO = `0x${'aa'.repeat(32)}`
export const TX_ETH = `0x${'bb'.repeat(32)}`
export const TX_OPS = `0x${'cc'.repeat(32)}`
export const SNAPSHOT_VOTE = `0x${'11'.repeat(32)}`
export const SNAPSHOT_CLOSED = `0x${'22'.repeat(32)}`
export const GARDENS_PROPOSAL = `${POOL}-1`
/** A Gardens proposal's beneficiary: only the driver's Proposals rows name it (as a ref); no fact carries it (R38). */
export const BENEFICIARY = caip10(CELO, addr('bee0'))
/** The Gardens pool's page, as gardens.ts builds it: its `open.url` and the href of its Proposals and Decided rows. */
export const COMMUNITY = addr('c0de')   // the pool's community: not one of the treasury's owners (it is in the published page)
export const POOL_PAGE = gardensAppUrl(CELO, COMMUNITY, POOL)

/** The ledger's proposals, by role in the tests. */
export const P = {
  /** ratified; touches only public records; Safe attach on Celo and Ethereum. */
  public: 'p-2026-10-29-001-ab12',
  /** open; touches members:steward-b (a members-level record). */
  member: 'p-2026-10-29-002-cd34',
  /** rejected; touches projects:gone-project, deleted since. */
  deleted: 'p-2026-10-29-003-ef56',
  /** open; touches public records; attaches a Snapshot vote. */
  snapshot: 'p-2026-10-29-004-0a0b',
  /** withdrawn; attaches a Gardens proposal, a hat wearer and a step of the members-level Safe. */
  gardens: 'p-2026-10-29-005-0c0d',
  /** open; holds one of L5's private-op placeholders. */
  privateOp: 'p-2026-10-29-006-0e0f',
  /** expired; the proposal itself is members-level. */
  hidden: 'p-2026-10-29-007-1a1b',
} as const

const RULE = { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'stewards', method: 'approve', count: 1 } }
const SAFE_RULE = { id: 'treasury', applies_to: ['treasury'], propose: 'stewards', decide: { by: 'system', method: 'system', system: 'treasury' } }

/** What L5 records beside an act (L5 spec §7.2). */
const as = (h: string) => ({ hat: h, account: AS_ACCOUNT, block: 31000123, readAt: '2026-10-10T10:00:00Z', wearers: AS_WEARERS, complete: true })

function proposals(): Record<string, unknown>[] {
  return [
    {
      id: P.public, title: 'SHOWN-40 Fund the treasury rotation', author: 'steward-a', opened_as: as(HAT_STEWARD),
      classes: ['records', 'treasury'], rules: [RULE, SAFE_RULE], state: 'ratified', opened: '2026-10-01T10:00:00Z', rev: '0a1b2c3d4e5f',
      rationale: 'WITHHELD-40-xxxxxx: why we rotate', statement: 'WITHHELD-41-xxxxxx: the statement',
      ops: [{ op: 'update', record: 'projects:project-one', set: { status: 'active' }, base: '9f8e7d6c5b4a' }],
      events: [
        { id: 'e-a1-01', at: '2026-10-01T11:00:00Z', by: 'steward-a', kind: 'approve', rev: '0a1b2c3d4e5f', as: as(HAT_STEWARD) },
        { id: 'e-a1-02', at: '2026-10-01T12:00:00Z', by: 'steward-b', kind: 'comment', text: 'WITHHELD-42-xxxxxx: a comment' },
        { id: 'e-a1-03', at: '2026-10-01T13:00:00Z', by: 'contributor-c', kind: 'vote', vote: 'for', rev: '0a1b2c3d4e5f' },
        { id: 'e-a1-04', at: '2026-10-01T14:00:00Z', by: CAIP_ACTOR, kind: 'object', rev: '0a1b2c3d4e5f', text: 'WITHHELD-43-xxxxxx: an objection' },
        { id: 'e-a1-05', at: '2026-10-01T15:00:00Z', by: 'steward-a', kind: 'approve', rev: '0a1b2c3d4e5f', as: as(HAT_OTHER_TREE) },
        {
          id: 'e-a1-06', at: '2026-10-02T09:00:00Z', by: 'steward-a', kind: 'attach', rev: '0a1b2c3d4e5f',
          ref: {
            system: 'treasury', id: TX_CELO, chain: CELO,
            payload: { to: A.a1, value: '0', data_hash: `0x${'dd'.repeat(32)}`, operation: 0, nonce: 7 },
            also: [{ chain: ETHEREUM, id: TX_ETH, payload: { to: A.a1, value: '0', data_hash: `0x${'dd'.repeat(32)}`, operation: 0, nonce: 3 } }],
          },
        },
        { id: 'e-a1-07', at: '2026-10-03T09:00:00Z', by: 'system', kind: 'system', rev: '0a1b2c3d4e5f', outcome: 'executed' },
        { id: 'e-a1-08', at: '2026-10-03T10:00:00Z', by: 'steward-a', kind: 'ratify' },
      ],
      closed: { at: '2026-10-03T10:00:00Z', by: 'steward-a', decision: 'gov-2026-010', as: as(HAT_STEWARD) },
    },
    {
      id: P.member, title: 'WITHHELD-50-xxxxxx: change steward-b', author: 'steward-a', classes: ['records'], rules: [RULE],
      state: 'open', opened: '2026-10-04T10:00:00Z', rev: '1a1b2c3d4e5f',
      ops: [{ op: 'update', record: 'members:steward-b', set: { role: 'WITHHELD-51-xxxxxx' } }],
      events: [
        { id: 'e-b2-01', at: '2026-10-04T11:00:00Z', by: 'steward-a', kind: 'approve', rev: '1a1b2c3d4e5f' },
        {
          id: 'e-b2-02', at: '2026-10-04T12:00:00Z', by: 'steward-a', kind: 'attach', rev: '1a1b2c3d4e5f',
          ref: { system: 'treasury', id: `0x${'ee'.repeat(32)}`, chain: CELO, payload: { to: A.a2, value: '0', data_hash: `0x${'dd'.repeat(32)}`, operation: 0, nonce: 8 } },
        },
      ],
    },
    {
      id: P.deleted, title: 'WITHHELD-52-xxxxxx: retire a project', author: 'contributor-c', classes: ['records'], rules: [RULE],
      state: 'rejected', opened: '2026-10-05T10:00:00Z', rev: '2a1b2c3d4e5f',
      ops: [{ op: 'update', record: 'projects:gone-project', set: { status: 'WITHHELD-53-xxxxxx' } }],
      events: [{ id: 'e-c3-01', at: '2026-10-06T10:00:00Z', by: 'steward-a', kind: 'reject' }],
      closed: { at: '2026-10-06T10:00:00Z', by: 'steward-a', decision: 'gov-2026-011' },
    },
    {
      id: P.snapshot, title: 'SHOWN-41 Ask the token holders', author: 'steward-a', classes: ['records'], rules: [RULE],
      state: 'open', opened: '2026-10-07T10:00:00Z', rev: '3a1b2c3d4e5f',
      ops: [{ op: 'update', record: 'systems:votes', set: { name: 'SHOWN-11 Token votes' } }],
      events: [{
        id: 'e-d4-01', at: '2026-10-07T11:00:00Z', by: 'steward-a', kind: 'attach', rev: '3a1b2c3d4e5f',
        ref: { system: 'votes', id: SNAPSHOT_VOTE, payload: { kind: 'snapshot-proposal', choice: 'WITHHELD-54-xxxxxx' } },
      }],
    },
    {
      id: P.gardens, title: 'SHOWN-42 Fund a garden', author: 'contributor-c', opened_as: as(HAT_CONTRIBUTOR), classes: ['records'], rules: [RULE],
      state: 'withdrawn', opened: '2026-10-08T10:00:00Z', rev: '4a1b2c3d4e5f',
      ops: [{ op: 'update', record: 'governance', set: { description: 'SHOWN-20 How Test DAO decides' } }],
      events: [
        { id: 'e-e5-01', at: '2026-10-08T11:00:00Z', by: 'contributor-c', kind: 'attach', rev: '4a1b2c3d4e5f', ref: { system: 'grants', id: GARDENS_PROPOSAL, payload: { kind: 'gardens-proposal' } } },
        { id: 'e-e5-02', at: '2026-10-08T12:00:00Z', by: 'contributor-c', kind: 'attach', rev: '4a1b2c3d4e5f', ref: { system: 'roles', id: HAT_CONTRIBUTOR, payload: { kind: 'hats-wearer', wearer: caip10(CELO, A.a8) } } },
        {
          id: 'e-e5-03', at: '2026-10-08T13:00:00Z', by: 'contributor-c', kind: 'attach', rev: '4a1b2c3d4e5f',
          ref: { system: 'ops-safe', id: TX_OPS, chain: CELO, payload: { to: A.a3, value: '0', data_hash: `0x${'dd'.repeat(32)}`, operation: 0, nonce: 1 } },
        },
        { id: 'e-e5-04', at: '2026-10-09T10:00:00Z', by: 'contributor-c', kind: 'withdraw', as: as(HAT_CONTRIBUTOR) },
      ],
      closed: { at: '2026-10-09T10:00:00Z', by: 'contributor-c' },
    },
    {
      id: P.privateOp, title: 'WITHHELD-55-xxxxxx: a private change', author: 'steward-a', classes: ['records'], rules: [RULE],
      state: 'open', opened: '2026-10-10T10:00:00Z', rev: '5a1b2c3d4e5f',
      ops: [
        { op: 'update', record: 'projects:project-one', set: { status: 'active' } },
        { op: 'private', ref: 'prv_0123456789abcdef', class: 'records', digest: `sha256:${'ff'.repeat(32)}` },
      ],
      events: [],
    },
    {
      id: P.hidden, visibility: 'members', title: 'WITHHELD-56-xxxxxx: a members-only proposal', author: 'steward-b', classes: ['records'], rules: [RULE],
      state: 'expired', opened: '2026-10-11T10:00:00Z', rev: '6a1b2c3d4e5f',
      ops: [{ op: 'update', record: 'projects:project-one', set: { status: 'active' } }],
      events: [{ id: 'e-g7-01', at: '2026-10-12T10:00:00Z', by: 'steward-b', kind: 'comment', text: 'WITHHELD-57-xxxxxx' }],
      closed: { at: '2026-10-25T10:00:00Z', by: 'system', decision: 'gov-2026-013' },
    },
  ]
}

/** The raw input, as the loader reads it from git. A fresh object on each call. */
export function fixtureInput(over: Partial<StandardsInput> = {}): StandardsInput {
  const base: StandardsInput = {
    identity: {
      name: 'Test DAO', type: 'DAO', description: 'SHOWN-1 A placeholder organisation for tests.', daoURI: DAO_URI,
      attestationIssuers: [{ name: 'SHOWN-2 Test issuer', issuer: caip10(CELO, A.a5) }],
    },
    policy: {
      collections: {
        systems: { default: 'public', fields: { notes: 'members' } },
        governance: { default: 'public', fields: {} },
        proposals: { default: 'public', fields: {} },
        members: { default: 'public', fields: { role: 'members' } },
        projects: { default: 'public', fields: { budget: 'members' } },
        sources: { default: 'public', fields: {} },
        'knowledge-manifest': { default: 'public', fields: {} },
      },
      defaults: {},
    },
    records: {
      members: [
        {
          id: 'steward-a', name: 'SHOWN-3 Steward A', kind: 'person', role: 'WITHHELD-1-xxxxxx', status: 'active', joined: '2024-01-15',
          email: 'WITHHELD-2-xxxxxx@example.org', handles: { address: caip10(CELO, A.a1), git: 'WITHHELD-3-xxxxxx@example.org' },
        },
        {
          id: 'steward-b', visibility: 'members', name: 'WITHHELD-4-xxxxxx', kind: 'person', role: 'WITHHELD-5-xxxxxx', status: 'active',
          joined: '2024-02-16', email: 'WITHHELD-6-xxxxxx@example.org',
        },
        { id: 'contributor-c', name: 'SHOWN-4 Contributor C', kind: 'agent', status: 'active', joined: '2024-03-17' },
      ],
      systems: [
        {
          id: 'treasury', kind: 'safe', name: 'SHOWN-10 Treasury', description: 'SHOWN-12 The treasury Safe', chain: CELO, chains: [CELO, ETHEREUM],
          address: SAFE, driver: 'safe', section: 'organization/treasury',
        },
        { id: 'roles', kind: 'hats-tree', name: 'SHOWN-13 Roles', chain: CELO, address: '13', driver: 'hats-tree' },
        { id: 'votes', kind: 'snapshot-space', name: 'SHOWN-11 Token votes', space: 'test-dao.eth', url: 'https://snapshot.box/#/s:test-dao.eth', driver: 'snapshot-space' },
        {
          id: 'grants', kind: 'gardens-pool', name: 'SHOWN-14 Community grants', description: 'SHOWN-15 Grants decided by conviction',
          chain: CELO, address: POOL, driver: 'gardens-pool',
        },
        // a field rule withholds `notes`: on a System with no driver, so the reads of the others stay (C1)
        { id: 'forum', kind: 'link', name: 'SHOWN-16 Forum', url: 'https://forum.example.org', notes: 'WITHHELD-10-xxxxxx: moderator rota' },
        { id: 'ops-safe', visibility: 'members', kind: 'safe', name: 'WITHHELD-11-xxxxxx', chain: CELO, address: OPS_SAFE, driver: 'safe' },
      ],
      proposals: proposals(),
      governance: {
        model: 'steward-council',
        description: 'SHOWN-20 How Test DAO decides',
        roles: { stewards: { members: ['steward-a', 'steward-b'] }, member: { all: true } },
        rules: [
          { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'stewards', method: 'approve', count: 1 } },
          { id: 'treasury', applies_to: ['treasury'], propose: 'stewards', decide: { by: 'system', method: 'system', system: 'treasury' } },
        ],
        decisions: [
          {
            id: 'gov-2026-010', proposal: P.public, rule: 'records,treasury', method: 'system', outcome: 'ratified', status: 'ratified',
            by: ['steward-a'], date: '2026-10-03', title: 'SHOWN-40 Fund the treasury rotation', summary: 'WITHHELD-20-xxxxxx: 1 approval (steward-a).',
          },
          {
            id: 'gov-2026-011', proposal: P.deleted, rule: 'records', method: 'approve', outcome: 'rejected', status: 'rejected',
            by: ['steward-b'], date: '2026-10-06', title: 'WITHHELD-52-xxxxxx: retire a project', summary: 'WITHHELD-21-xxxxxx',
          },
          { id: 'gov-2026-001', title: 'SHOWN-21 Adopt the charter', date: '2026-01-10', status: 'approved' },
          { id: 'gov-2026-002', visibility: 'members', title: 'WITHHELD-22-xxxxxx: a members-only decision', date: '2026-02-11', status: 'approved' },
          {
            id: 'gov-2026-013', proposal: P.hidden, rule: 'records', method: 'approve', outcome: 'expired', status: 'expired',
            by: [], date: '2026-10-25', title: 'WITHHELD-56-xxxxxx: a members-only proposal', summary: 'WITHHELD-23-xxxxxx',
          },
        ],
      },
      meetings: [
        { id: 'meeting-2026-10-01', visibility: 'public', title: 'SHOWN-30 Stewards call', date: '2026-10-01' },
        { id: 'meeting-2026-10-02', title: 'WITHHELD-30-xxxxxx: closed session', date: '2026-10-02' },
      ],
      projects: [
        { id: 'project-one', name: 'SHOWN-31 Project One', status: 'active', budget: 'WITHHELD-31-xxxxxx' },
        { id: 'project-two', visibility: 'members', name: 'WITHHELD-32-xxxxxx', status: 'active' },
      ],
      finances: { summary: 'WITHHELD-33-xxxxxx: the books', balance: 'WITHHELD-34-xxxxxx' },
      ideas: [
        { id: 'idea-one', visibility: 'public', title: 'SHOWN-32 An open idea' },
        { id: 'idea-two', title: 'WITHHELD-35-xxxxxx: a members idea' },
      ],
      'knowledge-manifest': { title: 'SHOWN-33 What we know', domains: ['SHOWN-34 regeneration'] },
      sources: [{ id: 'source-one', title: 'SHOWN-35 A public source', url: 'https://example.org/source' }],
    },
    reads: null,
  }
  return { ...base, ...over }
}

const owners = (chain: string) => [A.a1, A.a2, A.a3, A.a4].map(a => caip10(chain, a))

/** Reads in the L2 facts shapes (and Task 8's additive keys), by system id. A fresh object on each call. */
export function fixtureReads(): Record<string, DriverRead> {
  const at = '2026-10-29T09:00:00.000Z'
  return {
    treasury: {
      ok: true, readAt: at,
      facts: {
        chain: CELO, address: caip10(CELO, SAFE).split(':')[2], account: caip10(CELO, SAFE), shortAddress: '0x0000…5aFE', network: 'Celo',
        threshold: 2, owners: 4, nonce: 7, version: '1.4.1', pending: 0, agree: true,
        chains: [
          { chain: CELO, network: 'Celo', account: caip10(CELO, SAFE), ok: true, threshold: 2, owners: owners(CELO), nonce: 7, pending: 0, version: '1.4.1' },
          { chain: ETHEREUM, network: 'Ethereum', account: caip10(ETHEREUM, SAFE), ok: true, threshold: 2, owners: owners(ETHEREUM), nonce: 3, pending: 0, version: '1.4.1' },
        ],
      },
      // A driver names signers from data/members.yaml in its sections, members-level members included: never carried.
      sections: [{ title: 'Signers', note: '4 signers; 2 of 4 needed on Celo', rows: owners(CELO).map((o, i) => ({
        cells: [o.split(':')[2]!, i === 1 ? 'WITHHELD-62-xxxxxx (steward-b)' : '—'], refs: [o],
      })) }],
      open: { url: `https://app.safe.global/home?safe=celo:${SAFE}`, embeddable: false },
    },
    roles: {
      ok: true, readAt: at,
      facts: {
        chain: CELO, tree: 13, ref: `${CELO}:13`, topHat: TOP_HAT, block: 31000200,
        hats: [
          { id: TOP_HAT, pretty: '0x0000000d', admin: null, level: 0, details: 'SHOWN-50 Test DAO', imageURI: '', maxSupply: 1, supply: 1,
            eligibility: null, toggle: null, mutable: false, active: true, lastHatId: 2, holders: [caip10(CELO, SAFE)], holdersComplete: true },
          { id: HAT_STEWARD, pretty: '0x0000000d.0001', admin: TOP_HAT, level: 1, details: 'SHOWN-51 Steward', imageURI: '', maxSupply: 5, supply: 1,
            eligibility: null, toggle: null, mutable: true, active: true, lastHatId: 0, holders: [caip10(CELO, A.a5)], holdersComplete: true },
          { id: HAT_CONTRIBUTOR, pretty: '0x0000000d.0002', admin: TOP_HAT, level: 1, details: 'SHOWN-52 Contributor', imageURI: '', maxSupply: 20, supply: 0,
            eligibility: null, toggle: null, mutable: true, active: true, lastHatId: 0, holders: [], holdersComplete: true },
        ],
      },
      // hats.ts: Roles and Wearers. A wearer is named from data/members.yaml (signerName), members-level members included.
      sections: [
        { title: 'Roles', rows: [
          { cells: ['0x0000000d', 'SHOWN-50 Test DAO', '1 of 1', '0x0000…5aFE'], refs: [TOP_HAT] },
          { cells: ['0x0000000d.0001', 'SHOWN-51 Steward', '1 of 5', 'WITHHELD-63-xxxxxx'], refs: [HAT_STEWARD] },
          { cells: ['0x0000000d.0002', 'SHOWN-52 Contributor', '0 of 20', '—'], attention: 'warn', refs: [HAT_CONTRIBUTOR] },
        ] },
        { title: 'Wearers', note: 'static holders from the explorer; membership is checked on chain', rows: [
          { cells: ['0x0000000d', SAFE, '—'], refs: [caip10(CELO, SAFE), TOP_HAT] },
          { cells: ['0x0000000d.0001', A.a5, 'WITHHELD-63-xxxxxx'], refs: [caip10(CELO, A.a5), HAT_STEWARD] },
        ] },
        { title: 'Modules', rows: [] },
      ],
      open: { url: 'https://app.hatsprotocol.xyz/trees/42220/13', embeddable: false },
    },
    votes: {
      ok: true, readAt: at,
      facts: {
        space: 'test-dao.eth', name: 'SHOWN-53 Test DAO votes', chain: ETHEREUM, admins: [caip10(ETHEREUM, A.a2)],
        voting: { type: null, period: 1209600, delay: 0, quorum: 0, privacy: 'any' }, strategies: ['whitelist'], validation: 'basic', open: 1,
        proposals: [
          { id: SNAPSHOT_VOTE, title: 'SHOWN-54 Ask the token holders', state: 'active', type: 'single-choice', start: 1792000000, end: 1793360000, created: 1791900000 },
          { id: SNAPSHOT_CLOSED, title: 'SHOWN-55 An earlier vote', state: 'closed', type: 'basic', start: 1790000000, end: 1791000000, created: 1789900000 },
        ],
      },
      // snapshot.ts: each vote's title (cut to 60 characters) and its snapshot.box page, the very id proposals.json publishes
      sections: [
        { title: 'Open votes', rows: [
          { cells: ['SHOWN-54 Ask the token holders', 'single-choice', 'ends in 15 d', 'no votes yet'], attention: 'alert', href: snapshotLink('test-dao.eth', SNAPSHOT_VOTE) },
        ] },
        { title: 'Recent results', rows: [
          { cells: ['SHOWN-55 An earlier vote', 'For', '12 votes', '33 d'], href: snapshotLink('test-dao.eth', SNAPSHOT_CLOSED) },
        ] },
        { title: 'Settings', rows: [
          ['Voting', 'any'], ['Period', '14 days'], ['Delay', '0'], ['Quorum', '0'], ['Strategies', 'whitelist'], ['Validation', 'basic'], ['Admins', '1'],
        ].map(cells => ({ cells })) },
      ],
      open: { url: 'https://snapshot.box/#/s:test-dao.eth', embeddable: false },
    },
    grants: {
      ok: true, readAt: at,
      facts: {
        chain: CELO, pool: caip10(CELO, POOL), poolId: 1, community: caip10(CELO, COMMUNITY), councilSafe: caip10(CELO, SAFE), type: 'funding',
        token: caip10(CELO, A.a6), amount: '1000000000000000000000', symbol: 'TEST', decimals: 18, allowlist: null, open: null,
        enabled: true, archived: false,
        proposals: [
          { id: GARDENS_PROPOSAL, number: 1, status: 'active', title: 'SHOWN-56 Seed the nursery', requested: '100000000000000000000',
            conviction: '10', threshold: '100', created: 1791000000, executed: null },
          { id: `${POOL}-2`, number: 2, status: 'executed', title: 'SHOWN-57 Water the beds', requested: '50000000000000000000',
            created: 1790000000, executed: 1790500000 },
        ],
        source: 'unverified',
      },
      // gardens.ts: proposal titles and the pool's page (both published, from facts and open), a beneficiary (never)
      sections: [
        { title: 'Proposals', rows: [
          { cells: ['#1', 'SHOWN-56 Seed the nursery', '100 TEST', '10% of threshold'], href: POOL_PAGE, refs: [BENEFICIARY] },
        ] },
        { title: 'Pool', note: SOURCE_NOTE, rows: [
          { cells: ['Funds', '1000 TEST'] },
          { cells: ['Community', 'Placeholder garden'], href: gardensAppUrl(CELO, COMMUNITY), refs: [caip10(CELO, COMMUNITY)] },
          { cells: ['Admin', 'council Safe 0x0000…5aFE'], refs: [caip10(CELO, SAFE)] },
          { cells: ['Allowlist', 'open to every member'] },
          { cells: ['Type', 'funding'] },
        ] },
        { title: 'Decided', rows: [
          { cells: ['#2', 'SHOWN-57 Water the beds', 'executed', '34 d'], href: POOL_PAGE },
        ] },
      ],
      open: { url: POOL_PAGE, embeddable: false },
    },
    'ops-safe': {
      ok: true, readAt: at,
      facts: {
        chain: CELO, address: OPS_SAFE, account: caip10(CELO, OPS_SAFE), network: 'Celo', threshold: 1, owners: 1, nonce: 2,
        version: '1.4.1', pending: 1, label: 'WITHHELD-60-xxxxxx',
      },
      sections: [{ title: 'Waiting on signers', rows: [{ cells: ['#2', 'WITHHELD-61-xxxxxx: pay the contractor'] }] }],
      open: { url: `https://app.safe.global/home?safe=celo:${OPS_SAFE}`, embeddable: false },
    },
  }
}

/** C1: a public Gardens pool whose address and community a field rule withholds, with a live read that repeats both. */
export function withheldPoolInput(): StandardsInput {
  const community = addr('c0c0')
  return {
    identity: { name: 'Test DAO', type: 'DAO', daoURI: 'https://dao.example.org/.well-known/dao.json' },
    policy: { collections: { systems: { default: 'public', fields: { address: 'members', community: 'members' } } }, defaults: {} },
    records: {
      members: [], proposals: [], governance: {}, meetings: [], projects: [], finances: {}, ideas: [], 'knowledge-manifest': {}, sources: [],
      systems: [{ id: 'pool-a', kind: 'gardens-pool', name: 'Pool A', description: 'A pool', chain: CELO, address: POOL, community, driver: 'gardens-pool' }],
    },
    reads: {
      'pool-a': {
        ok: true, readAt: '2026-10-29T10:00:00Z',
        // as gardens.ts builds them: the pool's page on each proposal row, the community's page and CAIP-10 under Pool
        sections: [
          { title: 'Proposals', rows: [{ cells: ['#1', 'Proj', '10 TST', '10% of threshold'], href: gardensAppUrl(CELO, community, POOL) }] },
          { title: 'Pool', note: SOURCE_NOTE, rows: [
            { cells: ['Funds', '1000 TST'] },
            { cells: ['Community', 'Placeholder garden'], href: gardensAppUrl(CELO, community), refs: [caip10(CELO, community)] },
            { cells: ['Admin', 'no council Safe'] },
            { cells: ['Type', 'funding'] },
          ] },
          { title: 'Decided', rows: [] },
        ],
        open: { url: gardensAppUrl(CELO, community, POOL), embeddable: false },
        facts: {
          pool: caip10(CELO, POOL), community: caip10(CELO, community), type: 'funding', enabled: true, archived: false, amount: '1000',
          decimals: 0, symbol: 'TST', token: caip10(CELO, A.a6),
          proposals: [{ number: 1, status: 'active', title: 'Proj', requested: '10', created: 1700000000 }],
        },
      },
    },
  }
}
