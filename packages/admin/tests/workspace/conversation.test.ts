import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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
import { goneSettled, housekeepAtStart, tombstones } from '../../server/workspace/gone.ts'
import { UNFILLED } from '../../server/workspace/written.ts'
import { gateEvent } from '../../server/visibility/gate.ts'
import { commitPaths } from '../../server/git.ts'
import { Refresher } from '../../server/hosted/refresh.ts'
import { ServerAttention } from '../../server/attention.ts'
import { resolveTrunk } from '../../server/proposals/ledger.ts'
import { stateDir } from '../../server/state.ts'
import {
  ANCHOR_CHANGED, ANCHOR_MAX_CHARS, COMMENT_MAX_CHARS, COMMENT_TOO_LONG, NOT_TOLD, commentView, mentionablesFor, mountConversation,
  targetLevel, tell, tellAtCommit, viewerFor, type CommentRow, type Target, TASK_ALREADY, TASK_NO_LEVEL, plainLine,
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
      { source: `comment:${sent.body.comment.id}`, kind: 'member', ref: 'steward-b', told: true, writtenLevel: `hat:${OPS}` },
      { source: `comment:${sent.body.comment.id}`, kind: 'member', ref: 'steward-c', told: false, writtenLevel: `hat:${OPS}` },
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
      created: NOW.toISOString(), edited: null, resolvedBy: null, resolvedAt: null, deleted: null, writtenLevel: 'members' }
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

