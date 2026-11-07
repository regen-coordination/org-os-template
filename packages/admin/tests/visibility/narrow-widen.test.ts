import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import { parse } from 'yaml'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { mountSession } from '../../server/session/routes.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { mountVisibility } from '../../server/visibility/routes.ts'
import { Membership } from '../../server/session/membership.ts'
import { createSession } from '../../server/session/sessions.ts'
import { openPrivateStore, StoreUnavailable, type PrivateStore } from '../../server/private/store.ts'
import { reconcilePrivate } from '../../server/private/proposals.ts'
import { assertGitSafe, gitSafetyProblems } from '../../server/private/guard.ts'
import { readConfig } from '../../server/visibility/config.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { LEAVES_GIT, NARROW_RULE, WIDENS } from '../../server/visibility/narrow.ts'
import { OWN_LINK } from '../../server/visibility/widen.ts'
import { revOf } from '../../lib/proposals.mjs'
import { validateRepo } from '../../lib/data-validate.mjs'
import { canAct } from '../../lib/rules.mjs'
import { actorForEmail } from '../../server/actor.ts'
import type { WearerReading, WearersReading } from '../../server/systems/hats.ts'

// L5 spec §9.7 (narrowing and widening), §10.5, §13 (POST /api/visibility/narrow), C-14; Task 16, with the controller's
// rulings: a narrowing turns the ledger's ops on what leaves git into placeholders, open and closed (R-L5-10.7); it is
// the way out for values git already held (R-L5-14.4); and nothing it narrows stays readable at a wider level, in the
// store's fields, staged ops or pending parts (Task 15 review M2).
//
// Every test builds a fresh temporary repository (makeChangeRepo) and keeps its private store in a temp folder of its own:
// nothing is written inside this worktree, nothing touches the network. Locally, git's identity is steward-a, whose wallet
// is A1 (Ops). A2 wears Council (a sibling of Ops, so not admitted to it) and decides. A3 wears Ops and is steward-b's own
// address, not yet linked in git. A4 wears the top hat, above Ops and Council.

const T0 = new Date('2026-10-29T12:00:00Z')
const CELO = 'eip155:42220'
const TOP = `${CELO}:0x0000000d${'0'.repeat(56)}`
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const OPS = `${CELO}:0x0000000d0002${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000a1`
const A2 = `${CELO}:0x00000000000000000000000000000000000000a2`
const A3 = `${CELO}:0x00000000000000000000000000000000000000a3`
const A4 = `${CELO}:0x00000000000000000000000000000000000000a4`
const FRAMEWORK = fileURLToPath(new URL('../../../../', import.meta.url))

/** Members' and records' changes, and publications, are proposed by Ops and approved by one Council wearer. */
const GOVERNANCE = (classes = 'members, records, publication') => `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
  rules:
    - { id: people, applies_to: [${classes}], propose: ops, decide: { by: council, method: approve, count: 1 } }
  decisions: []
`
const SOLO = `schema_version: "2.0"
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
  - { id: steward-a, name: Steward A, kind: person, email: steward-a@example.invalid, handles: { git: ["admin-test@local"], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person, email: steward-b@example.invalid }
  - { id: steward-c, name: Steward C, kind: person, handles: { git: ["steward-c@example.test"] } }
`
const MEMBERS_NO_EMAIL = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["admin-test@local"], wallet: "${A1}" } }
  - { id: steward-b, name: Steward B, kind: person }
  - { id: steward-c, name: Steward C, kind: person, handles: { git: ["steward-c@example.test"] } }
`
const PROJECTS = `schema_version: "2.0"
projects:
  - { id: p-open, title: "Open project", status: execute, type: program, visibility: public }
  - { id: p-two, title: "Second project", status: execute, type: program }
`
const PLAIN = `visibility:
  collections:
    projects: { default: members }
    members: { default: members }
`
const EMAIL_AT_OPS = `visibility:
  collections:
    projects: { default: members }
    members: { default: members, fields: { email: "hat:${OPS}" } }
`

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed by the test */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface World {
  repo: string
  store: PrivateStore
  app: Hono
  appWith: (access: () => PrivateStore) => Hono
  signIn: (account: string) => Promise<string>
  wear: (account: string, hats: string[]) => void
  tick: (ms: number) => void
  /** What the routes told the open pages (the WebSocket's `notify`). */
  notices: unknown[]
}

async function world(o: { governance?: string; visibility?: string; members?: string; projects?: string } = {}): Promise<World> {
  const repo = makeChangeRepo(o.governance ?? GOVERNANCE())
  cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'members.yaml'), o.members ?? MEMBERS)
  writeFileSync(join(repo, 'data', 'projects.yaml'), o.projects ?? PROJECTS)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), o.visibility ?? PLAIN)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree, three members, two projects, the policy"')
  const dir = mkdtempSync(join(tmpdir(), 'narrow-widen-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  let clock = T0
  const now = () => clock
  const worn: Record<string, string[]> = { [A1]: [OPS], [A2]: [COUNCIL], [A3]: [OPS], [A4]: [TOP] }
  const hatsOf = (account: string) => Object.entries(worn).find(([a]) => a.toLowerCase().endsWith(account.toLowerCase().slice(-40)))?.[1] ?? []
  const reading = (account: string): WearerReading => ({ ok: true, system: 'hats-main', chain: CELO, account, hats: hatsOf(account), block: 100, readAt: clock.toISOString() })
  const list = (hat: string): WearersReading => {
    const wearers = Object.entries(worn).filter(([, h]) => h.includes(hat)).map(([a]) => a)
    return { ok: true, system: 'hats-main', hat, wearers, holders: wearers, complete: true, block: 100, readAt: clock.toISOString() }
  }
  const reader = {
    wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => reading(account)),
    wearers: vi.fn(async (_s: Record<string, unknown>, hat: string) => list(hat)),
  }
  const membership = new Membership({ repo, reader: reader as never, now })
  const notices: unknown[] = []
  const appWith = (access: () => PrivateStore) => createApp(repo, (a, ctx) => {
    mountSession(a, { repo, store, membership, hosted: false, now })
    mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now, privateStore: ctx.privateStore })
    mountVisibility(a, { repo, membership, withLock: ctx.withLock, privateStore: ctx.privateStore, notify: msg => notices.push(msg) })
  }, { request: withRequest({ repo, hosted: false, membership, store, now }), privateStore: access })
  const signIn = async (account: string) => {
    await membership.forAct(account)
    return `house_session=${(await createSession(store, account, now)).token}`
  }
  return {
    repo, store, app: appWith(() => store), appWith, signIn, notices,
    wear: (account, hats) => { worn[account] = hats },
    tick: ms => { clock = new Date(clock.getTime() + ms) },
  }
}

function call(app: Hono, method: string, path: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: 'localhost:4680' }
  if (method !== 'GET') headers['content-type'] = 'application/json'
  if (o.cookie) headers.cookie = o.cookie
  return app.request(`http://localhost:4680${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
}
async function ok(res: Response, status = 200): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const text = await res.text()
  expect([res.status, res.status === status ? '' : text]).toEqual([status, ''])
  return JSON.parse(text)
}
async function refused(res: Response): Promise<[number, any]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return [res.status, await res.json()]
}
const narrow = (w: World, target: unknown, level: string, cookie?: string) => call(w.app, 'POST', '/api/visibility/narrow', { body: { target, level }, cookie })
const stage = async (w: World, ops: unknown[], cookie?: string) => ok(await call(w.app, 'POST', '/api/changes/ops', { body: { ops }, cookie }))
async function propose(w: World, title: string, cookie?: string): Promise<string> {
  return String((await ok(await call(w.app, 'POST', '/api/proposals', { body: { title }, cookie }), 201)).id)
}
const approve = async (w: World, id: string, cookie: string) => ok(await call(w.app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'approve' }, cookie }))
const ratify = async (w: World, id: string, cookie: string) => ok(await call(w.app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie }))
const entryOf = (repo: string, id: string) => readLedger(repo).entries.find(e => String(e.id) === id)! as any // eslint-disable-line @typescript-eslint/no-explicit-any
const head = (repo: string) => git(repo, 'rev-parse HEAD').trim()
const fileAt = (repo: string, rel: string, rev = 'HEAD') => git(repo, `show ${rev}:${rel}`)
const recordsOf = (repo: string, name: string) => parse(fileAt(repo, `data/${name}.yaml`))[name] as Record<string, unknown>[]
const message = (repo: string, rev = 'HEAD') => git(repo, `log -1 --format=%B ${rev}`)
const errorsOf = (repo: string) => validateRepo(repo).filter((p: { level: string }) => p.level === 'error')
/** validate:governance on the newest commit alone (the fixture's own commits are no narrowing's to judge). */
const governanceOfHead = (repo: string) =>
  spawnSync(process.execPath, ['scripts/validate-governance.mjs', repo, '--strict', '--range', 'HEAD~1..HEAD'], { cwd: FRAMEWORK, encoding: 'utf8' })
