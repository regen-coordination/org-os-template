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
import type { WearerReading, WearersReading } from '../../server/systems/hats.ts'

// The walk's I3 and W6 (G8): the deciders of a role sourced from a hat are known only as far as someone's reading says
// who wears it. A non-decider author's own reading names no Council wearer, so their view read "Cannot be met: only 0
// councils… Withdraw it" while the Council member, whose reading names themself, read "needs 1 more approval" and
// ratified. The author must see the verdict the Council member sees: a hat's wearers can change on the chain, so a rule
// decided by a hat is never "cannot be met". A fresh repository under the temp directory, its store in a temp folder, a
// fake Hats reader (no network).

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000A1`
const T0 = new Date('2026-10-29T10:00:00.000Z')

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
/** steward-a commits here (admin-test@local) and wears nothing; the Council wearer A1 has no member record. */
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

async function house() {
  const repo = makeChangeRepo(GOVERNANCE)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree and its members"')
  const dir = mkdtempSync(join(tmpdir(), 'hat-deciders-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const now = () => T0
  const reader = {
    wearer: vi.fn(async (_s: Record<string, unknown>, account: string): Promise<WearerReading> =>
      ({ ok: true, system: 'hats-main', chain: CELO, account, hats: account === A1 ? [COUNCIL] : [], block: 100, readAt: T0.toISOString() })),
    wearers: vi.fn(async (_s: Record<string, unknown>, hat: string): Promise<WearersReading> =>
      ({ ok: true, system: 'hats-main', hat, wearers: [A1], holders: [A1], complete: false, block: 100, readAt: T0.toISOString() })),
  }
  const membership = new Membership({ repo, reader, now })
  const app = createApp(repo, (a, ctx) => {
    mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now })
  }, { request: withRequest({ repo, hosted: false, membership, store, now }) })
  const signIn = async (account: string) => {
    await membership.forAct(account)
    const { token } = await createSession(store, account, now)
    return `house_session=${token}`
  }
  return { app, signIn }
}

function call(app: Hono, method: string, path: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: 'localhost:4680' }
  if (method !== 'GET') headers['content-type'] = 'application/json'
  if (o.cookie) headers.cookie = o.cookie
  return app.request(`http://localhost:4680${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
}

describe('a rule decided by a hat, seen by an author who does not wear it (walk I3, W6)', () => {
  it('the author sees the verdict the Council member sees: needs one approval, never "cannot be met" nor "Withdraw it"', async () => {
    const { app, signIn } = await house()
    const staged = await call(app, 'POST', '/api/changes/ops', { body: { ops: [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }] } })
    expect(staged.status, await staged.clone().text()).toBe(200)
    const opened = await call(app, 'POST', '/api/proposals', { body: { title: 'Move one project' } })
    expect(opened.status, await opened.clone().text()).toBe(201)
    const id = String((await opened.json()).id)

    const council = await signIn(A1)
    const asAuthor = await (await call(app, 'GET', `/api/proposals/${id}`)).json()
    const asCouncil = await (await call(app, 'GET', `/api/proposals/${id}`, { cookie: council })).json()
    for (const view of [asAuthor, asCouncil]) {
      expect(view.evaluation.state).toBe('pending')
      expect(view.evaluation.blocked).toBeUndefined()
      expect(view.evaluation.missing).not.toMatch(/cannot be met|withdraw|only 0/i)
    }
    expect(asAuthor.evaluation.missing).toBe(asCouncil.evaluation.missing)
    expect(asAuthor.evaluation.missing).toBe('needs 1 more approval from a council other than the author')
    // and the list of proposals says the same
    const listed = await (await call(app, 'GET', '/api/proposals')).json()
    expect(listed.find((p: { id: string }) => p.id === id).evaluation.missing).toBe(asCouncil.evaluation.missing)

    const approved = await call(app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'approve' }, cookie: council })
    expect(approved.status, await approved.clone().text()).toBe(200)
    const after = await (await call(app, 'GET', `/api/proposals/${id}`)).json()
    expect(after.evaluation.state).toBe('met')
  })
})
