import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import type { Hono } from 'hono'
import { parse } from 'yaml'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeSyntheticRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { readRegistry } from '../../server/registry.ts'
import { validateRepo } from '../../lib/data-validate.mjs'
import { loadLibrary } from '../../server/library/read.ts'
import { addOps } from '../../server/library/add.ts'

// Remove (DAO-OS L1): a receipt's records deleted and the receipt marked removed, staged as one change in the actor's
// tray. Every test builds a throwaway repository under the temp directory (makeSyntheticRepo) that registers the
// invented test shelf, and every add is staged and applied through the routes first.
const SHELF = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'test-shelf')
const FRAMEWORK = fileURLToPath(new URL('../../../../', import.meta.url))
const federation = (path: string) => `identity:\n  name: Test org\n  slug: test-org\nlibrary:\n  shelves:\n    - { path: ${path} }\n`

let repo: string
let app: Hono
const fresh = (governance?: string | null) => {
  repo = governance === undefined ? makeSyntheticRepo() : makeSyntheticRepo(governance)
  writeFileSync(join(repo, 'federation.yaml'), federation(SHELF))
  git(repo, 'add federation.yaml')
  git(repo, 'commit -qm "fixture: the test shelf"')
  app = createApp(repo)
}
afterEach(() => removeFixtureRepo(repo))

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const add = (id: string, body: unknown = {}) => app.request(`/api/library/${encodeURIComponent(id)}/add`, json('POST', body))
const remove = (id: string, body: unknown = {}) => app.request(`/api/library/receipts/${encodeURIComponent(id)}/remove`, json('POST', body))
const removal = async (id: string) => {
  const res = await app.request(`/api/library/receipts/${encodeURIComponent(id)}/removal`)
  expect(res.status).toBe(200)
  return res.json()
}
const stageOps = (ops: unknown[]) => app.request('/api/changes/ops', json('POST', { ops }))
const view = async () => (await app.request('/api/changes')).json()
const records = (ops: { record: string }[]) => ops.map(o => o.record)
const apply = () => app.request('/api/changes/apply', json('POST', {}))
const sha = () => git(repo, 'rev-parse HEAD').trim()
const receipt = (id: string) => (readRegistry(repo, 'library').entries ?? []).find(e => e.id === id)!
const errorsOf = () => validateRepo(repo).filter((p: { level: string }) => p.level === 'error')
const commitFile = (file: string, text: string) => {
  writeFileSync(join(repo, file), text)
  git(repo, `add ${file}`)
  git(repo, `commit -qm "fixture: ${file}"`)
}
async function ok(res: Response, status = 200): Promise<Record<string, any>> {
  const body = await res.json()
  expect(res.status, JSON.stringify(body)).toBe(status)
  return body
}
/** Add `id` through the route and apply it. */
async function added(id: string, body: unknown = {}) {
  await ok(await add(id, body))
  await ok(await apply())
}
const UNSEALED_REMOVED = { by: null, at: null, decision: null }
const DAY = /^\d{4}-\d{2}-\d{2}$/

