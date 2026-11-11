// DAO-OS L7-D11 (spec §5.2): an install that changes a record the org already has. Adding `rules:treasury-safe` stages
// the change engine's one governance edit (Task 4) and a receipt that says what it modified; Apply seals `after`;
// Remove restores the record to the version whose hash is `base`, read from the repository's own history. Every test
// builds a throwaway repository (makeSyntheticRepo) under the temp directory.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeSyntheticRepo, git, SOLO } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { readRegistry } from '../../server/registry.ts'
import { baseOf, governanceRecord } from '../../server/changes/canonical.ts'
import { restoreValue } from '../../server/library/remove.ts'
import { writeGovernanceBlocks } from '../../server/changes/governance-edit.ts'
import { projectOp } from '../../lib/ops.mjs'
import { SOLO_RULES } from '../../lib/rules.mjs'
import { loadLibrary } from '../../server/library/read.ts'
import { cannotAdd } from '../../server/library/preview.ts'
import type { LibraryEntry } from '../../server/library/types.ts'
import { validateRepo } from '../../lib/data-validate.mjs'

const SAFE = `schema_version: "1.0"
systems:
  - id: treasury-safe
    kind: safe
    name: Treasury
    chain: "eip155:11155111"
    address: "0x0000000000000000000000000000000000005afe"
    driver: safe
    section: organization/treasury
`
const RULE = { id: 'treasury', applies_to: ['treasury'], propose: 'maintainer', decide: { by: 'system', system: 'treasury-safe' } }
/** An org whose written rules let its maintainer decide everything directly, so a removal of the rule set it adds is
 *  applied, not proposed (with only the treasury rule written, no rule would cover the governance class). */
const STEWARDED = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  # the one rule this org has written
  rules:
    - { id: steward, applies_to: [all], propose: maintainer, decide: { by: maintainer, method: direct } }
  decisions: []
