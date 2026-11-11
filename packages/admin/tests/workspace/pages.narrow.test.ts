import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountVisibility } from '../../server/visibility/routes.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { validateRepo } from '../../lib/data-validate.mjs'
import { withRequest } from '../../server/request.ts'
import { Membership } from '../../server/session/membership.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { joinPage, NAMED_BY } from '../../lib/workspace/pages.mjs'
import { PAGE_LEAVES_GIT, narrowSubject, parseNarrowSubject } from '../../lib/narrow.mjs'
import { MOVE_PROPOSED } from '../../server/private/ops.ts'
import type { WearerReading } from '../../server/systems/hats.ts'

// DAO-OS L6 §4.4, Task 7: a page narrowed below members leaves git with every subpage, in one commit (Org-Rule:
// visibility/narrow) and one store transaction; validate:governance accepts that commit. Fresh temporary repositories
// only; the store in a temp folder of its own. Placeholders only; no network.

const NOW = new Date('2026-10-30T12:00:00Z')
const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`
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
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person }
`
const page = (id: string, title: string, parent: string | null, extra: Record<string, unknown> = {}) =>
  joinPage({ id, title, parent, order: 1000, ...extra }, `Body of ${title}.\n`)

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function world(pages: Record<string, string>, governance = GOVERNANCE): Promise<{ repo: string; store: PrivateStore; app: Hono }> {
  const repo = makeChangeRepo(governance)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  mkdirSync(join(repo, 'pages'), { recursive: true })
  for (const [id, text] of Object.entries(pages)) writeFileSync(join(repo, 'pages', `${id}.md`), text)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree and the pages"')
  const dir = mkdtempSync(join(tmpdir(), 'pages-narrow-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const now = () => NOW
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, block: 100, readAt: NOW.toISOString(),
    hats: account.toLowerCase().endsWith('a1') ? [OPS] : [] })
  const reader = { wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)), wearers: vi.fn() }
  const membership = new Membership({ repo, reader: reader as never, now })
  const app = createApp(repo, (a, ctx) => {
    mountVisibility(a, { repo, membership, withLock: ctx.withLock, privateStore: ctx.privateStore })
    mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now, privateStore: ctx.privateStore })
  }, { request: withRequest({ repo, hosted: false, membership, store, now }), privateStore: () => store })
  return { repo, store, app }
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const commits = (repo: string) => Number(git(repo, 'rev-list --count HEAD').trim())

