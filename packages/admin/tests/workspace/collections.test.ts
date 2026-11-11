import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { Membership } from '../../server/session/membership.ts'
import { openPrivateStore, StoreUnavailable, type PrivateStore } from '../../server/private/store.ts'
import { REGISTRIES } from '../../server/registries.ts'
import { collectionsFileErrors } from '../../server/workspace/collections.ts'
import { collectionIdProblem, contactFieldsOf, readCollections, refsOf, schemaOf, VIEW_RESTRICTED } from '../../lib/workspace/collections.mjs'
import { referenceErrors, validateRepo } from '../../lib/data-validate.mjs'
import type { WearerReading } from '../../server/systems/hats.ts'

// DAO-OS L6 §7.3, §7.4, §16, Task 3: collection definitions in data/collections.yaml, saved views, a member's view state,
// a private collection's definition in the store; custom collections' records staged, checked and applied (ruling R-2b).
// Every test builds a fresh temporary repository (makeChangeRepo) and keeps its store in a folder of its own under the temp
// directory: nothing is written inside this worktree. Locally, git's identity is steward-a, whose wallet A1 wears Ops.
// Placeholders only; nothing touches the network.

const NOW = new Date('2026-10-30T12:00:00Z')
const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`
const HATS: Record<string, string[]> = { [A1]: [OPS] }
const SCRIPT = fileURLToPath(new URL('../../../../scripts/validate-governance.mjs', import.meta.url))

const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
  decisions: []
`
/** A rule that raises workspace:collections: a collection's definition is proposed, and approved by steward-a. */
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
    - { id: collections-consent, applies_to: ["workspace:collections"], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
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
  - { id: steward-c, name: Steward C, kind: person, handles: { git: ["steward-c@example.test"] } }
`
const VISIBILITY = `# What is public, and what is kept at a hat.
visibility:
  defaults: { contact: "hat:${OPS}" }
  collections:
    projects: { default: members }
`
/** Comments and a built-in's views, as a person writes the file by hand. */
const COLLECTIONS = `# The org's collections. Edited by the Hub and by hand.
collections:
  # Circles: who leads what.
  - id: circles
    name: Circles
    fields:
      - { id: name, type: text }
      - { id: status, type: select, options: [active, paused] }
      - { id: started, type: date }
      - { id: projects, type: relation, to: projects, many: true }
    views:
      - { id: by-status, name: By status, kind: board, board: { field: status } }
  - id: tasks # a built-in: its saved views only
    views:
      - { id: mine, name: Mine, kind: list, filters: [{ field: owner, op: is, value: steward-a }] }
`

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed by the test */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface World { repo: string; store: PrivateStore; app: Hono; appWith: (access: () => PrivateStore) => Hono }

async function world(opts: { governance?: string; collections?: string | null; files?: Record<string, string> } = {}): Promise<World> {
  const repo = makeChangeRepo(opts.governance ?? GOVERNANCE)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), VISIBILITY)
  const collections = opts.collections === undefined ? COLLECTIONS : opts.collections
  if (collections !== null) writeFileSync(join(repo, 'data', 'collections.yaml'), collections)
  for (const [rel, text] of Object.entries(opts.files ?? {})) {
    mkdirSync(join(repo, rel, '..'), { recursive: true })
    writeFileSync(join(repo, rel), text)
  }
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, three members, what is restricted, the collections"')
  const dir = mkdtempSync(join(tmpdir(), 'collections-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const now = () => NOW
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, block: 100, readAt: NOW.toISOString(),
    hats: Object.entries(HATS).find(([a]) => a.toLowerCase().endsWith(account.toLowerCase().slice(-40)))?.[1] ?? [] })
  const reader = { wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)), wearers: vi.fn() }
  const membership = new Membership({ repo, reader: reader as never, now })
  const appWith = (access: () => PrivateStore) => createApp(repo, undefined, { request: withRequest({ repo, hosted: false, membership, store, now }), privateStore: access })
  return { repo, store, app: appWith(() => store), appWith }
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
async function call(app: Hono, path: string, init?: RequestInit): Promise<{ status: number; text: string; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await app.request(path, init)
  const text = await res.text()
  return { status: res.status, text, body: text === '' ? null : JSON.parse(text) }
}
const commits = (repo: string) => Number(git(repo, 'rev-list --count HEAD').trim())
const fileAt = (repo: string, rel: string) => (existsSync(join(repo, rel)) ? readFileSync(join(repo, rel), 'utf8') : null)
/** steward-c is git's identity: a member with no wallet, so no hats. */
const asStewardC = (repo: string) => git(repo, 'config user.email steward-c@example.test')

describe('collectionIdProblem (L6 §7.4)', () => {
  const known = REGISTRIES.map(r => r.name)
  it('refuses tree-x, pages, knowledge, collections and projects, each with its sentence; accepts circles', () => {
    expect(collectionIdProblem('tree-x', known)).toBe('tree-x cannot name a collection: an id beginning with tree- names a tree of pages.')
    for (const id of ['pages', 'knowledge', 'collections']) {
      expect(collectionIdProblem(id, known)).toBe(`${id} cannot name a collection: pages, knowledge and collections are the workspace's own names.`)
    }
    expect(collectionIdProblem('projects', known)).toBe('That id cannot be used for a new collection. Choose another.')
    expect(collectionIdProblem('circles', known)).toBeNull()
  })
  it('refuses an id outside ^[a-z][a-z0-9-]{1,40}$, and one the instance already has', () => {
    const shape = 'is not a collection id: an id is 2 to 41 characters of lowercase letters, digits and hyphens, beginning with a letter.'
    expect(collectionIdProblem('c', known)).toBe(`c ${shape}`)
    expect(collectionIdProblem('Circles', known)).toBe(`Circles ${shape}`)
    expect(collectionIdProblem(`c${'x'.repeat(41)}`, known)).toBe(`c${'x'.repeat(41)} ${shape}`)
    expect(collectionIdProblem(7, known)).toBe(`7 ${shape}`)
    expect(collectionIdProblem('circles', [...known, 'circles'])).toBe('That id cannot be used for a new collection. Choose another.')
  })
})

