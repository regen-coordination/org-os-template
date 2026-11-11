// The walk review's G1 (C1–C3): View as made true at the server. A GET may name the viewer it is previewed for,
// `?as=public|members|hat:<ref>`; the request's viewer is then what that viewer and the real one may both read, so the
// preview never widens: a hosted public asking ?as=members reads as the public, a member asking for a hat they do not
// wear reads nothing that hat keeps. For the routes the collections, All records, a collection and a page read (the
// probes' C1–C3 routes), a member's preview as Public answers exactly what the hosted public is answered, and as
// Members exactly what a member wearing no hat is answered. Every test builds a throwaway repository and private store;
// the Hats tree is a stub reader. No network.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { Membership } from '../../server/session/membership.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import type { WearerReading, WearersReading } from '../../server/systems/hats.ts'

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`

const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: council, method: approve, count: 1 } }
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
// steward-a (the fixture's git identity) wears Ops through their wallet; ops-lead is a member who wears no hat.
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"], wallet: "${A1}" } }
  - { id: ops-lead, name: Ops Lead, kind: person, handles: { git: ["ops-lead@example.test"] } }
`
const VISIBILITY = `visibility:
  collections:
    pages: { default: members }
    tasks: { default: members }
`
const TASKS = `schema_version: "2.0"
tasks:
  - { id: t-agenda, title: Write the agenda, status: todo, visibility: public }
  - { id: t-room, title: Book the room, status: doing }
`
const OPS_PAGE = 'p-00000000c0de'

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function world() {
  const repo = makeChangeRepo(GOVERNANCE)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), VISIBILITY)
  writeFileSync(join(repo, 'data', 'tasks.yaml'), TASKS)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, two members, tasks"')
  const dir = mkdtempSync(join(tmpdir(), 'preview-as-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  // What Ops keeps (C1–C3's markers), and one thing Council keeps, which steward-a may not read.
  await store.putRecord({ collection: 'tasks', id: 't-payroll', visibility: `hat:${OPS}`, body: { id: 't-payroll', title: 'Review the payroll', status: 'todo' }, rev: '' }, 'steward-a', null)
  await store.putRecord({ collection: 'tasks', id: 't-council', visibility: `hat:${COUNCIL}`, body: { id: 't-council', title: 'Council only', status: 'todo' }, rev: '' }, 'steward-a', null)
  await store.putRecord({ collection: 'pages', id: OPS_PAGE, visibility: `hat:${OPS}`, body: { title: 'Ops room', parent: null, order: 9000, markdown: 'Where Ops works.\n' }, rev: '' }, 'steward-a', null)
  await store.putCollection({ id: 'circles', visibility: `hat:${OPS}`, definition: { id: 'circles', name: 'Circles', fields: [{ id: 'title', type: 'text' }] } }, 'steward-a')
  await store.putRecord({ collection: 'circles', id: 'stewards', visibility: `hat:${OPS}`, body: { title: 'Stewards' }, rev: '' }, 'steward-a', null)
  const now = () => new Date('2026-11-07T12:00:00Z')
  const worn: Record<string, string[]> = { [A1]: [OPS] }
  const hatsOf = (account: string) => Object.entries(worn).find(([a]) => a.toLowerCase().endsWith(account.toLowerCase().slice(-40)))?.[1] ?? []
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, hats: hatsOf(account), block: 100, readAt: now().toISOString() })
  const list = (hat: string): WearersReading => {
    const wearers = Object.entries(worn).filter(([, h]) => h.includes(hat)).map(([a]) => a)
    return { ok: true, system: 'hats-main', hat, wearers, holders: wearers, complete: true, block: 100, readAt: now().toISOString() }
  }
  const reader = { wearer: vi.fn(async (_s: unknown, account: string) => reading(account)), wearers: vi.fn(async (_s: unknown, hat: string) => list(hat)) }
  const membership = new Membership({ repo, reader: reader as never, now })
  await membership.forAct(A1) // a read uses the last good reading
  const app = (hosted: boolean): Hono => createApp(repo, undefined, {
    request: withRequest({ repo, hosted, membership, store, now }),
    privateStore: () => store,
  })
  return { repo, local: app(false), hosted: app(true) }
}