const PLACEHOLDER = (cls: string) => ({ op: 'private', ref: expect.stringMatching(/^prv_[0-9a-f]{16}$/), class: cls, digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) })

describe('Narrowing applies at once (§9.7)', () => {
  it('narrowing a public record to members applies at once, one commit with Org-Rule: visibility/narrow', async () => {
    const w = await world()
    const before = head(w.repo)
    const out = await ok(await narrow(w, { registry: 'projects', id: 'p-open' }, 'members'))
    expect(out).toEqual({ commit: head(w.repo), moved: false })
    expect(git(w.repo, `rev-list --count ${before}..HEAD`).trim()).toBe('1')
    expect(recordsOf(w.repo, 'projects').find(p => p.id === 'p-open')).toMatchObject({ visibility: 'members' })
    expect(git(w.repo, 'show --name-only --format= HEAD').trim()).toBe('data/projects.yaml')
    expect(message(w.repo)).toMatch(new RegExp(`\\n\\nOrg-Actor: steward-a\\nOrg-Rule: ${NARROW_RULE}\\s*$`))
    // Outside the written rules (records need Council's approval): validate:governance accepts it as a narrowing.
    const run = governanceOfHead(w.repo)
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    expect(run.stdout).not.toContain('"visibility: narrow')
  })

  it('narrowing a record to hat:Ops removes it from the YAML and puts it in the store, in one act; moved: true; the copy is §9.7\'s', async () => {
    expect(LEAVES_GIT).toBe("It leaves the repository from now on. Its earlier versions stay in the repository's history, which members could already read.")
    const w = await world()
    const out = await ok(await narrow(w, { registry: 'projects', id: 'p-two' }, `hat:${OPS}`))
    expect(out).toEqual({ commit: head(w.repo), moved: true })
    expect(recordsOf(w.repo, 'projects').map(p => p.id)).toEqual(['p-open'])
    expect(w.store.record('projects', 'p-two')).toMatchObject({ visibility: `hat:${OPS}`, body: { id: 'p-two', title: 'Second project', status: 'execute', type: 'program' } })
    expect(w.store.history('projects/p-two')).toEqual([expect.objectContaining({ by: 'steward-a', before: null })])
    expect(message(w.repo)).toContain(`Org-Rule: ${NARROW_RULE}`)
    // Read through the gate: an Ops wearer still sees it, Council does not.
    const council = await w.signIn(A2)
    const seen = await ok(await call(w.app, 'GET', '/api/registries/projects'))
    const unseen = await ok(await call(w.app, 'GET', '/api/registries/projects', { cookie: council }))
    expect(seen.entries.map((e: { id: string }) => e.id)).toEqual(['p-open', 'p-two'])
    expect(unseen.entries.map((e: { id: string }) => e.id)).toEqual(['p-open'])
    expect(errorsOf(w.repo)).toEqual([])
    const run = governanceOfHead(w.repo)
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
  })

  it('narrowing a collection\'s email field to Ops moves every existing value out of git', async () => {
    const w = await world()
    const out = await ok(await narrow(w, { collection: 'members', field: 'email' }, `hat:${OPS}`))
    expect(out.moved).toBe(true)
    // Every e-mail field leaves; steward-b, who had no handles.git, keeps the e-mail as that identity (Q78).
    const members = fileAt(w.repo, 'data/members.yaml')
    expect(members).not.toContain('steward-a@example.invalid')
    expect(recordsOf(w.repo, 'members').filter(m => 'email' in m)).toEqual([])
    expect(recordsOf(w.repo, 'members').find(m => m.id === 'steward-b')!.handles).toEqual({ git: 'steward-b@example.invalid' })
    expect(parse(fileAt(w.repo, 'data/visibility.yaml')).visibility.collections.members.fields).toEqual({ email: `hat:${OPS}` })
    expect(w.store.fieldsNamed('members', 'email')).toEqual([
      { registry: 'members', record: 'steward-a', field: 'email', visibility: `hat:${OPS}`, value: 'steward-a@example.invalid' },
      { registry: 'members', record: 'steward-b', field: 'email', visibility: `hat:${OPS}`, value: 'steward-b@example.invalid' },
    ])
    expect(git(w.repo, 'show --name-only --format= HEAD').trim().split('\n').sort()).toEqual(['data/members.yaml', 'data/visibility.yaml'])
    // Its earlier versions stay in the history (C-14): the commit before still holds them.
    expect(fileAt(w.repo, 'data/members.yaml', 'HEAD~1')).toContain('steward-b@example.invalid')
    // An Ops wearer reads them through the store; Council sees that they are there, never the value.
    const council = await w.signIn(A2)
    const asCouncil = await ok(await call(w.app, 'GET', '/api/registries/members', { cookie: council }))
    expect(asCouncil.entries.find((e: { id: string }) => e.id === 'steward-b')).toMatchObject({ restricted: { email: `hat:${OPS}` } })
    expect(asCouncil.entries.find((e: { id: string }) => e.id === 'steward-b')).not.toHaveProperty('email')
    expect(JSON.stringify(asCouncil)).not.toContain('steward-a@example.invalid')
    const asOps = await ok(await call(w.app, 'GET', '/api/registries/members'))
    expect(asOps.entries.find((e: { id: string }) => e.id === 'steward-b')).toMatchObject({ email: 'steward-b@example.invalid' })
    expect(errorsOf(w.repo)).toEqual([])
    const run = governanceOfHead(w.repo)
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
  })

  it('narrowing to a hat the actor is not admitted to is 403, and writes nothing', async () => {
    const w = await world()
    const before = head(w.repo)
    const [status, body] = await refused(await narrow(w, { registry: 'projects', id: 'p-two' }, `hat:${COUNCIL}`))
    expect([status, body.code]).toEqual([403, 'NOT_ADMITTED'])
    expect(body.error).toBe(`You are not admitted to hat:${COUNCIL}, so you cannot narrow anything to it: you could no longer read it yourself. Nothing was written.`)
    expect(head(w.repo)).toBe(before)
    expect(w.store.record('projects', 'p-two')).toBeNull()
  })

  it('a "narrowing" that widens is 409, and one that changes nothing is 409 too', async () => {
    const w = await world()
    await ok(await narrow(w, { registry: 'projects', id: 'p-two' }, `hat:${OPS}`))
    const before = head(w.repo)
    // Ops → members, and Ops → Council (not ordered with it): both let someone new read it.
    for (const level of ['members', `hat:${COUNCIL}`]) {
      const [status, body] = await refused(await narrow(w, { registry: 'projects', id: 'p-two' }, level))
      expect([status, body]).toEqual([409, { code: 'WIDENS', error: 'This makes it readable by more people, so it is proposed, not applied.' }])
    }
    expect(WIDENS).toBe('This makes it readable by more people, so it is proposed, not applied.')
    const [status, body] = await refused(await narrow(w, { registry: 'projects', id: 'p-open' }, 'public'))
    expect([status, body.code]).toEqual([409, 'UNCHANGED'])
    expect(head(w.repo)).toBe(before)
  })

  it('a field of one record is narrowed for its collection; a git collection is never stricter than members', async () => {
    const w = await world()
    const [s1, b1] = await refused(await narrow(w, { registry: 'members', id: 'steward-b', field: 'email' }, `hat:${OPS}`))
    expect([s1, b1.code]).toEqual([422, 'FIELD_OF_COLLECTION'])
    const [s2, b2] = await refused(await narrow(w, { collection: 'projects' }, `hat:${OPS}`))
    expect([s2, b2.code]).toEqual([422, 'COLLECTION_IN_GIT'])
  })

  it('a record kept in the store is narrowed there: an empty commit, the store re-levelled, its fields with it', async () => {
    const w = await world()
    await ok(await narrow(w, { registry: 'projects', id: 'p-two' }, `hat:${OPS}`))
    w.wear(A4, [TOP, OPS]) // Q77: a narrowing is a write; the top hat alone holds no role that proposes records
    const four = await w.signIn(A4)
    const before = head(w.repo)
    const out = await ok(await narrow(w, { registry: 'projects', id: 'p-two' }, `hat:${TOP}`, four))
    expect(out.moved).toBe(false)
    expect(git(w.repo, `diff --name-only ${before} HEAD`).trim()).toBe('')
    expect(message(w.repo)).toMatch(/^A change to a restricted collection\n/)
    expect(message(w.repo)).toContain(`Org-Rule: ${NARROW_RULE}`)
    expect(w.store.record('projects', 'p-two')!.visibility).toBe(`hat:${TOP}`)
    // An Ops wearer no longer reads it.
    expect((await ok(await call(w.app, 'GET', '/api/registries/projects'))).entries.map((e: { id: string }) => e.id)).toEqual(['p-open'])
  })

  it('a store that cannot be reached refuses a narrowing that leaves git, before anything is written', async () => {
    const w = await world()
    const down = w.appWith(() => { throw new StoreUnavailable('The private store is down for this test.') })
    const before = head(w.repo)
    const res = await call(down, 'POST', '/api/visibility/narrow', { body: { target: { registry: 'projects', id: 'p-two' }, level: `hat:${OPS}` } })
    expect(await refused(res)).toEqual([503, { error: 'The private store is down for this test.', code: 'PRIVATE_STORE' }])
    expect(head(w.repo)).toBe(before)
    expect(fileAt(w.repo, 'data/projects.yaml')).toContain('p-two')
  })
})