describe('schemaOf, refsOf, contactFieldsOf (L6 §7.3)', () => {
  const def = { id: 'circles', fields: [
    { id: 'started', type: 'date' }, { id: 'status', type: 'select', options: ['active', 'paused'] }, { id: 'size', type: 'number' },
    { id: 'contact', type: 'email' }, { id: 'phone', type: 'phone' }, { id: 'projects', type: 'relation', to: 'projects', many: true },
    { id: 'lead', type: 'person' }, { id: 'span', type: 'daterange' },
  ] } as const
  const ajv = new Ajv({ allErrors: true, strict: false }); addFormats(ajv)
  const valid = ajv.compile(schemaOf(def as never))

  it('schemaOf refuses a non-date in a date field and accepts null', () => {
    expect(valid({ id: 'c-1', started: '2026-10-30' })).toBe(true)
    expect(valid({ id: 'c-1', started: null })).toBe(true)
    expect(valid({ id: 'c-1', started: 'next tuesday' })).toBe(false)
    expect(valid({ id: 'c-1', started: 20261030 })).toBe(false)
  })
  it('schemaOf reads each type: a select\'s options, a number, a relation of many, a date range; other fields are kept', () => {
    expect(valid({ id: 'c-1', status: 'paused', size: 3, projects: ['p-1'], span: { start: '2026-10-01', end: null }, extra: 'kept' })).toBe(true)
    expect(valid({ id: 'c-1', status: 'closed' })).toBe(false)
    expect(valid({ id: 'c-1', size: 'three' })).toBe(false)
    expect(valid({ id: 'c-1', projects: 'p-1' })).toBe(false)
    expect(valid({ id: 'c-1', span: { end: '2026-10-01' } })).toBe(false)
    expect(valid({ id: 'c-1', contact: 'not an address' })).toBe(false)
    expect(valid({ name: 'no id' })).toBe(false)
  })
  it('refsOf names each relation; contactFieldsOf the email and phone fields', () => {
    expect(refsOf(def as never)).toEqual([{ registry: 'circles', field: 'projects', target: 'projects', array: true }])
    expect(contactFieldsOf(def as never)).toEqual(['contact', 'phone'])
  })
})

describe('readCollections (L6 §7.3)', () => {
  it('reads the definitions in order, a built-in\'s views among them', () => {
    const read = readCollections(COLLECTIONS, REGISTRIES.map(r => r.name))
    expect(read.problems).toEqual([])
    expect(read.collections.map(c => c.id)).toEqual(['circles', 'tasks'])
    expect(read.collections[0]!.views).toEqual([{ id: 'by-status', name: 'By status', kind: 'board', board: { field: 'status' } }])
  })
  it('says what it cannot read, and leaves out an id that cannot name a collection', () => {
    const read = readCollections(`collections:
  - id: tree-x
  - id: circles
    fields: [{ id: Bad, type: text }, { id: due, type: when }, { id: lead, type: relation, to: nowhere }]
    views: [{ id: v, name: V, kind: grid }]
  - id: circles
  - id: tasks
    fields: [{ id: x, type: text }]
`, REGISTRIES.map(r => r.name))
    expect(read.collections.map(c => c.id)).toEqual(['circles', 'tasks'])
    expect(read.problems).toEqual([
      'collections.tree-x: tree-x cannot name a collection: an id beginning with tree- names a tree of pages.',
      'collections.circles.fields.0.id: Bad is not a field id: a field id is 1 to 41 characters of lowercase letters, digits and underscores, beginning with a letter.',
      'collections.circles.fields.1.type: "when" is not a field type: text, longtext, number, select, multiselect, date, daterange, checkbox, url, person, relation, page, email or phone',
      'collections.circles.fields.2.to: nowhere is no collection of this instance',
      'collections.circles.views.0.kind: "grid" is not a kind of view: table, board, calendar, list or map',
      'collections.circles: two entries are called circles; the first is read',
      'collections.tasks.fields: tasks is a built-in collection: its fields are its schema\'s, so only its name, saved views and notes_parent are kept here',
    ])
  })
})

describe('the registry list (preflight row 12, ruling P-7)', () => {
  it('holds collections, a document under `collections:`, before proposals', () => {
    const names = REGISTRIES.map(r => r.name)
    expect(REGISTRIES.find(r => r.name === 'collections')).toEqual({ name: 'collections', topKey: 'collections', kind: 'document' })
    expect(names.indexOf('collections')).toBeLessThan(names.indexOf('proposals'))
    expect(names.indexOf('collections')).toBeGreaterThan(names.indexOf('tasks'))
  })
})