describe('an untouched add', () => {
  beforeEach(() => fresh())

  it('previews every record as added, asks nothing, and says who decides', async () => {
    await added('board:test-desk')
    const p = await removal('board-test-desk')
    expect(p).toEqual({
      receipt: 'board-test-desk', entry: 'board:test-desk', title: 'Test desk',
      records: [{ record: 'boards:test-desk', state: 'as added', referrers: [] }],
      asks: [], decided: [{ class: 'records', direct: true, sentence: expect.any(String) }], refusal: null,
    })
  })

  it('removes in one commit: the board is gone, the receipt is removed and sealed, the tree validates, and the list no longer shows it added', async () => {
    await added('board:test-desk')
    const listed = async () => (await (await app.request('/api/library')).json()).entries.find((e: { id: string }) => e.id === 'board:test-desk')
    expect((await listed()).added).toEqual([{ receipt: 'board-test-desk', at: expect.stringMatching(DAY) }])

    const staged = await ok(await remove('board-test-desk'))
    expect(staged.ops).toEqual([
      expect.objectContaining({ op: 'delete', record: 'boards:test-desk' }),
      expect.objectContaining({ op: 'update', record: 'library:board-test-desk', set: { status: 'removed', removed: UNSEALED_REMOVED } }),
    ])
    expect(staged.classes).toEqual(['records'])

    const head = sha()
    await ok(await apply())
    expect(git(repo, `rev-list --count ${head}..HEAD`).trim()).toBe('1')
    expect(git(repo, 'show --name-only --format= HEAD').trim().split('\n').sort()).toEqual(['data/boards.yaml', 'data/library.yaml'])
    expect((readRegistry(repo, 'boards').entries ?? []).map(e => e.id)).not.toContain('test-desk')
    const r = receipt('board-test-desk')
    expect(r.status).toBe('removed')
    expect(r.removed).toMatchObject({ by: 'bruno', at: expect.stringMatching(DAY), decision: { rule: expect.any(String), change: expect.stringMatching(/^chg_/) } })
    expect(errorsOf()).toEqual([])
    expect((await listed()).added).toEqual([])
  })

  it('lists the receipts, installed and removed', async () => {
    await added('board:test-desk')
    let list = await ok(await app.request('/api/library/receipts'))
    expect(list).toEqual([expect.objectContaining({ id: 'board-test-desk', entry: 'board:test-desk', shelf: 'test-shelf', status: 'installed', removed: null })])
    await ok(await remove('board-test-desk'))
    await ok(await apply())
    list = await ok(await app.request('/api/library/receipts'))
    expect(list).toEqual([expect.objectContaining({ id: 'board-test-desk', status: 'removed', removed: expect.objectContaining({ by: 'bruno' }) })])
  })

  it('fills the entry preview\'s receipts with the ones still installed', async () => {
    const preview = async () => (await ok(await app.request('/api/library/board%3Atest-desk/preview'))).receipts
    expect(await preview()).toEqual([])
    await added('board:test-desk')
    expect(await preview()).toEqual([{ id: 'board-test-desk', at: expect.stringMatching(DAY), by: 'bruno' }])
    await ok(await remove('board-test-desk'))
    await ok(await apply())
    expect(await preview()).toEqual([])
  })
})

describe('a record edited since the add: all or nothing', () => {
  beforeEach(() => fresh())
  const ASK = 'Since it was added, boards:test-desk was edited. Removing deletes it with the edits; name it in take to go ahead. Nothing was staged.'

  it('previews it as edited and asks for it; remove without it is 409 ASK and stages nothing; with it, stages', async () => {
    await added('board:test-desk')
    await ok(await stageOps([{ op: 'update', record: 'boards:test-desk', set: { name: 'Front desk' } }]))
    await ok(await apply())

    const p = await removal('board-test-desk')
    expect(p.records).toEqual([{ record: 'boards:test-desk', state: 'edited', referrers: [] }])
    expect(p.asks).toEqual(['boards:test-desk'])

    expect(await ok(await remove('board-test-desk'), 409)).toEqual({ code: 'ASK', asks: ['boards:test-desk'], error: ASK })
    expect((await view()).ops).toEqual([])
    expect(await ok(await remove('board-test-desk', { take: [] }), 409)).toEqual({ code: 'ASK', asks: ['boards:test-desk'], error: ASK })
    expect((await view()).ops).toEqual([])

    const staged = await ok(await remove('board-test-desk', { take: ['boards:test-desk'] }))
    expect(records(staged.ops)).toEqual(['boards:test-desk', 'library:board-test-desk'])
    expect(staged.ops[0].op).toBe('delete')
  })

  it('names every edited record, in one sentence, and asks for all of them', async () => {
    await added('board:test-desk')
    await added('system:test-link', { config: { name: 'Desk', url: 'https://example.org/desk' } })
    // A receipt naming both records, sealed by hand with bases neither record has now: both read as edited.
    const both = readFileSync(join(repo, 'data', 'library.yaml'), 'utf8') + `  - id: board-test-pair
    entry: board:test-pair
    version: 1.0.0
    shelf: test-shelf
    created:
      - { record: boards:test-desk, base: ${'a'.repeat(64)} }
      - { record: systems:test-link, base: ${'b'.repeat(64)} }
    status: installed
    by: bruno
    at: 2026-10-29
    decision: { rule: records/direct, change: chg_x }
    removed: null
`
    commitFile('data/library.yaml', both)
    const p = await removal('board-test-pair')
    expect(p.title).toBeNull()
    expect(p.asks).toEqual(['boards:test-desk', 'systems:test-link'])
    expect(await ok(await remove('board-test-pair', { take: ['boards:test-desk'] }), 409)).toEqual({
      code: 'ASK', asks: ['boards:test-desk', 'systems:test-link'],
      error: 'Since it was added, boards:test-desk and systems:test-link were edited. Removing deletes them with the edits; name them in take to go ahead. Nothing was staged.',
    })
    expect((await view()).ops).toEqual([])
    const staged = await ok(await remove('board-test-pair', { take: ['systems:test-link', 'boards:test-desk'] }))
    expect(records(staged.ops)).toEqual(['boards:test-desk', 'systems:test-link', 'library:board-test-pair'])
  })
})