// PR7-R45, the conversation floor: every comment, reply, mention and notification keeps the level its target had when it was
// written, and is read only by a viewer admitted to both that level and the target's level now. A widening, made in the Hub
// or outside it, a delete and re-make, never shows earlier talk to anyone it did not admit then. Every repository and store
// here is fresh under the temp directory; a remote is a bare repository beside it.
describe('PR7-R45: the conversation floor (a row is read at its target\'s level now and the level it was written at)', () => {
  const T = 'page:scratch-0001'
  const OPS_LEVEL = `hat:${OPS}`
  const tmp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(d); return d }
  const atLevel = (id: string, visibility?: string, body = BODY) =>
    // A hat level is written as git holds it (the front's type names members and public only).
    joinPage({ id, title: 'Scratch', parent: null, order: 1000, ...(visibility !== undefined ? { visibility: visibility as 'members' } : {}) }, body)
  const remoteOf = (repo: string) => {
    const bare = join(tmp('floor-remote-'), 'remote.git')
    git(tmp('floor-init-'), `init -q --bare -b main ${bare}`)
    git(repo, `remote add origin ${bare}`)
    git(repo, 'push -q origin HEAD:refs/heads/main')
    const elsewhere = join(tmp('floor-elsewhere-'), 'clone')
    git(tmp('floor-clone-'), `clone -q ${bare} ${elsewhere}`)
    git(elsewhere, 'config user.email steward-b@example.test')
    git(elsewhere, 'config user.name "Steward B"')
    return elsewhere
  }
  const commitAll = (repo: string, message: string) => { git(repo, 'add -A'); git(repo, `commit -qm "${message}"`) }
  const refresh = async (w: World) => {
    const r = new Refresher({ repo: w.repo, trunk: () => resolveTrunk(w.repo), attention: new ServerAttention(), fetchBlockMs: 10_000 })
    try { expect((await r.refresh()).state).toBe('following') } finally { await r.stop() }
    await goneSettled(w.repo)
  }
  /** The Hub's own commit of the page at `level` (what the apply of a decided widening or a narrowing commits). */
  const hubLevel = async (w: World, level: string) => {
    writeFileSync(join(w.repo, 'pages', 'scratch-0001.md'), atLevel('scratch-0001', level))
    await commitPaths(w.repo, ['pages/scratch-0001.md'], `page: ${level} (the Hub)`)
    await goneSettled(w.repo)
  }
  /** The thread `who` reads: each comment's body, a reply after the comment it is under. */
  const thread = async (w: World, who: (repo: string) => void, query = '') => {
    who(w.repo)
    const got = await call(w.app, `/api/comments?target=${T}${query}`)
    asA(w.repo)
    if (got.status !== 200) return got.status
    return (got.body as { body: string; replies: { body: string }[] }[]).flatMap(c => [c.body, ...c.replies.map(r => r.body)])
  }
  /** Rows written at the fixed clock are ordered by their random ids: several are compared as a set. */
  const sorted = (got: unknown) => (got as string[]).slice().sort()
  const sources = async (w: World, who: (repo: string) => void) => {
    who(w.repo)
    const got = await call(w.app, '/api/notifications')
    asA(w.repo)
    return (got.body as { source: string }[]).map(n => n.source)
  }
  /** `scratch-0001`, a git page at hat:Ops, and its talk: steward-a's comment telling steward-b (who wears Ops), and a reply. */
  const opsTalk = async () => {
    const w = await world({ pages: { 'scratch-0001': atLevel('scratch-0001', OPS_LEVEL) } })
    await w.prime(A1, A2)
    const top = await call(w.app, '/api/comments', json('POST', { target: T, body: `${mention('steward-b')} Ops talk` }))
    expect(top.status).toBe(201)
    expect(top.body.notTold).toEqual([])
    const reply = await call(w.app, '/api/comments', json('POST', { target: T, body: 'Ops reply', parent: top.body.comment.id }))
    expect(reply.status).toBe(201)
    expect(w.store.comment(top.body.comment.id)?.writtenLevel).toBe(OPS_LEVEL)
    expect(w.store.notifications('steward-b').map(n => n.writtenLevel)).toEqual([OPS_LEVEL])
    return { w, top: top.body.comment.id as string, reply: reply.body.comment.id as string }
  }
  const OPS_TALK = [`${mention('steward-b')} Ops talk`, 'Ops reply']

  it('a widening in the Hub: steward-c reads none of the earlier talk, steward-b all of it; a comment written after it is read at the new level', async () => {
    const { w, top } = await opsTalk()
    await hubLevel(w, 'members')
    expect(targetLevel(w.repo, T, w.store)).toEqual({ level: 'members' })
    // The rows stay: nothing is purged, they are read at both levels.
    expect(w.store.comments(T)).toHaveLength(2)
    expect(await thread(w, asC)).toEqual([])
    expect(await sources(w, asC)).toEqual([])
    expect(await thread(w, asB)).toEqual(OPS_TALK)
    expect(await sources(w, asB)).toEqual([`comment:${top}`])
    // A preview as a member with no hat reads what steward-c reads; the public reads no conversation at all (sign in).
    expect(await thread(w, asA, '&as=members')).toEqual([])
    expect(await thread(w, asA, '&as=public')).toBe(401)
    // Written after the widening: read at members, and steward-c is told.
    const after = await call(w.app, '/api/comments', json('POST', { target: T, body: `${mention('steward-c')} members talk` }))
    expect(after.body.notTold).toEqual([])
    expect(w.store.comment(after.body.comment.id)?.writtenLevel).toBe('members')
    expect(await thread(w, asC)).toEqual([`${mention('steward-c')} members talk`])
    expect(await sources(w, asC)).toEqual([`comment:${after.body.comment.id}`])
    expect(sorted(await thread(w, asB))).toEqual(sorted([...OPS_TALK, `${mention('steward-c')} members talk`]))
  })

  it('a reply written after the widening under earlier talk is read only with it, and tells nobody the talk above it does not admit', async () => {
    const { w, top } = await opsTalk()
    await hubLevel(w, 'members')
    const reply = await call(w.app, '/api/comments', json('POST', { target: T, body: `${mention('steward-c')} a late reply`, parent: top }))
    expect(reply.status).toBe(201)
    expect(reply.body.notTold).toEqual([NOT_TOLD('steward-c')])
    expect(w.store.notifications('steward-c')).toEqual([])
    expect(await thread(w, asC)).toEqual([])
    expect(sorted(await thread(w, asB))).toEqual(sorted([...OPS_TALK, `${mention('steward-c')} a late reply`]))
  })

  it('an outside widening (the Refresher takes it): the same', async () => {
    const { w, top } = await opsTalk()
    const elsewhere = remoteOf(w.repo)
    writeFileSync(join(elsewhere, 'pages', 'scratch-0001.md'), atLevel('scratch-0001', 'members'))
    commitAll(elsewhere, 'page: members')
    git(elsewhere, 'push -q origin HEAD:refs/heads/main')
    await refresh(w)
    expect(targetLevel(w.repo, T, w.store)).toEqual({ level: 'members' })
    expect(w.store.comments(T)).toHaveLength(2)
    expect(await thread(w, asC)).toEqual([])
    expect(await thread(w, asB)).toEqual(OPS_TALK)
    expect(await sources(w, asB)).toEqual([`comment:${top}`])
  })

  it('an outside delete and re-make at public: the old talk is read only by those who could read it then', async () => {
    const { w } = await opsTalk()
    const elsewhere = remoteOf(w.repo)
    git(elsewhere, 'rm -q pages/scratch-0001.md'); git(elsewhere, 'commit -qm "page: deleted"')
    mkdirSync(join(elsewhere, 'pages'), { recursive: true })
    writeFileSync(join(elsewhere, 'pages', 'scratch-0001.md'), atLevel('scratch-0001', 'public', 'Public now.\n'))
    commitAll(elsewhere, 'page: made again, public')
    git(elsewhere, 'push -q origin HEAD:refs/heads/main')
    await refresh(w)
    expect(targetLevel(w.repo, T, w.store)).toEqual({ level: 'public' })
    expect(await thread(w, asC)).toEqual([])
    expect(await thread(w, asA, '&as=members')).toEqual([])
    expect(await thread(w, asB)).toEqual(OPS_TALK)
  })

  it('a narrowing: the stricter level now hides the talk from those it no longer admits', async () => {
    const w = await world({ pages: { 'scratch-0001': atLevel('scratch-0001') } })
    await w.prime(A1, A2)
    expect((await call(w.app, '/api/comments', json('POST', { target: T, body: 'members talk' }))).status).toBe(201)
    expect(await thread(w, asC)).toEqual(['members talk'])
    await hubLevel(w, OPS_LEVEL)
    expect(await thread(w, asC)).toBe(404)
    expect(await thread(w, asB)).toEqual(['members talk'])
  })

  it('a page narrowed and widened back keeps all its talk, each row read as it was written', async () => {
    const w = await world({ pages: { 'scratch-0001': atLevel('scratch-0001') } })
    await w.prime(A1, A2)
    expect((await call(w.app, '/api/comments', json('POST', { target: T, body: 'members talk' }))).status).toBe(201)
    await hubLevel(w, OPS_LEVEL)
    asB(w.repo)
    expect((await call(w.app, '/api/comments', json('POST', { target: T, body: 'Ops talk' }))).status).toBe(201)
    asA(w.repo)
    await hubLevel(w, 'members')
    expect(await thread(w, asC)).toEqual(['members talk'])
    // Both written at the fixed clock: the thread orders them by id, so they are compared as a set.
    expect(sorted(await thread(w, asB))).toEqual(['Ops talk', 'members talk'])
  })

  it('every reader of a hidden comment answers as for one that is not there: its acts, a reply to it, its notification, a read\'s count', async () => {
    const { w, top, reply } = await opsTalk()
    await hubLevel(w, 'members')
    // A notification steward-c could only have had while wearing Ops (written at Ops), and one on the page now: one is read.
    const told = (id: string, source: string, written: string) => ({ id, member: 'steward-c', kind: 'mention' as const, target: T, source, by: 'steward-a',
      created: NOW.toISOString(), readAt: null, writtenLevel: written })
    await w.store.writeConversation({ notifications: [told('n-hidden', `comment:${top}`, OPS_LEVEL), told('n-page', T, 'members')] })
    asC(w.repo)
    expect((await call(w.app, '/api/notifications')).body.map((n: { id: string }) => n.id)).toEqual(['n-page'])
    for (const id of [top, reply]) {
      for (const act of ['resolve', 'reopen', 'task']) expect(await call(w.app, `/api/comments/${id}/${act}`, json('POST')), `${act} ${id}`).toEqual({ status: 404, body: { error: `There is no comment ${id}.` } })
      expect(await call(w.app, `/api/comments/${id}`, json('DELETE'))).toEqual({ status: 404, body: { error: `There is no comment ${id}.` } })
      expect(await call(w.app, '/api/comments', json('POST', { target: T, body: 'An answer.', parent: id }))).toEqual({ status: 404, body: { error: `There is no comment ${id}.` } })
    }
    expect(await call(w.app, '/api/notifications/read', json('POST', { ids: ['n-hidden'] }))).toEqual({ status: 200, body: { read: 0 } })
    // Opening the page marks and counts only what steward-c may read; the hidden row is left as it was.
    expect((await call(w.app, '/api/reads', json('POST', { target: T }))).body).toMatchObject({ read: 1 })
    expect(w.store.notifications('steward-c').map(n => [n.id, n.readAt !== null])).toEqual([['n-page', true], ['n-hidden', false]])
    asA(w.repo)
  })

  // T2e C1 (Rule 4): Turn into a task takes the floor of the comment (its target's level now, the level it was written at,
  // and those of the comments above it). Git only when every one of them is members or public; else a private task at the
  // narrowest of them; none narrowest (a hat and a role): refused, naming nothing.
  it('Turn into a task on talk written at Ops, its page widened to members since: a task kept at Ops in the store, nothing in git', async () => {
    const { w, top } = await opsTalk()
    await hubLevel(w, 'members')
    const before = commits(w.repo)
    const tasksFile = () => (existsSync(join(w.repo, 'data', 'tasks.yaml')) ? readFileSync(join(w.repo, 'data', 'tasks.yaml'), 'utf8') : '')
    const made = await call(w.app, `/api/comments/${top}/task`, json('POST'))
    expect(made.status).toBe(201)
    expect(made.body).toEqual({ task: expect.stringMatching(/^t-[0-9a-f]{12}$/), visibility: OPS_LEVEL })
    expect(w.store.record('tasks', made.body.task)).toMatchObject({ visibility: OPS_LEVEL, body: { title: '@steward-b Ops talk', page: 'scratch-0001' } })
    // A reply written at members after the widening, under the Ops talk: its task is kept at Ops too.
    const late = await call(w.app, '/api/comments', json('POST', { target: T, body: 'Late members reply', parent: top }))
    expect(w.store.comment(late.body.comment.id)?.writtenLevel).toBe('members')
    const lateTask = await call(w.app, `/api/comments/${late.body.comment.id}/task`, json('POST'))
    expect(lateTask.status).toBe(201)
    expect(lateTask.body).toEqual({ task: expect.stringMatching(/^t-[0-9a-f]{12}$/), visibility: OPS_LEVEL })
    expect(commits(w.repo)).toBe(before)
    expect(tasksFile()).not.toContain('Ops talk')
    expect(tasksFile()).not.toContain('Late members reply')
    expect(git(w.repo, 'log --format=%B')).not.toContain('Ops talk')
    expect(git(w.repo, 'log --format=%B')).not.toContain('Late members reply')
    // A members comment on the members page: git, as before (one commit, the task linked to the page).
    const open = await call(w.app, '/api/comments', json('POST', { target: T, body: 'Members can do this' }))
    const gitTask = await call(w.app, `/api/comments/${open.body.comment.id}/task`, json('POST'))
    expect(gitTask.status).toBe(201)
    expect(gitTask.body).toMatchObject({ task: 'members-can-do-this', commit: expect.any(String) })
    expect(commits(w.repo)).toBe(before + 1)
    expect(tasksFile()).toContain('page: scratch-0001')
  })

  it('Turn into a task on talk written at a role, its page at a hat now: no level is narrower than both, so it is refused (409), naming nothing', async () => {
    const w = await world({ pages: { 'scratch-0001': atLevel('scratch-0001', 'role:stewards') } })
    await w.prime(A1, A2)
    const sent = await call(w.app, '/api/comments', json('POST', { target: T, body: 'Stewards talk' }))
    expect(sent.status).toBe(201)
    expect(w.store.comment(sent.body.comment.id)?.writtenLevel).toBe('role:stewards')
    await hubLevel(w, OPS_LEVEL)
    expect(await thread(w, asA)).toEqual(['Stewards talk']) // steward-a holds stewards and wears Ops: they read it
    const before = commits(w.repo)
    const tasks = w.store.records('tasks').length
    const refused = await call(w.app, `/api/comments/${sent.body.comment.id}/task`, json('POST'))
    expect(refused).toEqual({ status: 409, body: { error: TASK_NO_LEVEL, code: 'NO_LEVEL' } })
    expect(TASK_NO_LEVEL).not.toMatch(/stewards|hat|role|Ops|0x/i)
    expect(w.store.records('tasks')).toHaveLength(tasks)
    expect(commits(w.repo)).toBe(before)
    expect(w.store.comment(sent.body.comment.id)?.task ?? null).toBeNull()
  })

  it('a conversation event names the floor of what changed: it reaches only those admitted to it, and the floor is not sent', async () => {
    const { w, top } = await opsTalk()
    await hubLevel(w, 'members')
    const heard: unknown[] = []
    const app = createApp(w.repo, (a, ctx) => {
      mountConversation(a, { repo: w.repo, membership: w.membership, privateStore: ctx.privateStore, withLock: ctx.withLock, now: () => NOW, notify: m => { heard.push(m) } })
    }, { request: withRequest({ repo: w.repo, hosted: false, membership: w.membership, store: w.store, now: () => NOW }), privateStore: () => w.store })
    expect((await call(app, `/api/comments/${top}/resolve`, json('POST'))).status).toBe(200)
    expect(heard).toEqual([{ type: 'conversation', target: T, written: [OPS_LEVEL] }])
    const levelOf = () => ({ level: 'members' }) as const
    const c = viewerFor('steward-c', { repo: w.repo, membership: w.membership })
    const b = viewerFor('steward-b', { repo: w.repo, membership: w.membership })
    expect(gateEvent(c, heard[0] as { type: string; target: string; written: string[] }, levelOf)).toBeNull()
    expect(gateEvent(b, heard[0] as { type: string; target: string; written: string[] }, levelOf)).toEqual({ type: 'conversation', target: T })
  })
})