describe('defining collections (L6 §7.3, §16)', () => {
  it('defining a collection with an email field writes its level into data/visibility.yaml in the same commit', async () => {
    const w = await world({ collections: null })
    const before = commits(w.repo)
    const res = await call(w.app, '/api/collections', json('POST', {
      id: 'circles', name: 'Circles', fields: [{ id: 'name', type: 'text' }, { id: 'contact', type: 'email' }],
    }))
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 'circles', commit: expect.stringMatching(/^[0-9a-f]{40}$/) })
    expect(commits(w.repo)).toBe(before + 1)
    expect(git(w.repo, 'show --name-only --format= HEAD').trim().split('\n').sort()).toEqual(['data/collections.yaml', 'data/visibility.yaml'])
    expect(git(w.repo, 'log -1 --format=%B')).toContain('Org-Rule: workspace/direct')
    expect(fileAt(w.repo, 'data/visibility.yaml')).toContain(`circles:\n      fields:\n        contact: "hat:${OPS}"`)
    expect(fileAt(w.repo, 'data/visibility.yaml')).toContain('# What is public, and what is kept at a hat.')
    expect(readCollections(fileAt(w.repo, 'data/collections.yaml')).collections).toEqual([
      { id: 'circles', name: 'Circles', fields: [{ id: 'name', type: 'text' }, { id: 'contact', type: 'email' }] },
    ])
    // validate:governance accepts the commit: a workspace write whose data/visibility.yaml change only narrows (ruling P-6).
    const head = git(w.repo, 'rev-parse HEAD').trim()
    const r = spawnSync('node', [SCRIPT, w.repo, '--strict'], { encoding: 'utf8', env: { ...process.env, CI: '' } })
    expect(r.stdout.split('\n').filter(l => l.includes(head.slice(0, 7)) && /^\s*[✗⚠]/.test(l))).toEqual([])
    // The custom collection is the instance's now: its records' file, its level for contact, listed.
    const listed = await call(w.app, '/api/registries')
    expect(listed.body.find((r: { name: string }) => r.name === 'circles')).toEqual({ name: 'circles', kind: 'collection', count: 0 })
  })

  it('a definition is refused in words for an id it cannot take, a bad field or a bad view; nothing is written', async () => {
    const w = await world()
    const before = commits(w.repo)
    for (const [body, field, message] of [
      [{ id: 'projects' }, 'id', 'That id cannot be used for a new collection. Choose another.'],
      [{ id: 'circles' }, 'id', 'That id cannot be used for a new collection. Choose another.'],
      [{ id: 'tree-x' }, 'id', 'tree-x cannot name a collection: an id beginning with tree- names a tree of pages.'],
      [{ id: 'teams', fields: [{ id: 'due', type: 'when' }] }, 'fields.0.type',
        '"when" is not a field type: text, longtext, number, select, multiselect, date, daterange, checkbox, url, person, relation, page, email or phone'],
      [{ id: 'teams', views: [{ id: 'all', kind: 'table' }] }, 'views.0.name', 'a saved view has a name'],
      [{ id: 'teams', visibility: 'public' }, 'visibility',
        'A collection is defined at members, and made public with its visibility control. Nothing was written.'],
    ] as const) {
      const res = await call(w.app, '/api/collections', json('POST', body))
      expect(res.status, JSON.stringify(body)).toBe(422)
      expect(res.body).toEqual({ errors: [{ record: `collections:${body.id}`, field, message }] })
    }
    expect(commits(w.repo)).toBe(before)
  })

  it('removing a collection that holds records answers "Move or delete its 3 records first. Nothing was written."', async () => {
    const records = 'circles:\n  - { id: c-1, name: One }\n  - { id: c-2, name: Two }\n  - { id: c-3, name: Three }\n'
    const w = await world({ files: { 'data/collections/circles.yaml': records } })
    const before = commits(w.repo)
    const res = await call(w.app, '/api/collections/circles', { method: 'DELETE' })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'Move or delete its 3 records first. Nothing was written.', code: 'HOLDS_RECORDS' })
    expect(commits(w.repo)).toBe(before)
    expect(fileAt(w.repo, 'data/collections.yaml')).toBe(COLLECTIONS)
    // The same file edited whole by the source editor is refused the same way (registerFileCheck).
    const staged = await call(w.app, '/api/changes/ops', json('POST', { ops: [{ op: 'file', path: 'data/collections.yaml', text: 'collections: []\n' }] }))
    expect(staged.status).toBe(422)
    expect(staged.body.errors).toEqual([{ record: 'data/collections.yaml', field: 'collections.circles', message: 'Move or delete its 3 records first. Nothing was written.' }])
    // An empty collection goes, in one workspace commit, and its comment-free entry with it.
    const empty = await world({ files: { 'data/collections/circles.yaml': 'circles: []\n' } })
    const gone = await call(empty.app, '/api/collections/circles', { method: 'DELETE' })
    expect(gone.status).toBe(200)
    expect(readCollections(fileAt(empty.repo, 'data/collections.yaml')).collections.map(c => c.id)).toEqual(['tasks'])
    expect(fileAt(empty.repo, 'data/collections.yaml')).toContain('# The org\'s collections. Edited by the Hub and by hand.')
  })

  it('a saved view round-trips through data/collections.yaml, comments kept', async () => {
    const w = await world()
    const view = { name: 'Open', kind: 'table', filters: [{ field: 'status', op: 'is-not', value: 'done' }], sort: { field: 'due', dir: 'asc' }, columns: ['title', 'owner', 'due'] }
    const res = await call(w.app, '/api/collections/tasks/views/open', json('PUT', view))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 'tasks', view: 'open', commit: expect.stringMatching(/^[0-9a-f]{40}$/) })
    const text = fileAt(w.repo, 'data/collections.yaml')!
    for (const comment of ['# The org\'s collections. Edited by the Hub and by hand.', '# Circles: who leads what.', '# a built-in: its saved views only']) {
      expect(text).toContain(comment)
    }
    const got = await call(w.app, '/api/collections')
    const tasks = got.body.collections.find((c: { id: string }) => c.id === 'tasks')
    expect(tasks.views).toEqual([
      { id: 'mine', name: 'Mine', kind: 'list', filters: [{ field: 'owner', op: 'is', value: 'steward-a' }] },
      { id: 'open', ...view },
    ])
    expect(tasks).toMatchObject({ builtin: true, visibility: 'members' })
    // Changed again: the view is replaced where it is, the other untouched.
    await call(w.app, '/api/collections/tasks/views/mine', json('PUT', { name: 'Mine', kind: 'board', filters: [], board: { field: 'status', order: ['todo', 'doing', 'done'] } }))
    const again = (await call(w.app, '/api/collections')).body.collections.find((c: { id: string }) => c.id === 'tasks')
    expect(again.views.map((v: { id: string; kind: string }) => [v.id, v.kind])).toEqual([['mine', 'board'], ['open', 'table']])
    expect(fileAt(w.repo, 'data/collections.yaml')).toContain('# Circles: who leads what.')
    expect(git(w.repo, 'log -1 --format=%B')).toContain('Org-Rule: workspace/direct')
    // A view of a collection the instance has not defined yet: its entry is made for it.
    await call(w.app, '/api/collections/projects/views/active', json('PUT', { name: 'Active', kind: 'table', filters: [{ field: 'status', op: 'is', value: 'active' }] }))
    expect(readCollections(fileAt(w.repo, 'data/collections.yaml')).collections.find(c => c.id === 'projects')?.views?.map(v => v.id)).toEqual(['active'])
    // A view with no such collection is 404, and a bad one 422; nothing is written.
    const head = commits(w.repo)
    expect((await call(w.app, '/api/collections/nowhere/views/v', json('PUT', { name: 'V', kind: 'table', filters: [] }))).status).toBe(404)
    expect((await call(w.app, '/api/collections/tasks/views/v', json('PUT', { name: 'V', kind: 'grid', filters: [] }))).status).toBe(422)
    expect(commits(w.repo)).toBe(head)
  })

  it('PUT changes a definition in place; a built-in takes its name, views and notes_parent only', async () => {
    const w = await world()
    const res = await call(w.app, '/api/collections/circles', json('PUT', { name: 'Circles and guilds', fields: [{ id: 'name', type: 'text' }, { id: 'phone', type: 'phone' }] }))
    expect(res.status).toBe(200)
    const circles = readCollections(fileAt(w.repo, 'data/collections.yaml')).collections.find(c => c.id === 'circles')
    expect(circles).toEqual({ id: 'circles', name: 'Circles and guilds', fields: [{ id: 'name', type: 'text' }, { id: 'phone', type: 'phone' }] })
    // A new contact field narrows, in the same commit.
    expect(git(w.repo, 'show --name-only --format= HEAD').trim().split('\n').sort()).toEqual(['data/collections.yaml', 'data/visibility.yaml'])
    expect(fileAt(w.repo, 'data/visibility.yaml')).toContain(`phone: "hat:${OPS}"`)
    const builtin = await call(w.app, '/api/collections/meetings', json('PUT', { notes_parent: 'p-000000000001', fields: [{ id: 'x', type: 'text' }] }))
    expect(builtin.status).toBe(422)
    expect(builtin.body.errors[0].message).toBe('meetings is a built-in collection: its fields are its schema\'s, so only its name, saved views and notes_parent are kept here')
    expect((await call(w.app, '/api/collections/meetings', json('PUT', { notes_parent: 'p-000000000001' }))).status).toBe(200)
    expect(readCollections(fileAt(w.repo, 'data/collections.yaml')).collections.find(c => c.id === 'meetings')).toEqual({ id: 'meetings', notes_parent: 'p-000000000001' })
  })

  it('a raised workspace:collections write stages a file op on data/collections.yaml (preflight row 18)', async () => {
    const w = await world({ governance: RAISED })
    const before = commits(w.repo)
    const res = await call(w.app, '/api/collections', json('POST', { id: 'teams', name: 'Teams' }))
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 'teams', staged: true })
    expect(commits(w.repo)).toBe(before)
    const change = await call(w.app, '/api/changes')
    expect(change.body.ops).toEqual([expect.objectContaining({ op: 'file', path: 'data/collections.yaml' })])
    expect(change.body.ops[0].text).toContain('id: teams')
    expect(change.body.rule).toMatchObject({ direct: false, proposable: true })
  })

  it('the public is refused every collection route (publicReads)', async () => {
    const w = await world()
    const hosted = createApp(w.repo, undefined, { request: withRequest({ repo: w.repo, hosted: true, membership: null, store: w.store, now: () => NOW }), privateStore: () => w.store })
    for (const [path, init] of [['/api/collections', undefined], ['/api/view-state/tasks', undefined], ['/api/collections', json('POST', { id: 'teams' })]] as const) {
      expect((await hosted.request(path, init)).status, path).toBe(401)
    }
  })
})

