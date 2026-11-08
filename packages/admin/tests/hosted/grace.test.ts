import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { viewerOf, withRequest } from '../../server/request.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { HATS_FRESH_MS, Membership } from '../../server/session/membership.ts'
import { createSession } from '../../server/session/sessions.ts'
import { mountSession } from '../../server/session/routes.ts'
import { FAILED_READ_TTL_MS } from '../../server/systems/driver.ts'
import type { WearerReading } from '../../server/systems/hats.ts'
import type { WearerRefusal } from '../../server/systems/reader.ts'

// L9 spec §5.8 (carry 3 and the finding): a session with no reading past the grace, or whose reading shows no hat,
// reads as the public; a session whose account wears nothing costs one reader call per HATS_FRESH_MS. A hosted house on
// a fresh repository under the temp directory (makeChangeRepo), a private store in a temp folder of its own and a fake
// Hats reader (no network, S13). A new Membership is a restart: it keeps no reading.

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
// EIP-55 of …a1 (the letter is upper case), as tests/session/membership.test.ts computed it apart from lib/caip.mjs.
const A1_ID = `${CELO}:0x00000000000000000000000000000000000000A1`
const T0 = new Date('2026-10-30T10:00:00.000Z')
const MINUTE = 60_000
const later = (ms: number) => new Date(T0.getTime() + ms)
const BAND = 'Your hats could not be read for an hour; you see what anyone sees until they can be.'
const NOT_WORN = (block: number) =>
  `You no longer wear a hat of this organisation's Hats tree (read at block ${block}), so you cannot change anything here. Nothing was written.`

const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
  decisions: []
`
/** steward-a is public; steward-b is members' (the collection's default), and carries a sentinel the public must not read. */
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: "Steward A", kind: person, visibility: public, handles: { git: ["admin-test@local"] } }
  - { id: steward-b, name: "Steward B", kind: person, notes: "SENTINEL-members-1" }
`
const PROJECT = { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }

type Answer = (account: string, at: Date) => WearerReading | WearerRefusal
const wears = (hats: string[], block = 100): Answer => (account, at) => ({ ok: true, system: 'hats-main', chain: CELO, account, hats, block, readAt: at.toISOString() })
const FAILED: Answer = () => ({ ok: false, failed: true, error: 'the tree could not be read: rpc down' })

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A hosted house: the app (request middleware, gate, session routes), and a bare app with the same middleware that
 *  answers the viewer it set (the house refuses the public a probe, Task 13 of L5). */
