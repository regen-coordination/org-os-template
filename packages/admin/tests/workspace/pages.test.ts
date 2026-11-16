import { describe, it, expect, afterEach, vi } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { Membership } from '../../server/session/membership.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { validateRepo } from '../../lib/data-validate.mjs'
import { joinPage, pageEntries, pageLevel, guardRefs, UNREADABLE_FRONT } from '../../lib/workspace/pages.mjs'
import {
  CANNOT_LINK, HAS_SUBPAGES, LOOSER_THAN_PARENT, NO_PRIVATE_ASSETS, PARENT_MISSING, ASSET_MAX_BYTES, publicPagesOf, readPages, backlinks, guardPageRefs,
} from '../../server/workspace/pages.ts'
import { MEMBERS as MEMBERS_LEVEL, PUBLIC } from '../../server/visibility/gate.ts'
import { MEMBERS_UNREADABLE } from '../../server/session/names.ts'
import type { WearerReading } from '../../server/systems/hats.ts'

// DAO-OS L6 §4, §16, Task 7: pages in git (pages/<id>.md) and in the private store (collection `pages`), their tree, levels,
// links across levels and backlinks; Record a meeting; attachments. Every test builds a fresh temporary repository
// (makeChangeRepo) and keeps its store in a folder of its own under the temp directory: nothing is written inside this
// worktree. Locally, git's identity is steward-a, whose wallet A1 wears Ops. Placeholders only; no network.

const NOW = new Date('2026-10-30T12:00:00Z')
const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`
const HATS: Record<string, string[]> = { [A1]: [OPS] }

const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
  decisions: []
`
/** A rule that raises the handbook's tree: a page in it is proposed, and approved by steward-a. */
const RAISED = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: handbook, applies_to: ["workspace:tree-handbook-3f2a"], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
/** Publication needs approval (steward-a, the maintainer, may not decide alone); the workspace stays direct. */
const PUBLISH = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: publish, applies_to: [publication], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person, role: Contributor }
`
const VISIBILITY = `visibility:
  defaults: { contact: "hat:${OPS}" }
  collections:
    projects: { default: members }
