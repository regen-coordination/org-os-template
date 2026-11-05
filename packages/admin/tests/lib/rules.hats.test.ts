import { describe, it, expect } from 'vitest'
import { resolveRoles, checkGovernance, membershipTree, canAct, nobodyCanPropose } from '../../lib/rules.mjs'
import { observationsOf } from '../../lib/hat-readings.mjs'

// DAO-OS L5 Task 3: roles sourced from a hat (spec §7.1, §7.3), the membership tree (§5.1) and the §7.6 check.
// Placeholders only. Hat ids are written out by hand: tree 13 is 0x0000000d, tree 14 is 0x0000000e.
// The EIP-55 forms of the addresses were computed with @noble/hashes keccak_256, not with lib/caip.mjs.
const COUNCIL = 'eip155:42220:0x0000000d00010000000000000000000000000000000000000000000000000000'
const OPS = 'eip155:42220:0x0000000d00010001000000000000000000000000000000000000000000000000'
const OTHER_TREE = 'eip155:42220:0x0000000e00010000000000000000000000000000000000000000000000000000'
const OTHER_CHAIN = 'eip155:1:0x0000000d00010000000000000000000000000000000000000000000000000000'
const lower = (n: string) => `eip155:42220:0x00000000000000000000000000000000000000${n}`
const A1 = 'eip155:42220:0x00000000000000000000000000000000000000A1'
const A2 = 'eip155:42220:0x00000000000000000000000000000000000000A2'
const A3 = 'eip155:42220:0x00000000000000000000000000000000000000A3'

const NOBODY = (rule: string, role: string) =>
  `rule ${rule}: nobody can propose under it. The ${role} role has no member with a git or wallet handle and is not sourced from a hat. Add a handle first (the owner's claim: §8.1).`
const SEVERAL = 'several Hats trees; name the membership tree in governance.membership.tree'

const MEMBERS: Record<string, unknown>[] = [
  { id: 'steward-a', name: 'Steward A', handles: { git: 'steward-a@example.invalid', wallet: [lower('a1')] } },
  { id: 'steward-b', name: 'Steward B' },
  { id: 'steward-c', name: 'Steward C' },
  { id: 'ops-lead', name: 'Ops lead', kind: 'agent', handles: { git: 'ops-lead@example.invalid' } },
]
const HATS_MAIN = { id: 'hats-main', kind: 'hats-tree', name: 'Hats', chain: 'eip155:42220', address: '13' }
const SYSTEMS = [{ id: 'treasury-safe', kind: 'safe', name: 'Treasury', chain: 'eip155:42220', address: '0x967c04deCA1e3a0DA6ac08E2D1bb3c7A70B0cb60' }, HATS_MAIN]
const CLASSES = ['records', 'members', 'governance', 'identity', 'systems', 'treasury', 'operations', 'publication']
const ctx = (over = {}) => ({ members: MEMBERS, systems: SYSTEMS, classes: CLASSES, ...over })
const live = (over = {}) => ctx({ live: true, ...over })

const hatGov = () => ({
  model: 'steward-council',
  membership: { tree: 'hats-main' },
  roles: { council: { hat: COUNCIL }, maintainer: { members: ['steward-a'] }, member: { all: true } },
  rules: [
    { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'council', method: 'approve', count: 2 } },
    { id: 'governance', applies_to: ['governance', 'members', 'identity', 'systems', 'publication'], propose: 'council', decide: { by: 'council', method: 'consent', window: 'P7D' } },
    { id: 'treasury', applies_to: ['treasury'], propose: 'council', decide: { by: 'system', system: 'treasury-safe' } },
    { id: 'ops', applies_to: ['operations'], propose: 'maintainer', decide: { by: 'maintainer', method: 'direct' } },
  ],
})
const errors = (g: unknown, c: object = ctx()) => checkGovernance(g as never, c as never).filter(p => p.level === 'error').map(p => p.message)
const warns = (g: unknown, c: object = ctx()) => checkGovernance(g as never, c as never).filter(p => p.level === 'warn').map(p => p.message)

const obs = (account: string, wears: boolean, block: number, hat = COUNCIL) => ({ hat, account, wears, block, at: '2026-10-29T10:00:00Z' })