// The final review's M-1 (PF-R116): a saved view of a git collection is written to data/collections.yaml, which every
// member reads, so it may not filter, sort, group, board or date by a field the policy keeps above members, nor by a
// contact field: its values (a filter's) or the field's use would be in git. Refused 422, nothing written.
describe('a saved view in git names no restricted field (final review M-1)', () => {
  const POLICY = `visibility:
  defaults: { contact: "hat:${OPS}" }
  collections:
    projects: { default: members }
    tasks: { fields: { budget: "hat:${OPS}" } }
`
  const CIRCLES = `collections:
  - id: circles
    name: Circles
    fields:
      - { id: name, type: text }
      - { id: mail, type: email }
`
  const refusedAt = (field: string, at: string) => ({ record: 'collections:tasks', field: `views.v.${at}`, message: VIEW_RESTRICTED(field) })

  it('a filter, sort, group, board or date by a restricted field is refused 422; nothing is written', async () => {
    const w = await world({ collections: CIRCLES, files: { 'data/visibility.yaml': POLICY } })
    const head = commits(w.repo)
    const before = fileAt(w.repo, 'data/collections.yaml')
    const cases: [Record<string, unknown>, string][] = [
      [{ kind: 'table', filters: [{ field: 'budget', op: 'is', value: '5000' }] }, 'filters.0.field'],
      [{ kind: 'table', filters: [], sort: { field: 'budget', dir: 'asc' } }, 'sort.field'],
      [{ kind: 'table', filters: [], group: 'budget' }, 'group'],
      [{ kind: 'board', filters: [], board: { field: 'budget', order: ['5000'] } }, 'board.field'],
      [{ kind: 'calendar', filters: [], date: 'budget' }, 'date'],
    ]
    for (const [view, at] of cases) {
      const res = await call(w.app, '/api/collections/tasks/views/v', json('PUT', { name: 'V', ...view }))
      expect([res.status, res.body.errors], at).toEqual([422, [refusedAt('budget', at)]])
    }
    // A contact field: a registry's (members' email) and a custom collection's email field.
    const member = await call(w.app, '/api/collections/members/views/v', json('PUT', { name: 'V', kind: 'table', filters: [{ field: 'email', op: 'is', value: 'a@b' }] }))
    expect([member.status, member.body.errors]).toEqual([422, [{ record: 'collections:members', field: 'views.v.filters.0.field', message: VIEW_RESTRICTED('email') }]])
    const circle = await call(w.app, '/api/collections/circles/views/v', json('PUT', { name: 'V', kind: 'table', filters: [], sort: { field: 'mail', dir: 'asc' } }))
    expect([circle.status, circle.body.errors]).toEqual([422, [{ record: 'collections:circles', field: 'views.v.sort.field', message: VIEW_RESTRICTED('mail') }]])
    // The definition's own route holds the same: views written with a definition are judged as a saved view is.
    const def = await call(w.app, '/api/collections/circles', json('PUT', { name: 'Circles', fields: [{ id: 'name', type: 'text' }, { id: 'mail', type: 'email' }],
      views: [{ id: 'v', name: 'V', kind: 'table', filters: [{ field: 'mail', op: 'is', value: 'a@b' }] }] }))
    expect(def.status).toBe(422)
    expect(def.body.errors.map((e: { message: string }) => e.message)).toContain(VIEW_RESTRICTED('mail'))
    expect(commits(w.repo)).toBe(head)
    expect(fileAt(w.repo, 'data/collections.yaml')).toBe(before)
    // A view by a members field saves; its columns may list a restricted field (a column holds no value in git).
    const ok = await call(w.app, '/api/collections/tasks/views/v', json('PUT', { name: 'V', kind: 'table', filters: [{ field: 'status', op: 'is', value: 'todo' }], columns: ['title', 'budget'] }))
    expect(ok.status).toBe(200)
    // The definitions file's own check holds it too, whatever edits the file (a hand edit staged as a file op).
    const text = CIRCLES + "    views:\n      - { id: x, name: X, kind: table, filters: [{ field: mail, op: is, value: a@b }] }\n"
    expect(collectionsFileErrors(w.repo, { op: 'file', path: 'data/collections.yaml', text, base: null }))
      .toEqual([{ record: 'data/collections.yaml', field: 'collections.circles.views.x.filters.0.field', message: VIEW_RESTRICTED('mail') }])
  })
})

