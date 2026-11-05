// loadStandardsInput (lane L8, Task 12): an instance's records as the builder's input. Each test writes a fresh
// temporary directory (no git: nothing here needs a repository).
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { parse } from 'yaml'
import { loadStandardsInput } from '../../lib/standards/load.mjs'
import { buildStandards } from '../../lib/standards/index.mjs'
import { projectPublic } from '../../lib/standards/project.mjs'

const SAFE = '0x0000000000000000000000000000000000005afe'
const POOL = '0x000000000000000000000000000000000000b001'
const REG = '0x00000000000000000000000000000000000000a9'
const MOVE = 'move these to data/systems.yaml (the 0.6 migration does: node scripts/migrations/v0.5-to-v0.6-canonical-records.mjs --dry, then the same without --dry)'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** A fresh instance directory holding `files` (path → text). */
function instance(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'l8-load-'))
  dirs.push(root)
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(rel)), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  return root
}
const FEDERATION = (extra = '') => `identity:
  name: "Test DAO"
  type: "DAO"
  short_description: "A placeholder organisation for tests."
  daoURI: "https://dao.example.org/.well-known/dao.json"
${extra}`
const load = (root: string) => loadStandardsInput(root, { parseYaml: parse })
const systemsOf = (r: ReturnType<typeof load>) => r.input!.records.systems as Record<string, unknown>[]
const warns = (r: ReturnType<typeof load>) => r.problems.filter(p => p.level === 'warn').map(p => `${p.file}: ${p.text}`)

describe('loadStandardsInput: identity', () => {
  it('no daoURI: no input, and a problem says why', () => {
    for (const fed of ['identity:\n  name: "Test DAO"\n  type: "DAO"\n', 'identity:\n  name: "Test DAO"\n  daoURI: ""\n']) {
      const r = load(instance({ 'federation.yaml': fed, 'data/members.yaml': 'members:\n  - id: steward-a\n' }))
      expect(r.input).toBeNull()
      expect(r.problems.map(p => p.text).join('\n')).toMatch(/identity\.daoURI is not set/)
    }
  })

  it('no federation.yaml: no input', () => {
    expect(load(instance({})).input).toBeNull()
  })

  it('reads name, type, descriptions, daoURI and attestation issuers; the git copy has no reads', () => {
    const r = load(instance({ 'federation.yaml': FEDERATION(`  description: "Legacy sentence."
  safe: ""
  attestation_issuers:
    - name: "Test issuer"
      issuer: "eip155:42220:0x00000000000000000000000000000000000000a5"
`) }))
    expect(r.input!.identity).toEqual({
      name: 'Test DAO', type: 'DAO', short_description: 'A placeholder organisation for tests.', description: 'Legacy sentence.',
      daoURI: 'https://dao.example.org/.well-known/dao.json',
      attestationIssuers: [{ name: 'Test issuer', issuer: 'eip155:42220:0x00000000000000000000000000000000000000a5' }],
    })
    expect(r.input!.reads).toBeNull()
  })
})

describe('loadStandardsInput: attestation issuers', () => {
  it('an issuer without a name or an issuer string is dropped, with a warning naming its place', () => {
    const r = load(instance({ 'federation.yaml': FEDERATION(`  attestation_issuers:
    - name: "Test issuer"
      issuer: "eip155:42220:0x00000000000000000000000000000000000000a5"
    - name: "No issuer"
    - name: ""
      issuer: "eip155:42220:0x00000000000000000000000000000000000000a6"
    - "just text"
    - name: "Numeric issuer"
      issuer: 12
`) }))
    expect(r.input!.identity.attestationIssuers).toEqual([{ name: 'Test issuer', issuer: 'eip155:42220:0x00000000000000000000000000000000000000a5' }])
    expect(warns(r)).toEqual([2, 3, 4, 5].map(n => `federation.yaml: identity.attestation_issuers #${n} has no name or no issuer; not published`))
  })
})

