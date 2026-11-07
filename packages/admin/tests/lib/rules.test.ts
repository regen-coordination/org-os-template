import { describe, it, expect } from 'vitest'
import {
  METHODS, SOLO_RULES, parseDuration, resolveRoles, rolesOf, effectiveRules, ruleFor, rulesForClasses,
  mayPropose, mayDecideAlone, describeRule,
} from '../../lib/rules.mjs'

// Synthetic: ids in the styles the fleet survey found; no instance content.
const MEMBERS: Record<string, unknown>[] = [
  { id: 'ana', name: 'Ana' },
  { id: 'github:bruno', name: 'Bruno', type: 'individual' },
  { id: 'did:fixture:carla', name: 'Carla', kind: 'person' },
  { id: 'crew-engineer', name: 'Engineer seat', kind: 'agent' },
  { id: 'fixture-org', name: 'Fixture Org', kind: 'organization' },
]

// Architecture §4.5, verbatim.
const EXAMPLE = {
  model: 'consensus',
  roles: {
    maintainer: { members: ['ana', 'github:bruno', 'did:fixture:carla'] },
    member: { all: true },
  },
  rules: [
    { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } },
    { id: 'governance', applies_to: ['governance', 'members', 'identity', 'systems'], propose: 'maintainer', decide: { by: 'maintainer', method: 'consent', window: 'P7D' } },
    { id: 'treasury', applies_to: ['treasury'], propose: 'maintainer', decide: { by: 'system', system: 'treasury-safe' } },
  ],
}

describe('METHODS and SOLO_RULES', () => {
  it('are the five methods of architecture §4.5', () => expect(METHODS).toEqual(['direct', 'approve', 'consent', 'vote', 'system']))
  it('is one rule, applying to all, decided directly by the maintainer', () => {
    expect(SOLO_RULES).toEqual([{ id: 'solo', applies_to: ['all'], propose: 'maintainer', decide: { by: 'maintainer', method: 'direct' } }])
    expect(Object.isFrozen(SOLO_RULES)).toBe(true)
  })
})

describe('parseDuration', () => {
  it.each([['P7D', 7 * 864e5], ['P2W', 14 * 864e5], ['PT36H', 36 * 36e5], ['P1DT12H', 36 * 36e5], ['PT90M', 90 * 6e4]])('%s', (text, ms) => {
    expect(parseDuration(text)).toBe(ms)
  })
  it.each(['P1M', 'P1Y', '7D', '', 'P', 'PT', 'P0D', 'p7d', 'P7D ', 'P-1D', 'PT1.5H', null, undefined, 7])('is null for %j', text => {
    expect(parseDuration(text as string)).toBeNull()
  })
})

