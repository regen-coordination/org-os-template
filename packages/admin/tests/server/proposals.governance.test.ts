// DAO-OS L7-D10: a proposal that carries an edit of data/governance.yaml's roles and rules (the record
// governance:governance). Synthetic members; every repository is a fresh temp repository (makeChangeRepo).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { Hono } from 'hono'
import { removeFixtureRepo, REAL_REPO } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { recordAt } from '../../server/proposals/branch.ts'
import { baseOf } from '../../server/changes/canonical.ts'

const MEMBERS = `schema_version: "2.0"
members:
  - { id: ana, name: Ana, kind: person, handles: { git: ["ana@example.test"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
`
const GOV = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [bruno] }
    member: { all: true }
  rules:
    - { id: gov, applies_to: [records, members, governance, identity, systems, treasury, operations, publication], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const ROLES = { maintainer: { members: ['bruno', 'ana'] }, member: { all: true } }
const BASE = Math.floor(Date.now() / 1000) * 1000 - 120_000

let repo: string
let app: Hono
let clock: Date
const as = (who: string) => { git(repo, `config user.email ${who}@example.test`) }
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const tick = (s = 60) => { clock = new Date(clock.getTime() + s * 1000) }

beforeEach(() => {
  clock = new Date(BASE)
  repo = makeChangeRepo(GOV)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: synthetic members"')
  app = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => clock }))
})
afterEach(() => removeFixtureRepo(repo))

async function propose(): Promise<string> {
  as('ana')
  const staged = await app.request('/api/changes/ops', json({ ops: [{ op: 'update', record: 'governance:governance', set: { roles: ROLES } }] }))
  expect(staged.status, await staged.clone().text()).toBe(200)
  const res = await app.request('/api/proposals', json({ title: 'Ana joins the maintainers' }))
  expect(res.status, await res.clone().text()).toBe(201)
  return (await res.json()).id
}

describe('a proposal carrying governance:governance', () => {
  it('recordAt reads the record as { roles, rules }, with no id, at any commit', async () => {
    const record = await recordAt(repo, 'HEAD', 'governance:governance')
    expect(record).toEqual({
      roles: { maintainer: { members: ['bruno'] }, member: { all: true } },
      rules: [{ id: 'gov', applies_to: ['records', 'members', 'governance', 'identity', 'systems', 'treasury', 'operations', 'publication'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } }],
    })
  })

  it('revise loads the op with its before (not null) and not stale', async () => {
    const id = await propose()
    const res = await app.request(`/api/proposals/${id}/load`, json({}))
    expect(res.status, await res.clone().text()).toBe(200)
    const view = await (await app.request('/api/changes')).json()
    const op = view.ops[0]
    expect(op.record).toBe('governance:governance')
    expect(op.before).not.toBeNull()
    expect(baseOf(op.before)).toBe(op.base)
    expect(view.stale).toEqual([])
  })

  it('ratifies, and validate-governance --strict passes on the merge', async () => {
    const fixture = git(repo, 'rev-parse HEAD').trim()
    const id = await propose()
    tick(); as('bruno')
    expect((await app.request(`/api/proposals/${id}/events`, json({ kind: 'approve' }))).status).toBe(200)
    tick()
    const res = await app.request(`/api/proposals/${id}/ratify`, json({}))
    expect(res.status, await res.clone().text()).toBe(200)
    expect(readFileSync(join(repo, 'data', 'governance.yaml'), 'utf8')).toContain('- ana')
    expect(git(repo, 'rev-list --parents -1 HEAD').trim().split(' ')).toHaveLength(3)
    const run = spawnSync(process.execPath, ['scripts/validate-governance.mjs', repo, '--strict', '--range', `${fixture}..HEAD`], { cwd: REAL_REPO, encoding: 'utf8' })
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
  })
})
