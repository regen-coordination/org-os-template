import { describe, it, expect } from 'vitest'
import { checkGovernance } from '../../lib/rules.mjs'

const CLASSES = ['records', 'members', 'governance', 'identity', 'systems', 'treasury', 'operations']
const MEMBERS = [
  { id: 'ana', name: 'Ana' }, { id: 'bruno', name: 'Bruno' }, { id: 'carla', name: 'Carla' },
  { id: 'crew-engineer', name: 'Engineer seat', kind: 'agent' },
  { id: 'fixture-coop', name: 'Fixture Coop', kind: 'organization' },
]
const SYSTEMS = [{ id: 'treasury-safe', kind: 'safe', name: 'Treasury' }]
const ctx = (over = {}) => ({ members: MEMBERS, systems: SYSTEMS, classes: CLASSES, ...over })

// Architecture §4.5 verbatim, plus the two classes it leaves out so that nothing is uncovered.
const good = () => ({
  model: 'consensus',
  roles: { maintainer: { members: ['ana', 'bruno', 'carla'] }, member: { all: true } },
  rules: [
    { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } },
    { id: 'governance', applies_to: ['governance', 'members', 'identity', 'systems'], propose: 'maintainer', decide: { by: 'maintainer', method: 'consent', window: 'P7D' } },
    { id: 'treasury', applies_to: ['treasury'], propose: 'maintainer', decide: { by: 'system', system: 'treasury-safe' } },
    { id: 'ops', applies_to: ['operations'], propose: 'maintainer', decide: { by: 'maintainer', method: 'approve', count: 2 } },
  ],
})
const withRule = (i: number, patch: (r: any) => void) => { const g = good(); patch(g.rules[i]); return g }
const errors = (g: unknown, c = ctx()) => checkGovernance(g as never, c).filter(p => p.level === 'error').map(p => p.message)
const warns = (g: unknown, c = ctx()) => checkGovernance(g as never, c).filter(p => p.level === 'warn').map(p => p.message)

describe('checkGovernance passes what is right', () => {
  it('the architecture example, with every class covered', () => expect(checkGovernance(good() as never, ctx())).toEqual([]))
  it('a system rule naming the choice that must pass (DAO-OS L2, ruling K2)', () => {
    expect(checkGovernance(withRule(2, r => { r.decide.passes = { choice: 'For' } }) as never, ctx())).toEqual([])
  })
  it('the solo default: no rules, no roles, nothing to say', () => expect(checkGovernance({ model: 'solo-maintainer' } as never, ctx())).toEqual([]))
  it.each([[{ roles: [] }], [{ roles: null }], [{ roles: null, rules: null }], [null], [{}]])('roles/rules absent: %j', g => {
    expect(checkGovernance(g as never, ctx())).toEqual([])
  })
  it('a split class', () => {
    const g = good(); g.rules.push({ id: 'funding', applies_to: ['records:funding'], propose: 'maintainer', decide: { by: 'maintainer', method: 'direct' } } as never)
    expect(checkGovernance(g as never, ctx())).toEqual([])
  })
  it('`all` as a catch-all beside specific rules', () => {
    const g = good(); g.rules = [g.rules[0], { id: 'rest', applies_to: ['all'], propose: 'maintainer', decide: { by: 'maintainer', method: 'direct' } }] as never
    expect(checkGovernance(g as never, ctx())).toEqual([])
  })
  it('a vote rule', () => {
    expect(errors(withRule(0, r => { r.decide = { by: 'maintainer', method: 'vote', window: 'P3D', quorum: 2, threshold: 0.66 } }))).toEqual([])
  })
  it('does not check classes or members it was not given', () => {
    expect(errors(good(), { members: null, systems: null, classes: null } as never)).toEqual([])
  })
})

