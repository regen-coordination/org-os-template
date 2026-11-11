/** DAO-OS L6 Task 10 (spec §7.5, §13, Q69): knowledge in the Hub, and publishing it as a governed decision. The canon is a
 *  collection, `knowledge`, read from data/kb/<type>.yaml (ids `<type>/<slug>`); a canon edit is a record op on it, staged,
 *  proposed and ratified like any record op; and whether an edit publishes is one predicate, `publishes`, judged by the
 *  commons' floor (maturity and public use), whoever writes: the tray, the entry page, the ratify. Every test builds a fresh
 *  temporary instance (the kms fixture as its own git repository); members and rules are placeholders. */
import { execSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Hono } from 'hono'
import { parse } from 'yaml'
import { PUBLISHABLE_PUBLIC_USE as FRAMEWORK_LIST } from '../../../toolkit-framework/src/publishable.mjs'
import { PUBLISHABLE_PUBLIC_USE, becomesPublishable, floorPublishable } from '../../lib/workspace/publishable.mjs'
import { publishes } from '../../lib/change-classes.mjs'
import { registriesOf, registryFile } from '../../server/registries.ts'
import { classesOf, currentEntries, targetsOf } from '../../server/changes/stage.ts'
import { effectiveRule, readRuleContext } from '../../server/governance/effective.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { prepareEdit } from '../../server/knowledge/write.ts'
import { parseTrailers } from '../../lib/trailers.mjs'
import { joinPage } from '../../lib/workspace/pages.mjs'
import { FIXTURE_NOW, makeKmsInstance, type FixtureInstance } from '../server/knowledge/fixture.ts'

const VALIDATOR = fileURLToPath(new URL('../../../../scripts/validate-governance.mjs', import.meta.url))
let instance: FixtureInstance | null = null
afterEach(() => { instance?.cleanup(); instance = null })

const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["steward-a@example.test"] } }
  - { id: steward-b, name: Steward B, kind: person, handles: { git: ["steward-b@example.test"] } }
  - { id: agent-a, name: Agent A, kind: agent, handles: { git: ["agent-a@example.test"] } }
`
/** Pilot-shaped: one consent rule for everything, and governance decided by the council's approval. */
const PILOT = `schema_version: "2.0"
governance:
  model: consensus
  roles:
    council: { members: [steward-a, steward-b] }
    member: { all: true }
  rules:
    - { id: governance, applies_to: [governance], propose: member, decide: { by: council, method: approve, count: 2 } }
    - { id: consent, applies_to: [all], propose: member, decide: { by: council, method: consent, window: P7D } }
  decisions: []
`
/** The workspace is direct (no rule names it); a publication needs the maintainer's approval. */
const PUBLISHING = `schema_version: "2.0"
governance:
  model: consensus
  roles:
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: publishing, applies_to: [publication], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
/** A canon file kept by hand: its comments and spacing must survive every write. */
const HAND_KEPT = `# Claims, kept by hand.
schema_version: "1.0"
entries:
  seed-swap-notes:
    title: Seed swap notes   # the swap's own words
    type: claim-evidence
    id: id-seed-swap-notes
    maturity: raw
    public_use: not-public-yet
    claim: Swaps raise local variety.
    updated: 2026-10-25

  held-claim:
    title: A held claim
    type: claim-evidence
    id: id-held-claim
    maturity: held
    public_use: ok-with-caveat
`
const SEED = 'knowledge:claim-evidence/seed-swap-notes'
const PUBLISH = { public_use: 'reviewed-for-guidance', maturity: 'reviewed' }

/** The kms fixture as a git repository with the members, a governance file (none: the solo default) and a hand-kept claims
 *  file; git's identity is `who`. */
