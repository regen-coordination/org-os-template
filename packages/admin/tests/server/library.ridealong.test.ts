import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import { parse } from 'yaml'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { validateRepo } from '../../lib/data-validate.mjs'

// The receipt rides along (coordinator ruling L1-C5): an add is decided by the classes of what it creates, never by the
// receipt's own class (`records`), unless the change holds nothing else. Every test builds a throwaway repository under
// the temp directory (makeChangeRepo), with synthetic members ana, bruno and carla, copied from
// library.propose.test.ts. The clock is injected for the proposal routes, anchored near the real now.
const MEMBERS = `schema_version: "2.0"
members:
  - { id: ana, name: Ana, kind: person, handles: { git: ["ana@example.test"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
  - { id: carla, name: Carla, kind: person, handles: { git: ["carla@example.test"] } }
`
// bruno applies systems alone; records need a maintainer's approval, so `records` is the stricter class.
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [bruno] }
    member: { all: true }
  rules:
    - { id: systems, applies_to: [systems], propose: member, decide: { by: maintainer, method: direct } }
    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const SYSTEMS = `schema_version: "1.0"
systems: []
`

const FRAMEWORK = fileURLToPath(new URL('../../../../', import.meta.url))
const LINK_VERSION = String(parse(readFileSync(join(FRAMEWORK, 'packages/admin/library/system/link/entry.yaml'), 'utf8')).version)
/** A whole second two minutes before the real now: the clock the tests start from. */
const BASE = Math.floor(Date.now() / 1000) * 1000 - 120_000

const SYSTEM = { op: 'create', record: 'systems:desk-link', value: { kind: 'link', driver: 'link', name: 'Desk', url: 'https://example.test/desk' } }
const RECEIPT = {
  op: 'create', record: 'library:system-desk-link',
  value: {
    entry: 'system:link', version: LINK_VERSION, shelf: 'framework',
    created: [{ record: 'systems:desk-link', base: null }],
    status: 'installed', by: null, at: null, decision: null, removed: null,
  },
}
const BOARD = { op: 'create', record: 'boards:desk', value: { name: 'Desk', layout: 'flow', blocks: [] } }

let repo: string
let app: Hono
const clock = new Date(BASE)
afterEach(() => removeFixtureRepo(repo))

/** The members, the rules and an empty systems file in one commit, over a history with no rules yet, so
 *  validate:governance judges no fixture commit: only what the platform writes. */
function setup() {
  repo = makeChangeRepo(null)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'governance.yaml'), GOVERNANCE)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: synthetic members, their rules, no systems"')
  app = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => clock }))
}
const as = (who: string) => { git(repo, `config user.email ${who}@example.test`) }
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const sha = (rev = 'HEAD') => git(repo, `rev-parse ${rev}`).trim()
async function ok(res: Response, status = 200): Promise<Record<string, any>> {
  const body = await res.json()
  expect(res.status, JSON.stringify(body)).toBe(status)
  return body
}
const stage = async (ops: unknown[]) => ok(await app.request('/api/changes/ops', json({ ops })))
const view = async () => ok(await app.request('/api/changes'))

describe('an add is decided by what it creates (L1-C5)', () => {
  it('a system and its receipt: classes [systems], direct for bruno, applied in one commit that validate:governance --strict accepts', async () => {
    setup()
    as('bruno')
    await stage([SYSTEM, RECEIPT])
    const staged = await view()
    expect(staged.classes).toEqual(['systems'])
    expect(staged.rule.direct).toBe(true)

    const T = sha()
    const applied = await ok(await app.request('/api/changes/apply', json({})))
    expect(applied.commit).toBe(sha())
    expect(sha('HEAD^')).toBe(T)
    expect(git(repo, `diff --name-only ${T} HEAD`).trim().split('\n').sort()).toEqual(['data/library.yaml', 'data/systems.yaml'])
    const receipt = parse(git(repo, 'show HEAD:data/library.yaml')).installed[0]
    expect(receipt).toMatchObject({ id: 'system-desk-link', by: 'bruno', status: 'installed' })
    expect(receipt.at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(receipt.decision).toMatchObject({ rule: 'systems/direct' })
    expect(receipt.created[0].base).toMatch(/^[0-9a-f]{64}$/)

    const run = spawnSync(process.execPath, ['scripts/validate-governance.mjs', repo, '--strict'], { cwd: FRAMEWORK, encoding: 'utf8' })
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(validateRepo(repo).filter((p: { level: string }) => p.level === 'error')).toEqual([])
  })

  it('control: a board alone (records) is not direct for bruno under the same rules', async () => {
    setup()
    as('bruno')
    await stage([BOARD])
    const staged = await view()
    expect(staged.classes).toEqual(['records'])
    expect(staged.rule.direct).toBe(false)
  })

  it('ana proposes the same add: the ledger lists [systems], and the ledger check finds nothing to say', async () => {
    setup()
    as('ana')
    await stage([SYSTEM, RECEIPT])
    expect((await view()).rule.direct).toBe(false)
    const id = String((await ok(await app.request('/api/proposals', json({ title: 'Add the desk link' })), 201)).id)
    const entry = readLedger(repo).entries.find(e => String(e.id) === id)!
    expect(entry.classes).toEqual(['systems'])
    expect(entry.ops.map(o => o.record)).toEqual(['systems:desk-link', 'library:system-desk-link'])
    const problems = validateRepo(repo).filter((p: { level: string; file: string }) => p.level === 'error' && p.file.endsWith('proposals.yaml'))
    expect(problems).toEqual([])
  })
})
