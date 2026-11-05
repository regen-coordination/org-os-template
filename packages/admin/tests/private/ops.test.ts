import { describe, it, expect, afterEach, vi } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { parse, stringify } from 'yaml'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { mountSession } from '../../server/session/routes.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { Membership } from '../../server/session/membership.ts'
import { createSession } from '../../server/session/sessions.ts'
import { openPrivateStore, StoreUnavailable, type PrivateStore, type PrivateTransaction } from '../../server/private/store.ts'
import { ChangeStore } from '../../server/changes/store.ts'
import { readConfig } from '../../server/visibility/config.ts'
import { Refusal } from '../../server/changes/apply.ts'
import { assertGitSafe } from '../../server/private/guard.ts'
import { commitDataPaths } from '../../server/git.ts'
import { NO_CONTACT_LEVEL, noCollection, noRecord, RESTRICTED_SUBJECT, splitOp, STORE_FAILED } from '../../server/private/ops.ts'
import { TRAY_HOLDS } from '../../server/proposals/revise.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { validateRepo } from '../../lib/data-validate.mjs'
import type { WearerReading } from '../../server/systems/hats.ts'

// L5 spec §10.3 and §10.5, Task 14: private records and restricted fields are read through the gate and written only to
// the private store. Every test builds a fresh temporary repository (makeChangeRepo) and keeps its store in a folder of
// its own under the temp directory: nothing is written inside this worktree. Two Hats wearers sign in: A1 wears Ops, A2
// wears Council (a sibling of Ops, so not admitted to it). Locally, git's identity is steward-a, whose wallet is A1 (so
// they wear Ops), or, when a test says so, steward-c, a member with no wallet and so no hats. Nothing touches the network.

const NOW = new Date('2026-10-29T12:00:00Z')
const CELO = 'eip155:42220'
const TOP = `${CELO}:0x0000000d${'0'.repeat(56)}`
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`
const A2 = `${CELO}:0x00000000000000000000000000000000000000a2`
const HATS: Record<string, string[]> = { [A1]: [OPS], [A2]: [COUNCIL] }

const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
  decisions: []
`
/** Written rules, so a change can be proposed (solo applies directly): members' changes are proposed by any member and
 *  approved by steward-a. */
const PROPOSING = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: members, applies_to: [members], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
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
const RESTRICTED = `visibility:
  collections:
    members: { default: members, fields: { email: "hat:${OPS}" } }
`
const CONTACT_ONLY = `visibility:
  defaults: { contact: "hat:${OPS}" }
`
const NO_CONTACT = `visibility:
  collections:
    projects: { default: members }
`

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed by the test */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface World {
  repo: string; store: PrivateStore; local: Hono; hosted: Hono; cookie: (account: string) => Promise<string>
  /** A local app over the same repository whose private store is `access`. */
  localWith: (access: () => PrivateStore) => Hono
  /** The hats an account wears from now on (the next reading). */
  wear: (account: string, hats: string[]) => void
}

/** A fresh repository with the tree, its two hats and `visibility`; its store; a local app (git's identity, steward-a)
 *  and a hosted one (sign-in) over both. */
async function world(visibility = RESTRICTED, governance = GOVERNANCE): Promise<World> {
  const repo = makeChangeRepo(governance)
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), visibility)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, two members, what is restricted"')
  const dir = mkdtempSync(join(tmpdir(), 'private-ops-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const now = () => NOW
  // The reader is asked with the account as Membership names it; the hats are the fixture's for that address.
  const wearing: Record<string, string[]> = { ...HATS }
  const wear = (account: string, hats: string[]) => { wearing[account] = hats }
  const hatsOf = (account: string) => Object.entries(wearing).find(([a]) => a.toLowerCase().endsWith(account.toLowerCase().slice(-40)))?.[1] ?? []
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, hats: hatsOf(account), block: 100, readAt: NOW.toISOString() })
  const reader = { wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)), wearers: vi.fn() }
  const membership = new Membership({ repo, reader: reader as never, now })
  const localWith = (access: () => PrivateStore) => createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now, privateStore: ctx.privateStore }), {
    request: withRequest({ repo, hosted: false, membership, store, now }),
    privateStore: access,
  })
  const local = localWith(() => store)
  const hosted = createApp(repo, a => mountSession(a, { repo, store, membership, hosted: true, now }), {
    request: withRequest({ repo, hosted: true, membership, store, now }),
    privateStore: () => store,
  })
  const cookie = async (account: string) => {
    await membership.forAct(account)
    return `house_session=${(await createSession(store, account, now)).token}`
  }
  return { repo, store, local, hosted, cookie, localWith, wear }
}

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const read = async (app: Hono, path: string, cookie?: string) => {
  const res = await app.request(path, cookie ? { headers: { cookie } } : {})
  const text = await res.text()
  return { status: res.status, text, body: JSON.parse(text) as any } // eslint-disable-line @typescript-eslint/no-explicit-any
}
const commits = (repo: string) => Number(git(repo, 'rev-list --count HEAD').trim())
const changeFile = (repo: string, actor = 'steward-a') => new ChangeStore(repo).file(actor)
const OPS_VIEWER = { kind: 'member' as const, id: 'steward-a', hats: [OPS], roles: [] }
/** git's identity in the fixture: steward-a (wears Ops through their wallet) or steward-c (no wallet, no hats). */
const asLocal = (w: World, who: 'steward-a' | 'steward-c') => git(w.repo, `config user.email ${who === 'steward-a' ? 'admin-test@local' : 'steward-c@example.test'}`)
const changeId = (repo: string) => (JSON.parse(readFileSync(changeFile(repo), 'utf8')) as { id: string }).id

async function stage(w: World, ops: unknown[]): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await w.local.request('/api/changes/ops', json('POST', { ops }))
  return { status: res.status, body: await res.json() }
}

