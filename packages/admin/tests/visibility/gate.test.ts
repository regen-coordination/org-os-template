import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { mountResources } from '../../server/resources/routes.ts'
import { ResourceStore } from '../../server/resources/index.ts'
import { runCommand } from '../../server/resources/run.ts'
import { orgName } from '../../server/resources/util.ts'
import { mountSession } from '../../server/session/routes.ts'
import { Membership } from '../../server/session/membership.ts'
import { createSession } from '../../server/session/sessions.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { startServer, type Running } from '../../server/serve.ts'
import { mountVisibility } from '../../server/visibility/routes.ts'
import { readConfig } from '../../server/visibility/config.ts'
import { readRegistry } from '../../server/registry.ts'
import { baseOf } from '../../server/changes/canonical.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import {
  attentionLevel, gateEvent, gateGraph, gateItems, gateRecord, Levels, MEMBERS, MEMBERS_ONLY, PUBLIC, PUBLIC_NO_DIFF, PUBLIC_READS, PUBLIC_VIEWER,
  publicProjection,
} from '../../server/visibility/gate.ts'
import type { Resource } from '../../server/resources/types.ts'
import type { WearerReading } from '../../server/systems/hats.ts'

// L5 spec §9.5: one gate for every read. A fresh repository under the temp directory (makeChangeRepo) holds, besides
// what is public, values the public must never be given, each holding the string SECRET: a members' project, a
// restricted field of a public project, a public member's e-mail, a members' collection, a members' proposal, the
// governance document and DECISIONS.md. Two apps read it: a hosted one with no session (every request is the public)
// and a local one (git's identity, a member, who sees all of git, as 0.6). Nothing touches the network.

const NOW = new Date('2026-10-29T12:00:00Z')
const MEMBERS_YAML = `schema_version: "2.0"
members:
  - { id: ana, name: Ana, kind: person, visibility: public, email: "ana-SECRET@example.invalid", handles: { git: ["ana@example.test"], chat: "SECRET-chat" } }
  - { id: bruno, name: Bruno, kind: person, notes: "SECRET-bruno", handles: { git: ["bruno@example.test"] } }
  - { id: carla, name: Carla, kind: person, handles: { git: ["carla@example.test"] } }
`
const PROJECTS_YAML = `schema_version: "2.0"
projects:
  - id: "proj-pub"
    title: "Public Project"
    status: "execute"
    type: "program"
    lead: "bruno"
    contributors: ["ana"]
    budget: "SECRET-budget"
  - id: "proj-mem"
    title: "SECRET-members-project"
    status: "develop"
    type: "program"
    lead: "carla"
    visibility: "members"
`
const IDEAS_YAML = `schema_version: "2.0"
ideas:
  - { id: idea-1, title: "SECRET-idea", status: "open" }
`
const VISIBILITY_YAML = `visibility:
  collections:
    projects: { default: public, fields: { budget: members } }
    proposals: { default: public }
`
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  description: "SECRET-governance"
  roles:
    maintainer: { members: [bruno, carla] }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const DECISIONS = '# Decisions\n\n## 2026-10-01 — The SECRET-decision\n\nStatus: accepted\n'

let repo: string
let pub: Hono // hosted, no session: the public
let local: Hono // locally, git's identity (bruno): a member
let store: ResourceStore
let P1 = '' // public: it changes the public project
let P2 = '' // members': it changes the members' project

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const as = (who: string) => git(repo, `config user.email ${who}@example.test`)
const get = async (app: Hono, path: string) => {
  const res = await app.request(path)
  const text = await res.text()
  return { status: res.status, body: JSON.parse(text) as any, text } // eslint-disable-line @typescript-eslint/no-explicit-any
}

function extend(a: Hono, ctx: { withLock: <T>(fn: () => Promise<T>) => Promise<T> }) {
  mountResources(a, store, repo)
  mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => NOW })
}

async function propose(record: string, set: Record<string, unknown>, title: string): Promise<string> {
  as('bruno')
  expect((await local.request('/api/changes/ops', json('POST', { ops: [{ op: 'update', record, set }] }))).status).toBe(200)
  const res = await local.request('/api/proposals', json('POST', { title }))
  expect(res.status).toBe(201)
  return (await res.json()).id
}