describe('loadStandardsInput: registries', () => {
  it('reads each registry by its top key or an alias (`opportunities` for funding-opportunities)', () => {
    const r = load(instance({
      'federation.yaml': FEDERATION(),
      'data/funding-opportunities.yaml': 'schema_version: "1.0"\nopportunities:\n  - id: grant-one\n    name: "Grant one"\n',
      'data/members.yaml': 'members:\n  - id: steward-a\n    joined: 2024-01-15\n',
    }))
    expect((r.input!.records as Record<string, unknown>)['funding-opportunities']).toEqual([{ id: 'grant-one', name: 'Grant one' }])
    expect(r.input!.records.members).toEqual([{ id: 'steward-a', joined: '2024-01-15' }])   // a date stays a string
  })

  it('a missing file: an empty collection, no document, a policy with nothing public', () => {
    const r = load(instance({ 'federation.yaml': FEDERATION() }))
    expect(r.input!.records.members).toEqual([])
    expect(r.input!.records.systems).toEqual([])
    expect(r.input!.records).not.toHaveProperty('governance')
    expect(r.input!.policy).toEqual({ collections: {}, defaults: {} })
    expect(r.problems).toEqual([])
  })

  it('a file that is not YAML is read as missing, with a warning naming it', () => {
    const r = load(instance({ 'federation.yaml': FEDERATION(), 'data/members.yaml': 'members:\n  - id: [unclosed\n' }))
    expect(r.input!.records.members).toEqual([])
    expect(warns(r).join('\n')).toMatch(/^data\/members\.yaml: cannot be read/m)
  })

  it('data/visibility.yaml is the policy, its top key unwrapped, parsed (I4)', () => {
    const r = load(instance({ 'federation.yaml': FEDERATION(), 'data/visibility.yaml': 'visibility:\n  collections:\n    systems: { default: public }\n' }))
    expect(r.input!.policy).toEqual({ collections: { systems: { default: 'public', fields: {} } }, defaults: {} })
  })

  it('the R1 synonym `level` is parsed, and a policy problem is the loader\'s warn (I4)', () => {
    const r = load(instance({
      'federation.yaml': FEDERATION(),
      'data/visibility.yaml': 'collections:\n  systems: { level: public }\n  meetings: { default: pub }\n',
    }))
    expect(r.input!.policy).toEqual({
      collections: { systems: { default: 'public', fields: {} }, meetings: { default: 'members', fields: {} } }, defaults: {},
    })
    expect(r.problems.filter(p => p.file === 'data/visibility.yaml')).toHaveLength(1)
    // projectPublic reads the parsed policy again without a second warn (readPolicy is idempotent)
    expect(projectPublic(r.input!).problems.filter(p => p.file === 'data/visibility.yaml')).toEqual([])
  })

  it('documents: wrapped or flat (finances and governance as instances write them); knowledge kept whole', () => {
    const r = load(instance({
      'federation.yaml': FEDERATION(),
      'data/finances.yaml': 'schema_version: "2.0"\nbudgets:\n  - id: b1\nexpenses: []\n',
      'data/governance.yaml': 'schema_version: "2.0"\nmodel: consensus\ndecisions:\n  - id: gov-1\n    date: 2026-01-10\n',
      'data/knowledge-manifest.yaml': 'schema_version: "2.0"\nknowledge_manifest:\n  domains:\n    - id: d1\n',
    }))
    expect(r.input!.records.finances).toEqual({ budgets: [{ id: 'b1' }], expenses: [] })
    expect(r.input!.records.governance).toEqual({ model: 'consensus', decisions: [{ id: 'gov-1', date: '2026-01-10' }] })
    expect(r.input!.records['knowledge-manifest']).toEqual({ domains: [{ id: 'd1' }] })
  })
})

describe('loadStandardsInput: Markdown records', () => {
  it('content/meetings and content/projects: front matter fields and the body; data/*.yaml entries first', () => {
    const r = load(instance({
      'federation.yaml': FEDERATION(),
      'data/meetings.yaml': 'meetings:\n  - id: meeting-yaml\n    date: "2026-10-01"\n',
      'content/meetings/2026-10-02.md': '---\nid: meeting-md\ndate: 2026-10-02\nvisibility: public\n---\n## Decisions\n\n- [ ] Adopt it\n',
      'content/meetings/no-id.md': '---\ntitle: "No id"\n---\nbody\n',
      'content/meetings/no-front-matter.md': '# Just text\n',
      'content/projects/p.md': '---\r\nid: project-md\r\nname: "Project"\r\n---\r\nText\r\n',
    }))
    expect(r.input!.records.meetings).toEqual([
      { id: 'meeting-yaml', date: '2026-10-01' },
      { id: 'meeting-md', date: '2026-10-02', visibility: 'public', body: '## Decisions\n\n- [ ] Adopt it\n' },
    ])
    expect(r.input!.records.projects).toEqual([{ id: 'project-md', name: 'Project', body: 'Text\r\n' }])
    expect(warns(r)).toEqual([
      'content/meetings/no-front-matter.md: has no front matter with an id; not read',
      'content/meetings/no-id.md: has no front matter with an id; not read',
    ])
  })
})

