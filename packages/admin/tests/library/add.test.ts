import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeSyntheticRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { readRegistry } from '../../server/registry.ts'
import { validateRepo } from '../../lib/data-validate.mjs'

// Add (DAO-OS L1): an entry's records and its receipt, staged as one change in the actor's tray. Every test builds a
// throwaway repository under the temp directory (makeSyntheticRepo) that registers the invented test shelf.
const SHELF = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'test-shelf')
const federation = (path: string) => `identity:\n  name: Test org\n  slug: test-org\nlibrary:\n  shelves:\n    - { path: ${path} }\n`

let repo: string
let app: Hono
beforeEach(() => {
  repo = makeSyntheticRepo()
  writeFileSync(join(repo, 'federation.yaml'), federation(SHELF))
  git(repo, 'add federation.yaml')
  git(repo, 'commit -qm "fixture: the test shelf"')
  app = createApp(repo)
})
afterEach(() => removeFixtureRepo(repo))

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const add = (id: string, body: unknown = {}) => app.request(`/api/library/${encodeURIComponent(id)}/add`, json('POST', body))
const view = async () => (await app.request('/api/changes')).json()
const records = (ops: { record: string }[]) => ops.map(o => o.record)
const apply = () => app.request('/api/changes/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
const commitAndWrite = (file: string, text: string) => {
  writeFileSync(join(repo, file), text)
  git(repo, `add ${file}`)
  git(repo, `commit -qm "fixture: ${file}"`)
}

const UNSEALED = { by: null, at: null, decision: null, removed: null }

describe('POST /api/library/:id/add', () => {
  it('stages the entry\'s records, then its receipt, and writes nothing to the repository', async () => {
    const head = git(repo, 'rev-parse HEAD'); const status = git(repo, 'status --porcelain')
    const res = await add('board:test-desk')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(records(body.ops)).toEqual(['boards:test-desk', 'library:board-test-desk'])
    expect(body.ops[0]).toMatchObject({ op: 'create', record: 'boards:test-desk', value: { id: 'test-desk', name: 'Test desk', layout: 'flow' } })
    expect(body.ops[1]).toMatchObject({ op: 'create', record: 'library:board-test-desk' })
    expect(body.ops[1].value).toEqual({
      id: 'board-test-desk', entry: 'board:test-desk', version: '1.0.0', shelf: 'test-shelf',
      created: [{ record: 'boards:test-desk', base: null }], status: 'installed', ...UNSEALED,
    })
    expect(Object.keys(body.ops[1].value)).toEqual(['id', 'entry', 'version', 'shelf', 'created', 'status', 'by', 'at', 'decision', 'removed'])
    expect(body.classes).toEqual(['records'])
    expect(records((await view()).ops)).toEqual(['boards:test-desk', 'library:board-test-desk'])
    expect(git(repo, 'rev-parse HEAD')).toBe(head)
    expect(git(repo, 'status --porcelain')).toBe(status)
  })

  it('applies as one commit that touches the board and the receipt, sealed, and the tree validates', async () => {
    expect((await add('board:test-desk')).status).toBe(200)
    const head = git(repo, 'rev-parse HEAD').trim()
    const res = await apply()
    expect(res.status).toBe(200)
    expect(git(repo, `rev-list --count ${head}..HEAD`).trim()).toBe('1')
    expect(git(repo, 'show --name-only --format= HEAD').trim().split('\n').sort()).toEqual(['data/boards.yaml', 'data/library.yaml'])
    const [receipt] = readRegistry(repo, 'library').entries ?? []
    expect(receipt).toMatchObject({ id: 'board-test-desk', entry: 'board:test-desk', status: 'installed', by: 'bruno', removed: null })
    expect(String(receipt!.at)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((receipt!.created as { base: string }[])[0]!.base).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt!.decision).toMatchObject({ rule: expect.any(String), change: expect.stringMatching(/^chg_/) })
    expect(validateRepo(repo).filter(p => p.level === 'error')).toEqual([])
  })

  it('takes config: a system with its name and url, and a second one under another id gets the next receipt id', async () => {
    let res = await add('system:test-link', { config: { name: 'Desk', url: 'https://example.org/desk' } })
    expect(res.status).toBe(200)
    let body = await res.json()
    expect(records(body.ops)).toEqual(['systems:test-link', 'library:system-test-link'])
    expect(body.ops[0].value).toEqual({ id: 'test-link', kind: 'link', driver: 'link', name: 'Desk', url: 'https://example.org/desk' })
    expect(body.classes).toEqual(['systems'])
    expect((await apply()).status).toBe(200)

    res = await add('system:test-link', { config: { id: 'test-link-2', name: 'Desk two', url: 'https://example.org/two' } })
    expect(res.status).toBe(200)
    body = await res.json()
    expect(records(body.ops)).toEqual(['systems:test-link-2', 'library:system-test-link-2'])
    expect(body.ops[1].value).toMatchObject({ id: 'system-test-link-2', entry: 'system:test-link', created: [{ record: 'systems:test-link-2', base: null }] })
  })

  it('takes a receipt id the actor\'s own change already holds as taken', async () => {
    expect((await add('system:test-link', { config: { name: 'Desk', url: 'https://example.org/desk' } })).status).toBe(200)
    const res = await add('system:test-link', { config: { id: 'test-link-2', name: 'Desk two', url: 'https://example.org/two' } })
    expect(res.status).toBe(200)
    expect(records((await res.json()).ops)).toEqual(['systems:test-link', 'library:system-test-link', 'systems:test-link-2', 'library:system-test-link-2'])
  })
})

describe('what an add refuses, staging nothing', () => {
  const refused = async (res: Response, status: number) => {
    expect(res.status).toBe(status)
    const body = await res.json()
    expect((await view()).ops).toEqual([])
    return body
  }

  it('a raw entry', async () => {
    expect(await refused(await add('board:onboarding'), 409))
      .toEqual({ code: 'NOT_ADDABLE', error: 'This entry is raw: the library shows it and does not add it.' })
  })
  it('a built-in board', async () => {
    expect(await refused(await add('board:home'), 409)).toEqual({ code: 'NOT_ADDABLE', error: 'Built in: every instance has this board.' })
  })
  it('a rule set', async () => {
    expect(await refused(await add('rules:consent-7d'), 409))
      .toEqual({ code: 'NOT_ADDABLE', error: 'Adding a rule set is not available yet: the change engine cannot edit data/governance.yaml yet.' })
  })
  it('config that leaves out what the entry requires', async () => {
    expect(await refused(await add('system:test-link', { config: { name: 'Desk' } }), 422))
      .toEqual({ errors: [{ record: 'system:test-link', field: 'config.url', message: 'url is required.' }] })
  })
  it('an id the org already has, with the next free id', async () => {
    commitAndWrite('data/boards.yaml', 'schema_version: "1.0"\nboards:\n  - id: test-desk\n    name: Mine\n    layout: flow\n    blocks: []\n')
    expect(await refused(await add('board:test-desk'), 409)).toEqual({
      code: 'TAKEN', error: 'A board with the id `test-desk` already exists. Add it under another id.', nextFreeId: 'test-desk-2',
    })
  })
  it('a config id the org already has, with the next free id', async () => {
    commitAndWrite('data/systems.yaml', 'schema_version: "1.0"\nsystems:\n  - id: test-link\n    kind: link\n    name: Ours\n    url: https://example.org/ours\n')
    expect(await refused(await add('system:test-link', { config: { name: 'Desk', url: 'https://example.org/desk' } }), 409)).toEqual({
      code: 'TAKEN', error: 'A system with the id `test-link` already exists. Add it under another id.', nextFreeId: 'test-link-2',
    })
  })
  it('config the entry accepts but the record does not: the engine\'s own 422, on the record', async () => {
    const body = await refused(await add('system:test-link', { config: { name: 'Desk', url: 'not an address' } }), 422)
    expect(body.errors).toEqual([expect.objectContaining({ record: 'systems:test-link', field: 'url' })])
  })
  it('an unknown entry', async () => {
    expect(await refused(await add('board:nope'), 404)).toEqual({ error: 'No library entry "board:nope". GET /api/library lists the entries.' })
  })
  it('a body that is not an object, or config that is not one', async () => {
    for (const body of [[1], 'desk', { config: 'desk' }, { config: [1] }]) {
      const b = await refused(await add('board:test-desk', body), 400)
      expect(b.error).toMatch(/^The body must be/)
    }
  })
  it('an actor git cannot match: the 403 every write gives', async () => {
    git(repo, 'config user.email stranger@local')
    const res = await add('board:test-desk')
    const ops = await app.request('/api/changes/ops', json('POST', { ops: [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }] }))
    expect(ops.status).toBe(403)
    expect(await refused(res, 403)).toEqual(await ops.json())
  })
})

