import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { resolveActor } from '../../server/actor.ts'
import { actorOf, viewerOf, withRequest } from '../../server/request.ts'
import { commitDataPaths, commitMerge, mergeNoFf } from '../../server/git.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { Membership } from '../../server/session/membership.ts'
import { createSession } from '../../server/session/sessions.ts'
import { mountSession } from '../../server/session/routes.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { HOUSE_IDENT, parseTrailers } from '../../lib/trailers.mjs'
import type { WearerReading } from '../../server/systems/hats.ts'
import type { WearerRefusal } from '../../server/systems/reader.ts'

// L5 spec §6 (the actor), §3 (hosted mode) and §6.4 (the house's commits), against fresh repositories under the temp
// directory (makeChangeRepo), a private store in a temp folder of its own and a fake Hats reader (no network, S13).
// Sessions are made with createSession, as a sign-in that passed makes them (Task 6 tests the sign-in itself).

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const STEWARDS = `${CELO}:0x0000000d00010001${'0'.repeat(48)}` // below Council in the tree
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
// EIP-55 of …a1 and …a2 (the letter is upper case), as tests/session/membership.test.ts computed them apart from lib/caip.mjs.
const A1_ID = `${CELO}:0x00000000000000000000000000000000000000A1`
const A2_ID = `${CELO}:0x00000000000000000000000000000000000000A2`
const T0 = new Date('2026-10-29T10:00:00.000Z')
const SIGN_IN = 'Sign in to change anything here.'

const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const SOLO_TREE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    stewards: { hat: "${STEWARDS}" }
  decisions: []
`
/** steward-a commits here (admin-test@local) and lists …a2 as their wallet; steward-b and ana list none. */
const MEMBERS = (wallet = `\n      wallet: ["${CELO}:0x00000000000000000000000000000000000000a2"]`) => `schema_version: "2.0"
members:
  - id: "steward-a"
    name: "Steward A"
    kind: "person"
    handles:
      git: ["admin-test@local"]${wallet}
  - id: "steward-b"
    name: "Steward B"
    kind: "person"
  - id: "ana"
    name: "Ana Silva"
    kind: "person"
`
const PROJECT = { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }

type Answer = (account: string) => WearerReading | WearerRefusal
const wears = (hats: string[], block = 100): Answer => account => ({ ok: true, system: 'hats-main', chain: CELO, account, hats, block, readAt: T0.toISOString() })
const FAILED: Answer = () => ({ ok: false, failed: true, error: 'the tree could not be read: rpc down' })

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A repository with the tree, the governance and the members committed; its own store; the app with the request
 *  middleware, the session routes and a probe that answers what the middleware set. */
async function house(o: { hosted?: boolean; governance?: string; members?: string; answer?: Answer; repo?: string; extend?: (a: Hono, withLock: <T>(fn: () => Promise<T>) => Promise<T>, repo: string) => void } = {}) {
  let repo = o.repo
  if (!repo) {
    repo = makeChangeRepo(o.governance ?? SOLO_TREE)
    cleanup.push(repo)
    writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
    writeFileSync(join(repo, 'data', 'members.yaml'), o.members ?? MEMBERS())
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree and its members"')
  }
  const dir = mkdtempSync(join(tmpdir(), 'actor-store-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const state = { answer: o.answer ?? wears([COUNCIL]) }
  const now = () => T0
  const reader = {
    wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => state.answer(account)),
    wearers: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
  }
  const membership = new Membership({ repo, reader, now })
  const hosted = o.hosted ?? false
  const app = createApp(repo, (a, ctx) => {
    mountSession(a, { repo, store, membership, hosted, now })
    a.get('/api/probe', c => c.json({ actor: actorOf(c), viewer: viewerOf(c) }))
    a.post('/api/probe', c => c.json({ actor: actorOf(c), viewer: viewerOf(c) }))
    o.extend?.(a, ctx.withLock, repo!)
  }, { request: withRequest({ repo, hosted, membership, store, now }) })
  /** A session for `account`, made as a sign-in that passed makes it: the reading kept, then the session. */
  const signIn = async (account: string) => {
    await membership.forAct(account)
    const { token } = await createSession(store, account, now)
    return `house_session=${token}`
  }
  return { app, repo: repo!, store, state, reader, membership, signIn }
}

function call(app: Hono, method: string, path: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: 'localhost:4680' }
  if (method !== 'GET') headers['content-type'] = 'application/json' // the guard's ask of every write (guard.ts)
  if (o.cookie) headers.cookie = o.cookie
  return app.request(`http://localhost:4680${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
}
const probe = async (app: Hono, cookie?: string, method = 'GET') => (await call(app, method, '/api/probe', { cookie })).json()
const settle = () => new Promise(r => setTimeout(r, 0))
const head = (repo: string) => git(repo, 'rev-parse HEAD').trim()
const count = (repo: string) => Number(git(repo, 'rev-list --count HEAD').trim())
const idents = (repo: string, rev = 'HEAD') => git(repo, `log -1 "--format=%an <%ae>%n%cn <%ce>" ${rev}`).trim().split('\n')
const HOUSE = `${HOUSE_IDENT.name} <${HOUSE_IDENT.email}>`

