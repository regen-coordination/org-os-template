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
import { readLedger } from '../../server/proposals/ledger.ts'
import { joinPage, splitPage } from '../../lib/workspace/pages.mjs'
import { workspaceOf } from '../../server/workspace/routes.ts'
import { EditSessions, NO_SESSION, SUGGEST_NOTHING, SUGGEST_PRIVATE, suggestTitle } from '../../server/workspace/sessions.ts'
import { NO_SUGGEST_DECIDERS, ONLY_AUTHOR_DECIDES, SUGGEST_WEARERS_PARTIAL, SUGGEST_WEARERS_UNREAD, WORKSPACE_SUGGEST } from '../../lib/rules.mjs'
import { parseTrailers } from '../../lib/trailers.mjs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { WearerReading, WearersReading } from '../../server/systems/hats.ts'
import type { KnownActor } from '../../server/actor.ts'

// DAO-OS L6, Task 16b (ruling R-L6-SUGGEST): Suggest turns a page's editing session into a proposal through the proposal
// machinery Propose uses (server/proposals/propose.ts): the session's text is staged as the page's file op, that one op is
// proposed (the rest of the tray stays), and the session ends. Deciders see it with the proposal's Compare (its diff) and
// approve or decline it under the org's rules. Every test builds a fresh temporary repository (makeChangeRepo) and keeps
// its store in a folder of its own. git's identity says who asks: steward-b may only propose in the handbook's tree, and
// steward-a decides there.

