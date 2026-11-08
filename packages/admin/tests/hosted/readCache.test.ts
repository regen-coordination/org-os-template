import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git, SOLO } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { viewerOf, withRequest } from '../../server/request.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { Membership } from '../../server/session/membership.ts'
import { createSession } from '../../server/session/sessions.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { ReadCache, RACY_MS, readCacheFor, type FileStat } from '../../server/hosted/readCache.ts'
import {
  EventLevels, gateRegistry, gateRegistryList, Levels, MEMBERS, PUBLIC, PUBLIC_VIEWER, publicProjection,
} from '../../server/visibility/gate.ts'
import type { Graph, Resource } from '../../server/resources/types.ts'
import type { Viewer } from '../../lib/visibility.mjs'

// L9 spec §7.6 (carry 9): a long-running hosted Hub reads its registries and its visibility policy through one stat-keyed
// cache per repository, and its event levels forget a resource that has left. The cache must never let a stale reading
// widen what the public sees: a narrowing write is seen by the very next gated read. Every repository is a fresh one under
// the temp directory (makeChangeRepo); nothing touches the network.
//
// The parser is spied on through the YAML library: each registry text holds a sentinel, and the calls that parse a text
// holding it are counted. A file written a moment ago is too fresh for the cache to vouch for (RACY_MS), so the tests that
// look for the cache's hits move the clock (Date only) an hour on.

const parsed = vi.hoisted(() => ({ texts: [] as string[] }))
vi.mock('yaml', async importOriginal => {
  const yaml = await importOriginal<typeof import('yaml')>()
  return {
    ...yaml,
    parseDocument: ((src: string, ...rest: unknown[]) => {
      parsed.texts.push(src)
      return (yaml.parseDocument as (...a: unknown[]) => unknown)(src, ...rest)
    }) as typeof yaml.parseDocument,
  }
})
const parses = (sentinel: string) => parsed.texts.filter(t => t.includes(sentinel)).length

const NOW = new Date('2026-10-30T12:00:00Z')
const HOUR = 3_600_000
/** Date an hour on: every file written so far is settled for the cache. Timers are left as they are. */
function settleFiles(): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.now() + HOUR)
}
afterEach(() => { vi.useRealTimers() })

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const publicApp = (repo: string) => createApp(repo, undefined, { request: withRequest({ repo, hosted: true, membership: null }) })
const entriesOf = async (app: Hono, path: string) => ((await (await app.request(path)).json()) as { entries: { id: string }[] }).entries.map(e => e.id)

/** A project as one line, padded so a narrowing keeps the file's size (the hardest case for a stat-keyed cache). */
const projectLine = (id: string, level: 'public' | 'members') => `  - { id: ${id}, title: "SENTINEL-${id}", status: execute, type: program, lead: steward-a, visibility: ${level === 'public' ? 'public ' : 'members'} }\n`
const projects = (lines: string[]) => `schema_version: "2.0"\nprojects:\n${lines.join('')}`
const policy = (level: 'public' | 'members') => `visibility:\n  collections:\n    projects: { default: ${level === 'public' ? 'public ' : 'members'} }\n`