describe('reads (L5 spec §9.5, §11.5)', () => {
  it('a member admitted to Ops reads a person\'s email merged into the record', async () => {
    const w = await world()
    await w.store.putField({ registry: 'members', record: 'steward-b', field: 'email', visibility: `hat:${OPS}`, value: 'steward-b@example.invalid' }, 'steward-a', null)
    const got = await read(w.hosted, '/api/registries/members', await w.cookie(A1))
    expect(got.status).toBe(200)
    const b = got.body.entries.find((e: { id: string }) => e.id === 'steward-b')
    expect(b).toEqual({ id: 'steward-b', name: 'Steward B', kind: 'person', role: 'Contributor', email: 'steward-b@example.invalid', visibility: 'members' })
  })

  it('a member not admitted gets restricted: { email: "hat:…" } and no value', async () => {
    const w = await world()
    await w.store.putField({ registry: 'members', record: 'steward-b', field: 'email', visibility: `hat:${OPS}`, value: 'steward-b@example.invalid' }, 'steward-a', null)
    const got = await read(w.hosted, '/api/registries/members', await w.cookie(A2))
    expect(got.status).toBe(200)
    const b = got.body.entries.find((e: { id: string }) => e.id === 'steward-b')
    expect(b).toEqual({ id: 'steward-b', name: 'Steward B', kind: 'person', role: 'Contributor', restricted: { email: `hat:${OPS}` }, visibility: 'members' })
    expect(got.text).not.toContain('steward-b@example.invalid')
    // A record with no value in the field carries no marker for it.
    expect(got.body.entries.find((e: { id: string }) => e.id === 'steward-a').restricted).toBeUndefined()
  })

  it('a private collection does not appear for a member not admitted — no name, no count', async () => {
    const w = await world()
    await w.store.putCollection({ id: 'grants-private', visibility: `hat:${OPS}`, definition: { title: 'Grants under negotiation' } }, 'steward-a')
    await w.store.putRecord({ collection: 'grants-private', id: 'g-1', visibility: `hat:${OPS}`, body: { id: 'g-1', title: 'A grant' }, rev: 'r1' }, 'steward-a', null)

    const ops = await w.cookie(A1)
    const listed = await read(w.hosted, '/api/registries', ops)
    expect(listed.body.find((r: { name: string }) => r.name === 'grants-private')).toEqual({ name: 'grants-private', kind: 'collection', count: 1 })
    const entries = await read(w.hosted, '/api/registries/grants-private', ops)
    expect(entries.status).toBe(200)
    expect(entries.body.entries).toEqual([{ id: 'g-1', title: 'A grant', visibility: `hat:${OPS}` }])

    const council = await w.cookie(A2)
    const notListed = await read(w.hosted, '/api/registries', council)
    expect(notListed.status).toBe(200)
    expect(notListed.text).not.toContain('grants-private')
    const counts = Object.fromEntries((notListed.body as { name: string; count: number | null }[]).map(r => [r.name, r.count]))
    expect(Object.fromEntries((listed.body as { name: string; count: number | null }[]).filter(r => r.name !== 'grants-private').map(r => [r.name, r.count]))).toEqual(counts)
    const asked = await read(w.hosted, '/api/registries/grants-private', council)
    const unknown = await read(w.hosted, '/api/registries/no-such-thing', council)
    expect(asked.status).toBe(404)
    expect(asked.text.replace('grants-private', 'X')).toBe(unknown.text.replace('no-such-thing', 'X'))
  })

  it('registries still answer when the store is down (Review Focus 4); a private write is refused with the store\'s sentence', async () => {
    const w = await world()
    const why = 'The private store would be at .org-os/private/house.db, which git does not ignore. Add `.org-os/private/` to .gitignore first.'
    const down = w.localWith(() => { throw new StoreUnavailable(why) })
    const list = await read(down, '/api/registries')
    expect(list.status).toBe(200)
    expect(list.body.find((r: { name: string }) => r.name === 'members').count).toBe(3)
    const members = await read(down, '/api/registries/members')
    expect(members.status).toBe(200)
    expect(members.body.entries.map((e: { id: string }) => e.id)).toEqual(['steward-a', 'steward-b', 'steward-c'])

    const res = await down.request('/api/changes/ops', json('POST', { ops: [{ op: 'update', record: 'members:steward-b', set: { email: 'steward-b@example.invalid' } }] }))
    expect([res.status, await res.json()]).toEqual([503, { error: why, code: 'PRIVATE_STORE' }])
    expect(existsSync(changeFile(w.repo))).toBe(false)
    // The git side stages as before.
    const ok = await down.request('/api/changes/ops', json('POST', { ops: [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer' } }] }))
    expect(ok.status).toBe(200)
  })
})

describe('staging and direct apply (L5 spec §10.3)', () => {
  it('every answer that shows the tray shows the private op as staged, not null (Task 14 M6): a rebase that changes nothing', async () => {
    const w = await world()
    const staged = await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'staged-b@example.invalid', role: 'Treasurer' } }])
    const res = await w.local.request('/api/changes/ops/0/rebase', json('POST', { keep: 'mine' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.private).toEqual(staged.body.private)
    expect(body.private[0].op).not.toBeNull()
  })

  it('staging a person\'s email splits it: the change file holds a placeholder, the store the value', async () => {
    const w = await world()
    const staged = await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'staged-b@example.invalid', role: 'Treasurer' } }])
    expect(staged.status).toBe(200)
    const text = readFileSync(changeFile(w.repo), 'utf8')
    expect(text).not.toContain('staged-b@example.invalid')
    const change = JSON.parse(text)
    expect(change.ops.map((o: { record: string; set: unknown }) => [o.record, o.set])).toEqual([['members:steward-b', { role: 'Treasurer' }]])
    expect(change.private).toEqual([{ op: 'private', ref: expect.stringMatching(/^stg-\d+$/), class: 'members' }])
    expect(w.store.staged(change.id)).toEqual([{
      change: change.id, seq: Number(change.private[0].ref.slice(4)), actor: 'steward-a',
      op: { op: 'put-field', field: { registry: 'members', record: 'steward-b', field: 'email', visibility: `hat:${OPS}`, value: 'staged-b@example.invalid' } },
    }])
    // The stager's tray shows what they staged, and the rule is judged on the private part's class too.
    expect(staged.body.private).toEqual([{ ref: change.private[0].ref, class: 'members', op: w.store.staged(change.id)[0]!.op }])
    expect(staged.body.classes).toEqual(['members'])
    // Staging the same field again replaces it: one value per field.
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'again-b@example.invalid' } }])
    expect(w.store.staged(change.id).map(r => (r.op as { field: { value: string } }).field.value)).toEqual(['again-b@example.invalid'])
  })

  it('apply writes the store and makes one commit holding no e-mail', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'applied-b@example.invalid', role: 'Treasurer' } }])
    const id = changeId(w.repo)
    const before = commits(w.repo)
    const res = await w.local.request('/api/changes/apply', json('POST', {}))
    expect(res.status).toBe(200)
    const { commit } = await res.json()
    expect(commits(w.repo)).toBe(before + 1)
    expect(git(w.repo, 'rev-parse HEAD').trim()).toBe(commit)
    expect(git(w.repo, 'show HEAD')).not.toContain('applied-b@example.invalid')
    expect(readFileSync(join(w.repo, 'data', 'members.yaml'), 'utf8')).toContain('Treasurer')
    expect(w.store.fields('members', 'steward-b')).toEqual([
      { registry: 'members', record: 'steward-b', field: 'email', visibility: `hat:${OPS}`, value: 'applied-b@example.invalid' },
    ])
    expect(w.store.history('members/steward-b/email').map(h => [h.by, h.change])).toEqual([['steward-a', id]])
    expect(w.store.staged(id)).toEqual([])
    expect(existsSync(changeFile(w.repo))).toBe(false)
  })

  it('a git failure rolls the store back', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'refused-b@example.invalid', role: 'Treasurer' } }])
    const id = changeId(w.repo)
    const before = commits(w.repo)
    // The git commit made to throw: a hook in the fixture's own repository refuses every commit.
    const hook = join(w.repo, '.git', 'hooks', 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\necho "refused by the test hook" >&2\nexit 1\n'); chmodSync(hook, 0o755)
    const res = await w.local.request('/api/changes/apply', json('POST', {}))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toContain('refused by the test hook')
    expect(commits(w.repo)).toBe(before)
    expect(w.store.fields('members', 'steward-b')).toEqual([])
    expect(w.store.history()).toEqual([])
    // Nothing is lost: the change and its staged private part stay, to apply again.
    expect(w.store.staged(id)).toHaveLength(1)
    expect(existsSync(changeFile(w.repo))).toBe(true)
    expect(readFileSync(join(w.repo, 'data', 'members.yaml'), 'utf8')).toBe(MEMBERS)
  })

  it('an apply with only private ops makes one empty commit with the trailers and the subject', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'only-b@example.invalid' } }])
    const id = changeId(w.repo)
    expect(JSON.parse(readFileSync(changeFile(w.repo), 'utf8')).ops).toEqual([])
    const before = commits(w.repo)
    const res = await w.local.request('/api/changes/apply', json('POST', {}))
    expect(res.status).toBe(200)
    expect(commits(w.repo)).toBe(before + 1)
    expect(git(w.repo, 'diff-tree --no-commit-id --name-only -r HEAD').trim()).toBe('')
    const message = git(w.repo, 'log -1 --format=%B').trim().split('\n')
    expect(message[0]).toBe(RESTRICTED_SUBJECT)
    expect(RESTRICTED_SUBJECT).toBe('A change to a restricted collection')
    expect(message).toEqual(expect.arrayContaining(['Org-Actor: steward-a', `Org-Change: ${id}`, expect.stringMatching(/^Org-Rule: /)]))
    expect(git(w.repo, 'log -1 -p')).not.toContain('only-b@example.invalid')
    expect(w.store.fields('members', 'steward-b').map(f => f.value)).toEqual(['only-b@example.invalid'])
  })

  it('a record of a private collection is staged and applied only to the store', async () => {
    const w = await world()
    await w.store.putCollection({ id: 'grants-private', visibility: `hat:${OPS}`, definition: { title: 'Grants under negotiation' } }, 'steward-a')
    const staged = await stage(w, [{ op: 'create', record: 'grants-private:g-2', value: { id: 'g-2', title: 'sentinel-grant' } }])
    expect(staged.status).toBe(200)
    expect(readFileSync(changeFile(w.repo), 'utf8')).not.toContain('grants-private')
    expect((await w.local.request('/api/changes/apply', json('POST', {}))).status).toBe(200)
    expect(git(w.repo, 'log -1 -p')).not.toContain('sentinel-grant')
    expect(w.store.record('grants-private', 'g-2')).toMatchObject({ visibility: `hat:${OPS}`, body: { id: 'g-2', title: 'sentinel-grant' } })
  })

  it('the old write routes split as the tray does: a PUT keeps the email out of git', async () => {
    const w = await world()
    const res = await w.local.request('/api/registries/members/steward-b', json('PUT', { id: 'steward-b', name: 'Steward B', kind: 'person', role: 'Contributor', email: 'put-b@example.invalid' }))
    expect(res.status).toBe(200)
    expect(git(w.repo, 'log -1 -p')).not.toContain('put-b@example.invalid')
    expect(w.store.fields('members', 'steward-b').map(f => f.value)).toEqual(['put-b@example.invalid'])
  })

  it('proposing a change with a private part carries it (Task 15): the email stays out of git, its staged row moves to pending', async () => {
    const w = await world(RESTRICTED, PROPOSING)
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'p-b@example.invalid', role: 'Treasurer' } }])
    const id = changeId(w.repo)
    const res = await w.local.request('/api/proposals', json('POST', { title: 'Steward B keeps the treasury' }))
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(git(w.repo, 'log --all -p')).not.toContain('p-b@example.invalid')
    expect(w.store.staged(id)).toEqual([])
    expect(w.store.pending(body.id)).toHaveLength(1)
  })
})