beforeAll(async () => {
  repo = makeChangeRepo(GOVERNANCE)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS_YAML)
  writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS_YAML)
  writeFileSync(join(repo, 'data', 'ideas.yaml'), IDEAS_YAML)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), VISIBILITY_YAML)
  writeFileSync(join(repo, 'DECISIONS.md'), DECISIONS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: what is public and what is not"')
  store = new ResourceStore({ repo, now: () => NOW, run: runCommand, lastOk: () => null })
  local = createApp(repo, extend)
  P1 = await propose('projects:proj-pub', { status: 'develop' }, 'Move the public project')
  P2 = await propose('projects:proj-mem', { status: 'execute' }, 'SECRET-proposal')
  pub = createApp(repo, extend, { request: withRequest({ repo, hosted: true, membership: null }) })
})
afterAll(() => removeFixtureRepo(repo))

describe('the public viewer (L5 spec §9.5)', () => {
  it('registries answer only public records; a collection with none is absent from the list', async () => {
    const list = (await get(pub, '/api/registries')).body as { name: string; count: number | null }[]
    expect(list.map(r => r.name).sort()).toEqual(['members', 'projects', 'proposals'])
    expect(list.find(r => r.name === 'projects')!.count).toBe(1)
    expect(list.find(r => r.name === 'members')!.count).toBe(1)

    const projects = await get(pub, '/api/registries/projects')
    expect(projects.body.entries).toEqual([{
      id: 'proj-pub', title: 'Public Project', status: 'execute', type: 'program', lead: 'bruno', contributors: ['ana'], visibility: 'public',
    }])
    expect((await get(pub, '/api/registries/members')).body.entries).toEqual([{ id: 'ana', name: 'Ana', kind: 'person', visibility: 'public' }])
    expect((await get(pub, '/api/registries/ideas')).body.entries).toEqual([])
    expect((await get(pub, '/api/registries/governance')).body.document).toEqual({})
    for (const path of ['/api/registries', '/api/registries/projects', '/api/registries/members', '/api/registries/proposals']) {
      expect((await get(pub, path)).text).not.toContain('SECRET')
    }
  })

  it('resources and graph drop non-public nodes and edges to them; counts follow', async () => {
    const nodes = (await get(pub, '/api/resources')).body as (Resource & { visibility: string })[]
    expect(nodes.map(n => n.id).sort()).toEqual(['person:ana', 'project:proj-pub', `proposal:${P1}`])
    expect(nodes.every(n => n.visibility === 'public' && n.attention === null && n.changed === null)).toBe(true)
    expect(nodes.find(n => n.id === 'person:ana')!.facts).not.toHaveProperty('handles')

    const graph = (await get(pub, '/api/graph/organization')).body as { nodes: Resource[]; edges: { from: string; to: string; kind: string }[]; portals: unknown[] }
    expect(graph.nodes).toHaveLength(3)
    expect(graph.edges).toContainEqual({ from: 'project:proj-pub', to: 'person:ana', kind: 'member' })
    expect(graph.edges).toContainEqual({ from: `proposal:${P1}`, to: 'project:proj-pub', kind: 'touches' })
    const ids = new Set(graph.nodes.map(n => n.id))
    expect(graph.edges.every(e => ids.has(e.from) && ids.has(e.to))).toBe(true) // none to bruno, the lead, who is members'
    expect(graph.portals).toEqual([])
    expect((await get(pub, '/api/graph/systems')).body.nodes).toEqual([])

    const one = (await get(pub, '/api/resources/project:proj-pub')).body
    expect(one.neighbours.map((n: Resource) => n.id).sort()).toEqual(['person:ana', `proposal:${P1}`])
    expect((await get(pub, '/api/resources/project:proj-mem')).status).toBe(404)
    for (const path of ['/api/resources', '/api/graph/organization', '/api/graph/systems', '/api/resources/project:proj-pub']) {
      expect((await get(pub, path)).text).not.toContain('SECRET')
    }
  })

  it('proposals: only public ones, without the readings of their acts or a restricted field, and nothing built for a visit', async () => {
    const refs = git(repo, 'for-each-ref')
    const list = (await get(pub, '/api/proposals')).body as Record<string, any>[]
    expect(list.map(p => p.id)).toEqual([P1])
    expect(list[0]!.visibility).toBe('public')
    expect(list[0]!.ops[0]).toMatchObject({ op: 'update', record: 'projects:proj-pub', set: { status: 'develop' } })
    expect(list[0]!).not.toHaveProperty('opened_as')
    expect(list[0]!.derived).toBe('approving') // what the machine derived comes with it

    const one = await get(pub, `/api/proposals/${P1}`)
    expect(one.status).toBe(200)
    expect(one.body).toMatchObject({ id: P1, diff: null, note: PUBLIC_NO_DIFF, visibility: 'public' })
    expect(one.body.current[0]).not.toHaveProperty('budget')
    const hidden = await get(pub, `/api/proposals/${P2}`)
    expect(hidden).toMatchObject({ status: 404, body: { error: `The ledger has no proposal ${P2}.` } })
    expect(git(repo, 'for-each-ref')).toBe(refs)
    for (const path of ['/api/proposals', `/api/proposals/${P1}`, `/api/proposals/${P2}`]) expect((await get(pub, path)).text).not.toContain('SECRET')
  })

  it('library, changes, actor and the other members\' reads: 401', async () => {
    for (const path of ['/api/library', '/api/library/receipts', '/api/changes', '/api/actor', '/api/governance/decisions/x', '/api/visibility']) {
      const res = await get(pub, path)
      expect([path, res.status, res.body]).toEqual([path, 401, { error: MEMBERS_ONLY, code: 'SIGN_IN' }])
    }
  })

  it('/api/status gives only the org name; /api/governance only what the governance document makes public', async () => {
    expect((await get(pub, '/api/status')).body).toEqual({ org: orgName(repo) })
    expect((await get(pub, '/api/governance')).body).toEqual({ model: null, description: null, rules: [], decisions: [], problems: [] })
  })

  it('publicProjection equals what a public viewer gets from the three routes (L8 and L9 rely on it)', async () => {
    const projection = await publicProjection(repo, { graph: () => store.graph(), now: NOW })
    const listed = ((await get(pub, '/api/registries')).body as { name: string; kind: string }[]).filter(r => r.kind === 'collection')
    const registries: Record<string, unknown[]> = {}
    for (const r of listed) registries[r.name] = (await get(pub, `/api/registries/${r.name}`)).body.entries
    expect(projection.registries).toEqual(registries)
    expect(projection.resources).toEqual((await get(pub, '/api/resources')).body)
    expect(projection.proposals).toEqual((await get(pub, '/api/proposals')).body)
    // Without a server: the repository's own graph, read the same way.
    expect((await publicProjection(repo, { now: NOW })).resources.map(n => n.id).sort()).toEqual(projection.resources.map(n => n.id).sort())
  })

  it('publicProjection fails where GET /api/proposals fails: a ledger that cannot be read is never an empty list', async () => {
    const r = makeChangeRepo(GOVERNANCE)
    try {
      writeFileSync(join(r, 'data', 'visibility.yaml'), VISIBILITY_YAML)
      writeFileSync(join(r, 'data', 'proposals.yaml'), 'schema_version: "2.0"\nproposals: [ { id: "p-1", title: "unclosed"\n')
      const app = createApp(r, a => mountProposals(a, { repo: r, withLock: fn => fn(), startBranch: 'main', now: () => NOW }),
        { request: withRequest({ repo: r, hosted: true, membership: null }) })
      const route = await get(app, '/api/proposals')
      expect(route.status).toBeGreaterThanOrEqual(400)
      await expect(publicProjection(r, { graph: async () => ({ nodes: [], edges: [] }), now: NOW })).rejects.toThrow(route.body.error)
    } finally { removeFixtureRepo(r) }
  })
})