describe('The ledger after a narrowing (R-L5-10.7)', () => {
  it('open and closed proposals that wrote the value hold placeholders from the narrowing commit on; the open one still ratifies', async () => {
    const w = await world()
    const council = await w.signIn(A2)
    // Ratified: steward-b's e-mail and role. Withdrawn: steward-a's e-mail. Open: steward-b's e-mail again, and a role.
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'b-ratified@example.invalid' } }])
    const ratified = await propose(w, 'B gets a new address')
    await approve(w, ratified, council)
    await ratify(w, ratified, council)
    await stage(w, [{ op: 'update', record: 'members:steward-a', set: { email: 'a-withdrawn@example.invalid' } }])
    const withdrawn = await propose(w, 'A changes address')
    await ok(await call(w.app, 'POST', `/api/proposals/${withdrawn}/events`, { body: { kind: 'withdraw' } }))
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer', email: 'b-open@example.invalid' } }])
    const open = await propose(w, 'B keeps the treasury')
    await approve(w, open, council)
    const opened = entryOf(w.repo, open)

    await ok(await narrow(w, { collection: 'members', field: 'email' }, `hat:${OPS}`))
    const ledger = fileAt(w.repo, 'data/proposals.yaml')
    expect(ledger).not.toMatch(/@example\.invalid/)
    expect(git(w.repo, 'show --name-only --format= HEAD').trim().split('\n').sort()).toEqual(['data/members.yaml', 'data/proposals.yaml', 'data/visibility.yaml'])
    // Open: its git op without the e-mail, then a placeholder; its rev is the rev of what git holds; its part is pending.
    const now = entryOf(w.repo, open)
    expect(now.ops).toEqual([{ ...opened.ops[0], set: { role: 'Treasurer' } }, PLACEHOLDER('members')])
    expect(now.rev).toBe(revOf(now.ops))
    expect(w.store.pending(open)).toEqual([expect.objectContaining({ ref: now.ops[1].ref, ops: [
      { op: 'put-field', field: { registry: 'members', record: 'steward-b', field: 'email', visibility: `hat:${OPS}`, value: 'b-open@example.invalid' } },
    ] })])
    // Closed: only a placeholder where the e-mail was; nothing else of them changes. The ratified one is marked applied.
    expect(entryOf(w.repo, ratified).ops).toEqual([PLACEHOLDER('members')])
    expect(entryOf(w.repo, withdrawn).ops).toEqual([PLACEHOLDER('members')])
    expect(entryOf(w.repo, ratified).state).toBe('ratified')
    expect(w.store.applied(ratified)).toEqual(expect.objectContaining({ commit: head(w.repo) }))
    expect(await reconcilePrivate(w.repo, w.store)).toEqual([])
    expect(w.store.fields('members', 'steward-b')).toEqual([expect.objectContaining({ value: 'b-ratified@example.invalid', visibility: `hat:${OPS}` })])
    // The validators: nothing stricter than members in git, and the narrowing commit is one.
    expect(errorsOf(w.repo)).toEqual([])
    const run = governanceOfHead(w.repo)
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)

    // The open one ratifies. steward-b's record changed under it (its e-mail left git), so its author keeps their op first,
    // and it is approved again on its new rev: its git part goes to git, its e-mail to the store.
    expect((await refused(await call(w.app, 'POST', `/api/proposals/${open}/events`, { body: { kind: 'approve' }, cookie: council })))[1].state).toBe('stale')
    await ok(await call(w.app, 'POST', `/api/proposals/${open}/replay`, { body: { choose: 'mine' } }))
    await approve(w, open, council)
    await ratify(w, open, council)
    expect(recordsOf(w.repo, 'members').find(m => m.id === 'steward-b')).toMatchObject({ role: 'Treasurer' })
    expect(fileAt(w.repo, 'data/members.yaml')).not.toContain('b-open@example.invalid')
    expect(w.store.fields('members', 'steward-b')).toEqual([expect.objectContaining({ value: 'b-open@example.invalid', visibility: `hat:${OPS}` })])
  })

  it('a record narrowed out of git takes the open proposals\' ops on it into the store with it', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'projects:p-two', set: { status: 'archive' } }])
    const id = await propose(w, 'Archive the second project')
    await ok(await narrow(w, { registry: 'projects', id: 'p-two' }, `hat:${OPS}`))
    const entry = entryOf(w.repo, id)
    expect(entry.ops).toEqual([PLACEHOLDER('records')])
    expect(w.store.pending(id)[0]!.ops).toEqual([{ op: 'update-record', collection: 'projects', id: 'p-two', set: { status: 'archive' } }])
    expect(errorsOf(w.repo)).toEqual([])
  })

  it('what a revise event recorded leaves git with the narrowing too, and a value planted in one is flagged (final review MF-2)', async () => {
    const w = await world()
    type Op = { set: Record<string, unknown> }
    // Update proposal as the tray does it: the proposal loaded, its ops edited, sent back with their bases; the tray emptied.
    const revise = async (id: string, edit: (set: Record<string, unknown>) => Record<string, unknown>) => {
      await ok(await call(w.app, 'POST', `/api/proposals/${id}/load`, { body: {} }))
      const tray = (await ok(await call(w.app, 'GET', '/api/changes'))).ops as (Op & { before?: unknown })[]
      const ops = tray.map(({ before: _b, ...op }) => ({ ...op, set: edit(op.set) }))
      await ok(await call(w.app, 'POST', `/api/proposals/${id}/revise`, { body: { ops } }))
      await call(w.app, 'DELETE', '/api/changes')
    }
    // One proposal revised to write an e-mail and revised again without it: only its first revise event holds the value.
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer' } }])
    const earlier = await propose(w, 'B keeps the treasury')
    await revise(earlier, set => ({ ...set, email: 'b-revised@example.invalid' }))
    await revise(earlier, ({ email: _e, ...set }) => set)
    // Another whose last revision writes one: its revise event holds the same ops as the proposal.
    await stage(w, [{ op: 'update', record: 'members:steward-c', set: { role: 'Scribe' } }])
    const latest = await propose(w, 'C takes the minutes')
    await revise(latest, set => ({ ...set, email: 'c-revised@example.invalid' }))
    const before = { earlier: entryOf(w.repo, earlier), latest: entryOf(w.repo, latest) }
    const revisesOf = (entry: any) => entry.events.filter((e: { kind: string }) => e.kind === 'revise') // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(revisesOf(before.earlier)).toHaveLength(2)

    await ok(await narrow(w, { collection: 'members', field: 'email' }, `hat:${OPS}`))
    const ledger = fileAt(w.repo, 'data/proposals.yaml')
    expect(ledger).not.toContain('b-revised')
    expect(ledger).not.toContain('c-revised')
    // The earlier: its ops and rev unchanged; its first revise event holds a placeholder where the e-mail was.
    const e = entryOf(w.repo, earlier)
    expect([e.ops, e.rev]).toEqual([before.earlier.ops, before.earlier.rev])
    const first = revisesOf(before.earlier)[0]
    expect(revisesOf(e)[0]).toEqual({ ...first, ops: [{ ...first.ops[0], set: { role: 'Treasurer' } }, PLACEHOLDER('members')] })
    expect(revisesOf(e)[1]).toEqual(revisesOf(before.earlier)[1])
    // The latest: its revise event holds what the proposal holds now, at its new rev.
    const l = entryOf(w.repo, latest)
    expect(l.ops).toEqual([{ ...before.latest.ops[0], set: { role: 'Scribe' } }, PLACEHOLDER('members')])
    expect(revisesOf(l)[0]).toEqual({ ...revisesOf(before.latest)[0], ops: l.ops, rev: l.rev })
    expect(l.rev).toBe(revOf(l.ops))
    // Both validators accept the narrowing commit, and nothing stricter than members is left in git.
    expect(errorsOf(w.repo)).toEqual([])
    const run = governanceOfHead(w.repo)
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)

    // A value planted back into a revise event is reported by validate:data and refused by assertGitSafe.
    const planted = ledger.replace(/(kind: revise[\s\S]*?set:\s*\{?\s*role: Treasurer)/, '$1, email: b-planted@example.invalid')
    expect(planted).toContain('b-planted@example.invalid')
    writeFileSync(join(w.repo, 'data', 'proposals.yaml'), planted)
    expect(errorsOf(w.repo).map((p: { file: string; message: string }) => [p.file, p.message]))
      .toContainEqual(['data/proposals.yaml', expect.stringMatching(/revise .*writes email, which data\/visibility\.yaml restricts/)])
    const problems = gitSafetyProblems(w.repo, [{ path: 'data/proposals.yaml', text: planted }], readConfig(w.repo))
    expect(problems.map(p => [p.record, p.field])).toContainEqual([earlier, 'email'])
    expect(() => assertGitSafe(w.repo, [{ path: 'data/proposals.yaml', text: planted }], readConfig(w.repo))).toThrow()
  })
})