function world(governance: string | null, who = 'steward-a'): string {
  instance = makeKmsInstance()
  const dir = instance.dir
  const git = (cmd: string) => execSync(`git -C "${dir}" ${cmd}`, { stdio: 'pipe' }).toString()
  git('init -q -b main')
  git(`config user.email ${who}@example.test`)
  git('config user.name Test')
  writeFileSync(join(dir, 'data/members.yaml'), MEMBERS)
  if (governance !== null) writeFileSync(join(dir, 'data/governance.yaml'), governance)
  writeFileSync(join(dir, 'data/kb/claim-evidence.yaml'), HAND_KEPT)
  git('add -A')
  git('commit -qm "fixture: the canon, the members and the rules"')
  return dir
}
const git = (dir: string, cmd: string) => execSync(`git -C "${dir}" ${cmd}`, { stdio: 'pipe' }).toString()
const as = (dir: string, who: string) => git(dir, `config user.email ${who}@example.test`)
const json = (method: string, body?: unknown) => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), headers: { 'content-type': 'application/json' } })
async function call(app: Hono, path: string, init?: RequestInit): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await app.request(path, init)
  const text = await res.text()
  return { status: res.status, body: text === '' ? null : JSON.parse(text) }
}

describe('the floor the house judges by (L6 §13)', () => {
  it('the list equals toolkit-framework\'s', () => {
    expect([...PUBLISHABLE_PUBLIC_USE]).toEqual([...FRAMEWORK_LIST])
  })

  it('is maturity and public use: held is refused, a publishable public use passes', () => {
    expect(floorPublishable({ public_use: 'ok-with-caveat', maturity: 'raw' })).toBe(true)
    expect(floorPublishable({ public_use: 'ok-with-caveat', maturity: 'held' })).toBe(false)
    expect(floorPublishable({ public_use: 'internal-only' })).toBe(false)
    expect(becomesPublishable(null, { public_use: 'ok-with-caveat' })).toBe(true)
    expect(becomesPublishable({ public_use: 'ok-with-caveat' }, { public_use: 'reviewed-for-guidance' })).toBe(false)
  })
})

describe('publishes (L6 §13): one predicate for every write', () => {
  const op = (set: Record<string, unknown>) => ({ op: 'update', record: SEED, set })
  const seed = { id: 'claim-evidence/seed-swap-notes', maturity: 'raw', public_use: 'not-public-yet' }
  it('moving public_use into the floor\'s list publishes', () => {
    expect(publishes(op({ public_use: 'ok-with-caveat' }), seed, null)).toBe(true)
    expect(publishes(op({ public_use: 'internal-only' }), seed, null)).toBe(false)
    expect(publishes(op({ claim: 'Swaps raise variety.' }), seed, null)).toBe(false)
  })
  it('maturity leaving held publishes a publishable object, not a non-publishable one', () => {
    expect(publishes(op({ maturity: 'reviewed' }), { maturity: 'held', public_use: 'ok-with-caveat' }, null)).toBe(true)
    expect(publishes(op({ maturity: 'reviewed' }), { maturity: 'held', public_use: 'not-public-yet' }, null)).toBe(false)
  })
  it('a knowledge object created publishable publishes; a delete never does', () => {
    expect(publishes({ op: 'create', record: 'knowledge:claim-evidence/new', value: { public_use: 'ok-with-caveat' } }, null, null)).toBe(true)
    expect(publishes({ op: 'delete', record: SEED }, { public_use: 'ok-with-caveat' }, null)).toBe(false)
  })
  it('a page file op adding visibility: public publishes, read with its git pages', () => {
    const page = (visibility?: 'public') => joinPage({ id: 'a-1f2e', title: 'A', parent: null, order: 1000, ...(visibility ? { visibility } : {}) }, 'Body.\n')
    const fileOp = (text: string) => ({ op: 'file', path: 'pages/a-1f2e.md', text, base: null })
    expect(publishes(fileOp(page('public')), page(), null, { pages: [{ id: 'a-1f2e', text: page() }] })).toBe(true)
    expect(publishes(fileOp(page()), page(), null, { pages: [{ id: 'a-1f2e', text: page() }] })).toBe(false)
  })
  it('a canon file\'s text that makes an object publishable publishes', () => {
    const now = HAND_KEPT.replace('public_use: not-public-yet', 'public_use: ok-with-caveat')
    expect(publishes({ op: 'file', path: 'data/kb/claim-evidence.yaml', text: now, base: null }, HAND_KEPT, null)).toBe(true)
    expect(publishes({ op: 'file', path: 'data/kb/claim-evidence.yaml', text: HAND_KEPT.replace('Swaps raise', 'Swaps lift'), base: null }, HAND_KEPT, null)).toBe(false)
  })
})