describe('checkGovernance fails what is wrong, and says what to change', () => {
  const cases: [string, unknown, string][] = [
    ['an agent as a decider, by listing', { ...good(), roles: { maintainer: { members: ['ana', 'crew-engineer'] }, member: { all: true } } },
      'rule "records": role "maintainer" lists the agent "crew-engineer", and an agent never decides; take it out of the role, or decide by another role'],
    ['an organization as a decider, by listing (L5)', { ...good(), roles: { maintainer: { members: ['ana', 'fixture-coop'] }, member: { all: true } } },
      'rule "records": role "maintainer" lists the organization "fixture-coop", and an organization cannot make commits, so it never decides; take it out of the role, or decide by another role'],
    ['a decider role with no members', { ...good(), roles: { maintainer: { members: [] }, member: { all: true } } },
      'rule "records": role "maintainer" has no members, so nobody can decide'],
    ['a decider role no one defined', withRule(0, r => { r.decide.by = 'steward' }),
      'rule "records": decide.by names the role "steward", and roles defines none by that name'],
    ['a proposer role no one defined', withRule(0, r => { r.propose = 'steward' }),
      'rule "records": propose names the role "steward", and roles defines none by that name'],
    ['a role listing a member the file does not hold', { ...good(), roles: { maintainer: { members: ['ana', 'ghost'] }, member: { all: true } } },
      'role "maintainer" lists "ghost", who is not in data/members.yaml'],
    ['a system no one defined', withRule(2, r => { r.decide.system = 'nowhere' }),
      'rule "treasury": decide.system names "nowhere", and data/systems.yaml has no system by that id'],
    ['a system rule with no system', withRule(2, r => { delete r.decide.system }),
      'rule "treasury": method system needs decide.system, the id of a system in data/systems.yaml'],
    ['by: system with another method', withRule(2, r => { r.decide.method = 'approve' }),
      'rule "treasury": decide.by is system, which only method system can use'],
    ['method system with a role in by', withRule(2, r => { r.decide.by = 'maintainer'; r.decide.method = 'system' }),
      'rule "treasury": method system is decided by the system itself: write decide.by: system'],
    ['passes that is not a choice', withRule(2, r => { r.decide.passes = 'For' }),
      'rule "treasury": decide.passes is { choice: "<the label of the choice that must win>" }, not "For"'],
    ['passes with an empty choice', withRule(2, r => { r.decide.passes = { choice: '' } }),
      'rule "treasury": decide.passes is { choice: "<the label of the choice that must win>" }, not {"choice":""}'],
    ['passes with a numbered choice', withRule(2, r => { r.decide.passes = { choice: 1 } }),
      'rule "treasury": decide.passes is { choice: "<the label of the choice that must win>" }, not {"choice":1}'],
    ['passes with another key', withRule(2, r => { r.decide.passes = { choice: 'For', quorum: 3 } }),
      'rule "treasury": decide.passes is { choice: "<the label of the choice that must win>" }, not {"choice":"For","quorum":3}'],
    ['passes on a rule people decide', withRule(0, r => { r.decide.passes = { choice: 'For' } }),
      'rule "records": decide.passes names the choice that must win an outside vote, so only method system takes it; this rule is decided by approve'],
    ['a duplicate rule id', withRule(1, r => { r.id = 'records' }), 'rule id "records" is used twice; each rule needs its own'],
    ['no id', withRule(0, r => { delete r.id }), 'rule #1 has no id'],
    ['a bad id', withRule(0, r => { r.id = 'Records!' }), 'rule "Records!": the id must be lowercase letters, digits, - and _, starting with a letter'],
    ['two rules on one class', withRule(3, r => { r.applies_to = ['operations', 'records'] }),
      'class "records" is covered by both rule "records" and rule "ops"; give each class one rule, or split it (records:funding)'],
    ['two catch-alls', { ...good(), rules: [
      { id: 'a', applies_to: ['all'], propose: 'maintainer', decide: { by: 'maintainer', method: 'direct' } },
      { id: 'b', applies_to: ['all'], propose: 'maintainer', decide: { by: 'maintainer', method: 'direct' } }] },
      'class "all" is covered by both rule "a" and rule "b"; give each class one rule, or split it (records:funding)'],
    ['an unknown class', withRule(0, r => { r.applies_to = ['recrods'] }),
      'rule "records": applies_to "recrods" is not a change class (records, members, governance, identity, systems, treasury, operations), a split such as records:funding, or all'],
    ['a split of an unknown class', withRule(0, r => { r.applies_to = ['recrods:funding'] }),
      'rule "records": applies_to "recrods:funding" is not a change class (records, members, governance, identity, systems, treasury, operations), a split such as records:funding, or all'],
    ['no applies_to', withRule(0, r => { r.applies_to = [] }), 'rule "records": applies_to must list at least one class'],
    ['no propose', withRule(0, r => { delete r.propose }), 'rule "records": propose is missing; name the role that may propose'],
    ['no decide', withRule(0, r => { delete r.decide }), 'rule "records": decide is missing; write { by: <role>, method: <method> }'],
    ['an unknown method', withRule(0, r => { r.decide.method = 'majority' }),
      'rule "records": method "majority" is not one of direct, approve, consent, vote, system'],
    ['a typo in decide, when the method is also missing (L1)', withRule(0, r => { delete r.decide.method; r.decide.methd = 'approve' }),
      'rule "records": decide.methd is not a field of decide (it takes by, method, count, window, quorum, threshold, system)'],
    ['a typo in decide, when the method is also unknown (L1)', withRule(0, r => { r.decide.method = 'majority'; r.decide.cuont = 2 }),
      'rule "records": decide.cuont is not a field of decide (it takes by, method, count, window, quorum, threshold, system)'],
    ['a typo in decide', withRule(0, r => { r.decide.methd = 'approve' }),
      'rule "records": decide.methd is not a field of method approve (it takes by, method, count)'],
    ['a field of another method', withRule(0, r => { r.decide.window = 'P7D' }),
      'rule "records": decide.window is not a field of method approve (it takes by, method, count)'],
    ['a typo in the rule', withRule(0, r => { r.apply_to = ['x'] }), 'rule "records": apply_to is not a field of a rule (id, applies_to, propose, decide, description, expires, self_approve)'],
    ['a count of zero', withRule(0, r => { r.decide.count = 0 }), 'rule "records": count must be a whole number of 1 or more'],
    ['a count of 1.5', withRule(0, r => { r.decide.count = 1.5 }), 'rule "records": count must be a whole number of 1 or more'],
    ['a count nobody can reach', withRule(0, r => { r.decide.count = 4 }), 'rule "records": count is 4, and role "maintainer" has 3 members, so it can never be met'],
    ['consent with no window', withRule(1, r => { delete r.decide.window }), 'rule "governance": method consent needs decide.window, such as P7D'],
    ['a window that is not a duration', withRule(1, r => { r.decide.window = '7 days' }),
      'rule "governance": window "7 days" is not a duration of weeks, days, hours or minutes, such as P7D or PT36H'],
    ['a window in months', withRule(1, r => { r.decide.window = 'P1M' }),
      'rule "governance": window "P1M" is not a duration of weeks, days, hours or minutes, such as P7D or PT36H'],
    ['a vote with no quorum', withRule(0, r => { r.decide = { by: 'maintainer', method: 'vote', window: 'P3D', threshold: 0.5 } }),
      'rule "records": method vote needs decide.quorum, a whole number of 1 or more'],
    ['a vote with a threshold of zero', withRule(0, r => { r.decide = { by: 'maintainer', method: 'vote', window: 'P3D', quorum: 2, threshold: 0 } }),
      'rule "records": threshold must be above 0 and at most 1 (0.5 is half of the votes cast)'],
    ['a vote with a threshold of 51', withRule(0, r => { r.decide = { by: 'maintainer', method: 'vote', window: 'P3D', quorum: 2, threshold: 51 } }),
      'rule "records": threshold must be above 0 and at most 1 (0.5 is half of the votes cast)'],
    ['a quorum nobody can reach', withRule(0, r => { r.decide = { by: 'maintainer', method: 'vote', window: 'P3D', quorum: 5, threshold: 0.5 } }),
      'rule "records": quorum is 5, and role "maintainer" has 3 members, so it can never be met'],
  ]
  it.each(cases)('%s', (_name, g, message) => expect(errors(g)).toContain(message))

  it('reports a roles list as an error', () => {
    expect(errors({ ...good(), roles: [{ name: 'steward' }] })).toContain('roles is a list; write a map from a role name to { members: [...] } or { all: true }')
  })
  it('reports a rules value that is not a list', () => {
    expect(errors({ ...good(), rules: { id: 'records' } })).toContain('rules must be a list of rules')
  })
  it('reports a rule that is not a mapping', () => {
    expect(errors({ ...good(), rules: ['records'] })).toContain('rule #1 is not a mapping of fields to values')
  })
  it('accepts the unknown only through the roles it was given: without data/systems.yaml a system rule fails', () => {
    expect(errors(good(), ctx({ systems: [] }))).toContain('rule "treasury": decide.system names "treasury-safe", and data/systems.yaml has no system by that id')
  })
})