describe('Values git already held leave it by a narrowing (R-L5-14.4)', () => {
  it('members.yaml holding an e-mail data/visibility.yaml restricts refuses every apply to it; narrowing the field makes it writable again', async () => {
    const w = await world({ governance: SOLO, visibility: EMAIL_AT_OPS })
    // The e-mails were in git before the field was restricted by hand: a write to members.yaml is refused.
    const blocked = await call(w.app, 'PUT', '/api/registries/members/steward-c', { body: { id: 'steward-c', name: 'Steward C', kind: 'person', role: 'Host' } })
    expect([blocked.status, (await blocked.json()).code]).toEqual([500, 'RESTRICTED_IN_GIT'])
    // The narrowing to the level the policy already says is the way out: nothing else would take them out of git.
    const out = await ok(await narrow(w, { collection: 'members', field: 'email' }, `hat:${OPS}`))
    expect(out.moved).toBe(true)
    expect(fileAt(w.repo, 'data/members.yaml')).not.toContain('steward-a@example.invalid')
    expect(recordsOf(w.repo, 'members').filter(m => 'email' in m)).toEqual([])
    expect(git(w.repo, 'show --name-only --format= HEAD').trim()).toBe('data/members.yaml')
    expect(w.store.fieldsNamed('members', 'email').map(f => f.record)).toEqual(['steward-a', 'steward-b'])
    await ok(await call(w.app, 'PUT', '/api/registries/members/steward-c', { body: { id: 'steward-c', name: 'Steward C', kind: 'person', role: 'Host' } }))
    expect(recordsOf(w.repo, 'members').find(m => m.id === 'steward-c')).toMatchObject({ role: 'Host' })
    expect(errorsOf(w.repo)).toEqual([])
    // Once out, the same narrowing changes nothing.
    expect((await refused(await narrow(w, { collection: 'members', field: 'email' }, `hat:${OPS}`)))[1].code).toBe('UNCHANGED')
  })

  it('a wallet link git held before the default (R-L5-18.7) stays writable, and narrowing members.wallet takes it out of git', async () => {
    const CONTACT_AT_OPS = `visibility:\n  defaults: { contact: "hat:${OPS}" }\n  collections:\n    projects: { default: members }\n    members: { default: members }\n`
    const w = await world({ governance: SOLO, visibility: CONTACT_AT_OPS, members: MEMBERS_NO_EMAIL.replace('name: Steward B, kind: person', `name: Steward B, kind: person, wallet: "${A3}"`) })
    // validate:data reports it (a snapshot); the server still saves the record that holds it (R-L5-14.4's carve-out).
    expect(errorsOf(w.repo).map((p: { id?: string; path: string }) => [p.id, p.path])).toEqual([['steward-b', 'wallet']])
    await ok(await call(w.app, 'PUT', '/api/registries/members/steward-b', { body: { id: 'steward-b', name: 'Steward B', kind: 'person', role: 'Host', wallet: A3 } }))
    const out = await ok(await narrow(w, { collection: 'members', field: 'wallet' }, `hat:${OPS}`))
    expect(out.moved).toBe(true)
    expect(fileAt(w.repo, 'data/members.yaml').toLowerCase()).not.toContain('00a3')
    expect(w.store.fieldsNamed('members', 'wallet').map(f => [f.record, f.visibility])).toEqual([['steward-b', `hat:${OPS}`]])
    expect(errorsOf(w.repo)).toEqual([])
    const run = governanceOfHead(w.repo)
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
  })
})