// R-9: the removal reads the records through the actor's own tray, as it reads their referrers.
describe('the actor\'s own tray', () => {
  beforeEach(() => fresh())

  it('a record edited in the tray is edited: previewed and asked for; without take 409 ASK and the tray keeps the edit; with take the delete stages and applies', async () => {
    await added('board:test-desk')
    await ok(await stageOps([{ op: 'update', record: 'boards:test-desk', set: { name: 'Front desk' } }]))
    const before = await view()

    const p = await removal('board-test-desk')
    expect(p.records).toEqual([{ record: 'boards:test-desk', state: 'edited', referrers: [] }])
    expect(p.asks).toEqual(['boards:test-desk'])

    expect(await ok(await remove('board-test-desk'), 409)).toMatchObject({ code: 'ASK', asks: ['boards:test-desk'] })
    expect(await view()).toEqual(before)

    const staged = await ok(await remove('board-test-desk', { take: ['boards:test-desk'] }))
    expect(staged.ops).toEqual([
      expect.objectContaining({ op: 'delete', record: 'boards:test-desk' }),
      expect.objectContaining({ op: 'update', record: 'library:board-test-desk', set: { status: 'removed', removed: UNSEALED_REMOVED } }),
    ])
    await ok(await apply())
    expect((readRegistry(repo, 'boards').entries ?? []).map(e => e.id)).not.toContain('test-desk')
    expect(receipt('board-test-desk')).toMatchObject({ status: 'removed', removed: { by: 'bruno' } })
    expect(errorsOf()).toEqual([])
  })

  it('a record deleted in the tray is gone: previewed as gone, and the removal stages only the receipt beside that delete; apply succeeds', async () => {
    await added('board:test-desk')
    await ok(await stageOps([{ op: 'delete', record: 'boards:test-desk' }]))

    const p = await removal('board-test-desk')
    expect(p.records).toEqual([{ record: 'boards:test-desk', state: 'gone', referrers: [] }])
    expect(p.asks).toEqual([])

    const staged = await ok(await remove('board-test-desk'))
    expect(staged.ops).toEqual([
      expect.objectContaining({ op: 'delete', record: 'boards:test-desk' }),
      expect.objectContaining({ op: 'update', record: 'library:board-test-desk', set: { status: 'removed', removed: UNSEALED_REMOVED } }),
    ])
    await ok(await apply())
    expect((readRegistry(repo, 'boards').entries ?? []).map(e => e.id)).not.toContain('test-desk')
    expect(receipt('board-test-desk')).toMatchObject({ status: 'removed', removed: { by: 'bruno' } })
    expect(errorsOf()).toEqual([])
  })
})

