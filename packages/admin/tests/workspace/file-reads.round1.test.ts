import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { gateGraph, Levels } from '../../server/visibility/gate.ts'
import type { Graph, Resource } from '../../server/resources/types.ts'
import { blobId } from '../../server/workspace/files.ts'
import {
  AGENT_LAYER, DAY, HOST, ID, MAIL, MEMBER_AT_MACHINE, T0,
  call, cookieFor, house, readable, repoWith,
} from './file-reads.fixtures.ts'

// 0.7.1 (D6), fix round 1: the places the agent layer's text, or a tell of it, still reached a viewer who does not decide
// it — the raw ledger (C1, C2), a revision's own ops (C3), revise, load and apply (I1), crew's seats (I2), and what a
// withheld op, a stale count or a rule with no `by` still said (M1–M3). Synthetic values only: Example DAO.

/** Every member proposes; the council decides the agent layer and everything else. */
const OPEN = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    council: { members: ["${ID.steward}", "${ID.local}"] }
    everyone: { all: true }
  rules:
    - { id: agent-layer, applies_to: ["workspace:agent"], propose: everyone, decide: { by: council, method: direct } }
    - { id: everything, applies_to: [all], propose: everyone, decide: { by: council, method: approve, count: 1 } }
`
/** No workspace rule (WORKSPACE_DIRECT): any member writes the agent layer directly, and the maintainer alone reads it. */
const DIRECT = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    maintainer: { members: ["${ID.steward}"] }
    everyone: { all: true }
  rules:
    - { id: everything, applies_to: [all], propose: everyone, decide: { by: maintainer, method: approve, count: 1 } }
`
const SECRET = 'Synthetic council-only line: the grant shortlist.'
const IDENTITY = '# Example DAO\n\nA synthetic line every member reads.\n'
const LEDGER = 'data/proposals.yaml'
const KEPT = (path: string) => `${path} holds values that not every member may read, so it is not served whole here.`
const NOT_GOVERNED = (path: string) => `${path} is not a governed file, so it has no editor here. Nothing was staged.`

function at(repo: string, email?: string): { app: Hono; post: (path: string, body: unknown) => Promise<Response> } {
  if (email) execSync(`git config user.email ${email}`, { cwd: repo, stdio: 'pipe' })
  const app = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => T0 }))
  const post = async (path: string, body: unknown): Promise<Response> => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { app, post }
}

/** A proposal made at the machine by `email`'s member: a memory day with the secret, and the identity file. */
async function proposed(repo: string, email?: string): Promise<{ id: string; post: (path: string, body: unknown) => Promise<Response> }> {
  const { post } = at(repo, email)
  const staged = await post('/api/changes/ops', { ops: [
    { op: 'file', path: DAY, text: `${AGENT_LAYER[DAY]}\n${SECRET}\n` },
    { op: 'file', path: 'IDENTITY.md', text: IDENTITY },
  ] })
  expect(staged.status).toBe(200)
  const res = await post('/api/proposals', { title: 'Note the shortlist' })
  expect(res.status).toBe(201)
  return { id: String((await res.json()).id), post }
}

const post = (h: { app: Hono }, path: string, cookie: string, body: unknown) => h.app.request(`http://${HOST}${path}`, {
  method: 'POST', headers: { host: HOST, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body),
})

/** Nothing of the agent layer's file: not its text, its path, nor its base. */
function nothingOf(body: unknown, base?: string): void {
  const text = JSON.stringify(body)
  expect(text).not.toContain(SECRET)
  expect(text).not.toContain('treasury review')
  expect(text).not.toContain(DAY)
  if (base) expect(text).not.toContain(base)
}