describe('Nothing narrowed stays readable at a wider level (Task 15 review M2)', () => {
  it('a pending part, a staged op and a stored value of a field narrowed after them are read at the new level only', async () => {
    const w = await world({ visibility: EMAIL_AT_OPS, members: MEMBERS_NO_EMAIL })
    // A stored e-mail at Ops; an open proposal of another at Ops (pending); a third staged in Ops's tray.
    await w.store.putField({ registry: 'members', record: 'steward-c', field: 'email', visibility: `hat:${OPS}`, value: 'c-stored@example.invalid' }, 'steward-a', null)
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'b-pending@example.invalid' } }])
    const id = await propose(w, 'B gets an address')
    const tray = await stage(w, [{ op: 'update', record: 'members:steward-a', set: { email: 'a-staged@example.invalid' } }])
    const ops = await ok(await call(w.app, 'GET', `/api/proposals/${id}`))
    expect(ops.private).toBeDefined() // Ops reads the pending part before the narrowing

    w.wear(A4, [TOP, OPS]) // Q77: a narrowing is a write; the top hat alone holds no role that proposes members
    const four = await w.signIn(A4)
    await ok(await narrow(w, { collection: 'members', field: 'email' }, `hat:${TOP}`, four))
    // Ops (A1) is not admitted to the top hat: the proposal reads as restricted, the stored value is a marker.
    const page = await ok(await call(w.app, 'GET', `/api/proposals/${id}`))
    expect(page).toMatchObject({ restricted: true, title: 'A change to a restricted collection' })
    expect(JSON.stringify(page)).not.toContain('b-pending@example.invalid')
    const listed = await ok(await call(w.app, 'GET', '/api/registries/members'))
    expect(listed.entries.find((e: { id: string }) => e.id === 'steward-c')).toMatchObject({ restricted: { email: `hat:${TOP}` } })
    expect(JSON.stringify(listed)).not.toContain('c-stored@example.invalid')
    // The store's rows are at the new level: the stored field, and the staged op (its apply judges the stager against it).
    expect(w.store.fields('members', 'steward-c')[0]!.visibility).toBe(`hat:${TOP}`)
    expect(w.store.staged(tray.id)).toEqual([expect.objectContaining({ op: expect.objectContaining({ field: expect.objectContaining({ visibility: `hat:${TOP}` }) }) })])
    // The top hat's wearer reads them all.
    expect((await ok(await call(w.app, 'GET', `/api/proposals/${id}`, { cookie: four }))).private).toBeDefined()
  })
})

describe('Widening is a publication decision (§9.7)', () => {
  it('setting visibility: public on a record stages a change of classes [records, publication]', async () => {
    const w = await world()
    const view = await stage(w, [{ op: 'update', record: 'projects:p-two', set: { visibility: 'public' } }])
    expect(view.classes).toEqual(['records', 'publication'])
    // An edit that widens nothing stays records alone.
    await call(w.app, 'DELETE', '/api/changes')
    expect((await stage(w, [{ op: 'update', record: 'projects:p-two', set: { title: 'Two' } }])).classes).toEqual(['records'])
  })

  it('with written rules and none covering publication, it cannot be proposed', async () => {
    const w = await world({ governance: GOVERNANCE('members, records') })
    await stage(w, [{ op: 'update', record: 'projects:p-two', set: { visibility: 'public' } }])
    const [status, body] = await refused(await call(w.app, 'POST', '/api/proposals', { body: { title: 'Publish the second project' } }))
    expect([status, body.code]).toEqual([409, 'NO_RULE'])
    expect(body.error).toBe('No rule in data/governance.yaml covers the class publication; nobody can propose it until a rule does. Nothing was written.')
  })

  it('a wallet link is widened only by its own person: another member\'s proposal is 403', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { handles: { wallet: A3 } } }])
    const before = head(w.repo)
    const [status, body] = await refused(await call(w.app, 'POST', '/api/proposals', { body: { title: 'Link steward-b' } }))
    expect([status, body]).toEqual([403, { code: 'OWN_LINK', error: 'Only the person whose address it is can widen this link.' }])
    expect(OWN_LINK).toBe('Only the person whose address it is can widen this link.')
    expect(head(w.repo)).toBe(before)
  })

  it('widening one\'s own link to members writes handles.wallet on ratify, and that person then acts as their member id', async () => {
    const w = await world()
    const three = await w.signIn(A3)
    expect((await ok(await call(w.app, 'GET', '/api/actor', { cookie: three }))).id.toLowerCase()).toBe(A3)
    const view = await stage(w, [{ op: 'update', record: 'members:steward-b', set: { handles: { wallet: A3 } } }], three)
    expect(view.classes).toEqual(['members', 'publication'])
    const id = await propose(w, 'My own link', three)
    expect(entryOf(w.repo, id).author.toLowerCase()).toBe(A3)
    expect(entryOf(w.repo, id).classes).toEqual(['members', 'publication'])
    const council = await w.signIn(A2)
    await approve(w, id, council)
    await ratify(w, id, council)
    expect(recordsOf(w.repo, 'members').find(m => m.id === 'steward-b')).toMatchObject({ handles: { wallet: A3 } })
    expect((await ok(await call(w.app, 'GET', '/api/actor', { cookie: three }))).id).toBe('steward-b')
  })
})