/** A governance under which a record change is proposed, and a maintainer decides it. */
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [steward-a, steward-b] }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`

function repoWith(files: Record<string, string>, governance: string): string {
  const repo = makeChangeRepo(governance)
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(repo, rel), text)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: what is public"')
  return repo
}

const repos: string[] = []
afterAll(() => { for (const r of repos) removeFixtureRepo(r) })
const fresh = (files: Record<string, string>, governance = GOVERNANCE) => { const r = repoWith(files, governance); repos.push(r); return r }

describe('ReadCache', () => {
  let dir: string
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'admin-readcache-')) })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('a file replaced with the same size and mtime but a new inode is read again', () => {
    const path = join(dir, 'a.txt')
    writeFileSync(path, 'one')
    let ino = 1
    const stat = (): FileStat => ({ ino, mtimeMs: 1_000, size: 3 })
    const cache = new ReadCache({ stat })
    const parse = vi.fn((text: string) => text)
    expect(cache.get(path, parse)).toBe('one')
    expect(cache.get(path, parse)).toBe('one')
    expect(parse).toHaveBeenCalledTimes(1)

    writeFileSync(join(dir, 'b.txt'), 'two'); renameSync(join(dir, 'b.txt'), path); ino = 2
    expect(cache.get(path, parse)).toBe('two')
    expect(parse).toHaveBeenCalledTimes(2)
    expect(cache.get(path, parse)).toBe('two')
    expect(parse).toHaveBeenCalledTimes(2)
  })

  it('a file changed within RACY_MS of the read is read again on every request, though its keys are the same', () => {
    const path = join(dir, 'racy.txt')
    writeFileSync(path, 'one')
    const at = Date.now()
    const cache = new ReadCache({ stat: () => ({ ino: 7, mtimeMs: at, size: 3 }), now: () => at + RACY_MS - 1 })
    const parse = vi.fn((text: string) => text)
    expect(cache.get(path, parse)).toBe('one')
    writeFileSync(path, 'two') // same size, and the stat says nothing moved: a write in the same tick of the clock
    expect(cache.get(path, parse)).toBe('two')
    expect(parse).toHaveBeenCalledTimes(2)
    expect(cache.size).toBe(0)
  })

  it('a ctime that moved reads again though the mtime was set back; a file it cannot stat is read through', () => {
    const path = join(dir, 'c.txt')
    writeFileSync(path, 'one')
    let ctimeMs = 1_000
    const cache = new ReadCache({ stat: () => ({ ino: 3, mtimeMs: 1_000, ctimeMs, size: 3 }) })
    const parse = vi.fn((text: string) => text)
    cache.get(path, parse); cache.get(path, parse)
    expect(parse).toHaveBeenCalledTimes(1)
    writeFileSync(path, 'two'); ctimeMs = 2_000
    expect(cache.get(path, parse)).toBe('two')

    const blind = new ReadCache({ stat: () => null })
    const again = vi.fn((text: string) => text)
    blind.get(path, again); blind.get(path, again)
    expect(again).toHaveBeenCalledTimes(2)
    expect(() => blind.get(join(dir, 'missing.txt'), again)).toThrow(/ENOENT/)
  })

  it('a parse that throws is not kept; one parser does not answer for another', () => {
    const path = join(dir, 'd.txt')
    writeFileSync(path, 'one')
    const cache = new ReadCache({ stat: () => ({ ino: 4, mtimeMs: 1_000, size: 3 }) })
    let fail = true
    const parse = vi.fn((text: string) => { if (fail) throw new Error('not yet'); return text })
    expect(() => cache.get(path, parse)).toThrow('not yet')
    fail = false
    expect(cache.get(path, parse)).toBe('one')
    expect(parse).toHaveBeenCalledTimes(2)
    const upper = (text: string) => text.toUpperCase()
    expect(cache.get(path, upper)).toBe('ONE')
    expect(cache.get(path, parse)).toBe('one')
  })

  it('a file whose keys moved while it was read is not kept: the next request reads it again', () => {
    const path = join(dir, 'moved.txt')
    writeFileSync(path, 'one')
    let mtimeMs = 1_000
    const stat = vi.fn((): FileStat => ({ ino: 5, mtimeMs, size: 3 }))
    const cache = new ReadCache({ stat })
    // A write lands between the stat before the read and the stat after it.
    const parse = vi.fn((text: string) => { if (parse.mock.calls.length === 1) mtimeMs = 1_001; return text })
    expect(cache.get(path, parse)).toBe('one')
    expect(cache.size).toBe(0)
    expect(cache.get(path, parse)).toBe('one') // keys steady now: read, and kept
    expect(cache.get(path, parse)).toBe('one')
    expect(parse).toHaveBeenCalledTimes(2)
    expect(cache.size).toBe(1)
  })

  it('the device is part of the key: the same inode on another device is another file', () => {
    const path = join(dir, 'dev.txt')
    writeFileSync(path, 'one')
    let dev = 1
    const cache = new ReadCache({ stat: () => ({ dev, ino: 6, mtimeMs: 1_000, size: 3 }) })
    const parse = vi.fn((text: string) => text)
    cache.get(path, parse); cache.get(path, parse)
    expect(parse).toHaveBeenCalledTimes(1)
    writeFileSync(path, 'two'); dev = 2
    expect(cache.get(path, parse)).toBe('two')
    expect(parse).toHaveBeenCalledTimes(2)
  })

  it('readCacheFor gives one cache per repository', () => {
    expect(readCacheFor(dir)).toBe(readCacheFor(`${dir}/.`))
    expect(readCacheFor(dir)).not.toBe(readCacheFor(join(dir, 'other')))
  })
})

describe('the gate reads through the cache', () => {
  it('a registry is parsed once across 50 gated requests while unchanged, and again after a write', async () => {
    const repo = fresh({ 'data/projects.yaml': projects([projectLine('p-once', 'public')]), 'data/visibility.yaml': policy('public') })
    const app = publicApp(repo)
    settleFiles()
    const before = parses('SENTINEL-p-once')
    for (let i = 0; i < 50; i++) expect(await entriesOf(app, '/api/registries/projects')).toEqual(['p-once'])
    expect(parses('SENTINEL-p-once') - before).toBe(1)

    writeFileSync(join(repo, 'data', 'projects.yaml'), projects([projectLine('p-once', 'public'), projectLine('p-twice', 'public')]))
    for (let i = 0; i < 50; i++) expect(await entriesOf(app, '/api/registries/projects')).toEqual(['p-once', 'p-twice'])
    expect(parses('SENTINEL-p-once') - before).toBe(2)
  })

  it('a registry written a moment ago is parsed on every request until it settles (it cannot be vouched for)', async () => {
    const repo = fresh({ 'data/projects.yaml': projects([projectLine('p-racy', 'public')]), 'data/visibility.yaml': policy('public') })
    const app = publicApp(repo)
    writeFileSync(join(repo, 'data', 'projects.yaml'), projects([projectLine('p-racy', 'public')]) + '# SENTINEL-racy\n')
    const before = parses('SENTINEL-racy')
    for (let i = 0; i < 3; i++) await entriesOf(app, '/api/registries/projects')
    expect(parses('SENTINEL-racy') - before).toBe(3)
  })

  describe('a narrowing is seen by the very next gated read', () => {
    it('a record narrowed in its file, at the same size, settled cache or not', async () => {
      for (const settled of [false, true]) {
        const repo = fresh({ 'data/projects.yaml': projects([projectLine('p-a', 'public'), projectLine('p-b', 'public')]), 'data/visibility.yaml': policy('public') })
        const app = publicApp(repo)
        if (settled) settleFiles()
        for (let i = 0; i < 3; i++) expect(await entriesOf(app, '/api/registries/projects')).toEqual(['p-a', 'p-b'])
        const text = projects([projectLine('p-a', 'public'), projectLine('p-b', 'members')])
        expect(text.length).toBe(projects([projectLine('p-a', 'public'), projectLine('p-b', 'public')]).length)
        writeFileSync(join(repo, 'data', 'projects.yaml'), text)
        expect(await entriesOf(app, '/api/registries/projects')).toEqual(['p-a'])
        expect((await publicProjection(repo, { graph: async () => ({ nodes: [], edges: [] }), now: NOW })).registries.projects?.map(e => e.id)).toEqual(['p-a'])
        vi.useRealTimers()
      }
    })

    it('a record narrowed through the server\'s own write route (a commit), read at once by the public', async () => {
      // Solo: the maintainer's edit is written and committed at once, with no proposal.
      const repo = fresh({ 'data/projects.yaml': projects([projectLine('p-w', 'public')]), 'data/visibility.yaml': policy('public') }, SOLO)
      const pub = publicApp(repo)
      const local = createApp(repo) // git's identity: steward-a, a member, as 0.6
      settleFiles()
      for (let i = 0; i < 3; i++) expect(await entriesOf(pub, '/api/registries/projects')).toEqual(['p-w'])
      const res = await local.request('/api/registries/projects/p-w', json('PUT', {
        id: 'p-w', title: 'SENTINEL-p-w', status: 'execute', type: 'program', lead: 'steward-a', visibility: 'members',
      }))
      expect(res.status, await res.clone().text()).toBeLessThan(300)
      expect(git(repo, 'log -1 --format=%s')).toContain('p-w')
      expect(await entriesOf(pub, '/api/registries/projects')).toEqual([])
      const list = (await (await pub.request('/api/registries')).json()) as { name: string }[]
      expect(list.map(r => r.name)).not.toContain('projects')
    })

    it('the visibility policy narrowed, at the same size', async () => {
      const repo = fresh({ 'data/projects.yaml': projects([projectLine('p-c', 'public').replace(', visibility: public ', '')]), 'data/visibility.yaml': policy('public') })
      const app = publicApp(repo)
      settleFiles()
      for (let i = 0; i < 3; i++) expect(await entriesOf(app, '/api/registries/projects')).toEqual(['p-c'])
      expect(policy('members').length).toBe(policy('public').length)
      writeFileSync(join(repo, 'data', 'visibility.yaml'), policy('members'))
      expect(await entriesOf(app, '/api/registries/projects')).toEqual([])
    })

    it('the members registry narrowed, at the same size', async () => {
      const members = (level: 'public' | 'members') => `schema_version: "2.0"\nmembers:\n  - { id: steward-a, name: "Steward A", kind: person, handles: { git: ["admin-test@local"] }, visibility: ${level === 'public' ? 'public ' : 'members'} }\n  - { id: steward-b, name: "Steward B", kind: person, visibility: public }\n`
      const repo = fresh({ 'data/members.yaml': members('public') })
      const app = publicApp(repo)
      settleFiles()
      for (let i = 0; i < 3; i++) expect(await entriesOf(app, '/api/registries/members')).toEqual(['steward-a', 'steward-b'])
      writeFileSync(join(repo, 'data', 'members.yaml'), members('members'))
      expect(await entriesOf(app, '/api/registries/members')).toEqual(['steward-b'])
    })
  })

  it('the gate\'s answers are equal with and without the cache', async () => {
    const repo = fresh({
      'data/members.yaml': `schema_version: "2.0"\nmembers:\n  - { id: steward-a, name: "Steward A", kind: person, visibility: public, email: "SENTINEL-email-1@example.org", handles: { git: ["admin-test@local"] } }\n  - { id: steward-b, name: "Steward B", kind: person, notes: "SENTINEL-members-1" }\n`,
      'data/projects.yaml': `schema_version: "2.0"\nprojects:\n  - { id: p-pub, title: "Public", status: execute, type: program, lead: steward-b, contributors: [steward-a], budget: "SENTINEL-budget-1" }\n  - { id: p-mem, title: "SENTINEL-members-2", status: develop, type: program, lead: steward-a, visibility: members }\n`,
      'data/ideas.yaml': `schema_version: "2.0"\nideas:\n  - { id: idea-1, title: "SENTINEL-idea-1", status: open }\n`,
      'data/visibility.yaml': 'visibility:\n  collections:\n    projects: { default: public, fields: { budget: members } }\n    proposals: { default: public }\n',
    })
    // Two proposals, one public (it changes the public project) and one members' (it changes the members' one).
    const local = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => NOW }))
    for (const [record, title] of [['projects:p-pub', 'Move the public project'], ['projects:p-mem', 'SENTINEL-proposal-1']] as const) {
      expect((await local.request('/api/changes/ops', json('POST', { ops: [{ op: 'update', record, set: { status: 'sense' } }] }))).status).toBe(200)
      const res = await local.request('/api/proposals', json('POST', { title }))
      expect(res.status, await res.clone().text()).toBe(201)
    }
    const member: Viewer = { kind: 'member', id: 'steward-b', hats: [], roles: [] }
    const graph = async (): Promise<Graph> => ({ nodes: [], edges: [] })
    // What the gate answers each viewer for each registry, and the public projection (whose proposal views are built
    // outside the gate, by proposals/view.ts, which reads the registries itself).
    const gated = () => {
      const out: Record<string, unknown> = {}
      for (const viewer of [PUBLIC_VIEWER, member]) {
        const levels = new Levels(repo)
        out[`${viewer.kind}:list`] = gateRegistryList(viewer, repo, levels)
        for (const name of ['members', 'projects', 'ideas', 'proposals', 'governance']) out[`${viewer.kind}:${name}`] = gateRegistry(viewer, repo, name, levels)
        out[`${viewer.kind}:proposal-levels`] = levels.records('proposals').map(e => [e.id, levels.record('proposals', e)])
      }
      return out
    }
    const answers = async () => JSON.parse(JSON.stringify({ ...gated(), projection: await publicProjection(repo, { graph, now: NOW }) })) as Record<string, unknown>

    // The registries the gate reads (members, projects, ideas), told apart by their sentinels.
    const registryParses = () => parsed.texts.filter(t => /SENTINEL-(email|budget|idea)-1/.test(t)).length
    const without = await answers() // every file was written a moment ago: each is read through
    settleFiles()
    let at = registryParses()
    const cold = await answers() // read, and kept
    expect(registryParses() - at).toBeGreaterThan(0)
    at = registryParses()
    gated() // the gate alone, from the cache
    expect(registryParses() - at).toBe(0)
    const warm = await answers()
    // The fixture holds what the gate tells apart: a public proposal and a members' one, a restricted field, a members'
    // record and collection.
    expect((without['public:proposals'] as { entries: unknown[] }).entries).toHaveLength(1)
    expect((without['member:proposals'] as { entries: unknown[] }).entries).toHaveLength(2)
    expect((without['public:projects'] as { entries: { id: string }[] }).entries.map(e => e.id)).toEqual(['p-pub'])
    expect(cold).toEqual(without)
    expect(warm).toEqual(without)
    expect(JSON.stringify((without as { projection: unknown }).projection)).not.toContain('SENTINEL')
    expect(JSON.stringify(without['public:projects'])).not.toContain('SENTINEL')
  })
})

describe('a signed-in request reads the members registry through the cache (L9 §7.6)', () => {
  const CELO = 'eip155:42220'
  const A1 = `${CELO}:0x00000000000000000000000000000000000000A1`
  const T0 = new Date('2026-10-30T10:00:00.000Z')
  const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}` // a hat of tree 13, as tests/hosted/grace.test.ts
  const TREE = `schema_version: "2.0"\nsystems:\n  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }\n`
  const GOV = `schema_version: "2.0"\ngovernance:\n  model: "solo-maintainer"\n  membership: { tree: hats-main }\n  roles:\n    council: { hat: "${COUNCIL}" }\n  decisions: []\n`
  /** steward-a holds the session's address; padded so a narrowing keeps the file's size. */
  const members = (level: 'public' | 'members') => `schema_version: "2.0"\nmembers:\n  - { id: steward-a, name: "SENTINEL-member-a", kind: person, wallets: ["${A1}"], visibility: ${level === 'public' ? 'public ' : 'members'} }\n`
  const stores: PrivateStore[] = []
  afterAll(() => { for (const s of stores) { try { s.close() } catch { /* closed */ } } })

  it('the parse count stays at 1 across repeated signed-in requests, and rises after a same-size member change', async () => {
    const repo = fresh({ 'data/systems.yaml': TREE, 'data/members.yaml': members('public') }, GOV)
    const dir = mkdtempSync(join(tmpdir(), 'readcache-store-')); repos.push(dir)
    const store = await openPrivateStore(repo, { dir }); stores.push(store)
    const now = () => T0
    const reader = {
      wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => ({ ok: true as const, system: 'hats-main', chain: CELO, account, hats: [COUNCIL], block: 100, readAt: T0.toISOString() })),
      wearers: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
    }
    const membership = new Membership({ repo, reader, now })
    const bare = new Hono()
    bare.use('/api/*', withRequest({ repo, hosted: true, membership, store, now }))
    bare.get('/api/viewer', c => c.json(viewerOf(c)))
    await membership.forAct(A1)
    const cookie = `house_session=${(await createSession(store, A1, now)).token}`
    const ask = async () => {
      const res = await bare.request('http://localhost:4680/api/viewer', { headers: { host: 'localhost:4680', cookie } })
      expect(res.status).toBe(200)
      return (await res.json()) as { kind: string }
    }

    settleFiles()
    const before = parses('SENTINEL-member-a')
    for (let i = 0; i < 20; i++) expect((await ask()).kind).toBe('member')
    expect(parses('SENTINEL-member-a') - before).toBe(1)

    expect(members('members').length).toBe(members('public').length)
    writeFileSync(join(repo, 'data', 'members.yaml'), members('members'))
    for (let i = 0; i < 20; i++) await ask()
    expect(parses('SENTINEL-member-a') - before).toBe(2)
  })
})