// PR7-R45, housekeeping: after each trunk move by the Refresher or Sync, and at the start, the conversation of targets that do
// not exist now goes. No history is read; a target that is there keeps its talk, and one whose file cannot be read too.
describe('PR7-R45: the housekeeping purge (targets that are not there now)', () => {
  const tmp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(d); return d }
  const T = 'page:scratch-0001'

  it('the Refresher\'s move: the talk of a page deleted outside goes, its notifications and read marks too', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch'), 'keep-0001': page('keep-0001', 'Keep') } })
    expect((await call(w.app, '/api/comments', json('POST', { target: T, body: `${mention('steward-c')} old talk` }))).status).toBe(201)
    expect((await call(w.app, '/api/comments', json('POST', { target: 'page:keep-0001', body: 'kept talk' }))).status).toBe(201)
    await call(w.app, '/api/reads', json('POST', { target: T }))
    const bare = join(tmp('keep-remote-'), 'remote.git')
    git(tmp('keep-init-'), `init -q --bare -b main ${bare}`)
    git(w.repo, `remote add origin ${bare}`); git(w.repo, 'push -q origin HEAD:refs/heads/main')
    const elsewhere = join(tmp('keep-elsewhere-'), 'clone')
    git(tmp('keep-clone-'), `clone -q ${bare} ${elsewhere}`)
    git(elsewhere, 'config user.email steward-b@example.test'); git(elsewhere, 'config user.name "Steward B"')
    git(elsewhere, 'rm -q pages/scratch-0001.md'); git(elsewhere, 'commit -qm "page: deleted"')
    git(elsewhere, 'push -q origin HEAD:refs/heads/main')
    const r = new Refresher({ repo: w.repo, trunk: () => resolveTrunk(w.repo), attention: new ServerAttention(), fetchBlockMs: 10_000 })
    try { expect((await r.refresh()).state).toBe('following') } finally { await r.stop() }
    await goneSettled(w.repo)
    expect(w.store.comments(T)).toEqual([])
    expect(w.store.notifications('steward-c')).toEqual([])
    expect(w.store.readOf('steward-a', T)).toBeNull()
    expect(w.store.comments('page:keep-0001').map(c => c.body)).toEqual(['kept talk'])
  })

  it('at the start: a page deleted while the server was down takes its talk; a record whose file cannot be read keeps its own', async () => {
    const w = await world({ pages: { 'scratch-0001': page('scratch-0001', 'Scratch') } })
    expect((await call(w.app, '/api/comments', json('POST', { target: T, body: 'old talk' }))).status).toBe(201)
    expect((await call(w.app, '/api/comments', json('POST', { target: 'record:projects:proj-1', body: 'on the seed fund' }))).status).toBe(201)
    expect((await call(w.app, '/api/comments', json('POST', { target: `page:${OPS_PAGE}`, body: 'on the runbook' }))).status).toBe(201)
    git(w.repo, 'rm -q pages/scratch-0001.md'); git(w.repo, 'commit -qm "page: deleted by hand"')
    writeFileSync(join(w.repo, 'data', 'projects.yaml'), 'projects: [ {id: proj-1\n') // not YAML: unreadable, not absent
    git(w.repo, 'add data/projects.yaml'); git(w.repo, 'commit -qm "projects: broken by hand"')
    await housekeepAtStart(w.repo)
    await goneSettled(w.repo)
    expect(w.store.comments(T)).toEqual([])
    expect(w.store.comments('record:projects:proj-1').map(c => c.body)).toEqual(['on the seed fund'])
    expect(w.store.comments(`page:${OPS_PAGE}`).map(c => c.body)).toEqual(['on the runbook'])
  })

  it('rows written before the column existed are filled once with their target\'s level then; one on a target not there admits nobody', async () => {
    const w = await world({ pages: { 'scratch-0001': joinPage({ id: 'scratch-0001', title: 'Scratch', parent: null, order: 1000, visibility: `hat:${OPS}` as 'members' }, BODY) } })
    await w.prime(A1, A2)
    expect((await call(w.app, '/api/comments', json('POST', { target: T, body: `${mention('steward-b')} before the column` }))).status).toBe(201)
    await w.store.writeConversation({ comments: [{ id: 'c-orphan', target: 'page:gone-0001', parent: null, anchor: null, by: 'steward-a', body: 'orphan',
      created: NOW.toISOString(), edited: null, resolvedBy: null, resolvedAt: null, deleted: null, writtenLevel: 'members' }] })
    // The store as schema 3 left it before PR7-R45: no written_level anywhere.
    const file = w.store.file
    w.store.close(); stores.splice(stores.indexOf(w.store), 1)
    const db = new DatabaseSync(file)
    try { for (const t of ['comments', 'mentions', 'notifications']) db.exec(`ALTER TABLE ${t} DROP COLUMN written_level`) } finally { db.close() }
    const again = await openPrivateStore(w.repo, { dir: dirname(file) }); stores.push(again)
    expect(again.comments(T).map(c => c.writtenLevel)).toEqual([UNFILLED])
    // The page is widened before the start fills them: they take the level of the moment the migration runs.
    writeFileSync(join(w.repo, 'pages', 'scratch-0001.md'), joinPage({ id: 'scratch-0001', title: 'Scratch', parent: null, order: 1000 }, BODY))
    const app = w.appWith(() => again)
    await housekeepAtStart(w.repo); await goneSettled(w.repo)
    expect(again.comments(T).map(c => c.writtenLevel)).toEqual(['members'])
    expect(again.notifications('steward-b').map(n => n.writtenLevel)).toEqual(['members'])
    expect(again.comment('c-orphan')).toBeNull() // its target is not there: housekeeping took it
    asC(w.repo)
    expect((await call(app, `/api/comments?target=${T}`)).body.map((c: { body: string }) => c.body)).toEqual([`${mention('steward-b')} before the column`])
    asA(w.repo)
  })
})