describe('private collections (L6 §7.3, R-L5-14.3, ruling R-1a)', () => {
  it('a private collection\'s definition goes to the store and data/collections.yaml never names it', async () => {
    const w = await world()
    const before = commits(w.repo)
    const res = await call(w.app, '/api/collections', json('POST', {
      id: 'council-notes', name: 'Council notes', visibility: `hat:${OPS}`, fields: [{ id: 'title', type: 'text' }],
      views: [{ id: 'all', name: 'All', kind: 'list', filters: [] }],
    }))
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 'council-notes', visibility: `hat:${OPS}` })
    expect(commits(w.repo)).toBe(before)
    expect(w.store.collections()).toEqual([{ id: 'council-notes', visibility: `hat:${OPS}`,
      definition: { name: 'Council notes', fields: [{ id: 'title', type: 'text' }], views: [{ id: 'all', name: 'All', kind: 'list', filters: [] }] } }])
    expect(fileAt(w.repo, 'data/collections.yaml')).not.toContain('council-notes')
    expect(git(w.repo, 'log -p --all')).not.toContain('council-notes')
    expect(git(w.repo, 'status --porcelain --untracked-files=all')).toBe('')
    // Listed to a member admitted to Ops, with its level; absent for one who is not.
    const listed = (await call(w.app, '/api/collections')).body.collections
    expect(listed.find((c: { id: string }) => c.id === 'council-notes')).toEqual({
      id: 'council-notes', name: 'Council notes', fields: [{ id: 'title', type: 'text' }], views: [{ id: 'all', name: 'All', kind: 'list', filters: [] }],
      visibility: `hat:${OPS}`, builtin: false,
    })
    // A saved view of it goes to the store too.
    const view = await call(w.app, '/api/collections/council-notes/views/open', json('PUT', { name: 'Open', kind: 'table', filters: [] }))
    expect(view.status).toBe(200)
    expect((w.store.collections()[0]!.definition as { views: { id: string }[] }).views.map(v => v.id)).toEqual(['all', 'open'])
    expect(commits(w.repo)).toBe(before)
    asStewardC(w.repo)
    const other = await call(w.app, '/api/collections')
    expect(other.text).not.toContain('council-notes')
    expect((await call(w.app, '/api/collections/council-notes/views/x', json('PUT', { name: 'X', kind: 'table', filters: [] }))).status).toBe(404)
    expect((await call(w.app, '/api/view-state/council-notes')).body).toEqual({ error: 'There is no collection council-notes.', code: 'NO_COLLECTION' })
  })

  // Walk M15: /all/<registry> named "data/<registry>.yaml" for a collection the store keeps, and for a custom collection
  // whose file is data/collections/<id>.yaml. The registry's answer says where it is read from when that is not it.
  it('the registry\'s answer names the file it is read from: none for a private collection, data/collections/<id>.yaml for a custom one', async () => {
    const w = await world()
    expect((await call(w.app, '/api/collections', json('POST', {
      id: 'council-notes', name: 'Council notes', visibility: `hat:${OPS}`, fields: [{ id: 'title', type: 'text' }], views: [],
    }))).status).toBe(201)
    const kept = await call(w.app, '/api/registries/council-notes')
    expect(kept.body).toMatchObject({ name: 'council-notes', kind: 'collection', file: null })
    const custom = await call(w.app, '/api/registries/circles')
    expect(custom.body).toMatchObject({ name: 'circles', kind: 'collection', file: 'data/collections/circles.yaml' })
    expect(Object.hasOwn((await call(w.app, '/api/registries/projects')).body, 'file')).toBe(false)
  })

  it('a member defines a private collection only at a level they are admitted to; the store down refuses in L5\'s words', async () => {
    const w = await world()
    const council = await call(w.app, '/api/collections', json('POST', { id: 'council-notes', visibility: `hat:${COUNCIL}` }))
    expect(council.status).toBe(403)
    expect(council.body.error).toBe(`council-notes would be kept at hat:${COUNCIL}, which you are not admitted to, so you cannot write it here.`)
    const down = w.appWith(() => { throw new StoreUnavailable('The private store is down for this test.') })
    const refused = await call(down, '/api/collections', json('POST', { id: 'council-notes', visibility: `hat:${OPS}` }))
    expect(refused.status).toBe(503)
    expect(refused.body).toEqual({ error: 'The private store is down for this test.', code: 'PRIVATE_STORE' })
    expect(w.store.collections()).toEqual([])
    // A git definition is written with the store down: git pages and collections keep working.
    expect((await call(down, '/api/collections', json('POST', { id: 'teams' }))).status).toBe(201)
  })

  it('removing a private collection that holds records is refused; an empty one is removed from the store', async () => {
    const w = await world()
    await w.store.putCollection({ id: 'council-notes', visibility: `hat:${OPS}`, definition: { name: 'Council notes' } }, 'steward-a')
    await w.store.putRecord({ collection: 'council-notes', id: 'n-1', visibility: `hat:${OPS}`, body: { title: 'one' }, rev: 'r1' }, 'steward-a', null)
    const held = await call(w.app, '/api/collections/council-notes', { method: 'DELETE' })
    expect(held.status).toBe(409)
    expect(held.body.error).toBe('Move or delete its 1 record first. Nothing was written.')
    await w.store.deleteRecord('council-notes', 'n-1', 'steward-a', null)
    expect((await call(w.app, '/api/collections/council-notes', { method: 'DELETE' })).status).toBe(200)
    expect(w.store.collections()).toEqual([])
  })
})

