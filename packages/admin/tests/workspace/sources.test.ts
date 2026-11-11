import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Hono } from 'hono'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { Membership } from '../../server/session/membership.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { orgName } from '../../server/resources/util.ts'
import { fromOf, sourcesFor, type Source } from '../../server/workspace/sources.ts'
import type { DriverRead } from '../../server/systems/driver.ts'
import type { WearerReading } from '../../server/systems/hats.ts'
import type { Viewer } from '../../lib/visibility.mjs'
import { FromMark } from '../../app/src/elements/atoms/FromMark.tsx'

// DAO-OS L6 §10 (Q70), Task 14: GET /api/sources and the from mark. Every test builds a fresh temporary repository
// (makeChangeRepo) and keeps its store in a folder of its own under the temp directory: nothing is written inside this
// worktree. Locally, git's identity is steward-a, whose wallet A1 wears Ops; steward-c wears nothing. Placeholders only;
// nothing calls a network: the reader the routes are given answers from its cache, and a read is never asked for.

const NOW = new Date('2026-10-30T12:00:00Z')
const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`
const HATS: Record<string, string[]> = { [A1]: [OPS] }
const AT_OPS = `hat:${OPS}`
const NOTION_ROW = '0123456789abcdef0123456789abcdef'
const NOTION_PAGE = 'fedcba9876543210fedcba9876543210'
const NOTION_SECRET = '00112233445566778899aabbccddeeff'
const PRIVATE_PAGE = 'p-0123456789ab'
const PLAIN_PRIVATE_PAGE = 'p-ba9876543210'

const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
  - { id: treasury, kind: safe, name: Treasury, chain: "${CELO}", address: "0x00000000000000000000000000000000000000a4", driver: safe }
  - { id: board, kind: link, name: Board, url: "https://board.example.test" }
  - id: commons-repo
    kind: repo
    driver: repo
    name: The commons
    url: "https://github.com/example-org/commons"
    files: [data/projects.yaml, data/kb/ideas.yaml]
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person }
  - { id: steward-c, name: Steward C, kind: person, handles: { git: ["steward-c@example.test"] } }
`
const VISIBILITY = `visibility:
  defaults: { contact: "${AT_OPS}" }
`
const TASKS = `schema_version: "2.0"
tasks:
  - { id: t-plain, title: Write the agenda, status: todo }
  - id: t-imported
    title: Water the garden
    status: doing
    from: { source: notion, id: "${NOTION_ROW}", exported: "2026-08-12" }
`
/** Two receipts of one export (the second a re-run that created nothing) and a Fileverse pull whose not-carried part
 *  holds a restricted count (PF-R22): Sources never expands it. */
const IMPORTS = `imports:
  - id: imp_first00000000000
    source: notion
    export: "2026-08-12"
    at: "2026-08-13T09:00:00.000Z"
    by: steward-a
    created: { pages: 2, records: 3, collections: 1 }
    updated: 0
    kept: 0
    not_carried: []
    blobs: {}
  - id: imp_rerun00000000000
    source: notion
    export: "2026-08-12"
    at: "2026-08-14T09:00:00.000Z"
    by: steward-a
    created: { pages: 0, records: 0, collections: 0 }
    updated: 0
    kept: 0
    not_carried: []
    blobs: {}
  - id: imp_pull000000000000
    source: fileverse
    export: "2026-10-01"
    at: "2026-10-01T10:00:00.000Z"
    by: steward-a
    created: { pages: 0, records: 0, collections: 0 }
    updated: 0
    kept: 0
    not_carried:
      - { what: "2 items in a restricted collection or page", why: "kept where only some members may read them" }
    blobs: {}
`
const page = (id: string, title: string, extra = '') =>
  `---\nid: ${id}\ntitle: ${title}\nparent: null\norder: 1000\n${extra}---\n${title}, the body.\n`

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed by the test */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