describe('contact details (L3-C4)', () => {
  it('with members.email undeclared, a null removes the e-mail kept at defaults.contact (re-review)', async () => {
    const w = await world(CONTACT_ONLY)
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'gone-b@example.invalid' } }])
    expect((await w.local.request('/api/changes/apply', json('POST', {}))).status).toBe(200)
    expect(w.store.fields('members', 'steward-b').map(f => f.value)).toEqual(['gone-b@example.invalid'])
    const removed = await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: null } }])
    expect(removed.status).toBe(200)
    expect(removed.body.ops).toEqual([])
    expect(w.store.staged(changeId(w.repo)).map(r => r.op)).toEqual([{ op: 'delete-field', registry: 'members', record: 'steward-b', field: 'email', visibility: `hat:${OPS}` }])
    expect((await w.local.request('/api/changes/apply', json('POST', {}))).status).toBe(200)
    expect(w.store.fields('members', 'steward-b')).toEqual([])
    expect(readFileSync(join(w.repo, 'data', 'members.yaml'), 'utf8')).not.toContain('email')
    const seen = await read(w.hosted, '/api/registries/members', await w.cookie(A1))
    expect(seen.body.entries.find((e: { id: string }) => e.id === 'steward-b').email).toBeUndefined()
  })


  it('with defaults.contact unset, staging an email is refused', async () => {
    const w = await world(NO_CONTACT)
    const res = await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'c-b@example.invalid' } }])
    expect(res).toEqual({ status: 422, body: { errors: [{ record: 'members:steward-b', field: 'email', message: NO_CONTACT_LEVEL }] } })
    expect(NO_CONTACT_LEVEL).toBe('Name the hat that keeps contact details in data/visibility.yaml (defaults.contact) first.')
    expect(w.store.history()).toEqual([])
  })

  it('with defaults.contact set, an email goes to the store at that level', async () => {
    const w = await world(CONTACT_ONLY)
    const res = await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'c-b@example.invalid' } }])
    expect(res.status).toBe(200)
    expect(w.store.staged(changeId(w.repo)).map(r => r.op)).toEqual([
      { op: 'put-field', field: { registry: 'members', record: 'steward-b', field: 'email', visibility: `hat:${OPS}`, value: 'c-b@example.invalid' } },
    ])
  })
})