// ── Fix round 1 (task-16-review.md: C1, I1–I5, the private collection check) ──────────────────────────────────────

/** Records are decided by consent of the council in a one-minute window (or by its vote); the rest as before. */
const DECIDED = (decide: string) => `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
  rules:
    - { id: records, applies_to: [records], propose: ops, decide: ${decide} }
    - { id: people, applies_to: [members, publication], propose: ops, decide: { by: council, method: approve, count: 1 } }
  decisions: []
`
const CONSENT = DECIDED('{ by: council, method: consent, window: PT1M }')
const VOTE = DECIDED('{ by: council, method: vote, window: PT1M, quorum: 1, threshold: 0.5 }')
const BUDGETED = `schema_version: "2.0"
projects:
  - { id: p-open, title: "Open project", status: execute, type: program, visibility: public }
  - { id: p-two, title: "Second project", status: execute, type: program, budget: 9 }
`
const evaluationOf = async (w: World, id: string, cookie?: string) => (await ok(await call(w.app, 'GET', `/api/proposals/${id}`, { cookie }))).evaluation.state
const narrowBudget = async (w: World) => ok(await narrow(w, { collection: 'projects', field: 'budget' }, `hat:${OPS}`))

describe('A narrowing is not a revision (C1)', () => {
  it('an objected consent proposal past its window stays not met after a narrowing of what its create writes', async () => {
    const w = await world({ governance: CONSENT, projects: BUDGETED })
    await stage(w, [{ op: 'create', record: 'projects:p-new', value: { id: 'p-new', title: 'New', status: 'idea', type: 'program', budget: 4 } }])
    const id = await propose(w, 'A new project')
    const council = await w.signIn(A2)
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'object', text: 'It costs too much.' }, cookie: council }))
    w.tick(2 * 60e3)
    expect(await evaluationOf(w, id)).not.toBe('met')
    const before = entryOf(w.repo, id)
    await narrowBudget(w)
    const after = entryOf(w.repo, id)
    expect(after.rev).not.toBe(before.rev)
    // The objection is carried to the rev git now holds: still live, still holding the proposal.
    expect(after.events.find((e: { kind: string }) => e.kind === 'object').rev).toBe(after.rev)
    expect(await evaluationOf(w, id)).not.toBe('met')
    const [status] = await refused(await call(w.app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie: council }))
    expect(status).toBe(409)
    const run = governanceOfHead(w.repo)
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
  })

  it('the same for an update the narrowing makes stale, after its author keeps it', async () => {
    const w = await world({ governance: CONSENT, projects: BUDGETED })
    await stage(w, [{ op: 'update', record: 'projects:p-two', set: { title: 'Two', budget: 12 } }])
    const id = await propose(w, 'Rename and budget')
    const council = await w.signIn(A2)
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'object', text: 'Not this budget.' }, cookie: council }))
    w.tick(2 * 60e3)
    await narrowBudget(w)
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/replay`, { body: { choose: 'mine' } }))
    expect(await evaluationOf(w, id)).not.toBe('met')
    expect((await refused(await call(w.app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie: council })))[0]).toBe(409)
  })

  it('a vote\'s ballots survive a narrowing: the proposal is decided by them', async () => {
    const w = await world({ governance: VOTE, projects: BUDGETED })
    await stage(w, [{ op: 'create', record: 'projects:p-new', value: { id: 'p-new', title: 'New', status: 'idea', type: 'program', budget: 4 } }])
    const id = await propose(w, 'A new project')
    const council = await w.signIn(A2)
    await ok(await call(w.app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'vote', vote: 'yes' }, cookie: council }))
    await narrowBudget(w)
    w.tick(2 * 60e3)
    expect(await evaluationOf(w, id)).toBe('met')
    await ratify(w, id, council)
    expect(recordsOf(w.repo, 'projects').map(p => p.id)).toContain('p-new')
    expect(fileAt(w.repo, 'data/projects.yaml')).not.toContain('budget')
  })
})

describe('Widening a private record is a publication (I2, I3)', () => {
  /** p-two kept in the store at Ops; records are applied by Ops alone, publications decided by the council. */
  const OPS_DIRECT = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    ops: { hat: "${OPS}" }
  rules:
    - { id: records, applies_to: [records], propose: ops, decide: { by: ops, method: direct } }
    - { id: people, applies_to: [members, publication], propose: ops, decide: { by: council, method: approve, count: 1 } }
  decisions: []
`
  it('a staged op that widens a private record\'s level carries publication and is not applied directly', async () => {
    const w = await world({ governance: OPS_DIRECT })
    await ok(await narrow(w, { registry: 'projects', id: 'p-two' }, `hat:${OPS}`))
    w.wear(A4, [TOP, OPS]) // admitted to Council and Ops through the top hat, and an Ops wearer, who applies records alone
    const four = await w.signIn(A4)
    // Ops → Council (not ordered with it): a widening.
    const view = await stage(w, [{ op: 'update', record: 'projects:p-two', set: { visibility: `hat:${COUNCIL}` } }], four)
    expect(view.classes).toEqual(['records', 'publication'])
    const before = head(w.repo)
    const [status, body] = await refused(await call(w.app, 'POST', '/api/changes/apply', { body: {}, cookie: four }))
    expect([status, body.code, body.error]).toEqual([409, 'WIDENS', 'This makes it readable by more people, so it is proposed, not applied.'])
    expect(head(w.repo)).toBe(before)
    expect(w.store.record('projects', 'p-two')!.visibility).toBe(`hat:${OPS}`)
    // It can be proposed, under the rule for publication.
    await propose(w, 'Council reads the second project', four)
  })

  it('a staged op that narrows a private record\'s level, or leaves it, is no publication and applies', async () => {
    const w = await world({ governance: OPS_DIRECT })
    await ok(await narrow(w, { registry: 'projects', id: 'p-two' }, `hat:${OPS}`))
    w.wear(A4, [TOP, OPS]) // admitted to Council and Ops through the top hat, and an Ops wearer, who applies records alone
    const four = await w.signIn(A4)
    const view = await stage(w, [{ op: 'update', record: 'projects:p-two', set: { visibility: `hat:${TOP}`, title: 'Two' } }], four)
    expect(view.classes).toEqual(['records'])
    await ok(await call(w.app, 'POST', '/api/changes/apply', { body: {}, cookie: four }))
    expect(w.store.record('projects', 'p-two')).toMatchObject({ visibility: `hat:${TOP}`, body: expect.objectContaining({ title: 'Two' }) })
  })

  it('moving a private record into git is refused in words that promise no path that does not exist', async () => {
    const w = await world()
    await ok(await narrow(w, { registry: 'projects', id: 'p-two' }, `hat:${OPS}`))
    const res = await call(w.app, 'POST', '/api/changes/ops', { body: { ops: [{ op: 'update', record: 'projects:p-two', set: { visibility: 'members' } }] } })
    const [status, body] = await refused(res)
    expect(status).toBe(422)
    expect(body.errors[0].message).toBe('projects:p-two is private; making it members would move it into the repository, where more people read it. ' +
      'Moving a private record into the repository is a publication that cannot be proposed here yet, so it stays private. Nothing was staged.')
  })
})

