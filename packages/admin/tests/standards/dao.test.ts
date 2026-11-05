import { describe, it, expect } from 'vitest'
import { projectPublic } from '../../lib/standards/project.mjs'
import { daoDoc, membersDoc, governanceMd, issuersDoc, GENERATOR_MARK_KEY, GENERATOR_MARK, hasGeneratorMark } from '../../lib/standards/dao.mjs'
import { buildStandards } from '../../lib/standards/index.mjs'
import { serializeFile } from '../../lib/standards/build.mjs'
import { describeRule } from '../../lib/rules.mjs'
import { validateStandards } from '../../lib/standards/validate.mjs'
import { fixtureInput, ORIGIN, A, CELO } from './fixtures.ts'
import { caip10 } from '../../lib/caip.mjs'

const pubOf = (over = {}, id: any = undefined) => {
  const input = fixtureInput(over)
  if (id) input.identity = { ...input.identity, ...id }
  return projectPublic(input).pub
}
const base = new Set(['dao.json', 'members.json', 'proposals.json', 'activities.json', 'governance.md', 'contracts.json'])

describe('daoDoc', () => {
  it('has exactly the base keys without pools or issuers', () => {
    const keys = new Set(Object.keys(daoDoc(pubOf(), base)))
    expect(keys).toEqual(new Set([
      '@context', 'type', 'name', 'description', 'membersURI', 'proposalsURI', 'activityLogURI', 'governanceURI',
      'contractsURI', 'meetingsURI', 'financesURI', 'x-org-os',
    ]))
  })
  it('adds grantPoolsURI and attestationIssuersURI only for present files; never projectsURI', () => {
    const d = daoDoc(pubOf(), new Set([...base, 'grant-pools.json', 'attestation-issuers.json']))
    expect(d.grantPoolsURI).toBe(`${ORIGIN}/.well-known/grant-pools.json`)
    expect(d.attestationIssuersURI).toBe(`${ORIGIN}/.well-known/attestation-issuers.json`)
    expect('projectsURI' in d).toBe(false)
    expect('grantPoolsURI' in daoDoc(pubOf(), base)).toBe(false)
  })
  it('governanceURI ends in /.well-known/governance.md', () => {
    expect(daoDoc(pubOf(), base).governanceURI).toMatch(/\/\.well-known\/governance\.md$/)
  })
  it('no description gives no description key; short_description wins', () => {
    expect('description' in daoDoc(pubOf({}, { description: undefined }), base)).toBe(false)
    expect(daoDoc(pubOf({}, { short_description: 'SHOWN-90 short' }), base).description).toBe('SHOWN-90 short')
  })
  it('PersonalNode is Person', () => {
    expect(daoDoc(pubOf({}, { type: 'PersonalNode' }), base).type).toBe('Person')
    expect(daoDoc(pubOf(), base).type).toBe('DAO')
  })
  it('passes validateStandards', () => {
    expect(validateStandards({ 'dao.json': daoDoc(pubOf(), new Set([...base, 'grant-pools.json'])) })).toEqual([])
  })
})

describe('daoDoc: the generator\'s mark (L8-C18)', () => {
  it('carries x-org-os with the fixed generator name: no version, no date, no path', () => {
    expect(GENERATOR_MARK_KEY).toBe('x-org-os')
    const d = daoDoc(pubOf(), base)
    expect(d['x-org-os']).toEqual({ generator: 'org-os standards (L8)' })
    expect(d['x-org-os']).toEqual(GENERATOR_MARK)
    expect(hasGeneratorMark(d)).toBe(true)
  })
  it('the dao.json schema accepts it, and the leak scan finds nothing in it', () => {
    const out = buildStandards(fixtureInput())
    expect(out.files['dao.json']).toHaveProperty(['x-org-os', 'generator'], 'org-os standards (L8)')
    expect(validateStandards({ 'dao.json': out.files['dao.json'] })).toEqual([])
    expect(out.problems.filter(p => p.file === 'dao.json' && p.level === 'error')).toEqual([])
    expect(out.problems.filter(p => /withheld value/.test(p.text))).toEqual([])
  })
  it('the git copy stays byte-deterministic', () => {
    const a = serializeFile('dao.json', buildStandards(fixtureInput()).files['dao.json'])
    const b = serializeFile('dao.json', buildStandards(fixtureInput()).files['dao.json'])
    expect(a).toBe(b)
    expect(a).toContain('"x-org-os": {\n    "generator": "org-os standards (L8)"\n  }')
  })
  it('hasGeneratorMark: only an object under the key with a generator name; a 0.6 dao.json has none', () => {
    expect(hasGeneratorMark({ '@context': 'http://www.daostar.org/schemas', type: 'DAO', name: 'Test DAO' })).toBe(false)
    expect(hasGeneratorMark({ 'x-org-os': 'org-os standards (L8)' })).toBe(false)
    expect(hasGeneratorMark({ 'x-org-os': { generator: '' } })).toBe(false)
    expect(hasGeneratorMark(null)).toBe(false)
    expect(hasGeneratorMark([])).toBe(false)
    expect(hasGeneratorMark({ 'x-org-os': { generator: 'org-os standards (L8)' } })).toBe(true)
  })
  it("a withheld value equal to a word of the mark is no secret: the scan would find the builder's word", () => {
    const input = fixtureInput()
    Object.assign((input.records.members as Record<string, unknown>[])[1]!, { a: 'org-os', b: 'standards', c: 'generator', d: 'x-org-os' })
    const { secrets } = projectPublic(input)
    for (const w of ['org-os', 'standards', 'generator', 'x-org-os']) expect(secrets.has(w), w).toBe(false)
  })
})