describe('resolveRoles with a role sourced from a hat (L5 spec §7.1, §7.3)', () => {
  it('with no observations a hat role has no members, and keeps its hat', () => {
    const { roles, problems } = resolveRoles(hatGov(), MEMBERS)
    expect(problems).toEqual([])
    expect(roles.get('council')).toEqual({ id: 'council', members: [], all: false, defined: true, hat: COUNCIL })
  })
  it('two arguments: roles that are not hats are exactly as before (no hat key)', () => {
    const { roles } = resolveRoles(hatGov(), MEMBERS)
    expect(roles.get('maintainer')).toStrictEqual({ id: 'maintainer', members: ['steward-a'], all: false, defined: true })
    expect(roles.get('member')).toStrictEqual({ id: 'member', members: ['steward-a', 'steward-b', 'steward-c'], all: true, defined: true })
  })
  it('resolves to the accounts whose standing observation wears it, as CAIP-10 ids', () => {
    const { roles } = resolveRoles(hatGov(), [], [obs(A2, true, 100), obs(A3, true, 100), obs(A1, false, 100)])
    expect(roles.get('council')?.members).toEqual([A2, A3])
  })
  it('an account in handles.wallet of one member resolves to that member id', () => {
    const { roles } = resolveRoles(hatGov(), MEMBERS, [obs(A1, true, 100), obs(A2, true, 100)])
    expect(roles.get('council')?.members).toEqual(['steward-a', A2])
  })
  it('an account in handles.wallet of two members resolves to the CAIP-10 id', () => {
    const two = [...MEMBERS, { id: 'steward-d', name: 'Steward D', handles: { wallet: lower('a1') } }]
    expect(resolveRoles(hatGov(), two, [obs(A1, true, 100)]).roles.get('council')?.members).toEqual([A1])
  })
  it('a later "wears: false" (higher block) removes an earlier "wears: true"', () => {
    const { roles } = resolveRoles(hatGov(), MEMBERS, [obs(A2, true, 100), obs(A2, false, 101)])
    expect(roles.get('council')?.members).toEqual([])
  })
  it('uses the hat exactly: wearing Council does not make someone a wearer of Ops, nor the reverse (C-6)', () => {
    const g = { ...hatGov(), roles: { ...hatGov().roles, ops: { hat: OPS } } }
    const { roles } = resolveRoles(g, [], [obs(A1, true, 100, COUNCIL), obs(A2, true, 100, OPS)])
    expect(roles.get('council')?.members).toEqual([A1])
    expect(roles.get('ops')?.members).toEqual([A2])
  })
  it('reads a hat written in capitals as the same hat', () => {
    const g = { roles: { council: { hat: COUNCIL.replace(/d0001/, 'D0001') } } }
    const { roles } = resolveRoles(g, [], [obs(A1, true, 100)])
    expect(roles.get('council')).toEqual({ id: 'council', members: [A1], all: false, defined: true, hat: COUNCIL })
  })
  describe('from a proposal`s recorded readings (Review Focus 5)', () => {
    const as = (account: string, block: number, wearers: string[], complete: boolean) =>
      ({ hat: COUNCIL, account, block, readAt: '2026-10-29T10:00:00Z', wearers, complete })
    const proposal = (complete: boolean) => ({
      id: 'p-2026-10-29-001',
      opened_as: as(lower('a2'), 100, [lower('a1'), lower('a2')], false),
      events: [{ id: 'e-1', kind: 'approve', as: as(lower('a1'), 200, [lower('a1')], complete) }],
    })
    it('a complete list that omits an account takes the hat off it', () => {
      expect(resolveRoles(hatGov(), [], observationsOf(proposal(true))).roles.get('council')?.members).toEqual([A1])
    })
    it('an incomplete list that omits an account leaves it as its own reading says', () => {
      expect(resolveRoles(hatGov(), [], observationsOf(proposal(false))).roles.get('council')?.members).toEqual([A2, A1])
    })
  })
  it('refuses a role with members and hat, all and hat, or a hat that is no hat ref', () => {
    const { problems } = resolveRoles({ roles: {
      a: { members: ['steward-a'], hat: COUNCIL }, b: { all: true, hat: COUNCIL }, c: { members: [], all: true, hat: COUNCIL },
      d: { hat: 'council' }, e: { hat: '0x0000000d00010000000000000000000000000000000000000000000000000000' },
    } }, MEMBERS)
    expect(problems).toEqual([
      'role "a" has both members and hat; use one',
      'role "b" has both all and hat; use one',
      'role "c" has members, all and hat; use one',
      'role "d": hat must be a hat ref, eip155:<chain id>:0x followed by 64 hex digits',
      'role "e": hat must be a hat ref, eip155:<chain id>:0x followed by 64 hex digits',
    ])
  })
})