describe('narrowing a page (L6 §4.4)', () => {
  it('the subject names the page, and reads back', () => {
    expect(narrowSubject({ kind: 'page', id: 'plans-0001', level: `hat:${OPS}` })).toBe(`visibility: narrow page plans-0001 to hat:${OPS}`)
    expect(parseNarrowSubject(`visibility: narrow page plans-0001 to hat:${OPS}`)).toEqual({ kind: 'page', id: 'plans-0001', level: `hat:${OPS}` })
  })

  it('narrowing a page to hat:Ops moves it and its 2 subpages into the store in one commit and one transaction; validate:governance accepts it', async () => {
    const w = await world({
      'plans-0001': page('plans-0001', 'Plans', null),
      'q1-0001': page('q1-0001', 'Q1', 'plans-0001', { visibility: 'members' }),
      'q1-detail-0001': page('q1-detail-0001', 'Q1 detail', 'q1-0001'),
      'other-0001': page('other-0001', 'Other', null),
    })
    const before = commits(w.repo)
    const historyBefore = w.store.history().length
    const res = await w.app.request('/api/visibility/narrow', json('POST', { target: { page: 'plans-0001' }, level: `hat:${OPS}` }))
    const body = await res.json() as { commit: string; moved: boolean; subpages: number; confirmation: string }
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ moved: true, subpages: 2, confirmation: PAGE_LEAVES_GIT(2) })
    expect(PAGE_LEAVES_GIT(2)).toBe("It and its 2 subpages leave the repository from now on. Its earlier versions stay in the repository's history, which members could already read.")
    expect(commits(w.repo)).toBe(before + 1)
    const head = git(w.repo, 'rev-parse HEAD').trim()
    expect(body.commit).toBe(head)
    expect(git(w.repo, 'log -1 --format=%B')).toContain('Org-Rule: visibility/narrow')
    expect(git(w.repo, 'show --name-status --format= HEAD').trim().split('\n').sort())
      .toEqual(['D\tpages/plans-0001.md', 'D\tpages/q1-0001.md', 'D\tpages/q1-detail-0001.md'])
    for (const id of ['plans-0001', 'q1-0001', 'q1-detail-0001']) {
      expect(existsSync(join(w.repo, 'pages', `${id}.md`))).toBe(false)
      expect(w.store.record('pages', id)).toMatchObject({ visibility: `hat:${OPS}`, body: { markdown: expect.stringContaining('Body of') } })
    }
    expect(w.store.record('pages', 'q1-detail-0001')!.body).toMatchObject({ title: 'Q1 detail', parent: 'q1-0001' })
    expect(w.store.history().length).toBe(historyBefore + 3)
    expect(existsSync(join(w.repo, 'pages', 'other-0001.md'))).toBe(true)
    // The tree still holds them, for the Ops wearer.
    const list = await (await w.app.request('/api/pages')).json() as { id: string; visibility: string }[]
    expect(list.find(p => p.id === 'q1-0001')).toMatchObject({ visibility: `hat:${OPS}` })
    // Offline, the commit is exactly the narrowing it says.
    const r = spawnSync('node', [SCRIPT, w.repo, '--strict'], { encoding: 'utf8', env: { ...process.env, CI: '' } })
    expect(r.stdout).toContain('history')
    expect(r.stdout.split('\n').filter(l => l.includes(head.slice(0, 7)) && /^\s*[✗⚠]/.test(l))).toEqual([])
  })

  // Walk M7: while a narrowing moved a page out of git (its files deleted, the store's transaction not yet committed), a
  // read of the page answered 404: the open page's refetches logged "404 GET /api/pages/<id>". Reads wait for the write.
  it('a page read while it is narrowed out of git finds it, before and after: never a 404 in between; the tree lists it throughout', async () => {
    const w = await world({
      'plans-0001': page('plans-0001', 'Plans', null),
      'q1-0001': page('q1-0001', 'Q1', 'plans-0001'),
    })
    const pending = w.app.request('/api/visibility/narrow', json('POST', { target: { page: 'plans-0001' }, level: `hat:${OPS}` }))
    let done = false
    void Promise.resolve(pending).then(() => { done = true })
    const statuses: number[] = []
    const listed: boolean[] = []
    while (!done && statuses.length < 400) {
      statuses.push((await w.app.request('/api/pages/plans-0001')).status)
      listed.push(((await (await w.app.request('/api/pages')).json()) as { id: string }[]).some(p => p.id === 'q1-0001'))
      await new Promise(r => setTimeout(r, 1))
    }
    expect((await pending).status).toBe(200)
    expect(statuses.filter(s => s !== 200)).toEqual([])
    expect(listed.every(Boolean)).toBe(true)
  })

  it('a hand commit under visibility/narrow that leaves a subpage behind is a finding', async () => {
    const w = await world({
      'plans-0001': page('plans-0001', 'Plans', null),
      'q1-0001': page('q1-0001', 'Q1', 'plans-0001'),
    })
    git(w.repo, 'rm -q pages/plans-0001.md')
    writeFileSync(join(w.repo, 'msg.txt'), `visibility: narrow page plans-0001 to hat:${OPS}\n\nOrg-Actor: steward-a\nOrg-Rule: visibility/narrow\n`)
    git(w.repo, 'commit -q -F msg.txt')
    const head = git(w.repo, 'rev-parse HEAD').trim()
    const r = spawnSync('node', [SCRIPT, w.repo, '--strict'], { encoding: 'utf8', env: { ...process.env, CI: '' } })
    const found = r.stdout.split('\n').filter(l => l.includes(head.slice(0, 7)) && /^\s*[✗⚠]/.test(l))
    expect(found.join('\n')).toContain('it leaves pages/q1-0001.md in the repository, which leave it with page plans-0001')
  })

  it('a page narrowed to members stays in git: its own visibility set; validate:governance accepts it', async () => {
    const w = await world({ 'open-0001': page('open-0001', 'Open', null, { visibility: 'public' }) })
    const res = await w.app.request('/api/visibility/narrow', json('POST', { target: { page: 'open-0001' }, level: 'members' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ moved: false })
    const head = git(w.repo, 'rev-parse HEAD').trim()
    expect(git(w.repo, 'show HEAD:pages/open-0001.md')).toContain('visibility: members')
    const r = spawnSync('node', [SCRIPT, w.repo, '--strict'], { encoding: 'utf8', env: { ...process.env, CI: '' } })
    expect(r.stdout.split('\n').filter(l => l.includes(head.slice(0, 7)) && /^\s*[✗⚠]/.test(l))).toEqual([])
  })
})