const CELO = 'eip155:42220'
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`

/** The handbook's tree raised: a page in it is proposed by any member and approved by steward-a. The rest of the
 *  workspace is direct. */
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

const BODY = 'First line.\n\nSecond line.\n\nThird line.\n'
const page = (id: string, title: string, body = BODY) => joinPage({ id, title, parent: null, order: 1000 }, body)
const STEWARD_A: KnownActor = { id: 'steward-a', name: 'Steward A', kind: 'person', via: 'git' }
const member = { kind: 'member' as const, id: 'steward-a', hats: [OPS], roles: [] as string[] }

const cleanup: string[] = []
const stores: PrivateStore[] = []
const live: EditSessions[] = []
afterEach(() => {
  for (const s of live.splice(0)) s.dispose()
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed by the test */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface World { repo: string; store: PrivateStore; app: Hono; tick: () => void; hats: { list: string[] | null; complete: boolean } }

async function world(governance = RAISED): Promise<World> {
  const repo = makeChangeRepo(governance)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  mkdirSync(join(repo, 'pages'), { recursive: true })
  writeFileSync(join(repo, 'pages', 'handbook-3f2a.md'), page('handbook-3f2a', 'Handbook'))
  writeFileSync(join(repo, 'pages', 'notes-0001.md'), page('notes-0001', 'Notes'))
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, two members, two pages"')
  const dir = mkdtempSync(join(tmpdir(), 'suggest-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  // The ledger's clock: a little before the wall clock, moved on a minute per act (as the file-op proposal test does).
  let at = Math.floor(Date.now() / 1000) * 1000 - 600_000
  const now = () => new Date(at)
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, block: 100, readAt: now().toISOString(),
    hats: account.toLowerCase().endsWith('a1') ? [OPS] : [] })
  // The tree's own wearer list, per hat: steward-a's wallet wears OPS (R-L6-SUGGEST-2 fix round 1, review S1); any other hat
  // nobody wears. `hats.list = null` is a read that failed; `hats.complete = false` a list not read whole (fix round 2).
  const hats: { list: string[] | null; complete: boolean } = { list: [A1], complete: true }
  const listing = (hat: string, wearers: string[]): WearersReading =>
    ({ ok: true, system: 'hats-main', hat, wearers, holders: wearers, complete: hats.complete, block: 100, readAt: now().toISOString() })
  const reader = {
    wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)),
    wearers: vi.fn(async (_s: Record<string, unknown>, hat: string) => hat !== OPS ? listing(hat, [])
      : hats.list === null ? { ok: false as const, failed: true as const, error: 'the tree could not be read' } : listing(hat, hats.list)),
  }
  const membership = new Membership({ repo, reader: reader as never, now })
  const app = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now, privateStore: ctx.privateStore }),
    { request: withRequest({ repo, hosted: false, membership, store, now }), privateStore: () => store })
  const writers = workspaceOf(app)
  if (writers) live.push(writers.sessions)
  return { repo, store, app, hats, tick: () => { at += 60_000 } }
}

const as = (w: World, who: 'steward-a' | 'steward-b') => git(w.repo, `config user.email ${who}@example.test`)
const json = (method: string, body?: unknown) => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), headers: { 'content-type': 'application/json' } })
async function call(app: Hono, path: string, init?: RequestInit): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await app.request(path, init)
  const text = await res.text()
  return { status: res.status, body: text === '' ? null : JSON.parse(text) }
}
const fileOf = (repo: string, id: string) => readFileSync(join(repo, 'pages', `${id}.md`), 'utf8')
const commits = (repo: string) => Number(git(repo, 'rev-list --count HEAD').trim())
const entries = (repo: string) => readLedger(repo).entries
const EDITED = BODY.replace('Second line.', 'Second line, suggested.')

/** steward-b opens the handbook, types, and suggests the edit: answers the suggestion's response. */
async function suggestEdit(w: World, note = 'Clearer wording.') {
  as(w, 'steward-b')
  const sid = (await call(w.app, '/api/pages/handbook-3f2a/sessions', json('POST'))).body.session as string
  expect(await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: BODY.replace('Second', 'Half-typed') }))).toEqual({ status: 200, body: { save: 'staged' } })
  w.tick()
  const res = await call(w.app, `/api/sessions/${sid}/suggest`, json('POST', { markdown: EDITED, proposal: { title: suggestTitle('Handbook'), rationale: note } }))
  return { sid, res }
}

describe('Suggest: a page editing session becomes a proposal (R-L6-SUGGEST)', () => {
  it('a suggestion lands as one proposal with the page change', async () => {
    const w = await world()
    const raisedBefore = commits(w.repo)
    const page0 = fileOf(w.repo, 'handbook-3f2a')

    const { sid, res } = await suggestEdit(w)
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body).toMatchObject({ title: 'Suggested edit to Handbook', author: 'steward-b', state: 'open' })
    const id = String(res.body.id)
    const ledger = entries(w.repo)
    expect(ledger).toHaveLength(1)
    const entry = ledger[0]!
    expect(entry).toMatchObject({ id, title: 'Suggested edit to Handbook', rationale: 'Clearer wording.', author: 'steward-b' })
    expect(entry.rules?.map(r => r.id)).toEqual(['handbook'])
    expect(entry.ops).toHaveLength(1)
    const op = entry.ops![0] as unknown as { op: string; path: string; text: string; base: string }
    expect(op).toMatchObject({ op: 'file', path: 'pages/handbook-3f2a.md', base: git(w.repo, 'rev-parse HEAD:pages/handbook-3f2a.md').trim() })
    expect(splitPage(op.text).body).toBe(EDITED)
    // Proposed, not applied: one commit (the ledger's), the page as it was, the tray without the page's op, the session over.
    expect(commits(w.repo)).toBe(raisedBefore + 1)
    expect(fileOf(w.repo, 'handbook-3f2a')).toBe(page0)
    expect(new ChangeStore(w.repo).load('steward-b')).toBeNull()
    expect((await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: 'Late.\n' }))).body).toEqual({ error: NO_SESSION(sid), code: 'NO_SESSION' })
    // Deciders see it with Compare: the proposal's diff holds the page's old line and the new one.
    as(w, 'steward-a')
    const shown = await call(w.app, `/api/proposals/${id}`)
    expect(shown.status).toBe(200)
    expect(shown.body.diff).toContain('-Second line.')
    expect(shown.body.diff).toContain('+Second line, suggested.')
    // and Compare, old next to new: the page's body at the proposal's base beside the body it proposes.
    expect(shown.body.compare).toEqual([{ was: BODY, now: EDITED }])
  })

  it('the rest of the tray stays when the page\'s edit is suggested', async () => {
    const w = await world()
    as(w, 'steward-b')
    // A record staged in the tray beside the page's edit (a raised page's create is staged too).
    expect((await call(w.app, '/api/pages', json('POST', { title: 'Second chapter', parent: 'handbook-3f2a' }))).body).toMatchObject({ staged: true })
    const before = new ChangeStore(w.repo).load('steward-b')!.ops
    expect(before).toHaveLength(1)
    const { res } = await suggestEdit(w)
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(entries(w.repo)[0]!.ops).toHaveLength(1)
    expect(new ChangeStore(w.repo).load('steward-b')!.ops).toEqual(before)
  })

  it('accepting it applies that page change', async () => {
    const w = await world()
    const { res } = await suggestEdit(w)
    const id = String(res.body.id)
    as(w, 'steward-a')
    w.tick()
    expect((await call(w.app, `/api/proposals/${id}/events`, json('POST', { kind: 'approve' }))).status).toBe(200)
    w.tick()
    const ratified = await call(w.app, `/api/proposals/${id}/ratify`, json('POST', {}))
    expect(ratified.status, JSON.stringify(ratified.body)).toBe(200)
    expect(splitPage(fileOf(w.repo, 'handbook-3f2a')).body).toBe(EDITED)
    expect(splitPage(fileOf(w.repo, 'handbook-3f2a')).front).toMatchObject({ id: 'handbook-3f2a', title: 'Handbook' })
  })

  it('declining it leaves the page as it was', async () => {
    const w = await world()
    const page0 = fileOf(w.repo, 'handbook-3f2a')
    const { res } = await suggestEdit(w)
    const id = String(res.body.id)
    // Under an approve rule a decider declines by objecting: the proposal is held, and ratify is refused.
    as(w, 'steward-a')
    w.tick()
    const objected = await call(w.app, `/api/proposals/${id}/events`, json('POST', { kind: 'object', text: 'Keep the old wording.' }))
    expect(objected.status, JSON.stringify(objected.body)).toBe(200)
    w.tick()
    expect((await call(w.app, `/api/proposals/${id}/ratify`, json('POST', {}))).status).toBe(409)
    expect(fileOf(w.repo, 'handbook-3f2a')).toBe(page0)
    // Its author then withdraws it: closed, and the page is as it was.
    as(w, 'steward-b')
    w.tick()
    const closed = await call(w.app, `/api/proposals/${id}/events`, json('POST', { kind: 'withdraw' }))
    expect(closed.status, JSON.stringify(closed.body)).toBe(200)
    expect(closed.body.state).toBe('withdrawn')
    expect(fileOf(w.repo, 'handbook-3f2a')).toBe(page0)
  })

  it('Suggest is never offered on a page the person cannot see: a session they may no longer read, or another member\'s, is the 404 and nothing is proposed', async () => {
    const w = await world()
    // A private page steward-a may read (they wear Ops), then no longer.
    as(w, 'steward-a')
    const created = await call(w.app, '/api/pages', json('POST', { title: 'Payroll plan', visibility: `hat:${OPS}`, markdown: 'Salaries.\n' }))
    const priv = created.body.id as string
    const s = workspaceOf(w.app)!.sessions
    const { session } = await s.open(STEWARD_A, member, priv)
    const propose = vi.fn(async () => ({ never: true }))
    await expect(s.suggest(session, STEWARD_A, { ...member, hats: [] }, { markdown: 'Mine.\n' }, propose)).rejects.toMatchObject({ status: 404 })
    expect(propose).not.toHaveBeenCalled()
    // Another member's session is the 404 of one that is not there.
    as(w, 'steward-b')
    const theirs = (await call(w.app, '/api/pages/handbook-3f2a/sessions', json('POST'))).body.session as string
    as(w, 'steward-a')
    const other = await call(w.app, `/api/sessions/${theirs}/suggest`, json('POST', { markdown: EDITED, proposal: { title: 'Suggested edit to Handbook' } }))
    expect(other).toEqual({ status: 404, body: { error: NO_SESSION(theirs), code: 'NO_SESSION' } })
    expect(entries(w.repo)).toHaveLength(0)
    expect(new ChangeStore(w.repo).load('steward-b')).toBeNull()
  })

  it('a private page\'s suggestion is refused in words: nothing staged, proposed, or written', async () => {
    const w = await world()
    as(w, 'steward-a')
    const priv = (await call(w.app, '/api/pages', json('POST', { title: 'Payroll plan', visibility: `hat:${OPS}`, markdown: 'Salaries.\n' }))).body.id as string
    const before = commits(w.repo)
    const sid = (await call(w.app, `/api/pages/${priv}/sessions`, json('POST'))).body.session as string
    const res = await call(w.app, `/api/sessions/${sid}/suggest`, json('POST', { markdown: 'Salaries, raised.\n', proposal: { title: 'Edit to Payroll plan' } }))
    expect(res).toEqual({ status: 409, body: { code: 'PRIVATE_PAGE', error: SUGGEST_PRIVATE } })
    expect(commits(w.repo)).toBe(before)
    expect(entries(w.repo)).toHaveLength(0)
    expect(w.store.record('pages', priv)?.body.markdown).toBe('Salaries.\n')
    expect(w.store.draft(sid)).toBeNull()
  })

  it('a person who may only suggest is offered Suggest and no direct save; one who saves directly may save or suggest', async () => {
    const w = await world()
    as(w, 'steward-b')
    expect((await call(w.app, '/api/pages/handbook-3f2a')).body.write.mode).toBe('approval')
    expect((await call(w.app, '/api/pages/notes-0001')).body.write.mode).toBe('direct')
  })

  it('an edit that changes nothing is not suggested', async () => {
    const w = await world()
    as(w, 'steward-b')
    const sid = (await call(w.app, '/api/pages/handbook-3f2a/sessions', json('POST'))).body.session as string
    const res = await call(w.app, `/api/sessions/${sid}/suggest`, json('POST', { markdown: BODY, proposal: { title: 'Suggested edit to Handbook' } }))
    expect(res).toEqual({ status: 409, body: { code: 'NOTHING', error: SUGGEST_NOTHING } })
    expect(entries(w.repo)).toHaveLength(0)
    expect(new ChangeStore(w.repo).load('steward-b')).toBeNull()
  })

  it('the body is checked: the page\'s text, and the proposal\'s title', async () => {
    const w = await world()
    as(w, 'steward-b')
    const sid = (await call(w.app, '/api/pages/handbook-3f2a/sessions', json('POST'))).body.session as string
    expect((await call(w.app, `/api/sessions/${sid}/suggest`, json('POST', { proposal: { title: 'x' } }))).status).toBe(400)
    expect((await call(w.app, `/api/sessions/${sid}/suggest`, json('POST', { markdown: EDITED }))).status).toBe(400)
    expect(entries(w.repo)).toHaveLength(0)
  })
})

// DAO-OS L6, Task 16c (ruling R-L6-SUGGEST-2, the operator: "Everywhere, maintainers decide"): Suggest is offered on every
// page its viewer may edit, to a member who saves it directly too. Where the page's rule is workspace/direct, the
// suggestion is decided under the built-in rule workspace/suggest: one approval from a member of the org's maintainer role
// other than its author, then Ratify. Plain Propose of a change its author may apply alone is still 409 DIRECT.
describe('Suggest everywhere: maintainers decide (R-L6-SUGGEST-2)', () => {
  const NOTES_EDITED = BODY.replace('Third line.', 'Third line, suggested.')
  const VALIDATOR = fileURLToPath(new URL('../../../../scripts/validate-governance.mjs', import.meta.url))

  /** `who` opens Notes (a page they save directly), types (a direct save keeps a draft), and suggests the edit. */
  async function suggestNotes(w: World, who: 'steward-a' | 'steward-b' = 'steward-b') {
    as(w, who)
    const sid = (await call(w.app, '/api/pages/notes-0001/sessions', json('POST'))).body.session as string
    expect(await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: BODY.replace('Third', 'Half-typed') }))).toEqual({ status: 200, body: { save: 'direct' } })
    w.tick()
    const res = await call(w.app, `/api/sessions/${sid}/suggest`, json('POST', { markdown: NOTES_EDITED, proposal: { title: suggestTitle('Notes') } }))
    return { sid, res }
  }

  it('a member who saves the page directly suggests it: one proposal, marked a suggestion, and the page does not change', async () => {
    const w = await world()
    const before = commits(w.repo)
    const page0 = fileOf(w.repo, 'notes-0001')
    const { sid, res } = await suggestNotes(w)
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body).toMatchObject({ title: 'Suggested edit to Notes', author: 'steward-b', state: 'open' })
    const ledger = entries(w.repo)
    expect(ledger).toHaveLength(1)
    const entry = ledger[0]! as unknown as Record<string, unknown> & { rules: unknown[]; ops: { op: string; path: string; text: string }[] }
    expect(entry.suggested).toBe(true)
    expect(entry.rules).toEqual([JSON.parse(JSON.stringify(WORKSPACE_SUGGEST))])
    expect(entry.ops).toHaveLength(1)
    expect(entry.ops[0]).toMatchObject({ op: 'file', path: 'pages/notes-0001.md' })
    expect(splitPage(entry.ops[0]!.text).body).toBe(NOTES_EDITED)
    expect(parseTrailers(git(w.repo, 'log -1 --format=%B')).rule).toBe('workspace/suggest/approve')
    // One commit (the ledger's), the page as it was, nothing in the tray, the session over and its draft gone: nothing
    // is committed when the server stops.
    expect(commits(w.repo)).toBe(before + 1)
    expect(fileOf(w.repo, 'notes-0001')).toBe(page0)
    expect(new ChangeStore(w.repo).load('steward-b')).toBeNull()
    expect((await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: 'Late.\n' }))).body).toEqual({ error: NO_SESSION(sid), code: 'NO_SESSION' })
    await workspaceOf(w.app)!.sessions.flushAll()
    expect(commits(w.repo)).toBe(before + 1)
    expect(fileOf(w.repo, 'notes-0001')).toBe(page0)
  })

  it('its deciders are the maintainers: a maintainer approves and ratifies, and the page changes; validate:governance accepts the history', async () => {
    const w = await world()
    const { res } = await suggestNotes(w)
    const id = String(res.body.id)
    as(w, 'steward-a')
    const shown = await call(w.app, `/api/proposals/${id}`)
    expect(shown.body.rules[0].sentence).toContain('maintainer')
    expect(shown.body.rules[0].sentence).toContain('Steward A')
    expect(shown.body.needsYou).toBe(true)
    w.tick()
    expect((await call(w.app, `/api/proposals/${id}/events`, json('POST', { kind: 'approve' }))).status).toBe(200)
    w.tick()
    const ratified = await call(w.app, `/api/proposals/${id}/ratify`, json('POST', {}))
    expect(ratified.status, JSON.stringify(ratified.body)).toBe(200)
    expect(splitPage(fileOf(w.repo, 'notes-0001')).body).toBe(NOTES_EDITED)
    expect(parseTrailers(git(w.repo, 'log -1 --format=%B')).rule).toBe('workspace/suggest/approve')
    const r = spawnSync('node', [VALIDATOR, w.repo, '--strict'], { encoding: 'utf8', env: { ...process.env, CI: '' } })
    expect(r.stdout.split('\n').filter(l => l.includes(id)), r.stdout).toEqual([])
    expect(r.stdout).toMatch(/Results: /)
  })

  it('declining it leaves the page as it was', async () => {
    const w = await world()
    const page0 = fileOf(w.repo, 'notes-0001')
    const { res } = await suggestNotes(w)
    const id = String(res.body.id)
    as(w, 'steward-a')
    w.tick()
    expect((await call(w.app, `/api/proposals/${id}/events`, json('POST', { kind: 'object', text: 'Keep it.' }))).status).toBe(200)
    w.tick()
    expect((await call(w.app, `/api/proposals/${id}/ratify`, json('POST', {}))).status).toBe(409)
    expect(fileOf(w.repo, 'notes-0001')).toBe(page0)
  })

  it('its author cannot approve their own suggestion, even as a maintainer', async () => {
    const w = await world(RAISED.replace('maintainer: { members: [steward-a] }', 'maintainer: { members: [steward-a, steward-b] }'))
    const { res } = await suggestNotes(w)
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const id = String(res.body.id)
    w.tick()
    const approved = await call(w.app, `/api/proposals/${id}/events`, json('POST', { kind: 'approve' }))
    expect(approved.status).toBe(409)
    expect(String(approved.body.error)).toContain('cannot approve their own proposal')
    expect(entries(w.repo)[0]!.events).toEqual([])
  })

  it('an org that names no maintainer refuses Suggest in words, and nothing is proposed', async () => {
    const w = await world(RAISED.replace('    maintainer: { members: [steward-a] }\n', '    stewards: { members: [steward-a] }\n').replace('by: maintainer', 'by: stewards'))
    const before = commits(w.repo)
    const { sid, res } = await suggestNotes(w)
    expect(res).toEqual({ status: 409, body: { code: 'NO_DECIDERS', error: NO_SUGGEST_DECIDERS } })
    expect(commits(w.repo)).toBe(before)
    expect(entries(w.repo)).toHaveLength(0)
    // The session stays, with what was typed.
    expect((await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: NOTES_EDITED }))).body).toEqual({ save: 'direct' })
  })

  it('a suggestion its author alone would decide is refused in words', async () => {
    const w = await world()
    const { res } = await suggestNotes(w, 'steward-a')
    expect(res).toEqual({ status: 409, body: { code: 'NO_DECIDERS', error: ONLY_AUTHOR_DECIDES } })
    expect(entries(w.repo)).toHaveLength(0)
  })

  it('a maintainer role worn by a hat decides a suggestion its wearer did not make', async () => {
    const w = await world(RAISED.replace('maintainer: { members: [steward-a] }', `maintainer: { hat: "${OPS}" }`))
    const before = commits(w.repo)
    const { res } = await suggestNotes(w)
    // steward-b wears no hat: the maintainer role is worn by steward-a, whose wallet is the hat's wearer (the tree says so).
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body).toMatchObject({ author: 'steward-b', state: 'open', suggested: true })
    expect(entries(w.repo)).toHaveLength(1)
    expect(commits(w.repo)).toBe(before + 1)
  })

  // Fix round 2 (review I1, I2): the hat's wearer approves and ratifies; a member who wears no hat reads who decides it, never
  // "nobody"; and validate:governance, which holds no reading of the hat's wearers, does not call the suggestion undecidable.
  it('a maintainer hat\'s wearer approves and ratifies it, its rule never reads "nobody", and validate:governance accepts the history', async () => {
    const w = await world(RAISED.replace('maintainer: { members: [steward-a] }', `maintainer: { hat: "${OPS}" }`))
    const { res } = await suggestNotes(w)
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const id = String(res.body.id)
    const read = await call(w.app, `/api/proposals/${id}`)
    expect(read.body.rules[0].sentence).not.toContain('nobody')
    expect(read.body.rules[0].sentence).toContain('The maintainers decide: whoever wears the hat the maintainer role is sourced from')
    as(w, 'steward-a')
    w.tick()
    const approved = await call(w.app, `/api/proposals/${id}/events`, json('POST', { kind: 'approve' }))
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    w.tick()
    const ratified = await call(w.app, `/api/proposals/${id}/ratify`, json('POST', {}))
    expect(ratified.status, JSON.stringify(ratified.body)).toBe(200)
    expect(splitPage(fileOf(w.repo, 'notes-0001')).body).toBe(NOTES_EDITED)
    const r = spawnSync('node', [VALIDATOR, w.repo, '--strict'], { encoding: 'utf8', env: { ...process.env, CI: '' } })
    expect(r.stdout.split('\n').filter(l => l.includes(id)), r.stdout).toEqual([])
    expect(r.stdout).toMatch(/Results: /)
  })

  // Fix round 2 (review I3): a list not read whole (a chain with no explorer, a page left unread) says who wears the hat
  // only so far; with nobody else on it, who would decide is not known, so it is never "nobody" nor "only you".
  it.each([
    ['nobody', [] as string[], 'steward-b'],
    ['only the author', [A1], 'steward-a'],
  ] as const)('a maintainer hat whose wearer list was not read whole, showing %s, refuses as not known', async (_name, list, who) => {
    const w = await world(RAISED.replace('maintainer: { members: [steward-a] }', `maintainer: { hat: "${OPS}" }`))
    w.hats.list = [...list]
    w.hats.complete = false
    const { res } = await suggestNotes(w, who)
    expect(res).toEqual({ status: 502, body: { code: 'HATS_UNREADABLE', error: SUGGEST_WEARERS_PARTIAL } })
    expect(entries(w.repo)).toHaveLength(0)
  })

  it('a maintainer hat whose wearer list was not read whole, and names another wearer, takes the suggestion', async () => {
    const w = await world(RAISED.replace('maintainer: { members: [steward-a] }', `maintainer: { hat: "${OPS}" }`))
    w.hats.complete = false
    const { res } = await suggestNotes(w)
    expect(res.status, JSON.stringify(res.body)).toBe(201)
  })

  it('a maintainer hat whose wearers cannot be read refuses in words, and does not claim that nobody decides it', async () => {
    const w = await world(RAISED.replace('maintainer: { members: [steward-a] }', `maintainer: { hat: "${OPS}" }`))
    w.hats.list = null
    const { res } = await suggestNotes(w)
    expect(res).toEqual({ status: 502, body: { code: 'HATS_UNREADABLE', error: SUGGEST_WEARERS_UNREAD } })
    expect(entries(w.repo)).toHaveLength(0)
  })

  it('a maintainer role nobody wears refuses Suggest too', async () => {
    // A hat nobody wears: not OPS, the one steward-a's wallet wears.
    const w = await world(RAISED.replace('maintainer: { members: [steward-a] }', `maintainer: { hat: "${CELO}:0x0000000d0009${'0'.repeat(52)}" }`))
    const { res } = await suggestNotes(w)
    expect(res).toEqual({ status: 409, body: { code: 'NO_DECIDERS', error: NO_SUGGEST_DECIDERS } })
    expect(entries(w.repo)).toHaveLength(0)
  })

  it('a change that revises a proposal is refused on a page saved directly too (409 REVISES)', async () => {
    const w = await world()
    as(w, 'steward-b')
    const path = 'pages/notes-0001.md'
    const revises = 'p-2026-10-31-001-a3f9'
    const at = new Date().toISOString()
    new ChangeStore(w.repo).save({ id: 'chg_0002', actor: 'steward-b', created: at, updated: at, revises,
      ops: [{ op: 'file', path, text: page('notes-0001', 'Notes', NOTES_EDITED), base: git(w.repo, `rev-parse HEAD:${path}`).trim() }] })
    const sid = (await call(w.app, '/api/pages/notes-0001/sessions', json('POST'))).body.session as string
    expect(await call(w.app, `/api/sessions/${sid}`, json('PUT', { markdown: NOTES_EDITED }))).toEqual({ status: 200, body: { save: 'direct' } })
    w.tick()
    const res = await call(w.app, `/api/sessions/${sid}/suggest`, json('POST', { markdown: NOTES_EDITED, proposal: { title: suggestTitle('Notes') } }))
    expect(res).toEqual({ status: 409, body: { code: 'REVISES', revises,
      error: `This change revises proposal ${revises}: press Update proposal, or discard it first. Nothing was written.` } })
    expect(entries(w.repo)).toHaveLength(0)
  })

  it('plain Propose of a change its author may apply alone still answers 409 DIRECT', async () => {
    const w = await world()
    as(w, 'steward-b')
    const path = 'pages/notes-0001.md'
    const text = page('notes-0001', 'Notes', NOTES_EDITED)
    const at = new Date().toISOString()
    new ChangeStore(w.repo).save({ id: 'chg_0001', actor: 'steward-b', created: at, updated: at,
      ops: [{ op: 'file', path, text, base: git(w.repo, `rev-parse HEAD:${path}`).trim() }] })
    const res = await call(w.app, '/api/proposals', json('POST', { title: 'Edit to Notes' }))
    expect(res.status, JSON.stringify(res.body)).toBe(409)
    expect(res.body.code).toBe('DIRECT')
    expect(entries(w.repo)).toHaveLength(0)
  })
})