describe('EventLevels forgets a resource that left (L9 §7.6)', () => {
  const node = (id: string): Resource => ({
    id: `project:${id}`, kind: 'project', board: 'organization', name: id, status: null, attention: null, changed: null, facts: {},
    source: { registry: 'projects', entityId: id },
  } as unknown as Resource)
  const graphOf = (...ids: string[]): Graph => ({ nodes: ids.map(node), edges: [] })

  it('a resource that left is still known for one graph, then gone', () => {
    const repo = fresh({ 'data/projects.yaml': projects([projectLine('p-a', 'public'), projectLine('p-b', 'public')]), 'data/visibility.yaml': policy('public') })
    const events = new EventLevels(repo)
    events.noteGraph(graphOf('p-a', 'p-b'))
    expect(events.levelsFor({ ids: [] })('project:p-b')).toEqual(PUBLIC)
    expect(events.known).toBe(2)

    events.noteGraph(graphOf('p-a')) // p-b went: whoever could see it still hears that it went
    expect(events.levelsFor({ ids: [] })('project:p-b')).toEqual(PUBLIC)
    expect(events.known).toBe(2)

    events.noteGraph(graphOf('p-a')) // and no longer
    expect(events.levelsFor({ ids: [] })('project:p-b')).toEqual(MEMBERS)
    expect(events.known).toBe(1)

    events.noteGraph(graphOf('p-a', 'p-b')) // it came back
    expect(events.levelsFor({ ids: [] })('project:p-b')).toEqual(PUBLIC)
  })

  it('over many graphs of passing resources, only the last two graphs\' ids are kept', () => {
    const repo = fresh({ 'data/projects.yaml': projects([projectLine('p-a', 'public')]) })
    const events = new EventLevels(repo)
    for (let i = 0; i < 200; i++) events.noteGraph(graphOf('p-a', `p-pass-${i}`))
    expect(events.known).toBe(3)
  })
})