describe('a member (locally, git\'s identity: all of git, as 0.6)', () => {
  it('every git record, with visibility set on it', async () => {
    as('bruno')
    const projects = (await get(local, '/api/registries/projects')).body.entries as Record<string, unknown>[]
    expect(projects.map(p => [p.id, p.visibility, p.budget ?? null])).toEqual([['proj-pub', 'public', 'SECRET-budget'], ['proj-mem', 'members', null]])
    expect((await get(local, '/api/registries/ideas')).body.entries).toEqual([{ id: 'idea-1', title: 'SECRET-idea', status: 'open', visibility: 'members' }])
    const list = (await get(local, '/api/registries')).body as { name: string; count: number }[]
    expect(list.find(r => r.name === 'projects')!.count).toBe(2)
    const nodes = (await get(local, '/api/resources')).body as (Resource & { visibility: string })[]
    expect(nodes.find(n => n.id === 'project:proj-mem')!.visibility).toBe('members')
    const proposals = (await get(local, '/api/proposals')).body as { id: string; visibility: string }[]
    expect(proposals.map(p => [p.id, p.visibility])).toEqual([[P1, 'public'], [P2, 'members']])
    expect((await get(local, `/api/proposals/${P2}`)).body.visibility).toBe('members')
  })

  it('a record read through the gate and saved back unchanged writes no visibility of its own', async () => {
    as('bruno')
    const members = (await get(local, '/api/registries/members')).body.entries as Record<string, unknown>[]
    const bruno = members.find(m => m.id === 'bruno')!
    expect(bruno.visibility).toBe('members') // the collection's, inherited: bruno's entry has none of its own
    const res = await local.request('/api/changes/ops', json('POST', { ops: [{ op: 'replace', record: 'members:bruno', value: { ...bruno, notes: 'SECRET-bruno, again' } }] }))
    expect(res.status).toBe(200)
    expect((await res.json()).ops[0].value).not.toHaveProperty('visibility')
    // A level that differs is the writer's own, and is kept.
    const widened = await local.request('/api/changes/ops', json('POST', { ops: [{ op: 'replace', record: 'members:bruno', value: { ...bruno, visibility: 'public' } }] }))
    expect((await widened.json()).ops[0].value.visibility).toBe('public')
    expect((await local.request('/api/changes', { method: 'DELETE' })).status).toBe(204)
  })

  it('a revise built from a record read through the gate writes no visibility of its own into the ledger', async () => {
    as('bruno')
    const projects = (await get(local, '/api/registries/projects')).body.entries as Record<string, unknown>[]
    const gated = projects.find(p => p.id === 'proj-pub')!
    expect(gated.visibility).toBe('public') // the collection's default, inherited: the entry has none of its own
    const trunk = readRegistry(repo, 'projects').entries!
    const entryOf = (id: string) => trunk.find(e => e.id === id)! as Record<string, unknown>
    // P2 keeps its members' op (it stays a members' proposal) and gains a replace of the public project as read.
    const ops = [
      { op: 'update', record: 'projects:proj-mem', set: { status: 'execute' }, base: baseOf(entryOf('proj-mem')) },
      { op: 'replace', record: 'projects:proj-pub', value: { ...gated, title: 'Public Project, revised' }, base: baseOf(entryOf('proj-pub')) },
    ]
    const res = await local.request(`/api/proposals/${P2}/revise`, json('POST', { ops }))
    expect(res.status).toBe(200)
    const ledger = readLedger(repo).entries.find(e => String(e.id) === P2)!
    const replaced = (ledger.ops as Record<string, unknown>[]).find(op => op.record === 'projects:proj-pub')!
    expect(replaced.value).toMatchObject({ title: 'Public Project, revised' })
    expect(replaced.value).not.toHaveProperty('visibility')
  })
})