describe('resolveRoles', () => {
  it('lists members as written and resolves all to persons only', () => {
    const { roles, problems, agents } = resolveRoles(EXAMPLE, MEMBERS)
    expect(problems).toEqual([])
    expect(roles.get('maintainer')).toEqual({ id: 'maintainer', members: ['ana', 'github:bruno', 'did:fixture:carla'], all: false, defined: true })
    expect(roles.get('member')).toEqual({ id: 'member', members: ['ana', 'github:bruno', 'did:fixture:carla'], all: true, defined: true })
    expect([...agents]).toEqual(['crew-engineer'])
  })
  it('defines maintainer as every person when the roles do not (F2-R2)', () => {
    const { roles, problems } = resolveRoles({ model: 'solo-maintainer' }, MEMBERS)
    expect(problems).toEqual([])
    expect(roles.get('maintainer')).toEqual({ id: 'maintainer', members: ['ana', 'github:bruno', 'did:fixture:carla'], all: true, defined: false })
  })
  it.each([[{ roles: [] }], [{ roles: null }], [{}], [null]])('reads no roles from %j', g => {
    const { roles, problems } = resolveRoles(g as never, MEMBERS)
    expect(problems).toEqual([])
    expect([...roles.keys()]).toEqual(['maintainer'])
  })
  it('says a role map is expected when roles is a non-empty list', () => {
    const { problems } = resolveRoles({ roles: [{ name: 'steward' }] }, MEMBERS)
    expect(problems).toEqual(['roles is a list; write a map from a role name to { members: [...] } or { all: true }'])
  })
  it('refuses a role with both keys, neither key, a bad id, a bad members list', () => {
    const { problems } = resolveRoles({ roles: {
      both: { members: ['ana'], all: true }, neither: {}, 'Bad Id': { members: ['ana'] }, scalar: 'ana', bad: { members: 'ana' }, falsy: { all: false },
    } }, MEMBERS)
    expect(problems).toEqual([
      'role "both" has both members and all; use one',
      'role "neither" has neither members nor all: true',
      'role "Bad Id" is not a role id (lowercase letters, digits, - and _, starting with a letter)',
      'role "scalar" is not a mapping; write { members: [...] } or { all: true }',
      'role "bad": members must be a list of member ids',
      'role "falsy": all must be true, or left out',
    ])
  })
  it('keeps a listed id the members file does not hold (checkGovernance reports it)', () => {
    expect(resolveRoles({ roles: { maintainer: { members: ['ana', 'ghost'] } } }, MEMBERS).roles.get('maintainer')?.members).toEqual(['ana', 'ghost'])
  })
  it('lists every person once even when the file repeats an id', () => {
    const dup = [...MEMBERS, { id: 'ana', name: 'Ana again' }]
    expect(resolveRoles({ roles: { member: { all: true } } }, dup).roles.get('member')?.members).toEqual(['ana', 'github:bruno', 'did:fixture:carla'])
  })
})

describe('rolesOf', () => {
  it('names the roles a member holds', () => {
    const { roles } = resolveRoles({ roles: { maintainer: { members: ['ana'] }, member: { all: true } } }, MEMBERS)
    expect(rolesOf(roles, 'ana')).toEqual(['maintainer', 'member'])
    expect(rolesOf(roles, 'github:bruno')).toEqual(['member'])
    expect(rolesOf(roles, 'crew-engineer')).toEqual([])
    expect(rolesOf(roles, 'nobody')).toEqual([])
  })
})