describe('membershipTree (L5 spec §5.1)', () => {
  const tree14 = { id: 'hats-other', kind: 'hats-tree', name: 'Other', chain: 'eip155:42220', address: '0xe' }
  it('is the one named in governance.membership.tree', () => {
    expect(membershipTree({ membership: { tree: 'hats-other' } }, [HATS_MAIN, tree14])).toEqual({ id: 'hats-other', tree: 'eip155:42220:14' })
  })
  it('is the only hats-tree System when none is named', () => {
    expect(membershipTree({}, SYSTEMS)).toEqual({ id: 'hats-main', tree: 'eip155:42220:13' })
    expect(membershipTree(null, SYSTEMS)).toEqual({ id: 'hats-main', tree: 'eip155:42220:13' })
  })
  it('is none when several exist and none is named, when there is none, or when the name is not a hats-tree', () => {
    expect(membershipTree({}, [HATS_MAIN, tree14])).toBeNull()
    expect(membershipTree({}, [SYSTEMS[0]])).toBeNull()
    expect(membershipTree({ membership: { tree: 'treasury-safe' } }, SYSTEMS)).toBeNull()
    expect(membershipTree({ membership: { tree: 'nowhere' } }, SYSTEMS)).toBeNull()
  })
  it('is none when the tree System cannot be read as a tree', () => {
    expect(membershipTree({}, [{ ...HATS_MAIN, address: '0x967c04deCA1e3a0DA6ac08E2D1bb3c7A70B0cb60' }])).toBeNull()
  })
})

describe('canAct', () => {
  it('a person with handles.git, handles.email, a top-level email or handles.wallet', () => {
    const ms = [
      { id: 'steward-a', handles: { git: 'steward-a@example.invalid' } },
      { id: 'steward-b', handles: { email: 'steward-b@example.invalid' } },
      { id: 'steward-c', email: 'steward-c@example.invalid' },
      { id: 'steward-d', handles: { wallet: [lower('a1')] } },
    ]
    for (const id of ['steward-a', 'steward-b', 'steward-c', 'steward-d']) expect(canAct(id, ms), id).toBe(true)
  })
  it('not a person with no handle, a wallet that is no CAIP-10 id, an agent, or someone not in the file', () => {
    const ms = [
      { id: 'steward-a' }, { id: 'steward-b', handles: { wallet: '0x00000000000000000000000000000000000000a1' } },
      { id: 'ops-lead', kind: 'agent', handles: { git: 'ops-lead@example.invalid' } },
    ]
    for (const id of ['steward-a', 'steward-b', 'ops-lead', 'steward-z']) expect(canAct(id, ms), id).toBe(false)
  })
  // Controller ruling (Task 3 review, applied in Task 11): with a membership tree known, a wallet counts only on the
  // tree's chain and only when one member alone lists it. Without a tree, as before.
  it('with a membership tree known, a wallet counts only on its chain and when one member alone lists it', () => {
    const tree = membershipTree({}, SYSTEMS)
    const ms = [
      { id: 'steward-a', handles: { wallet: lower('a1') } },
      { id: 'steward-b', handles: { wallet: 'eip155:1:0x00000000000000000000000000000000000000a2' } },
      { id: 'steward-c', handles: { wallet: lower('a3') } },
      { id: 'ops-lead', kind: 'agent', handles: { wallet: A3 } },
      { id: 'steward-d', handles: { git: 'steward-d@example.invalid', wallet: lower('a3') } },
    ]
    expect(canAct('steward-a', ms, tree)).toBe(true)
    expect(canAct('steward-b', ms, tree)).toBe(false) // another chain
    expect(canAct('steward-c', ms, tree)).toBe(false) // a3 is listed by three entries
    expect(canAct('steward-d', ms, tree)).toBe(true) // the git handle still counts
    expect(canAct('steward-b', ms)).toBe(true) // no tree: as before
    expect(canAct('steward-c', ms, null)).toBe(true)
  })
})

describe('resolveRoles with observations null', () => {
  it('does not throw, and reads as no observations', () => {
    expect(resolveRoles(hatGov(), MEMBERS, null as never).roles.get('council')?.members).toEqual([])
  })
})