describe('Review Focus 4: a requirement met by the person\'s own staged change', () => {
  const COUNCIL = `id: board:test-council
shelf: board
title: Test council
summary: A one-note board that needs a link, here to prove a need met by the person's own change.
version: 1.0.0
source: test-shelf
standing: stated
as_of: 2026-10-29
tags:
  maturity: field-informed
requires: [system-kind:link]
installs:
  - op: create
    record: boards:test-council
    value:
      id: test-council
      name: Test council
      audience: members
      layout: flow
      blocks:
        - id: hello
          type: note
          title: Hello
          text: "A note on the test council."
`
  beforeEach(() => {
    const dir = join(repo, 'shelves', 'test-shelf')
    cpSync(SHELF, dir, { recursive: true })
    writeFileSync(join(dir, 'shelf.yaml'), 'name: test-shelf\ntitle: Test shelf\nentries: [board:test-desk, system:test-link, board:test-council]\n')
    mkdirSync(join(dir, 'board', 'test-council'), { recursive: true })
    writeFileSync(join(dir, 'board', 'test-council', 'entry.yaml'), COUNCIL)
    writeFileSync(join(repo, 'federation.yaml'), federation('shelves/test-shelf'))
    git(repo, 'add -A')
    git(repo, 'commit -qm "fixture: a copy of the test shelf with a council"')
  })

  it('met by nothing: refused, nothing staged', async () => {
    const res = await add('board:test-council')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'NOT_ADDABLE', error: 'It needs a system of kind link, which this organization does not have yet. Add it first.' })
    expect((await view()).ops).toEqual([])
  })

  it('met by the staged link: allowed, and both adds are one change with two receipts', async () => {
    expect((await add('system:test-link', { config: { name: 'Desk', url: 'https://example.org/desk' } })).status).toBe(200)
    const res = await add('board:test-council')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(records(body.ops)).toEqual(['systems:test-link', 'library:system-test-link', 'boards:test-council', 'library:board-test-council'])
    const change = await view()
    expect(change.id).toBe(body.id)
    expect(change.ops.filter((o: { record: string }) => o.record.startsWith('library:'))).toHaveLength(2)
  })
})