describe('a person\'s wallet link (§9.7 "hat: Ops by default", R-L5-18.7)', () => {
  const LINK = `${CELO}:0x00000000000000000000000000000000000000a3`
  /** steward-b's wallet link written into git by hand, before the default: a value git already holds. */
  const heldInGit = (w: World) => {
    writeFileSync(join(w.repo, 'data', 'members.yaml'), MEMBERS.replace('role: Contributor }', `role: Contributor, wallet: "${LINK}" }`))
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "fixture: a wallet link git held before the default"')
  }
  const ledger = (op: string) => `schema_version: "2.0"\nproposals:\n  - { id: p-2026-10-29-001-a3f9, state: open, ops: [${op}] }\n`
  const linkErrors = (repo: string) => validateRepo(repo).filter((p: { level: string; path: string }) => p.level === 'error' && p.path === 'wallet')

  it('with members.wallet undeclared, a link goes to the store at defaults.contact, and the commit holds none', async () => {
    const w = await world(CONTACT_ONLY)
    const res = await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', wallet: LINK } }])
    expect(res.status).toBe(200)
    expect(w.store.staged(changeId(w.repo)).map(r => r.op)).toEqual([
      { op: 'put-field', field: { registry: 'members', record: 'steward-b', field: 'wallet', visibility: `hat:${OPS}`, value: LINK } },
    ])
    expect((await w.local.request('/api/changes/apply', json('POST', {}))).status).toBe(200)
    expect(git(w.repo, 'log -1 -p').toLowerCase()).not.toContain('00a3')
    expect(w.store.fields('members', 'steward-b').map(f => [f.field, f.visibility, f.value])).toEqual([['wallet', `hat:${OPS}`, LINK]])
    expect(linkErrors(w.repo)).toEqual([])
  })

  it('with defaults.contact unset, staging a link is refused, as an e-mail is', async () => {
    const w = await world(NO_CONTACT)
    const res = await stage(w, [{ op: 'update', record: 'members:steward-b', set: { wallet: LINK } }])
    expect(res).toEqual({ status: 422, body: { errors: [{ record: 'members:steward-b', field: 'wallet', message: NO_CONTACT_LEVEL }] } })
  })

  it('a link git already holds stays until it is narrowed: its record still saves; a new link is refused by assertGitSafe', async () => {
    const w = await world(CONTACT_ONLY)
    heldInGit(w)
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', wallet: LINK } }])
    expect((await w.local.request('/api/changes/apply', json('POST', {}))).status).toBe(200)
    expect(readFileSync(join(w.repo, 'data', 'members.yaml'), 'utf8')).toContain(LINK)

    const config = readConfig(w.repo)
    const now = readFileSync(join(w.repo, 'data', 'members.yaml'), 'utf8')
    const doc = parse(now) as { members: Record<string, unknown>[] }
    const added = stringify({ ...doc, members: doc.members.map(m => (m.id === 'steward-c' ? { ...m, wallet: LINK } : m)) })
    expect(() => assertGitSafe(w.repo, [{ path: 'data/members.yaml', text: added }], config)).toThrow(/a new wallet link for steward-c/)
    expect(() => assertGitSafe(w.repo, [{ path: 'data/members.yaml', text: now }], config)).not.toThrow()
    const op = (id: string) => `{ op: update, record: "members:${id}", set: { wallet: "${LINK}" } }`
    expect(() => assertGitSafe(w.repo, [{ path: 'data/proposals.yaml', text: ledger(op('steward-c')) }], config)).toThrow(/a new wallet link for members:steward-c/)
    expect(() => assertGitSafe(w.repo, [{ path: 'data/proposals.yaml', text: ledger(op('steward-b')) }], config)).not.toThrow()
  })

  it('validate:data reports every link git holds at the default (a snapshot cannot tell an old one), never its value', async () => {
    const w = await world(CONTACT_ONLY)
    heldInGit(w)
    const found = linkErrors(w.repo)
    expect(found).toEqual([expect.objectContaining({ file: 'data/members.yaml', id: 'steward-b', path: 'wallet' })])
    expect(found[0].message).toMatch(/kept at hat:.* by data\/visibility\.yaml's defaults\.contact \(narrow members\.wallet to move it\): it belongs in the private store$/)
    expect(JSON.stringify(found)).not.toContain('00a3')
    // With no contact level, a wallet field is not a link kept anywhere: nothing to report (staging refuses it instead).
    const none = await world(NO_CONTACT)
    heldInGit(none)
    expect(linkErrors(none.repo)).toEqual([])
  })
})

describe('splitOp', () => {
  it('a delete of a git record takes its restricted fields with it at apply, not at stage', async () => {
    const w = await world()
    await w.store.putField({ registry: 'members', record: 'steward-c', field: 'email', visibility: `hat:${OPS}`, value: 'x@example.invalid' }, 'steward-a', null)
    // Staging reads nothing of the store for it: the same answer whatever the store holds.
    expect(splitOp({ op: 'delete', record: 'members:steward-c' }, readConfig(w.repo), w.store, { viewer: OPS_VIEWER }))
      .toEqual({ git: { op: 'delete', record: 'members:steward-c' }, private: [] })
    asLocal(w, 'steward-c') // a member with no hats deletes a record whose restricted field they cannot read: it goes with it
    expect((await w.local.request('/api/changes/ops', json('POST', { ops: [{ op: 'delete', record: 'members:steward-c' }] }))).status).toBe(200)
    expect((await w.local.request('/api/changes/apply', json('POST', {}))).status).toBe(200)
    expect(w.store.fields('members', 'steward-c')).toEqual([])
  })

  it('the gate\'s restricted marker written back is not a field', async () => {
    const w = await world()
    const parts = splitOp({ op: 'replace', record: 'members:steward-b', value: { id: 'steward-b', name: 'Steward B', restricted: { email: `hat:${OPS}` } } }, readConfig(w.repo), w.store, { viewer: OPS_VIEWER })
    expect(parts).toEqual({ git: { op: 'replace', record: 'members:steward-b', value: { id: 'steward-b', name: 'Steward B' } }, private: [] })
  })

  it('a value the store already holds stages as any other, and its apply writes nothing but still commits', async () => {
    const w = await world()
    await w.store.putField({ registry: 'members', record: 'steward-b', field: 'email', visibility: `hat:${OPS}`, value: 'x@example.invalid' }, 'steward-a', null)
    const value = { id: 'steward-b', name: 'Steward B', email: 'x@example.invalid', role: 'Treasurer' }
    const put = { op: 'put-field', field: { registry: 'members', record: 'steward-b', field: 'email', visibility: `hat:${OPS}`, value: 'x@example.invalid' } }
    expect(splitOp({ op: 'replace', record: 'members:steward-b', value }, readConfig(w.repo), w.store, { viewer: OPS_VIEWER }))
      .toEqual({ git: { op: 'replace', record: 'members:steward-b', value: { id: 'steward-b', name: 'Steward B', role: 'Treasurer' } }, private: [put] })
    // A value absent from a whole record written back is kept (the writer may not have been shown it); null removes it.
    expect(splitOp({ op: 'replace', record: 'members:steward-b', value: { ...value, email: null } }, readConfig(w.repo), w.store, { viewer: OPS_VIEWER }).private)
      .toEqual([{ op: 'delete-field', registry: 'members', record: 'steward-b', field: 'email', visibility: `hat:${OPS}` }])
    const before = commits(w.repo)
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'x@example.invalid' } }])
    expect((await w.local.request('/api/changes/apply', json('POST', {}))).status).toBe(200)
    expect(commits(w.repo)).toBe(before + 1)
    expect(w.store.history('members/steward-b/email')).toHaveLength(1) // the seeding only
  })

  it('an op with no private part is git\'s, unchanged', async () => {
    const w = await world()
    const op = { op: 'update' as const, record: 'members:steward-b', set: { role: 'Treasurer' } }
    expect(splitOp(op, readConfig(w.repo), w.store, { viewer: OPS_VIEWER })).toEqual({ git: op, private: [] })
  })
})