const minutesAgo = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString()
const goodRead = (over: Partial<DriverRead> = {}): DriverRead => ({
  ok: true, readAt: minutesAgo(2), facts: {}, open: null, state: 'fresh',
  sections: [
    { title: 'Owners', rows: [{ cells: ['Steward A'] }, { cells: ['Steward B'] }] },
    { title: 'Balances', rows: [{ cells: ['CELO', '10'] }] },
  ], ...over,
})
/** The `repo` driver's facts as L7 §12 gives them (the driver is not on this branch: a fixture of its shape). */
const repoRead = (): DriverRead => ({
  ok: true, readAt: minutesAgo(5), state: 'fresh', sections: [], open: { url: 'https://github.com/example-org/commons', embeddable: false },
  facts: {
    repo: 'example-org/commons', sha: 'a'.repeat(40), committed: '2026-10-29T08:00:00Z',
    files: [{ path: 'data/projects.yaml', ok: true, items: 4 }, { path: 'data/kb/ideas.yaml', ok: false, items: 0, error: 'not published, or private' }],
    items: [{ path: 'data/projects.yaml', id: 'p-1', title: 'A project', from: 'from example-org/commons' }],
  },
})

interface World { repo: string; store: PrivateStore; app: Hono; pub: Hono; reader: FakeReader }
interface FakeReader { cached: ReturnType<typeof vi.fn>; stateOf: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn> }

/** A reader whose cache holds `reads` (by system id): `cached` and `stateOf` answer from it; `read` (a driver read, the
 *  network for a networked driver) must never be called by these routes. */
function fakeReader(reads: Record<string, DriverRead>): FakeReader {
  return {
    cached: vi.fn((id: string) => reads[id] ?? null),
    stateOf: vi.fn((id: string) => reads[id]?.state ?? (reads[id] ? (reads[id]!.ok ? 'fresh' : 'failed') : 'unknown')),
    read: vi.fn(async () => { throw new Error('no read may be asked for: Sources reads the cache') }),
  }
}

async function world(reads: Record<string, DriverRead> = {}): Promise<World> {
  const repo = makeChangeRepo(GOVERNANCE)
  cleanup.push(repo)
  const files: Record<string, string> = {
    'data/systems.yaml': SYSTEMS, 'data/members.yaml': MEMBERS, 'data/visibility.yaml': VISIBILITY, 'data/imports.yaml': IMPORTS,
    'pages/handbook-0001.md': page('handbook-0001', 'Handbook', `from: { source: notion, id: "${NOTION_PAGE}", exported: "2026-08-12" }\n`),
    'pages/plain-0001.md': page('plain-0001', 'Plain'),
    'memory/2026-10-29.md': '# A day\n', 'README.md': '# Not governed\n',
  }
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(repo, rel, '..'), { recursive: true })
    writeFileSync(join(repo, rel), text)
  }
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: systems, members, pages, imports"')
  // The tasks file in a commit of its own, at a time of its own: its from mark reads that commit's time.
  writeFileSync(join(repo, 'data', 'tasks.yaml'), TASKS)
  git(repo, 'add data/tasks.yaml')
  execSync('git commit -qm "fixture: tasks"', { cwd: repo, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T10:00:00Z' } })
  const dir = mkdtempSync(join(tmpdir(), 'sources-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  // Kept at Ops: a task of a git collection, a private collection and its record, two private pages, a private System.
  const mark = (id: string) => ({ source: 'notion', id, exported: '2026-08-12' })
  await store.putRecord({ collection: 'tasks', id: 't-payroll', visibility: AT_OPS, body: { title: 'Payroll run', status: 'todo', from: mark(NOTION_SECRET) }, rev: '' }, 'steward-a', null)
  await store.putCollection({ id: 'grants-private', visibility: AT_OPS, definition: { id: 'grants-private', name: 'Grants under negotiation', fields: [{ id: 'title', type: 'text' }] } }, 'steward-a')
  await store.putRecord({ collection: 'grants-private', id: 'g-1', visibility: AT_OPS, body: { title: 'A grant', from: mark('11112222333344445555666677778888') }, rev: '' }, 'steward-a', null)
  await store.putRecord({ collection: 'pages', id: PRIVATE_PAGE, visibility: AT_OPS, body: { title: 'Payroll plan', parent: null, order: 1000, markdown: 'Salaries.\n', from: mark('99990000aaaabbbbccccddddeeeeffff') }, rev: '' }, 'steward-a', null)
  await store.putRecord({ collection: 'pages', id: PLAIN_PRIVATE_PAGE, visibility: AT_OPS, body: { title: 'Ops notes', parent: null, order: 1000, markdown: 'Notes.\n' }, rev: '' }, 'steward-a', null)
  await store.putRecord({ collection: 'systems', id: 'ops-vault', visibility: AT_OPS, body: { name: 'Ops vault', kind: 'safe' }, rev: '' }, 'steward-a', null)
  const now = () => NOW
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, block: 100, readAt: NOW.toISOString(),
    hats: Object.entries(HATS).find(([a]) => a.toLowerCase().endsWith(account.toLowerCase().slice(-40)))?.[1] ?? [] })
  const hatReader = { wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)), wearers: vi.fn() }
  const membership = new Membership({ repo, reader: hatReader as never, now })
  // A read takes the last good reading of a wallet (§5.2): steward-a's is read once, as a write would.
  await membership.forAct(A1)
  const reader = fakeReader(reads)
  const app = createApp(repo, undefined, { request: withRequest({ repo, hosted: false, membership, store, now }), privateStore: () => store, systems: reader as never })
  const pub = createApp(repo, undefined, { request: withRequest({ repo, hosted: true, membership: null }), privateStore: () => store, systems: reader as never })
  return { repo, store, app, pub, reader }
}

