import { describe, it, expect, afterEach } from 'vitest'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, CONSENSUS } from '../changes/fixtures.ts'
import { NO_MODEL } from '../../lib/governance-read.mjs'
import { effectiveRule, ruleIds, readRuleContext, SOLO_RULE, SOLO_DEFAULT, type RuleContext } from '../../server/governance/effective.ts'

const person = { id: 'steward-a', name: 'Steward A', kind: 'person' }
const bot = { id: 'bot', name: 'Bot', kind: 'agent' }
const ctx = (over: Partial<RuleContext> = {}): RuleContext =>
  ({ org: 'Example Coop', governance: { model: 'solo-maintainer' }, shape: 'wrapped', problems: [], modelImplied: false, actor: person, ...over })
/** What F1's readGovernance answers for a missing file, and for a file that names no model. */
const MISSING = { governance: { model: 'solo-maintainer' }, shape: 'missing', problems: [NO_MODEL], modelImplied: true }
const NO_MODEL_NAMED = { governance: { decisions: [], model: 'solo-maintainer' }, shape: 'wrapped', problems: [NO_MODEL], modelImplied: true }

describe('the effective rule in P1: the solo default, and nothing else direct', () => {
  it('solo-maintainer with no rules: a person member decides alone', () => {
    expect(effectiveRule(ctx(), ['records'])).toEqual(SOLO_RULE)
    expect(SOLO_RULE).toEqual({ direct: true, sentence: 'the maintainer decides alone', source: 'implied by model: solo-maintainer' })
  })
  it('any other model is not direct, and the sentence names the org and the model', () => {
    expect(effectiveRule(ctx({ governance: { model: 'consensus' } }), ['records'])).toEqual({
      direct: false, proposable: false, source: 'model: consensus',
      sentence: 'Example Coop decides changes by consensus, and data/governance.yaml writes no rule for it, so nothing can be proposed until a rule is written.',
    })
    expect(effectiveRule(ctx({ governance: { model: 'steward-council' } }), []).sentence).toMatch(/^Example Coop decides changes by steward council,/)
  })
  it('a written rule that names no way of deciding is not direct (F2 reads rules; this one asks for nothing it can read)', () => {
    const r = effectiveRule(ctx({ governance: { model: 'solo-maintainer', rules: [{ id: 'records', applies_to: ['records'] }] } }), ['records'])
    expect(r).toMatchObject({ direct: false, source: 'data/governance.yaml rules: records' })
  })
  it('a member that is not a person does not decide under solo-maintainer', () => {
    expect(effectiveRule(ctx({ actor: bot }), []))
      .toMatchObject({ direct: false, sentence: 'Bot is a member of kind agent, and under solo-maintainer only a person decides; so this change stays staged.' })
  })
  it('an unknown actor only reads', () => {
    expect(effectiveRule(ctx({ actor: { unknown: 'x@y' } }), []))
      .toEqual({ direct: false, proposable: false, source: 'data/members.yaml', sentence: 'Read-only: your git email `x@y` matches no member in `data/members.yaml`.' })
  })
  it('an actor with no git email only reads, and the sentence says so', () => {
    expect(effectiveRule(ctx({ actor: { unknown: '' } }), []))
      .toMatchObject({ direct: false, sentence: expect.stringMatching(/^Read-only: git has no user\.email/) })
  })
  it('no governance file, or one that names no model (modelImplied): the solo default, sourced from NO_MODEL', () => {
    expect(SOLO_DEFAULT).toEqual({ direct: true, sentence: 'the maintainer decides alone', source: NO_MODEL })
    expect(effectiveRule(ctx(MISSING), ['records'])).toEqual(SOLO_DEFAULT)
    expect(effectiveRule(ctx(NO_MODEL_NAMED), ['records'])).toEqual(SOLO_DEFAULT)
    expect(effectiveRule(ctx({ ...MISSING, actor: bot }), []).direct).toBe(false)
  })
  it('a model that is named is never the default, even when it is solo-maintainer', () => {
    expect(effectiveRule(ctx({ modelImplied: false }), [])).toEqual(SOLO_RULE)
  })
  it('a governance file that cannot be read is not direct', () => {
    expect(effectiveRule(ctx({ governance: null, shape: 'multi-document', problems: ['several documents'] }), []).sentence)
      .toBe("Example Coop's data/governance.yaml cannot be read (several documents), so this change stays staged.")
  })
})