/** The tree plans-0001 is raised: an edit of it is proposed, and approved by steward-a. */
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
    - { id: plans, applies_to: ["workspace:tree-plans-0001"], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
/** Whether any file of HEAD's tree holds `text` (git grep: exit 1 when none does). */
const headHolds = (repo: string, text: string) => spawnSync('git', ['grep', '-q', '-F', text, 'HEAD'], { cwd: repo }).status === 0
const lint = (repo: string, head: string) => {
  const r = spawnSync('node', [SCRIPT, repo, '--strict'], { encoding: 'utf8', env: { ...process.env, CI: '' } })
  return r.stdout.split('\n').filter(l => l.includes(head.slice(0, 7)) && /^\s*[✗⚠]/.test(l))
}

/** The tree plans-0001 is raised to a rule only the Council proposes under (merge M1: Q77 over L6's targets). */
const COUNCIL_TREE = RAISED.replace('propose: member', 'propose: council')

describe("who may narrow a page is who may write it, judged at its tree (Q77, merge M1)", () => {
  it('a page, or a subpage, of a tree raised to a rule the actor cannot propose under is refused 403 MAY_NOT_WRITE; nothing is written', async () => {
    const w = await world({
      'plans-0001': page('plans-0001', 'Plans', null),
      'q1-0001': page('q1-0001', 'Q1', 'plans-0001'),
      'other-0001': page('other-0001', 'Other', null),
    }, COUNCIL_TREE)
    const before = git(w.repo, 'rev-parse HEAD').trim()
    for (const id of ['plans-0001', 'q1-0001']) {
      const res = await w.app.request('/api/visibility/narrow', json('POST', { target: { page: id }, level: `hat:${OPS}` }))
      expect(res.status).toBe(403)
      const body = await res.json() as { code: string; error: string }
      expect(body.code).toBe('MAY_NOT_WRITE')
      expect(body.error).toMatch(/^You cannot change pages, so you cannot narrow it: .*council.* Nothing was written\.$/)
    }
    expect(git(w.repo, 'rev-parse HEAD').trim()).toBe(before)
    expect(w.store.record('pages', 'plans-0001')).toBeNull()
    // A page outside the raised tree is a workspace/direct write: narrowed at once.
    const res = await w.app.request('/api/visibility/narrow', json('POST', { target: { page: 'other-0001' }, level: `hat:${OPS}` }))
    expect(res.status).toBe(200)
  })
})

describe('a page that leaves git leaves nothing of itself in git (review I1, ruling R-7a)', () => {
  const TITLE = 'Quartz-ledger-plans-4471'

  it('is refused 409 REFERRED while another git page links to it by its title, naming that page; nothing is changed', async () => {
    const w = await world({
      'plans-0001': page('plans-0001', TITLE, null),
      'index-0001': page('index-0001', 'Index', null, {}).replace('Body of Index.', `See [${TITLE}](./plans-0001.md).`),
    })
    const before = commits(w.repo)
    const res = await w.app.request('/api/visibility/narrow', json('POST', { target: { page: 'plans-0001' }, level: `hat:${OPS}` }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'REFERRED', error: 'Other pages link to this page by name: Index. Change those links to ↗ first. Nothing was changed.' })
    expect(NAMED_BY(['Index'])).toBe('Other pages link to this page by name: Index. Change those links to ↗ first. Nothing was changed.')
    expect(commits(w.repo)).toBe(before)
  })

  it('with the links labelled ↗, it goes, and no file of HEAD holds its title', async () => {
    const w = await world({
      'plans-0001': page('plans-0001', TITLE, null),
      'index-0001': page('index-0001', 'Index', null).replace('Body of Index.', 'See [↗](./plans-0001.md).'),
    })
    expect(headHolds(w.repo, TITLE)).toBe(true)
    const res = await w.app.request('/api/visibility/narrow', json('POST', { target: { page: 'plans-0001' }, level: `hat:${OPS}` }))
    expect(res.status).toBe(200)
    expect(headHolds(w.repo, TITLE)).toBe(false)
    expect(lint(w.repo, git(w.repo, 'rev-parse HEAD').trim())).toEqual([])
  })

  it("a closed proposal's file op on it is held as a placeholder in the same commit; validate:governance and validate:data accept it", async () => {
    const w = await world({ 'plans-0001': page('plans-0001', 'Plans', null) }, RAISED)
    const edited = page('plans-0001', 'Plans', null).replace('Body of Plans.', `Now about ${TITLE}.`)
    expect((await w.app.request('/api/changes/ops', json('POST', { ops: [{ op: 'file', path: 'pages/plans-0001.md', text: edited }] }))).status).toBe(200)
    const proposed = await w.app.request('/api/proposals', json('POST', { title: 'Rewrite the plans' }))
    expect(proposed.status).toBe(201)
    const id = String(((await proposed.json()) as { id: string }).id)
    expect((await w.app.request(`/api/proposals/${id}/events`, json('POST', { kind: 'withdraw' }))).status).toBe(200)
    expect(headHolds(w.repo, TITLE)).toBe(true) // the withdrawn proposal's op holds the text
    const errorsBefore = validateRepo(w.repo).filter(p => p.file === 'data/proposals.yaml' && p.level === 'error').length
    const res = await w.app.request('/api/visibility/narrow', json('POST', { target: { page: 'plans-0001' }, level: `hat:${OPS}` }))
    expect(res.status).toBe(200)
    expect(git(w.repo, 'show --name-only --format= HEAD').trim().split('\n').sort()).toEqual(['data/proposals.yaml', 'pages/plans-0001.md'])
    expect(headHolds(w.repo, TITLE)).toBe(false)
    expect(headHolds(w.repo, 'pages/plans-0001.md')).toBe(false)
    const head = git(w.repo, 'rev-parse HEAD').trim()
    expect(lint(w.repo, head)).toEqual([])
    expect(validateRepo(w.repo).filter(p => p.file === 'data/proposals.yaml' && p.level === 'error').length).toBeLessThanOrEqual(errorsBefore)
  })

  it('offline, a hand narrowing that leaves a title label behind is a finding', async () => {
    const w = await world({
      'plans-0001': page('plans-0001', TITLE, null),
      'index-0001': page('index-0001', 'Index', null).replace('Body of Index.', `See [${TITLE}](./plans-0001.md).`),
    })
    git(w.repo, 'rm -q pages/plans-0001.md')
    writeFileSync(join(w.repo, 'msg.txt'), `visibility: narrow page plans-0001 to hat:${OPS}\n\nOrg-Actor: steward-a\nOrg-Rule: visibility/narrow\n`)
    git(w.repo, 'commit -q -F msg.txt')
    const found = lint(w.repo, git(w.repo, 'rev-parse HEAD').trim())
    expect(found.join('\n')).toContain('pages/index-0001.md still names page plans-0001 or a subpage by its title')
  })
})

describe('a move that makes a page stricter (L6 Task 8, controller ruling R-7c)', () => {
  it('refuses 409 REFERRED while another git page names it by its title; with ↗ the move is made', async () => {
    const w = await world({
      'open-0001': page('open-0001', 'Open shelf', null, { visibility: 'public' }),
      'kid-0001': page('kid-0001', 'Kid page', 'open-0001'),
      'shelf-0001': page('shelf-0001', 'Members shelf', null),
      'index-0001': page('index-0001', 'Index', null, { visibility: 'public' }).replace('Body of Index.', 'See [Kid page](./kid-0001.md).'),
    })
    const before = commits(w.repo)
    const res = await w.app.request('/api/pages/kid-0001/move', json('POST', { parent: 'shelf-0001' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'REFERRED', error: NAMED_BY(['Index']) })
    expect(commits(w.repo)).toBe(before)
    expect(git(w.repo, 'status --porcelain').trim()).toBe('')
    // Labelled ↗, nothing names it by its title: the move is one commit.
    writeFileSync(join(w.repo, 'pages', 'index-0001.md'), page('index-0001', 'Index', null, { visibility: 'public' }).replace('Body of Index.', 'See [↗](./kid-0001.md).'))
    git(w.repo, 'add pages/index-0001.md'); git(w.repo, 'commit -qm "page: Index"')
    const moved = await w.app.request('/api/pages/kid-0001/move', json('POST', { parent: 'shelf-0001' }))
    expect(moved.status).toBe(200)
    expect(commits(w.repo)).toBe(before + 2)
  })

  it('a git page moved under a private page leaves git with its subpages, as a narrowing does, and takes its place there', async () => {
    const TITLE = 'Quartz-heron-ledger-5521'
    const w = await world({
      'notes-0001': page('notes-0001', TITLE, null),
      'sub-0001': page('sub-0001', 'Sub of it', 'notes-0001'),
    })
    await w.store.putRecord({ collection: 'pages', id: 'p-0123456789ab', visibility: `hat:${OPS}`, body: { title: 'Ops room', parent: null, order: 1000, markdown: '' }, rev: '' }, 'steward-a', null)
    const before = commits(w.repo)
    const res = await w.app.request('/api/pages/notes-0001/move', json('POST', { parent: 'p-0123456789ab' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'notes-0001', commit: git(w.repo, 'rev-parse HEAD').trim() })
    expect(commits(w.repo)).toBe(before + 1)
    expect(git(w.repo, 'log -1 --format=%B')).toContain('Org-Rule: visibility/narrow')
    expect(git(w.repo, 'show --name-status --format= HEAD').trim().split('\n').sort()).toEqual(['D\tpages/notes-0001.md', 'D\tpages/sub-0001.md'])
    expect(w.store.record('pages', 'notes-0001')).toMatchObject({ visibility: `hat:${OPS}`, body: { title: TITLE, parent: 'p-0123456789ab' } })
    expect(w.store.record('pages', 'sub-0001')).toMatchObject({ visibility: `hat:${OPS}`, body: { parent: 'notes-0001' } })
    expect(spawnSync('git', ['grep', '-q', TITLE, 'HEAD'], { cwd: w.repo }).status).toBe(1)
  })

  it('a git page with its own `visibility: members` is not moved under a private page: it would be looser than it', async () => {
    const w = await world({ 'notes-0001': page('notes-0001', 'Notes', null, { visibility: 'members' }) })
    await w.store.putRecord({ collection: 'pages', id: 'p-0123456789ab', visibility: `hat:${OPS}`, body: { title: 'Ops room', parent: null, order: 1000, markdown: '' }, rev: '' }, 'steward-a', null)
    const before = commits(w.repo)
    const res = await w.app.request('/api/pages/notes-0001/move', json('POST', { parent: 'p-0123456789ab' }))
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('LOOSER_THAN_PARENT')
    expect(commits(w.repo)).toBe(before)
    expect(w.store.record('pages', 'notes-0001')).toBeNull()
  })
})

// L6 Task 21 (K5's tail, PF-R110): the page tree's move and removal, and the renumbering of siblings a move brings, write
// store pages too. While an open proposal holds the move of one of them into the repository (its pending row), that write
// would leave the move stale, so the tree refuses it 409 MOVE_HELD in the move's words, before anything is written.
describe('the page tree keeps still a page whose move an open proposal holds (K5 tail)', () => {
  const PROPOSAL = 'P-2026-11-05-001'
  const held = (store: PrivateStore, id: string) => store.tx(t => t.putPending({ ref: `prv-${id}`, proposal: PROPOSAL, salt: 'salt', digest: 'sha256:held',
    ops: [{ op: 'move-to-git', collection: 'pages', id, level: 'members', digest: 'sha256:held' }] }))
  const privatePage = (store: PrivateStore, id: string, title: string, parent: string | null, order: number) =>
    store.putRecord({ collection: 'pages', id, visibility: `hat:${OPS}`, body: { title, parent, order, markdown: `Body of ${title}.\n` }, rev: '' }, 'steward-a', null)
  const refusal = { code: 'MOVE_HELD', error: MOVE_PROPOSED('page', PROPOSAL) }

  it('moving a held private page is refused 409 MOVE_HELD; the record is as it was', async () => {
    const w = await world({})
    await privatePage(w.store, 'p-0000000000a1', 'Ops room', null, 1000)
    await privatePage(w.store, 'p-0000000000a2', 'Payroll plan', null, 2000)
    await held(w.store, 'p-0000000000a2')
    const kept = w.store.record('pages', 'p-0000000000a2')
    const res = await w.app.request('/api/pages/p-0000000000a2/move', json('POST', { parent: 'p-0000000000a1' }))
    expect([res.status, await res.json()]).toEqual([409, refusal])
    expect(w.store.record('pages', 'p-0000000000a2')).toEqual(kept)
  })

  it('a move that would renumber a held sibling is refused 409; neither page nor git changes', async () => {
    const w = await world({ 'notes-0001': page('notes-0001', 'Notes', null, { order: 9000 }) })
    await privatePage(w.store, 'p-0000000000b1', 'Tight A', null, 5000)
    await privatePage(w.store, 'p-0000000000b2', 'Tight B', null, 5000.0000001)
    await privatePage(w.store, 'p-0000000000b3', 'Mover', null, 7000)
    await held(w.store, 'p-0000000000b1')
    const kept = ['p-0000000000b1', 'p-0000000000b2', 'p-0000000000b3'].map(id => w.store.record('pages', id))
    const before = commits(w.repo)
    const res = await w.app.request('/api/pages/p-0000000000b3/move', json('POST', { parent: null, before: 'p-0000000000b2' }))
    expect([res.status, await res.json()]).toEqual([409, refusal])
    expect(['p-0000000000b1', 'p-0000000000b2', 'p-0000000000b3'].map(id => w.store.record('pages', id))).toEqual(kept)
    expect(commits(w.repo)).toBe(before)
  })

  it('a git page renumbered beside a held private sibling: the commit is not made either', async () => {
    const w = await world({
      'tight-0001': page('tight-0001', 'Tight git', null, { order: 5000.0000001 }),
      'mover-0001': page('mover-0001', 'Mover', null, { order: 8000 }),
    })
    await privatePage(w.store, 'p-0000000000c1', 'Tight private', null, 5000)
    await held(w.store, 'p-0000000000c1')
    const kept = w.store.record('pages', 'p-0000000000c1')
    const before = commits(w.repo)
    const res = await w.app.request('/api/pages/mover-0001/move', json('POST', { parent: null, before: 'tight-0001' }))
    expect([res.status, await res.json()]).toEqual([409, refusal])
    expect(commits(w.repo)).toBe(before)
    expect(w.store.record('pages', 'p-0000000000c1')).toEqual(kept)
  })

  it('a git page moved under a private page, renumbering a held private child there, is refused before it leaves git', async () => {
    const w = await world({ 'notes-0001': page('notes-0001', 'Notes', null) })
    await privatePage(w.store, 'p-0000000000d1', 'Ops room', null, 1000)
    await privatePage(w.store, 'p-0000000000d2', 'Kid A', 'p-0000000000d1', 5000)
    await privatePage(w.store, 'p-0000000000d3', 'Kid B', 'p-0000000000d1', 5000.0000001)
    await held(w.store, 'p-0000000000d2')
    const kept = w.store.record('pages', 'p-0000000000d2')
    const before = commits(w.repo)
    const res = await w.app.request('/api/pages/notes-0001/move', json('POST', { parent: 'p-0000000000d1', before: 'p-0000000000d3' }))
    expect([res.status, await res.json()]).toEqual([409, refusal])
    expect(commits(w.repo)).toBe(before)
    expect(existsSync(join(w.repo, 'pages', 'notes-0001.md'))).toBe(true)
    expect(w.store.record('pages', 'notes-0001')).toBeNull()
    expect(w.store.record('pages', 'p-0000000000d2')).toEqual(kept)
  })

  // The final review's I-1 (PF-R115): a store sibling the viewer is not admitted to, held or not, is never written by a
  // renumbering nor named by its refusal; the rest are renumbered around it. Here the Council's page is hidden from a1.
  const hiddenPage = (store: PrivateStore, id: string, title: string, parent: string | null, order: number) =>
    store.putRecord({ collection: 'pages', id, visibility: `hat:${COUNCIL}`, body: { title, parent, order, markdown: `Body of ${title}.\n` }, rev: '' }, 'steward-b', null)
  const historyOf = (store: PrivateStore, id: string) => store.history().filter(h => h.target.includes(id))
  const orderOf = (repo: string, id: string) => Number(/\norder: ([0-9.e+-]+)\n/.exec(git(repo, `show HEAD:pages/${id}.md`))![1])

  it('a git page renumbered beside a hidden held sibling: moved, the hidden page untouched, its proposal not named', async () => {
    const w = await world({
      'a-0001': page('a-0001', 'A', null, { order: 1000 }),
      'b-0001': page('b-0001', 'B', null, { order: 1000.0000002 }),
      'c-0001': page('c-0001', 'C', null, { order: 5000 }),
    })
    await hiddenPage(w.store, 'p-0000000000f1', 'Council room', null, 1000.0000001)
    await held(w.store, 'p-0000000000f1')
    const kept = w.store.record('pages', 'p-0000000000f1')
    const history = historyOf(w.store, 'p-0000000000f1')
    const res = await w.app.request('/api/pages/c-0001/move', json('POST', { parent: null, before: 'b-0001' }))
    const body = await res.text()
    expect(res.status).toBe(200)
    expect(body).not.toContain(PROPOSAL)
    expect(body).not.toContain('p-0000000000f1')
    expect(w.store.record('pages', 'p-0000000000f1')).toEqual(kept)
    expect(historyOf(w.store, 'p-0000000000f1')).toEqual(history)
    const [a, c, b] = ['a-0001', 'c-0001', 'b-0001'].map(id => orderOf(w.repo, id))
    expect(a!).toBeLessThan(1000.0000001)
    expect(1000.0000001).toBeLessThan(c!)
    expect(c!).toBeLessThan(b!)
  })

  it('a private page renumbered beside a hidden sibling: the hidden page keeps its order and history', async () => {
    const w = await world({})
    await privatePage(w.store, 'p-0000000000f2', 'Tight A', null, 5000)
    await hiddenPage(w.store, 'p-0000000000f3', 'Council room', null, 5000.0000001)
    await privatePage(w.store, 'p-0000000000f4', 'Tight B', null, 5000.0000002)
    await privatePage(w.store, 'p-0000000000f5', 'Mover', null, 9000)
    const kept = w.store.record('pages', 'p-0000000000f3')
    const history = historyOf(w.store, 'p-0000000000f3')
    const res = await w.app.request('/api/pages/p-0000000000f5/move', json('POST', { parent: null, before: 'p-0000000000f4' }))
    expect(res.status).toBe(200)
    expect(w.store.record('pages', 'p-0000000000f3')).toEqual(kept)
    expect(historyOf(w.store, 'p-0000000000f3')).toEqual(history)
    const order = (id: string) => (w.store.record('pages', id)!.body as { order: number }).order
    expect(order('p-0000000000f2')).toBeLessThan(5000.0000001)
    expect(5000.0000001).toBeLessThan(order('p-0000000000f5'))
    expect(order('p-0000000000f5')).toBeLessThan(order('p-0000000000f4'))
  })

  it('a git page moved under a private page, beside a hidden held child there, leaves git; the child is untouched', async () => {
    const w = await world({ 'notes-0001': page('notes-0001', 'Notes', null) })
    await privatePage(w.store, 'p-0000000000g1', 'Ops room', null, 1000)
    await hiddenPage(w.store, 'p-0000000000g2', 'Kid A', 'p-0000000000g1', 5000)
    await privatePage(w.store, 'p-0000000000g3', 'Kid B', 'p-0000000000g1', 5000.0000001)
    await held(w.store, 'p-0000000000g2')
    const kept = w.store.record('pages', 'p-0000000000g2')
    const history = historyOf(w.store, 'p-0000000000g2')
    const res = await w.app.request('/api/pages/notes-0001/move', json('POST', { parent: 'p-0000000000g1', before: 'p-0000000000g3' }))
    const body = await res.text()
    expect(res.status).toBe(200)
    expect(body).not.toContain(PROPOSAL)
    expect(w.store.record('pages', 'p-0000000000g2')).toEqual(kept)
    expect(historyOf(w.store, 'p-0000000000g2')).toEqual(history)
    const order = (id: string) => (w.store.record('pages', id)!.body as { order: number }).order
    expect(5000).toBeLessThan(order('notes-0001'))
    expect(order('notes-0001')).toBeLessThan(order('p-0000000000g3'))
  })

  it('no room left between hidden siblings: 409 in words that name nothing; nothing written', async () => {
    const w = await world({
      'v-0001': page('v-0001', 'V', null, { order: 5000.0000001 }),
      'mover-0001': page('mover-0001', 'Mover', null, { order: 9000 }),
    })
    await hiddenPage(w.store, 'p-0000000000h1', 'Council A', null, 5000)
    await hiddenPage(w.store, 'p-0000000000h2', 'Council B', null, 5000.0000002)
    const kept = ['p-0000000000h1', 'p-0000000000h2'].map(id => w.store.record('pages', id))
    const before = commits(w.repo)
    const res = await w.app.request('/api/pages/mover-0001/move', json('POST', { parent: null, before: 'v-0001' }))
    expect([res.status, await res.json()]).toEqual([409, { code: 'NO_ROOM', error: "This page can't be placed there now. Nothing was changed." }])
    expect(commits(w.repo)).toBe(before)
    expect(['p-0000000000h1', 'p-0000000000h2'].map(id => w.store.record('pages', id))).toEqual(kept)
  })

  it('deleting a held private page is refused 409 MOVE_HELD; once the row goes, it deletes', async () => {
    const w = await world({})
    await privatePage(w.store, 'p-0000000000e1', 'Payroll plan', null, 1000)
    await held(w.store, 'p-0000000000e1')
    const kept = w.store.record('pages', 'p-0000000000e1')
    const res = await w.app.request('/api/pages/p-0000000000e1', { method: 'DELETE' })
    expect([res.status, await res.json()]).toEqual([409, refusal])
    expect(w.store.record('pages', 'p-0000000000e1')).toEqual(kept)
    await w.store.tx(t => t.deletePending(PROPOSAL))
    expect((await w.app.request('/api/pages/p-0000000000e1', { method: 'DELETE' })).status).toBe(200)
    expect(w.store.record('pages', 'p-0000000000e1')).toBeNull()
  })
})
