import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { TEST_EMAIL } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { startServer, type Running } from '../../server/serve.ts'
import { createSession } from '../../server/session/sessions.ts'
import { targetLevel, type Target } from '../../server/workspace/conversation.ts'
import { mountPresence, Presence, PRESENCE_BEAT_MS, PRESENCE_TTL_MS } from '../../server/workspace/presence.ts'
import { EventLevels, gateEvent } from '../../server/visibility/gate.ts'
import { privateReads } from '../../server/private/reads.ts'
import { joinPage } from '../../lib/workspace/pages.mjs'
import type { ParsedLevel, Viewer } from '../../lib/visibility.mjs'
import type { KnownActor } from '../../server/actor.ts'

// DAO-OS L6 §8.4, §8.5, Task 9: presence, in the server's memory only; and the presence and conversation events, heard only
// by connections whose viewer may see the target. Fresh temporary repositories; stores in temp folders; no network; the
// clock injected where time matters. Placeholders only.

const CELO = 'eip155:42220'
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A2 = `${CELO}:0x00000000000000000000000000000000000000a2`
const OPS_PAGE = 'p-0123456789ab'
const ROLE_PAGE = 'p-00000000000a'

const STEWARD_A: KnownActor = { id: 'steward-a', name: 'Steward A', kind: 'person', via: 'git' }
const STEWARD_B: KnownActor = { id: 'steward-b', name: 'Steward B', kind: 'person', via: 'git' }
const OPS_LEAD: KnownActor = { id: 'ops-lead', name: 'Ops Lead', kind: 'person', via: 'git' }
const wearer = (id: string): Viewer => ({ kind: 'member', id, hats: [OPS], roles: [] })
const plain = (id: string): Viewer => ({ kind: 'member', id, hats: [], roles: [] })
const PUBLIC_VIEWER: Viewer = { kind: 'public' }

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('the constants (L6 §8.4)', () => {
  it('are the spec\'s, exactly', () => {
    expect(PRESENCE_BEAT_MS).toBe(20000)
    expect(PRESENCE_TTL_MS).toBe(45000)
  })
})