const MEMBERS = [person, { id: 'ana', name: 'Ana', kind: 'person' }, bot]
const RULES = {
  model: 'consensus',
  roles: { maintainer: { members: ['steward-a'] }, member: { all: true } },
  rules: [
    { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'direct' } },
    { id: 'people', applies_to: ['members'], propose: 'maintainer', decide: { by: 'maintainer', method: 'approve', count: 1 } },
  ],
}
const withRules = (over: Partial<RuleContext> = {}) => ctx({ governance: RULES, members: MEMBERS, ...over })

describe('written rules (F2, and Propose of P2): not direct, and whether it can be proposed', () => {
  it('a not-direct summary carries proposable, and no summary says proposals arrive later', () => {
    const ana = { id: 'ana', name: 'Ana', kind: 'person' }
    const all = [
      effectiveRule(withRules({ actor: ana }), ['records']), effectiveRule(withRules(), ['members']),
      effectiveRule(withRules(), ['treasury']), effectiveRule(withRules({ actor: bot }), ['records']),
      effectiveRule(ctx({ governance: { model: 'consensus' } }), ['records']), effectiveRule(withRules({ actor: { unknown: 'x@y' } }), []),
    ]
    expect(all.map(r => r.proposable)).toEqual([true, true, false, false, false, false])
    for (const r of all) expect(r.sentence).not.toMatch(/arrive/i)
  })
  it('an agent a role lists may propose where a human decides; the summary says so', () => {
    const roles = { maintainer: { members: ['steward-a'] }, member: { members: ['bot'] } }
    expect(effectiveRule(withRules({ governance: { ...RULES, roles }, actor: bot }), ['records']))
      .toMatchObject({ direct: false, proposable: true, sentence: expect.stringMatching(/"bot" is an agent, and an agent never decides.*Propose it instead/) })
  })
  it('a direct summary does not carry it', () => {
    expect('proposable' in effectiveRule(withRules(), ['records'])).toBe(false)
  })
  it('a class whose rule is direct, for an actor who holds both roles, applies directly; the source names the rule', () => {
    expect(effectiveRule(withRules(), ['records'])).toEqual({ direct: true, source: 'data/governance.yaml rules: records', sentence: 'the maintainer decides alone' })
  })
  it('the same rule is not direct for a member who may propose but not decide', () => {
    expect(effectiveRule(withRules({ actor: { id: 'ana', name: 'Ana', kind: 'person' } }), ['records'])).toEqual({
      direct: false, proposable: true, source: 'data/governance.yaml rules: records',
      sentence: '"ana" does not hold the maintainer role, which rule "records" asks of whoever decides. Propose it instead.',
    })
  })
  it('a class decided by approval says what it needs, and stays staged', () => {
    expect(effectiveRule(withRules(), ['members'])).toEqual({
      direct: false, proposable: true, source: 'data/governance.yaml rules: people',
      sentence: 'rule "people" needs 1 approval from the maintainer, so it cannot be applied alone. Propose it instead.',
    })
  })
  it('a change is direct only if every class it touches is', () => {
    expect(effectiveRule(withRules(), ['records', 'members']).direct).toBe(false)
    expect(effectiveRule(withRules(), ['records', 'records']).direct).toBe(true)
  })
  it('a class no rule covers cannot be proposed, in words', () => {
    expect(effectiveRule(withRules(), ['treasury'])).toEqual({
      direct: false, proposable: false, source: 'data/governance.yaml rules',
      sentence: 'No rule in data/governance.yaml covers the class treasury; nobody can propose it until a rule does.',
    })
  })
  it('an agent never applies, even if a direct rule lists it', () => {
    const roles = { maintainer: { members: ['bot'] }, member: { all: true } }
    expect(effectiveRule(withRules({ governance: { ...RULES, roles }, actor: bot }), ['records']))
      .toMatchObject({ direct: false, proposable: false, sentence: expect.stringMatching(/"bot" does not hold the member role/) })
  })
  it('written rules with no class to judge (the unknown-actor refusal asks this) are not direct', () => {
    expect(effectiveRule(withRules(), [])).toMatchObject({ direct: false, source: 'data/governance.yaml rules' })
  })
  it('a rule that is wrong on its face (a role nobody defined) is not direct', () => {
    const g = { ...RULES, rules: [{ ...RULES.rules[0], decide: { by: 'steward', method: 'direct' } }] }
    expect(effectiveRule(withRules({ governance: g }), ['records']).direct).toBe(false)
  })
  it('without the members file the actor stands alone: solo rules still work, role-based ones do not', () => {
    expect(effectiveRule(ctx({ governance: { model: 'solo-maintainer' }, members: undefined }), ['records']).direct).toBe(true)
    expect(effectiveRule(withRules({ members: undefined, actor: { id: 'ana', name: 'Ana', kind: 'person' } }), ['records']).direct).toBe(false)
  })
  it('a solo model that wrote a direct rule only for some classes: those classes apply, the rest stay staged', () => {
    const g = { model: 'solo-maintainer', roles: RULES.roles, rules: [RULES.rules[0]] }
    expect(effectiveRule(withRules({ governance: g }), ['records']).direct).toBe(true)
    expect(effectiveRule(withRules({ governance: g }), ['members']).direct).toBe(false)
  })
})

