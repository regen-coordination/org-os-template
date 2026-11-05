import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { ChangeStore } from '../../server/changes/store.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { readRegistry } from '../../server/registry.ts'
import { baseOf } from '../../server/changes/canonical.ts'

// *Revise* (0.6 P2 spec §3.4 "Revising", P2-R23): POST /api/proposals/:id/load stages the proposal's current ops into
// its author's open change, marked `revises: <id>`, so the tray's primary action becomes Update proposal. Every
// repository here is a throwaway under the temp directory (makeChangeRepo), with synthetic members ana, bruno and
// carla; every git command runs with that repository as its cwd; the admin state directory is the suite's temp home.

const MEMBERS = `schema_version: "2.0"
members:
  - { id: ana, name: Ana, kind: person, handles: { git: ["ana@example.test"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
  - { id: carla, name: Carla, kind: person, handles: { git: ["carla@example.test"] } }
`
const PROJECTS = `schema_version: "2.0"
projects:
  - id: "proj-001"
    title: "Node Onboarding Program"
    status: "execute"
    type: "program"
    lead: "bruno"
    contributors: ["ana"]
  - id: "proj-002"
    title: "Second"
    status: "idea"
    type: "program"
    lead: "ana"
`
const GOV = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [bruno, carla] }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const TITLED = { op: 'update', record: 'projects:proj-001', set: { title: 'Renamed', status: 'develop' } }

let repo: string
let app: Hono
let clock: Date
beforeEach(() => {
  clock = new Date('2026-10-18T12:00:00Z')
  repo = makeChangeRepo(GOV)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: synthetic members and two projects"')
  app = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => clock }))
})
afterEach(() => { for (const who of ['ana', 'bruno', 'carla']) new ChangeStore(repo).clear(who); removeFixtureRepo(repo) })

const as = (who: string) => { git(repo, `config user.email ${who}@example.test`) }
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const tick = (s = 60) => { clock = new Date(clock.getTime() + s * 1000) }
const commits = () => Number(git(repo, 'rev-list --count HEAD').trim())
const entry = (id: string) => readLedger(repo).entries.find(e => e.id === id)!
const project = (id = 'proj-001') => readRegistry(repo, 'projects').entries!.find(e => e.id === id)!
const load = (who: string, id: string) => { as(who); tick(); return app.request(`/api/proposals/${id}/load`, json({})) }
const tray = async (who: string) => { as(who); return (await app.request('/api/changes')).json() as Promise<Record<string, unknown> & { ops: Record<string, unknown>[] }> }
const stage = (who: string, ops: unknown[]) => { as(who); return app.request('/api/changes/ops', json({ ops })) }

async function propose(author = 'bruno', ops: unknown[] = [TITLED]): Promise<string> {
  expect((await stage(author, ops)).status).toBe(200)
  const res = await app.request('/api/proposals', json({ title: 'Rename one project' }))
  expect(res.status).toBe(201)
  return (await res.json()).id
}

