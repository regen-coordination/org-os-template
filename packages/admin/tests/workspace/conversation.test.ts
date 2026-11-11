import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Hono } from 'hono'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { TEST_EMAIL } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { Membership } from '../../server/session/membership.ts'
import { openPrivateStore, StoreUnavailable, type PrivateStore } from '../../server/private/store.ts'
import { storeAccess } from '../../server/private/ops.ts'
import { mountVisibility } from '../../server/visibility/routes.ts'
import { EditSessions } from '../../server/workspace/sessions.ts'
import { goneBetween, goneSettled, purgeCursor, tombstones, trunkAtStart } from '../../server/workspace/gone.ts'
import { commitPaths } from '../../server/git.ts'
import { withFailingSubcommand, withGitTrace } from '../git-shim.ts'
import { Refresher } from '../../server/hosted/refresh.ts'
import { ServerAttention } from '../../server/attention.ts'
import { resolveTrunk } from '../../server/proposals/ledger.ts'
import { stateDir } from '../../server/state.ts'
import {
  ANCHOR_CHANGED, ANCHOR_MAX_CHARS, COMMENT_MAX_CHARS, COMMENT_TOO_LONG, NOT_TOLD, commentView, mentionablesFor, mountConversation,
  targetLevel, tell, tellAtCommit, viewerFor, type CommentRow, type Target, TASK_ALREADY, plainLine,
} from '../../server/workspace/conversation.ts'
import { mountPresence, Presence } from '../../server/workspace/presence.ts'
import { admits } from '../../lib/visibility.mjs'
import { joinPage, NO_PAGE, STRICT_LABEL } from '../../lib/workspace/pages.mjs'
import type { KnownActor } from '../../server/actor.ts'
import type { WearerReading } from '../../server/systems/hats.ts'

// DAO-OS L6 §8, Task 9: comments, mentions told only to those who may see the target, notifications (Needs you), read state.
// Every test builds a fresh temporary repository (makeChangeRepo) and keeps its store in a folder of its own under the temp
// directory: nothing is written inside this worktree. Git's identity is steward-a (wallet A1, wears Ops); steward-b's
// wallet A2 and ops-lead's A3 wear Ops once read; steward-c has no wallet. Placeholders only; no network; a fixed clock.

const NOW = new Date('2026-10-31T12:00:00Z')
const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`
const A2 = `${CELO}:0x00000000000000000000000000000000000000a2`
const A3 = `${CELO}:0x00000000000000000000000000000000000000a3`
const WEARS: Record<string, string[]> = { a1: [OPS], a2: [OPS], a3: [OPS] }

const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
    stewards: { members: [steward-a, steward-b, steward-c] }
  decisions: []
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["${TEST_EMAIL}"], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person, handles: { git: ["steward-b@example.test"], wallet: "${A2}" } }
  - { id: steward-c, name: Steward C, kind: person, handles: { git: ["steward-c@example.test"] } }
  - { id: ops-lead, name: Ops Lead, kind: person, handles: { wallet: "${A3}" } }
`
const VISIBILITY = `visibility:
  defaults: { contact: "hat:${OPS}" }
  collections:
    projects: { default: members }
`
const PROJECTS = `schema_version: "2.0"
projects:
  - { id: proj-1, title: Seed Fund, status: execute, type: program, lead: steward-a }
  - { id: budget, title: Budget, status: execute, type: program, lead: steward-a }
`
/** A private task kept at hat:Ops in a git collection (an opaque id): its title is what must not travel. */
const OPS_TASK = 't-00000000000f'
const BODY = 'First line.\n\nSecond line.\n\nThird line.\n'
const page = (id: string, title: string, body = BODY) => joinPage({ id, title, parent: null, order: 1000 }, body)
/** A private page kept at hat:Ops (an id of the store's shape). */
const OPS_PAGE = 'p-0123456789ab'
const STEWARD_A: KnownActor = { id: 'steward-a', name: 'Steward A', kind: 'person', via: 'git' }

const cleanup: string[] = []
const stores: PrivateStore[] = []
const live: EditSessions[] = []
afterEach(() => {
  for (const s of live.splice(0)) s.dispose()
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed by the test */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
  vi.restoreAllMocks()
})

interface World {
  repo: string; store: PrivateStore; app: Hono; membership: Membership; presence: Presence
  /** Reads `account`'s hats now, so later reads find them (a member with no reading wears nothing, §8.3). */
  prime: (...accounts: string[]) => Promise<void>
  appWith: (access: () => PrivateStore) => Hono
}

async function world(opts: { pages?: Record<string, string> } = {}): Promise<World> {
  const repo = makeChangeRepo(GOVERNANCE)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), VISIBILITY)
  writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS)
  mkdirSync(join(repo, 'pages'), { recursive: true })
  for (const [id, text] of Object.entries(opts.pages ?? { 'handbook-3f2a': page('handbook-3f2a', 'Handbook') })) writeFileSync(join(repo, 'pages', `${id}.md`), text)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, four members, the pages"')
  const dir = mkdtempSync(join(tmpdir(), 'conversation-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  await store.putRecord({ collection: 'pages', id: OPS_PAGE, visibility: `hat:${OPS}`, body: { title: 'Ops runbook', parent: null, order: 2000, markdown: BODY }, rev: 'r1' }, 'steward-a', null)
  await store.putCollection({ id: 'council-notes', visibility: `hat:${COUNCIL}`, definition: { name: 'Council notes' } }, 'steward-a')
  await store.putRecord({ collection: 'council-notes', id: 'n-1', visibility: `hat:${COUNCIL}`, body: { title: 'Steward pay' }, rev: 'r1' }, 'steward-a', null)
  await store.putRecord({ collection: 'tasks', id: OPS_TASK, visibility: `hat:${OPS}`, body: { title: 'Rotate signer keys' }, rev: 'r1' }, 'steward-a', null)
  const now = () => NOW
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, block: 100, readAt: NOW.toISOString(),
    hats: WEARS[account.toLowerCase().slice(-2)] ?? [] })
  const reader = { wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)), wearers: vi.fn() }
  const membership = new Membership({ repo, reader: reader as never, now })
  const presence = new Presence({ level: t => targetLevel(repo, t, store), now: () => NOW.getTime() })
  const appWith = (access: () => PrivateStore) => createApp(repo, (a, ctx) => {
    mountVisibility(a, { repo, membership, withLock: ctx.withLock, privateStore: ctx.privateStore })
    mountConversation(a, { repo, membership, privateStore: ctx.privateStore, withLock: ctx.withLock, now })
    mountPresence(a, { repo, membership, privateStore: ctx.privateStore, presence })
  }, { request: withRequest({ repo, hosted: false, membership, store, now }), privateStore: access })
  const prime = async (...accounts: string[]) => { for (const a of accounts) await membership.forAct(a) }
  return { repo, store, app: appWith(() => store), membership, presence, prime, appWith }
}

const json = (method: string, body?: unknown) => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), headers: { 'content-type': 'application/json' } })
async function call(app: Hono, path: string, init?: RequestInit): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await app.request(path, init)
  const text = await res.text()
  return { status: res.status, body: text === '' ? null : JSON.parse(text) }
}
/** Git's identity is now that member (their handles.git), so the next request is theirs. */
const as = (repo: string, email: string) => git(repo, `config user.email ${email}`)
const asA = (repo: string) => as(repo, TEST_EMAIL)
const asB = (repo: string) => as(repo, 'steward-b@example.test')
const asC = (repo: string) => as(repo, 'steward-c@example.test')
const commits = (repo: string) => Number(git(repo, 'rev-list --count HEAD').trim())
const mention = (id: string) => `[@${id}](hub:member/${id})`
const deps = (w: World) => ({ repo: w.repo, store: w.store, membership: w.membership, now: () => NOW })

describe('the constants and the copy (L6 §8)', () => {
  it('are the spec\'s, exactly', () => {
    expect(COMMENT_MAX_CHARS).toBe(10000)
    expect(ANCHOR_MAX_CHARS).toBe(500)
    expect(NOT_TOLD('steward-c')).toBe('Not told: steward-c can’t see this page.')
    expect(ANCHOR_CHANGED).toBe('The text it was on has changed.')
  })
})