`
const STEWARD = { id: 'steward', applies_to: ['all'], propose: 'maintainer', decide: { by: 'maintainer', method: 'direct' } }
/** The rule in force while an org has written none (lib/rules.mjs SOLO_RULES), as an add writes it first. */
const IMPLIED = JSON.parse(JSON.stringify(SOLO_RULES[0]))

let repo: string
let app: Hono
const fresh = (governance: string) => {
  repo = makeSyntheticRepo(governance)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SAFE)
  git(repo, 'add data/systems.yaml')
  git(repo, 'commit -qm "fixture: a Safe"')
  app = createApp(repo)
}
afterEach(() => removeFixtureRepo(repo))

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const add = (id: string, body: unknown = {}) => app.request(`/api/library/${encodeURIComponent(id)}/add`, json('POST', body))
const remove = (id: string, body: unknown = {}) => app.request(`/api/library/receipts/${encodeURIComponent(id)}/remove`, json('POST', body))
const stageOps = (ops: unknown[]) => app.request('/api/changes/ops', json('POST', { ops }))
const apply = () => app.request('/api/changes/apply', json('POST', {}))
const governanceText = () => readFileSync(join(repo, 'data', 'governance.yaml'), 'utf8')
const governanceHash = () => baseOf(governanceRecord(governanceText()))
const receipt = (id: string) => (readRegistry(repo, 'library').entries ?? []).find(e => e.id === id)!
async function ok(res: Response, status = 200): Promise<Record<string, any>> {
  const body = await res.json()
  expect(res.status, JSON.stringify(body)).toBe(status)
  return body
}
const errorsOf = () => validateRepo(repo).filter((p: { level: string }) => p.level === 'error')

describe('adding a rule set (a modifying install)', () => {
  beforeEach(() => fresh(SOLO))
  it('stages update governance:governance and a receipt that names it as modified, with its base', async () => {
    const base = governanceHash()
    const body = await ok(await add('rules:treasury-safe'))
    expect(body.ops.map((o: { op: string; record: string }) => `${o.op} ${o.record}`)).toEqual(['update governance:governance', 'create library:rules-treasury-safe'])
    // The org had written no rules: the implied rule is written first, so what was in force stays in force (review I1).
    expect(body.ops[0].set).toEqual({ rules: [IMPLIED, RULE] })
    expect(body.ops[1].value).toEqual({
      id: 'rules-treasury-safe', entry: 'rules:treasury-safe', version: '1.0.0', shelf: 'framework',
      created: [], modified: [{ record: 'governance:governance', base, after: null }],
      status: 'installed', by: null, at: null, decision: null, removed: null,
    })
    expect(Object.keys(body.ops[1].value)).toEqual(['id', 'entry', 'version', 'shelf', 'created', 'modified', 'status', 'by', 'at', 'decision', 'removed'])
    expect(body.classes).toEqual(['governance'])
  })

  it('apply writes the rule into the file and seals after as the record\'s hash there', async () => {
    const base = governanceHash()
    await ok(await add('rules:treasury-safe'))
    await ok(await apply())
    expect(governanceRecord(governanceText())).toEqual({ rules: [IMPLIED, RULE] })
    const r = receipt('rules-treasury-safe')
    expect(r.modified).toEqual([{ record: 'governance:governance', base, after: governanceHash() }])
    expect(r.by).toBe('bruno')
    expect(errorsOf()).toEqual([])
  })

  it('a rule id the org already has is refused, and nothing is staged', async () => {
    await ok(await add('rules:treasury-safe'))
    await ok(await apply())
    const body = await ok(await add('rules:treasury-safe'), 409)
    expect(body).toEqual({ code: 'NOT_ADDABLE', error: 'rule treasury is already written.' })
  })

  it('on implied rules: add, apply, remove, apply gives the org its implied rules back, the file byte for byte', async () => {
    await ok(await add('rules:treasury-safe'))
    await ok(await apply())
    const body = await ok(await remove('rules-treasury-safe'))
    expect(body.ops[0]).toMatchObject({ op: 'update', record: 'governance:governance', set: { rules: null } })
    await ok(await apply())
    expect(governanceText()).toBe(SOLO)
    expect(receipt('rules-treasury-safe')).toMatchObject({ status: 'removed', removed: { by: 'bruno' } })
    expect(errorsOf()).toEqual([])
  })

  it('a change that already edits the record is refused, so no receipt\'s base is folded into another\'s (review I2)', async () => {
    await ok(await stageOps([{ op: 'update', record: 'governance:governance', set: { rules: [STEWARD] } }]))
    const body = await ok(await add('rules:treasury-safe'), 409)
    expect(body).toEqual({ code: 'NOT_ADDABLE', error: 'Your change already edits governance:governance. Apply or propose it first, then add this.' })
    const preview = await ok(await app.request('/api/library/rules%3Atreasury-safe/preview'))
    expect(preview.cannotAdd).toBe('Your change already edits governance:governance. Apply or propose it first, then add this.')
  })
})

describe('a rule set on implied rules never narrows who decides (review NB1, NB4)', () => {
  const NARROWS = 'This org decides alone today. Adding this rule set would narrow that to the maintainer role; define the rules first.'
  const MAINTAINED = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  roles:
    maintainer: { members: [bruno] }
  decisions: []
`
  const treasury = (): LibraryEntry => loadLibrary(repo).entries.find(e => e.id === 'rules:treasury-safe')!
  const withSet = (set: Record<string, unknown>): LibraryEntry =>
    ({ ...treasury(), installs: [{ op: 'update', record: 'governance:governance', set }] })

  it('an org that defines maintainer but writes no rules is refused, and nothing is staged', async () => {
    fresh(MAINTAINED)
    expect(await ok(await add('rules:treasury-safe'), 409)).toEqual({ code: 'NOT_ADDABLE', error: NARROWS })
    expect((await (await app.request('/api/changes')).json()).ops).toEqual([])
  })

  it('an entry whose own roles define maintainer is refused on an implied-rules org', () => {
    fresh(SOLO)
    expect(cannotAdd(repo, withSet({ roles: { maintainer: { members: ['bruno'] } }, rules: [RULE] }), [])).toBe(NARROWS)
  })

  it('with no maintainer defined anywhere, it is added', () => {
    fresh(SOLO)
    expect(cannotAdd(repo, treasury(), [])).toBeNull()
  })

  it('an entry rule with the implied rule\'s id is told the id is reserved, not that the org wrote it', () => {
    fresh(SOLO)
    expect(cannotAdd(repo, withSet({ rules: [{ ...RULE, id: 'solo' }] }), []))
      .toBe('rule solo has the id of the rule this org follows without writing it (the solo default), so that id is reserved; the entry\'s rule needs another.')
  })
})