async function call(app: Hono, path: string): Promise<{ status: number; text: string; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await app.request(path)
  const text = await res.text()
  return { status: res.status, text, body: text === '' ? null : JSON.parse(text) }
}
/** steward-c is git's identity: a member with no wallet, so no hats. */
const asStewardC = (repo: string) => git(repo, 'config user.email steward-c@example.test')
const byId = (sources: Source[], id: string) => sources.find(s => s.id === id)
const supply = (s: Source | undefined, what: string) => s?.supplies.find(x => x.what === what)
const lastCommitOf = (repo: string, rel: string) => git(repo, `log -1 --format=%aI -- ${rel}`).trim()
const STEWARD_A: Viewer = { kind: 'member', id: 'steward-a', hats: [OPS], roles: [] }

describe('GET /api/sources: the instance (L6 §10)', () => {
  it('the instance lists its collections with gated counts, its pages and other governed files', async () => {
    const w = await world()
    const a = await call(w.app, '/api/sources')
    expect(a.status).toBe(200)
    const instance = byId(a.body, 'instance')!
    expect(instance).toMatchObject({ kind: 'instance', name: orgName(w.repo) })
    // Its last commit, read from git; the Hub reads its own repository as it is, so the read is fresh.
    expect(instance.read).toEqual({ at: git(w.repo, 'log -1 --format=%aI').trim(), state: 'fresh' })
    // steward-a wears Ops: the task kept at Ops counts, and so do the private collection and the two private pages.
    expect(supply(instance, 'tasks')).toEqual({ what: 'tasks', count: 3, href: '/c/tasks' })
    expect(supply(instance, 'members')).toEqual({ what: 'members', count: 3, href: '/c/members' })
    expect(supply(instance, 'grants-private')).toEqual({ what: 'grants-private', count: 1, href: '/c/grants-private' })
    expect(supply(instance, 'pages')).toEqual({ what: 'pages', count: 4, href: '/workspace' })
    // finances, federation, governance, visibility, imports and the memory note; README.md is not governed, and a
    // collection's file or a page is not counted twice.
    expect(supply(instance, 'other governed files')).toEqual({ what: 'other governed files', count: 6 })

    asStewardC(w.repo)
    const c = await call(w.app, '/api/sources')
    const theirs = byId(c.body, 'instance')!
    expect(supply(theirs, 'tasks')!.count).toBe(2)
    expect(supply(theirs, 'pages')!.count).toBe(2)
    expect(supply(theirs, 'other governed files')!.count).toBe(6)
  })

  it('a private collection appears only to a viewer admitted to it', async () => {
    const w = await world({ 'ops-vault': goodRead() })
    asStewardC(w.repo)
    const c = await call(w.app, '/api/sources')
    expect(c.status).toBe(200)
    // Not named, not counted, no zero: nothing of it, nor of the private System, the private pages or the kept task.
    for (const word of ['grants-private', 'Grants under negotiation', 'ops-vault', 'Ops vault', 'Payroll', PRIVATE_PAGE, PLAIN_PRIVATE_PAGE, NOTION_SECRET]) {
      expect(c.text, word).not.toContain(word)
    }
    git(w.repo, 'config user.email admin-test@local')
    const a = await call(w.app, '/api/sources')
    expect(supply(byId(a.body, 'instance'), 'grants-private')).toMatchObject({ count: 1 })
    expect(byId(a.body, 'system:ops-vault')).toMatchObject({ kind: 'system', name: 'Ops vault' })
  })

  it('the public is 401', async () => {
    const w = await world()
    const r = await call(w.pub, '/api/sources')
    expect(r.status).toBe(401)
    expect(r.body).toEqual({ error: 'Sign in to see this: it is for members only.', code: 'SIGN_IN' })
  })
})

