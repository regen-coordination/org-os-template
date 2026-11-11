// DAO-OS L6 Task 20 review (C1, I1): a page's file op staged in a tray across a narrowing out of the repository, and Keep
// mine on a stale file op. A narrowing is refused while any member's change stages an edit of the tree it takes out
// (409 STAGED); a file op that would write a page the private store keeps is refused at stage, at apply, at propose and at
// ratify, so a stale op never makes the page again in git; Keep mine on a file op whose file is gone is refused; Keep mine
// on a file op whose file moved is a three-way merge, refused on conflict. Fresh temporary repositories and stores only;
// placeholders only; no network.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountVisibility } from '../../server/visibility/routes.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { withRequest } from '../../server/request.ts'
import { Membership } from '../../server/session/membership.ts'
import { ChangeStore } from '../../server/changes/store.ts'
import { STAGED_UNREADABLE } from '../../server/visibility/narrow.ts'
import { blobId } from '../../server/workspace/files.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { joinPage, splitPage } from '../../lib/workspace/pages.mjs'
import type { WearerReading } from '../../server/systems/hats.ts'

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`
const SECRET = 'Signer seed phrase notes: SECRET-FOR-OPS-ONLY.'

const SOLO = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
  decisions: []
`
/** The tree plans-0001 raised to a rule a maintainer decides by approval; anyone proposes. */
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
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person, handles: { git: ["steward-b@example.test"] } }
`
const page = (id: string, title: string, parent: string | null, extra: Record<string, unknown> = {}, body = `Body of ${title}.\n`) =>
  joinPage({ id, title, parent, order: 1000, ...extra }, body)

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface World { repo: string; store: PrivateStore; app: Hono; tick(ms: number): void }
async function world(pages: Record<string, string>, governance = SOLO): Promise<World> {
  const repo = makeChangeRepo(governance)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  mkdirSync(join(repo, 'pages'), { recursive: true })
  for (const [id, text] of Object.entries(pages)) writeFileSync(join(repo, 'pages', `${id}.md`), text)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree and the pages"')
  const dir = mkdtempSync(join(tmpdir(), 'pages-staged-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  let at = Math.floor(Date.now() / 1000) * 1000 - 600_000
  const now = () => new Date(at)
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, block: 100, readAt: now().toISOString(),
    hats: account.toLowerCase().endsWith('a1') ? [OPS] : [] })
  const reader = { wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)), wearers: vi.fn() }
  const membership = new Membership({ repo, reader: reader as never, now })
  const app = createApp(repo, (a, ctx) => {
    mountVisibility(a, { repo, membership, withLock: ctx.withLock, privateStore: ctx.privateStore })
    mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now, privateStore: ctx.privateStore })
  }, { request: withRequest({ repo, hosted: false, membership, store, now }), privateStore: () => store })
  return { repo, store, app, tick: ms => { at += ms } }
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const commits = (repo: string) => Number(git(repo, 'rev-list --count HEAD').trim())
const narrowPage = (w: World, id: string) => w.app.request('/api/visibility/narrow', json('POST', { target: { page: id }, level: `hat:${OPS}` }))
const stage = (w: World, ops: unknown[]) => w.app.request('/api/changes/ops', json('POST', { ops }))
/** Whether any object git holds (reachable or not) holds `text`. */
const anyObjectHolds = (repo: string, text: string) =>
  spawnSync('git', ['cat-file', '--batch-all-objects', '--batch'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout.includes(text)
/** The page's file as a widening writes it: `visibility: public` in its front matter, `body` after. */
const widened = (text: string, body: string) => joinPage({ ...splitPage(text).front, visibility: 'public' } as never, body, text)

describe('a narrowing out of the repository while a tray stages an edit of the tree (C1)', () => {
  it('is refused 409 STAGED while your changes stage an edit of the page; nothing is changed', async () => {
    const w = await world({ 'plans-0001': page('plans-0001', 'Plans', null) })
    const text = readFileSync(join(w.repo, 'pages', 'plans-0001.md'), 'utf8')
    expect((await stage(w, [{ op: 'file', path: 'pages/plans-0001.md', text: widened(text, `${SECRET}\n`) }])).status).toBe(200)
    const before = commits(w.repo)
    const res = await narrowPage(w, 'plans-0001')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'STAGED', error: 'Your changes stage an edit of this page: apply or discard it first. Nothing was changed.' })
    expect(commits(w.repo)).toBe(before)
    expect(existsSync(join(w.repo, 'pages', 'plans-0001.md'))).toBe(true)
    expect(w.store.record('pages', 'plans-0001')).toBeNull()
  })

  it('names your staged subpage by its title', async () => {
    const w = await world({ 'plans-0001': page('plans-0001', 'Plans', null), 'q1-0001': page('q1-0001', 'Q1 plan', 'plans-0001') })
    const text = readFileSync(join(w.repo, 'pages', 'q1-0001.md'), 'utf8')
    expect((await stage(w, [{ op: 'file', path: 'pages/q1-0001.md', text: text.replace('Body of', 'Edited body of') }])).status).toBe(200)
    const res = await narrowPage(w, 'plans-0001')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'STAGED', error: 'Your changes stage an edit of Q1 plan, a subpage of this page: apply or discard it first. Nothing was changed.' })
  })

  it("is refused while another member's change stages an edit of a subpage, in a sentence that names nobody", async () => {
    const w = await world({ 'plans-0001': page('plans-0001', 'Plans', null), 'q1-0001': page('q1-0001', 'Q1 plan', 'plans-0001') })
    const text = readFileSync(join(w.repo, 'pages', 'q1-0001.md'), 'utf8')
    const at = new Date().toISOString()
    new ChangeStore(w.repo).save({ id: 'chg_other', actor: 'steward-b', created: at, updated: at,
      ops: [{ op: 'file', path: 'pages/q1-0001.md', text: text.replace('Body of', 'Edited body of'), base: blobId(text) }] })
    const before = commits(w.repo)
    const res = await narrowPage(w, 'plans-0001')
    expect(res.status).toBe(409)
    const body = await res.json() as { code: string; error: string }
    expect(body).toEqual({ code: 'STAGED', error: "A member's changes stage an edit of this page or of a subpage of it, so it cannot leave the repository until that edit is applied or discarded. Nothing was changed." })
    expect(JSON.stringify(body)).not.toMatch(/steward-b|Steward B|Q1 plan/)
    expect(commits(w.repo)).toBe(before)
  })

  // L6 carries K4: a change file that cannot be read may stage an edit of the tree, so the check fails closed.
  it('is refused 409 STAGED while a change file cannot be read, in a sentence that names nobody; the file is left as it was', async () => {
    const w = await world({ 'plans-0001': page('plans-0001', 'Plans', null) })
    const file = new ChangeStore(w.repo).file('steward-b')
    mkdirSync(join(file, '..'), { recursive: true })
    for (const broken of ['{ "id": "chg_other", "actor": "steward-b", "ops": [', '{ "id": "chg_other", "actor": "steward-b" }']) {
      writeFileSync(file, broken)
      const before = commits(w.repo)
      const res = await narrowPage(w, 'plans-0001')
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ code: 'STAGED', error: STAGED_UNREADABLE })
      expect(readFileSync(file, 'utf8')).toBe(broken)
      expect(commits(w.repo)).toBe(before)
      expect(w.store.record('pages', 'plans-0001')).toBeNull()
    }
    expect(STAGED_UNREADABLE).toBe("A member's changes cannot be read, so whether they stage an edit of this page is not known, and it cannot leave the "
      + 'repository until they can be. Nothing was changed.')
  })

  it('narrowed first, a file op on the page is refused at stage: nothing staged, the sentinel in no object', async () => {
    const w = await world({ 'plans-0001': page('plans-0001', 'Plans', null) })
    const text = readFileSync(join(w.repo, 'pages', 'plans-0001.md'), 'utf8')
    expect((await narrowPage(w, 'plans-0001')).status).toBe(200)
    for (const base of [blobId(text), null]) {
      const res = await stage(w, [{ op: 'file', path: 'pages/plans-0001.md', text: widened(text, `${SECRET}\n`), base }])
      expect(res.status).toBe(422)
      expect((await res.json()).errors).toEqual([{ record: 'pages/plans-0001.md', field: '', message: 'There is no page plans-0001 in the repository for this edit to write: discard it. Nothing was staged.' }])
    }
    expect((await (await w.app.request('/api/changes')).json()).ops).toEqual([])
    expect(existsSync(join(w.repo, 'pages', 'plans-0001.md'))).toBe(false)
    expect(anyObjectHolds(w.repo, SECRET)).toBe(false)
  })

  it('an op left in a tray across the narrowing: Keep mine is refused (the file is gone), and a page the store keeps is never made again by Apply', async () => {
    const w = await world({ 'plans-0001': page('plans-0001', 'Plans', null) })
    const text = readFileSync(join(w.repo, 'pages', 'plans-0001.md'), 'utf8')
    expect((await narrowPage(w, 'plans-0001')).status).toBe(200)
    const at = new Date().toISOString()
    const tray = (base: string | null) => new ChangeStore(w.repo).save({ id: 'chg_mine', actor: 'steward-a', created: at, updated: at,
      ops: [{ op: 'file', path: 'pages/plans-0001.md', text: widened(text, `${SECRET}\n`), base }] })
    // as staged before the page left: stale, and Keep mine cannot keep it over a file that is gone
    tray(blobId(text))
    expect((await (await w.app.request('/api/changes')).json()).stale).toEqual([0])
    const kept = await w.app.request('/api/changes/ops/0/rebase', json('POST', { keep: 'mine' }))
    expect(kept.status).toBe(409)
    expect(await kept.json()).toMatchObject({ code: 'GONE', error: 'pages/plans-0001.md is no longer in the repository, so your edit cannot be kept over it: take theirs. Nothing was changed.' })
    // Apply refuses it before anything else (the store keeps the page), stale as it is
    expect((await w.app.request('/api/changes/apply', json('POST', {}))).status).toBe(422)
    // as a create of a page the store keeps: refused at apply, before anything is written
    tray(null)
    const before = commits(w.repo)
    const applied = await w.app.request('/api/changes/apply', json('POST', {}))
    expect(applied.status).toBe(422)
    expect((await applied.json()).errors).toEqual([{ record: 'pages/plans-0001.md', field: '', message: 'There is no page plans-0001 in the repository for this edit to write: discard it. Nothing was written.' }])
    expect(commits(w.repo)).toBe(before)
    expect(existsSync(join(w.repo, 'pages', 'plans-0001.md'))).toBe(false)
    expect(w.store.record('pages', 'plans-0001')).toMatchObject({ visibility: `hat:${OPS}` })
    expect(anyObjectHolds(w.repo, SECRET)).toBe(false)
  })

  it('a proposal whose file op would write a page the store keeps is not ratified, and nothing is written', async () => {
    const w = await world({ 'plans-0001': page('plans-0001', 'Plans', null) }, RAISED)
    git(w.repo, 'config user.email steward-b@example.test')
    const sub = page('notes-0001', 'Notes', 'plans-0001')
    expect((await stage(w, [{ op: 'file', path: 'pages/notes-0001.md', text: sub, base: null }])).status).toBe(200)
    const proposed = await w.app.request('/api/proposals', json('POST', { title: 'Add the notes' }))
    expect(proposed.status, await proposed.clone().text()).toBe(201)
    const id = String(((await proposed.json()) as { id: string }).id)
    // meanwhile a private page with that id is kept in the store
    await w.store.putRecord({ collection: 'pages', id: 'notes-0001', visibility: `hat:${OPS}`,
      body: { title: 'Notes', parent: null, order: 1000, markdown: `${SECRET}\n` }, rev: '' }, 'steward-a', null)
    git(w.repo, 'config user.email admin-test@local'); w.tick(60_000)
    expect((await w.app.request(`/api/proposals/${id}/events`, json('POST', { kind: 'approve' }))).status).toBe(200)
    w.tick(60_000)
    const before = commits(w.repo)
    const res = await w.app.request(`/api/proposals/${id}/ratify`, json('POST', {}))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'NO_PAGE', error: `Not ratified: there is no page notes-0001 in the repository for proposal ${id} to write. Nothing was written.` })
    expect(commits(w.repo)).toBe(before)
    expect(existsSync(join(w.repo, 'pages', 'notes-0001.md'))).toBe(false)
    expect(anyObjectHolds(w.repo, SECRET)).toBe(false)
  })
})

describe('Keep mine on a stale file op is a three-way merge (I1)', () => {
  it('a line the member typed survives a widening staged over the file as it was, after the session committed it', async () => {
    const w = await world({ 'plans-0001': page('plans-0001', 'Plans', null) })
    const text = readFileSync(join(w.repo, 'pages', 'plans-0001.md'), 'utf8')
    // the widening, built over the file as served
    expect((await stage(w, [{ op: 'file', path: 'pages/plans-0001.md', text: widened(text, splitPage(text).body), base: blobId(text) }])).status).toBe(200)
    // the member's session commits a typed line (as its end does)
    writeFileSync(join(w.repo, 'pages', 'plans-0001.md'), text.replace('Body of Plans.\n', 'Body of Plans.\nA LINE THE MEMBER TYPED.\n'))
    git(w.repo, 'commit -qam "page: Plans"')
    expect((await (await w.app.request('/api/changes')).json()).stale).toEqual([0])
    const kept = await w.app.request('/api/changes/ops/0/rebase', json('POST', { keep: 'mine' }))
    expect(kept.status, await kept.clone().text()).toBe(200)
    const op = ((await kept.json()) as { ops: { text: string }[] }).ops[0]!
    expect(splitPage(op.text).front.visibility).toBe('public')
    expect(splitPage(op.text).body).toContain('A LINE THE MEMBER TYPED.')
  })

  it('refused 409 CONFLICT when both change the same lines; the op is left as it was', async () => {
    const w = await world({ 'plans-0001': page('plans-0001', 'Plans', null) })
    const text = readFileSync(join(w.repo, 'pages', 'plans-0001.md'), 'utf8')
    const mine = text.replace('Body of Plans.', 'My body of Plans.')
    expect((await stage(w, [{ op: 'file', path: 'pages/plans-0001.md', text: mine, base: blobId(text) }])).status).toBe(200)
    writeFileSync(join(w.repo, 'pages', 'plans-0001.md'), text.replace('Body of Plans.', 'Their body of Plans.'))
    git(w.repo, 'commit -qam "page: Plans"')
    const kept = await w.app.request('/api/changes/ops/0/rebase', json('POST', { keep: 'mine' }))
    expect(kept.status).toBe(409)
    expect(await kept.json()).toMatchObject({ code: 'CONFLICT',
      error: 'pages/plans-0001.md changed since you staged your edit, and both change the same lines: take theirs and make your edit again over it. Nothing was changed.' })
    expect((await (await w.app.request('/api/changes')).json()).ops).toEqual([{ op: 'file', path: 'pages/plans-0001.md', text: mine, base: blobId(text) }])
  })
})

describe('a widening says what it exposes (I2)', () => {
  const PUBLISHING = SOLO.replace('  decisions: []\n', `    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: publishing, applies_to: [publication], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`).replace('model: "solo-maintainer"', 'model: "consensus"')
  const tree = {
    'handbook-1a2b': page('handbook-1a2b', 'Handbook', null),
    'treasury-3c4d': page('treasury-3c4d', 'Treasury', 'handbook-1a2b'),
    'safe-9a9a': page('safe-9a9a', 'The Safe', 'treasury-3c4d'),
    'keys-1b1b': page('keys-1b1b', 'Keys', 'safe-9a9a'),
    'welcome-5e5e': page('welcome-5e5e', 'Welcome', 'handbook-1a2b'),
    // its own level: it stays members when the handbook is public, and so does its subpage
    'staff-7f7f': page('staff-7f7f', 'Staff', 'handbook-1a2b', { visibility: 'members' }),
    'rota-8a8a': page('rota-8a8a', 'Rota', 'staff-7f7f'),
  }

  it("a git page's read counts the subpages that take its level, which a widening makes public with it", async () => {
    const w = await world(tree)
    const read = await (await w.app.request('/api/pages/handbook-1a2b')).json() as { page: { widens?: number } }
    expect(read.page.widens).toBe(4)
    const staff = await (await w.app.request('/api/pages/staff-7f7f')).json() as { page: { widens?: number } }
    expect(staff.page.widens).toBe(1)
  })

  it("the proposal of a page's widening counts them beside its Compare", async () => {
    const w = await world(tree, PUBLISHING)
    const text = readFileSync(join(w.repo, 'pages', 'handbook-1a2b.md'), 'utf8')
    expect((await stage(w, [{ op: 'file', path: 'pages/handbook-1a2b.md', text: widened(text, splitPage(text).body) }])).status).toBe(200)
    const proposed = await w.app.request('/api/proposals', json('POST', { title: 'Publish the handbook' }))
    expect(proposed.status, await proposed.clone().text()).toBe(201)
    const id = String(((await proposed.json()) as { id: string }).id)
    const detail = await (await w.app.request(`/api/proposals/${id}`)).json() as { compare?: ({ widens?: number } | null)[] }
    expect(detail.compare?.[0]).toMatchObject({ widens: 4 })
  })
})