describe('a record already gone', () => {
  beforeEach(() => fresh())

  it('is previewed as gone, and the removal stages only the receipt; apply succeeds', async () => {
    await added('board:test-desk')
    await ok(await stageOps([{ op: 'delete', record: 'boards:test-desk' }]))
    await ok(await apply())

    const p = await removal('board-test-desk')
    expect(p.records).toEqual([{ record: 'boards:test-desk', state: 'gone', referrers: [] }])
    expect(p.asks).toEqual([])
    const staged = await ok(await remove('board-test-desk'))
    expect(records(staged.ops)).toEqual(['library:board-test-desk'])
    expect(staged.classes).toEqual(['records'])
    await ok(await apply())
    expect(receipt('board-test-desk')).toMatchObject({ status: 'removed', removed: { by: 'bruno' } })
    expect(errorsOf()).toEqual([])
  })

  it('apply reads a file the change does not write strictly: one that will not parse is the 409, and nothing is committed', async () => {
    await added('board:test-desk')
    await ok(await stageOps([{ op: 'delete', record: 'boards:test-desk' }]))
    await ok(await apply())
    await ok(await remove('board-test-desk'))
    commitFile('data/boards.yaml', 'schema_version: "1.0"\nboards:\n  - id: [unclosed\n')
    const head = sha()
    const res = await apply()
    expect(res.status).toBe(409)
    expect(sha()).toBe(head)
    expect(receipt('board-test-desk').status).toBe('installed')
  })
})

// The engine's reference table (lib/data-validate.mjs REFS) does not yet read a board block's system, so a record it
// does read stands in: an idea, named by a project's related_ideas, added from a copy of the test shelf.
describe('a created record another record names', () => {
  const IDEA = `id: resource:test-idea
shelf: resource
title: Test idea
summary: One idea, here to prove a removal refused by a record that names what it created.
version: 1.0.0
source: test-shelf
standing: stated
as_of: 2026-10-29
tags:
  maturity: field-informed
installs:
  - op: create
    record: ideas:test-idea
    value: { id: test-idea, title: Test idea, status: surfaced }
`
  const REFUSED = 'Not deleted: ideas "test-idea" is still referred to by projects "proj-001" (related_ideas). Nothing was written. Change or remove that reference first, then delete it.'
  beforeEach(() => {
    fresh()
    const dir = join(repo, 'shelves', 'test-shelf')
    cpSync(SHELF, dir, { recursive: true })
    writeFileSync(join(dir, 'shelf.yaml'), 'name: test-shelf\ntitle: Test shelf\nentries: [board:test-desk, system:test-link, resource:test-idea]\n')
    mkdirSync(join(dir, 'resource', 'test-idea'), { recursive: true })
    writeFileSync(join(dir, 'resource', 'test-idea', 'entry.yaml'), IDEA)
    writeFileSync(join(repo, 'federation.yaml'), federation('shelves/test-shelf'))
    git(repo, 'add -A')
    git(repo, 'commit -qm "fixture: a copy of the test shelf with an idea"')
  })

  it('the preview lists the referrer, and the engine\'s own delete check refuses the removal: nothing staged', async () => {
    await added('resource:test-idea')
    await ok(await stageOps([{ op: 'update', record: 'projects:proj-001', set: { related_ideas: ['test-idea'] } }]))
    await ok(await apply())
    const p = await removal('resource-test-idea')
    expect(p.records).toEqual([{ record: 'ideas:test-idea', state: 'as added', referrers: ['projects:proj-001'] }])
    expect(await ok(await remove('resource-test-idea'), 422)).toEqual({ errors: [{ record: 'ideas:test-idea', field: '', message: REFUSED }] })
    expect((await view()).ops).toEqual([])
  })

  it('a referrer written after the removal was staged: apply answers the engine\'s 422, and nothing is committed', async () => {
    await added('resource:test-idea')
    await ok(await remove('resource-test-idea'))
    const projects = readFileSync(join(repo, 'data', 'projects.yaml'), 'utf8').replace('contributors:', 'related_ideas: ["test-idea"]\n    contributors:')
    commitFile('data/projects.yaml', projects)
    const head = sha()
    expect(await ok(await apply(), 422)).toEqual({ errors: [{ record: 'ideas:test-idea', field: '', message: REFUSED }] })
    expect(sha()).toBe(head)
    expect(git(repo, 'status --porcelain')).toBe('')
    expect(records((await view()).ops)).toEqual(['ideas:test-idea', 'library:resource-test-idea'])
  })
})