describe('comments follow their target\'s level (§8.2, rule 7)', () => {
  it('a comment follows its page\'s level: narrowing the page hides it from a member not admitted', async () => {
    const w = await world()
    const sent = await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: 'Is this current?' }))
    expect(sent.status).toBe(201)
    expect(sent.body.comment).toMatchObject({ handle: 'steward-a', role: 'Steward A', body: 'Is this current?', state: 'sent', replies: [], by: 'steward-a', target: 'page:handbook-3f2a' })
    asC(w.repo)
    const seen = await call(w.app, '/api/comments?target=page:handbook-3f2a')
    expect(seen.status).toBe(200)
    expect(seen.body.map((c: { body: string }) => c.body)).toEqual(['Is this current?'])
    asA(w.repo)
    const narrowed = await call(w.app, '/api/visibility/narrow', json('POST', { target: { page: 'handbook-3f2a' }, level: `hat:${OPS}` }))
    expect(narrowed.status).toBe(200)
    asC(w.repo)
    const gone = await call(w.app, '/api/comments?target=page:handbook-3f2a')
    expect(gone).toEqual({ status: 404, body: { error: NO_PAGE('handbook-3f2a') } })
    asA(w.repo)
    const still = await call(w.app, '/api/comments?target=page:handbook-3f2a')
    expect(still.status).toBe(200)
    expect(still.body).toHaveLength(1)
  })

  it('a notification for a page narrowed after it was told is absent (Review Focus 4), and the counts drop with it', async () => {
    const w = await world()
    await w.prime(A2)
    const sent = await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: `${mention('steward-c')} and ${mention('steward-b')}, a look?` }))
    expect(sent.status).toBe(201)
    expect(sent.body.notTold).toEqual([])
    asC(w.repo)
    const before = await call(w.app, '/api/notifications')
    expect(before.status).toBe(200)
    expect(before.body).toHaveLength(1)
    expect(before.body[0]).toMatchObject({
      kind: 'mention', target: 'page:handbook-3f2a', title: 'Handbook', by: { handle: 'steward-a', role: 'Steward A' }, at: NOW.toISOString(), read: false,
      text: 'Steward A mentioned you on Handbook',
    })
    expect(Object.keys(before.body[0]).sort()).toEqual(['at', 'by', 'id', 'kind', 'read', 'source', 'target', 'text', 'title', 'visibility'])
    asA(w.repo)
    expect((await call(w.app, '/api/visibility/narrow', json('POST', { target: { page: 'handbook-3f2a' }, level: `hat:${OPS}` }))).status).toBe(200)
    asC(w.repo)
    expect(await call(w.app, '/api/notifications')).toEqual({ status: 200, body: [] })
    // Marking it read says nothing of it either: none of the viewer's rows is counted.
    expect(await call(w.app, '/api/notifications/read', json('POST', { target: 'page:handbook-3f2a' }))).toEqual({ status: 200, body: { read: 0 } })
    expect(await call(w.app, '/api/notifications/read', json('POST', { ids: [before.body[0].id] }))).toEqual({ status: 200, body: { read: 0 } })
    // steward-b wears Ops: theirs is still there.
    asB(w.repo)
    const b = await call(w.app, '/api/notifications')
    expect(b.body.map((n: { target: string }) => n.target)).toEqual(['page:handbook-3f2a'])
  })

  it('comments of a deleted page are listed nowhere (Review Focus 4)', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch') } })
    expect((await call(w.app, '/api/comments', json('POST', { target: 'page:scratch-0001', body: `${mention('steward-c')} delete this?` }))).status).toBe(201)
    asC(w.repo)
    expect((await call(w.app, '/api/notifications')).body).toHaveLength(1)
    asA(w.repo)
    expect((await call(w.app, '/api/pages/scratch-0001', json('DELETE'))).status).toBe(200)
    expect(await call(w.app, '/api/comments?target=page:scratch-0001')).toEqual({ status: 404, body: { error: NO_PAGE('scratch-0001') } })
    asC(w.repo)
    expect(await call(w.app, '/api/notifications')).toEqual({ status: 200, body: [] })
    expect(await call(w.app, '/api/reads', json('POST', { target: 'page:scratch-0001' }))).toEqual({ status: 404, body: { error: NO_PAGE('scratch-0001') } })
  })

  it('a comment on what the viewer may not see is the 404 of one that is not there; a reply threads under its comment', async () => {
    const w = await world()
    const top = await call(w.app, '/api/comments', json('POST', { target: `page:${OPS_PAGE}`, body: 'On the runbook.' }))
    expect(top.status).toBe(201)
    const reply = await call(w.app, '/api/comments', json('POST', { target: `page:${OPS_PAGE}`, body: 'A reply.', parent: top.body.comment.id }))
    expect(reply.status).toBe(201)
    const list = await call(w.app, `/api/comments?target=page:${OPS_PAGE}`)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].replies.map((r: { body: string; parent: string }) => [r.body, r.parent])).toEqual([['A reply.', top.body.comment.id]])
    asC(w.repo)
    for (const res of [
      await call(w.app, `/api/comments?target=page:${OPS_PAGE}`),
      await call(w.app, '/api/comments', json('POST', { target: `page:${OPS_PAGE}`, body: 'Let me in.' })),
      await call(w.app, `/api/comments?target=page:p-ffffffffffff`),
    ]) expect(res.status).toBe(404)
    expect((await call(w.app, `/api/comments/${top.body.comment.id}/resolve`, json('POST'))).status).toBe(404)
  })

  it('resolve, reopen and delete own: the body is cleared and its notifications go', async () => {
    const w = await world()
    const sent = await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: `${mention('steward-c')} done?` }))
    const id = sent.body.comment.id as string
    const resolved = await call(w.app, `/api/comments/${id}/resolve`, json('POST'))
    expect(resolved).toMatchObject({ status: 200, body: { comment: { resolved: { by: 'steward-a', at: NOW.toISOString() } } } })
    const reopened = await call(w.app, `/api/comments/${id}/reopen`, json('POST'))
    expect(reopened.status).toBe(200)
    expect(reopened.body.comment.resolved).toBeUndefined()
    asC(w.repo)
    expect((await call(w.app, `/api/comments/${id}`, json('DELETE'))).status).toBe(403)
    asA(w.repo)
    const deleted = await call(w.app, `/api/comments/${id}`, json('DELETE'))
    expect(deleted).toMatchObject({ status: 200, body: { comment: { body: '', deleted: { at: NOW.toISOString(), note: 'Deleted' } } } })
    expect(w.store.comment(id)?.body).toBe('')
    asC(w.repo)
    expect((await call(w.app, '/api/notifications')).body).toEqual([])
  })
})

describe('mentions are told only to those who may see the target (§8.3)', () => {
  it('a mention of steward-c on a hat:Ops page is not told and the author reads NOT_TOLD(\'steward-c\')', async () => {
    const w = await world()
    await w.prime(A2)
    const sent = await call(w.app, '/api/comments', json('POST', { target: `page:${OPS_PAGE}`, body: `${mention('steward-c')} ${mention('steward-b')} please check.` }))
    expect(sent.status).toBe(201)
    expect(Object.keys(sent.body).sort()).toEqual(['comment', 'notTold'])
    expect(sent.body.notTold).toEqual([NOT_TOLD('steward-c')])
    expect(w.store.notifications('steward-c')).toEqual([])
    expect(w.store.notifications('steward-b')).toMatchObject([{ member: 'steward-b', kind: 'mention', target: `page:${OPS_PAGE}`, source: `comment:${sent.body.comment.id}`, by: 'steward-a' }])
    expect(w.store.mentionsOf(`comment:${sent.body.comment.id}`)).toEqual([
      { source: `comment:${sent.body.comment.id}`, kind: 'member', ref: 'steward-b', told: true },
      { source: `comment:${sent.body.comment.id}`, kind: 'member', ref: 'steward-c', told: false },
    ])
  })

  it('a role mention tells each admitted holder', async () => {
    const w = await world()
    await w.prime(A2, A3)
    // stewards (written): steward-a is the author, steward-b wears Ops, steward-c does not.
    expect(await tell([{ kind: 'role', ref: 'stewards' }], `page:${OPS_PAGE}`, 'steward-a', deps(w))).toEqual({ told: ['steward-b'], notTold: ['steward-c'] })
    // ops (from the hat): its holders are the wearers read, steward-b and ops-lead; steward-a wrote it.
    await w.prime(A1)
    const ops = await tell([{ kind: 'role', ref: 'ops' }], `page:${OPS_PAGE}`, 'steward-a', deps(w), 'comment:cmt_role')
    expect(ops).toEqual({ told: ['ops-lead', 'steward-b'], notTold: [] })
    expect(w.store.notifications('ops-lead')).toHaveLength(1)
    // One row per member told, however many mentions name them.
    await tell([{ kind: 'member', ref: 'steward-b' }, { kind: 'role', ref: 'ops' }], `page:${OPS_PAGE}`, 'steward-a', deps(w), 'comment:cmt_twice')
    expect(w.store.notifications('steward-b').filter(n => n.source === 'comment:cmt_twice')).toHaveLength(1)
  })

  it('a member with no reading is not admitted to a hat level (fail closed)', async () => {
    const w = await world()
    const unread = viewerFor('steward-b', { repo: w.repo, membership: w.membership })
    expect(unread).toMatchObject({ kind: 'member', id: 'steward-b', hats: [] })
    expect(unread.kind === 'member' && unread.roles).toContain('stewards')
    expect(unread.kind === 'member' && unread.roles).not.toContain('ops') // a role sourced from a hat holds nobody unread
    expect(admits({ level: 'hat', hat: OPS }, unread)).toBe(false)
    expect(await tell([{ kind: 'member', ref: 'steward-b' }], `page:${OPS_PAGE}`, 'steward-a', deps(w))).toEqual({ told: [], notTold: ['steward-b'] })
    await w.prime(A2)
    const read = viewerFor('steward-b', { repo: w.repo, membership: w.membership })
    expect(read).toMatchObject({ kind: 'member', id: 'steward-b', hats: [OPS] })
    expect(read.kind === 'member' && read.roles).toEqual(expect.arrayContaining(['ops', 'stewards']))
    // A CAIP-10 account reads as the member whose wallet it is.
    expect(viewerFor(A2, { repo: w.repo, membership: w.membership })).toMatchObject({ id: 'steward-b', hats: [OPS] })
    expect(await tell([{ kind: 'member', ref: 'steward-b' }], `page:${OPS_PAGE}`, 'steward-a', deps(w), 'comment:cmt_later')).toEqual({ told: ['steward-b'], notTold: [] })
    // With no Membership at all, nobody wears a hat.
    expect(viewerFor('steward-b', { repo: w.repo, membership: null })).toMatchObject({ hats: [] })
  })

  it('new mentions in a page session are told at its commit, old ones not again', async () => {
    const w = await world({ pages: { 'guide-0001': page('guide-0001', 'Guide') } })
    const s = new EditSessions(w.repo, { store: w.store, now: () => NOW, schedule: () => () => {} })
    live.push(s)
    const told: Promise<unknown>[] = []
    s.onCommit((p, _base, text, ctx) => { told.push(tellAtCommit(p, text, ctx, deps(w))) })
    const member = { kind: 'member' as const, id: 'steward-a', hats: [OPS], roles: [] as string[] }
    const one = await s.open(STEWARD_A, member, 'guide-0001')
    await s.save(one.session, STEWARD_A, { markdown: `${BODY}\n${mention('steward-b')} owns this.\n` })
    await s.close(one.session)
    await Promise.all(told)
    expect(w.store.notifications('steward-b')).toMatchObject([{ target: 'page:guide-0001', source: 'page:guide-0001', by: 'steward-a' }])
    const two = await s.open(STEWARD_A, member, 'guide-0001')
    await s.save(two.session, STEWARD_A, { markdown: `${BODY}\n${mention('steward-b')} owns this; ${mention('steward-c')} reviews.\n` })
    await s.close(two.session)
    await Promise.all(told)
    expect(w.store.notifications('steward-b')).toHaveLength(1)
    expect(w.store.notifications('steward-c')).toMatchObject([{ target: 'page:guide-0001', source: 'page:guide-0001' }])
    // A third session that keeps both mentions tells nobody.
    const three = await s.open(STEWARD_A, member, 'guide-0001')
    await s.save(three.session, STEWARD_A, { markdown: `${BODY}\n${mention('steward-b')} owns this; ${mention('steward-c')} reviews. Edited.\n` })
    await s.close(three.session)
    await Promise.all(told)
    expect(w.store.notifications('steward-b')).toHaveLength(1)
    expect(w.store.notifications('steward-c')).toHaveLength(1)
  })

  it('mentionablesFor offers steward-c disabled ("can’t see this page") and never a record of a private collection the author may not see', async () => {
    const w = await world()
    await w.prime(A1, A2, A3)
    const author = { kind: 'member' as const, id: 'steward-a', hats: [OPS], roles: ['ops', 'stewards'] }
    const all = mentionablesFor(`page:${OPS_PAGE}`, '', author, deps(w))
    const person = (id: string) => all.find(m => m.kind === 'person' && m.id === id)
    expect(person('steward-c')).toMatchObject({ kind: 'person', id: 'steward-c', label: 'Steward C', canSee: false })
    expect(person('steward-b')).toMatchObject({ kind: 'person', id: 'steward-b', label: 'Steward B', hat: 'ops', canSee: true })
    expect(all.find(m => m.kind === 'role' && m.id === 'stewards')).toMatchObject({ count: 3, canSee: true })
    expect(all.find(m => m.kind === 'record' && m.id === 'projects:proj-1')).toMatchObject({ label: 'Seed Fund', recordKind: 'projects', canSee: true })
    expect(all.find(m => m.kind === 'page' && m.id === 'handbook-3f2a')).toMatchObject({ label: 'Handbook', canSee: true })
    expect(all.filter(m => m.kind === 'record' && m.id.startsWith('council-notes:'))).toEqual([])
    expect(JSON.stringify(all)).not.toContain('Steward pay')
    // The ones who can see come first; a person who cannot is kept, after them, to be drawn disabled.
    const firstDisabled = all.findIndex(m => !m.canSee)
    expect(all.slice(firstDisabled).every(m => !m.canSee && m.kind === 'person')).toBe(true)
    // The query narrows; over HTTP the same answer.
    const q = await call(w.app, `/api/mentionables?target=page:${OPS_PAGE}&q=steward`)
    expect(q.status).toBe(200)
    expect(q.body.map((m: { kind: string; id: string }) => `${m.kind}:${m.id}`)).toEqual(['person:steward-a', 'person:steward-b', 'role:stewards', 'person:steward-c'])
    // A target the author may not see offers nothing.
    expect(mentionablesFor(`page:${OPS_PAGE}`, '', { kind: 'member', id: 'steward-c', hats: [], roles: [] }, deps(w))).toEqual([])
  })
})