describe('view state (L6 §7.3, §16)', () => {
  it('view state is per member and never in git', async () => {
    const w = await world()
    const state = { view: 'open', filters: [{ field: 'status', op: 'is', value: 'sentinel-view-state' }], collapsed: ['done'] }
    expect((await call(w.app, '/api/view-state/tasks')).body).toEqual({ collection: 'tasks', state: null })
    const put = await call(w.app, '/api/view-state/tasks', json('PUT', { state }))
    expect(put.status).toBe(200)
    expect(put.body).toEqual({ collection: 'tasks', state })
    expect((await call(w.app, '/api/view-state/tasks')).body).toEqual({ collection: 'tasks', state })
    expect(w.store.viewState('steward-a', 'tasks')).toEqual(state)
    // steward-c's is their own.
    asStewardC(w.repo)
    expect((await call(w.app, '/api/view-state/tasks')).body).toEqual({ collection: 'tasks', state: null })
    await call(w.app, '/api/view-state/tasks', json('PUT', { state: { view: 'mine' } }))
    expect(w.store.viewState('steward-c', 'tasks')).toEqual({ view: 'mine' })
    expect(w.store.viewState('steward-a', 'tasks')).toEqual(state)
    expect(git(w.repo, 'status --porcelain --untracked-files=all')).toBe('')
    expect(git(w.repo, 'log -p --all')).not.toContain('sentinel-view-state')
    // A custom collection has view state too; a name that is no collection is 404; a body without state is 400.
    expect((await call(w.app, '/api/view-state/circles')).status).toBe(200)
    expect(await call(w.app, '/api/view-state/nowhere')).toEqual({ status: 404, text: expect.any(String), body: { error: 'There is no collection nowhere.', code: 'NO_COLLECTION' } })
    expect((await call(w.app, '/api/view-state/tasks', json('PUT', { view: 'x' }))).status).toBe(400)
    // The store down: refused in L5's words.
    const down = w.appWith(() => { throw new StoreUnavailable('The private store is down for this test.') })
    expect(await call(down, '/api/view-state/tasks')).toMatchObject({ status: 503, body: { error: 'The private store is down for this test.', code: 'PRIVATE_STORE' } })
  })
})