describe('staging never shows a member what they are not admitted to (review C1)', () => {
  const GRANTS = { id: 'grants-private', visibility: `hat:${OPS}`, definition: { title: 'Grants under negotiation' } }
  const seed = async (w: World) => {
    await w.store.putCollection(GRANTS, 'steward-a')
    await w.store.putRecord({ collection: 'grants-private', id: 'g-1', visibility: `hat:${OPS}`, body: { id: 'g-1', title: 'sentinel-title', amount: 'sentinel-amount' }, rev: 'r1' }, 'steward-a', null)
    await w.store.putRecord({ collection: 'projects', id: 'p-kept', visibility: `hat:${OPS}`, body: { id: 'p-kept', title: 'sentinel-project' }, rev: 'r1' }, 'steward-a', null)
  }
  const OPS_ON = (record: string) => [
    { op: 'update', record, set: { title: 'probe' } },
    { op: 'create', record, value: { id: record.slice(record.indexOf(':') + 1), title: 'probe' } },
    { op: 'replace', record, value: { id: record.slice(record.indexOf(':') + 1), title: 'probe' } },
    { op: 'delete', record },
  ]
  /** What staging one op answers, with the record's name written as X, and what the store and the change file hold after. */
  async function probe(w: World, app: Hono, op: Record<string, unknown>, cookie?: string) {
    const res = await app.request('/api/changes/ops', { ...json('POST', { ops: [op] }), ...(cookie ? { headers: { 'content-type': 'application/json', cookie } } : {}) })
    const text = await res.text()
    const record = String(op.record)
    const said = text.replace(/"(id|created|updated)":"[^"]*"/g, '"$1":""').split(record).join('X').split(record.slice(0, record.indexOf(':'))).join('C').split(record.slice(record.indexOf(':') + 1)).join('I')
    // Each probe starts from an empty tray.
    await app.request('/api/changes', cookie ? { method: 'DELETE', headers: { cookie } } : { method: 'DELETE' })
    return { status: res.status, said, text }
  }

  it('the local actor with no hats: a private collection and a kept record answer as an unknown one, every op', async () => {
    const w = await world()
    await seed(w)
    asLocal(w, 'steward-c')
    for (const [hidden, unknown] of [['grants-private:g-1', 'no-such-things:g-1'], ['projects:p-kept', 'projects:p-none']] as const) {
      const ops = OPS_ON(hidden)
      const others = OPS_ON(unknown)
      for (let i = 0; i < ops.length; i++) {
        const a = await probe(w, w.local, ops[i]!)
        const b = await probe(w, w.local, others[i]!)
        expect([hidden, ops[i]!.op, a.status, a.said]).toEqual([hidden, ops[i]!.op, b.status, b.said])
        expect(a.text).not.toMatch(/sentinel/)
      }
    }
    expect(w.store.staged('x')).toEqual([])
    expect(w.store.record('grants-private', 'g-1')!.body).toEqual({ id: 'g-1', title: 'sentinel-title', amount: 'sentinel-amount' })
  })

  it('a signed-in member not admitted (Council): the same, and nothing they stage reaches the store at apply', async () => {
    const w = await world()
    await seed(w)
    const council = await w.cookie(A2)
    for (const [hidden, unknown] of [['grants-private:g-1', 'no-such-things:g-1'], ['projects:p-kept', 'projects:p-none']] as const) {
      const ops = OPS_ON(hidden)
      const others = OPS_ON(unknown)
      for (let i = 0; i < ops.length; i++) {
        const a = await probe(w, w.hosted, ops[i]!, council)
        const b = await probe(w, w.hosted, others[i]!, council)
        expect([hidden, ops[i]!.op, a.status, a.said]).toEqual([hidden, ops[i]!.op, b.status, b.said])
        expect(a.text).not.toMatch(/sentinel/)
      }
    }
    expect(w.store.record('projects', 'p-kept')!.body).toEqual({ id: 'p-kept', title: 'sentinel-project' })
    expect(w.store.history().map(h => h.target)).toEqual(['grants-private', 'grants-private/g-1', 'projects/p-kept'])
  })

  it('a restricted field: refused for whoever is not admitted to its level, with the same words whatever the store holds', async () => {
    const w = await world()
    await w.store.putField({ registry: 'members', record: 'steward-b', field: 'email', visibility: `hat:${OPS}`, value: 'sentinel-b@example.invalid' }, 'steward-a', null)
    asLocal(w, 'steward-c')
    const held = await probe(w, w.local, { op: 'update', record: 'members:steward-b', set: { email: 'sentinel-b@example.invalid' } })
    const none = await probe(w, w.local, { op: 'update', record: 'members:steward-c', set: { email: 'sentinel-b@example.invalid' } })
    expect(held.status).toBe(422)
    expect([held.status, held.said]).toEqual([none.status, none.said])
    expect(held.text).toContain('which you are not admitted to')
    expect(w.store.fields('members', 'steward-b').map(f => f.value)).toEqual(['sentinel-b@example.invalid'])
  })

  it('an admitted member\'s tray shows what they typed, never the stored record merged in', async () => {
    const w = await world()
    await seed(w)
    const staged = await stage(w, [{ op: 'update', record: 'grants-private:g-1', set: { title: 'new title' } }])
    expect(staged.status).toBe(200)
    expect(staged.body.private.map((p: { op: unknown }) => p.op)).toEqual([{ op: 'update-record', collection: 'grants-private', id: 'g-1', set: { title: 'new title' } }])
    expect(JSON.stringify(staged.body)).not.toMatch(/sentinel/)
    expect(JSON.stringify(w.store.staged(changeId(w.repo)))).not.toMatch(/sentinel/)
  })
})