describe('GET /api/sources: Systems and imports (L6 §10)', () => {
  it('each System lists its sections with the read\'s age and state; a failed read is `failed`', async () => {
    const failed: DriverRead = { ...goodRead({ readAt: minutesAgo(120) }), ok: false, error: 'the host did not answer', state: 'failed' }
    const w = await world({ treasury: goodRead(), board: failed })
    const r = await call(w.app, '/api/sources')
    const treasury = byId(r.body, 'system:treasury')!
    expect(treasury).toEqual({
      id: 'system:treasury', kind: 'system', name: 'Treasury', href: '/r/system/treasury',
      supplies: [{ what: 'Owners', count: 2 }, { what: 'Balances', count: 1 }],
      read: { at: minutesAgo(2), state: 'fresh' },
    })
    // The failed read keeps the last good one's sections and age; its state is failed.
    expect(byId(r.body, 'system:board')).toMatchObject({ kind: 'system', name: 'Board', read: { at: minutesAgo(120), state: 'failed' } })
    // A System never read yet: no sections, no age.
    expect(byId(r.body, 'system:hats-main')).toMatchObject({ name: 'Hats', supplies: [], read: { at: null, state: 'unknown' } })
    // Nothing called a driver: every read came from the reader's cache.
    expect(w.reader.read).not.toHaveBeenCalled()
  })

  it('a `repo` System (L7\'s facts shape) lists its files and "from <owner>/<repo>"', async () => {
    const w = await world({ 'commons-repo': repoRead() })
    const r = await call(w.app, '/api/sources')
    expect(byId(r.body, 'system:commons-repo')).toEqual({
      id: 'system:commons-repo', kind: 'repo', name: 'The commons', href: '/r/system/commons-repo', from: 'from example-org/commons',
      // A file the read could not take has no count.
      supplies: [{ what: 'data/projects.yaml', count: 4 }, { what: 'data/kb/ideas.yaml' }],
      read: { at: minutesAgo(5), state: 'fresh' },
    })
    // Not read yet: its record's files, and its owner and repository from its url.
    const unread = await world()
    const u = await call(unread.app, '/api/sources')
    expect(byId(u.body, 'system:commons-repo')).toMatchObject({
      kind: 'repo', from: 'from example-org/commons', supplies: [{ what: 'data/projects.yaml' }, { what: 'data/kb/ideas.yaml' }], read: { at: null, state: 'unknown' },
    })
  })

  it('an import receipt lists its counts', async () => {
    const w = await world()
    const a = await call(w.app, '/api/sources')
    const imports = (a.body as Source[]).filter(s => s.kind === 'import')
    // One source per export: the re-run of 12 Aug is the same export, named by its newest receipt.
    expect(imports.map(s => s.id)).toEqual(['import:imp_rerun00000000000'])
    // What it supplies is what the viewer may read of it now, gated (steward-a wears Ops): the git page and the private
    // page, the git task and the task kept at Ops, the private collection's record (pages, then the collections in the
    // instance's order).
    expect(imports[0]).toEqual({
      id: 'import:imp_rerun00000000000', kind: 'import', name: 'Notion',
      supplies: [{ what: 'pages', count: 2, href: '/workspace' }, { what: 'tasks', count: 2, href: '/c/tasks' }, { what: 'grants-private', count: 1, href: '/c/grants-private' }],
      read: { at: '2026-08-12', state: 'aged' },
    })
    // The pull's items: none here, so it is absent (Tasks 13–14 review M4). Its restricted count stays in its receipt:
    // Sources neither repeats nor expands it.
    expect(a.text).not.toContain('imp_pull000000000000')
    expect(a.text).not.toContain('restricted collection or page')

    asStewardC(w.repo)
    const c = await call(w.app, '/api/sources')
    const notion = (c.body as Source[]).find(s => s.kind === 'import' && s.name === 'Notion')!
    // What they may not read is absent: no line for the private collection, the counts of what they may read only.
    expect(notion.supplies).toEqual([{ what: 'pages', count: 1, href: '/workspace' }, { what: 'tasks', count: 1, href: '/c/tasks' }])
  })
})

