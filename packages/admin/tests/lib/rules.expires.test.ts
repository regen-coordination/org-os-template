import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { checkGovernance, effectiveRules, describeRule } from '../../lib/rules.mjs'
import { validateEntry } from '../../lib/data-validate.mjs'

// The two optional rule keys P2 adds (spec §3.6): `expires` and `self_approve`.
const CLASSES = ['records', 'members', 'governance', 'identity', 'systems', 'treasury', 'operations']
const MEMBERS = [{ id: 'ana' }, { id: 'bruno' }, { id: 'carla' }, { id: 'dora' }, { id: 'crew-engineer', kind: 'agent' }]
const ctx = { members: MEMBERS, systems: null, classes: CLASSES }
const gov = (rule: Record<string, unknown>, roles: Record<string, unknown> = { maintainer: { members: ['ana', 'bruno', 'carla'] }, member: { all: true } }) => ({
  roles, rules: [{ id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 }, ...rule }],
})
const errors = (g: unknown) => checkGovernance(g as never, ctx).filter(p => p.level === 'error').map(p => p.message)
// Only the warnings about the rule itself: the coverage warnings (classes no rule names) are another test's.
const warns = (g: unknown) => checkGovernance(g as never, ctx).filter(p => p.level === 'warn' && p.path.startsWith('rules.records')).map(p => p.message)

describe('expires', () => {
  it.each([
    ['approve', { by: 'maintainer', method: 'approve', count: 1 }],
    ['consent', { by: 'maintainer', method: 'consent', window: 'P7D' }],
    ['vote', { by: 'maintainer', method: 'vote', window: 'P3D', quorum: 2, threshold: 0.5 }],
    ['direct', { by: 'maintainer', method: 'direct' }],
  ])('is accepted as a duration on method %s', (_m, decide) => {
    expect(errors(gov({ decide, expires: 'P14D' }))).toEqual([])
  })
  it('is accepted on method system', () => {
    const g = { ...gov({ decide: { by: 'system', system: 's' }, expires: 'PT36H' }) }
    expect(checkGovernance(g as never, { ...ctx, systems: [{ id: 's' }] }).filter(p => p.level === 'error')).toEqual([])
  })
  it.each([['P1M'], ['soon'], [7], ['P0D']])('refuses %j, and says what a duration looks like', bad => {
    expect(errors(gov({ expires: bad })).join('\n')).toMatch(/expires .* is not a duration of weeks, days, hours or minutes, such as P7D or PT36H/)
  })
  it('is named in the error that lists a rule’s fields', () => {
    expect(errors(gov({ colour: 'red' })).join('\n')).toMatch(/colour is not a field of a rule \(id, applies_to, propose, decide, description, expires, self_approve\)/)
  })
  it('survives normalisation when written, and is absent when not', () => {
    expect(effectiveRules(gov({ expires: 'P14D' }) as never).rules[0]).toMatchObject({ expires: 'P14D' })
    expect(effectiveRules(gov({}) as never).rules[0]).not.toHaveProperty('expires')
  })
  it('describeRule says it', () => {
    expect(describeRule(effectiveRules(gov({ expires: 'P14D' }) as never).rules[0]!)).toBe('applies to records · member proposes · needs 1 approval from the maintainer · expires after 14 days')
    expect(describeRule(effectiveRules(gov({}) as never).rules[0]!)).toBe('applies to records · member proposes · needs 1 approval from the maintainer')
  })
})

describe('self_approve (M-4: today RULE_KEYS makes any other key an error)', () => {
  it('is accepted as a boolean', () => {
    expect(errors(gov({ self_approve: true }))).toEqual([])
    expect(errors(gov({ self_approve: false }))).toEqual([])
  })
  it.each([['yes'], [1], [null], ['true']])('refuses %j', bad => {
    expect(errors(gov({ self_approve: bad })).join('\n')).toMatch(/self_approve must be true or false/)
  })
  it('is carried by normalise only when true: a snapshot of a rule without it equals what ruleFor gave', () => {
    expect(effectiveRules(gov({ self_approve: true }) as never).rules[0]).toMatchObject({ self_approve: true })
    expect(effectiveRules(gov({ self_approve: false }) as never).rules[0]).not.toHaveProperty('self_approve')
    expect(effectiveRules(gov({}) as never).rules[0]).not.toHaveProperty('self_approve')
  })
  it('describeRule says "the author’s own approval counts" when true, and nothing when false', () => {
    expect(describeRule(effectiveRules(gov({ self_approve: true }) as never).rules[0]!)).toBe(
      "applies to records · member proposes · needs 1 approval from the maintainer · the author's own approval counts")
    expect(describeRule(effectiveRules(gov({ self_approve: false }) as never).rules[0]!)).not.toContain('author')
  })
  it('is in governance.schema.json, beside expires', () => {
    const schema = JSON.parse(readFileSync(new URL('../../schemas/governance.schema.json', import.meta.url), 'utf8'))
    expect(Object.keys(schema.properties.rules.items.properties)).toEqual(expect.arrayContaining(['self_approve', 'expires']))
    const bad = { rules: [{ id: 'r', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'direct' }, self_approve: 'yes' }] }
    expect(validateEntry('governance', bad).filter(p => p.level === 'error').length).toBeGreaterThan(0)
  })
})