describe('apply judges the stager again (re-review, controller ruling): a hat taken off between staging and apply', () => {
  const GRANTS = { id: 'grants-private', visibility: `hat:${OPS}`, definition: { title: 'Grants' } }
  async function refusedAtApply(w: World, expected: { code: string; error: string }) {
    const before = commits(w.repo)
    const history = w.store.history().length
    const res = await w.local.request('/api/changes/apply', json('POST', {}))
    expect([res.status, await res.json()]).toEqual([409, expected])
    expect(commits(w.repo)).toBe(before)
    expect(w.store.history()).toHaveLength(history)
  }

  it('a create in a private collection: answered as a collection that is not there', async () => {
    const w = await world()
    await w.store.putCollection(GRANTS, 'steward-a')
    expect((await stage(w, [{ op: 'create', record: 'grants-private:g-9', value: { id: 'g-9', title: 'x' } }])).status).toBe(200)
    w.wear(A1, [])
    await refusedAtApply(w, { code: 'NO_COLLECTION', error: noCollection('grants-private') })
    expect(w.store.record('grants-private', 'g-9')).toBeNull()
  })

  it('a create of a record kept private in a git collection: refused at its own level', async () => {
    const w = await world()
    expect((await stage(w, [{ op: 'create', record: 'projects:p-9', value: { id: 'p-9', title: 'x', visibility: `hat:${OPS}` } }])).status).toBe(200)
    w.wear(A1, [])
    await refusedAtApply(w, { code: 'NOT_ADMITTED', error: `projects:p-9 would be kept at hat:${OPS}, which you are not admitted to, so you cannot write it here.` })
    expect(w.store.record('projects', 'p-9')).toBeNull()
  })

  it('a new visibility: refused when the stager no longer wears it, though they still read the record', async () => {
    // A narrowing of the record's level (Ops → the top hat above it): a widening is never applied (Task 16, R-L5-16.8).
    const w = await world()
    w.wear(A1, [OPS, TOP])
    await w.store.putCollection(GRANTS, 'steward-a')
    await w.store.putRecord({ collection: 'grants-private', id: 'g-1', visibility: `hat:${OPS}`, body: { id: 'g-1' }, rev: 'r' }, 'steward-a', null)
    expect((await stage(w, [{ op: 'update', record: 'grants-private:g-1', set: { visibility: `hat:${TOP}` } }])).status).toBe(200)
    w.wear(A1, [OPS])
    await refusedAtApply(w, { code: 'NOT_ADMITTED', error: `grants-private:g-1 would be kept at hat:${TOP}, which you are not admitted to, so you cannot write it here.` })
    expect(w.store.record('grants-private', 'g-1')!.visibility).toBe(`hat:${OPS}`)
  })

  it('a field value: refused at its level, before the store is read', async () => {
    const w = await world()
    expect((await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'late-b@example.invalid' } }])).status).toBe(200)
    w.wear(A1, [])
    await refusedAtApply(w, { code: 'NOT_ADMITTED', error: `email of members:steward-b would be kept at hat:${OPS}, which you are not admitted to, so you cannot write it here.` })
    expect(w.store.fields('members', 'steward-b')).toEqual([])
  })
})