`

/** A page file as a person writes one. */
function page(id: string, title: string, opts: { parent?: string | null; order?: number; visibility?: string; body?: string } = {}): string {
  return joinPage({ id, title, parent: opts.parent ?? null, order: opts.order ?? 1000, ...(opts.visibility ? { visibility: opts.visibility as 'public' } : {}) },
    opts.body ?? `Body of ${title}.\n`)
}

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed by the test */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface World { repo: string; store: PrivateStore; app: Hono; pub: Hono }

async function world(opts: { governance?: string; pages?: Record<string, string>; files?: Record<string, string>; visibility?: string } = {}): Promise<World> {
  const repo = makeChangeRepo(opts.governance ?? GOVERNANCE)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), opts.visibility ?? VISIBILITY)
  const files = { ...Object.fromEntries(Object.entries(opts.pages ?? {}).map(([id, text]) => [`pages/${id}.md`, text])), ...(opts.files ?? {}) }
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(repo, rel, '..'), { recursive: true })
    writeFileSync(join(repo, rel), text)
  }
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, two members, the pages"')
  const dir = mkdtempSync(join(tmpdir(), 'pages-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const now = () => NOW
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, block: 100, readAt: NOW.toISOString(),
    hats: Object.entries(HATS).find(([a]) => a.toLowerCase().endsWith(account.toLowerCase().slice(-40)))?.[1] ?? [] })
  const reader = { wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)), wearers: vi.fn() }
  const membership = new Membership({ repo, reader: reader as never, now })
  const app = createApp(repo, undefined, { request: withRequest({ repo, hosted: false, membership, store, now }), privateStore: () => store })
  const pub = createApp(repo, undefined, { request: withRequest({ repo, hosted: true, membership: null }), privateStore: () => store })
  return { repo, store, app, pub }
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
async function call(app: Hono, path: string, init?: RequestInit): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await app.request(path, init)
  const text = await res.text()
  return { status: res.status, body: text === '' ? null : JSON.parse(text) }
}
const commits = (repo: string) => Number(git(repo, 'rev-list --count HEAD').trim())
const fileAt = (repo: string, rel: string) => (existsSync(join(repo, rel)) ? readFileSync(join(repo, rel), 'utf8') : null)
const member = { kind: 'member' as const, id: 'steward-a', hats: [OPS], roles: [] as string[] }
const plainMember = { kind: 'member' as const, id: 'steward-b', hats: [] as string[], roles: [] as string[] }

describe('pageLevel (L6 §4.2)', () => {
  it("a git page's level is its own, else its parent's, else collections.pages.default, else members", () => {
    const byId = pageEntries([
      { id: 'root-0001', text: page('root-0001', 'Root', { visibility: 'public' }) },
      { id: 'child-0001', text: page('child-0001', 'Child', { parent: 'root-0001' }) },
      { id: 'own-0001', text: page('own-0001', 'Own', { parent: 'root-0001', visibility: 'members' }) },
      { id: 'lone-0001', text: page('lone-0001', 'Lone') },
    ], [])
    const none = { collections: {}, defaults: {} }
    const publicPages = { collections: { pages: { default: 'public' as const, fields: {} } }, defaults: {} }
    expect(pageLevel('own-0001', byId, none)).toEqual({ level: 'members' })
    expect(pageLevel('child-0001', byId, none)).toEqual({ level: 'public' })
    expect(pageLevel('lone-0001', byId, publicPages)).toEqual({ level: 'public' })
    expect(pageLevel('lone-0001', byId, none)).toEqual({ level: 'members' })
    expect(pageLevel('lone-0001', byId, null)).toEqual({ level: 'members' })
    // A git page under a private page read without the store (as publicPagesOf reads) is never public.
    const under = pageEntries([{ id: 'under-0001', text: page('under-0001', 'Under', { parent: 'p-0123456789ab' }) }], [])
    expect(pageLevel('under-0001', under, publicPages)).toEqual({ level: 'members' })
    expect(pageLevel('under-0001', pageEntries([{ id: 'under-0001', text: page('under-0001', 'Under', { parent: 'gone-0001' }) }], []), publicPages)).toEqual({ level: 'public' })
    // A front matter that cannot be read says nothing of its level: members, never the looser default (review I3).
    for (const text of ['---\nid: odd-0001\ntitle: [unclosed\n---\nBody.\n', 'No front matter at all.\n', '---\nid: odd-0001\n', '---\n- a list\n---\nBody.\n']) {
      expect(pageLevel('odd-0001', pageEntries([{ id: 'odd-0001', text }], []), publicPages)).toEqual({ level: 'members' })
    }
  })
})

describe('pages in git and in the store (L6 §4.1–§4.3, §16)', () => {
  it('a public page under a members page is refused with LOOSER_THAN_PARENT(members); nothing is written', async () => {
    const w = await world({ pages: { 'notes-0001': page('notes-0001', 'Notes', { visibility: 'members' }) } })
    const before = commits(w.repo)
    const r = await call(w.app, '/api/pages', json('POST', { title: 'Open', parent: 'notes-0001', visibility: 'public' }))
    expect(r.status).toBe(409)
    expect(r.body.error).toBe(LOOSER_THAN_PARENT('members'))
    expect(commits(w.repo)).toBe(before)
  })

  it('a git page is one commit, pages/<id>.md, with the workspace trailers; GET /api/pages lists it', async () => {
    const w = await world()
    const before = commits(w.repo)
    const r = await call(w.app, '/api/pages', json('POST', { title: 'Handbook', markdown: 'Start here.\n' }))
    expect(r.status).toBe(201)
    expect(r.body.id).toMatch(/^handbook-[0-9a-f]{4}$/)
    expect(commits(w.repo)).toBe(before + 1)
    expect(git(w.repo, 'log -1 --format=%s')).toBe('page: Handbook\n')
    expect(git(w.repo, 'log -1 --format=%B')).toContain('Org-Rule: workspace/direct')
    expect(fileAt(w.repo, `pages/${r.body.id}.md`)).toContain('Start here.')
    const list = await call(w.app, '/api/pages')
    expect(list.body).toEqual([{ id: r.body.id, title: 'Handbook', parent: null, order: 1000, visibility: 'members' }])
  })

  it('a private page is a store record of pages and its write makes no commit', async () => {
    const w = await world({ pages: { 'ops-0001': page('ops-0001', 'Ops room') } })
    const before = commits(w.repo)
    const r = await call(w.app, '/api/pages', json('POST', { title: 'Payroll plan', parent: 'ops-0001', visibility: `hat:${OPS}`, markdown: 'Salaries.\n' }))
    expect(r.status).toBe(201)
    expect(r.body).toEqual({ id: expect.stringMatching(/^p-[0-9a-f]{12}$/), commit: null })
    expect(commits(w.repo)).toBe(before)
    const kept = w.store.record('pages', r.body.id)
    expect(kept).toMatchObject({ collection: 'pages', visibility: `hat:${OPS}`, body: { title: 'Payroll plan', parent: 'ops-0001', markdown: 'Salaries.\n' } })
    // Seen by the Ops wearer, absent for a member who wears no hat (rule 7: no title, no count).
    expect(readPages(w.repo, w.store, member).map(p => p.id)).toContain(r.body.id)
    expect(readPages(w.repo, w.store, plainMember).map(p => p.id)).toEqual(['ops-0001'])
    // A page under it, with no level of its own, is private too: it inherits.
    const child = await call(w.app, '/api/pages', json('POST', { title: 'Child', parent: r.body.id }))
    expect(child.body.id).toMatch(/^p-/)
    expect(w.store.record('pages', child.body.id)?.visibility).toBe(`hat:${OPS}`)
  })

  it("a private page's title is in no git object", async () => {
    const w = await world()
    const title = 'Zebra-quartz-ledger-9137'
    const r = await call(w.app, '/api/pages', json('POST', { title, visibility: `hat:${OPS}`, markdown: `About ${title}.\n` }))
    expect(r.status).toBe(201)
    const all = spawnSync('git', ['cat-file', '--batch-all-objects', '--batch'], { cwd: w.repo, encoding: 'utf8' })
    expect(all.status).toBe(0)
    expect(all.stdout.length).toBeGreaterThan(0)
    expect(all.stdout).not.toContain(title)
  })

  it('a parent loop or a missing parent shows the page at the root, stale, with "Its parent page is missing."', async () => {
    const w = await world({ pages: {
      'loop-a-0001': page('loop-a-0001', 'Loop A', { parent: 'loop-b-0001' }),
      'loop-b-0001': page('loop-b-0001', 'Loop B', { parent: 'loop-a-0001' }),
      'orphan-0001': page('orphan-0001', 'Orphan', { parent: 'gone-0001' }),
      'under-0001': page('under-0001', 'Under A', { parent: 'loop-a-0001' }),
    } })
    const list = (await call(w.app, '/api/pages')).body as { id: string; parent: string | null; stale?: string }[]
    const by = Object.fromEntries(list.map(p => [p.id, p]))
    for (const id of ['loop-a-0001', 'loop-b-0001', 'orphan-0001']) expect(by[id]).toMatchObject({ parent: null, stale: 'missing-parent' })
    expect(by['under-0001']).toEqual(expect.objectContaining({ parent: 'loop-a-0001' }))
    expect(by['under-0001'].stale).toBeUndefined()
    expect(PARENT_MISSING).toBe('Its parent page is missing.')
    // It opens (never hidden), and validate:data reports it.
    expect((await call(w.app, '/api/pages/orphan-0001')).status).toBe(200)
    const problems = validateRepo(w.repo).filter(p => p.file.startsWith('pages/'))
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'pages/orphan-0001.md', path: 'parent', level: 'warn', message: `Its parent gone-0001 names no page. ${PARENT_MISSING}` }),
      expect.objectContaining({ file: 'pages/loop-a-0001.md', path: 'parent', level: 'warn', message: `Its parent chain loops back to it. ${PARENT_MISSING}` }),
    ]))
  })

  it('deleting a page with 2 subpages is refused with HAS_SUBPAGES(2); a page with none is one commit', async () => {
    const w = await world({ pages: {
      'top-0001': page('top-0001', 'Top'),
      'sub-a-0001': page('sub-a-0001', 'Sub A', { parent: 'top-0001' }),
      'sub-b-0001': page('sub-b-0001', 'Sub B', { parent: 'top-0001', order: 2000 }),
    } })
    const before = commits(w.repo)
    const r = await call(w.app, '/api/pages/top-0001', { method: 'DELETE' })
    expect(r.status).toBe(409)
    expect(r.body.error).toBe(HAS_SUBPAGES(2))
    expect(commits(w.repo)).toBe(before)
    const gone = await call(w.app, '/api/pages/sub-a-0001', { method: 'DELETE' })
    expect(gone.status).toBe(200)
    expect(commits(w.repo)).toBe(before + 1)
    expect(fileAt(w.repo, 'pages/sub-a-0001.md')).toBeNull()
  })

  it('the public sees only public pages from GET /api/pages; GET /api/pages/:id of a members page is the 404 of a missing one', async () => {
    const w = await world({ pages: {
      'open-0001': page('open-0001', 'Open', { visibility: 'public' }),
      'inner-0001': page('inner-0001', 'Inner'),
      'open-kid-0001': page('open-kid-0001', 'Open kid', { parent: 'open-0001' }),
    } })
    const list = await call(w.pub, '/api/pages')
    expect(list.status).toBe(200)
    expect(list.body.map((p: { id: string }) => p.id).sort()).toEqual(['open-0001', 'open-kid-0001'])
    expect(list.body.every((p: { visibility: string }) => p.visibility === 'public')).toBe(true)
    const hidden = await call(w.pub, '/api/pages/inner-0001')
    const missing = await call(w.pub, '/api/pages/nothing-0001')
    expect(hidden.status).toBe(404)
    expect(hidden.body).toEqual({ error: 'There is no page inner-0001.' })
    expect(missing.body).toEqual({ error: 'There is no page nothing-0001.' })
    const open = await call(w.pub, '/api/pages/open-0001')
    expect(open.status).toBe(200)
    expect(open.body.page).toMatchObject({ id: 'open-0001', title: 'Open', path: 'pages/open-0001.md', visibility: 'public', markdown: 'Body of Open.\n' })
    expect(open.body.write.mode).toBe('none')
    // Every other page route is the members' side.
    expect((await call(w.pub, '/api/pages', json('POST', { title: 'x' }))).status).toBe(401)
  })

  it('backlinks list only pages the viewer may see, and their count follows', async () => {
    const w = await world({ pages: { 'target-0001': page('target-0001', 'Target', { visibility: 'public' }) } })
    await call(w.app, '/api/pages', json('POST', { title: 'Members link', markdown: 'See [Target](./target-0001.md).\n' }))
    await call(w.app, '/api/pages', json('POST', { title: 'Ops link', visibility: `hat:${OPS}`, markdown: 'See [Target](./target-0001.md).\n' }))
    await call(w.app, '/api/pages', json('POST', { title: 'Unrelated', markdown: 'Nothing.\n' }))
    expect(backlinks(w.repo, 'target-0001', member, w.store).map(p => p.title).sort()).toEqual(['Members link', 'Ops link'])
    expect(backlinks(w.repo, 'target-0001', plainMember, w.store).map(p => p.title)).toEqual(['Members link'])
    expect(backlinks(w.repo, 'target-0001', { kind: 'public' }, w.store)).toEqual([])
    const seen = await call(w.app, '/api/pages/target-0001')
    expect(seen.body.backlinks).toHaveLength(2)
    expect((await call(w.pub, '/api/pages/target-0001')).body.backlinks).toEqual([])
  })

  it('a move sets order to the mean of its neighbours, renumbering the siblings when they are within 1e-6', async () => {
    const w = await world({ pages: {
      'a-0001': page('a-0001', 'A', { order: 1000 }),
      'b-0001': page('b-0001', 'B', { order: 2000 }),
      'c-0001': page('c-0001', 'C', { order: 3000 }),
      'x-0001': page('x-0001', 'X', { order: 1, parent: 'c-0001' }),
      'tight-a-0001': page('tight-a-0001', 'Tight A', { order: 5000 }),
      'tight-b-0001': page('tight-b-0001', 'Tight B', { order: 5000.0000001 }),
    } })
    const moved = await call(w.app, '/api/pages/x-0001/move', json('POST', { parent: null, before: 'b-0001' }))
    expect(moved.status).toBe(200)
    const order = (id: string) => (readPages(w.repo, w.store, member).find(p => p.id === id)!).order
    expect(order('x-0001')).toBe(1500)
    expect(readPages(w.repo, w.store, member).find(p => p.id === 'x-0001')!.parent).toBeNull()
    const before = commits(w.repo)
    const tight = await call(w.app, '/api/pages/a-0001/move', json('POST', { parent: null, before: 'tight-b-0001' }))
    expect(tight.status).toBe(200)
    expect(commits(w.repo)).toBe(before + 1) // the renumbering is in the same commit
    const ids = readPages(w.repo, w.store, member).filter(p => p.parent === null).sort((x, y) => x.order - y.order).map(p => [p.id, p.order])
    expect(ids).toEqual([['x-0001', 1000], ['b-0001', 2000], ['c-0001', 3000], ['tight-a-0001', 4000], ['a-0001', 5000], ['tight-b-0001', 6000]])
  })

  it('publicPagesOf holds public pages only, with their front matter and body', async () => {
    const w = await world({ pages: {
      'open-0001': page('open-0001', 'Open', { visibility: 'public' }),
      'kid-0001': page('kid-0001', 'Kid', { parent: 'open-0001' }),
      'inner-0001': page('inner-0001', 'Inner'),
    } })
    await call(w.app, '/api/pages', json('POST', { title: 'Secret', visibility: `hat:${OPS}` }))
    const out = publicPagesOf(w.repo)
    expect(out.map(p => p.front.id).sort()).toEqual(['kid-0001', 'open-0001'])
    expect(out.find(p => p.front.id === 'open-0001')!.body).toBe('Body of Open.\n')
  })

  it('creating a page under a raised tree stages a file op, and commits nothing', async () => {
    const w = await world({ governance: RAISED, pages: { 'handbook-3f2a': page('handbook-3f2a', 'Handbook') } })
    const before = commits(w.repo)
    const r = await call(w.app, '/api/pages', json('POST', { title: 'Chapter', parent: 'handbook-3f2a' }))
    expect(r.status).toBe(201)
    expect(r.body).toEqual({ id: expect.stringMatching(/^chapter-[0-9a-f]{4}$/), staged: true })
    expect(commits(w.repo)).toBe(before)
    const change = await call(w.app, '/api/changes')
    expect(change.body.ops).toEqual([expect.objectContaining({ op: 'file', path: `pages/${r.body.id}.md`, base: null })])
    expect(change.body.rule.direct).toBe(false)
    // A page elsewhere is not under the rule: it applies at once.
    const free = await call(w.app, '/api/pages', json('POST', { title: 'Elsewhere' }))
    expect(free.body.commit).toMatch(/^[0-9a-f]{40}$/)
  })

  it('Record a meeting writes the meeting (with notes) and its notes page in one commit', async () => {
    const w = await world()
    const before = commits(w.repo)
    const r = await call(w.app, '/api/meetings', json('POST', { title: 'Weekly sync', date: '2026-10-30', type: 'sync' }))
    expect(r.status).toBe(201)
    expect(commits(w.repo)).toBe(before + 1)
    const meetings = fileAt(w.repo, 'data/meetings.yaml')!
    expect(meetings).toContain(`id: ${r.body.meeting}`)
    expect(meetings).toContain(`notes: ${r.body.page}`)
    const notes = fileAt(w.repo, `pages/${r.body.page}.md`)!
    expect(notes).toContain(`meeting: ${r.body.meeting}`)
    expect(notes).toContain('title: Weekly sync')
    expect(git(w.repo, 'show --name-only --format= HEAD').trim().split('\n').sort()).toEqual(['data/meetings.yaml', `pages/${r.body.page}.md`])
  })

  it('an asset over 5242880 bytes is refused; an asset on a private page answers NO_PRIVATE_ASSETS', async () => {
    const w = await world({ pages: { 'doc-0001': page('doc-0001', 'Doc') } })
    const big = Buffer.alloc(ASSET_MAX_BYTES + 1, 1).toString('base64')
    const before = commits(w.repo)
    const tooBig = await call(w.app, '/api/pages/doc-0001/assets', json('POST', { name: 'big.bin', data: big }))
    expect(tooBig.status).toBe(413)
    expect(commits(w.repo)).toBe(before)
    const ok = await call(w.app, '/api/pages/doc-0001/assets', json('POST', { name: 'chart.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]).toString('base64') }))
    expect(ok.status).toBe(201)
    expect(ok.body.path).toBe('pages/assets/doc-0001/chart.png')
    expect([...readFileSync(join(w.repo, ok.body.path))]).toEqual([0x89, 0x50, 0x4e, 0x47, 0, 255])
    expect(commits(w.repo)).toBe(before + 1)
    const priv = await call(w.app, '/api/pages', json('POST', { title: 'Private', visibility: `hat:${OPS}` }))
    const refused = await call(w.app, `/api/pages/${priv.body.id}/assets`, json('POST', { name: 'a.png', data: 'AAAA' }))
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe(NO_PRIVATE_ASSETS(`hat:${OPS}`))
  })
})

describe('links across levels (L6 §4.5)', () => {
  it('guardRefs writes a link to a p- page as [↗](./p-….md) in a members page, and refuses a private collection\'s record', async () => {
    const levels = { pageLevel: (id: string) => (id === 'p-0123456789ab' ? { level: 'hat' as const, hat: OPS } : id === 'open-0001' ? PUBLIC : null), collectionLevel: (n: string) => (n === 'grants-private' ? { level: 'hat' as const, hat: OPS } : null) }
    const out = guardRefs('See [Payroll plan](./p-0123456789ab.md) and [Open](./open-0001.md).\n\n`[Payroll plan](./p-0123456789ab.md)`\n', MEMBERS_LEVEL, levels)
    expect(out).toEqual({ refused: null, body: 'See [↗](./p-0123456789ab.md) and [Open](./open-0001.md).\n\n`[Payroll plan](./p-0123456789ab.md)`\n' })
    const refused = guardRefs('::record[Grant]{ref="grants-private:g-1"}\n', MEMBERS_LEVEL, levels)
    expect(refused.refused).toBe(CANNOT_LINK('members', `hat:${OPS}`))
    // The server enforces it on a page write.
    const w = await world()
    const priv = await call(w.app, '/api/pages', json('POST', { title: 'Payroll plan', visibility: `hat:${OPS}` }))
    const r = await call(w.app, '/api/pages', json('POST', { title: 'Index', markdown: `See [Payroll plan](./${priv.body.id}.md).\n` }))
    expect(r.status).toBe(201)
    expect(fileAt(w.repo, `pages/${r.body.id}.md`)).toContain(`See [↗](./${priv.body.id}.md).`)
    expect(fileAt(w.repo, `pages/${r.body.id}.md`)).not.toContain('Payroll plan')
    await w.store.putCollection({ id: 'grants-private', visibility: `hat:${OPS}`, definition: { name: 'Grants' } }, 'steward-a')
    const before = commits(w.repo)
    const no = await call(w.app, '/api/pages', json('POST', { title: 'Grants', markdown: '::record[Grant]{ref="grants-private:g-1"}\n' }))
    expect(no.status).toBe(422)
    expect(no.body.error).toBe(CANNOT_LINK('members', `hat:${OPS}`))
    expect(commits(w.repo)).toBe(before)
  })
})

describe('a page edited whole (the file op, L6 §11.2: a page passes §4\'s checks)', () => {
  const stageFile = (app: Hono, path: string, text: string | null) => call(app, '/api/changes/ops', json('POST', { ops: [{ op: 'file', path, text }] }))

  it('a restricted value in a page\'s git text is refused 422, named by the path and the field', async () => {
    const w = await world({ pages: { 'doc-0001': page('doc-0001', 'Doc') } })
    const r = await stageFile(w.app, 'pages/doc-0001.md', page('doc-0001', 'Doc', { visibility: `hat:${OPS}` }))
    expect(r.status).toBe(422)
    expect(r.body.errors).toEqual([{ record: 'pages/doc-0001.md', field: 'visibility',
      message: `Not staged: pages/doc-0001.md would be kept at hat:${OPS}, and git holds nothing stricter than members. Nothing was staged.` }])
  })

  it('a page file op looser than its parent is refused', async () => {
    const w = await world({ pages: { 'top-0001': page('top-0001', 'Top', { visibility: 'members' }), 'kid-0001': page('kid-0001', 'Kid', { parent: 'top-0001' }) } })
    const r = await stageFile(w.app, 'pages/kid-0001.md', page('kid-0001', 'Kid', { parent: 'top-0001', visibility: 'public' }))
    expect(r.status).toBe(422)
    expect(r.body.errors).toEqual([{ record: 'pages/kid-0001.md', field: 'visibility', message: LOOSER_THAN_PARENT('members') }])
  })

  it('an edit elsewhere in a page already looser than its parent by hand is not refused for what it already held', async () => {
    const w = await world({ pages: { 'top-0001': page('top-0001', 'Top', { visibility: 'members' }), 'kid-0001': page('kid-0001', 'Kid', { parent: 'top-0001', visibility: 'public' }) } })
    const r = await stageFile(w.app, 'pages/kid-0001.md', page('kid-0001', 'Kid', { parent: 'top-0001', visibility: 'public', body: 'A new body.\n' }))
    expect(r.status).toBe(200)
  })

  it('a move of a page whose front matter cannot be read is refused in UNREADABLE_FRONT\'s words; nothing is written', async () => {
    const broken = '---\nid: odd-0001\ntitle: [unclosed\n---\nBody.\n'
    const w = await world({ pages: { 'odd-0001': broken, 'top-0001': page('top-0001', 'Top') } })
    const before = commits(w.repo)
    const r = await call(w.app, '/api/pages/odd-0001/move', json('POST', { parent: 'top-0001' }))
    expect(r.status).toBe(422)
    expect(r.body.code).toBe('UNREADABLE_FRONT')
    expect(r.body.error).toMatch(/Its front matter is kept as written, so it cannot be changed here\. Nothing was written\.$/)
    expect(r.body.error.startsWith('Its front matter is not valid YAML')).toBe(true)
    expect(UNREADABLE_FRONT('x')).toContain('Nothing was written.')
    expect(commits(w.repo)).toBe(before)
    expect(fileAt(w.repo, 'pages/odd-0001.md')).toBe(broken)
  })
})

describe('validate:data reads the pages (L6 §4.2, §4.5)', () => {
  it('reports a page looser than its parent and a link label that shows a stricter page\'s title', async () => {
    const w = await world({ pages: {
      'top-0001': page('top-0001', 'Top', { visibility: 'members' }),
      'kid-0001': page('kid-0001', 'Kid', { parent: 'top-0001', visibility: 'public' }),
      'open-0001': page('open-0001', 'Open', { visibility: 'public', body: 'See [Top secret plans](./top-0001.md).\n' }),
    } })
    const problems = validateRepo(w.repo).filter(p => p.file.startsWith('pages/'))
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'pages/kid-0001.md', path: 'visibility', level: 'error', message: 'A page cannot be more open than the page it sits in, which is members.' }),
      expect.objectContaining({ file: 'pages/open-0001.md', level: 'error' }),
    ]))
    expect(problems.filter(p => p.file === 'pages/top-0001.md')).toEqual([])
  })
})

const PUBLIC_PAGES = `visibility:
  defaults: { contact: "hat:${OPS}" }
  collections:
    projects: { default: members }
    pages: { default: public }