describe('fromOf (L6 §10, R-L6-FM)', () => {
  const deps = async (w: World, viewer: Viewer = STEWARD_A, reads: Record<string, DriverRead> = {}) => ({ repo: w.repo, store: w.store, reads, viewer })
  const text = (from: unknown) => renderToStaticMarkup(createElement(FromMark, { from: from as never, now: NOW })).replace(/<[^>]+>/g, '')

  it('`fromOf` on an imported record reads "from Notion · exported 12 Aug"', async () => {
    const w = await world()
    const task = { registry: 'tasks', id: 't-imported', from: { source: 'notion', id: NOTION_ROW, exported: '2026-08-12' } }
    const mark = await fromOf(task, await deps(w))
    expect(mark).toEqual({ import: 'Notion', exportedAt: '2026-08-12' })
    expect(text(mark)).toBe('from Notion · exported 12 Aug')
    // A Fileverse tab (R-L6-T13-5's keys): from Fileverse, the pull's day.
    const tab = { from: { source: 'fileverse', id: 'doc-a/tab-1.md', exported: '2026-10-01', doc: 'doc-a', tab: 'One', tab_id: 'default', pulled_at: '2026-10-01T09:00:00Z', content_sha256: 'b'.repeat(64) } }
    expect(await fromOf(tab, await deps(w))).toEqual({ import: 'Fileverse', exportedAt: '2026-10-01' })
  })

  it('on a task "data/tasks.yaml" with its last commit time; the time follows HEAD', async () => {
    const w = await world()
    const mark = await fromOf({ registry: 'tasks', id: 't-plain' }, await deps(w))
    expect(mark).toEqual({ file: 'data/tasks.yaml', readAt: lastCommitOf(w.repo, 'data/tasks.yaml') })
    expect(new Date(mark && 'readAt' in mark ? String(mark.readAt) : '').toISOString()).toBe('2026-10-01T10:00:00.000Z')
    // The collection itself (a view's header) reads the same file.
    expect(await fromOf({ registry: 'tasks' }, await deps(w))).toEqual(mark)
    // A new commit to the file: the next mark reads it (cached per HEAD).
    writeFileSync(join(w.repo, 'data', 'tasks.yaml'), `${TASKS}  - { id: t-new, title: A new one, status: todo }\n`)
    git(w.repo, 'add data/tasks.yaml')
    execSync('git commit -qm "tasks: a new one"', { cwd: w.repo, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_DATE: '2026-10-20T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-20T10:00:00Z' } })
    const after = await fromOf({ registry: 'tasks', id: 't-plain' }, await deps(w))
    expect(after && 'readAt' in after ? new Date(String(after.readAt)).toISOString() : null).toBe('2026-10-20T10:00:00.000Z')
  })

  it('on a private page its store `updated_at`; on a git page the instance with the page\'s last commit', async () => {
    const w = await world()
    const kept = await fromOf({ page: PLAIN_PRIVATE_PAGE }, await deps(w))
    expect(kept).toEqual({ instance: orgName(w.repo), readAt: w.store.updatedAt('pages', PLAIN_PRIVATE_PAGE) })
    expect(Date.parse(String(kept && 'readAt' in kept ? kept.readAt : ''))).not.toBeNaN()
    expect(await fromOf({ page: 'plain-0001' }, await deps(w))).toEqual({ instance: orgName(w.repo), readAt: lastCommitOf(w.repo, 'pages/plain-0001.md') })
    // A record kept in the store: the instance, with its store time.
    expect(await fromOf({ registry: 'grants-private', id: 'g-1', from: null }, await deps(w))).toEqual({ instance: orgName(w.repo), readAt: w.store.updatedAt('grants-private', 'g-1') })
  })

  it('a from mark of anything the viewer may not read is absent', async () => {
    const w = await world()
    const stewardC: Viewer = { kind: 'member', id: 'steward-c', hats: [], roles: [] }
    expect(await fromOf({ page: PLAIN_PRIVATE_PAGE }, await deps(w, stewardC))).toBeNull()
    expect(await fromOf({ registry: 'grants-private' }, await deps(w, stewardC))).toBeNull()
    expect(await fromOf({ registry: 'tasks', id: 't-payroll' }, await deps(w, stewardC))).toBeNull()
    expect(await fromOf({ from: { system: 'ops-vault' } }, await deps(w, stewardC, { 'ops-vault': goodRead() }))).toBeNull()
    expect(await fromOf({ page: 'no-such-page' }, await deps(w))).toBeNull()
  })

  it('a `repo` item reads "from <owner>/<repo>" with the read\'s age; a System\'s item its System and read', async () => {
    const w = await world()
    const reads = { 'commons-repo': repoRead(), treasury: goodRead() }
    const item = await fromOf({ from: { system: 'commons-repo', path: 'data/projects.yaml' } }, await deps(w, STEWARD_A, reads))
    expect(item).toEqual({ repo: 'example-org/commons', file: 'data/projects.yaml', readAt: minutesAgo(5) })
    expect(text(item)).toBe('from example-org/commons · read 5\u00a0min ago') // walk W3, D3: the repository, never the file
    expect(await fromOf({ from: { system: 'treasury' } }, await deps(w, STEWARD_A, reads))).toEqual({ system: 'Treasury', read: reads.treasury })
  })

  it('gated records carry `from` when asked; a page its mark; the public is given none', async () => {
    const w = await world()
    const plain = await call(w.app, '/api/registries/tasks')
    expect(plain.text).not.toContain('fromMark')
    const asked = await call(w.app, '/api/registries/tasks?from=1')
    expect(asked.body.fromMark).toEqual({ file: 'data/tasks.yaml', readAt: lastCommitOf(w.repo, 'data/tasks.yaml') })
    const marks = Object.fromEntries((asked.body.entries as { id: string; fromMark: unknown }[]).map(e => [e.id, e.fromMark]))
    expect(marks).toEqual({
      't-plain': { file: 'data/tasks.yaml', readAt: lastCommitOf(w.repo, 'data/tasks.yaml') },
      't-imported': { import: 'Notion', exportedAt: '2026-08-12' },
      't-payroll': { import: 'Notion', exportedAt: '2026-08-12' },
    })
    // The record's own `from` (the import's mark) is left as the record holds it.
    expect((asked.body.entries as { id: string; from?: unknown }[]).find(e => e.id === 't-imported')!.from).toEqual({ source: 'notion', id: NOTION_ROW, exported: '2026-08-12' })
    const pageRead = await call(w.app, '/api/pages/handbook-0001')
    expect(pageRead.body.page.fromMark).toEqual({ import: 'Notion', exportedAt: '2026-08-12' })
    const pub = await call(w.pub, '/api/registries/tasks?from=1')
    expect(pub.text).not.toContain('fromMark')
  })
})