describe('staged private ops compose as 0.6 composes git ops (review I1)', () => {
  const GRANTS = { id: 'grants-private', visibility: `hat:${OPS}`, definition: { title: 'Grants' } }
  const stagedOps = (w: World) => w.store.staged(changeId(w.repo)).map(r => r.op)

  it('an update after a staged create merges into the create', async () => {
    const w = await world()
    await w.store.putCollection(GRANTS, 'steward-a')
    await stage(w, [{ op: 'create', record: 'grants-private:g-2', value: { id: 'g-2', title: 'one' } }])
    const res = await stage(w, [{ op: 'update', record: 'grants-private:g-2', set: { amount: 3 } }])
    expect(res.status).toBe(200)
    expect(res.body.private).toHaveLength(1)
    expect(stagedOps(w)).toEqual([{ op: 'create-record', collection: 'grants-private', id: 'g-2', visibility: `hat:${OPS}`, value: { id: 'g-2', title: 'one', amount: 3 } }])
  })

  it('a delete after a staged create cancels both', async () => {
    const w = await world()
    await w.store.putCollection(GRANTS, 'steward-a')
    const id = (await stage(w, [{ op: 'create', record: 'grants-private:g-2', value: { id: 'g-2', title: 'one' } }])).body.id
    const res = await stage(w, [{ op: 'delete', record: 'grants-private:g-2' }])
    expect(res.status).toBe(200)
    expect(res.body.private).toBeUndefined()
    expect(w.store.staged(id)).toEqual([])
    expect(existsSync(changeFile(w.repo))).toBe(false)
  })

  it('two updates merge; a create after anything staged is refused, as for git', async () => {
    const w = await world()
    await w.store.putCollection(GRANTS, 'steward-a')
    await w.store.putRecord({ collection: 'grants-private', id: 'g-1', visibility: `hat:${OPS}`, body: { id: 'g-1', title: 't' }, rev: 'r' }, 'steward-a', null)
    await stage(w, [{ op: 'update', record: 'grants-private:g-1', set: { title: 'two' } }])
    await stage(w, [{ op: 'update', record: 'grants-private:g-1', set: { amount: 5 } }])
    expect(stagedOps(w)).toEqual([{ op: 'update-record', collection: 'grants-private', id: 'g-1', set: { title: 'two', amount: 5 } }])
    const again = await stage(w, [{ op: 'create', record: 'grants-private:g-1', value: { id: 'g-1' } }])
    expect(again).toEqual({ status: 422, body: { errors: [{ record: 'grants-private:g-1', field: 'id', message: 'grants-private:g-1 is already in this change: edit it instead.' }] } })
  })

  it('apply composes the staged update with the record as the store holds it then', async () => {
    const w = await world()
    await w.store.putCollection(GRANTS, 'steward-a')
    await w.store.putRecord({ collection: 'grants-private', id: 'g-1', visibility: `hat:${OPS}`, body: { id: 'g-1', title: 't', amount: 1 }, rev: 'r' }, 'steward-a', null)
    await stage(w, [{ op: 'update', record: 'grants-private:g-1', set: { title: 'mine' } }])
    // Someone else changes the record between staging and apply.
    await w.store.putRecord({ collection: 'grants-private', id: 'g-1', visibility: `hat:${OPS}`, body: { id: 'g-1', title: 't', amount: 2 }, rev: 'r2' }, 'steward-b', null)
    expect((await w.local.request('/api/changes/apply', json('POST', {}))).status).toBe(200)
    expect(w.store.record('grants-private', 'g-1')!.body).toEqual({ id: 'g-1', title: 'mine', amount: 2 })
  })

  it('an update on a record gone by apply is refused with the words a hidden one gets, and nothing is written', async () => {
    const w = await world()
    await w.store.putCollection(GRANTS, 'steward-a')
    await w.store.putRecord({ collection: 'grants-private', id: 'g-1', visibility: `hat:${OPS}`, body: { id: 'g-1' }, rev: 'r' }, 'steward-a', null)
    await stage(w, [{ op: 'update', record: 'grants-private:g-1', set: { title: 'mine' } }])
    await w.store.deleteRecord('grants-private', 'g-1', 'steward-b', null)
    const before = commits(w.repo)
    const res = await w.local.request('/api/changes/apply', json('POST', {}))
    expect([res.status, await res.json()]).toEqual([409, { code: 'NO_RECORD', error: noRecord('grants-private', 'g-1') }])
    expect(commits(w.repo)).toBe(before)
  })
})

describe('Revise and Update proposal with a private part (review I2, M9)', () => {
  async function proposal(w: World): Promise<string> {
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer' } }])
    const res = await w.local.request('/api/proposals', json('POST', { title: 'Steward B keeps the treasury' }))
    const body = await res.json()
    expect([res.status, body]).toEqual([201, expect.anything()])
    return body.id
  }

  it('Propose with only a private part opens a proposal of placeholders alone (Task 15)', async () => {
    const w = await world(RESTRICTED, PROPOSING)
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'only@example.invalid' } }])
    const res = await w.local.request('/api/proposals', json('POST', { title: 'x' }))
    const body = await res.json()
    expect(res.status).toBe(201)
    const entry = readLedger(w.repo).entries.find(e => e.id === body.id)!
    expect((entry.ops as unknown as { op: string }[]).map(o => o.op)).toEqual(['private'])
  })

  it('Revise does not overwrite a tray holding only a private part: the tray holds a different change', async () => {
    const w = await world(RESTRICTED, PROPOSING)
    const id = await proposal(w)
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'kept@example.invalid' } }])
    const change = JSON.parse(readFileSync(changeFile(w.repo), 'utf8'))
    const res = await w.local.request(`/api/proposals/${id}/load`, json('POST', {}))
    expect([res.status, await res.json()]).toEqual([409, { code: 'TRAY_HOLDS', error: TRAY_HOLDS(id, 1), revises: null }])
    expect(JSON.parse(readFileSync(changeFile(w.repo), 'utf8'))).toEqual(change)
    expect(w.store.staged(change.id)).toHaveLength(1)
  })

  it('Update proposal carries the private part the revising tray holds (Task 15)', async () => {
    const w = await world(RESTRICTED, PROPOSING)
    const id = await proposal(w)
    expect((await w.local.request(`/api/proposals/${id}/load`, json('POST', {}))).status).toBe(200)
    const edited = await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'rev@example.invalid' } }])
    const ops = edited.body.ops.map(({ before: _b, ...op }: Record<string, unknown>) => op)
    const res = await w.local.request(`/api/proposals/${id}/revise`, json('POST', { ops }))
    expect([res.status, res.status === 200 ? '' : await res.text()]).toEqual([200, ''])
    expect(git(w.repo, 'log --all -p')).not.toContain('rev@example.invalid')
    expect(w.store.pending(id).map(p => p.ops)).toEqual([[expect.objectContaining({ op: 'put-field', field: expect.objectContaining({ value: 'rev@example.invalid' }) })]])
  })
})