describe('membersDoc', () => {
  it('lists steward-a only, as { id } entries', () => {
    const doc = membersDoc(pubOf())
    expect(doc.members).toEqual([{ id: `${ORIGIN}/members/steward-a` }])
    expect(validateStandards({ 'members.json': doc })).toEqual([])
  })
  it('leaves out a member whose status or kind a field rule withholds: absent from the view is not active or person (M3)', () => {
    for (const field of ['status', 'kind']) {
      const input = fixtureInput()
      input.records.members.push({ id: 'former-d', name: 'SHOWN-92 Former', kind: 'person', status: 'alumni' })
      ;(input.policy.collections.members as { fields: Record<string, string> }).fields[field] = 'members'
      const pub = projectPublic(input).pub
      expect(pub.members.some(m => m.id.endsWith('/former-d')), field).toBe(true)   // public record, in pub
      expect(JSON.stringify(membersDoc(pub)), field).not.toContain('former-d')
      expect(JSON.stringify(membersDoc(pub)), field).not.toContain('steward-a')    // a withheld status on any record
    }
  })
  it('a member with no status or kind at all still reads as an active person', () => {
    const input = fixtureInput()
    input.records.members.push({ id: 'plain-e', name: 'SHOWN-93 Plain' })
    expect(JSON.stringify(membersDoc(projectPublic(input).pub))).toContain('plain-e')
  })
  it('leaves out an alumni public member', () => {
    const input = fixtureInput()
    input.records.members.push({ id: 'alum-d', name: 'SHOWN-91 Alum', kind: 'person', status: 'alumni' })
    expect(JSON.stringify(membersDoc(projectPublic(input).pub))).not.toContain('alum-d')
  })
})

describe('governanceMd', () => {
  it('has the heading, the prose, one line per rule from describeRule', () => {
    const pub = pubOf()
    const md = governanceMd(pub)
    expect(md.startsWith('# How Test DAO decides\n')).toBe(true)
    expect(md).toContain('SHOWN-20 How Test DAO decides')
    for (const rule of pub.governance!.rules) expect(md).toContain(describeRule(rule as any))
    expect(md.split('\n').filter(l => l.startsWith('- ')).length).toBe(2)
  })
  it('says it is not public otherwise', () => {
    const input = fixtureInput()
    input.policy.collections.governance = { default: 'members', fields: {} }
    expect(governanceMd(projectPublic(input).pub)).toBe('How Test DAO decides is not public.\n')
  })
})

describe('issuersDoc', () => {
  it('types two issuers', () => {
    const input = fixtureInput()
    input.identity.attestationIssuers = [
      { name: 'SHOWN-2 B', issuer: caip10(CELO, A.a5) }, { name: 'SHOWN-3 A', issuer: caip10(CELO, A.a4) },
    ]
    const doc = issuersDoc(projectPublic(input).pub)!
    expect((doc.attestationIssuers as any[]).every(i => i.type === 'AttestationIssuer')).toBe(true)
    expect((doc.attestationIssuers as any[]).length).toBe(2)
    expect(validateStandards({ 'attestation-issuers.json': doc })).toEqual([])
  })
  it('is null when none are named', () => {
    const input = fixtureInput()
    delete input.identity.attestationIssuers
    expect(issuersDoc(projectPublic(input).pub)).toBeNull()
  })
})