describe('nobodyCanPropose (L5 spec §7.6)', () => {
  const book = (g: unknown, ms = MEMBERS) => resolveRoles(g as never, ms)
  it('gives the §7.6 sentence when the propose role holds nobody who can act', () => {
    const g = { roles: { stewards: { members: ['steward-b', 'steward-c'] } } }
    expect(nobodyCanPropose({ id: 'records', propose: 'stewards' } as never, book(g), MEMBERS, g)).toBe(NOBODY('records', 'stewards'))
  })
  it('is null when one member of it can act', () => {
    const g = { roles: { stewards: { members: ['steward-a', 'steward-b'] } } }
    expect(nobodyCanPropose({ id: 'records', propose: 'stewards' } as never, book(g), MEMBERS, g)).toBeNull()
  })
  it('is null for a hat-sourced role, even with no readings', () => {
    const g = hatGov()
    expect(nobodyCanPropose(g.rules[1] as never, book(g, []), [], g)).toBeNull()
  })
  it('with the systems known, a wallet off the membership tree\'s chain is no way to propose', () => {
    const g = { roles: { stewards: { members: ['steward-b'] } } }
    const ms = [{ id: 'steward-b', handles: { wallet: 'eip155:1:0x00000000000000000000000000000000000000a2' } }]
    expect(nobodyCanPropose({ id: 'records', propose: 'stewards' } as never, book(g, ms), ms, g, SYSTEMS)).toBe(NOBODY('records', 'stewards'))
    expect(nobodyCanPropose({ id: 'records', propose: 'stewards' } as never, book(g, ms), ms, g)).toBeNull()
    const rules = { ...g, rules: [{ id: 'records', applies_to: ['records'], propose: 'stewards', decide: { by: 'stewards', method: 'direct' } }] }
    expect(checkGovernance(rules as never, { members: ms, systems: SYSTEMS, classes: CLASSES, live: true } as never).map(p => p.message))
      .toContain(NOBODY('records', 'stewards'))
  })
  it('is null for a role nobody defined (checkGovernance says that)', () => {
    expect(nobodyCanPropose({ id: 'records', propose: 'ghost' } as never, book({}), MEMBERS, {})).toBeNull()
  })
})

describe('checkGovernance: hats and the membership tree (L5 spec §7.6)', () => {
  it('passes roles sourced from hats of the membership tree, live, with nobody listed in them', () => {
    expect(checkGovernance(hatGov() as never, live() as never)).toEqual([])
  })
  it('passes the only hats-tree System as the tree when none is named', () => {
    const { membership: _m, ...g } = hatGov()
    expect(checkGovernance(g as never, live() as never)).toEqual([])
  })
  it('a role with both members and hat is an error', () => {
    const g = { ...hatGov(), roles: { ...hatGov().roles, council: { members: ['steward-a'], hat: COUNCIL } } }
    expect(errors(g)).toContain('role "council" has both members and hat; use one')
  })
  it('a hat outside the membership tree is an error', () => {
    const g = { ...hatGov(), roles: { ...hatGov().roles, council: { hat: OTHER_TREE } } }
    expect(errors(g)).toEqual([`role "council": the hat ${OTHER_TREE} is not in the membership tree eip155:42220:13`])
  })
  it('a hat on another chain is an error', () => {
    const g = { ...hatGov(), roles: { ...hatGov().roles, council: { hat: OTHER_CHAIN } } }
    expect(errors(g)).toEqual([`role "council": the hat ${OTHER_CHAIN} is on eip155:1, and the membership tree eip155:42220:13 is on eip155:42220`])
  })
  it('a hat role with no tree to read it in is an error', () => {
    const { membership: _m, ...g } = hatGov()
    expect(errors(g, ctx({ systems: [SYSTEMS[0]] }))).toEqual([
      `role "council" is sourced from the hat ${COUNCIL}, and this org has no membership tree to read it in: add a hats-tree System to data/systems.yaml, or name one in governance.membership.tree`,
    ])
  })
  it('membership.tree naming a System that is not a hats-tree is an error', () => {
    const g = { ...hatGov(), membership: { tree: 'treasury-safe' } }
    expect(errors(g)).toContain('membership.tree names "treasury-safe", which is a safe System, not a hats-tree')
  })
  it('membership.tree naming no System is an error', () => {
    const g = { ...hatGov(), membership: { tree: 'nowhere' } }
    expect(errors(g)).toContain('membership.tree names "nowhere", and data/systems.yaml has no system by that id')
  })
  it('membership that is not { tree } is an error', () => {
    for (const membership of ['hats-main', { tree: '' }, { tree: 13 }]) {
      expect(errors({ ...hatGov(), membership })).toContain('membership is { tree: <the id of a hats-tree System in data/systems.yaml> }')
    }
  })
  it('several trees and none named is a warning with the §5.1 sentence', () => {
    const several = [...SYSTEMS, { id: 'hats-other', kind: 'hats-tree', name: 'Other', chain: 'eip155:42220', address: '14' }]
    expect(warns({ model: 'solo-maintainer' }, ctx({ systems: several }))).toEqual([SEVERAL])
    expect(warns(hatGov(), ctx({ systems: several }))).toEqual([])
  })
  it('does not judge the tree without the systems file', () => {
    const g = { ...hatGov(), membership: { tree: 'nowhere' }, roles: { ...hatGov().roles, council: { hat: OTHER_CHAIN } } }
    expect(errors(g, ctx({ systems: null }))).toEqual([])
  })
  it('a hat role that decides or proposes is never "a role with no members"', () => {
    expect(warns(hatGov())).toEqual([])
    expect(errors(hatGov())).toEqual([])
  })
})

