// The walk's I4 (review G5): a page's editor starts from the member's own staged edit, never from the trunk under it, so a
// next edit never stages the page whole from the trunk and drops what the tray held. GET /api/pages/:id and a session's
// open lay the actor's own staged file op over the trunk (its text; the op keeps its base); another member reads the
// trunk. The backstop: a session's save merges three ways against the text the tray holds when the editor started from
// something else (`mergeFileOp`'s `from`), so an incoming text never silently replaces a pending one; where both change
// the same lines it is refused and the tray keeps its text. Fresh temporary repositories and stores only; placeholders.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { Membership } from '../../server/session/membership.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { ChangeStore } from '../../server/changes/store.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { joinPage, splitPage } from '../../lib/workspace/pages.mjs'
import { workspaceOf } from '../../server/workspace/routes.ts'
import type { EditSessions } from '../../server/workspace/sessions.ts'
import { blobId, mergeFileOp, overPending, PENDING_CONFLICT } from '../../server/workspace/files.ts'
import type { FileOp } from '../../server/changes/types.ts'
import type { WearerReading, WearersReading } from '../../server/systems/hats.ts'

const CELO = 'eip155:42220'
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`

/** The handbook's tree raised: any member proposes a page in it, steward-a approves. */
const RAISED = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    ops: { hat: "${OPS}" }
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: handbook, applies_to: ["workspace:tree-handbook-3f2a"], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["steward-a@example.test"], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person, handles: { git: ["steward-b@example.test"] } }
`

const BODY = 'How the org works.\n\nWho decides what.\n'
const OPEN = 'How the org works. Decisions are made in the open.\n\nWho decides what.\n'
const BOTH = 'How the org works. Decisions are made in the open. Minutes are public.\n\nWho decides what.\n'
const PATH = 'pages/handbook-3f2a.md'

const cleanup: string[] = []
const stores: PrivateStore[] = []
const live: EditSessions[] = []
afterEach(() => {
  for (const s of live.splice(0)) s.dispose()
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface World { repo: string; app: Hono; tick: () => void }
async function world(): Promise<World> {
  const repo = makeChangeRepo(RAISED)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  mkdirSync(join(repo, 'pages'), { recursive: true })
  writeFileSync(join(repo, PATH), joinPage({ id: 'handbook-3f2a', title: 'Handbook', parent: null, order: 1000 }, BODY))
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, two members, the handbook"')
  const dir = mkdtempSync(join(tmpdir(), 'sessions-tray-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  let at = Math.floor(Date.now() / 1000) * 1000 - 600_000
  const now = () => new Date(at)
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, block: 100, readAt: now().toISOString(),
    hats: account.toLowerCase().endsWith('a1') ? [OPS] : [] })
  const listing = (hat: string, wearers: string[]): WearersReading =>
    ({ ok: true, system: 'hats-main', hat, wearers, holders: wearers, complete: true, block: 100, readAt: now().toISOString() })
  const reader = {
    wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)),
    wearers: vi.fn(async (_s: Record<string, unknown>, hat: string) => listing(hat, hat === OPS ? [A1] : [])),
  }
  const membership = new Membership({ repo, reader: reader as never, now })
  const app = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now, privateStore: ctx.privateStore }),
    { request: withRequest({ repo, hosted: false, membership, store, now }), privateStore: () => store })
  const writers = workspaceOf(app)
  if (writers) live.push(writers.sessions)
  return { repo, app, tick: () => { at += 60_000 } }
}