describe('the comment\'s acts and limits (§8.2)', () => {
  it('Turn into a task on a hat:Ops page creates a private task with an opaque id', async () => {
    const w = await world()
    const sent = await call(w.app, '/api/comments', json('POST', { target: `page:${OPS_PAGE}`, body: 'Rotate the signer keys\n\nBefore the audit.' }))
    const before = commits(w.repo)
    const task = await call(w.app, `/api/comments/${sent.body.comment.id}/task`, json('POST'))
    expect(task.status).toBe(201)
    expect(task.body).toMatchObject({ task: expect.stringMatching(/^t-[0-9a-f]{12}$/), visibility: `hat:${OPS}` })
    expect(w.store.record('tasks', task.body.task)).toMatchObject({ visibility: `hat:${OPS}`, body: { title: 'Rotate the signer keys', page: OPS_PAGE } })
    expect(commits(w.repo)).toBe(before)
    expect(existsSync(join(w.repo, 'data', 'tasks.yaml')) ? readFileSync(join(w.repo, 'data', 'tasks.yaml'), 'utf8') : '').not.toContain('Rotate')
    // On a members' page it is a workspace write: one commit, the task in git, linked to the page.
    const open = await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: 'Update the onboarding list' }))
    const gitTask = await call(w.app, `/api/comments/${open.body.comment.id}/task`, json('POST'))
    expect(gitTask.status).toBe(201)
    expect(gitTask.body).toMatchObject({ task: 'update-the-onboarding-list', commit: expect.any(String) })
    expect(commits(w.repo)).toBe(before + 1)
    expect(readFileSync(join(w.repo, 'data', 'tasks.yaml'), 'utf8')).toContain('page: handbook-3f2a')
  })

  // The final review's M-5 (PF-R117): a task made from a comment is never public at once. On a public page, in a tasks
  // collection whose default is public, the task takes members (the comment's level); widening it is a publication.
  it('Turn into a task on a public page makes a members task: nothing public without a decided publication', async () => {
    const w = await world({ pages: { 'notice-0001': joinPage({ id: 'notice-0001', title: 'Notice', parent: null, order: 1000, visibility: 'public' }, BODY) } })
    writeFileSync(join(w.repo, 'data', 'visibility.yaml'), `${VISIBILITY}    tasks: { default: public }\n`)
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "fixture: tasks are public by default"')
    const sent = await call(w.app, '/api/comments', json('POST', { target: 'page:notice-0001', body: 'Print the notice' }))
    const task = await call(w.app, `/api/comments/${sent.body.comment.id}/task`, json('POST'))
    expect(task.status).toBe(201)
    const tasks = parseYaml(readFileSync(join(w.repo, 'data', 'tasks.yaml'), 'utf8')) as { tasks: Record<string, unknown>[] }
    expect(tasks.tasks.find(t => t.id === task.body.task)).toEqual({ id: 'print-the-notice', title: 'Print the notice', page: 'notice-0001', visibility: 'members' })
  })

  it('a comment is turned into one task only: the task is served on the comment, a second turn is refused in words (Task 18 fix round 1)', async () => {
    const w = await world()
    const sent = await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: `Is the season written down? ${mention('steward-b')} could you **check**?` }))
    const id = sent.body.comment.id as string
    const before = commits(w.repo)
    const made = await call(w.app, `/api/comments/${id}/task`, json('POST'))
    expect(made.status).toBe(201)
    // the title, the slug and the commit's subject are the line as plain text: a mention is its label
    expect(made.body.task).toBe('is-the-season-written-down-steward-b-could-you-c') // the slug, clipped as ids are
    expect(git(w.repo, 'log -1 --format=%s').trim()).toBe('tasks: Is the season written down? @steward-b could you check?')
    expect(readFileSync(join(w.repo, 'data', 'tasks.yaml'), 'utf8')).not.toContain('hub:member')
    const listed = await call(w.app, '/api/comments?target=page:handbook-3f2a')
    expect(listed.body[0].task).toBe(made.body.task)
    const again = await call(w.app, `/api/comments/${id}/task`, json('POST'))
    expect(again).toEqual({ status: 409, body: { error: TASK_ALREADY(made.body.task), code: 'TASKED' } })
    expect(TASK_ALREADY('x')).toBe('This comment was turned into the task x already. Nothing was written.')
    expect(commits(w.repo)).toBe(before + 1)
  })

  it('reads a line of the inline subset as plain text; ↗ stays ↗', () => {
    expect(plainLine('Ask [@Steward B](hub:member/steward-b) about `rota` and **keys**, *soon*')).toBe('Ask @Steward B about rota and keys, soon')
    expect(plainLine(`[${STRICT_LABEL}](hub:record/tasks/t-1) needs an owner`)).toBe(`${STRICT_LABEL} needs an owner`)
    expect(plainLine('snake_case_name stays')).toBe('snake_case_name stays')
  })

  it('a resolved comment names who resolved it as authors are named (Task 18 fix round 1)', async () => {
    const w = await world()
    const sent = await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: 'Done?' }))
    const resolved = await call(w.app, `/api/comments/${sent.body.comment.id}/resolve`, json('POST'))
    expect(resolved.body.comment.resolved).toEqual({ by: 'steward-a', at: NOW.toISOString(), role: 'Steward A' })
  })

  it('a body over 10000 characters is refused; one of exactly 10000 is sent', async () => {
    const w = await world()
    const over = await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: 'é'.repeat(10001) }))
    expect(over).toEqual({ status: 413, body: { error: COMMENT_TOO_LONG(10001), code: 'TOO_LONG' } })
    expect(COMMENT_TOO_LONG(10001)).toBe('A comment is at most 10000 characters, and this one is 10001. Nothing was sent.')
    expect((await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: 'é'.repeat(10000) }))).status).toBe(201)
    expect(w.store.comments('page:handbook-3f2a')).toHaveLength(1)
  })

  it('an anchor whose text is gone reads "The text it was on has changed."; an anchor part over 500 characters is refused', async () => {
    const w = await world()
    const anchor = { exact: 'Second line.', prefix: 'First line.\n\n', suffix: '\n\nThird' }
    const sent = await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: 'This one?', anchor }))
    expect(sent.status).toBe(201)
    const id = sent.body.comment.id as string
    expect(sent.body.comment.anchor).toEqual({ id, text: 'Second line.', ...anchor })
    writeFileSync(join(w.repo, 'pages', 'handbook-3f2a.md'), page('handbook-3f2a', 'Handbook', 'First line.\n\nThird line.\n'))
    git(w.repo, 'add pages/handbook-3f2a.md'); git(w.repo, 'commit -qm "page: by hand"')
    const after = await call(w.app, '/api/comments?target=page:handbook-3f2a')
    expect(after.body[0].anchor).toBeUndefined()
    expect(after.body[0].unanchored).toEqual({ text: 'Second line.', note: ANCHOR_CHANGED })
    expect(after.body[0].body).toBe('This one?')
    const long = await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: 'Too long', anchor: { exact: 'x'.repeat(501) } }))
    expect(long.status).toBe(422)
    // commentView alone: the anchor is judged on the text given.
    const row: CommentRow = { id: 'cmt_1', target: 'page:handbook-3f2a', parent: null, anchor: { exact: 'gone', prefix: '', suffix: '' }, by: 'steward-a', body: 'b',
      created: NOW.toISOString(), edited: null, resolvedBy: null, resolvedAt: null, deleted: null }
    expect(commentView(row, id => ({ handle: id, role: id }), 'nothing here').unanchored).toEqual({ text: 'gone', note: ANCHOR_CHANGED })
  })

  it('opening the target marks its rows read (POST /api/reads)', async () => {
    const w = await world()
    await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: `${mention('steward-c')} one` }))
    await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: `${mention('steward-c')} two` }))
    asC(w.repo)
    expect((await call(w.app, '/api/notifications')).body.map((n: { read: boolean }) => n.read)).toEqual([false, false])
    expect(await call(w.app, '/api/reads', json('POST', { target: 'page:handbook-3f2a' }))).toEqual({ status: 200, body: { target: 'page:handbook-3f2a', at: NOW.toISOString(), read: 2 } })
    expect((await call(w.app, '/api/notifications')).body.map((n: { read: boolean }) => n.read)).toEqual([true, true])
    expect(w.store.readOf('steward-c', 'page:handbook-3f2a')).toBe(NOW.toISOString())
  })
})