describe('POST /api/proposals/:id/load (Revise)', () => {
  it('stages the proposal’s ops into the author’s empty tray, marked revises, each with the base it was proposed against and the entry it was staged on', async () => {
    const id = await propose('bruno')
    const staged = baseOf(project())
    expect((await tray('bruno')).ops).toEqual([]) // Propose cleared it
    const before = commits()
    const res = await load('bruno', id)
    expect(res.status).toBe(200)
    const v = await res.json()
    expect(v).toMatchObject({ revises: id, actor: 'bruno', state: 'staged', stale: [], classes: ['records'] })
    expect(v.ops).toEqual([{ op: 'update', record: 'projects:proj-001', set: { title: 'Renamed', status: 'develop' }, base: staged, before: project() }])
    expect(v.id).toMatch(/^chg_/)
    // nothing is written to the repository: the change lives in the admin state directory
    expect(commits()).toBe(before)
    expect(git(repo, 'status --porcelain').trim()).toBe('')
    // the tray reads it back, still marked
    expect(await tray('bruno')).toMatchObject({ revises: id, ops: v.ops })
  })

  it('the loaded change is the tray’s: more staged on top keeps the mark, and Update proposal (POST …/revise) takes its ops', async () => {
    const id = await propose('bruno')
    expect((await load('bruno', id)).status).toBe(200)
    expect((await stage('bruno', [{ op: 'update', record: 'projects:proj-001', set: { type: 'project' } }])).status).toBe(200)
    const t = await tray('bruno')
    expect(t).toMatchObject({ revises: id })
    expect(t.ops[0]).toMatchObject({ set: { title: 'Renamed', status: 'develop', type: 'project' } })
    tick()
    const revised = await app.request(`/api/proposals/${id}/revise`, json({ ops: t.ops.map(({ before: _b, ...op }) => op) }))
    expect(revised.status).toBe(200)
    expect(entry(id).ops[0]).toMatchObject({ set: { title: 'Renamed', status: 'develop', type: 'project' } })
    expect(entry(id).events.at(-1)).toMatchObject({ kind: 'revise', by: 'bruno' })
  })

  it('refuses while the author’s tray holds a different change: "apply, propose or discard it first"; the tray is left as it was', async () => {
    const id = await propose('bruno')
    expect((await stage('bruno', [{ op: 'update', record: 'projects:proj-002', set: { status: 'execute' } }])).status).toBe(200)
    const held = await tray('bruno')
    const res = await load('bruno', id)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'TRAY_HOLDS' })
    expect(body.error).toContain('apply, propose or discard it first')
    expect(await tray('bruno')).toEqual(held)
  })

  it('a tray that already revises this proposal is answered as it is: the author’s edits on it are kept', async () => {
    const id = await propose('bruno')
    expect((await load('bruno', id)).status).toBe(200)
    expect((await stage('bruno', [{ op: 'update', record: 'projects:proj-001', set: { type: 'project' } }])).status).toBe(200)
    const edited = await tray('bruno')
    const again = await load('bruno', id)
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual(edited)
  })

  it('a tray that revises another proposal is a different change, and is refused', async () => {
    const first = await propose('bruno')
    const second = await propose('bruno', [{ op: 'update', record: 'projects:proj-002', set: { status: 'execute' } }])
    expect((await load('bruno', first)).status).toBe(200)
    const res = await load('bruno', second)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('apply, propose or discard it first')
    expect(await tray('bruno')).toMatchObject({ revises: first })
  })

  it('only the author: anyone else is the machine’s refusal (409 REFUSED), and their tray stays empty', async () => {
    const id = await propose('bruno')
    const res = await load('carla', id)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'REFUSED', machine: 'proposal', event: 'REVISE', reason: expect.stringContaining('only the author') })
    expect(existsSync(new ChangeStore(repo).file('carla'))).toBe(false)
  })

  it('a closed proposal is not loaded (409 REFUSED); a proposal the ledger does not hold is a 404', async () => {
    const id = await propose('bruno')
    as('bruno'); tick()
    expect((await app.request(`/api/proposals/${id}/events`, json({ kind: 'withdraw' }))).status).toBe(200)
    const res = await load('bruno', id)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'REFUSED', machine: 'proposal', state: 'withdrawn', event: 'REVISE' })
    expect(existsSync(new ChangeStore(repo).file('bruno'))).toBe(false)
    expect((await load('bruno', 'p-2026-10-18-999')).status).toBe(404)
  })

  it('a stale proposal loads with the entry it was staged on, so the tray shows it stale and Take theirs drops only what the trunk changed', async () => {
    const id = await propose('bruno')
    const proposedOn = project()
    writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS.replace('status: "execute"', 'status: "pause"'))
    git(repo, 'commit -qam "the trunk pauses the project"')
    const res = await load('bruno', id)
    expect(res.status).toBe(200)
    const v = await res.json()
    expect(v).toMatchObject({ revises: id, stale: [0], state: 'stale' })
    expect(v.ops[0].before).toEqual(proposedOn)
    as('bruno')
    const theirs = await app.request('/api/changes/ops/0/rebase', json({ keep: 'theirs' }))
    expect(theirs.status).toBe(200)
    expect((await theirs.json()).ops).toEqual([expect.objectContaining({ set: { title: 'Renamed' }, base: baseOf(project()) })])
    expect(await tray('bruno')).toMatchObject({ revises: id })
  })

  it('DELETE /api/changes (Discard all) takes the mark with the change', async () => {
    const id = await propose('bruno')
    expect((await load('bruno', id)).status).toBe(200)
    as('bruno')
    expect((await app.request('/api/changes', { method: 'DELETE' })).status).toBe(204)
    const t = await tray('bruno')
    expect(t.ops).toEqual([])
    expect(t.revises).toBeUndefined()
  })
})

describe('a change that revises a proposal is not proposed or applied (fix round 1: the server decides, spec §3.4)', () => {
  const SENTENCE = (id: string) => `This change revises proposal ${id}: press Update proposal, or discard it first. Nothing was written.`

  it('POST /api/proposals refuses it (409 REVISES): no second proposal, no commit, the tray kept', async () => {
    const id = await propose('bruno')
    expect((await load('bruno', id)).status).toBe(200)
    const held = await tray('bruno')
    const before = [commits(), readLedger(repo).entries.length]
    as('bruno'); tick()
    const res = await app.request('/api/proposals', json({ title: 'A second one' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'REVISES', revises: id, error: SENTENCE(id) })
    expect([commits(), readLedger(repo).entries.length]).toEqual(before)
    expect(await tray('bruno')).toEqual(held)
  })

  it('POST /api/changes/apply refuses it (409 REVISES), even for one the rule now lets decide alone: its ops never land past the proposal', async () => {
    const id = await propose('bruno')
    expect((await load('bruno', id)).status).toBe(200)
    // the rule changes on the trunk: a maintainer now decides records alone, so Apply would otherwise go through
    writeFileSync(join(repo, 'data', 'governance.yaml'), GOV.replace('method: approve, count: 1', 'method: direct'))
    git(repo, 'commit -qam "records: a maintainer decides alone"')
    const held = await tray('bruno')
    expect(held).toMatchObject({ revises: id, rule: { direct: true } })
    const before = commits()
    as('bruno')
    const res = await app.request('/api/changes/apply', json({}))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'REVISES', revises: id, error: SENTENCE(id) })
    expect(commits()).toBe(before)
    expect(project()).toMatchObject({ title: 'Node Onboarding Program' })
    expect(await tray('bruno')).toEqual(held)
  })
})