`

describe('review fix round 1 (Task 7)', () => {
  it('a page whose front matter cannot be read opens, its body intact, and is members even where pages default to public (I3, M6)', async () => {
    const broken = '---\nid: odd-0001\ntitle: [unclosed\n---\nKept as written.\n'
    const w = await world({ visibility: PUBLIC_PAGES, pages: { 'odd-0001': broken, 'open-0001': page('open-0001', 'Open') } })
    const opened = await call(w.app, '/api/pages/odd-0001')
    expect(opened.status).toBe(200)
    expect(opened.body.page).toMatchObject({ id: 'odd-0001', visibility: 'members', markdown: 'Kept as written.\n' })
    expect((await call(w.pub, '/api/pages')).body.map((p: { id: string }) => p.id)).toEqual(['open-0001'])
    expect((await call(w.pub, '/api/pages/odd-0001')).status).toBe(404)
    expect(publicPagesOf(w.repo).map(p => p.front.id)).toEqual(['open-0001'])
  })

  it('GET /api/pages/:id names no parent the viewer may not see (M1)', async () => {
    const w = await world({ pages: { 'kid-0001': page('kid-0001', 'Kid', { parent: 'p-0123456789ab', visibility: 'members' }) } })
    await w.store.putRecord({ collection: 'pages', id: 'p-0123456789ab', visibility: `hat:${COUNCIL}`, body: { title: 'Council room', parent: null, order: 1000, markdown: '' }, rev: '' }, 'steward-a', null)
    // steward-a wears Ops, not Council: the parent is not theirs to see, nor its id.
    const r = await call(w.app, '/api/pages/kid-0001')
    expect(r.status).toBe(200)
    expect(r.body.page).toMatchObject({ parent: null, stale: 'missing-parent' })
    expect(JSON.stringify(r.body)).not.toContain('p-0123456789ab')
  })

  it('making a page public is a publication: a public page and a move under a public parent are staged under the publication rule (I2)', async () => {
    const w = await world({ governance: PUBLISH, pages: { 'open-0001': page('open-0001', 'Open', { visibility: 'public' }), 'inner-0001': page('inner-0001', 'Inner') } })
    const before = commits(w.repo)
    // A members page is the workspace's alone: it applies at once.
    const plain = await call(w.app, '/api/pages', json('POST', { title: 'Plain' }))
    expect(plain.body.commit).toMatch(/^[0-9a-f]{40}$/)
    const pub = await call(w.app, '/api/pages', json('POST', { title: 'Announcement', visibility: 'public' }))
    expect(pub.status).toBe(201)
    expect(pub.body).toEqual({ id: expect.stringMatching(/^announcement-/), staged: true })
    const moved = await call(w.app, '/api/pages/inner-0001/move', json('POST', { parent: 'open-0001' }))
    expect(moved.body).toEqual({ id: 'inner-0001', staged: true })
    const change = await call(w.app, '/api/changes')
    expect(change.body.classes).toEqual(expect.arrayContaining(['workspace', 'publication']))
    expect(change.body.rule.direct).toBe(false)
    expect(commits(w.repo)).toBe(before + 1)
    expect((await call(w.pub, '/api/pages')).body.map((p: { id: string }) => p.id)).toEqual(['open-0001'])
  })

  it('Record a meeting whose notes page would be public is staged under the publication rule (I2)', async () => {
    const w = await world({ governance: PUBLISH, visibility: PUBLIC_PAGES })
    const before = commits(w.repo)
    const r = await call(w.app, '/api/meetings', json('POST', { title: 'Open sync', date: '2026-10-30' }))
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ staged: true, commit: null })
    expect(commits(w.repo)).toBe(before)
  })

  it('under the solo default a public page applies at once, judged under publication too (I2)', async () => {
    const w = await world()
    const r = await call(w.app, '/api/pages', json('POST', { title: 'Open', visibility: 'public' }))
    expect(r.body.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(git(w.repo, 'log -1 --format=%B')).toMatch(/Org-Rule: \S*solo\/direct/)
  })
})

// Walk fix wave 6b, I9: "Move to…" calls POST /api/pages/:id/move. GET /api/pages tells a known member how their write
// under each page would go (`write`), so the client offers only parents they may read and write; the server judges the
// move as every other page write: a page it may not see is the 404 of a missing one, into itself or a subpage is refused.
const COUNCIL_TREE = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: handbook, applies_to: ["workspace:tree-handbook-3f2a"], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
    - { id: council-room, applies_to: ["workspace:tree-room-4b4b"], propose: council, decide: { by: council, method: approve, count: 1 } }
  decisions: []
`