describe('what a removal refuses', () => {
  beforeEach(() => fresh())

  it('a receipt already removed: 409 REMOVED, and the preview says when', async () => {
    await added('board:test-desk')
    await ok(await remove('board-test-desk'))
    await ok(await apply())
    const at = String(receipt('board-test-desk').removed && (receipt('board-test-desk').removed as { at: string }).at)
    expect(await ok(await remove('board-test-desk'), 409))
      .toEqual({ code: 'REMOVED', error: `Receipt board-test-desk was already removed on ${at}. Nothing was staged.` })
    expect((await view()).ops).toEqual([])
    const p = await removal('board-test-desk')
    expect(p.refusal).toBe(`This was removed on ${at}.`)
    expect(p.asks).toEqual([])
  })

  it('an unknown receipt: 404, from the preview and from remove', async () => {
    const NONE = { error: 'No receipt "nope". GET /api/library/receipts lists them.' }
    const p = await app.request('/api/library/receipts/nope/removal')
    expect(p.status).toBe(404)
    expect(await p.json()).toEqual(NONE)
    expect(await ok(await remove('nope'), 404)).toEqual(NONE)
    expect((await view()).ops).toEqual([])
  })

  it('a body that is not {} or {"take": [...]}: 400', async () => {
    await added('board:test-desk')
    for (const body of [[1], 'desk', { take: 'boards:test-desk' }, { take: [1] }]) {
      const b = await ok(await remove('board-test-desk', body), 400)
      expect(b.error).toMatch(/^The body must be/)
    }
    expect((await view()).ops).toEqual([])
  })

  it('an actor git cannot match: the 403 every write gives', async () => {
    await added('board:test-desk')
    git(repo, 'config user.email stranger@local')
    const res = await remove('board-test-desk')
    const ops = await stageOps([{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }])
    expect(ops.status).toBe(403)
    expect(await ok(res, 403)).toEqual(await ops.json())
  })
})

describe('Review Focus 2, the removal direction: half a removal', () => {
  beforeEach(() => fresh())

  it('taking the board\'s delete out of the tray alone is refused, and the change still holds both', async () => {
    await added('board:test-desk')
    await ok(await remove('board-test-desk'))
    const res = await app.request('/api/changes/ops/0', { method: 'DELETE' })
    expect(await ok(res, 422)).toEqual({ errors: [{ record: 'library:board-test-desk', field: '',
      message: 'library:board-test-desk is marked removed, but boards:test-desk is not deleted by this change. Take the removal out as a whole, or stage it again from the library.' }] })
    expect(records((await view()).ops)).toEqual(['boards:test-desk', 'library:board-test-desk'])
  })
})

describe('a receipts file holding an item that is no mapping (M4)', () => {
  beforeEach(() => fresh())

  it('the list, the receipts, the preview, a removal\'s preview and the next receipt id skip it rather than answer 500', async () => {
    await added('board:test-desk')
    writeFileSync(join(repo, 'data', 'library.yaml'), `${readFileSync(join(repo, 'data', 'library.yaml'), 'utf8')}  -\n  - null\n  - just words\n`)
    const listed = await ok(await app.request('/api/library'))
    expect(listed.entries.find((e: { id: string }) => e.id === 'board:test-desk').added).toEqual([{ receipt: 'board-test-desk', at: expect.stringMatching(DAY) }])
    expect((await ok(await app.request('/api/library/receipts'))).map((r: { id: string }) => r.id)).toEqual(['board-test-desk'])
    expect((await ok(await app.request('/api/library/board%3Atest-desk/preview'))).receipts).toEqual([{ id: 'board-test-desk', at: expect.stringMatching(DAY), by: 'bruno' }])
    expect((await removal('board-test-desk')).records).toEqual([{ record: 'boards:test-desk', state: 'as added', referrers: [] }])
    // The receipt-id reader, alone: staging the add goes on to the change engine, which reads every item of a file.
    const link = loadLibrary(repo).entries.find(e => e.id === 'system:test-link')!
    expect(addOps(repo, link, { name: 'Desk', url: 'https://example.org/desk' }, []).receipt).toBe('system-test-link')
  })
})