describe('removing a modifying install', () => {
  beforeEach(() => fresh(STEWARDED))

  it('restores the file\'s roles and rules to the version whose hash is base', async () => {
    const base = governanceHash()
    await ok(await add('rules:treasury-safe'))
    await ok(await apply())
    expect(governanceRecord(governanceText())).toEqual({ rules: [STEWARD, RULE] })
    const body = await ok(await remove('rules-treasury-safe'))
    expect(body.ops.map((o: { op: string; record: string }) => `${o.op} ${o.record}`)).toEqual(['update governance:governance', 'update library:rules-treasury-safe'])
    expect(body.ops[0].set).toEqual({ rules: [STEWARD] })
    await ok(await apply())
    expect(governanceHash()).toBe(base)
    expect(governanceRecord(governanceText())).toEqual({ rules: [STEWARD] })
    expect(governanceText()).toContain('# the one rule this org has written')
    expect(receipt('rules-treasury-safe')).toMatchObject({ status: 'removed', removed: { by: 'bruno' } })
    expect(errorsOf()).toEqual([])
  })

  it('a removal that does not give back what the add changed is refused as a whole (review I3)', async () => {
    await ok(await add('rules:treasury-safe'))
    await ok(await apply())
    const body = await ok(await stageOps([{ op: 'update', record: 'library:rules-treasury-safe', set: { status: 'removed', removed: { by: null, at: null, decision: null } } }]), 422)
    expect(body.errors).toContainEqual({
      record: 'library:rules-treasury-safe', field: '',
      message: 'library:rules-treasury-safe is marked removed, but governance:governance, which its add changed, is not given back by this change. Take the removal out as a whole, or stage it again from the library.',
    })
  })

  it('restoreValue walks the file\'s history and finds the version with that hash', async () => {
    const base = governanceHash()
    await ok(await add('rules:treasury-safe'))
    await ok(await apply())
    expect(restoreValue(repo, 'governance:governance', base!)).toEqual({ rules: [STEWARD] })
    expect(restoreValue(repo, 'governance:governance', '0'.repeat(64))).toBeNull()
  })

  it('after a hand-staged edit of the rules, answers 409 ASK naming governance:governance', async () => {
    await ok(await add('rules:treasury-safe'))
    await ok(await apply())
    await ok(await stageOps([{ op: 'update', record: 'governance:governance', set: { rules: [STEWARD, { ...RULE, decide: { by: 'maintainer', method: 'direct' } }] } }]))
    const body = await ok(await remove('rules-treasury-safe'), 409)
    expect(body.code).toBe('ASK')
    expect(body.asks).toEqual(['governance:governance'])
    const preview = await ok(await app.request('/api/library/receipts/rules-treasury-safe/removal'))
    expect(preview.records).toEqual([{ record: 'governance:governance', state: 'edited', referrers: [] }])
  })
})

describe('a block the version before the add did not state', () => {
  it('is taken out of the file by a null in the set, every other byte kept', () => {
    const added = writeGovernanceBlocks(SOLO, { rules: [RULE] })
    expect(governanceRecord(added)).toEqual({ rules: [RULE] })
    expect(writeGovernanceBlocks(added, { rules: null })).toBe(SOLO)
    expect(writeGovernanceBlocks(SOLO, { rules: null })).toBe(SOLO)
  })

  it('is left out of the projected record, so its hash is the version without it', () => {
    const entries = new Map([['governance', [{ id: 'governance', rules: [RULE] }]]])
    projectOp(entries, { op: 'update', record: 'governance:governance', set: { rules: null } })
    expect(entries.get('governance')).toEqual([{ id: 'governance' }])
  })
})

describe('a modifying install proposed and ratified', () => {
  const FRAMEWORK = fileURLToPath(new URL('../../../../', import.meta.url))
  const MEMBERS = `schema_version: "2.0"
members:
  - { id: ana, name: Ana, kind: person, handles: { git: ["ana@example.test"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
`
  const APPROVE = `schema_version: "2.0"\ngovernance:\n  model: "consensus"\n  roles:\n    maintainer: { members: [bruno] }\n    member: { all: true }\n  rules:\n    - { id: all, applies_to: [all], propose: member, decide: { by: maintainer, method: approve, count: 1 } }\n  decisions: []\n`
  let clock: Date
  const tick = () => { clock = new Date(clock.getTime() + 30_000) }
  const as = (who: string) => { git(repo, `config user.email ${who}@example.test`) }

  beforeEach(() => {
    clock = new Date(Math.floor(Date.now() / 1000) * 1000 - 300_000)
    repo = makeSyntheticRepo(null)
    writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
    writeFileSync(join(repo, 'data', 'governance.yaml'), APPROVE)
    writeFileSync(join(repo, 'data', 'systems.yaml'), SAFE)
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: synthetic members, their rules and a Safe"')
    app = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => clock }))
  })

  it('the proposal seals after before the ops lose their before, and the ratified tree validates', async () => {
    const base = governanceHash()
    as('ana')
    await ok(await add('rules:treasury-safe'))
    const id = String((await ok(await app.request('/api/proposals', json('POST', { title: 'Treasury decided by the Safe' })), 201)).id)
    tick(); as('bruno')
    await ok(await app.request(`/api/proposals/${id}/events`, json('POST', { kind: 'approve' })))
    tick()
    await ok(await app.request(`/api/proposals/${id}/ratify`, json('POST', {})))
    const r = parse(git(repo, 'show HEAD:data/library.yaml')).installed[0]
    expect(r.modified).toEqual([{ record: 'governance:governance', base, after: governanceHash() }])
    expect(r.decision).toEqual({ proposal: id })
    const run = spawnSync(process.execPath, ['scripts/validate-governance.mjs', repo, '--strict'], { cwd: FRAMEWORK, encoding: 'utf8' })
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(errorsOf()).toEqual([])
  })
})