describe('custom collections\' records (ruling R-2b)', () => {
  const PROJECT = 'proj-001'

  it('a record of a custom collection is staged, checked against its derived schema and references, and applied to its own file', async () => {
    const w = await world()
    const bad = await call(w.app, '/api/changes/ops', json('POST', { ops: [{ op: 'create', record: 'circles:c-1', value: { name: 'One', started: 'next tuesday' } }] }))
    expect(bad.status).toBe(422)
    expect(bad.body.errors).toEqual([{ record: 'circles:c-1', field: 'started', message: 'must match format "date"' }])
    const dangling = await call(w.app, '/api/changes/ops', json('POST', { ops: [{ op: 'create', record: 'circles:c-1', value: { name: 'One', projects: ['nope'] } }] }))
    expect(dangling.status).toBe(422)
    expect(dangling.body.errors).toEqual([{ record: 'circles:c-1', field: 'projects', message: 'no project with id "nope" in projects' }])
    const good = await call(w.app, '/api/changes/ops', json('POST', { ops: [{ op: 'create', record: 'circles:c-1', value: { name: 'One', started: '2026-10-30', projects: [PROJECT] } }] }))
    expect(good.status, good.text).toBe(200)
    const applied = await call(w.app, '/api/changes/apply', json('POST', {}))
    expect(applied.status, applied.text).toBe(200)
    expect(fileAt(w.repo, 'data/collections/circles.yaml')).toContain('id: c-1')
    expect(git(w.repo, 'log -1 --format=%B')).toContain('Org-Rule: workspace/direct')
    expect(git(w.repo, 'log -1 --format=%s').trim()).toBe('admin(circles): create c-1')
    // Read back through the gate; a project it names cannot be deleted while it does.
    const read = await call(w.app, '/api/registries/circles')
    expect(read.body.entries).toEqual([{ id: 'c-1', name: 'One', started: '2026-10-30', projects: [PROJECT], visibility: 'members' }])
    const gone = await call(w.app, '/api/changes/ops', json('POST', { ops: [{ op: 'delete', record: `projects:${PROJECT}` }] }))
    expect(gone.status).toBe(422)
    expect(gone.body.errors[0].message).toContain('circles "c-1" (projects)')
    // A second op on the same record folds into one (the merge engine reads the instance's list).
    await call(w.app, '/api/changes', { method: 'DELETE' })
    await call(w.app, '/api/changes/ops', json('POST', { ops: [{ op: 'update', record: 'circles:c-1', set: { status: 'active' } }] }))
    const twice = await call(w.app, '/api/changes/ops', json('POST', { ops: [{ op: 'update', record: 'circles:c-1', set: { name: 'Uno' } }] }))
    expect(twice.status, twice.text).toBe(200)
    expect(twice.body.ops).toEqual([expect.objectContaining({ op: 'update', record: 'circles:c-1', set: { status: 'active', name: 'Uno' } })])
  })

  it('a restricted value in a collection file is refused 422; a restricted field of a custom record goes to the store', async () => {
    const restricted = `${VISIBILITY}    circles: { default: members, fields: { contact: "hat:${OPS}" } }\n`
    const w = await world({ files: { 'data/visibility.yaml': restricted } })
    const text = 'circles:\n  - { id: c-1, name: One, contact: sentinel-contact@example.invalid }\n'
    const res = await call(w.app, '/api/changes/ops', json('POST', { ops: [{ op: 'file', path: 'data/collections/circles.yaml', text }] }))
    expect(res.status).toBe(422)
    expect(res.body.errors).toEqual([{ record: 'data/collections/circles.yaml', field: 'contact',
      message: `Not staged: data/collections/circles.yaml would hold the contact of c-1, which data/visibility.yaml restricts to hat:${OPS}; it belongs in the private store, and git holds nothing stricter than members. Nothing was staged.` }])
    expect(res.text).not.toContain('sentinel-contact')
    // A record op splits as a registry's does: the field to the store, the rest to git.
    const staged = await call(w.app, '/api/changes/ops', json('POST', { ops: [{ op: 'create', record: 'circles:c-1', value: { name: 'One', contact: 'sentinel-contact@example.invalid' } }] }))
    expect(staged.status, staged.text).toBe(200)
    expect((await call(w.app, '/api/changes/apply', json('POST', {}))).status).toBe(200)
    expect(fileAt(w.repo, 'data/collections/circles.yaml')).not.toContain('sentinel-contact')
    expect(w.store.fields('circles', 'c-1')).toEqual([{ registry: 'circles', record: 'c-1', field: 'contact', visibility: `hat:${OPS}`, value: 'sentinel-contact@example.invalid' }])
  })
})

