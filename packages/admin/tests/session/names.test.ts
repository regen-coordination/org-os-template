// Walk fix wave 4 (G9: W1, W2, W5, M13): who someone is, said one way. History names the commit's Org-Actor, never git's
// author name ("admin-test"); a Council wearer no member holds is "Council · 0x0000…00A1" in comments, presence and a
// proposal's events, never "council" nor their CAIP-10 id; a proposal's author is their name ("Steward A", not
// "steward-a"). Fresh repositories under the temp directory (makeChangeRepo, git's identity admin-test@local, steward-a's),
// a fake Hats reader; no network.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { Membership } from '../../server/session/membership.ts'
import { createSession } from '../../server/session/sessions.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { readResources } from '../../server/resources/index.ts'
import { actorNames, namesFor } from '../../server/workspace/conversation.ts'
import type { WearerReading, WearersReading } from '../../server/systems/hats.ts'
import type { KnownActor } from '../../server/actor.ts'

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000A1`
const T0 = new Date('2026-10-29T10:00:00.000Z')
const COUNCIL_A1 = 'Council · 0x0000…00A1'

const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: council, method: approve, count: 1 } }
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const MEMBERS = `schema_version: "2.0"
members:
  - id: "steward-a"
    name: "Steward A"
    kind: "person"
    handles:
      git: ["admin-test@local"]
  - id: "ana"
    name: "Ana Silva"
    kind: "person"
`

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function house(governance = GOVERNANCE) {
  const repo = makeChangeRepo(governance)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree and its members"')
  const dir = mkdtempSync(join(tmpdir(), 'names-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const now = () => T0
  const reader = {
    wearer: vi.fn(async (_s: Record<string, unknown>, account: string): Promise<WearerReading> =>
      ({ ok: true, system: 'hats-main', chain: CELO, account, hats: account === A1 ? [COUNCIL] : [], block: 100, readAt: T0.toISOString() })),
    wearers: vi.fn(async (_s: Record<string, unknown>, hat: string): Promise<WearersReading> =>
      ({ ok: true, system: 'hats-main', hat, wearers: [A1], holders: [A1], complete: true, block: 100, readAt: T0.toISOString() })),
  }
  const membership = new Membership({ repo, reader, now })
  const app = createApp(repo, (a, ctx) => {
    mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now, membership })
  }, { request: withRequest({ repo, hosted: false, membership, store, now }), membership })
  const signIn = async (account: string) => {
    await membership.forAct(account)
    const { token } = await createSession(store, account, now)
    return `house_session=${token}`
  }
  return { app, repo, membership, signIn }
}

function call(app: Hono, method: string, path: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: 'localhost:4680' }
  if (method !== 'GET') headers['content-type'] = 'application/json'
  if (o.cookie) headers.cookie = o.cookie
  return app.request(`http://localhost:4680${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
}
const ok = async (res: Response | Promise<Response>, status = 200) => {
  const r = await res
  expect(r.status, await r.clone().text()).toBe(status)
  return r.json() as Promise<any>
}

describe('history names the Org-Actor, not git\'s author name (walk W1)', () => {
  it('a record applied through the house by steward-a (git: admin-test) was last changed by Steward A', async () => {
    const solo = GOVERNANCE.replace('model: "consensus"', 'model: "solo-maintainer"').replace(/  rules:\n.*\n/, '')
    const { app, repo, membership } = await house(solo)
    await ok(call(app, 'POST', '/api/changes/ops', { body: { ops: [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }] } }))
    await ok(call(app, 'POST', '/api/changes/apply', { body: {} }))
    expect(git(repo, 'log -1 --format=%an').trim()).toBe('admin-test')
    const graph = await readResources(repo, { membership })
    expect(graph.nodes.find(n => n.id === 'project:proj-001')!.changed).toMatchObject({ by: 'Steward A' })
  })
})

describe('a Council wearer no member holds is "Council · 0x0000…00A1" (walk W2, M13)', () => {
  it('in comments and presence', async () => {
    const { repo, membership } = await house()
    await membership.forAct(A1)
    expect(namesFor(repo, membership)(A1)).toEqual({ handle: '0x0000…00A1', role: COUNCIL_A1 })
    expect(namesFor(repo, membership)('steward-a')).toEqual({ handle: 'steward-a', role: 'Steward A' })
    const signedIn = { id: A1, name: COUNCIL_A1, kind: 'person', via: 'siwe', account: A1, hats: [COUNCIL], reading: { block: 100, readAt: T0.toISOString() } } as unknown as KnownActor
    expect(actorNames(repo, membership)(signedIn)).toEqual({ handle: '0x0000…00A1', role: COUNCIL_A1 })
  })

  it('on a proposal: its author by name, an approval by the hat and short address', async () => {
    const { app, signIn } = await house()
    await ok(call(app, 'POST', '/api/changes/ops', { body: { ops: [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }] } }))
    const id = String((await ok(call(app, 'POST', '/api/proposals', { body: { title: 'Move one project' } }), 201)).id)
    const council = await signIn(A1)
    await ok(call(app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'approve' }, cookie: council }))
    const view = await ok(call(app, 'GET', `/api/proposals/${id}`))
    expect(view.names).toEqual({ 'steward-a': 'Steward A', [A1]: COUNCIL_A1 })
    const listed = (await ok(call(app, 'GET', '/api/proposals'))).find((p: { id: string }) => p.id === id)
    expect(listed.names).toEqual(view.names)
  })
})