describe('readRuleContext', () => {
  let repo: string
  afterEach(() => removeFixtureRepo(repo))
  it('reads the org name and the governance file', () => {
    repo = makeChangeRepo(CONSENSUS)
    const c = readRuleContext(repo, person)
    expect(c.org).toBe('Fixture Org')
    expect(c.governance).toMatchObject({ model: 'consensus' })
    expect(c.modelImplied).toBe(false)
    expect(effectiveRule(c, ['records']).sentence).toBe('Fixture Org decides changes by consensus, and data/governance.yaml writes no rule for it, so nothing can be proposed until a rule is written.')
  })
  it('reads the members file, so that roles can be resolved', () => {
    repo = makeChangeRepo(CONSENSUS)
    expect(readRuleContext(repo, person).members?.map(m => m.id)).toEqual(['steward-a', 'ana'])
  })
  it('a governance file of several documents is not read, and nothing is direct', () => {
    repo = makeChangeRepo('governance:\n  model: solo-maintainer\n---\nnotes: x\n')
    const c = readRuleContext(repo, person)
    expect(c.shape).toBe('multi-document')
    expect(effectiveRule(c, ['records'])).toMatchObject({ direct: false, sentence: expect.stringMatching(/cannot be read/) })
  })
  it("no governance file: the solo default, and F1's reader names the problem", () => {
    repo = makeChangeRepo(null)
    const c = readRuleContext(repo, person)
    expect(c.shape).toBe('missing')
    expect(c.modelImplied).toBe(true)
    expect(c.problems).toContain(NO_MODEL)
    expect(effectiveRule(c, ['records'])).toEqual(SOLO_DEFAULT)
  })
  it('a governance file that names no model: the solo default', () => {
    repo = makeChangeRepo('schema_version: "2.0"\ngovernance:\n  decisions: []\n')
    expect(effectiveRule(readRuleContext(repo, person), ['records'])).toEqual(SOLO_DEFAULT)
  })
})

describe('ruleIds: the rule ids a change is judged by (P2-R14, the Org-Rule trailer)', () => {
  it('the solo default is the rule "solo", once, however many classes', () => {
    expect(ruleIds(ctx(), ['records'])).toEqual(['solo'])
    expect(ruleIds(ctx(), ['records', 'members'])).toEqual(['solo'])
    expect(ruleIds(ctx({ ...MISSING }), ['records'])).toEqual(['solo'])
  })
  it('written rules: one id per rule that covers a class, in class order, each once', () => {
    expect(ruleIds(withRules(), ['records'])).toEqual(['records'])
    expect(ruleIds(withRules(), ['members', 'records'])).toEqual(['people', 'records'])
    const one = { ...RULES, rules: [{ id: 'all-of-it', applies_to: ['all'], propose: 'maintainer', decide: { by: 'maintainer', method: 'direct' } }] }
    expect(ruleIds(ctx({ governance: one, members: MEMBERS }), ['records', 'members'])).toEqual(['all-of-it'])
  })
  it('a class no rule covers adds no id', () => {
    expect(ruleIds(withRules(), ['identity'])).toEqual([])
  })
})
