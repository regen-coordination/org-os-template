/** PF-R4 (review I2) in validate:governance: a ratify merge that publishes (a knowledge object made publishable, a page
 *  made public) needs a proposal opened for `publication`. The server now refuses such a ratify (opened.ts); this suite turns
 *  that refusal off with a mock, to make the merge an older server would have made, and asks the validator about it: the
 *  reviewer's replay2 world, Keep mine, under a proposal opened for the workspace only. A fresh temporary instance (the kms
 *  fixture as its own git repository); members and rules are placeholders. */
import { execSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { Hono } from 'hono'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { makeKmsInstance, type FixtureInstance } from '../server/knowledge/fixture.ts'

vi.mock('../../server/proposals/opened.ts', async original => ({ ...(await original<object>()), refuseOutsideOpened: () => {} }))

const VALIDATOR = fileURLToPath(new URL('../../../../scripts/validate-governance.mjs', import.meta.url))
let instance: FixtureInstance | null = null
afterEach(() => { instance?.cleanup(); instance = null })

const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["steward-a@example.test"] } }
  - { id: steward-b, name: Steward B, kind: person, handles: { git: ["steward-b@example.test"] } }
  - { id: steward-c, name: Steward C, kind: person, handles: { git: ["steward-c@example.test"] } }
`
const RAISED = `schema_version: "2.0"
governance:
  model: consensus
  roles:
    maintainer: { members: [steward-a] }
    council: { members: [steward-a, steward-b, steward-c] }
    member: { all: true }
  rules:
    - { id: canon, applies_to: [workspace], propose: member, decide: { by: maintainer, method: approve, count: 1, self_approve: true } }
    - { id: publishing, applies_to: [publication], propose: member, decide: { by: council, method: approve, count: 3, self_approve: true } }
  decisions: []
`
const HELD = `schema_version: "1.0"
entries:
  quiet-claim:
    title: A quiet claim
    type: claim-evidence
    id: id-quiet-claim
    maturity: held
    public_use: internal-only
`
const QUIET = 'knowledge:claim-evidence/quiet-claim'
const git = (dir: string, cmd: string) => execSync(`git -C "${dir}" ${cmd}`, { stdio: 'pipe' }).toString()
const json = (method: string, body?: unknown) => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), headers: { 'content-type': 'application/json' } })
async function call(app: Hono, path: string, init?: RequestInit): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await app.request(path, init)
  const text = await res.text()
  return { status: res.status, body: text === '' ? null : JSON.parse(text) }
}

it('validate:governance --strict fails a ratify merge that publishes under a proposal opened for the workspace only', async () => {
  instance = makeKmsInstance()
  const dir = instance.dir
  git(dir, 'init -q -b main'); git(dir, 'config user.email steward-b@example.test'); git(dir, 'config user.name Test')
  writeFileSync(join(dir, 'data/members.yaml'), MEMBERS)
  writeFileSync(join(dir, 'data/governance.yaml'), RAISED)
  writeFileSync(join(dir, 'data/kb/claim-evidence.yaml'), HELD)
  git(dir, 'add -A'); git(dir, 'commit -qm fixture')
  let at = Math.floor(Date.now() / 1000) * 1000 - 600_000
  const now = () => new Date(at)
  const app = createApp(dir, (a, ctx) => mountProposals(a, { repo: dir, withLock: ctx.withLock, startBranch: 'main', now }))
  expect((await call(app, '/api/changes/ops', json('POST', { ops: [{ op: 'update', record: QUIET, set: { maturity: 'reviewed' } }] }))).status).toBe(200)
  const proposed = await call(app, '/api/proposals', json('POST', { title: 'Mark the quiet claim reviewed' }))
  expect(proposed.status, JSON.stringify(proposed.body)).toBe(201)
  const id = String(proposed.body.id)
  at += 60_000
  writeFileSync(join(dir, 'data/kb/claim-evidence.yaml'), HELD.replace('public_use: internal-only', 'public_use: ok-with-caveat'))
  git(dir, 'config user.email steward-a@example.test')
  git(dir, 'commit -qam "knowledge: public use" --trailer "Org-Actor: steward-a" --trailer "Org-Rule: canon/direct"')
  git(dir, 'config user.email steward-b@example.test'); at += 60_000
  expect((await call(app, `/api/proposals/${id}/replay`, json('POST', { choose: 'mine' }))).status).toBe(200)
  expect(readLedger(dir).entries.find(p => String(p.id) === id)!.classes).toEqual(['workspace'])
  git(dir, 'config user.email steward-a@example.test'); at += 60_000
  expect((await call(app, `/api/proposals/${id}/events`, json('POST', { kind: 'approve' }))).status).toBe(200)
  at += 60_000
  const ratified = await call(app, `/api/proposals/${id}/ratify`, json('POST', {}))
  expect(ratified.status, JSON.stringify(ratified.body)).toBe(200)
  const merge = git(dir, 'rev-parse --short HEAD').trim()
  const r = spawnSync('node', [VALIDATOR, dir, '--strict'], { encoding: 'utf8', env: { ...process.env, CI: '' } })
  expect(r.status, r.stdout).toBe(1)
  const found = r.stdout.split('\n').filter(l => /^\s*✗/.test(l) && l.includes(merge))
  expect(found.some(l => new RegExp(`proposal ${id}.*opened for workspace.*publication`).test(l)), r.stdout).toBe(true)
})