describe('loadStandardsInput: 0.6 contract fallbacks (spec §5.5)', () => {
  it('with an on-chain System in data/systems.yaml, nothing else is read and nothing is said', () => {
    const r = load(instance({
      'federation.yaml': FEDERATION(`  chain: "eip155:42220"\n  safe: "${SAFE}"\n`),
      'data/systems.yaml': `systems:\n  - id: treasury\n    kind: safe\n    name: Treasury\n    chain: "eip155:42220"\n    address: "${POOL}"\n`,
    }))
    expect(systemsOf(r).map(s => s.id)).toEqual(['treasury'])
    expect(r.problems).toEqual([])
  })

  it("without one, federation.yaml identity's safe and gardens, public as identity, with 0.6's warning", () => {
    const r = load(instance({
      'federation.yaml': FEDERATION(`  chain: "eip155:42220"\n  safe: "${SAFE}"\n  gardens: "${POOL}"\n`),
      'data/systems.yaml': 'systems:\n  - id: drive\n    kind: docs\n    name: Drive\n    url: "https://drive.example/x"\n',
    }))
    expect(systemsOf(r).slice(1)).toEqual([
      { id: 'treasury-safe', kind: 'safe', name: 'Treasury', chain: 'eip155:42220', address: SAFE, visibility: 'public' },
      { id: 'gardens-pool', kind: 'gardens-pool', name: 'Gardens pool', chain: 'eip155:42220', address: POOL, visibility: 'public' },
    ])
    expect(warns(r)).toEqual([`contracts.json: read from federation.yaml identity — ${MOVE}`])
  })

  it('then governance.yaml infrastructure, with its own chain, at the governance level, and its warning', () => {
    const files = {
      'federation.yaml': FEDERATION(),
      'data/governance.yaml': `governance:\n  model: consensus\n  infrastructure:\n    safe: "${SAFE}"\n    chain: "eip155:100"\n`,
    }
    const members = load(instance(files))
    expect(systemsOf(members)).toEqual([{ id: 'treasury-safe', kind: 'safe', name: 'Treasury', chain: 'eip155:100', address: SAFE, visibility: 'members' }])
    expect(warns(members)).toEqual([`contracts.json: read from data/governance.yaml infrastructure — ${MOVE}`])
    const pub = load(instance({ ...files, 'data/visibility.yaml': 'visibility:\n  collections:\n    governance: { default: public }\n' }))
    expect(systemsOf(pub)[0]!.visibility).toBe('public')
  })

  it('an unquoted address (a number to YAML) is skipped, with a warning naming where it was', () => {
    const r = load(instance({ 'federation.yaml': FEDERATION('  chain: "eip155:42220"\n  safe: 0x1111111111111111111111111111111111111111\n') }))
    expect(systemsOf(r)).toEqual([])
    expect(warns(r)).toEqual(['contracts.json: federation.yaml identity.safe is not a string (write it in quotes); skipped'])
  })

  it('an unquoted address in governance.yaml infrastructure is skipped, with a warning naming it', () => {
    const r = load(instance({
      'federation.yaml': FEDERATION(),
      'data/governance.yaml': 'governance:\n  model: consensus\n  infrastructure:\n    safe: 0x1111111111111111111111111111111111111111\n    chain: "eip155:42220"\n',
    }))
    expect(systemsOf(r)).toEqual([])
    expect(warns(r)).toEqual(['contracts.json: data/governance.yaml infrastructure.safe is not a string (write it in quotes); skipped'])
  })

  it('identity.onchain_registration is read as a registration System, public, with a warning', () => {
    const r = load(instance({ 'federation.yaml': FEDERATION(`  chain: "eip155:42220"\n  onchain_registration:\n    enabled: true\n    chain: "eip155:10"\n    contract_address: "${REG}"\n`) }))
    expect(systemsOf(r)).toEqual([{ id: 'daouri-registration', kind: 'daouri-registration', chain: 'eip155:10', address: REG, visibility: 'public' }])
    expect(warns(r).join('\n')).toMatch(/^contracts\.json: the registration contract is read from federation\.yaml identity\.onchain_registration — move it to data\/systems\.yaml/m)
  })

  it('not when data/systems.yaml has a registration System, nor when it is disabled or empty', () => {
    const sys = `systems:\n  - id: reg\n    kind: daouri-registration\n    chain: "eip155:10"\n    address: "${REG}"\n`
    const reg = (enabled: string, address: string) => `  onchain_registration:\n    enabled: ${enabled}\n    contract_address: "${address}"\n`
    expect(systemsOf(load(instance({ 'federation.yaml': FEDERATION(reg('true', REG)), 'data/systems.yaml': sys }))).map(s => s.id)).toEqual(['reg'])
    expect(systemsOf(load(instance({ 'federation.yaml': FEDERATION(reg('false', REG)) })))).toEqual([])
    expect(systemsOf(load(instance({ 'federation.yaml': FEDERATION(reg('true', '')) })))).toEqual([])
  })
})

describe('loadStandardsInput → buildStandards', () => {
  it("an instance's records build with no error, and members-level records stay out", () => {
    const r = load(instance({
      'federation.yaml': FEDERATION(),
      'data/visibility.yaml': 'visibility:\n  collections:\n    systems: { default: public }\n    governance: { default: public }\n',
      'data/systems.yaml': `systems:\n  - id: treasury\n    kind: safe\n    name: Treasury\n    chain: "eip155:42220"\n    address: "${SAFE}"\n`,
      'data/governance.yaml': 'governance:\n  model: consensus\n  description: "By consent."\n  decisions:\n    - id: gov-1\n      title: "Adopt the charter"\n      status: approved\n      date: 2026-01-10\n',
      'data/members.yaml': 'members:\n  - id: steward-a\n    name: "Hidden Name"\n',
    }))
    const out = buildStandards(r.input!)
    expect(out.problems.filter(p => p.level === 'error')).toEqual([])
    expect((out.files['contracts.json'] as { contracts: unknown[] }).contracts).toHaveLength(1)
    expect((out.files['proposals.json'] as { proposals: { name: string }[] }).proposals.map(p => p.name)).toEqual(['Adopt the charter'])
    expect(JSON.stringify(out.files)).not.toContain('Hidden Name')
  })
})