describe('the store down (Review Focus 5)', () => {
  it('conversation refuses in words while the store is down', async () => {
    const w = await world()
    const kept = await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: 'Before the store went down.' }))
    const id = kept.body.comment.id as string
    const sentence = 'The private store at /x/house.db could not be opened: test.'
    const down = w.appWith(storeAccess(null, { sentence }) as () => PrivateStore)
    const refused = { status: 503, body: { error: sentence, code: 'PRIVATE_STORE' } }
    const head = git(w.repo, 'rev-parse HEAD').trim()
    const state = existsSync(stateDir(w.repo)) ? readdirSync(stateDir(w.repo), { recursive: true }).sort() : []
    expect(await call(down, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: 'While down.' }))).toEqual(refused)
    expect(await call(down, '/api/comments?target=page:handbook-3f2a')).toEqual(refused)
    expect(await call(down, '/api/notifications')).toEqual(refused)
    expect(await call(down, '/api/notifications/read', json('POST', { target: 'page:handbook-3f2a' }))).toEqual(refused)
    expect(await call(down, '/api/reads', json('POST', { target: 'page:handbook-3f2a' }))).toEqual(refused)
    for (const act of ['resolve', 'reopen', 'task']) expect(await call(down, `/api/comments/${id}/${act}`, json('POST'))).toEqual(refused)
    expect(await call(down, `/api/comments/${id}`, json('DELETE'))).toEqual(refused)
    // Presence is in memory: on a git page it works; on a private page its level is the store's, so it refuses.
    expect(await call(down, '/api/presence', json('POST', { target: `page:${OPS_PAGE}`, editing: false }))).toEqual(refused)
    expect((await call(down, '/api/presence', json('POST', { target: 'page:handbook-3f2a', editing: true }))).status).toBe(200)
    expect(await call(down, `/api/mentionables?target=page:${OPS_PAGE}`)).toEqual(refused)
    expect((await call(down, '/api/mentionables?target=page:handbook-3f2a')).status).toBe(200)
    expect(git(w.repo, 'rev-parse HEAD').trim()).toBe(head)
    expect(git(w.repo, 'status --porcelain').trim()).toBe('')
    expect(existsSync(stateDir(w.repo)) ? readdirSync(stateDir(w.repo), { recursive: true }).sort() : []).toEqual(state)
    expect(w.store.comments('page:handbook-3f2a').map(c => [c.body, c.resolvedBy, c.deleted])).toEqual([['Before the store went down.', null, null]])
    // tell() itself refuses with the store's words when its write fails.
    const broken = { ...deps(w), store: { ...w.store, mentionsOf: () => [], writeConversation: async () => { throw new StoreUnavailable(sentence) } } as unknown as PrivateStore }
    await expect(tell([{ kind: 'member', ref: 'steward-c' }], 'page:handbook-3f2a', 'steward-a', broken, 'comment:x')).rejects.toMatchObject({ status: 503 })
  })
})

describe('rule 4: conversation never reaches git', () => {
  it('no comment body, mention or notification reaches git (object scan)', async () => {
    const w = await world()
    await w.prime(A2)
    const sentinel = 'sentinel-conversation-7f3a'
    const one = await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: `${sentinel} ${mention('steward-b')}`, anchor: { exact: 'First line.' } }))
    await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: `${sentinel}-reply`, parent: one.body.comment.id }))
    const ops = await call(w.app, '/api/comments', json('POST', { target: `page:${OPS_PAGE}`, body: `${sentinel}-ops ${mention('steward-c')}` }))
    await call(w.app, `/api/comments/${one.body.comment.id}/resolve`, json('POST'))
    await call(w.app, `/api/comments/${ops.body.comment.id}/task`, json('POST'))
    await call(w.app, '/api/reads', json('POST', { target: 'page:handbook-3f2a' }))
    await call(w.app, '/api/presence', json('POST', { target: 'page:handbook-3f2a', editing: true }))
    expect(w.store.notifications('steward-b')).toHaveLength(1)
    const all = spawnSync('git', ['cat-file', '--batch-all-objects', '--batch'], { cwd: w.repo, encoding: 'utf8', maxBuffer: 1 << 28 })
    expect(all.status).toBe(0)
    for (const needle of [sentinel, 'notification', 'ntf_', 'cmt_']) expect(all.stdout).not.toContain(needle)
    expect(git(w.repo, 'status --porcelain').trim()).toBe('')
    // Nor the state directory beside the repository (changes, drafts): conversation is the store's alone.
    const dir = stateDir(w.repo)
    const files = existsSync(dir) ? (readdirSync(dir, { recursive: true }) as string[]).filter(f => statSync(join(dir, f)).isFile()) : []
    for (const f of files) expect(readFileSync(join(dir, f), 'utf8')).not.toContain(sentinel)
  })
})

describe('targetLevel (§8.2)', () => {
  it('a page\'s level, a record\'s level, and null for no such thing', async () => {
    const w = await world()
    expect(targetLevel(w.repo, 'page:handbook-3f2a' as Target, w.store)).toEqual({ level: 'members' })
    expect(targetLevel(w.repo, `page:${OPS_PAGE}` as Target, w.store)).toEqual({ level: 'hat', hat: OPS })
    expect(targetLevel(w.repo, `page:${OPS_PAGE}` as Target, null)).toBeNull()
    expect(targetLevel(w.repo, 'record:projects:proj-1' as Target, w.store)).toEqual({ level: 'members' })
    expect(targetLevel(w.repo, 'record:council-notes:n-1' as Target, w.store)).toEqual({ level: 'hat', hat: COUNCIL })
    expect(targetLevel(w.repo, 'record:projects:nope' as Target, w.store)).toBeNull()
    expect(targetLevel(w.repo, 'page:nope' as Target, w.store)).toBeNull()
  })
})

describe('R-9a: a target that is gone takes its conversation with it', () => {
  const nothingListed = async (w: World, target: string) => {
    for (const who of [asA, asB, asC]) {
      who(w.repo)
      const got = await call(w.app, `/api/comments?target=${target}`)
      expect(got.status).toBe(200)
      expect(got.body).toEqual([])
      expect((await call(w.app, '/api/notifications')).body).toEqual([])
    }
    asA(w.repo)
  }

  it('a record narrowed, commented on, deleted, then made again under the same id shows none of it', async () => {
    const w = await world()
    await w.prime(A2)
    // 1. The git project `budget` is narrowed to hat:Ops: it moves into the store under the same id.
    expect((await call(w.app, '/api/visibility/narrow', json('POST', { target: { registry: 'projects', id: 'budget' }, level: `hat:${OPS}` }))).status).toBe(200)
    expect(w.store.record('projects', 'budget')).toMatchObject({ visibility: `hat:${OPS}` })
    // 2. The Ops wearers talk about it.
    const sent = await call(w.app, '/api/comments', json('POST', { target: 'record:projects:budget', body: `${mention('steward-b')} the council's numbers` }))
    expect(sent.status).toBe(201)
    await call(w.app, '/api/reads', json('POST', { target: 'record:projects:budget' }))
    asB(w.repo)
    expect((await call(w.app, '/api/notifications')).body).toHaveLength(1)
    asA(w.repo)
    // 3. It is deleted, through the change tray (its private part: the store's delete).
    expect((await call(w.app, '/api/changes/ops', json('POST', { ops: [{ op: 'delete', record: 'projects:budget' }] }))).status).toBe(200)
    expect((await call(w.app, '/api/changes/apply', json('POST'))).status).toBe(200)
    expect(w.store.record('projects', 'budget')).toBeNull()
    // 4. Someone makes a project "Budget" again: its slug id is `budget`, at members.
    expect((await call(w.app, '/api/changes/ops', json('POST', { ops: [{ op: 'create', record: 'projects:budget', value: { id: 'budget', title: 'Budget', status: 'develop', type: 'program', lead: 'steward-c' } }] }))).status).toBe(200)
    expect((await call(w.app, '/api/changes/apply', json('POST'))).status).toBe(200)
    expect(targetLevel(w.repo, 'record:projects:budget', w.store)).toEqual({ level: 'members' })
    // 5. Nothing of the council's conversation is listed, to anyone.
    await nothingListed(w, 'record:projects:budget')
    expect(w.store.comments('record:projects:budget')).toEqual([])
    expect(w.store.mentionsOf(`comment:${sent.body.comment.id}`)).toEqual([])
    expect(w.store.readOf('steward-a', 'record:projects:budget')).toBeNull()
  })

  it('a git page deleted takes its conversation; one made again under its id starts with none', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch') } })
    const sent = await call(w.app, '/api/comments', json('POST', { target: 'page:scratch-0001', body: `${mention('steward-c')} old talk` }))
    expect(sent.status).toBe(201)
    expect((await call(w.app, '/api/pages/scratch-0001', json('DELETE'))).status).toBe(200)
    await goneSettled(w.repo)
    expect(w.store.comments('page:scratch-0001')).toEqual([])
    expect(w.store.notifications('steward-c')).toEqual([])
    // A revert of the delete (by hand) brings the page back: not its conversation.
    writeFileSync(join(w.repo, 'pages', 'scratch-0001.md'), page('scratch-0001', 'Scratch'))
    git(w.repo, 'add pages/scratch-0001.md'); git(w.repo, 'commit -qm "page: restored by hand"')
    await nothingListed(w, 'page:scratch-0001')
  })

  it('a private page deleted takes its conversation in the store\'s own transaction', async () => {
    const w = await world()
    await w.prime(A2)
    await call(w.app, '/api/comments', json('POST', { target: `page:${OPS_PAGE}`, body: `${mention('steward-b')} runbook` }))
    expect((await call(w.app, `/api/pages/${OPS_PAGE}`, json('DELETE'))).status).toBe(200)
    expect(w.store.comments(`page:${OPS_PAGE}`)).toEqual([])
    expect(w.store.notifications('steward-b')).toEqual([])
  })

  it('with the store down at the delete, a tombstone is kept and applied the moment the store is back', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch') } })
    await call(w.app, '/api/comments', json('POST', { target: 'page:scratch-0001', body: `${mention('steward-c')} before` }))
    const down = w.appWith(storeAccess(null, { sentence: 'The private store is down for this test.' }) as () => PrivateStore)
    expect((await call(down, '/api/pages/scratch-0001', json('DELETE'))).status).toBe(200)
    await goneSettled(w.repo)
    expect(tombstones(w.repo).map(t => t.target)).toEqual(['page:scratch-0001'])
    expect(w.store.comments('page:scratch-0001')).toHaveLength(1) // the store was not reached
    // Made again before the store is back.
    writeFileSync(join(w.repo, 'pages', 'scratch-0001.md'), page('scratch-0001', 'Scratch'))
    git(w.repo, 'add pages/scratch-0001.md'); git(w.repo, 'commit -qm "page: again"')
    const up = w.appWith(() => w.store)
    asC(w.repo)
    expect((await call(up, '/api/notifications')).body).toEqual([])
    expect((await call(up, '/api/comments?target=page:scratch-0001')).body).toEqual([])
    expect(tombstones(w.repo)).toEqual([])
    expect(w.store.comments('page:scratch-0001')).toEqual([])
    // A comment made after it stays.
    asA(w.repo)
    expect((await call(up, '/api/comments', json('POST', { target: 'page:scratch-0001', body: 'New talk' }))).status).toBe(201)
    expect((await call(up, '/api/comments?target=page:scratch-0001')).body.map((c: { body: string }) => c.body)).toEqual(['New talk'])
  })
})