describe('effectiveRules', () => {
  it('is the solo default when the model is solo (or none) and no rules are written', () => {
    for (const g of [{ model: 'solo-maintainer' }, { model: 'solo-maintainer', rules: [] }, { model: 'solo-maintainer', rules: null }, {}, null, { model: '' }]) {
      expect(effectiveRules(g as never)).toEqual({ rules: SOLO_RULES, implied: true })
    }
  })
  it('has no default for another model without rules (F2-R5)', () => {
    expect(effectiveRules({ model: 'consensus' })).toEqual({ rules: [], implied: false })
    expect(effectiveRules({ model: 'other', description: 'x' })).toEqual({ rules: [], implied: false })
  })
  it('reads written rules over the model, defaulting count to 1 for approve only', () => {
    const { rules, implied } = effectiveRules({ model: 'solo-maintainer', rules: [
      { id: 'a', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve' } },
      { id: 'b', applies_to: ['members'], propose: 'member', decide: { by: 'maintainer', method: 'direct' } },
    ] })
    expect(implied).toBe(false)
    expect(rules[0].decide).toEqual({ by: 'maintainer', method: 'approve', count: 1 })
    expect(rules[1].decide).toEqual({ by: 'maintainer', method: 'direct' })
  })
  it('reads the architecture example, reading by: system as method: system (F2-R4)', () => {
    const rules = effectiveRules(EXAMPLE).rules
    expect(rules.slice(0, 2)).toEqual(EXAMPLE.rules.slice(0, 2))
    expect(rules[2].decide).toEqual({ by: 'system', method: 'system', system: 'treasury-safe' })
  })
  it('keeps a system rule\'s passes, the label of the Snapshot choice that must win (DAO-OS L2, ruling K2)', () => {
    const { rules } = effectiveRules({ rules: [
      { id: 'votes', applies_to: ['records'], propose: 'member', decide: { by: 'system', system: 'dao-votes', passes: { choice: 'For' } } },
    ] })
    expect(rules[0].decide).toEqual({ by: 'system', method: 'system', system: 'dao-votes', passes: { choice: 'For' } })
  })
  it('does not throw on a malformed rule: it normalises what it can', () => {
    const { rules } = effectiveRules({ rules: [null, 'x', { id: 'r' }, { id: 's', applies_to: 'records', decide: 'x' }] })
    expect(rules.map(r => r.id)).toEqual(['r', 's'])
    expect(rules[0].applies_to).toEqual([])
    expect(rules[1].applies_to).toEqual(['records'])
  })
})

describe('ruleFor and rulesForClasses (F2-R3)', () => {
  const { rules } = effectiveRules({ rules: [
    { id: 'every', applies_to: ['all'], propose: 'm', decide: { by: 'm', method: 'direct' } },
    { id: 'recs', applies_to: ['records'], propose: 'm', decide: { by: 'm', method: 'direct' } },
    { id: 'fund', applies_to: ['records:funding'], propose: 'm', decide: { by: 'm', method: 'direct' } },
  ] })
  it('prefers the exact split, then the class, then all', () => {
    expect(ruleFor(rules, 'records:funding')?.id).toBe('fund')
    expect(ruleFor(rules, 'records')?.id).toBe('recs')
    expect(ruleFor(rules, 'records:people')?.id).toBe('recs')
    expect(ruleFor(rules, 'members')?.id).toBe('every')
  })
  it('is null for an uncovered class', () => {
    expect(ruleFor(rules.filter(r => r.id !== 'every'), 'members')).toBeNull()
    expect(ruleFor([], 'records')).toBeNull()
  })
  it('a split rule alone governs nothing that is asked as the whole class (M1): splits are accepted and inert until a change names one', () => {
    const { rules: only } = effectiveRules({ rules: [{ id: 'fund', applies_to: ['records:funding'], propose: 'm', decide: { by: 'm', method: 'direct' } }] })
    expect(ruleFor(only, 'records:funding')?.id).toBe('fund')
    expect(ruleFor(only, 'records')).toBeNull()
  })
  it('answers one rule per class', () => {
    expect(rulesForClasses(rules, ['records', 'members']).map(x => [x.class, x.rule?.id])).toEqual([['records', 'recs'], ['members', 'every']])
    expect(rulesForClasses([], ['records'])).toEqual([{ class: 'records', rule: null }])
  })
})

describe('mayPropose / mayDecideAlone', () => {
  const book = resolveRoles(EXAMPLE, [...MEMBERS])
  const [records, governance, treasury] = effectiveRules(EXAMPLE).rules as never[]
  const direct = { id: 'd', applies_to: ['records'], propose: 'maintainer', decide: { by: 'maintainer', method: 'direct' } }

  it('lets a holder of the propose role propose', () => {
    expect(mayPropose(records, 'ana', book)).toBe(true)
    expect(mayPropose(records, 'github:bruno', book)).toBe(true) // member: all persons
  })
  it('refuses someone without the role, an agent that is not listed, and an unknown id, in words', () => {
    expect(mayPropose(governance, 'nobody', book)).toBe('"nobody" does not hold the maintainer role, which rule "governance" asks of whoever proposes.')
    expect(mayPropose(records, 'crew-engineer', book)).toBe('"crew-engineer" does not hold the member role, which rule "records" asks of whoever proposes.')
  })
  it('lets an agent propose when a role lists it', () => {
    const withAgent = resolveRoles({ roles: { member: { members: ['crew-engineer', 'ana'] } } }, MEMBERS)
    expect(mayPropose({ ...(records as object), propose: 'member' } as never, 'crew-engineer', withAgent)).toBe(true)
  })
  it('refuses a rule that names a role nobody defined', () => {
    expect(mayPropose({ ...(direct as object), propose: 'steward' } as never, 'ana', book)).toBe('rule "d" asks the steward role to propose, and this org defines no such role.')
  })

  it('direct: the author decides alone when they hold propose and by', () => {
    expect(mayDecideAlone(direct as never, 'ana', book)).toBe(true)
  })
  it('direct: refuses someone who holds neither role', () => {
    expect(mayDecideAlone(direct as never, 'nobody', book)).toBe('"nobody" does not hold the maintainer role, which rule "d" asks of whoever proposes.')
  })
  it('direct: an agent never decides, even if a role lists it', () => {
    const listed = resolveRoles({ roles: { maintainer: { members: ['crew-engineer'] } } }, MEMBERS)
    expect(mayDecideAlone(direct as never, 'crew-engineer', listed)).toBe('"crew-engineer" is an agent, and an agent never decides.')
  })
  it('direct: needs the by role to exist', () => {
    expect(mayDecideAlone({ ...direct, decide: { by: 'steward', method: 'direct' } } as never, 'ana', book))
      .toBe('rule "d" asks the steward role to decide, and this org defines no such role.')
  })
  it.each([['records', 'approve', 'needs 1 approval from the maintainer'], ['governance', 'consent', 'needs the maintainer\'s consent over a 7-day objection window'],
    ['treasury', 'system', 'is decided by the system treasury-safe']])('%s (%s): never alone', (_c, method, tail) => {
    const rule = { records, governance, treasury }[_c as 'records']
    expect(mayDecideAlone(rule, 'ana', book)).toBe(`rule "${(rule as { id: string }).id}" ${tail}, so it cannot be applied alone.`)
    expect((rule as { decide: { method: string } }).decide.method).toBe(method)
  })
  it('vote: never alone', () => {
    const vote = { id: 'v', applies_to: ['records'], propose: 'maintainer', decide: { by: 'maintainer', method: 'vote', window: 'P3D', quorum: 2, threshold: 0.5 } }
    expect(mayDecideAlone(vote as never, 'ana', book)).toBe('rule "v" needs a vote of the maintainer (quorum 2, at least 50% yes within 3 days), so it cannot be applied alone.')
  })
  it('the solo default lets every person decide, and no agent', () => {
    const solo = resolveRoles({ model: 'solo-maintainer' }, MEMBERS)
    expect(mayDecideAlone(SOLO_RULES[0], 'ana', solo)).toBe(true)
    expect(mayDecideAlone(SOLO_RULES[0], 'fixture-org', solo)).toMatch(/does not hold the maintainer role/)
    expect(mayDecideAlone(SOLO_RULES[0], 'crew-engineer', solo)).toBe('"crew-engineer" is an agent, and an agent never decides.')
  })
})

describe('describeRule', () => {
  const [records, governance, treasury] = effectiveRules(EXAMPLE).rules as never[]
  it('says what each method asks', () => {
    expect(describeRule(records)).toBe('applies to records · member proposes · needs 1 approval from the maintainer')
    expect(describeRule(governance)).toBe('applies to governance, members, identity, systems · maintainer proposes · needs the maintainer\'s consent over a 7-day objection window')
    expect(describeRule(treasury)).toBe('applies to treasury · maintainer proposes · is decided by the system treasury-safe')
    const t = treasury as unknown as { decide: Record<string, unknown> }
    expect(describeRule({ ...t, decide: { ...t.decide, passes: { choice: 'For' } } } as never))
      .toBe('applies to treasury · maintainer proposes · is decided by the system treasury-safe, passing when "For" wins')
    expect(describeRule(SOLO_RULES[0])).toBe('applies to everything · maintainer proposes · the maintainer decides alone')
  })
  it('pluralises approvals and says hours', () => {
    expect(describeRule({ id: 'x', applies_to: ['records'], propose: 'm', decide: { by: 'm', method: 'approve', count: 2 } } as never)).toMatch(/needs 2 approvals from the m$/)
    expect(describeRule({ id: 'x', applies_to: ['records'], propose: 'm', decide: { by: 'm', method: 'consent', window: 'PT36H' } } as never)).toMatch(/36-hour objection window$/)
  })
  it('does not throw on a rule with fields missing', () => {
    expect(describeRule({ id: 'x' } as never)).toBe('applies to nothing named · nobody named proposes · decides by no method named')
  })
})