describe('validate:data and custom collections (lib/data-validate.mjs)', () => {
  it('a task\'s project and meeting are references (preflight carry, Task 2)', () => {
    const idsOf = (target: string) => (target === 'projects' ? new Set(['proj-001']) : target === 'meetings' ? new Set(['m-1']) : null)
    expect(referenceErrors('tasks', { id: 't-1', project: 'proj-001', meeting: 'm-1' }, idsOf)).toEqual([])
    expect(referenceErrors('tasks', { id: 't-1', project: 'nope', meeting: 'none' }, idsOf)).toEqual([
      { field: 'project', message: 'no project with id "nope" in projects' },
      { field: 'meeting', message: 'no meeting with id "none" in meetings' },
    ])
  })
  it('validateRepo reads data/collections.yaml and each custom collection\'s records against their derived schema', async () => {
    const w = await world({ files: {
      'data/collections/circles.yaml': 'circles:\n  - { id: c-1, started: next tuesday, projects: [nope] }\n',
      'data/visibility.yaml': `${VISIBILITY}    circles: { default: members, fields: { name: "hat:${OPS}" } }\n`,
    } })
    const problems = validateRepo(w.repo).filter(p => p.file.startsWith('data/collections'))
    expect(problems).toEqual([
      { file: 'data/collections/circles.yaml', id: 'c-1', path: 'started', message: 'must match format "date"', level: 'error' },
      { file: 'data/collections/circles.yaml', id: 'c-1', path: 'projects', message: 'no project with id "nope" in projects', level: 'warn' },
    ])
    writeFileSync(join(w.repo, 'data', 'collections.yaml'), 'collections:\n  - id: tree-x\n')
    expect(validateRepo(w.repo).filter(p => p.file === 'data/collections.yaml')).toEqual([
      { file: 'data/collections.yaml', path: 'collections.tree-x', message: 'tree-x cannot name a collection: an id beginning with tree- names a tree of pages.', level: 'error' },
    ])
    // A restricted value of a custom collection in git is rule 4's error, as a registry's is.
    writeFileSync(join(w.repo, 'data', 'collections.yaml'), COLLECTIONS)
    writeFileSync(join(w.repo, 'data', 'collections', 'circles.yaml'), 'circles:\n  - { id: c-1, name: sentinel-name }\n')
    expect(validateRepo(w.repo).filter(p => p.file === 'data/collections/circles.yaml')).toEqual([
      { file: 'data/collections/circles.yaml', id: 'c-1', path: 'name', level: 'error',
        message: `the field name is restricted to hat:${OPS} by data/visibility.yaml, so its value is stricter than members: it belongs in the private store` },
    ])
  })
})

describe('rule 7 at removal and at a taken id (Task 3 fix round 1)', () => {
  const HIDDEN = 'This collection still holds records. Move or delete them before removing it. Nothing was changed.'

  it('a removal never counts records the viewer may not read: a numberless sentence when any remain', async () => {
    // circles holds one git record (every member reads it) and one the store keeps at Council, which steward-a (Ops) may not read.
    const w = await world({ files: { 'data/collections/circles.yaml': 'circles:\n  - { id: c-1, name: One }\n' } })
    await w.store.putRecord({ collection: 'circles', id: 'c-2', visibility: `hat:${COUNCIL}`, body: { name: 'sentinel-hidden' }, rev: 'r1' }, 'steward-b', null)
    const mixed = await call(w.app, '/api/collections/circles', { method: 'DELETE' })
    expect(mixed.status).toBe(409)
    expect(mixed.body).toEqual({ error: HIDDEN, code: 'HOLDS_RECORDS' })
    expect(mixed.text).not.toMatch(/\d+ record/)
    // The hidden record alone: still no number.
    await call(w.app, '/api/changes/ops', json('POST', { ops: [{ op: 'delete', record: 'circles:c-1' }] }))
    expect((await call(w.app, '/api/changes/apply', json('POST', {}))).status).toBe(200)
    expect((await call(w.app, '/api/collections/circles', { method: 'DELETE' })).body).toEqual({ error: HIDDEN, code: 'HOLDS_RECORDS' })
    // Every remaining record visible: counted, as §7.4 says.
    await w.store.deleteRecord('circles', 'c-2', 'steward-b', null)
    await w.store.putRecord({ collection: 'circles', id: 'c-3', visibility: `hat:${OPS}`, body: { name: 'three' }, rev: 'r1' }, 'steward-a', null)
    expect((await call(w.app, '/api/collections/circles', { method: 'DELETE' })).body).toEqual({ error: 'Move or delete its 1 record first. Nothing was written.', code: 'HOLDS_RECORDS' })
  })

  it('a private collection the viewer reads, holding a record at a level they are not admitted to, is refused with no number', async () => {
    const w = await world()
    await w.store.putCollection({ id: 'council-notes', visibility: `hat:${OPS}`, definition: { name: 'Notes' } }, 'steward-a')
    await w.store.putRecord({ collection: 'council-notes', id: 'n-1', visibility: `hat:${OPS}`, body: { title: 'seen' }, rev: 'r1' }, 'steward-a', null)
    await w.store.putRecord({ collection: 'council-notes', id: 'n-2', visibility: `hat:${COUNCIL}`, body: { title: 'unseen' }, rev: 'r1' }, 'steward-b', null)
    const res = await call(w.app, '/api/collections/council-notes', { method: 'DELETE' })
    expect(res).toMatchObject({ status: 409, body: { error: HIDDEN, code: 'HOLDS_RECORDS' } })
    expect(w.store.collections().map(c => c.id)).toEqual(['council-notes'])
  })

  it('an id taken by a collection the viewer may not read is refused exactly as one they can read', async () => {
    const w = await world()
    await w.store.putCollection({ id: 'council-only', visibility: `hat:${COUNCIL}`, definition: { name: 'Hidden' } }, 'steward-b')
    const hidden = await call(w.app, '/api/collections', json('POST', { id: 'council-only' }))
    const visible = await call(w.app, '/api/collections', json('POST', { id: 'circles' }))
    expect(hidden.status).toBe(422)
    expect(hidden.body).toEqual({ errors: [{ record: 'collections:council-only', field: 'id', message: 'That id cannot be used for a new collection. Choose another.' }] })
    expect(hidden.body.errors[0].message).toBe(visible.body.errors[0].message)
    expect(hidden.status).toBe(visible.status)
    expect(w.store.collections().map(c => c.id)).toEqual(['council-only'])
    expect(fileAt(w.repo, 'data/collections.yaml')).not.toContain('council-only')
  })
})