describe('the actor comes with the request (L5 spec §6.2, §6.3)', () => {
  it('local, no session: the git actor, exactly as resolveActor', async () => {
    const { app, repo, reader } = await house({ members: MEMBERS('') })
    const expected = await resolveActor(repo)
    expect(expected).toEqual({ id: 'steward-a', name: 'Steward A', kind: 'person' })
    expect(await (await call(app, 'GET', '/api/actor')).json()).toEqual(expected)
    expect(await probe(app)).toEqual({ actor: expected, viewer: { kind: 'member', id: 'steward-a', hats: [], roles: ['maintainer'] } })
    expect(reader.wearer).not.toHaveBeenCalled() // no wallet, nothing to read
  })

  it('local, no session: git\'s address is read again when the repository\'s git config changes', async () => {
    const { app, repo } = await house({ members: MEMBERS('') })
    expect((await probe(app)).actor).toMatchObject({ id: 'steward-a' })
    expect((await probe(app)).actor).toMatchObject({ id: 'steward-a' })
    git(repo, 'config user.email stranger@local')
    expect((await probe(app)).actor).toEqual({ unknown: 'stranger@local' })
    expect((await call(app, 'POST', '/api/changes/ops', { body: { ops: [PROJECT] } })).status).toBe(403)
  })

  it('local, a member with handles.wallet: their hats are read for acts (§6.2), and for reads in the background', async () => {
    const { app, repo, reader } = await house()
    const git0 = await resolveActor(repo)
    // A read never waits on the network: no reading yet, so no hats, and one is started.
    expect(await probe(app)).toEqual({ actor: git0, viewer: { kind: 'member', id: 'steward-a', hats: [], roles: ['maintainer'] } })
    expect(reader.wearer).toHaveBeenCalledWith(expect.objectContaining({ id: 'hats-main' }), A2_ID)
    // An act reads now, and the hats it reads are the request's.
    reader.wearer.mockClear()
    const acted = await probe(app, undefined, 'POST')
    expect(reader.wearer).toHaveBeenCalledTimes(1)
    expect(reader.wearer).toHaveBeenCalledWith(expect.objectContaining({ id: 'hats-main' }), A2_ID)
    expect(acted).toEqual({ actor: git0, viewer: { kind: 'member', id: 'steward-a', hats: [COUNCIL], roles: ['council', 'maintainer'] } })
    await settle()
    expect((await probe(app)).viewer.hats).toEqual([COUNCIL])
  })

  it('a session for an address no member lists acts as its CAIP-10 id, named by its lowest worn hat and its short address', async () => {
    const { app, signIn, state } = await house()
    const cookie = await signIn(A1_ID)
    const actor = { id: A1_ID, name: 'Council · 0x0000…00A1', kind: 'person', via: 'siwe', account: A1_ID, hats: [COUNCIL], reading: { block: 100, readAt: T0.toISOString() } }
    expect(await (await call(app, 'GET', '/api/actor', { cookie })).json()).toEqual(actor)
    expect(await probe(app, cookie)).toEqual({ actor, viewer: { kind: 'member', id: A1_ID, hats: [COUNCIL], roles: ['council'] } })
    // Wearing Council and Stewards, the lower of the two names it.
    state.answer = wears([COUNCIL, STEWARDS], 101)
    const both = await probe(app, cookie, 'POST')
    expect(both.actor).toMatchObject({ id: A1_ID, name: 'Stewards · 0x0000…00A1', hats: [COUNCIL, STEWARDS], reading: { block: 101 } })
    expect(both.viewer.roles).toEqual(['council', 'stewards'])
  })

  it('a session for an address in exactly one member\'s handles.wallet acts as that member id (C-7, Q2)', async () => {
    const { app, signIn } = await house()
    const cookie = await signIn(A2_ID)
    expect(await (await call(app, 'GET', '/api/actor', { cookie })).json()).toEqual({
      id: 'steward-a', name: 'Steward A', kind: 'person', via: 'siwe', account: A2_ID, hats: [COUNCIL], reading: { block: 100, readAt: T0.toISOString() },
    })
    expect((await probe(app, cookie)).viewer).toEqual({ kind: 'member', id: 'steward-a', hats: [COUNCIL], roles: ['council', 'maintainer'] })
  })

  it('the private store\'s wallet link never changes the id: it only renames for viewers admitted to it', async () => {
    const { app, store, signIn } = await house()
    await store.putField({ registry: 'members', record: 'steward-b', field: 'handles', visibility: `hat:${OPS}`, value: { wallet: [A1_ID] } }, 'steward-a', null)
    const cookie = await signIn(A1_ID)
    expect((await probe(app, cookie)).actor).toMatchObject({ id: A1_ID, name: 'Council · 0x0000…00A1', via: 'siwe' })
  })

  it('hosted, no session: GET is answered as public, and every write is 401 "Sign in to change anything here."', async () => {
    const { app, repo } = await house({ hosted: true })
    const before = head(repo)
    // The middleware's answer, read on a bare app: in the house the public is refused every address the gate does not
    // list, a probe's included (Task 13).
    const bare = new Hono()
    bare.use('/api/*', withRequest({ repo, hosted: true, membership: null }))
    bare.get('/api/probe', c => c.json({ actor: actorOf(c), viewer: viewerOf(c) }))
    expect(await (await bare.request('http://localhost:4680/api/probe')).json()).toEqual({ actor: null, viewer: { kind: 'public' } })
    const refused = { error: 'Sign in to see this: it is for members only.', code: 'SIGN_IN' }
    expect(await (await call(app, 'GET', '/api/probe')).json()).toEqual(refused)
    expect(await (await call(app, 'GET', '/api/actor')).json()).toEqual(refused) // R-L5-7.6: 401 for the public, Task 13
    expect((await call(app, 'GET', '/api/registries/projects')).status).toBe(200) // gated (Task 13)
    const writes: [string, string, unknown?][] = [
      ['PUT', '/api/registries/projects/proj-001', { id: 'proj-001', title: 'x', status: 'develop', type: 'program', lead: 'steward-a' }],
      ['POST', '/api/registries/ideas', { id: 'idea-1', title: 'An idea' }],
      ['DELETE', '/api/registries/projects/proj-001'],
      ['POST', '/api/changes/ops', { ops: [PROJECT] }],
      ['POST', '/api/changes/apply'],
      ['DELETE', '/api/changes'],
      ['POST', '/api/proposals', { title: 'x' }],
      ['POST', '/api/library/board:onboarding/add'],
      ['POST', '/api/probe'],
    ]
    for (const [method, path, body] of writes) {
      const res = await call(app, method, path, { body })
      expect([method, path, res.status]).toEqual([method, path, 401])
      expect(await res.json()).toEqual({ error: SIGN_IN, code: 'SIGN_IN' })
    }
    expect(head(repo)).toBe(before)
    expect(git(repo, 'status --porcelain')).toBe('')
    // Signing in is not a write that needs a session.
    expect((await call(app, 'POST', '/api/session/nonce', { body: { address: '0x00000000000000000000000000000000000000a1' } })).status).toBe(200)
    expect((await call(app, 'DELETE', '/api/session')).status).toBe(204)
  })
})