const as = (w: World, who: 'steward-a' | 'steward-b') => git(w.repo, `config user.email ${who}@example.test`)
const json = (method: string, body?: unknown) => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), headers: { 'content-type': 'application/json' } })
async function call(app: Hono, path: string, init?: RequestInit): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await app.request(path, init)
  const text = await res.text()
  return { status: res.status, body: text === '' ? null : JSON.parse(text) }
}
const trayText = (w: World, who: string): string | null => {
  const op = new ChangeStore(w.repo).load(who)?.ops.find(o => o.op === 'file' && o.path === PATH) as FileOp | undefined
  return op ? (op.text === null ? null : splitPage(op.text).body) : null
}
async function openAndSave(w: World, markdown: string): Promise<{ sid: string; opened: string }> {
  const open = await call(w.app, '/api/pages/handbook-3f2a/sessions', json('POST'))
  expect(open.status, JSON.stringify(open.body)).toBe(200)
  const sid = String(open.body.session)
  const saved = await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown }))
  expect(saved, JSON.stringify(saved.body)).toMatchObject({ status: 200, body: { save: 'staged' } })
  return { sid, opened: String(open.body.markdown) }
}

/** steward-b stages "Decisions are made in the open." and proposes it; then Revise loads it back into the tray. */
async function proposedThenRevising(w: World): Promise<string> {
  as(w, 'steward-b')
  const first = await openAndSave(w, OPEN)
  expect((await call(w.app, `/api/sessions/${first.sid}/close`, json('POST'))).status).toBe(200)
  w.tick()
  const proposed = await call(w.app, '/api/proposals', json('POST', { title: 'Open decisions in the handbook' }))
  expect(proposed.status, JSON.stringify(proposed.body)).toBe(201)
  const id = String(proposed.body.id)
  expect(new ChangeStore(w.repo).load('steward-b')).toBeNull()
  w.tick()
  const loaded = await call(w.app, `/api/proposals/${id}/load`, json('POST', {}))
  expect(loaded.status, JSON.stringify(loaded.body)).toBe(200)
  expect(trayText(w, 'steward-b')).toBe(OPEN)
  return id
}

describe('the page editor starts from your staged edit (walk I4, review G5)', () => {
  it('the handbook: Propose, Revise, edit and ratify keeps "Decisions are made in the open."', async () => {
    const w = await world()
    const id = await proposedThenRevising(w)
    // The page, read by its author, is the tray's text; the other member reads the trunk.
    const read = await call(w.app, '/api/pages/handbook-3f2a')
    expect(read.status).toBe(200)
    expect(read.body.page.markdown).toBe(OPEN)
    as(w, 'steward-a')
    expect((await call(w.app, '/api/pages/handbook-3f2a')).body.page.markdown).toBe(BODY)
    as(w, 'steward-b')
    // The editor opens on the staged text, and the next edit stages it with the new sentence.
    const { sid, opened } = await openAndSave(w, BOTH)
    expect(opened).toBe(OPEN)
    expect(trayText(w, 'steward-b')).toBe(BOTH)
    const op = new ChangeStore(w.repo).load('steward-b')!.ops[0] as FileOp
    expect(op.base).toBe(git(w.repo, `rev-parse HEAD:${PATH}`).trim())
    expect((await call(w.app, `/api/sessions/${sid}/close`, json('POST'))).status).toBe(200)
    // Update proposal sends the tray's ops; the maintainer approves and ratifies.
    w.tick()
    const ops = new ChangeStore(w.repo).load('steward-b')!.ops
    const revised = await call(w.app, `/api/proposals/${id}/revise`, json('POST', { ops }))
    expect(revised.status, JSON.stringify(revised.body)).toBe(200)
    as(w, 'steward-a')
    w.tick()
    expect((await call(w.app, `/api/proposals/${id}/events`, json('POST', { kind: 'approve' }))).status).toBe(200)
    w.tick()
    const ratified = await call(w.app, `/api/proposals/${id}/ratify`, json('POST', {}))
    expect(ratified.status, JSON.stringify(ratified.body)).toBe(200)
    const body = splitPage(readFileSync(join(w.repo, PATH), 'utf8')).body
    expect(body).toBe(BOTH)
    expect(body).toContain('Decisions are made in the open.')
  })

  it('a preview (?as) reads the trunk, not your tray', async () => {
    const w = await world()
    await proposedThenRevising(w)
    expect((await call(w.app, '/api/pages/handbook-3f2a?as=members')).body.page.markdown).toBe(BODY)
  })

  it('backstop: an editor opened on the trunk before Revise merges its edit over the tray\'s text', async () => {
    const w = await world()
    as(w, 'steward-b')
    const first = await openAndSave(w, OPEN)
    expect((await call(w.app, `/api/sessions/${first.sid}/close`, json('POST'))).status).toBe(200)
    w.tick()
    const id = String((await call(w.app, '/api/proposals', json('POST', { title: 'Open decisions' }))).body.id)
    // A tab opens the page while the tray is empty: its editor holds the trunk.
    const open = await call(w.app, '/api/pages/handbook-3f2a/sessions', json('POST'))
    expect(open.body.markdown).toBe(BODY)
    w.tick()
    expect((await call(w.app, `/api/proposals/${id}/load`, json('POST', {}))).status).toBe(200)
    // An edit of another line: merged with the tray's text, which keeps its sentence.
    const saved = await call(w.app, `/api/sessions/${open.body.session}`, json('PUT', { markdown: BODY.replace('Who decides what.', 'Who decides what, and how.') }))
    expect(saved, JSON.stringify(saved.body)).toMatchObject({ status: 200, body: { save: 'staged' } })
    expect(trayText(w, 'steward-b')).toBe(OPEN.replace('Who decides what.', 'Who decides what, and how.'))
  })

  it('backstop: an edit of the same line as the tray\'s is refused, and the tray keeps its text', async () => {
    const w = await world()
    as(w, 'steward-b')
    const first = await openAndSave(w, OPEN)
    expect((await call(w.app, `/api/sessions/${first.sid}/close`, json('POST'))).status).toBe(200)
    w.tick()
    const id = String((await call(w.app, '/api/proposals', json('POST', { title: 'Open decisions' }))).body.id)
    const open = await call(w.app, '/api/pages/handbook-3f2a/sessions', json('POST'))
    w.tick()
    expect((await call(w.app, `/api/proposals/${id}/load`, json('POST', {}))).status).toBe(200)
    const saved = await call(w.app, `/api/sessions/${open.body.session}`, json('PUT', { markdown: BODY.replace('works.', 'works. Minutes are public.') }))
    expect(saved.status).toBe(422)
    expect(saved.body.errors).toEqual([{ record: PATH, field: '', message: PENDING_CONFLICT(PATH) }])
    expect(trayText(w, 'steward-b')).toBe(OPEN)
  })
})