describe('the collection knowledge (L6 §7.5)', () => {
  it('reads data/kb/claim-evidence.yaml\'s entries as knowledge records with ids claim-evidence/<slug>, each in its kind\'s file', () => {
    const dir = world(null)
    expect(registriesOf(dir).map(d => d.name)).toContain('knowledge')
    const records = currentEntries(dir, 'knowledge')
    expect(records.filter(r => String(r.id).startsWith('claim-evidence/')).map(r => r.id)).toEqual(['claim-evidence/seed-swap-notes', 'claim-evidence/held-claim'])
    expect(records.find(r => r.id === 'claim-evidence/seed-swap-notes')).toMatchObject({ title: 'Seed swap notes', public_use: 'not-public-yet' })
    expect(records.some(r => r.id === 'encyclopedia-entry/living-mulch')).toBe(true)
    expect(registryFile(dir, 'knowledge', 'claim-evidence/seed-swap-notes')).toBe('data/kb/claim-evidence.yaml')
  })

  it('a file under data/kb/ that is not an entries: map holds no record', () => {
    const dir = world(null)
    writeFileSync(join(dir, 'data/kb/index.yaml'), 'items:\n  - living-mulch\n')
    writeFileSync(join(dir, 'data/kb/listed.yaml'), 'entries:\n  - living-mulch\n')
    writeFileSync(join(dir, 'data/kb/map.json'), '{}\n')
    const ids = currentEntries(dir, 'knowledge').map(r => String(r.id))
    expect(ids.some(id => /^(index|listed|map)\//.test(id))).toBe(false)
  })

  it('an instance with no data/kb/ has no knowledge collection', () => {
    instance = makeKmsInstance()
    execSync(`rm -rf "${join(instance.dir, 'data/kb')}"`)
    expect(registriesOf(instance.dir).map(d => d.name)).not.toContain('knowledge')
  })
})

describe('a canon edit is a record op, judged at its targets (L6 §3.2, Q69)', () => {
  it('editing a field of a knowledge object is workspace, and direct', () => {
    const dir = world(PILOT)
    const ops = [{ op: 'update' as const, record: SEED, set: { claim: 'Swaps raise local variety, counted twice.' } }]
    expect(classesOf(ops, dir)).toEqual(['workspace'])
    expect(targetsOf({ ops: ops as never }, dir)).toEqual([['workspace:knowledge', 'workspace']])
    const person = { id: 'steward-b', name: 'Steward B', kind: 'person' as const }
    expect(effectiveRule(readRuleContext(dir, person), classesOf(ops, dir), targetsOf({ ops: ops as never }, dir)).direct).toBe(true)
  })

  it('moving public_use into the floor adds publication, and under the pilot-shaped consent rules it is proposable, not direct', () => {
    const dir = world(PILOT)
    const ops = [{ op: 'update' as const, record: SEED, set: { public_use: 'ok-with-caveat' } }]
    expect(classesOf(ops, dir)).toEqual(['workspace', 'publication'])
    expect(targetsOf({ ops: ops as never }, dir)).toEqual([['workspace:knowledge', 'workspace'], ['publication']])
    const person = { id: 'steward-b', name: 'Steward B', kind: 'person' as const }
    expect(effectiveRule(readRuleContext(dir, person), classesOf(ops, dir), targetsOf({ ops: ops as never }, dir))).toMatchObject({ direct: false, proposable: true })
  })

  it('maturity leaving held adds publication on a publishable object, and not on a non-publishable one', () => {
    const dir = world(PILOT)
    expect(classesOf([{ op: 'update', record: 'knowledge:claim-evidence/held-claim', set: { maturity: 'reviewed' } }], dir)).toEqual(['workspace', 'publication'])
    writeFileSync(join(dir, 'data/kb/claim-evidence.yaml'), HAND_KEPT.replace('public_use: ok-with-caveat', 'public_use: internal-only'))
    expect(classesOf([{ op: 'update', record: 'knowledge:claim-evidence/held-claim', set: { maturity: 'reviewed' } }], dir)).toEqual(['workspace'])
  })
})

describe('the tray: a canon edit staged, applied, proposed and ratified (Q69, R-L6-T10-2)', () => {
  it('a publishing canon edit is staged in the tray as proposable, not direct', async () => {
    const dir = world(PUBLISHING, 'steward-b')
    const app = createApp(dir)
    const staged = await call(app, '/api/changes/ops', json('POST', { ops: [{ op: 'update', record: SEED, set: PUBLISH }] }))
    expect(staged.status, JSON.stringify(staged.body)).toBe(200)
    expect(staged.body.classes).toEqual(['workspace', 'publication'])
    expect(staged.body.rule).toMatchObject({ direct: false, proposable: true })
    expect(staged.body.ops[0]).toMatchObject({ op: 'update', record: SEED, set: PUBLISH, before: { title: 'Seed swap notes' } })
  })

  it('a non-publishing canon edit applies from the tray in one commit, touching only its own line', async () => {
    const dir = world(null)
    const app = createApp(dir)
    expect((await call(app, '/api/changes/ops', json('POST', { ops: [{ op: 'update', record: SEED, set: { claim: 'Swaps lift local variety.' } }] }))).status).toBe(200)
    const applied = await call(app, '/api/changes/apply', json('POST', {}))
    expect(applied.status, JSON.stringify(applied.body)).toBe(200)
    const diff = git(dir, 'show HEAD -- data/kb/claim-evidence.yaml')
    expect(diff.split('\n').filter(l => /^[-+][^-+]/.test(l))).toEqual(['-    claim: Swaps raise local variety.', '+    claim: Swaps lift local variety.'])
    expect(parseTrailers(git(dir, 'log -1 --format=%B'))).toMatchObject({ actor: 'steward-a', rule: 'workspace/direct' })
    expect(readFileSync(join(dir, 'data/kb/claim-evidence.yaml'), 'utf8')).toContain('# the swap\'s own words')
  })

  it('a knowledge entry is changed field by field: a create, a delete or the entry\'s identity is refused at staging', async () => {
    const dir = world(null)
    const app = createApp(dir)
    for (const op of [
      { op: 'create', record: 'knowledge:claim-evidence/new-claim', value: { title: 'New' } },
      { op: 'delete', record: SEED },
      { op: 'replace', record: SEED, value: { title: 'Whole' } },
      { op: 'update', record: SEED, set: { type: 'resource' } },
    ]) {
      const res = await call(app, '/api/changes/ops', json('POST', { ops: [op] }))
      expect(res.status, JSON.stringify(op)).toBe(422)
    }
    expect((await call(app, '/api/changes')).body.ops).toEqual([])
  })

  it('proposed, approved and ratified, the edit is applied in the ratify\'s merge commit, with Org-Proposal', async () => {
    const dir = world(PUBLISHING, 'steward-b')
    let at = Math.floor(Date.now() / 1000) * 1000 - 240_000
    const now = () => new Date(at)
    const app = createApp(dir, (a, ctx) => mountProposals(a, { repo: dir, withLock: ctx.withLock, startBranch: 'main', now }))
    expect((await call(app, '/api/changes/ops', json('POST', { ops: [{ op: 'update', record: SEED, set: PUBLISH }] }))).status).toBe(200)
    const proposed = await call(app, '/api/proposals', json('POST', { title: 'Publish the seed swap notes' }))
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(201)
    const id = String(proposed.body.id)
    const entry = readLedger(dir).entries.find(p => String(p.id) === id)!
    expect(entry.classes).toEqual(['workspace', 'publication'])
    expect(entry.rules?.map(r => r.id)).toEqual(['publishing'])
    // Proposed, not applied: the canon as it was.
    expect(readFileSync(join(dir, 'data/kb/claim-evidence.yaml'), 'utf8')).toBe(HAND_KEPT)
    as(dir, 'steward-a'); at += 60_000
    expect((await call(app, `/api/proposals/${id}/events`, json('POST', { kind: 'approve' }))).status).toBe(200)
    at += 60_000
    const ratified = await call(app, `/api/proposals/${id}/ratify`, json('POST', {}))
    expect(ratified.status, JSON.stringify(ratified.body)).toBe(200)
    expect(git(dir, 'rev-list --parents -n 1 HEAD').trim().split(' ')).toHaveLength(3)
    expect(parseTrailers(git(dir, 'log -1 --format=%B'))).toMatchObject({ proposal: id })
    const text = readFileSync(join(dir, 'data/kb/claim-evidence.yaml'), 'utf8')
    expect(text).toContain('# Claims, kept by hand.')
    expect(text).toContain('# the swap\'s own words')
    const object = (parse(text) as { entries: Record<string, Record<string, unknown>> }).entries['seed-swap-notes']
    expect(floorPublishable(object)).toBe(true)
    // validate:governance reads the ratify as the server made it: the merge holds exactly what its knowledge op makes of the
    // canon file, and the proposal's opening and closing are in order.
    const r = spawnSync('node', [VALIDATOR, dir, '--strict'], { encoding: 'utf8', env: { ...process.env, CI: '' } })
    expect(r.stdout.split('\n').filter(l => /^\s*[✗⚠]/.test(l) && !l.includes('data/governance.yaml rules:')), r.stdout).toEqual([])
    expect(r.stdout).toMatch(/Results: /)
  })

  it('under the solo default the maintainer still applies a publishing canon edit alone, and an agent is still refused', async () => {
    const dir = world(null)
    const person = { id: 'steward-a', name: 'Steward A', kind: 'person' as const }
    const agent = { id: 'agent-a', name: 'Agent A', kind: 'agent' as const }
    const ops = [{ op: 'update' as const, record: SEED, set: PUBLISH }]
    expect(effectiveRule(readRuleContext(dir, person), classesOf(ops, dir), targetsOf({ ops: ops as never }, dir)).direct).toBe(true)
    expect(effectiveRule(readRuleContext(dir, agent), classesOf(ops, dir), targetsOf({ ops: ops as never }, dir))).toMatchObject({ direct: false, proposable: false })
  })
})

describe('the entry page judges by the same floor, and proposes what it may not apply (Q-1, R-L6-T10-1, R-L6-T10-3)', () => {
  it('calls an edit publishing by the floor even where the instance does not publish the kind', async () => {
    instance = makeKmsInstance()
    const kms = join(instance.dir, 'kms.yaml')
    writeFileSync(kms, readFileSync(kms, 'utf8').replace('  types_opt_in: [source-system]\n', '  types_opt_in: [source-system]\n  types_opt_out: [claim-evidence]\n'))
    const edit = await prepareEdit(instance.dir, 'claim-evidence', 'seed-swap-notes', { fields: { public_use: 'reviewed-for-guidance' } }, { now: FIXTURE_NOW })
    expect(edit.classes).toEqual(['workspace', 'publication'])
  })

  it('a publishing edit the steward may not decide alone is proposable on the entry page, in the house\'s words', async () => {
    const dir = world(PUBLISHING, 'steward-b')
    const steward = { id: 'steward-b', name: 'Steward B', kind: 'person' as const }
    const edit = await prepareEdit(dir, 'claim-evidence', 'seed-swap-notes', { fields: PUBLISH }, { now: FIXTURE_NOW }, steward)
    expect(edit.rule).toMatchObject({ direct: false, proposable: true, rule: null })
    expect(edit.rule.sentence).toMatch(/Propose it instead\.$/)
    expect(edit.record).toBe(SEED)
  })

  it('an edit that is direct stays Apply', async () => {
    const dir = world(PUBLISHING, 'steward-b')
    const steward = { id: 'steward-b', name: 'Steward B', kind: 'person' as const }
    const edit = await prepareEdit(dir, 'claim-evidence', 'seed-swap-notes', { fields: { claim: 'Swaps lift variety.' } }, { now: FIXTURE_NOW }, steward)
    expect(edit.rule).toMatchObject({ direct: true })
    expect(edit.rule.proposable).toBeUndefined()
  })
})