describe('R-9b: a record stricter than the text is never named by its title there', () => {
  const opsTask = `[@Rotate signer keys](hub:record/tasks/${OPS_TASK})`

  it('mentionablesFor offers a record only when everyone the target admits may see it', async () => {
    const w = await world({ pages: { 'handbook-3f2a': page('handbook-3f2a', 'Handbook'), 'open-0001': joinPage({ id: 'open-0001', title: 'Open', parent: null, order: 1, visibility: 'public' }, 'Hi.\n') } })
    const author = { kind: 'member' as const, id: 'steward-a', hats: [OPS], roles: [] as string[] }
    const ids = (t: Target) => mentionablesFor(t, '', author, deps(w)).filter(m => m.kind === 'record').map(m => m.id)
    expect(ids(`page:${OPS_PAGE}`)).toEqual(expect.arrayContaining([`tasks:${OPS_TASK}`, 'projects:proj-1']))
    expect(ids('page:handbook-3f2a')).not.toContain(`tasks:${OPS_TASK}`)
    expect(ids('page:handbook-3f2a')).toContain('projects:proj-1')
    expect(ids('page:open-0001')).not.toContain('projects:proj-1') // a members' record on a public page
    expect(JSON.stringify(mentionablesFor('page:handbook-3f2a', '', author, deps(w)))).not.toContain('Rotate signer keys')
  })

  it('a comment on a looser page names the stricter record as ↗, and Turn into a task commits no title of it', async () => {
    const w = await world()
    const sent = await call(w.app, '/api/comments', json('POST', { target: 'page:handbook-3f2a', body: `${opsTask} needs an owner` }))
    expect(sent.status).toBe(201)
    expect(sent.body.comment.body).toBe(`[${STRICT_LABEL}](hub:record/tasks/${OPS_TASK}) needs an owner`)
    expect(JSON.stringify(w.store.comments('page:handbook-3f2a'))).not.toContain('Rotate signer keys')
    const task = await call(w.app, `/api/comments/${sent.body.comment.id}/task`, json('POST'))
    expect(task.status).toBe(201)
    const tasks = readFileSync(join(w.repo, 'data', 'tasks.yaml'), 'utf8')
    // Task 18 fix round 1: the title is the line as plain text, the stricter record still only ↗ (its id is not written either)
    expect(tasks).toContain(`${STRICT_LABEL} needs an owner`)
    expect(tasks).not.toContain('Rotate signer keys')
    const all = spawnSync('git', ['cat-file', '--batch-all-objects', '--batch'], { cwd: w.repo, encoding: 'utf8', maxBuffer: 1 << 28 })
    expect(all.stdout).not.toContain('Rotate signer keys')
    // On the hat:Ops page itself it keeps its label: everyone there may read it.
    const there = await call(w.app, '/api/comments', json('POST', { target: `page:${OPS_PAGE}`, body: opsTask }))
    expect(there.body.comment.body).toBe(opsTask)
  })

  it('a git page that mentions the stricter record holds ↗, never its title', async () => {
    const w = await world()
    const made = await call(w.app, '/api/pages', json('POST', { title: 'Plans', markdown: `Next: ${opsTask}.\n` }))
    expect(made.status).toBe(201)
    const text = readFileSync(join(w.repo, 'pages', `${made.body.id}.md`), 'utf8')
    expect(text).toContain(`[${STRICT_LABEL}](hub:record/tasks/${OPS_TASK})`)
    expect(text).not.toContain('Rotate signer keys')
    // A label that cannot be rewritten is refused in words.
    const ref = await call(w.app, '/api/pages', json('POST', { title: 'Refs', markdown: `See [Rotate signer keys][t].\n\n[t]: hub:record/tasks/${OPS_TASK}\n` }))
    expect(ref.status).toBe(422)
    expect(ref.body.error).toContain(`tasks:${OPS_TASK}`)
  })
})

describe('§8.5: a private page written in the store is heard', () => {
  it('the store tells which collections a committed transaction touched', async () => {
    const w = await world()
    const heard: string[][] = []
    w.store.onRecordsWritten = cs => { heard.push(cs) }
    await w.store.putRecord({ collection: 'pages', id: 'p-00000000000b', visibility: `hat:${OPS}`, body: { title: 'X', parent: null, order: 1, markdown: '' }, rev: 'r' }, 'steward-a', null)
    await w.store.deleteRecord('pages', 'p-00000000000b', 'steward-a', null)
    await w.store.putViewState('steward-a', 'tasks', { view: 'all' })
    expect(heard).toEqual([['pages'], ['pages']])
  })
})