describe('the preview, through the actor\'s change', () => {
  const preview = async (id: string) => (await app.request(`/api/library/${encodeURIComponent(id)}/preview`)).json()

  it('reads what the actor has staged: a board staged is a taken id', async () => {
    expect((await preview('board:test-desk')).refusal).toBeNull()
    expect((await add('board:test-desk')).status).toBe(200)
    expect((await preview('board:test-desk')).cannotAdd).toBe('A board with the id `test-desk` already exists. Add it under another id.')
  })

  it('after the add is applied it says the id is taken, and writes nothing', async () => {
    expect((await add('board:test-desk')).status).toBe(200)
    expect((await apply()).status).toBe(200)
    const head = git(repo, 'rev-parse HEAD'); const status = git(repo, 'status --porcelain')
    const library = readFileSync(join(repo, 'data', 'library.yaml'), 'utf8')
    const p = await preview('board:test-desk')
    expect(p.refusal).toEqual({ sentence: 'A board with the id `test-desk` already exists. Add it under another id.', nextFreeId: 'test-desk-2' })
    expect(git(repo, 'rev-parse HEAD')).toBe(head)
    expect(git(repo, 'status --porcelain')).toBe(status)
    expect(readFileSync(join(repo, 'data', 'library.yaml'), 'utf8')).toBe(library)
    expect((await view()).ops).toEqual([])
  })
})