describe('C1, C3: the ledger as a registry, and a revision\'s ops', () => {
  it('GET /api/registries/proposals and every proposal view withhold the agent layer\'s ops, in events too', async () => {
    const repo = repoWith(OPEN)
    const { id, post: local } = await proposed(repo)
    // Revised at the machine: the revision's event holds its ops (revise.ts), the memory op among them.
    const ledger0 = (await (await createApp(repo).request('/api/registries/proposals')).json()) as { entries: { id: string; ops: { base?: string }[] }[] }
    const base = ledger0.entries.find(e => String(e.id) === id)!.ops[0]!.base!
    const revised = await local(`/api/proposals/${id}/revise`, { ops: [
      { op: 'file', path: DAY, text: `${AGENT_LAYER[DAY]}\n${SECRET}\nAnd a second synthetic line.\n`, base },
      { op: 'file', path: 'IDENTITY.md', text: IDENTITY, base: blobId('# Example DAO\n') },
    ] })
    expect(revised.status).toBe(200)

    const h = await house(repo, { proposals: true })
    const member = await cookieFor(h, MAIL.member)
    const steward = await cookieFor(h, MAIL.steward)
    // The raw ledger, through the registry route.
    const registry = await (await call(h.app, '/api/registries/proposals', member)).json() as { entries: { id: string; ops: unknown[]; events: { kind: string; ops?: unknown[] }[] }[] }
    nothingOf(registry, base)
    const entry = registry.entries.find(e => String(e.id) === id)!
    expect(entry.ops[0]).toEqual({ op: 'file', withheld: true })
    expect(entry.events.find(e => e.kind === 'revise')!.ops![0]).toEqual({ op: 'file', withheld: true })
    expect(JSON.stringify(registry)).toContain('A synthetic line every member reads.')
    expect(JSON.stringify(await (await call(h.app, '/api/registries/proposals', steward)).json())).toContain(SECRET)
    // The views: the page, the list.
    nothingOf(await (await call(h.app, `/api/proposals/${id}`, member)).json(), base)
    nothingOf(await (await call(h.app, '/api/proposals', member)).json(), base)
    const ours = JSON.stringify(await (await call(h.app, `/api/proposals/${id}`, steward)).json())
    expect(ours).toContain('And a second synthetic line.')
  })

  it('the person at the machine is gated in the registry route too (PR7-R98): the proposals page is theirs', async () => {
    const repo = repoWith(OPEN)
    const { id } = await proposed(repo)
    // At the machine as the network member, who does not decide the agent layer.
    const local = at(repo, MEMBER_AT_MACHINE).app
    nothingOf(await (await local.request('/api/registries/proposals')).json())
    expect(JSON.stringify(await (await local.request(`/api/proposals/${id}`)).json())).toContain(SECRET)
  })
})

describe('C2: the ledger file whole', () => {
  it('is kept from a viewer who may not read an op it holds, and its row reads unreadable', async () => {
    const repo = repoWith(OPEN)
    const h0 = await house(repo)
    const member0 = await cookieFor(h0, MAIL.member)
    // No proposal on the agent layer yet: the ledger is every member's.
    expect((await readable(h0.app, member0))[LEDGER]).toBe(true)
    await proposed(repo)
    const h = await house(repo)
    const member = await cookieFor(h, MAIL.member)
    const res = await call(h.app, `/api/files?path=${encodeURIComponent(LEDGER)}`, member)
    expect([res.status, await res.json()]).toEqual([403, { error: KEPT(LEDGER) }])
    expect((await readable(h.app, member))[LEDGER]).toBe(false)
    const steward = await cookieFor(h, MAIL.steward)
    expect((await call(h.app, `/api/files?path=${encodeURIComponent(LEDGER)}`, steward)).status).toBe(200)
    expect((await readable(h.app, steward))[LEDGER]).toBe(true)
  })
})

describe('I1: revise, load and apply ask the same as staging', () => {
  it('a non-decider\'s revise, load and apply on the agent layer are refused as on a path that is not there', async () => {
    const repo = repoWith(DIRECT)
    // The network member proposes at their own machine (before 0.7.1 they could have staged it hosted too).
    const { id } = await proposed(repo, MEMBER_AT_MACHINE)
    const h = await house(repo, { proposals: true, writes: true })
    const member = await cookieFor(h, MAIL.member)
    // Revise: a guessed base no longer tells stale from not (the oracle), and no text is written.
    const guess = blobId(AGENT_LAYER[DAY]!)
    const revise = await post(h, `/api/proposals/${id}/revise`, member, { ops: [
      { op: 'file', path: DAY, text: '# overwritten\n', base: guess },
      { op: 'file', path: 'IDENTITY.md', text: IDENTITY, base: blobId('# Example DAO\n') },
    ] })
    expect([revise.status, await revise.json()]).toEqual([422, { errors: [{ record: DAY, field: 'path', message: NOT_GOVERNED(DAY) }] }])
    const wrong = await post(h, `/api/proposals/${id}/revise`, member, { ops: [{ op: 'file', path: DAY, text: '# overwritten\n', base: blobId('a wrong guess\n') }] })
    expect(wrong.status).toBe(422)
    // Load: the memory op would come back into their tray with its text.
    const load = await post(h, `/api/proposals/${id}/load`, member, {})
    expect([load.status, await load.json()]).toEqual([422, { errors: [{ record: DAY, field: 'path', message: NOT_GOVERNED(DAY) }] }])
    // Apply: a tray that holds one (staged at the machine) is refused before anything is written.
    const head = execSync('git rev-parse HEAD', { cwd: repo }).toString().trim()
    const { post: local } = at(repo, MEMBER_AT_MACHINE)
    await local('/api/changes/ops', { ops: [{ op: 'file', path: 'MEMORY.md', text: '# Memory\n\n- overwritten\n' }] })
    const apply = await post(h, '/api/changes/apply', member, {})
    expect([apply.status, await apply.json()]).toMatchObject([422, { errors: [{ record: 'MEMORY.md', field: 'path', message: NOT_GOVERNED('MEMORY.md') }] }])
    expect(execSync('git rev-parse HEAD', { cwd: repo }).toString().trim()).toBe(head)
  })
})