describe('the gate itself', () => {
  const member = (roles: string[] = []) => ({ kind: 'member' as const, id: 'ana', hats: [], roles })
  const node = (id: string, kind: Resource['kind'] = 'absent'): Resource =>
    ({ id, kind, board: 'systems', name: id, status: null, attention: { level: 'warn', text: 'x' }, changed: null, facts: {}, source: null })

  it('gateItems leaves out what the viewer may not see and puts the level on the rest', () => {
    const items = [{ id: 'a', l: PUBLIC }, { id: 'b', l: MEMBERS }]
    expect(gateItems(PUBLIC_VIEWER, items, i => i.l).map(i => [i.id, i.visibility])).toEqual([['a', 'public']])
    expect(gateItems(member(), items, i => i.l).map(i => [i.id, i.visibility])).toEqual([['a', 'public'], ['b', 'members']])
  })

  it('the server\'s own attention is for maintainers when hosted, for whoever is at the machine locally, never the public (§10.4)', () => {
    const graph = { nodes: [node('absent:server:backup'), node('absent:records')], edges: [] }
    const hosted = new Levels(repo, readConfig(repo), attentionLevel(true))
    expect(gateGraph(PUBLIC_VIEWER, graph, hosted).nodes).toEqual([])
    expect(gateGraph(member(), graph, hosted).nodes.map(n => n.id)).toEqual(['absent:records'])
    expect(gateGraph(member(['maintainer']), graph, hosted).nodes.map(n => [n.id, n.visibility]))
      .toEqual([['absent:server:backup', 'role:maintainer'], ['absent:records', 'members']])
    const local = new Levels(repo, readConfig(repo), attentionLevel(false))
    expect(gateGraph(member(), graph, local).nodes.map(n => n.id)).toEqual(['absent:server:backup', 'absent:records'])
    expect(gateGraph(PUBLIC_VIEWER, graph, local).nodes).toEqual([])
    expect(attentionLevel(undefined)).toEqual(attentionLevel(true))
  })

  it('a public proposal shows the public no hat reading (rule 9) and only the public fields of what its ops carry', () => {
    const config = { collections: { proposals: { default: 'public' as const, fields: {} }, projects: { default: 'public' as const, fields: { budget: 'members' } } }, defaults: {} }
    const reading = { hat: 'eip155:42220:0x0000000d00010000000000000000000000000000000000000000000000000000', account: 'eip155:42220:0x00000000000000000000000000000000000000a1', block: 1, readAt: '2026-10-29T12:00:00Z' }
    const entry = {
      id: 'p-1', title: 'Move it', opened_as: reading, closed: { by: 'bruno', as: reading },
      events: [{ kind: 'approve', by: 'bruno', as: reading }],
      ops: [{ op: 'update', record: 'projects:p', set: { status: 'develop', budget: 'SECRET' }, before: { id: 'p', status: 'execute', budget: 'SECRET' } }],
    }
    expect(gateRecord(PUBLIC_VIEWER, 'proposals', entry, config)).toEqual({
      id: 'p-1', title: 'Move it', closed: { by: 'bruno' }, events: [{ kind: 'approve', by: 'bruno' }],
      ops: [{ op: 'update', record: 'projects:p', set: { status: 'develop' }, before: { id: 'p', status: 'execute' } }], visibility: 'public',
    })
    expect(gateRecord(member(), 'proposals', entry, config)).toEqual({ ...entry, visibility: 'public' })
  })

  it('a public proposal shows the public neither what its revise events wrote beyond public fields nor its ratify\'s readings; a revision that touched a members\' record keeps it members\' (final review MF-1)', () => {
    const config = {
      collections: {
        proposals: { default: 'public' as const, fields: {} },
        projects: { default: 'public' as const, fields: { budget: 'members' } },
        ideas: { default: 'members' as const, fields: {} },
      },
      defaults: {},
    }
    const account = 'eip155:42220:0x00000000000000000000000000000000000000a1'
    const reading = { hat: 'eip155:42220:0x0000000d00010000000000000000000000000000000000000000000000000000', account, block: 1, readAt: '2026-10-29T12:00:00Z' }
    const entry = {
      id: 'p-2', title: 'Fund it', rev: 'r2', touched: 'public',
      closed: { by: 'steward-b', as: reading, checked: [{ ...reading, wears: true }] },
      events: [
        { kind: 'revise', by: 'steward-a', rev: 'r2', ops: [{ op: 'update', record: 'projects:p', set: { title: 'Fund it', budget: 'SECRET-MEMBERS-ONLY' }, before: { id: 'p', title: 'Plan', budget: 'SECRET-BEFORE' } }] },
        { kind: 'approve', by: 'steward-b', rev: 'r2', as: reading },
      ],
      ops: [{ op: 'update', record: 'projects:p', set: { title: 'Fund it' } }],
    }
    const shown = gateRecord(PUBLIC_VIEWER, 'proposals', entry, config, PUBLIC)
    expect(shown).toEqual({
      id: 'p-2', title: 'Fund it', rev: 'r2', touched: 'public', closed: { by: 'steward-b' },
      events: [
        { kind: 'revise', by: 'steward-a', rev: 'r2', ops: [{ op: 'update', record: 'projects:p', set: { title: 'Fund it' }, before: { id: 'p', title: 'Plan' } }] },
        { kind: 'approve', by: 'steward-b', rev: 'r2' },
      ],
      ops: [{ op: 'update', record: 'projects:p', set: { title: 'Fund it' } }], visibility: 'public',
    })
    expect(JSON.stringify(shown)).not.toContain('SECRET')
    expect(JSON.stringify(shown)).not.toContain(account)
    // A member still reads every event and reading as recorded.
    expect(gateRecord(member(), 'proposals', entry, config, PUBLIC)).toEqual({ ...entry, visibility: 'public' })

    // The proposal's level judges what its revisions wrote, not only its current ops.
    const levels = new Levels(repo, config)
    expect(levels.proposal(entry)).toEqual(PUBLIC)
    // Revised, with no `touched` (written before L9 Ruling T12-1): what it was opened on is unknown, so it is members'.
    const { touched: _touched, ...legacy } = entry
    expect(levels.proposal(legacy)).toEqual(MEMBERS)
    const touched = {
      ...entry,
      events: [{ kind: 'revise', by: 'steward-a', rev: 'r1', ops: [{ op: 'update', record: 'ideas:i-1', set: { title: 'SECRET-IDEA' } }] }, ...entry.events],
    }
    expect(levels.proposal(touched)).toEqual(MEMBERS)
    const privately = { ...entry, events: [{ kind: 'revise', by: 'steward-a', rev: 'r1', ops: [{ op: 'private', ref: 'x', class: 'records', digest: 'd' }] }] }
    expect(levels.proposal(privately)).toEqual(MEMBERS)
    expect(gateRecord(PUBLIC_VIEWER, 'proposals', touched, config, levels.proposal(touched))).toBeNull()
  })

  it('gateEvent: the public hears only what names public items; ids are filtered; any other event is members\'', () => {
    const levelOf = (k: string) => (k === 'projects' || k === 'project:a' ? PUBLIC : MEMBERS)
    expect(gateEvent(PUBLIC_VIEWER, { type: 'registry-changed', registry: 'projects' }, levelOf)).toEqual({ type: 'registry-changed', registry: 'projects' })
    expect(gateEvent(PUBLIC_VIEWER, { type: 'registry-changed', registry: 'ideas' }, levelOf)).toBeNull()
    expect(gateEvent(PUBLIC_VIEWER, { type: 'resources-changed', ids: ['project:a', 'project:b'] }, levelOf)).toEqual({ type: 'resources-changed', ids: ['project:a'] })
    expect(gateEvent(PUBLIC_VIEWER, { type: 'resources-changed', ids: ['project:b'] }, levelOf)).toBeNull()
    expect(gateEvent(PUBLIC_VIEWER, { type: 'changes' }, levelOf)).toBeNull()
    expect(gateEvent(member(), { type: 'resources-changed', ids: ['project:a', 'project:b'] }, levelOf)).toEqual({ type: 'resources-changed', ids: ['project:a', 'project:b'] })
    expect(gateEvent(member(), { type: 'changes' }, levelOf)).toEqual({ type: 'changes' })
  })
})