const as = (repo: string, email: string) => git(repo, `config user.email ${email}`)
async function get(app: Hono, path: string): Promise<{ status: number; body: unknown }> {
  const res = await app.request(`http://localhost:4680${path}`, { headers: { host: 'localhost:4680' } })
  return { status: res.status, body: await res.json() }
}
const withAs = (path: string, as: string) => `${path}${path.includes('?') ? '&' : '?'}as=${encodeURIComponent(as)}`

// C1 (/workspace's collections and their counts), C2 (/all, /all/:registry, /c/:collection: rows, ids, counts), C3 (the
// top bar's page title: the pages list, and the page by id).
const ROUTES = ['/api/registries', '/api/registries/tasks', '/api/registries/circles', '/api/collections', '/api/collections/circles',
  '/api/view-state/circles', '/api/pages', `/api/pages/${OPS_PAGE}`]

describe('?as on a GET: the preview is what the server answers that viewer (G1)', () => {
  it('as Public, a member is answered exactly what the hosted public is, route by route', async () => {
    const w = await world()
    for (const path of ROUTES) {
      const preview = await get(w.local, withAs(path, 'public'))
      const real = await get(w.hosted, path)
      expect(preview, path).toEqual(real)
    }
    // and none of what Ops keeps is in it (a 404 names the collection the path names, as it does for one never there)
    const text = JSON.stringify(await Promise.all(ROUTES.map(p => get(w.local, withAs(p, 'public')))))
    for (const marker of ['t-payroll', 'Review the payroll', 'Ops room', 'Where Ops works', 'Stewards']) expect(text).not.toContain(marker)
  })

  it('as Members, a member who wears Ops is answered exactly what a member wearing no hat is', async () => {
    const w = await world()
    const previews = []
    for (const path of ROUTES) previews.push(await get(w.local, withAs(path, 'members')))
    as(w.repo, 'ops-lead@example.test')
    for (const [i, path] of ROUTES.entries()) expect(previews[i], path).toEqual(await get(w.local, path))
    expect(JSON.stringify(previews)).not.toContain('t-payroll')
  })

  it('without ?as the member is answered as themselves: what Ops keeps is there', async () => {
    const w = await world()
    const tasks = await get(w.local, '/api/registries/tasks')
    expect((tasks.body as { entries: { id: string }[] }).entries.map(e => e.id)).toEqual(['t-agenda', 't-room', 't-payroll'])
    expect((await get(w.local, `/api/pages/${OPS_PAGE}`)).status).toBe(200)
  })

  it('as the hat they wear, the member reads what they read; as a hat they do not wear, nothing it keeps (never wider)', async () => {
    const w = await world()
    for (const path of ROUTES) expect(await get(w.local, withAs(path, `hat:${OPS}`)), path).toEqual(await get(w.local, path))
    const council = await get(w.local, withAs('/api/registries/tasks', `hat:${COUNCIL}`))
    expect((council.body as { entries: { id: string }[] }).entries.map(e => e.id)).toEqual(['t-agenda', 't-room'])
    // a hat that does not parse keeps nothing a member does not read
    const garbled = await get(w.local, withAs('/api/registries/tasks', 'hat:ops'))
    expect((garbled.body as { entries: { id: string }[] }).entries.map(e => e.id)).toEqual(['t-agenda', 't-room'])
  })

  it('the hosted public asking ?as=members, or a hat, is answered as the public', async () => {
    const w = await world()
    for (const path of ROUTES) {
      const real = await get(w.hosted, path)
      expect(await get(w.hosted, withAs(path, 'members')), path).toEqual(real)
      expect(await get(w.hosted, withAs(path, `hat:${OPS}`)), path).toEqual(real)
    }
  })

  it('an ?as that names no viewer is a 400', async () => {
    const w = await world()
    const res = await get(w.local, '/api/registries?as=everyone')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'as must be public, members or hat:<hat ref>: the viewer a preview is read for.', code: 'AS' })
  })
})