async function house(answer: Answer) {
  const repo = makeChangeRepo(GOVERNANCE); cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree and its members"')
  const dir = mkdtempSync(join(tmpdir(), 'grace-store-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const state = { clock: T0, answer }
  const now = () => state.clock
  const reader = {
    wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => state.answer(account, state.clock)),
    wearers: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
  }
  const membership = new Membership({ repo, reader, now })
  const deps = { repo, hosted: true, membership, store, now }
  const app = createApp(repo, a => mountSession(a, deps), { request: withRequest(deps) })
  const bare = new Hono()
  bare.use('/api/*', withRequest(deps))
  bare.get('/api/viewer', c => c.json(viewerOf(c)))
  /** A session made at the clock's time, as a sign-in that passed makes it; no reading is kept (as after a restart). */
  const session = async () => `house_session=${(await createSession(store, A1_ID, now)).token}`
  /** A sign-in that passed: the reading kept, then the session. */
  const signIn = async () => { await membership.forAct(A1_ID); return session() }
  const viewer = async (cookie: string) => (await bare.request('http://localhost:4680/api/viewer', { headers: { cookie } })).json()
  return { app, state, reader, session, signIn, viewer }
}

function call(app: Hono, method: string, path: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: 'localhost:4680' }
  if (method !== 'GET') headers['content-type'] = 'application/json'
  if (o.cookie) headers.cookie = o.cookie
  return app.request(`http://localhost:4680${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
}
/** The members registry as the session reads it: the ids answered, and the whole text. */
async function members(app: Hono, cookie: string) {
  const res = await call(app, 'GET', '/api/registries/members', { cookie })
  expect(res.status).toBe(200)
  const text = await res.text()
  return { ids: (JSON.parse(text).entries as { id: string }[]).map(e => e.id), text }
}
const session = async (app: Hono, cookie: string) => (await call(app, 'GET', '/api/session', { cookie })).json()
const settle = () => new Promise(r => setTimeout(r, 0))
const MEMBER = (hats: string[] = [], roles: string[] = []) => ({ kind: 'member', id: A1_ID, hats, roles })

describe('a session with no reading, after a restart (L9 spec §5.8, carry 3)', () => {
  it('after a restart with the tree down, a session older than the grace reads as public', async () => {
    const h = await house(FAILED)
    const cookie = await h.session() // made at T0; the Membership keeps no reading, and the tree cannot be read
    h.state.clock = later(61 * MINUTE)
    const listed = await members(h.app, cookie)
    expect(listed.ids).toEqual(['steward-a'])
    expect(listed.text).not.toContain('SENTINEL')
    expect(await h.viewer(cookie)).toEqual({ kind: 'public' })
    expect(await session(h.app, cookie)).toMatchObject({ signedIn: true, account: A1_ID, hats: [], stale: true, band: BAND })
  })

  it('a session younger than the grace still reads as a member until the first reading lands', async () => {
    const h = await house(FAILED)
    const cookie = await h.session()
    h.state.clock = later(59 * MINUTE)
    expect(await h.viewer(cookie)).toEqual(MEMBER())
    expect((await members(h.app, cookie)).ids).toEqual(['steward-a', 'steward-b'])
    expect(await session(h.app, cookie)).not.toHaveProperty('stale')
    // The tree answers again; once the failed read's back-off is over, a reading lands, and it holds past the grace.
    h.state.answer = wears([COUNCIL])
    h.state.clock = later(59 * MINUTE + FAILED_READ_TTL_MS)
    await h.viewer(cookie); await settle()
    expect(await h.viewer(cookie)).toEqual(MEMBER([COUNCIL], ['council']))
    h.state.clock = later(61 * MINUTE)
    expect(await h.viewer(cookie)).toEqual(MEMBER([COUNCIL], ['council']))
    expect(await session(h.app, cookie)).not.toHaveProperty('stale')
  })
})

describe('a member whose hats were taken off (L9 spec §5.8, the finding)', () => {
  it('reads as public at the next read past HATS_FRESH_MS; members-level records vanish and acts are still NOT_WORN', async () => {
    const h = await house(wears([COUNCIL]))
    const cookie = await h.signIn()
    expect(await h.viewer(cookie)).toEqual(MEMBER([COUNCIL], ['council']))
    expect((await members(h.app, cookie)).ids).toEqual(['steward-a', 'steward-b'])

    h.state.answer = wears([], 150) // taken off on chain while the session is open
    h.state.clock = later(HATS_FRESH_MS)
    expect(await h.viewer(cookie)).toEqual(MEMBER([COUNCIL], ['council'])) // the kept reading, refreshed in the background
    await settle()
    const listed = await members(h.app, cookie)
    expect(listed.ids).toEqual(['steward-a'])
    expect(listed.text).not.toContain('SENTINEL')
    expect(await h.viewer(cookie)).toEqual({ kind: 'public' })
    const got = await session(h.app, cookie)
    expect(got).toMatchObject({ signedIn: true, hats: [] })
    expect(got).not.toHaveProperty('stale') // the tree was read: no band saying it could not be

    const act = await call(h.app, 'POST', '/api/changes/ops', { body: { ops: [PROJECT] }, cookie })
    expect(act.status).toBe(403)
    expect(await act.json()).toEqual({ reason: NOT_WORN(150), error: NOT_WORN(150), code: 'NOT_WORN' })
  })
})

describe('a session whose account wears nothing (L9 spec §5.8, carry 3)', () => {
  it('costs one reader call per HATS_FRESH_MS, not one per request', async () => {
    const h = await house(wears([]))
    const cookie = await h.session() // a session that survived a restart; its account wears nothing now
    for (let i = 0; i < 10; i++) { await members(h.app, cookie); await settle() }
    expect(h.reader.wearer).toHaveBeenCalledTimes(1)
    expect(await h.viewer(cookie)).toEqual({ kind: 'public' })
    expect((await members(h.app, cookie)).ids).toEqual(['steward-a'])

    h.state.clock = later(HATS_FRESH_MS)
    for (let i = 0; i < 10; i++) { await members(h.app, cookie); await settle() }
    expect(h.reader.wearer).toHaveBeenCalledTimes(2)
    expect(await h.viewer(cookie)).toEqual({ kind: 'public' })
  })
})