describe('Presence (in memory, §8.4)', () => {
  const levels: Record<string, ParsedLevel> = {
    'page:open-0001': { level: 'public' }, 'page:guide-0001': { level: 'members' }, [`page:${OPS_PAGE}`]: { level: 'hat', hat: OPS },
  }
  const clock = () => { let t = Date.parse('2026-10-31T12:00:00Z'); return { now: () => t, advance: (ms: number) => { t += ms } } }

  it('presence lapses after 45 s, is shown only to viewers who may see the target, and never to the public', () => {
    const c = clock()
    const p = new Presence({ level: t => levels[t] ?? null, now: c.now })
    const heard: Target[] = []
    p.onChange(t => { heard.push(t) })
    p.beat(STEWARD_A, 'page:guide-0001', true)
    p.beat(OPS_LEAD, `page:${OPS_PAGE}`, false, wearer('ops-lead'))
    p.beat(STEWARD_B, 'page:open-0001', false)
    expect(heard).toEqual(['page:guide-0001', `page:${OPS_PAGE}`, 'page:open-0001'])
    // Others see who is there, not themselves.
    expect(p.of('page:guide-0001', plain('steward-b'))).toEqual([{ handle: 'steward-a', role: 'Steward A', editing: true }])
    expect(p.of('page:guide-0001', plain('steward-a'))).toEqual([])
    // A hat page: only a wearer sees who is there; never the public, not even on a public page.
    expect(p.of(`page:${OPS_PAGE}`, wearer('steward-a'))).toEqual([{ handle: 'ops-lead', role: 'Ops Lead', editing: false }])
    expect(p.of(`page:${OPS_PAGE}`, plain('steward-b'))).toEqual([])
    expect(p.of('page:open-0001', PUBLIC_VIEWER)).toEqual([])
    expect(p.of('page:guide-0001', PUBLIC_VIEWER)).toEqual([])
    // A beat that only renews says nothing new; one that changes `editing` does.
    heard.length = 0
    c.advance(PRESENCE_BEAT_MS)
    p.beat(STEWARD_A, 'page:guide-0001', true)
    expect(heard).toEqual([])
    p.beat(STEWARD_A, 'page:guide-0001', false)
    expect(heard).toEqual(['page:guide-0001'])
    // 45 s after its last beat an entry is gone; the sweep tells the targets that lost someone.
    heard.length = 0
    c.advance(PRESENCE_TTL_MS - PRESENCE_BEAT_MS - 1) // ops-lead: 44 999 ms since the beat
    expect(p.of(`page:${OPS_PAGE}`, wearer('steward-a'))).toHaveLength(1)
    c.advance(1)
    expect(p.of(`page:${OPS_PAGE}`, wearer('steward-a'))).toEqual([])
    p.sweep()
    expect(heard.sort()).toEqual(['page:open-0001', `page:${OPS_PAGE}`])
    expect(p.of('page:guide-0001', plain('steward-b'))).toHaveLength(1) // renewed 25 s ago
    c.advance(PRESENCE_TTL_MS)
    p.sweep()
    expect(p.of('page:guide-0001', plain('steward-b'))).toEqual([])
  })

  it('an entry whose wearer is no longer admitted (the page was narrowed) is not shown', () => {
    const c = clock()
    const level: Record<string, ParsedLevel> = { 'page:guide-0001': { level: 'members' } }
    const p = new Presence({ level: t => level[t] ?? null, now: c.now })
    p.beat(STEWARD_B, 'page:guide-0001', false, plain('steward-b'))
    expect(p.of('page:guide-0001', wearer('steward-a'))).toHaveLength(1)
    level['page:guide-0001'] = { level: 'hat', hat: OPS }
    expect(p.of('page:guide-0001', wearer('steward-a'))).toEqual([])
    expect(p.everyone('page:guide-0001')).toEqual([])
    delete level['page:guide-0001'] // deleted
    expect(p.of('page:guide-0001', wearer('steward-a'))).toEqual([])
  })

  it('POST /api/presence for a target the actor may see; GET /api/presence answers only what the viewer may see', async () => {
    const repo = makeChangeRepo()
    cleanup.push(repo)
    mkdirSync(join(repo, 'pages'), { recursive: true })
    writeFileSync(join(repo, 'pages', 'guide-0001.md'), joinPage({ id: 'guide-0001', title: 'Guide', parent: null, order: 1000 }, 'Text.\n'))
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: a page"')
    const dir = mkdtempSync(join(tmpdir(), 'presence-')); cleanup.push(dir)
    const store = await openPrivateStore(repo, { dir }); stores.push(store)
    await store.putRecord({ collection: 'pages', id: OPS_PAGE, visibility: `hat:${OPS}`, body: { title: 'Ops', parent: null, order: 1, markdown: '' }, rev: 'r' }, 'ops-lead', null)
    const t = Date.parse('2026-10-31T12:00:00Z')
    const presence = new Presence({ level: x => targetLevel(repo, x, store), now: () => t })
    presence.beat(OPS_LEAD, `page:${OPS_PAGE}`, true, wearer('ops-lead'))
    presence.beat(STEWARD_B, 'page:guide-0001', false)
    const app = createApp(repo, (a, ctx) => mountPresence(a, { repo, membership: null, privateStore: ctx.privateStore, presence }),
      { request: withRequest({ repo, hosted: false, membership: null, store }), privateStore: () => store })
    const post = await app.request('/api/presence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'page:guide-0001', editing: true }) })
    expect(post.status).toBe(200)
    expect(await post.json()).toEqual({ target: 'page:guide-0001', people: [{ handle: 'steward-b', role: 'Steward B', editing: false }] })
    // Git's identity in a fixture wears no hat: the Ops page is not there for them.
    const refused = await app.request('/api/presence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: `page:${OPS_PAGE}`, editing: false }) })
    expect(refused.status).toBe(404)
    const got = await app.request(`/api/presence?targets=page:guide-0001,page:${OPS_PAGE},page:nope`)
    expect(await got.json()).toEqual({ 'page:guide-0001': [{ handle: 'steward-b', role: 'Steward B', editing: false }] })
    const bad = await app.request('/api/presence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'nothing' }) })
    expect(bad.status).toBe(400)
  })

  it('R4c 7: on a Hub whose instance writes are off, a beat that says editing is kept as reading', async () => {
    const repo = makeChangeRepo()
    cleanup.push(repo)
    mkdirSync(join(repo, 'pages'), { recursive: true })
    writeFileSync(join(repo, 'pages', 'guide-0001.md'), joinPage({ id: 'guide-0001', title: 'Guide', parent: null, order: 1000 }, 'Text.\n'))
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: a page"')
    const dir = mkdtempSync(join(tmpdir(), 'presence-')); cleanup.push(dir)
    const store = await openPrivateStore(repo, { dir }); stores.push(store)
    const t = Date.parse('2026-10-31T12:00:00Z')
    const presence = new Presence({ level: x => targetLevel(repo, x, store), now: () => t })
    const app = createApp(repo, (a, ctx) => mountPresence(a, { repo, membership: null, privateStore: ctx.privateStore, presence, readOnly: true }),
      { request: withRequest({ repo, hosted: false, membership: null, store }), privateStore: () => store })
    const post = await app.request('/api/presence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'page:guide-0001', editing: true }) })
    expect(post.status).toBe(200)
    const seen = presence.of('page:guide-0001', plain('someone-else'))
    expect(seen).toHaveLength(1)
    expect(seen[0]!.editing).toBe(false)
  })
})

describe('events learn targets (§8.5)', () => {
  it('gateEvent sends a target\'s event only to a member admitted to it, never to the public', async () => {
    const repo = makeChangeRepo()
    cleanup.push(repo)
    const dir = mkdtempSync(join(tmpdir(), 'presence-ev-')); cleanup.push(dir)
    const store = await openPrivateStore(repo, { dir }); stores.push(store)
    await store.putRecord({ collection: 'pages', id: OPS_PAGE, visibility: `hat:${OPS}`, body: { title: 'Ops', parent: null, order: 1, markdown: '' }, rev: 'r' }, 'ops-lead', null)
    const events = new EventLevels(repo, undefined, privateReads(() => store))
    const msg = { type: 'conversation', target: `page:${OPS_PAGE}` }
    const levelOf = events.levelsFor(msg)
    expect(gateEvent(wearer('steward-a'), msg, levelOf)).toEqual(msg)
    expect(gateEvent(plain('steward-b'), msg, levelOf)).toBeNull()
    expect(gateEvent(PUBLIC_VIEWER, msg, levelOf)).toBeNull()
    const gone = { type: 'presence', target: 'page:nope', people: [] }
    expect(gateEvent(wearer('steward-a'), gone, events.levelsFor(gone))).toBeNull()
  })
})

describe('the WebSocket (§8.5, serve.ts)', () => {
  type Msg = { type: string; target?: string; people?: { handle: string }[] }
  let server: Running | null = null
  const sockets: WebSocket[] = []
  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate()
    await server?.close()
    server = null
  })

  it('a WebSocket connection not admitted to a page hears no presence or conversation event for it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const repo = makeChangeRepo(`schema_version: "2.0"
governance:
  model: "solo-maintainer"
  roles:
    ops: { members: [steward-a] }
  decisions: []
`)
    cleanup.push(repo)
    writeFileSync(join(repo, 'data', 'members.yaml'), `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["${TEST_EMAIL}"] } }
  - { id: steward-b, name: Steward B, kind: person, handles: { wallet: "${A2}" } }
`)
    mkdirSync(join(repo, 'pages'), { recursive: true })
    writeFileSync(join(repo, 'pages', 'guide-0001.md'), joinPage({ id: 'guide-0001', title: 'Guide', parent: null, order: 1000 }, 'Text.\n'))
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: a role, two members, a page"')
    server = await startServer({ repo, port: 0, fetch: async () => { throw new Error('no network in this test') } })
    const s = server
    await s.privateStore!.putRecord({ collection: 'pages', id: ROLE_PAGE, visibility: 'role:ops', body: { title: 'Ops only', parent: null, order: 1, markdown: 'x' }, rev: 'r' }, 'steward-a', null)
    const { token } = await createSession(s.privateStore!, A2, () => new Date())
    const heard: Record<'a' | 'b', Msg[]> = { a: [], b: [] }
    const listen = async (who: 'a' | 'b', cookie?: string) => {
      const ws = new WebSocket(`ws://127.0.0.1:${s.port}/api/events`, { headers: { host: `localhost:${s.port}`, ...(cookie ? { cookie } : {}) } })
      sockets.push(ws)
      ws.on('message', data => heard[who].push(JSON.parse(String(data)) as Msg))
      await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
    }
    await listen('a') // git's identity: steward-a, who holds ops
    await listen('b', `house_session=${token}`) // steward-b, signed in
    const post = (path: string, body: unknown) => fetch(`http://localhost:${s.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const until = async (who: 'a' | 'b', ok: (m: Msg[]) => boolean) => {
      for (let i = 0; i < 100 && !ok(heard[who]); i++) await new Promise(r => setTimeout(r, 30))
      expect(ok(heard[who])).toBe(true)
    }
    const on = (type: string, target: string) => (m: Msg[]) => m.some(x => x.type === type && x.target === target)

    expect((await post('/api/presence', { target: `page:${ROLE_PAGE}`, editing: true })).status).toBe(200)
    expect((await post('/api/comments', { target: `page:${ROLE_PAGE}`, body: 'Only ops reads this.' })).status).toBe(201)
    await until('a', m => on('presence', `page:${ROLE_PAGE}`)(m) && on('conversation', `page:${ROLE_PAGE}`)(m))
    expect(heard.a.find(x => x.type === 'presence')?.people).toEqual([{ handle: 'steward-a', role: 'Steward A', editing: true }])
    // The control: a members' page, which both may see. Each connection's messages go in order, so once b hears it, b has
    // been sent everything before it.
    expect((await post('/api/presence', { target: 'page:guide-0001', editing: false })).status).toBe(200)
    expect((await post('/api/comments', { target: 'page:guide-0001', body: 'Everyone reads this.' })).status).toBe(201)
    await until('b', m => on('presence', 'page:guide-0001')(m) && on('conversation', 'page:guide-0001')(m))
    expect(heard.b.filter(x => x.target === `page:${ROLE_PAGE}`)).toEqual([])
    expect(JSON.stringify(heard.b)).not.toContain(ROLE_PAGE)
  })
})