describe('checkGovernance warns, never fails, for these', () => {
  it('an uncovered class, naming it', () => {
    const g = good(); g.rules.pop()
    expect(warns(g)).toEqual(['no rule covers the class operations: nobody can apply a change of that class directly until a rule does'])
  })
  it('several uncovered classes in one line', () => {
    const g = good(); g.rules = [g.rules[0], g.rules[1]]
    expect(warns(g)).toEqual(['no rule covers the classes treasury, operations: nobody can apply a change of those classes directly until a rule does'])
  })
  it('no rule for governance: the rules could never be changed', () => {
    const g = good(); g.rules[1].applies_to = ['members', 'identity', 'systems']
    expect(warns(g)).toEqual(['no rule covers the class governance, so the rules and roles could never be changed through the platform; add one'])
  })
  it('a proposer role with no members', () => {
    expect(warns({ ...good(), roles: { maintainer: { members: ['ana', 'bruno', 'carla'] }, member: { members: [] } } }))
      .toEqual(['rule "records": role "member" has no members, so nobody can propose it'])
  })
  it('solo-maintainer with a rule that is not direct', () => {
    expect(warns({ ...good(), model: 'solo-maintainer' })).toEqual([
      'the model is solo-maintainer, but rules "records", "governance", "treasury", "ops" do not decide directly; the rules win, so change the model or the rules',
    ])
    const one = good(); one.rules = [one.rules[0], ...one.rules.slice(1).map(r => ({ ...r, decide: { by: 'maintainer', method: 'direct' } }))] as never
    expect(warns({ ...one, model: 'solo-maintainer' })).toEqual([
      'the model is solo-maintainer, but rule "records" does not decide directly; the rules win, so change the model or the rule',
    ])
  })
  it('does not warn the solo default about anything', () => expect(warns({ model: 'solo-maintainer' })).toEqual([]))
})

describe('checkGovernance problem shape', () => {
  it('carries a path and a level, and leaves file for validateRepo', () => {
    const [p] = checkGovernance(withRule(0, r => { r.decide.count = 0 }) as never, ctx())
    expect(p).toEqual({ file: '', path: 'rules.records.decide.count', message: expect.any(String), level: 'error' })
  })
})