describe('A narrowing never reaches who the rules count (I4)', () => {
  it('a member\'s record and members.handles stay in git; a contact field still leaves', async () => {
    const w = await world()
    const before = head(w.repo)
    const ROSTER = 'The member list and its identity links are what the rules count, so a member\'s record and members.handles stay in the repository: ' +
      'narrow a contact field, such as email, instead. Nothing was written.'
    for (const target of [{ registry: 'members', id: 'steward-b' }, { collection: 'members', field: 'handles' }]) {
      const [status, body] = await refused(await narrow(w, target, `hat:${OPS}`))
      expect([status, body]).toEqual([409, { code: 'ROSTER', error: ROSTER }])
    }
    expect(head(w.repo)).toBe(before)
    await ok(await narrow(w, { collection: 'members', field: 'email' }, `hat:${OPS}`))
  })

  it('a record data/governance.yaml names (the membership tree\'s system) is referred to, and stays', async () => {
    const w = await world()
    const [status, body] = await refused(await narrow(w, { registry: 'systems', id: 'hats-main' }, `hat:${OPS}`))
    expect([status, body.code]).toEqual([409, 'REFERRED'])
    expect(body.error).toContain('data/governance.yaml')
    expect(fileAt(w.repo, 'data/systems.yaml')).toContain('hats-main')
  })
})

describe('An op that writes a field narrowed since it was staged is told so (I5)', () => {
  const NARROWED_APPLY = 'Not applied: email of members:steward-b was narrowed to hat:' + OPS + ' after it was staged, so it cannot go to the repository. ' +
    'Discard that op from your tray and stage it again: it then goes to the private store. Nothing was written.'
  it('Apply and Propose answer 409 NARROWED with what to do, not 500', async () => {
    const w = await world({ governance: SOLO })
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'b-new@example.invalid' } }])
    await ok(await narrow(w, { collection: 'members', field: 'email' }, `hat:${OPS}`))
    const [status, body] = await refused(await call(w.app, 'POST', '/api/changes/apply', { body: {} }))
    expect([status, body]).toEqual([409, { code: 'NARROWED', error: NARROWED_APPLY }])
    const w2 = await world()
    await stage(w2, [{ op: 'update', record: 'members:steward-b', set: { email: 'b-new@example.invalid' } }])
    await ok(await narrow(w2, { collection: 'members', field: 'email' }, `hat:${OPS}`))
    const [s2, b2] = await refused(await call(w2.app, 'POST', '/api/proposals', { body: { title: 'B moves' } }))
    expect([s2, b2.code]).toEqual([409, 'NARROWED'])
  })

  it('a ratify of a proposal whose git op writes a field restricted since (by hand) answers 409 NARROWED', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'b-new@example.invalid' } }])
    const id = await propose(w, 'B moves')
    const council = await w.signIn(A2)
    await approve(w, id, council)
    writeFileSync(join(w.repo, 'data', 'visibility.yaml'), EMAIL_AT_OPS)
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "policy: e-mail at Ops, by hand"')
    const [status, body] = await refused(await call(w.app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie: council }))
    expect([status, body.code]).toEqual([409, 'NARROWED'])
    expect(body.error).toBe(`Not ratified: proposal ${id} writes email of members:steward-b, which was narrowed to hat:${OPS} after it was proposed. ` +
      'Revise the proposal and stage that value again: it then goes to the private store. Nothing was written.')
  })
})

describe('A private collection narrowed (review check)', () => {
  it('its records are read only by those admitted to its new level', async () => {
    const w = await world()
    await w.store.putCollection({ id: 'grants-private', visibility: `hat:${OPS}`, definition: { title: 'Grants' } }, 'steward-a')
    await w.store.putRecord({ collection: 'grants-private', id: 'g1', visibility: `hat:${OPS}`, body: { id: 'g1', title: 'Grant one' }, rev: '' }, 'steward-a', null)
    const one = await w.signIn(A1)
    expect((await ok(await call(w.app, 'GET', '/api/registries/grants-private', { cookie: one }))).entries.map((e: { id: string }) => e.id)).toEqual(['g1'])
    w.wear(A4, [TOP, OPS]) // Q77: a narrowing is a write; the top hat alone holds no role that proposes records
    const four = await w.signIn(A4)
    await ok(await narrow(w, { collection: 'grants-private' }, `hat:${TOP}`, four))
    // The record's own level (Ops) still admits A1; the collection's no longer does, and that is enough.
    const res = await call(w.app, 'GET', '/api/registries/grants-private', { cookie: one })
    expect(res.status).toBe(404)
    const listed = JSON.stringify(await ok(await call(w.app, 'GET', '/api/registries', { cookie: one })))
    expect(listed).not.toContain('grants-private')
    expect(listed).not.toContain('Grant one')
    expect((await ok(await call(w.app, 'GET', '/api/registries/grants-private', { cookie: four }))).entries.map((e: { id: string }) => e.id)).toEqual(['g1'])
  })
})

// ── Fix round 2 (task-16-rereview-1.md) ───────────────────────────────────────────────────────────────────────────

describe('Fix round 2: what the rules decide by stays in git; a private widening is judged by the rules', () => {
  it('a system a rule decides by (decide.system) is referred to by data/governance.yaml, and stays', async () => {
    const governance = GOVERNANCE().replace('  decisions: []\n', '    - { id: grants, applies_to: [treasury], propose: ops, decide: { by: system, system: vote-pool } }\n  decisions: []\n')
    const w = await world({ governance })
    writeFileSync(join(w.repo, 'data', 'systems.yaml'), `${SYSTEMS}  - { id: vote-pool, kind: gardens-pool, name: Votes, chain: "${CELO}", address: "0x00000000000000000000000000000000000000b1" }\n`)
    git(w.repo, 'add -A'); git(w.repo, 'commit -qm "fixture: a system a rule decides by"')
    const [status, body] = await refused(await narrow(w, { registry: 'systems', id: 'vote-pool' }, `hat:${OPS}`))
    expect([status, body.code]).toEqual([409, 'REFERRED'])
    expect(body.error).toContain('data/governance.yaml "grants" (decide.system)')
  })

  it('under the solo default a private record\'s widening applies directly, as a git record\'s visibility: public does', async () => {
    const w = await world({ governance: SOLO })
    await ok(await narrow(w, { registry: 'projects', id: 'p-two' }, `hat:${OPS}`))
    w.wear(A4, [TOP, OPS])
    const four = await w.signIn(A4)
    const view = await stage(w, [{ op: 'update', record: 'projects:p-two', set: { visibility: `hat:${COUNCIL}` } }], four)
    expect(view.classes).toEqual(['records', 'publication'])
    await ok(await call(w.app, 'POST', '/api/changes/apply', { body: {}, cookie: four }))
    expect(w.store.record('projects', 'p-two')!.visibility).toBe(`hat:${COUNCIL}`)
  })

  it('Update proposal of an op narrowed since it was staged answers 409 NARROWED, "Not revised"', async () => {
    const w = await world()
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { role: 'Treasurer' } }])
    const id = await propose(w, 'B keeps the treasury')
    const tray = await ok(await call(w.app, 'POST', `/api/proposals/${id}/load`, { body: {} }))
    expect(tray.revises).toBe(id)
    await stage(w, [{ op: 'update', record: 'members:steward-b', set: { email: 'b-new@example.invalid' } }])
    await ok(await narrow(w, { collection: 'members', field: 'email' }, `hat:${OPS}`))
    const ops = (await ok(await call(w.app, 'GET', '/api/changes'))).ops.map(({ before: _b, ...op }: Record<string, unknown>) => op)
    const [status, body] = await refused(await call(w.app, 'POST', `/api/proposals/${id}/revise`, { body: { ops } }))
    expect([status, body.code]).toEqual([409, 'NARROWED'])
    expect(body.error).toMatch(/^Not revised: email of members:steward-b was narrowed to hat:/)
  })
})