describe('an unmeetable `count` (spec §3.6, LOW-4)', () => {
  const SOLO = { maintainer: { members: ['ana'] }, member: { members: ['ana'] } }
  const PAIR = { maintainer: { members: ['ana', 'bruno'] }, member: { members: ['ana', 'bruno'] } }
  const two = (extra = {}, roles: Record<string, unknown> = PAIR) => gov({ decide: { by: 'maintainer', method: 'approve', count: 2 }, ...extra }, roles)
  it('warns when count equals the deciders and everyone who may propose is a decider (the author is always one)', () => {
    expect(warns(two()).join('\n')).toMatch(/rule "records": count 2 equals the 2 members of role "maintainer", and everyone who may propose is one of them, so four eyes can never be met; set self_approve, lower the count, or let someone outside the role propose/)
  })
  it('is silent when someone outside `by` may propose: the rule works for them', () => {
    expect(warns(two({}, { maintainer: { members: ['ana', 'bruno'] }, member: { all: true } }))).toEqual([])
  })
  it('is silent when the rule sets self_approve', () => {
    expect(warns(two({ self_approve: true }))).toEqual([])
  })
  it('is silent when count is below the deciders', () => {
    expect(warns(gov({ decide: { by: 'maintainer', method: 'approve', count: 1 } }, PAIR))).toEqual([])
  })
  it('count above the deciders is still an error, and says so', () => {
    expect(errors(two({ decide: { by: 'maintainer', method: 'approve', count: 3 } })).join('\n')).toMatch(/count is 3, and role "maintainer" has 2 members, so it can never be met/)
  })
  it('a solo maintainer with count 1 who is also the only proposer warns', () => {
    expect(warns(gov({ decide: { by: 'maintainer', method: 'approve', count: 1 } }, SOLO)).join('\n')).toMatch(/count 1 equals the 1 member/)
  })
  it('other methods are not asked: a vote whose quorum equals the deciders is fine', () => {
    expect(warns(gov({ decide: { by: 'maintainer', method: 'vote', window: 'P3D', quorum: 2, threshold: 0.5 } }, PAIR))).toEqual([])
  })
})

// Review MEDIUM-B: a window the proposal outlives is a rule that can only be met after it expired.
describe('window against expires', () => {
  const consent = (window: string, expires?: string) => gov({ decide: { by: 'maintainer', method: 'consent', window }, ...(expires ? { expires } : {}) })
  const vote = (window: string, expires?: string) => gov({ decide: { by: 'maintainer', method: 'vote', window, quorum: 2, threshold: 0.5 }, ...(expires ? { expires } : {}) })
  it.each([['consent', consent], ['vote', vote]])('%s: refuses a window longer than expires, in a sentence that names both', (_m, make) => {
    const msg = errors(make('P14D', 'P7D')).join('\n')
    expect(msg).toMatch(/window P14D ends after the rule's expires P7D/)
    expect(msg).toMatch(/shorten the window or lengthen expires/)
  })
  it.each([['consent', consent], ['vote', vote]])('%s: refuses a window equal to expires', (_m, make) => {
    expect(errors(make('P7D', 'P7D')).join('\n')).toMatch(/window P7D/)
  })
  it.each([['consent', consent], ['vote', vote]])('%s: with no expires, a window of 30 days or more outlasts the default of 30 days', (_m, make) => {
    expect(errors(make('P31D')).join('\n')).toMatch(/window P31D ends after the default expiry of 30 days/)
    expect(errors(make('P30D')).join('\n')).toMatch(/window P30D/)
    expect(errors(make('P29D'))).toEqual([])
  })
  it.each([['consent', consent], ['vote', vote]])('%s: accepts a window shorter than expires', (_m, make) => {
    expect(errors(make('P7D', 'P14D'))).toEqual([])
    expect(errors(make('P45D', 'P60D'))).toEqual([])
  })
  it('does not ask approve, direct or system for a window', () => {
    expect(errors(gov({ expires: 'P1D' }))).toEqual([])
  })
})