// R2 review (Rule 4): the Refresher (a read-only hosted Hub taking its remote's commits) and Sync move the trunk without
// applyOps or a ratify. A page or record those commits delete takes its conversation too, read commit by commit, so a
// delete and a re-make between two refreshes still counts. Every repository here is fresh under the temp directory.
describe('R2 review: a trunk moved from outside takes a deleted target\'s conversation', () => {
  const tmp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(d); return d }
  /** A bare remote for `repo`, and a clone of it where commits are made elsewhere (as steward-b). */
  const remoteOf = (repo: string) => {
    const bare = join(tmp('gone-remote-'), 'remote.git')
    git(tmp('gone-init-'), `init -q --bare -b main ${bare}`)
    git(repo, `remote add origin ${bare}`)
    git(repo, 'push -q origin HEAD:refs/heads/main')
    const elsewhere = join(tmp('gone-elsewhere-'), 'clone')
    git(tmp('gone-clone-'), `clone -q ${bare} ${elsewhere}`)
    git(elsewhere, 'config user.email steward-b@example.test')
    git(elsewhere, 'config user.name "Steward B"')
    return elsewhere
  }

  it('a git page deleted and made again at public on the remote: after the refresh its members\' comments are gone', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch') } })
    const sent = await call(w.app, '/api/comments', json('POST', { target: 'page:scratch-0001', body: `${mention('steward-c')} members-only talk` }))
    expect(sent.status).toBe(201)
    await call(w.app, '/api/reads', json('POST', { target: 'page:scratch-0001' }))
    expect(w.store.comments('page:scratch-0001')).toHaveLength(1)
    expect(w.store.notifications('steward-c')).toHaveLength(1)
    const elsewhere = remoteOf(w.repo)
    git(elsewhere, 'rm -q pages/scratch-0001.md')
    git(elsewhere, 'commit -qm "page: deleted"')
    mkdirSync(join(elsewhere, 'pages'), { recursive: true }) // git took the folder with its last file
    writeFileSync(join(elsewhere, 'pages', 'scratch-0001.md'), joinPage({ id: 'scratch-0001', title: 'Scratch', parent: null, order: 1000, visibility: 'public' }, 'Public now.\n'))
    git(elsewhere, 'add pages/scratch-0001.md')
    git(elsewhere, 'commit -qm "page: made again, public"')
    git(elsewhere, 'push -q origin HEAD:refs/heads/main')

    const r = new Refresher({ repo: w.repo, trunk: () => resolveTrunk(w.repo), attention: new ServerAttention(), fetchBlockMs: 10_000 })
    try { expect((await r.refresh()).state).toBe('following') } finally { await r.stop() }
    await goneSettled(w.repo)
    expect(targetLevel(w.repo, 'page:scratch-0001', w.store)).toEqual({ level: 'public' })
    expect(w.store.comments('page:scratch-0001')).toEqual([])
    expect(w.store.notifications('steward-c')).toEqual([])
    expect(w.store.readOf('steward-a', 'page:scratch-0001')).toBeNull()
    for (const who of [asA, asC]) {
      who(w.repo)
      expect((await call(w.app, '/api/comments?target=page:scratch-0001')).body).toEqual([])
    }
  })

  // R2b (review I-2): the purge is bounded by the time the trunk moved (taken before the fast-forward): a comment, a read
  // mark or a notification made on the page after that is the new page's, and stays.
  it('the Refresher takes the time before the fast-forward: what was written on the page after it survives the purge', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch') } })
    expect((await call(w.app, '/api/comments', json('POST', { target: 'page:scratch-0001', body: `${mention('steward-c')} members-only talk` }))).status).toBe(201)
    await call(w.app, '/api/reads', json('POST', { target: 'page:scratch-0001' }))
    expect(w.store.readOf('steward-a', 'page:scratch-0001')).toBe(NOW.toISOString())
    const elsewhere = remoteOf(w.repo)
    git(elsewhere, 'rm -q pages/scratch-0001.md'); git(elsewhere, 'commit -qm "page: deleted"')
    mkdirSync(join(elsewhere, 'pages'), { recursive: true })
    writeFileSync(join(elsewhere, 'pages', 'scratch-0001.md'), joinPage({ id: 'scratch-0001', title: 'Scratch', parent: null, order: 1000, visibility: 'public' }, 'Public now.\n'))
    git(elsewhere, 'add pages/scratch-0001.md'); git(elsewhere, 'commit -qm "page: made again, public"')
    git(elsewhere, 'push -q origin HEAD:refs/heads/main')
    // Written on the new page after the move (13:00), the move at 12:30, the old comment at the fixed clock (12:00).
    const later = '2026-10-31T13:00:00.000Z'
    await w.store.writeConversation({
      comments: [{ id: 'c-after', target: 'page:scratch-0001', parent: null, anchor: null, by: 'steward-b', body: 'On the public page.', created: later,
        edited: null, resolvedBy: null, resolvedAt: null, deleted: null }],
      notifications: [{ id: 'n-after', member: 'steward-c', kind: 'mention', target: 'page:scratch-0001', source: 'comment:c-after', by: 'steward-b', created: later, readAt: null }],
    })
    await w.store.putRead('steward-b', 'page:scratch-0001', later)
    const r = new Refresher({ repo: w.repo, trunk: () => resolveTrunk(w.repo), attention: new ServerAttention(), fetchBlockMs: 10_000,
      now: () => new Date('2026-10-31T12:30:00Z') })
    try { expect((await r.refresh()).state).toBe('following') } finally { await r.stop() }
    await goneSettled(w.repo)
    expect(w.store.comments('page:scratch-0001').map(c => c.id)).toEqual(['c-after'])
    expect(w.store.notifications('steward-c').map(n => n.id)).toEqual(['n-after'])
    expect(w.store.readOf('steward-b', 'page:scratch-0001')).toBe(later)
    expect(w.store.readOf('steward-a', 'page:scratch-0001')).toBeNull()
  })

  // R2b (review I-3): a purge cursor in the admin state directory (the last trunk commit fully purged). Every move, and the
  // start, read from it to the trunk; it advances only once the targets are purged or buried.
  const recreatePublic = (repo: string, id = 'scratch-0001') => {
    git(repo, `rm -q pages/${id}.md`); git(repo, `commit -qm "page ${id}: deleted"`)
    mkdirSync(join(repo, 'pages'), { recursive: true })
    writeFileSync(join(repo, 'pages', `${id}.md`), joinPage({ id, title: 'Scratch', parent: null, order: 1000, visibility: 'public' }, 'Public now.\n'))
    git(repo, `add pages/${id}.md`); git(repo, `commit -qm "page ${id}: made again, public"`)
  }
  const talk = async (w: World) => {
    expect((await call(w.app, '/api/comments', json('POST', { target: 'page:scratch-0001', body: `${mention('steward-c')} members-only talk` }))).status).toBe(201)
  }
  const atStart = (w: World) => trunkAtStart(w.repo, () => resolveTrunk(w.repo), new Date())

  it('with no cursor yet, the start sets it to the trunk and purges nothing that came before', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch') } })
    await talk(w)
    recreatePublic(w.repo)
    expect(purgeCursor(w.repo)).toBeNull()
    await atStart(w); await goneSettled(w.repo)
    expect(purgeCursor(w.repo)).toBe(tip(w.repo))
    expect(w.store.comments('page:scratch-0001')).toHaveLength(1)
  })

  it('a trunk moved while the server was down is read at the next start', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch') } })
    await atStart(w); await goneSettled(w.repo)
    const was = tip(w.repo)
    expect(purgeCursor(w.repo)).toBe(was)
    await talk(w)
    recreatePublic(w.repo) // a pull made by hand while the Hub was stopped
    await atStart(w); await goneSettled(w.repo)
    expect(w.store.comments('page:scratch-0001')).toEqual([])
    expect(purgeCursor(w.repo)).toBe(tip(w.repo))
  })

  it('a git read that fails is an error: the cursor stays, and the next run purges', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch') } })
    await atStart(w); await goneSettled(w.repo)
    const was = tip(w.repo)
    await talk(w)
    const elsewhere = remoteOf(w.repo)
    recreatePublic(elsewhere); git(elsewhere, 'push -q origin HEAD:refs/heads/main')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = new Refresher({ repo: w.repo, trunk: () => resolveTrunk(w.repo), attention: new ServerAttention(), fetchBlockMs: 10_000 })
    await withFailingSubcommand('show', async () => {
      try { expect((await r.refresh()).state).toBe('following') } finally { await r.stop() }
      await goneSettled(w.repo)
    })
    expect(tip(w.repo)).not.toBe(was) // the copy moved
    expect(w.store.comments('page:scratch-0001')).toHaveLength(1)
    expect(purgeCursor(w.repo)).toBe(was)
    expect(errors).toHaveBeenCalled()
    await atStart(w); await goneSettled(w.repo)
    expect(w.store.comments('page:scratch-0001')).toEqual([])
    expect(purgeCursor(w.repo)).toBe(tip(w.repo))
  })

  it('the Hub\'s own commits move the cursor: a page it deleted and made again keeps the new page\'s talk at the next start', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch') } })
    await atStart(w); await goneSettled(w.repo)
    rmSync(join(w.repo, 'pages', 'scratch-0001.md'))
    await commitPaths(w.repo, ['pages/scratch-0001.md'], 'page: deleted (the Hub)')
    writeFileSync(join(w.repo, 'pages', 'scratch-0001.md'), joinPage({ id: 'scratch-0001', title: 'Scratch', parent: null, order: 1000, visibility: 'public' }, 'Public now.\n'))
    await commitPaths(w.repo, ['pages/scratch-0001.md'], 'page: made again, public (the Hub)')
    await goneSettled(w.repo)
    expect(purgeCursor(w.repo)).toBe(tip(w.repo))
    await talk(w)
    await atStart(w); await goneSettled(w.repo)
    expect(w.store.comments('page:scratch-0001')).toHaveLength(1)
  })

  // T2c (closing review I-b): at the start, a cursor that is not an ancestor of the trunk (the trunk rewound, or moved to
  // another line, while the server was down). Every path the cursor's line changed past the trunk's is compared at the
  // cursor and at the trunk (absent or wider at the trunk: purged), and the trunk's line is read from the merge-base.
  const written = async (w: World, target: string, id: string) => {
    await w.store.writeConversation({ comments: [{ id, target, parent: null, anchor: null, by: 'steward-a', body: 'Said at its level.', created: NOW.toISOString(),
      edited: null, resolvedBy: null, resolvedAt: null, deleted: null }] })
  }
  const atOps = (id: string, title = 'Scratch') => joinPage({ id, title, parent: null, order: 1000, visibility: `hat:${OPS}` as 'members' }, BODY)
  const moveTrunk = (repo: string, to: string) => {
    const trunk = trunkOf(repo)
    git(repo, 'checkout -q --detach'); git(repo, `branch -f ${trunk} ${to}`); git(repo, `checkout -q ${trunk}`)
  }

  it('a cursor ahead of the trunk (the trunk rewound): a page it narrowed is back at its wider level, and the talk goes', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch'), 'keep-0002': page('keep-0002', 'Keep') } })
    await atStart(w); await goneSettled(w.repo)
    const base = tip(w.repo)
    writeFileSync(join(w.repo, 'pages', 'scratch-0001.md'), atOps('scratch-0001'))
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "page: narrowed to Ops, by hand"')
    await atStart(w); await goneSettled(w.repo) // a narrowing keeps the talk; the cursor moves on
    expect(purgeCursor(w.repo)).toBe(tip(w.repo))
    await written(w, 'page:scratch-0001', 'c-ops')
    await written(w, 'page:keep-0002', 'c-keep')
    moveTrunk(w.repo, base) // rewound by hand while the Hub was stopped
    await atStart(w); await goneSettled(w.repo)
    expect(w.store.comments('page:scratch-0001')).toEqual([])
    expect(w.store.comments('page:keep-0002').map(c => c.id)).toEqual(['c-keep'])
    expect(purgeCursor(w.repo)).toBe(base)
  })

  it('a cursor on an abandoned line: a page it narrowed, and one it added, take their talk; the trunk\'s own line is read from the merge-base', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch'), 'keep-0002': page('keep-0002', 'Keep') } })
    await atStart(w); await goneSettled(w.repo)
    const base = tip(w.repo)
    writeFileSync(join(w.repo, 'pages', 'scratch-0001.md'), atOps('scratch-0001'))
    writeFileSync(join(w.repo, 'pages', 'new-0003.md'), atOps('new-0003', 'New'))
    const projects = readFileSync(join(w.repo, 'data', 'projects.yaml'), 'utf8')
    writeFileSync(join(w.repo, 'data', 'projects.yaml'), projects.replace('{ id: proj-1, title: Seed Fund,', `{ id: proj-1, visibility: "hat:${OPS}", title: Seed Fund,`))
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "abandoned: scratch and seed fund narrowed, a page added"')
    await atStart(w); await goneSettled(w.repo)
    expect(purgeCursor(w.repo)).toBe(tip(w.repo))
    await written(w, 'page:scratch-0001', 'c-ops')
    await written(w, 'page:new-0003', 'c-new')
    await written(w, 'page:keep-0002', 'c-keep')
    await written(w, 'record:projects:proj-1', 'c-seed')
    await written(w, 'record:projects:budget', 'c-budget')
    // The trunk goes another way from the base: keep-0002 edited at its level.
    git(w.repo, `checkout -q --detach ${base}`)
    writeFileSync(join(w.repo, 'pages', 'keep-0002.md'), page('keep-0002', 'Keep', 'Edited on the other line.\n'))
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "other line: keep edited"')
    const other = tip(w.repo)
    git(w.repo, 'checkout -q -'); moveTrunk(w.repo, other)
    await atStart(w); await goneSettled(w.repo)
    expect(w.store.comments('page:scratch-0001')).toEqual([])
    expect(w.store.comments('page:new-0003')).toEqual([])
    expect(w.store.comments('record:projects:proj-1')).toEqual([])
    expect(w.store.comments('page:keep-0002').map(c => c.id)).toEqual(['c-keep'])
    expect(w.store.comments('record:projects:budget').map(c => c.id)).toEqual(['c-budget'])
    expect(purgeCursor(w.repo)).toBe(other)
  })

  // R2b (review I-1): only the first-parent line is read, each merge against its first parent, and a target is purged only
  // when it is absent at the end, or there at a level looser than it had before (at the start, or just before a delete).
  const tip = (repo: string) => git(repo, 'rev-parse HEAD').trim()
  const trunkOf = (repo: string) => git(repo, 'rev-parse --abbrev-ref HEAD').trim()
  // R2b (review I-4): the line is read by one `git log --first-parent -m --name-status` process, not a process per commit;
  // a file is shown only where a level is compared.
  // PR7-R32: a page edited on the line is now compared too (its level at both ends), each file shown once per revision.
  it('goneBetween reads the line in one git log process, and shows files only to compare levels', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch'), 'keep-0002': page('keep-0002', 'Keep') } })
    const from = tip(w.repo)
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(w.repo, 'pages', 'keep-0002.md'), page('keep-0002', 'Keep', `Edit ${i}.\n`))
      git(w.repo, 'add -A'); git(w.repo, `commit -qm "edit ${i}"`)
    }
    git(w.repo, 'rm -q pages/scratch-0001.md'); git(w.repo, 'commit -qm "page deleted"')
    const to = tip(w.repo)
    await withGitTrace(async started => {
      expect(await goneBetween(w.repo, from, to)).toEqual(['page:scratch-0001'])
      const subs = started().map(l => l.split(' ').find(a => !a.startsWith('-')))
      expect(subs.filter(x => x === 'log')).toHaveLength(1)
      expect(subs.filter(x => x !== 'log' && x !== 'show' && x !== 'rev-parse')).toEqual([])
      const shown = started().filter(l => l.split(' ').find(a => !a.startsWith('-')) === 'show')
      expect(new Set(shown).size).toBe(shown.length)
      expect(shown.some(l => l.includes('keep-0002'))).toBe(true)
      expect(started()[0]).toContain('--first-parent -m --no-renames --name-status --format=%H')
    })
    // Made again at its level: its level is read where it is compared, and nothing else is.
    mkdirSync(join(w.repo, 'pages'), { recursive: true })
    writeFileSync(join(w.repo, 'pages', 'scratch-0001.md'), page('scratch-0001', 'Scratch'))
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "made again"')
    await withGitTrace(async started => {
      expect(await goneBetween(w.repo, from, tip(w.repo))).toEqual([])
      const subs = started().map(l => l.split(' ').find(a => !a.startsWith('-')))
      expect(subs.filter(x => x === 'log')).toHaveLength(1)
      expect(subs.filter(x => x !== 'log' && x !== 'show' && x !== 'rev-parse')).toEqual([])
    })
  })

  it('goneBetween: a record removed then put back at its level is kept, put back public is gone, an edit does not count', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch'), 'keep-0002': page('keep-0002', 'Keep') } })
    const from = tip(w.repo)
    const projects = readFileSync(join(w.repo, 'data', 'projects.yaml'), 'utf8')
    const without = (id: string) => projects.split('\n').filter(l => !l.includes(`id: ${id}`)).join('\n')
    writeFileSync(join(w.repo, 'data', 'projects.yaml'), without('budget'))
    writeFileSync(join(w.repo, 'pages', 'keep-0002.md'), page('keep-0002', 'Keep', 'Edited.\n'))
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "elsewhere: budget out, keep edited"')
    writeFileSync(join(w.repo, 'data', 'projects.yaml'), projects)
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "elsewhere: budget back"')
    const back = tip(w.repo)
    expect(await goneBetween(w.repo, from, back)).toEqual([])
    writeFileSync(join(w.repo, 'data', 'projects.yaml'), without('proj-1'))
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "elsewhere: seed fund out"')
    writeFileSync(join(w.repo, 'data', 'projects.yaml'), projects.replace('{ id: proj-1, title: Seed Fund,', '{ id: proj-1, visibility: public, title: Seed Fund,'))
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "elsewhere: seed fund back, public"')
    expect(await goneBetween(w.repo, from, tip(w.repo))).toEqual(['record:projects:proj-1'])
    expect(await goneBetween(w.repo, back, back)).toEqual([])
  })

  it('goneBetween: a deleting branch merged with -s ours keeps the page\'s conversation', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch') } })
    const trunk = trunkOf(w.repo), from = tip(w.repo)
    git(w.repo, 'checkout -qb side'); git(w.repo, 'rm -q pages/scratch-0001.md'); git(w.repo, 'commit -qm "side: page deleted"')
    git(w.repo, `checkout -q ${trunk}`); git(w.repo, 'merge -q -s ours side -m "merge side, ours"')
    expect(existsSync(join(w.repo, 'pages', 'scratch-0001.md'))).toBe(true)
    expect(await goneBetween(w.repo, from, tip(w.repo))).toEqual([])
  })

  it('goneBetween: a page deleted and restored at the same level on a branch, merged without squash, is kept', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch') } })
    const trunk = trunkOf(w.repo), from = tip(w.repo)
    const text = readFileSync(join(w.repo, 'pages', 'scratch-0001.md'), 'utf8')
    git(w.repo, 'checkout -qb side'); git(w.repo, 'rm -q pages/scratch-0001.md'); git(w.repo, 'commit -qm "side: page deleted"')
    mkdirSync(join(w.repo, 'pages'), { recursive: true })
    writeFileSync(join(w.repo, 'pages', 'scratch-0001.md'), text.replace(BODY, 'Restored.\n'))
    git(w.repo, 'add pages/scratch-0001.md'); git(w.repo, 'commit -qm "side: page restored"')
    git(w.repo, `checkout -q ${trunk}`); git(w.repo, 'commit -q --allow-empty -m "trunk moves on"')
    git(w.repo, 'merge -q --no-ff side -m "merge side"')
    expect(await goneBetween(w.repo, from, tip(w.repo))).toEqual([])
    // On the trunk's own line too: deleted, then made again at the same level.
    const mid = tip(w.repo)
    git(w.repo, 'rm -q pages/scratch-0001.md'); git(w.repo, 'commit -qm "page deleted"')
    mkdirSync(join(w.repo, 'pages'), { recursive: true })
    writeFileSync(join(w.repo, 'pages', 'scratch-0001.md'), text)
    git(w.repo, 'add pages/scratch-0001.md'); git(w.repo, 'commit -qm "page made again, members"')
    expect(await goneBetween(w.repo, mid, tip(w.repo))).toEqual([])
  })

  it('goneBetween: a page deleted and made again at public is gone, and so is one a merge deletes', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch'), 'keep-0002': page('keep-0002', 'Keep') } })
    const trunk = trunkOf(w.repo), from = tip(w.repo)
    git(w.repo, 'rm -q pages/scratch-0001.md'); git(w.repo, 'commit -qm "page deleted"')
    writeFileSync(join(w.repo, 'pages', 'scratch-0001.md'), joinPage({ id: 'scratch-0001', title: 'Scratch', parent: null, order: 1000, visibility: 'public' }, 'Public now.\n'))
    git(w.repo, 'add pages/scratch-0001.md'); git(w.repo, 'commit -qm "made again, public"')
    expect(await goneBetween(w.repo, from, tip(w.repo))).toEqual(['page:scratch-0001'])
    // A merge whose side deleted keep-0002: the merge, read against its first parent, deletes it.
    const mid = tip(w.repo)
    git(w.repo, 'checkout -qb side'); git(w.repo, 'rm -q pages/keep-0002.md'); git(w.repo, 'commit -qm "side: keep deleted"')
    git(w.repo, `checkout -q ${trunk}`); git(w.repo, 'commit -q --allow-empty -m "trunk moves on"')
    git(w.repo, 'merge -q --no-ff side -m "merge side"')
    expect(await goneBetween(w.repo, mid, tip(w.repo))).toEqual(['page:keep-0002'])
  })
})