describe('a store that fails after it opened (review M5, Task 4 ruling)', () => {
  const SQLITE = 'database disk image is malformed'
  const broken = (store: PrivateStore) => {
    const fail = () => { throw new Error(SQLITE) }
    store.fields = fail; store.records = fail; store.collections = fail; store.record = fail; store.staged = fail
    const said: string[] = []
    store.onFailure = text => { said.push(text) }
    return said
  }

  it('reads keep answering git and raise the store\'s attention; no sqlite words in the answer', async () => {
    const w = await world()
    const said = broken(w.store)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const got = await read(w.local, '/api/registries/members')
    expect(got.status).toBe(200)
    expect(got.body.entries.map((e: { id: string }) => e.id)).toEqual(['steward-a', 'steward-b', 'steward-c'])
    expect(got.text).not.toContain('malformed')
    expect(said[0]).toBe(STORE_FAILED)
    expect(errors.mock.calls.some(c => String(c[0]).includes(SQLITE))).toBe(true) // the server's log keeps what sqlite said
    errors.mockRestore()
  })

  it('a write is refused 503 with the §10.1 attention sentence, never sqlite\'s words', async () => {
    const w = await world()
    const said = broken(w.store)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await w.local.request('/api/changes/ops', json('POST', { ops: [{ op: 'update', record: 'members:steward-b', set: { email: 'b@example.invalid' } }] }))
    const text = await res.text()
    expect([res.status, JSON.parse(text)]).toEqual([503, { error: STORE_FAILED, code: 'PRIVATE_STORE' }])
    expect(text).not.toContain('malformed')
    expect(said).toContain(STORE_FAILED)
    errors.mockRestore()
  })

  it('a store that fails to commit after the git commit landed: 503 naming the commit; the change keeps its private part', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'late@example.invalid', role: 'Treasurer' } }])
    const id = changeId(w.repo)
    // The store's COMMIT fails after fn resolved (the git commit made): its writes are rolled back, and it throws.
    const store = w.store
    store.within = (async (fn: (t: PrivateTransaction) => Promise<unknown>) => {
      const t = await store.begin()
      try { await fn(t) } catch (err) { t.rollback(); throw err }
      t.rollback()
      throw new Error(SQLITE)
    }) as never
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await w.local.request('/api/changes/apply', json('POST', {}))
    const body = await res.json()
    errors.mockRestore()
    expect(res.status).toBe(503)
    expect(body.code).toBe('PRIVATE_STORE')
    expect(body.commit).toBe(git(w.repo, 'rev-parse HEAD').trim())
    expect(body.error).toContain(body.commit)
    expect(JSON.stringify(body)).not.toContain('malformed')
    const change = JSON.parse(readFileSync(changeFile(w.repo), 'utf8'))
    expect([change.id, change.ops, change.private.length]).toEqual([id, [], 1])
    expect(w.store.fields('members', 'steward-b')).toEqual([])
    expect(w.store.staged(id)).toHaveLength(1)
  })
})

describe('the empty commit (§10.3, git.ts)', () => {
  it('is refused, before git runs, while anything is staged: it would carry it', async () => {
    const w = await world()
    writeFileSync(join(w.repo, 'data', 'members.yaml'), `${MEMBERS}  - { id: steward-c, name: Steward C }\n`)
    git(w.repo, 'add data/members.yaml')
    const before = commits(w.repo)
    await expect(commitDataPaths(w.repo, [], RESTRICTED_SUBJECT, {}, { allowEmpty: true })).rejects.toThrow(/refusing the empty commit: data\/members.yaml is staged/)
    await expect(commitDataPaths(w.repo, [], RESTRICTED_SUBJECT)).rejects.toThrow(/no paths to commit/)
    expect(commits(w.repo)).toBe(before)
  })
})

describe('assertGitSafe (L5 spec §10.5)', () => {
  it('refuses a YAML text holding a restricted field and names the field, never the value', async () => {
    const w = await world()
    const text = `${MEMBERS}  - { id: steward-c, name: Steward C, email: "sentinel-7f3a-1@example.invalid" }\n`
    let err: unknown = null
    try { assertGitSafe(w.repo, [{ path: 'data/members.yaml', text }], readConfig(w.repo)) } catch (e) { err = e }
    expect(err).toBeInstanceOf(Refusal)
    const refusal = err as Refusal
    expect(refusal.status).toBe(500)
    expect(refusal.message).toContain('data/members.yaml')
    expect(refusal.message).toContain('email')
    expect(JSON.stringify(refusal.body)).not.toContain('sentinel-7f3a-1')
  })

  it('refuses a record whose own visibility is stricter than members; passes what git may hold', async () => {
    const w = await world()
    const strict = `${MEMBERS}  - { id: steward-c, name: Steward C, visibility: "hat:${OPS}" }\n`
    expect(() => assertGitSafe(w.repo, [{ path: 'data/members.yaml', text: strict }], readConfig(w.repo))).toThrow(/steward-c.*stricter than members/)
    expect(() => assertGitSafe(w.repo, [{ path: 'data/members.yaml', text: MEMBERS }], readConfig(w.repo))).not.toThrow()
  })

  it('refuses a proposal op writing a restricted field, open or closed; a placeholder passes', async () => {
    const w = await world()
    const ledger = (state: string, op: string) => `schema_version: "2.0"\nproposals:\n  - { id: p-2026-10-29-001-a3f9, state: ${state}, ops: [${op}] }\n`
    const writes = '{ op: update, record: "members:steward-b", set: { email: "sentinel-7f3a-3@example.invalid" } }'
    for (const state of ['open', 'ratified']) {
      expect(() => assertGitSafe(w.repo, [{ path: 'data/proposals.yaml', text: ledger(state, writes) }], readConfig(w.repo))).toThrow(/op 1 of proposal p-2026-10-29-001-a3f9, which writes email/)
    }
    const placeholder = '{ op: private, ref: prv_0123456789abcdef, class: members, digest: "sha256:00" }'
    expect(() => assertGitSafe(w.repo, [{ path: 'data/proposals.yaml', text: ledger('open', placeholder) }], readConfig(w.repo))).not.toThrow()
  })

  it('an apply that would write a restricted value to git is refused before the commit', async () => {
    const w = await world()
    // A value written straight into the file by hand: the next apply touching that file would commit it.
    writeFileSync(join(w.repo, 'data', 'members.yaml'), `${MEMBERS}  - { id: steward-c, name: Steward C, email: "sentinel-7f3a-2@example.invalid" }\n`)
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "fixture: a restricted value by hand"')
    const before = commits(w.repo)
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer' } }])
    const res = await w.local.request('/api/changes/apply', json('POST', {}))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('RESTRICTED_IN_GIT')
    expect(JSON.stringify(body)).not.toContain('sentinel-7f3a-2')
    expect(commits(w.repo)).toBe(before)
  })
})