// ── Task 20: who may narrow is who may write (coordinator Q77) ─────────────────────────────────────────────────────────

describe('Who may narrow is who sees the control: one predicate (Q77)', () => {
  it('a member whose rule lets them neither apply nor propose the class is refused 403 MAY_NOT_WRITE, and nothing is written', async () => {
    const w = await world()
    // A2 wears Council: Council decides records, but only Ops proposes them, so A2 may not write a project.
    const council = await w.signIn(A2)
    const actor = (await ok(await call(w.app, 'GET', '/api/session', { cookie: council }))).actor
    const before = head(w.repo)
    for (const [target, level] of [[{ registry: 'projects', id: 'p-open' }, 'members'], [{ collection: 'projects', field: 'title' }, `hat:${COUNCIL}`]] as const) {
      const [status, body] = await refused(await narrow(w, target, level, council))
      expect([status, body]).toEqual([403, { code: 'MAY_NOT_WRITE', error:
        `You cannot change projects, so you cannot narrow it: "${actor}" does not hold the ops role, which rule "people" asks of whoever proposes. Nothing was written.` }])
    }
    expect(head(w.repo)).toBe(before)
    expect(recordsOf(w.repo, 'projects').find(p => p.id === 'p-open')).toMatchObject({ visibility: 'public' })
  })

  it('GET /api/visibility lists what the member may write by the same rule: an Ops wearer the projects, a Council wearer not', async () => {
    const w = await world()
    await w.signIn(A1) // a read uses the last good reading: steward-a's wallet (Ops) is read once first
    const ops = (await ok(await call(w.app, 'GET', '/api/visibility'))).writable as string[]
    expect(ops).toContain('projects')
    expect(ops).toContain('members')
    const council = await w.signIn(A2)
    const theirs = (await ok(await call(w.app, 'GET', '/api/visibility', { cookie: council }))).writable as string[]
    expect(theirs).not.toContain('projects')
    expect(theirs).not.toContain('members')
    // Under the solo default every member who is a person writes every collection.
    const solo = await world({ governance: SOLO })
    expect((await ok(await call(solo.app, 'GET', '/api/visibility'))).writable).toEqual(expect.arrayContaining(['projects', 'members', 'systems']))
  })

  it('a private collection is listed for a member admitted to it who may write records; never for one who is not admitted', async () => {
    const w = await world()
    await w.store.putCollection({ id: 'grants-private', visibility: `hat:${OPS}`, definition: { title: 'Grants' } }, 'steward-a')
    await w.signIn(A1)
    expect((await ok(await call(w.app, 'GET', '/api/visibility'))).writable).toContain('grants-private')
    w.wear(A2, [COUNCIL, OPS])
    const both = await w.signIn(A2)
    expect((await ok(await call(w.app, 'GET', '/api/visibility', { cookie: both }))).writable).toContain('grants-private')
    w.wear(A4, [TOP])
    const top = await w.signIn(A4)
    // A4 is admitted (Top is above Ops) but holds no role that proposes records: not listed.
    expect((await ok(await call(w.app, 'GET', '/api/visibility', { cookie: top }))).writable).not.toContain('grants-private')
    // Under the solo default A2, wearing Council alone, writes every collection, but is not admitted to an Ops one.
    const solo = await world({ governance: SOLO })
    await solo.store.putCollection({ id: 'grants-private', visibility: `hat:${OPS}`, definition: { title: 'Grants' } }, 'steward-a')
    const council = await solo.signIn(A2)
    const answer = await ok(await call(solo.app, 'GET', '/api/visibility', { cookie: council }))
    expect(answer.writable).toContain('projects')
    expect(JSON.stringify(answer)).not.toContain('grants-private')
  })
})

describe('Narrowing members.email never removes an identity (Q78)', () => {
  it('a member whose only git identity is the e-mail gets handles.git in the same commit; one with handles.git keeps it as it was', async () => {
    const w = await world()
    await ok(await narrow(w, { collection: 'members', field: 'email' }, `hat:${OPS}`))
    expect(git(w.repo, 'rev-list --count HEAD~1..HEAD').trim()).toBe('1')
    const members = recordsOf(w.repo, 'members')
    for (const m of members) expect(m).not.toHaveProperty('email')
    expect(members.find(m => m.id === 'steward-b')!.handles).toEqual({ git: 'steward-b@example.invalid' })
    expect(members.find(m => m.id === 'steward-a')!.handles).toEqual({ git: ['admin-test@local'], wallet: A1 })
    expect(members.find(m => m.id === 'steward-c')!.handles).toEqual({ git: ['steward-c@example.test'] })
    // The e-mail is kept in the store, and the member still commits as themselves.
    expect(w.store.fieldsNamed('members', 'email').map(f => [f.record, f.value])).toContainEqual(['steward-b', 'steward-b@example.invalid'])
    expect(actorForEmail(w.repo, 'steward-b@example.invalid')).toMatchObject({ id: 'steward-b' })
    expect(canAct('steward-b', members)).toBe(true)
    expect(errorsOf(w.repo)).toEqual([])
    const run = governanceOfHead(w.repo)
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
  })

  it('another field narrowed out of git sets no handle', async () => {
    const w = await world({ members: MEMBERS.replace('email: steward-b@example.invalid', 'phone: "000"') })
    await ok(await narrow(w, { collection: 'members', field: 'phone' }, `hat:${OPS}`))
    expect(recordsOf(w.repo, 'members').find(m => m.id === 'steward-b')).toEqual({ id: 'steward-b', name: 'Steward B', kind: 'person' })
  })
})

describe('A narrowing tells the open pages (Task 16)', () => {
  it('every narrowing that commits sends one notice, a store-only one too; a refused one sends none', async () => {
    const w = await world()
    await ok(await narrow(w, { registry: 'projects', id: 'p-open' }, 'members'))
    expect(w.notices).toEqual([{ type: 'registry-changed', registry: 'visibility' }])
    await refused(await narrow(w, { registry: 'projects', id: 'p-open' }, 'members'))
    expect(w.notices).toHaveLength(1)
    // Out of git into the store, then narrowed in the store alone (an empty commit: no file for the watcher to see).
    await ok(await narrow(w, { registry: 'projects', id: 'p-two' }, `hat:${OPS}`))
    w.wear(A4, [TOP, OPS])
    await ok(await narrow(w, { registry: 'projects', id: 'p-two' }, `hat:${TOP}`, await w.signIn(A4)))
    expect(w.notices).toHaveLength(3)
  })
})