describe('reading writes nothing', () => {
  beforeEach(() => fresh())

  it('the removal preview and the receipts list leave HEAD, the work tree and the change as they were', async () => {
    await added('board:test-desk')
    await ok(await stageOps([{ op: 'update', record: 'boards:test-desk', set: { name: 'Front desk' } }]))
    const head = sha(); const status = git(repo, 'status --porcelain'); const change = await view()
    await removal('board-test-desk')
    await ok(await app.request('/api/library/receipts'))
    await ok(await app.request('/api/library'))
    expect(sha()).toBe(head)
    expect(git(repo, 'status --porcelain')).toBe(status)
    expect(await view()).toEqual(change)
  })
})

describe('a removal that needs a proposal', () => {
  const MEMBERS = `schema_version: "2.0"
members:
  - { id: ana, name: Ana, kind: person, handles: { git: ["ana@example.test"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
  - { id: carla, name: Carla, kind: person, handles: { git: ["carla@example.test"] } }
`
  const APPROVE = `schema_version: "2.0"\ngovernance:\n  model: "consensus"\n  roles:\n    maintainer: { members: [bruno] }\n    member: { all: true }\n  rules:\n    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }\n  decisions: []\n`
  // The proposal routes' clock: five minutes behind the real now, in steps of 30 s, so every proposal opens within ten
  // minutes of its commit and every event is dated before the commit that ratifies it (validate:governance's checks).
  let clock: Date
  const tick = () => { clock = new Date(clock.getTime() + 30_000) }
  const as = (who: string) => { git(repo, `config user.email ${who}@example.test`) }

  beforeEach(() => {
    clock = new Date(Math.floor(Date.now() / 1000) * 1000 - 300_000)
    repo = makeSyntheticRepo(null)
    writeFileSync(join(repo, 'federation.yaml'), federation(SHELF))
    writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
    writeFileSync(join(repo, 'data', 'governance.yaml'), APPROVE)
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: synthetic members, their rules and the test shelf"')
    app = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => clock }))
  })

  async function decided(title: string): Promise<string> {
    as('ana')
    const id = String((await ok(await app.request('/api/proposals', json('POST', { title })), 201)).id)
    tick(); as('bruno')
    await ok(await app.request(`/api/proposals/${id}/events`, json('POST', { kind: 'approve' })))
    tick()
    await ok(await app.request(`/api/proposals/${id}/ratify`, json('POST', {})))
    return id
  }

  it('ana proposes it, bruno approves, the ratify seals removed with the proposal, and validate:governance --strict passes', async () => {
    as('ana')
    await ok(await add('board:test-desk'))
    await decided('Add the test desk')
    expect(receipt('board-test-desk').status).toBe('installed')

    as('ana')
    const p = await removal('board-test-desk')
    expect(p.decided).toEqual([{ class: 'records', direct: false, sentence: expect.any(String) }])
    await ok(await remove('board-test-desk'))
    const id = await decided('Remove the test desk')

    const r = parse(git(repo, 'show HEAD:data/library.yaml')).installed[0]
    expect(r.status).toBe('removed')
    expect(r.removed).toEqual({ by: 'ana', at: expect.stringMatching(DAY), decision: { proposal: id } })
    expect((readRegistry(repo, 'boards').entries ?? []).map(e => e.id)).not.toContain('test-desk')
    const run = spawnSync(process.execPath, ['scripts/validate-governance.mjs', repo, '--strict'], { cwd: FRAMEWORK, encoding: 'utf8' })
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(errorsOf()).toEqual([])
  })
})