describe('every route that answers items goes through the gate (§9.5)', () => {
  let server: Running
  beforeAll(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}) // hosted with no backup key says so (§10.4), not this test's matter
    server = await startServer({ repo, port: 0, hosted: true, fetch: async () => { throw new Error('no network in this test') } })
  })
  afterAll(async () => { await server.close(); vi.restoreAllMocks() })

  const VALUES: Record<string, string[]> = {
    name: ['projects', 'ideas', 'members', 'governance', 'proposals'],
    board: ['organization', 'systems'],
  }
  const fill = (path: string): string[] => {
    const params = path.split('/').filter(s => s.startsWith(':'))
    let out = [path]
    for (const p of params) {
      const key = p.replace(/^:/, '').replace(/\{.+\}$/, '')
      const values = VALUES[key] ?? (key === 'id' ? [P1, P2, 'project:proj-mem', 'project:proj-pub', 'home', 'proj-mem'] : ['x'])
      out = out.flatMap(o => values.map(v => o.replace(p, encodeURIComponent(v))))
    }
    return out
  }

  it('the public is refused every read but the gated ones, and no answer holds what is not public', async () => {
    const routes = server.app.routes.filter(r => r.method === 'GET' && r.path.startsWith('/api/') && r.path !== '/api/*')
    const paths = [...new Set(routes.map(r => r.path))]
    expect(paths.length).toBeGreaterThan(30)
    for (const listed of PUBLIC_READS) expect(paths).toContain(listed) // no stale entry
    const leaks: string[] = []
    for (const route of paths) {
      for (const path of fill(route)) {
        const res = await fetch(`http://localhost:${server.port}${path}`)
        const text = await res.text()
        if (!PUBLIC_READS.includes(route)) expect([route, res.status, JSON.parse(text)]).toEqual([route, 401, { error: MEMBERS_ONLY, code: 'SIGN_IN' }])
        if (text.includes('SECRET')) leaks.push(path)
      }
    }
    expect(leaks).toEqual([])
  })
})