describe('overPending and mergeFileOp against the pending text (G5 backstop)', () => {
  it('replaces the pending text when the incoming one started from it, merges three ways when it did not, refuses the same lines', async () => {
    const w = await world()
    const trunk = readFileSync(join(w.repo, PATH), 'utf8')
    const base = blobId(trunk)
    const pending: FileOp = { op: 'file', path: PATH, text: trunk.replace('works.', 'works. Decisions are made in the open.'), base }
    const edited = pending.text!.replace('what.', 'what, and how.')
    // Started from the pending text: replaced.
    const same = await overPending(w.repo, [pending], { op: 'file', path: PATH, text: edited, base }, pending.text!)
    expect((mergeFileOp([pending], same.op, w.repo, same.from)[0] as FileOp).text).toBe(edited)
    // Started from the trunk: merged over the pending text, on the pending op's base.
    const over = await overPending(w.repo, [pending], { op: 'file', path: PATH, text: trunk.replace('what.', 'what, and how.'), base }, trunk)
    expect(over.from).toBe(pending.text)
    const folded = mergeFileOp([pending], over.op, w.repo, over.from)[0] as FileOp
    expect(folded).toEqual({ op: 'file', path: PATH, text: edited, base })
    // The same line: refused, in words.
    await expect(overPending(w.repo, [pending], { op: 'file', path: PATH, text: trunk.replace('works.', 'works. Minutes.'), base }, trunk))
      .rejects.toThrow(PENDING_CONFLICT(PATH))
    // mergeFileOp never replaces a pending text the incoming one did not start from.
    expect(() => mergeFileOp([pending], { op: 'file', path: PATH, text: trunk, base }, w.repo, trunk)).toThrow(PENDING_CONFLICT(PATH))
  })
})