describe('the house\'s commits (L5 spec §6.4)', () => {
  it('a signed-in actor\'s apply is one commit authored and committed by house@org-os.invalid, with Org-Actor its CAIP-10 id', async () => {
    const { app, repo, signIn } = await house()
    const cookie = await signIn(A1_ID)
    expect((await call(app, 'POST', '/api/changes/ops', { body: { ops: [PROJECT] }, cookie })).status).toBe(200)
    const before = count(repo)
    const res = await call(app, 'POST', '/api/changes/apply', { cookie })
    expect(res.status).toBe(200)
    expect(count(repo)).toBe(before + 1)
    expect(idents(repo)).toEqual([HOUSE, HOUSE])
    // A direct apply by an address carries the hat it was let in by (controller ruling on R-L5-8.7): under solo, the
    // lowest hat it wears, at the block of the act's reading.
    expect(parseTrailers(git(repo, 'log -1 --format=%B'))).toEqual({ actor: A1_ID, change: expect.stringMatching(/^chg_/), rule: 'solo/direct', hat: `${COUNCIL} @100` })
    expect(process.env.GIT_AUTHOR_EMAIL).toBeUndefined() // that one git call's, never this process's
  })

  it('a git actor\'s commit is authored as 0.6', async () => {
    const { app, repo } = await house()
    expect((await call(app, 'POST', '/api/changes/ops', { body: { ops: [PROJECT] } })).status).toBe(200)
    expect((await call(app, 'POST', '/api/changes/apply')).status).toBe(200)
    expect(idents(repo)).toEqual(['admin-test <admin-test@local>', 'admin-test <admin-test@local>'])
    expect(parseTrailers(git(repo, 'log -1 --format=%B')).actor).toBe('steward-a')
  })

  it('a refused act leaves the trunk and the store as they were: a hat taken off, then a tree that cannot be read (Review Focus 2)', async () => {
    const { app, repo, store, state, signIn } = await house()
    const cookie = await signIn(A1_ID)
    expect((await call(app, 'POST', '/api/changes/ops', { body: { ops: [PROJECT] }, cookie })).status).toBe(200)
    const before = { head: head(repo), history: store.history().length, status: git(repo, 'status --porcelain') }
    const untouched = async () => {
      expect(head(repo)).toBe(before.head)
      expect(git(repo, 'status --porcelain')).toBe(before.status)
      expect(store.history().length).toBe(before.history)
      expect((await (await call(app, 'GET', '/api/changes', { cookie })).json()).ops).toHaveLength(1)
    }

    state.answer = FAILED
    const unreadable = await call(app, 'POST', '/api/changes/apply', { cookie })
    expect(unreadable.status).toBe(502)
    expect(await unreadable.json()).toEqual({
      error: 'The Hats tree could not be read, so it is not known that you still wear council. Nothing was written.', code: 'HATS_UNREADABLE',
    })
    await untouched()

    state.answer = wears([], 150) // taken off on chain while the session is open
    const off = await call(app, 'POST', '/api/changes/apply', { cookie })
    expect(off.status).toBe(403)
    const sentence = 'You no longer wear a hat of this organisation\'s Hats tree (read at block 150), so you cannot change anything here. Nothing was written.'
    expect(await off.json()).toEqual({ reason: sentence, error: sentence, code: 'NOT_WORN' })
    // Wearing no hat, the session now reads as the public (L9 spec §5.8): the members' side, its change included, is
    // closed to it. Once the hat is back on (an act reads now), the change it staged is there as it was.
    expect(await (await call(app, 'GET', '/api/changes', { cookie })).json()).toEqual({ error: 'Sign in to see this: it is for members only.', code: 'SIGN_IN' })
    state.answer = wears([COUNCIL], 151)
    expect((await call(app, 'POST', '/api/probe', { cookie })).status).toBe(200)
    await untouched()
  })

  it('hosted: Propose and a closing never ask to Sync, and the ledger and the proposal branch are committed as the house (P4)', async () => {
    const roles = `    maintainer: { members: [steward-b] }\n    member: { all: true }\n    council: { hat: "${COUNCIL}" }`
    const governance = `schema_version: "2.0"\ngovernance:\n  model: "consensus"\n  membership: { tree: hats-main }\n  roles:\n${roles}\n  rules:\n` +
      '    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }\n  decisions: []\n'
    const h = await house({ hosted: true, governance, extend: (a, withLock, repo) => mountProposals(a, { repo, withLock, startBranch: 'main', now: () => T0, hosted: true }) })
    // A remote that was never fetched from: locally, Propose asks to Sync.
    const remote = mkdtempSync(join(tmpdir(), 'actor-remote-')); cleanup.push(remote)
    execSync('git init -q --bare -b main', { cwd: remote })
    git(h.repo, `remote add origin ${remote}`)

    const cookie = await h.signIn(A2_ID) // steward-a, by their wallet
    expect((await call(h.app, 'POST', '/api/changes/ops', { body: { ops: [PROJECT] }, cookie })).status).toBe(200)
    const res = await call(h.app, 'POST', '/api/proposals', { body: { title: 'Move one project', rationale: 'It is ready.' }, cookie })
    expect(res.status).toBe(201)
    const id = String((await res.json()).id)
    expect(idents(h.repo)).toEqual([HOUSE, HOUSE])
    expect(parseTrailers(git(h.repo, 'log -1 --format=%B')).actor).toBe('steward-a')
    // The branch is built by the same act: the house's too, with the author as its Org-Actor.
    expect(idents(h.repo, `refs/heads/proposal/${id}`)).toEqual([HOUSE, HOUSE])
    expect(parseTrailers(git(h.repo, `log -1 --format=%B refs/heads/proposal/${id}`))).toMatchObject({ actor: 'steward-a', proposal: id })

    // The same repository served locally, by the git actor (steward-a, the author): a closing asks to Sync first ...
    const local = createApp(h.repo, (a, ctx) => mountProposals(a, { repo: h.repo, withLock: ctx.withLock, startBranch: 'main', now: () => T0 }))
    const before = head(h.repo)
    const notHere = await call(local, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'withdraw' } })
    expect([notHere.status, await notHere.json()]).toEqual([409, expect.objectContaining({ code: 'SYNC_FIRST' })])
    expect(head(h.repo)).toBe(before)
    // ... and hosted it does not (closingPreflight), and the closing is the house's.
    const withdrawn = await call(h.app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'withdraw' }, cookie })
    expect(withdrawn.status).toBe(200)
    expect(idents(h.repo)).toEqual([HOUSE, HOUSE])
    expect(parseTrailers(git(h.repo, 'log -1 --format=%B'))).toMatchObject({ actor: 'steward-a', proposal: id })

    // Propose, locally: Sync first.
    expect((await call(local, 'POST', '/api/changes/ops', { body: { ops: [{ op: 'update', record: 'projects:proj-001', set: { title: 'Renamed locally' } }] } })).status).toBe(200)
    const refused = await call(local, 'POST', '/api/proposals', { body: { title: 'Again' } })
    expect([refused.status, await refused.json()]).toEqual([409, expect.objectContaining({ code: 'SYNC_FIRST' })])
  })
})