describe('GET /api/visibility (§11.2, §13)', () => {
  const CELO = 'eip155:42220'
  const TOP = `${CELO}:0x0000000d${'0'.repeat(56)}`
  const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
  const STEWARDS = `${CELO}:0x0000000d00010001${'0'.repeat(48)}`
  const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
  const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`
  const cleanup: string[] = []
  const stores: PrivateStore[] = []
  afterEach(() => {
    for (const s of stores.splice(0)) s.close()
    for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('gives the tree\'s hats with their names and above, the session\'s worn hats, the levels it may give; the public 401', async () => {
    const r = makeChangeRepo(`schema_version: "2.0"\ngovernance:\n  model: "solo-maintainer"\n  membership: { tree: hats-main }\n  roles:\n    council: { hat: "${COUNCIL}" }\n    stewards: { hat: "${STEWARDS}" }\n  decisions: []\n`)
    cleanup.push(r)
    writeFileSync(join(r, 'data', 'systems.yaml'), `schema_version: "2.0"\nsystems:\n  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }\n`)
    git(r, 'add -A'); git(r, 'commit -qm "fixture: the tree"')
    const dir = mkdtempSync(join(tmpdir(), 'visibility-store-')); cleanup.push(dir)
    const privateStore = await openPrivateStore(r, { dir }); stores.push(privateStore)
    const now = () => NOW
    const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, hats: [STEWARDS], block: 100, readAt: NOW.toISOString() })
    const reader = { wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)), wearers: vi.fn() }
    const membership = new Membership({ repo: r, reader: reader as never, now })
    const read = vi.fn(async () => ({ ok: true, readAt: NOW.toISOString(), facts: { hats: [{ id: TOP }, { id: COUNCIL }, { id: STEWARDS }, { id: OPS }] }, sections: [], open: null }))
    const app = createApp(r, a => {
      mountSession(a, { repo: r, store: privateStore, membership, hosted: true, now })
      mountVisibility(a, { repo: r, membership, systems: { read } as never })
    }, { request: withRequest({ repo: r, hosted: true, membership, store: privateStore, now }) })
    await membership.forAct(A1)
    const { token } = await createSession(privateStore, A1, now)
    const res = await app.request('/api/visibility', { headers: { cookie: `house_session=${token}` } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tree).toEqual([
      { hat: TOP, name: '0x0000000d', above: [] },
      { hat: COUNCIL, name: 'council', above: [TOP] },
      { hat: STEWARDS, name: 'stewards', above: [COUNCIL, TOP] },
      { hat: OPS, name: '0x0000000d.0002', above: [TOP] },
    ])
    expect(body.worn).toEqual([STEWARDS])
    expect(body.levels).toEqual(['public', 'members', `hat:${STEWARDS}`, 'role:stewards'])
    expect(body.config).toEqual({ collections: {}, defaults: {} })
    const anyone = await app.request('/api/visibility')
    expect([anyone.status, await anyone.json()]).toEqual([401, { error: MEMBERS_ONLY, code: 'SIGN_IN' }])
  })
})