describe('moving a page (walk I9)', () => {
  it('GET /api/pages?write names, for a known member, how their write under each page goes; the public and a preview are given none', async () => {
    const w = await world({ governance: COUNCIL_TREE, pages: {
      'handbook-3f2a': page('handbook-3f2a', 'Handbook', { order: 1000 }),
      'chapter-1a1a': page('chapter-1a1a', 'Chapter', { parent: 'handbook-3f2a' }),
      'room-4b4b': page('room-4b4b', 'Room', { order: 2000, visibility: 'public' }),
      'free-5c5c': page('free-5c5c', 'Free', { order: 3000, visibility: 'public' }),
    } })
    const list = (await call(w.app, '/api/pages?write')).body as { id: string; write?: string }[]
    expect(Object.fromEntries(list.map(p => [p.id, p.write]))).toEqual({
      'handbook-3f2a': 'approval', 'chapter-1a1a': 'approval', 'room-4b4b': 'none', 'free-5c5c': 'direct',
    })
    // unasked, and previewing, the list is what every reader is given
    expect(((await call(w.app, '/api/pages')).body as Record<string, unknown>[]).every(p => !Object.hasOwn(p, 'write'))).toBe(true)
    expect(((await call(w.app, '/api/pages?write&as=members')).body as Record<string, unknown>[]).every(p => !Object.hasOwn(p, 'write'))).toBe(true)
    const pub = (await call(w.pub, '/api/pages?write')).body as Record<string, unknown>[]
    expect(pub.map(p => p.id).sort()).toEqual(['free-5c5c', 'room-4b4b'])
    expect(pub.every(p => !Object.hasOwn(p, 'write'))).toBe(true)
  })

  it('a move into the page itself or one of its subpages is refused INTO_ITSELF; nothing is written', async () => {
    const w = await world({ pages: {
      'a-0001': page('a-0001', 'A'),
      'b-0001': page('b-0001', 'B', { parent: 'a-0001' }),
      'c-0001': page('c-0001', 'C', { parent: 'b-0001' }),
    } })
    const before = commits(w.repo)
    for (const parent of ['a-0001', 'c-0001']) {
      const r = await call(w.app, '/api/pages/a-0001/move', json('POST', { parent }))
      expect(r.status).toBe(409)
      expect(r.body.code).toBe('INTO_ITSELF')
    }
    expect(commits(w.repo)).toBe(before)
    // nested one level down, as Move to… does: one commit, its front matter's parent
    const nest = await call(w.app, '/api/pages/c-0001/move', json('POST', { parent: 'a-0001' }))
    expect(nest.status).toBe(200)
    expect(commits(w.repo)).toBe(before + 1)
    expect(readPages(w.repo, w.store, member).find(p => p.id === 'c-0001')!.parent).toBe('a-0001')
  })

  it('a move under a page the viewer may not see is the 404 of a missing one, its id never echoed', async () => {
    const w = await world({ pages: { 'a-0001': page('a-0001', 'A') } })
    await w.store.putRecord({ collection: 'pages', id: 'p-0123456789ab', visibility: `hat:${COUNCIL}`, body: { title: 'Council room', parent: null, order: 1000, markdown: '' }, rev: '' }, 'steward-a', null)
    const before = commits(w.repo)
    const hidden = await call(w.app, '/api/pages/a-0001/move', json('POST', { parent: 'p-0123456789ab' }))
    const missing = await call(w.app, '/api/pages/a-0001/move', json('POST', { parent: 'p-ffffffffffff' }))
    expect(hidden.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(JSON.stringify(hidden.body).replace('p-0123456789ab', 'p-ffffffffffff')).toBe(JSON.stringify(missing.body))
    expect(commits(w.repo)).toBe(before)
  })

  it('a move into a raised tree is staged in the mover’s change, and nothing is committed', async () => {
    const w = await world({ governance: RAISED, pages: { 'handbook-3f2a': page('handbook-3f2a', 'Handbook'), 'loose-0001': page('loose-0001', 'Loose', { order: 2000 }) } })
    const before = commits(w.repo)
    const r = await call(w.app, '/api/pages/loose-0001/move', json('POST', { parent: 'handbook-3f2a' }))
    expect(r.body).toEqual({ id: 'loose-0001', staged: true })
    expect(commits(w.repo)).toBe(before)
    expect((await call(w.app, '/api/changes')).body.ops).toEqual([expect.objectContaining({ op: 'file', path: 'pages/loose-0001.md' })])
  })
})

// R4c 1 (Rule 4): a member mention's label is written at the text's level (the public's names in a public page, any member's
// otherwise), and read back at the page's level now, so neither GET /api/pages/:id nor the portal's input (publicPagesOf)
// hands the public a name the gate keeps from it, a page widened since included. R4c 3: a write with member mentions while
// the members file cannot be read is refused 503; a read says the id. R4c 5: a page's file op is labelled as its level says.
// Member names are at members here (no policy for the members collection); steward-a's record is public.
describe('R4c: a members-level name never reaches the public through a page', () => {
  const NAMED = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, visibility: public, handles: { git: ["admin-test@local"], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person, role: Contributor }
`
  const MD = 'Ask [@Steward B](hub:member/steward-b) and [@Steward A](hub:member/steward-a).\n'
  const named = async (pages: Record<string, string> = {}) => {
    const w = await world({ pages, files: { 'data/members.yaml': NAMED } })
    return w
  }

  it('a public page is written with the public\'s names, a members page with any member\'s', async () => {
    const w = await named()
    const pub = await call(w.app, '/api/pages', json('POST', { title: 'Open', visibility: 'public', markdown: MD }))
    expect(pub.status).toBe(201)
    expect(fileAt(w.repo, `pages/${pub.body.id}.md`)).toContain('Ask [@steward-b](hub:member/steward-b) and [@Steward A](hub:member/steward-a).')
    const mem = await call(w.app, '/api/pages', json('POST', { title: 'Inner', markdown: MD }))
    expect(mem.status).toBe(201)
    expect(fileAt(w.repo, `pages/${mem.body.id}.md`)).toContain('Ask [@Steward B](hub:member/steward-b) and [@Steward A](hub:member/steward-a).')
  })

  it('a public page written outside the Hub: the public\'s read and the portal\'s input say the id; a member reads a members page\'s name', async () => {
    const w = await named({ 'open-0001': page('open-0001', 'Open', { visibility: 'public', body: MD }), 'inner-0001': page('inner-0001', 'Inner', { body: MD }) })
    const read = await call(w.pub, '/api/pages/open-0001')
    expect(read.status).toBe(200)
    expect(read.body.page.markdown).toBe('Ask [@steward-b](hub:member/steward-b) and [@Steward A](hub:member/steward-a).\n')
    expect(JSON.stringify(read.body)).not.toContain('Steward B')
    expect(publicPagesOf(w.repo).find(p => p.front.id === 'open-0001')!.body).toBe('Ask [@steward-b](hub:member/steward-b) and [@Steward A](hub:member/steward-a).\n')
    const inner = await call(w.app, '/api/pages/inner-0001')
    expect(inner.body.page.markdown).toBe(MD)
  })

  it('a page written at members, widened to public outside the Hub, reads the id to the public', async () => {
    const w = await named()
    const mem = await call(w.app, '/api/pages', json('POST', { title: 'Inner', markdown: MD }))
    const id = mem.body.id as string
    expect(fileAt(w.repo, `pages/${id}.md`)).toContain('[@Steward B]')
    writeFileSync(join(w.repo, 'pages', `${id}.md`), fileAt(w.repo, `pages/${id}.md`)!.replace('order: 1000\n', 'order: 1000\nvisibility: public\n'))
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "widened by hand"')
    const read = await call(w.pub, `/api/pages/${id}`)
    expect(read.status).toBe(200)
    expect(read.body.page.markdown).toContain('[@steward-b](hub:member/steward-b)')
    expect(JSON.stringify(read.body)).not.toContain('Steward B')
  })

  it('a file op widening a page to public is staged with the public\'s names (R4c 5)', async () => {
    const w = await named({ 'inner-0001': page('inner-0001', 'Inner', { body: MD }) })
    const text = page('inner-0001', 'Inner', { visibility: 'public', body: MD })
    const staged = await call(w.app, '/api/changes/ops', json('POST', { ops: [{ op: 'file', path: 'pages/inner-0001.md', text }] }))
    expect(staged.status).toBe(200)
    const ops = (await call(w.app, '/api/changes')).body.ops as { path: string; text: string }[]
    expect(ops[0]!.text).toContain('Ask [@steward-b](hub:member/steward-b) and [@Steward A](hub:member/steward-a).')
    expect(ops[0]!.text).toContain('visibility: public')
  })

  it('the members file unreadable: a write naming a member is refused 503, one naming none is written, a read says the id (R4c 3)', async () => {
    const w = await named({ 'inner-0001': page('inner-0001', 'Inner', { body: MD }) })
    chmodSync(join(w.repo, 'data', 'members.yaml'), 0o000) // there, but it cannot be read
    // Every write of a page's or a comment's body passes guardPageRefs (page saves, sessions, comments, a move, a task's title).
    let refused: unknown = null
    try { guardPageRefs(MD, PUBLIC, { repo: w.repo, store: w.store }) } catch (err) { refused = err }
    expect(refused).toMatchObject({ status: 503, message: MEMBERS_UNREADABLE, code: 'MEMBERS_UNREADABLE' })
    expect(guardPageRefs('No one named.\n', PUBLIC, { repo: w.repo, store: w.store })).toEqual({ body: 'No one named.\n', refused: null })
    const read = await call(w.app, '/api/pages/inner-0001')
    expect(read.body.page.markdown).toBe('Ask [@steward-b](hub:member/steward-b) and [@steward-a](hub:member/steward-a).\n')
  })
})

// R4c2 (PR7-R79, amending PR7-R71's read half; Rule 4 is about the reader): a stored member mention reads as the name the
// viewer may read now, else the id. Labels are still written at the text's level (R4c 1), so git holds no stricter name;
// only what each reader is handed changes. The public's reads (GET as the public, `?as=public`, the portal's input) say the
// id wherever the name is the members'.
describe('R4c2: a member mention reads as the name the viewer may read (PR7-R79)', () => {
  const MD = 'Ask [@Steward B](hub:member/steward-b).\n'
  const AS_ID = 'Ask [@steward-b](hub:member/steward-b).\n'
  // Names kept to a role steward-a holds by the members file (no hats read here): `?as=members` reads as a plain member.
  const STEWARDS = GOVERNANCE.replace('  decisions: []', '    stewards: { members: [steward-a] }\n  decisions: []')
  const STEWARD_NAMES = `${VISIBILITY}    members: { fields: { name: "role:stewards" } }\n`

  it('a public page naming a member whose name is at members: a member reads the name, the public the id', async () => {
    const w = await world({ pages: { 'open-0001': page('open-0001', 'Open', { visibility: 'public', body: MD }) } })
    expect((await call(w.app, '/api/pages/open-0001')).body.page.markdown).toBe(MD)
    expect((await call(w.app, '/api/pages/open-0001?as=members')).body.page.markdown).toBe(MD)
    expect((await call(w.app, '/api/pages/open-0001?as=public')).body.page.markdown).toBe(AS_ID)
    const pub = await call(w.pub, '/api/pages/open-0001')
    expect(pub.status).toBe(200)
    expect(pub.body.page.markdown).toBe(AS_ID)
    expect(JSON.stringify(pub.body)).not.toContain('Steward B')
    expect(publicPagesOf(w.repo).find(p => p.front.id === 'open-0001')!.body).toBe(AS_ID)
  })

  it('a name kept to role:stewards: a steward reads it on a public page and a members page; a plain member and the public read the id', async () => {
    const w = await world({ governance: STEWARDS, visibility: STEWARD_NAMES, pages: {
      'open-0001': page('open-0001', 'Open', { visibility: 'public', body: AS_ID }), 'inner-0001': page('inner-0001', 'Inner', { body: AS_ID }),
    } })
    for (const id of ['open-0001', 'inner-0001']) {
      expect((await call(w.app, `/api/pages/${id}`)).body.page.markdown).toBe(MD)
      expect((await call(w.app, `/api/pages/${id}?as=members`)).body.page.markdown).toBe(AS_ID)
    }
    const pub = await call(w.pub, '/api/pages/open-0001')
    expect(pub.body.page.markdown).toBe(AS_ID)
    expect(JSON.stringify(pub.body)).not.toContain('Steward B')
    expect(publicPagesOf(w.repo).find(p => p.front.id === 'open-0001')!.body).toBe(AS_ID)
  })

  it('the write half is R4c 1\'s: a member saving a public page with a members-level name writes the id, and reads the name back', async () => {
    const w = await world()
    const pub = await call(w.app, '/api/pages', json('POST', { title: 'Open', visibility: 'public', markdown: MD }))
    expect(pub.status).toBe(201)
    expect(fileAt(w.repo, `pages/${pub.body.id}.md`)).toContain(AS_ID)
    expect(fileAt(w.repo, `pages/${pub.body.id}.md`)).not.toContain('Steward B')
    expect((await call(w.app, `/api/pages/${pub.body.id}`)).body.page.markdown).toBe(MD)
    expect((await call(w.pub, `/api/pages/${pub.body.id}`)).body.page.markdown).toBe(AS_ID)
  })
})