describe('commitDataPaths and commitMerge take { ident } (P11)', () => {
  it('that one commit is authored and committed by the ident, under this process\'s own environment, which is left as it was', async () => {
    const repo = makeChangeRepo(); cleanup.push(repo)
    const saved = process.env.GIT_EDITOR
    process.env.GIT_EDITOR = 'true' // an environment simple-git would refuse to be handed without its env categories
    try {
      writeFileSync(join(repo, 'data', 'ideas.yaml'), 'schema_version: "2.0"\nideas:\n  - { id: idea-1, title: "An idea" }\n')
      await commitDataPaths(repo, ['data/ideas.yaml'], 'admin(ideas): empty', { actor: A1_ID }, { ident: HOUSE_IDENT })
      expect(idents(repo)).toEqual([HOUSE, HOUSE])
      writeFileSync(join(repo, 'data', 'ideas.yaml'), 'schema_version: "2.0"\nideas:\n  - { id: idea-1, title: "An idea, again" }\n')
      await commitDataPaths(repo, ['data/ideas.yaml'], 'admin(ideas): again', { actor: 'steward-a' })
      expect(idents(repo)).toEqual(['admin-test <admin-test@local>', 'admin-test <admin-test@local>'])
    } finally {
      if (saved === undefined) delete process.env.GIT_EDITOR; else process.env.GIT_EDITOR = saved
    }
    for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) expect(process.env[k]).toBeUndefined()
  })

  it('a merge commit too', async () => {
    const repo = makeChangeRepo(); cleanup.push(repo)
    git(repo, 'checkout -q -b side')
    writeFileSync(join(repo, 'data', 'ideas.yaml'), 'schema_version: "2.0"\nideas:\n  - { id: idea-1, title: "An idea" }\n')
    git(repo, 'commit -qam "side: ideas"')
    git(repo, 'checkout -q main')
    await mergeNoFf(repo, 'side')
    await commitMerge(repo, 'merge side', ['data/ideas.yaml'], { actor: A1_ID }, { ident: HOUSE_IDENT })
    expect(idents(repo)).toEqual([HOUSE, HOUSE])
    expect(git(repo, 'rev-list --parents -1 HEAD').trim().split(' ')).toHaveLength(3)
  })
})