// Rule 4, as amended (PR7-R32, amends PR7-R24): an outside move (the purge cursor's path, never the Hub's own commits) that
// leaves a target present at its end at a looser level than it had at the start purges its conversation, as a delete does.
// A widening made in the Hub asks first (the widen dialog and its count) and keeps the talk; one made outside asked nobody.
// Every repository here is fresh under the temp directory.
describe('Rule 4 (PR7-R32): a widening that comes from outside clears the conversation', () => {
  const tmp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(d); return d }
  const tip = (repo: string) => git(repo, 'rev-parse HEAD').trim()
  const trunkOf = (repo: string) => git(repo, 'rev-parse --abbrev-ref HEAD').trim()
  const atLevel = (id: string, visibility?: string, parent: string | null = null, body = BODY) =>
    // A hat level is written as git holds it (the front's type names members and public only).
    joinPage({ id, title: 'Scratch', parent, order: 1000, ...(visibility !== undefined ? { visibility: visibility as 'members' } : {}) }, body)
  const remoteOf = (repo: string) => {
    const bare = join(tmp('widen-remote-'), 'remote.git')
    git(tmp('widen-init-'), `init -q --bare -b main ${bare}`)
    git(repo, `remote add origin ${bare}`)
    git(repo, 'push -q origin HEAD:refs/heads/main')
    const elsewhere = join(tmp('widen-elsewhere-'), 'clone')
    git(tmp('widen-clone-'), `clone -q ${bare} ${elsewhere}`)
    git(elsewhere, 'config user.email steward-b@example.test')
    git(elsewhere, 'config user.name "Steward B"')
    return elsewhere
  }
  const talk = async (w: World, target = 'page:scratch-0001') => {
    expect((await call(w.app, '/api/comments', json('POST', { target, body: `${mention('steward-c')} members-only talk` }))).status).toBe(201)
  }
  const refresh = async (w: World) => {
    const r = new Refresher({ repo: w.repo, trunk: () => resolveTrunk(w.repo), attention: new ServerAttention(), fetchBlockMs: 10_000 })
    try { expect((await r.refresh()).state).toBe('following') } finally { await r.stop() }
    await goneSettled(w.repo)
  }
  const commitAll = (repo: string, message: string) => { git(repo, 'add -A'); git(repo, `commit -qm "${message}"`) }

  it('a page deleted and made again at public on a side branch, then merged: purged', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch') } })
    const trunk = trunkOf(w.repo), from = tip(w.repo)
    git(w.repo, 'checkout -qb side'); git(w.repo, 'rm -q pages/scratch-0001.md'); git(w.repo, 'commit -qm "side: page deleted"')
    mkdirSync(join(w.repo, 'pages'), { recursive: true })
    writeFileSync(join(w.repo, 'pages', 'scratch-0001.md'), atLevel('scratch-0001', 'public', null, 'Public now.\n'))
    commitAll(w.repo, 'side: page made again, public')
    git(w.repo, `checkout -q ${trunk}`); git(w.repo, 'commit -q --allow-empty -m "trunk moves on"')
    git(w.repo, 'merge -q --no-ff side -m "merge side"')
    expect(await goneBetween(w.repo, from, tip(w.repo))).toEqual(['page:scratch-0001'])
    // A record the side branch removed and put back public, merged the same way: purged too.
    const mid = tip(w.repo)
    const projects = readFileSync(join(w.repo, 'data', 'projects.yaml'), 'utf8')
    git(w.repo, 'checkout -qb side2')
    writeFileSync(join(w.repo, 'data', 'projects.yaml'), projects.split('\n').filter(l => !l.includes('id: proj-1')).join('\n'))
    commitAll(w.repo, 'side2: seed fund out')
    writeFileSync(join(w.repo, 'data', 'projects.yaml'), projects.replace('{ id: proj-1, title: Seed Fund,', '{ id: proj-1, visibility: public, title: Seed Fund,'))
    commitAll(w.repo, 'side2: seed fund back, public')
    git(w.repo, `checkout -q ${trunk}`); git(w.repo, 'commit -q --allow-empty -m "trunk moves on again"')
    git(w.repo, 'merge -q --no-ff side2 -m "merge side2"')
    expect(await goneBetween(w.repo, mid, tip(w.repo))).toEqual(['record:projects:proj-1'])
  })

  it('a plain outside edit of a page\'s level to public: after the refresh its members\' comments are gone', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch') } })
    await talk(w)
    expect(w.store.comments('page:scratch-0001')).toHaveLength(1)
    const elsewhere = remoteOf(w.repo)
    writeFileSync(join(elsewhere, 'pages', 'scratch-0001.md'), atLevel('scratch-0001', 'public'))
    commitAll(elsewhere, 'page: public')
    git(elsewhere, 'push -q origin HEAD:refs/heads/main')
    await refresh(w)
    expect(targetLevel(w.repo, 'page:scratch-0001', w.store)).toEqual({ level: 'public' })
    expect(w.store.comments('page:scratch-0001')).toEqual([])
    expect(w.store.notifications('steward-c')).toEqual([])
  })

  it('goneBetween: an outside widening of a record, of a parent page, or of the policy purges what it widened', async () => {
    const w = await world({ pages: {
      'scratch-0001': page('scratch-0001', 'Scratch'),
      'child-0002': atLevel('child-0002', undefined, 'scratch-0001'),
      'own-0003': atLevel('own-0003', 'members', 'scratch-0001'),
    } })
    const projects = readFileSync(join(w.repo, 'data', 'projects.yaml'), 'utf8')
    // A record's own level, edited in git.
    let from = tip(w.repo)
    writeFileSync(join(w.repo, 'data', 'projects.yaml'), projects.replace('{ id: proj-1, title: Seed Fund,', '{ id: proj-1, visibility: public, title: Seed Fund,'))
    commitAll(w.repo, 'elsewhere: seed fund public')
    expect(await goneBetween(w.repo, from, tip(w.repo))).toEqual(['record:projects:proj-1'])
    // A parent page made public: the page and the subpage that inherits its level; the one with its own level stays.
    from = tip(w.repo)
    writeFileSync(join(w.repo, 'pages', 'scratch-0001.md'), atLevel('scratch-0001', 'public'))
    commitAll(w.repo, 'elsewhere: scratch public')
    expect((await goneBetween(w.repo, from, tip(w.repo))).sort()).toEqual(['page:child-0002', 'page:scratch-0001'])
    // The policy: projects' default loosened to public takes budget (proj-1 is public already).
    from = tip(w.repo)
    writeFileSync(join(w.repo, 'data', 'visibility.yaml'), VISIBILITY.replace('projects: { default: members }', 'projects: { default: public }'))
    commitAll(w.repo, 'elsewhere: projects public by default')
    expect(await goneBetween(w.repo, from, tip(w.repo))).toEqual(['record:projects:budget'])
  })

  // T2c (closing review I-c): a lagging cursor (a read that failed) must not miss a narrowing the Hub served in between.
  // Public → Ops (the purge's read failed, so the cursor stayed) → public again: the Ops talk would be public. A target the
  // line changed is compared at the end against the strictest level it held at any revision of the line.
  it('a lagging cursor: public, then Ops (its read failed), then public again takes the talk written at Ops', async () => {
    const w = await world({ pages: {
      'scratch-0001': atLevel('scratch-0001', 'public'),
      'child-0002': atLevel('child-0002', undefined, 'scratch-0001'),
      'keep-0002': page('keep-0002', 'Keep'),
    } })
    await trunkAtStart(w.repo, () => resolveTrunk(w.repo), new Date()); await goneSettled(w.repo)
    const start = tip(w.repo)
    const elsewhere = remoteOf(w.repo)
    const projects = readFileSync(join(elsewhere, 'data', 'projects.yaml'), 'utf8')
    writeFileSync(join(elsewhere, 'pages', 'scratch-0001.md'), atLevel('scratch-0001', `hat:${OPS}`))
    writeFileSync(join(elsewhere, 'data', 'projects.yaml'), projects.replace('{ id: proj-1, title: Seed Fund,', `{ id: proj-1, visibility: "hat:${OPS}", title: Seed Fund,`))
    commitAll(elsewhere, 'elsewhere: scratch and seed fund narrowed to Ops')
    git(elsewhere, 'push -q origin HEAD:refs/heads/main')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await withFailingSubcommand('show', () => refresh(w))
    expect(errors).toHaveBeenCalled()
    expect(purgeCursor(w.repo)).toBe(start) // the read failed: the cursor stayed
    for (const target of ['page:scratch-0001', 'page:child-0002', 'record:projects:proj-1', 'page:keep-0002', 'record:projects:budget']) {
      await w.store.writeConversation({ comments: [{ id: `c-${target}`, target, parent: null, anchor: null, by: 'steward-a', body: 'Said at Ops.', created: NOW.toISOString(),
        edited: null, resolvedBy: null, resolvedAt: null, deleted: null }] })
    }
    writeFileSync(join(elsewhere, 'pages', 'scratch-0001.md'), atLevel('scratch-0001', 'public'))
    writeFileSync(join(elsewhere, 'data', 'projects.yaml'), projects)
    commitAll(elsewhere, 'elsewhere: public again, seed fund members again')
    git(elsewhere, 'push -q origin HEAD:refs/heads/main')
    await refresh(w)
    expect(purgeCursor(w.repo)).toBe(tip(w.repo))
    expect(w.store.comments('page:scratch-0001')).toEqual([])
    expect(w.store.comments('page:child-0002')).toEqual([])
    expect(w.store.comments('record:projects:proj-1')).toEqual([])
    expect(w.store.comments('page:keep-0002')).toHaveLength(1)
    expect(w.store.comments('record:projects:budget')).toHaveLength(1)
  })

  it('an outside edit that narrows the level, or keeps it, keeps the conversation', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch'), 'keep-0002': page('keep-0002', 'Keep') } })
    await talk(w)
    const elsewhere = remoteOf(w.repo)
    const from = tip(w.repo)
    const projects = readFileSync(join(elsewhere, 'data', 'projects.yaml'), 'utf8')
    writeFileSync(join(elsewhere, 'pages', 'scratch-0001.md'), atLevel('scratch-0001', `hat:${OPS}`)) // narrowed
    writeFileSync(join(elsewhere, 'pages', 'keep-0002.md'), atLevel('keep-0002', 'members', null, 'Edited.\n')) // the same level, said
    writeFileSync(join(elsewhere, 'data', 'projects.yaml'), projects.replace('{ id: proj-1, title: Seed Fund,', `{ id: proj-1, visibility: "hat:${OPS}", title: Seed Fund,`)
      .replace('{ id: budget, title: Budget,', '{ id: budget, title: Budget two,'))
    commitAll(elsewhere, 'elsewhere: narrowed and edited')
    writeFileSync(join(elsewhere, 'data', 'visibility.yaml'), VISIBILITY.replace('projects: { default: members }', `projects: { default: "hat:${OPS}" }`))
    commitAll(elsewhere, 'elsewhere: projects narrowed by default')
    git(elsewhere, 'push -q origin HEAD:refs/heads/main')
    await refresh(w)
    expect(await goneBetween(w.repo, from, tip(w.repo))).toEqual([])
    expect(w.store.comments('page:scratch-0001')).toHaveLength(1)
  })

  it('a widening made through the Hub keeps the conversation (it asked first)', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch') } })
    await trunkAtStart(w.repo, () => resolveTrunk(w.repo), new Date()); await goneSettled(w.repo)
    await talk(w)
    writeFileSync(join(w.repo, 'pages', 'scratch-0001.md'), atLevel('scratch-0001', 'public'))
    await commitPaths(w.repo, ['pages/scratch-0001.md'], 'page: public (the Hub, after the widen dialog)')
    await goneSettled(w.repo)
    expect(purgeCursor(w.repo)).toBe(tip(w.repo))
    await trunkAtStart(w.repo, () => resolveTrunk(w.repo), new Date()); await goneSettled(w.repo)
    expect(w.store.comments('page:scratch-0001')).toHaveLength(1)
  })
})