describe('checkGovernance: nobody can propose (L5 spec §7.6, F-L3-1)', () => {
  const listed = () => ({
    ...hatGov(),
    roles: { council: { members: ['steward-b', 'steward-c'] }, maintainer: { members: ['steward-a'] }, member: { all: true } },
    rules: hatGov().rules.map(r => r.decide.method === 'approve' ? { ...r, decide: { ...r.decide, count: 1 } } : r),
  })
  it('a rule whose propose role lists only members without handles gives the §7.6 error verbatim', () => {
    const found = checkGovernance(listed() as never, live() as never).filter(p => p.message.includes('nobody can propose'))
    expect(found).toEqual([
      { file: '', path: 'rules.governance.propose', level: 'error', message: NOBODY('governance', 'council') },
      { file: '', path: 'rules.treasury.propose', level: 'error', message: NOBODY('treasury', 'council') },
    ])
  })
  it('an agent with a git handle is not someone who can propose under it', () => {
    const g = { ...listed(), roles: { ...listed().roles, council: { members: ['steward-b', 'ops-lead'] } } }
    expect(errors(g, live())).toContain(NOBODY('governance', 'council'))
  })
  it('a wallet handle is enough', () => {
    const ms = [...MEMBERS.filter(m => m.id !== 'steward-b'), { id: 'steward-b', name: 'Steward B', handles: { wallet: [lower('a2')] } }]
    expect(errors(listed(), live({ members: ms })).filter(m => m.includes('nobody can propose'))).toEqual([])
  })
  it('a role with no members at all gives the error, not also the warning', () => {
    const g = { ...listed(), roles: { ...listed().roles, member: { members: [] } } }
    expect(errors(g, live())).toContain(NOBODY('records', 'member'))
    expect(warns(g, live())).toEqual([])
  })
  it('a hat-sourced propose role never does, with nobody in the file holding a handle', () => {
    const g = {
      ...hatGov(), roles: { council: { hat: COUNCIL } },
      rules: hatGov().rules.map(r => ({ ...r, propose: 'council', decide: r.decide.by === 'maintainer' ? { by: 'council', method: 'direct' } : r.decide })),
    }
    expect(checkGovernance(g as never, live({ members: [{ id: 'steward-b' }] }) as never)).toEqual([])
  })
  it('the solo default is never checked for it', () => {
    expect(checkGovernance({ model: 'solo-maintainer' } as never, live({ members: [{ id: 'steward-b' }] }) as never)).toEqual([])
    expect(checkGovernance({ model: 'solo-maintainer', roles: { maintainer: { members: ['steward-b'] } } } as never, live() as never)).toEqual([])
  })
  it('is checked only on the live document: rules checked without `live` (a proposal`s frozen rules) never give it (ruling P8)', () => {
    expect(errors(listed()).filter(m => m.includes('nobody can propose'))).toEqual([])
  })
  it('is not judged without the members file', () => {
    expect(errors(listed(), live({ members: null })).filter(m => m.includes('nobody can propose'))).toEqual([])
  })
})
