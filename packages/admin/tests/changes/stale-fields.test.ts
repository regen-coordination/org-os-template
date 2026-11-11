// The walk's I5 (review G6): staleness is judged per field. An update op is stale only when a field it sets changed on the
// trunk since it was staged; an op whose fields the trunk left alone is re-based on the record as it is now, silently,
// so ratifying a status change never marks a staged tags change "changed on the trunk". One op that is stale does not
// hold Propose for the rest: they are proposed, and the stale op stays in the tray. Fresh temporary repositories only;
// placeholders only.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from './fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { ChangeStore } from '../../server/changes/store.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { isStale } from '../../server/changes/merge.ts'
import { baseOf } from '../../server/changes/canonical.ts'
import { currentOf } from '../../server/changes/stage.ts'
import type { RecordStaged } from '../../server/changes/types.ts'

let repo: string
let app: Hono
afterEach(() => removeFixtureRepo(repo))

const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["steward-a@example.test"] } }
  - { id: steward-b, name: Steward B, kind: person, handles: { git: ["steward-b@example.test"] } }
  - { id: ana, name: Ana Silva, kind: person }
`
const GOV = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    council: { members: [steward-b] }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: council, method: approve, count: 1 } }
  decisions: []
`
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const as = (who: string) => git(repo, `config user.email ${who}@example.test`)
const stage = (ops: unknown[]) => app.request('/api/changes/ops', json({ ops }))
const view = async () => (await app.request('/api/changes')).json()
const PROJ = 'projects:proj-001'

let now = new Date()
function setup() {
  repo = makeChangeRepo(GOV)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: two members"')
  now = new Date(Math.floor(Date.now() / 1000) * 1000 - 600_000)
  app = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => now }))
}
const tick = () => { now = new Date(now.getTime() + 60_000) }

/** steward-a proposes the project's move to develop; then `more` is staged; then steward-b approves and ratifies it. */
async function statusRatifiedUnder(more: unknown[]): Promise<void> {
  as('steward-a')
  expect((await stage([{ op: 'update', record: PROJ, set: { status: 'develop' } }])).status).toBe(200)
  const proposed = await app.request('/api/proposals', json({ title: 'Move the onboarding program to develop' }))
  expect(proposed.status, await proposed.clone().text()).toBe(201)
  const id = String((await proposed.json()).id)
  const staged = await stage(more)
  expect(staged.status, await staged.clone().text()).toBe(200)
  tick(); as('steward-b')
  expect((await app.request(`/api/proposals/${id}/events`, json({ kind: 'approve' }))).status).toBe(200)
  tick()
  const ratified = await app.request(`/api/proposals/${id}/ratify`, json({}))
  expect(ratified.status, await ratified.clone().text()).toBe(200)
  expect(readFileSync(join(repo, 'data', 'projects.yaml'), 'utf8')).toContain('develop')
  tick(); as('steward-a')
}

describe('staleness per field (walk I5, review G6)', () => {
  it('status vs tags: a ratified status change leaves the staged tags change fresh, re-based, and proposable', async () => {
    setup()
    await statusRatifiedUnder([{ op: 'update', record: PROJ, set: { tags: ['nodes', 'onboarding', 'season-two'] } }])
    const v = await view()
    expect(v.stale).toEqual([])
    expect(v.state).toBe('staged')
    const now = currentOf(repo, PROJ)!
    // Re-based on the record as it is now: its base, and its "was" the trunk's (status develop).
    expect(v.ops[0]).toMatchObject({ op: 'update', record: PROJ, set: { tags: ['nodes', 'onboarding', 'season-two'] }, base: baseOf(now) })
    expect(v.ops[0].before.status).toBe('develop')
    const proposed = await app.request('/api/proposals', json({ title: 'Season-two tags' }))
    expect(proposed.status, await proposed.clone().text()).toBe(201)
    const entry = readLedger(repo).entries.find(e => e.title === 'Season-two tags')!
    expect(entry.ops).toEqual([{ op: 'update', record: PROJ, set: { tags: ['nodes', 'onboarding', 'season-two'] }, base: baseOf(now) }])
    expect(new ChangeStore(repo).load('steward-a')).toBeNull()
  })

  it('an op setting the field the trunk changed is stale; the rest of the change is proposed and the stale op stays', async () => {
    setup()
    const BETA = { id: 'proj-002', title: 'Seed Library', status: 'idea', type: 'program', lead: 'steward-a' }
    await statusRatifiedUnder([{ op: 'update', record: PROJ, set: { status: 'archive' } }, { op: 'create', record: 'projects:proj-002', value: BETA }])
    const v = await view()
    expect(v.stale).toEqual([0])
    const proposed = await app.request('/api/proposals', json({ title: 'The seed library' }))
    expect(proposed.status, await proposed.clone().text()).toBe(201)
    const entry = readLedger(repo).entries.find(e => e.title === 'The seed library')!
    expect(entry.ops.map(o => (o as { record: string }).record)).toEqual(['projects:proj-002'])
    const left = new ChangeStore(repo).load('steward-a')!
    expect(left.ops.map(o => (o as { record: string }).record)).toEqual([PROJ])
    expect((await view()).stale).toEqual([0])
  })

  it('a change of stale ops only is still refused STALE, nothing written', async () => {
    setup()
    await statusRatifiedUnder([{ op: 'update', record: PROJ, set: { status: 'archive' } }])
    const res = await app.request('/api/proposals', json({ title: 'Archive it' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('STALE')
    expect(new ChangeStore(repo).load('steward-a')!.ops).toHaveLength(1)
  })
})

describe('isStale per field', () => {
  const before = { id: 'proj-001', title: 'T', status: 'execute', tags: ['a'] }
  const op = (set: Record<string, unknown>): RecordStaged => ({ op: 'update', record: PROJ, set, base: baseOf(before), before })
  it('is stale only when a field it sets changed', () => {
    expect(isStale(op({ tags: ['a', 'b'] }), { ...before, status: 'develop' })).toBe(false)
    expect(isStale(op({ status: 'archive' }), { ...before, status: 'develop' })).toBe(true)
    expect(isStale(op({ tags: ['a', 'b'] }), null)).toBe(true)
    // With no `before` (a ledger op), the record's version alone says it.
    expect(isStale({ ...op({ tags: ['a', 'b'] }), before: null }, { ...before, status: 'develop' })).toBe(true)
    // A replace or a delete is stale on any change.
    expect(isStale({ op: 'delete', record: PROJ, base: baseOf(before), before }, { ...before, status: 'develop' })).toBe(true)
  })
})