describe('M2: the tray\'s stale list', () => {
  it('leaves out an op on a path the viewer may not read', async () => {
    const repo = repoWith(DIRECT)
    const { post: local } = at(repo, MEMBER_AT_MACHINE)
    expect((await local('/api/changes/ops', { ops: [
      { op: 'file', path: 'MEMORY.md', text: '# Memory\n\n- mine\n' },
    ] })).status).toBe(200)
    // The file moves on the trunk: the op is stale.
    appendFileSync(join(repo, 'MEMORY.md'), '- a later synthetic line\n')
    execSync('git commit -qam "memory moves"', { cwd: repo, stdio: 'pipe' })
    expect((await (await at(repo).app.request('/api/changes')).json()).stale).toEqual([0])
    const h = await house(repo, { writes: true })
    const member = await cookieFor(h, MAIL.member)
    expect((await (await call(h.app, '/api/changes', member)).json()).stale).toEqual([])
  })
})

describe('M3: a written workspace rule with no deciding role', () => {
  it('is read by nobody signed in, not by the maintainer', async () => {
    const repo = repoWith(`schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    maintainer: { members: ["${ID.steward}"] }
  rules:
    - { id: agent-layer, applies_to: ["workspace:agent"], decide: { method: direct } }
`)
    const h = await house(repo)
    const steward = await cookieFor(h, MAIL.steward)
    expect((await call(h.app, `/api/files?path=${encodeURIComponent(DAY)}`, steward)).status).toBe(404)
  })
})

describe('I2, M1: the map', () => {
  const seat = (id: string, path: string): Resource => ({ id, kind: 'seat', board: 'systems', name: `seat ${id}`, status: 'working', attention: null,
    changed: null, facts: { role: 'builder', branch: 'feat/synthetic', title: 'A synthetic seat', task: null }, source: { path, editable: false } })
  const role: Resource = { id: 'role:builder', kind: 'role', board: 'systems', name: 'builder', status: 'free', attention: null, changed: null,
    facts: {}, source: { path: 'roles/builder.md', editable: false } }
  const proposal: Resource = { id: 'proposal:p-1', kind: 'proposal', board: 'organization', name: 'Note the shortlist', status: 'stale',
    attention: { level: 'alert', text: 'stale: 1 op was staged against a record that has changed' }, changed: null,
    facts: { stale: [0], agentStale: [{ at: 0, path: DAY }], agentAttention: { level: 'warn', text: 'open: 1 approval' }, ops: 2 },
    source: { path: 'data/proposals.yaml', editable: false, registry: 'proposals', entityId: 'p-1' } }
  const graph: Graph = {
    nodes: [seat('seat:s-1', 'memory/crew/s-1.md'), role, proposal],
    edges: [{ from: 'seat:s-1', to: 'role:builder', kind: 'seat-of' }],
  } as unknown as Graph
  const member = { kind: 'member' as const, id: ID.member, hats: [], roles: ['everyone', 'network-member'] }
  const steward = { kind: 'member' as const, id: ID.steward, hats: [], roles: ['council', 'everyone'] }

  it('a seat whose record is in the agent layer, and its edges, are kept from one who may not read it', () => {
    const repo = repoWith(OPEN)
    mkdirSync(join(repo, 'memory', 'crew'), { recursive: true })
    writeFileSync(join(repo, 'memory', 'crew', 's-1.md'), '---\nrole: builder\n---\n')
    const theirs = gateGraph(member, graph, new Levels(repo))
    expect(theirs.nodes.map(n => n.id)).toEqual(['role:builder', 'proposal:p-1'])
    expect(theirs.edges).toEqual([])
    const ours = gateGraph(steward, graph, new Levels(repo))
    expect(ours.nodes.map(n => n.id)).toEqual(['seat:s-1', 'role:builder', 'proposal:p-1'])
    expect(ours.edges).toHaveLength(1)
  })

  it('a proposal stale only on the agent layer is not said stale to one who may not read it (M1)', () => {
    const repo = repoWith(OPEN)
    const theirs = gateGraph(member, graph, new Levels(repo)).nodes.find(n => n.id === 'proposal:p-1')!
    expect(theirs.facts.stale).toEqual([])
    expect(theirs.attention).toEqual({ level: 'warn', text: 'open: 1 approval' })
    expect(theirs.facts).not.toHaveProperty('agentStale')
    expect(theirs.facts).not.toHaveProperty('agentAttention')
    expect(JSON.stringify(theirs)).not.toContain('memory/')
    const ours = gateGraph(steward, graph, new Levels(repo)).nodes.find(n => n.id === 'proposal:p-1')!
    expect(ours.facts.stale).toEqual([0])
    expect(ours.attention?.text).toMatch(/^stale: 1 op/)
    expect(ours.facts).not.toHaveProperty('agentStale')
  })
})
