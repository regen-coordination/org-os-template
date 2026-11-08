import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import { PROJECTS_YAML } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { Membership } from '../../server/session/membership.ts'
import { createSession } from '../../server/session/sessions.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { buildBranch } from '../../server/proposals/branch.ts'
import { resolveRev } from '../../server/git.ts'
import * as gitModule from '../../server/git.ts'
import { useHubIdent } from '../../server/hosted/ident.ts'
import { HOUSE_IDENT } from '../../lib/trailers.mjs'
import type { WearerReading, WearersReading } from '../../server/systems/hats.ts'

// L9 Task 4 (carry 2, spec §5.5): one identity for every hosted commit. Every test runs git in a fresh repository under
// the temp directory (makeChangeRepo) whose own identity is removed once the fixture is committed, with
// GIT_CONFIG_GLOBAL=/dev/null and a temporary HOME, so git has no identity of its own. Hats are read by a fake (no network).

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const A1 = `${CELO}:0x00000000000000000000000000000000000000A1`
const A2 = `${CELO}:0x00000000000000000000000000000000000000A2`
const A3 = `${CELO}:0x00000000000000000000000000000000000000A3`
// The real clock: the validator holds an event's time to within ten minutes of its commit.
const T0 = new Date()
const READ_AT = T0.toISOString()
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: council, decide: { by: council, method: direct } }
    - { id: people, applies_to: [members], propose: council, decide: { by: council, method: approve, count: 2 } }
  decisions: []
`
const LOCAL_GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    member: { all: true }
  rules:
    - { id: records, applies_to: [members], propose: member, decide: { by: member, method: approve, count: 1 } }
  decisions: []
`

const saved = { ...process.env }
const cleanup: string[] = []
const stores: PrivateStore[] = []

/** No identity but the Hub's: a temporary HOME, no global or system configuration, no ident variables. */
beforeEach(() => {
  for (const k of Object.keys(process.env)) if (/^GIT_(AUTHOR|COMMITTER)_/.test(k)) delete process.env[k]
  const home = mkdtempSync(join(tmpdir(), 'ident-home-')); cleanup.push(home)
  process.env.HOME = home
  process.env.GIT_CONFIG_GLOBAL = '/dev/null'
  process.env.GIT_CONFIG_NOSYSTEM = '1'
})
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
  Object.assign(process.env, saved)
})

const emails = (repo: string, rev: string, fmt: '%ae' | '%ce'): string[] =>
  git(repo, `log ${rev} --format=${fmt}`).split('\n').filter(Boolean)
const commitsOf = (repo: string): string[] => git(repo, 'rev-list --all').split('\n').filter(Boolean)

/** A change repository whose commits so far are the fixture's; `hosted` removes the repository's own identity too. */
function repoWith(governance: string, files: Record<string, string> = {}, noIdentity = false): { repo: string; before: Set<string> } {
  const repo = makeChangeRepo(governance)
  cleanup.push(repo)
  if (Object.keys(files).length > 0) {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, 'data', name), text)
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the tree and its members"')
  }
  if (noIdentity) { git(repo, 'config --unset user.email'); git(repo, 'config --unset user.name'); git(repo, 'config user.useConfigOnly true') }
  return { repo, before: new Set(commitsOf(repo)) }
}

const MEMBERS = `schema_version: "2.0"
members:
  - { id: "steward-a", name: "steward-a", kind: "person", handles: { git: ["admin-test@local"] } }
  - { id: "steward-b", name: "steward-b", kind: "person" }
  - { id: "steward-c", name: "steward-c", kind: "person" }
`

async function hostedHouse(repo: string) {
  /** The real build, and what it was asked to commit as (the fourth argument is the options a visit passes). */
  const build = vi.fn((r: string, p: Parameters<typeof buildBranch>[1], f: string, o?: Parameters<typeof buildBranch>[3]) => buildBranch(r, p, f, o))
  const dir = mkdtempSync(join(tmpdir(), 'ident-store-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const now = () => new Date()
  const worn: Record<string, string[]> = { [A1]: [COUNCIL], [A2]: [COUNCIL], [A3]: [COUNCIL] }
  const reader = {
    wearer: vi.fn(async (_s: Record<string, unknown>, account: string): Promise<WearerReading> =>
      ({ ok: true, system: 'hats-main', chain: CELO, account, hats: worn[account] ?? [], block: 100, readAt: READ_AT })),
    wearers: vi.fn(async (_s: Record<string, unknown>, hat: string): Promise<WearersReading> =>
      ({ ok: true, system: 'hats-main', hat, wearers: [A1, A2, A3], holders: [A1, A2, A3], complete: true, block: 100, readAt: READ_AT })),
  }
  const membership = new Membership({ repo, reader, now })
  const mount = (a: Hono, ctx: { withLock: <T>(fn: () => Promise<T>) => Promise<T> }) =>
    mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now, hosted: true, build })
  const app = createApp(repo, mount, { request: withRequest({ repo, hosted: true, membership, store, now }) })
  const signIn = async (account: string) => {
    await membership.forAct(account)
    const { token } = await createSession(store, account, now)
    return `house_session=${token}`
  }
  return { app, signIn, build }
}

function call(app: Hono, method: string, path: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: 'localhost:4680' }
  if (method !== 'GET') headers['content-type'] = 'application/json'
  if (o.cookie) headers.cookie = o.cookie
  return app.request(`http://localhost:4680${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
}
async function ok(res: Response | Promise<Response>, status = 200): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await res
  const text = await r.text()
  expect([r.status, r.status === status ? '' : text]).toEqual([status, ''])
  return text === '' ? {} : JSON.parse(text)
}

// the fixture's project names a contributor by id; the members here are the placeholders
const FILES = { 'systems.yaml': SYSTEMS, 'members.yaml': MEMBERS, 'projects.yaml': PROJECTS_YAML.replace('"ana"', '"steward-c"') }
const PEOPLE_OP = { op: 'update', record: 'members:steward-b', set: { name: 'Steward B' } }
const PROJECT_OP = { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }

/** Proposes the people change as `cookie` and returns its id. */
async function propose(app: Hono, cookie: string): Promise<string> {
  await ok(call(app, 'POST', '/api/changes/ops', { body: { ops: [PEOPLE_OP] }, cookie }))
  return String((await ok(call(app, 'POST', '/api/proposals', { body: { title: 'Rename steward-b' }, cookie }), 201)).id)
}

describe('one identity for every hosted commit (carry 2)', () => {
  it('the hosted walk commits only as the Hub, and the governance validator passes', async () => {
    const { repo, before } = repoWith(GOVERNANCE, FILES, true)
    const base = git(repo, 'rev-parse HEAD').trim()
    useHubIdent(process.env)
    const { app, signIn, build } = await hostedHouse(repo)
    const [a1, a2, a3] = [await signIn(A1), await signIn(A2), await signIn(A3)]
    // 1. a member directly applies a change to a record
    await ok(call(app, 'POST', '/api/changes/ops', { body: { ops: [PROJECT_OP] }, cookie: a1 }))
    await ok(call(app, 'POST', '/api/changes/apply', { body: {}, cookie: a1 }))
    // 2. a Council wearer proposes
    const id = await propose(app, a1)
    // 3. a visit builds proposal/<id>
    // (proposing built it; the ref is taken away so that the visit has a branch to build)
    git(repo, `update-ref -d refs/heads/proposal/${id}`)
    build.mockClear()
    const detail = await ok(call(app, 'GET', `/api/proposals/${id}`, { cookie: a2 }))
    expect(detail.diff).toContain('Steward B')
    expect(await resolveRev(repo, `refs/heads/proposal/${id}`)).not.toBeNull()
    expect(build).toHaveBeenCalledTimes(1)
    expect(build.mock.calls[0]![3]).toEqual({ ident: HOUSE_IDENT }) // explicitly, not only by the environment
    // the visit-built commit itself: ratify rebuilds it below, so it is read now
    const visited = git(repo, `rev-parse refs/heads/proposal/${id}`).trim()
    expect(emails(repo, `${visited} -1`, '%ae')).toEqual([HOUSE_IDENT.email])
    expect(emails(repo, `${visited} -1`, '%ce')).toEqual([HOUSE_IDENT.email])
    // 4. two approve   5. ratify
    await ok(call(app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'approve' }, cookie: a2 }))
    await ok(call(app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'approve' }, cookie: a3 }))
    await ok(call(app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie: a2 }))
    expect(readLedger(repo).entries.find(e => e.id === id)?.state).toBe('ratified')

    const made = commitsOf(repo).filter(c => !before.has(c))
    expect(made.length).toBeGreaterThanOrEqual(5)
    for (const c of made) {
      expect([c, emails(repo, `${c} -1`, '%ae')]).toEqual([c, [HOUSE_IDENT.email]])
      expect([c, emails(repo, `${c} -1`, '%ce')]).toEqual([c, [HOUSE_IDENT.email]])
      expect(git(repo, `log ${c} -1 --format=%an,%cn`).trim()).toBe(`${HOUSE_IDENT.name},${HOUSE_IDENT.name}`)
    }
    const validated = spawnSync('node', [join(ROOT, 'scripts', 'validate-governance.mjs'), repo, '--strict', '--range', `${base}..HEAD`], { cwd: ROOT, encoding: 'utf8' })
    expect([validated.status, validated.status === 0 ? '' : validated.stdout + validated.stderr]).toEqual([0, ''])
  }, 60_000)

  it('a branch built under git\'s identity before hosting is rebuilt at ratify, authored by the Hub', async () => {
    const { repo } = repoWith(GOVERNANCE, FILES)
    const { app, signIn } = await hostedHouse(repo)
    const [a1, a2, a3] = [await signIn(A1), await signIn(A2), await signIn(A3)]
    const id = await propose(app, a1)
    // built before hosting: by the identity this repository was configured with
    const entry = readLedger(repo).entries.find(e => e.id === id)!
    await ok(call(app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'approve' }, cookie: a2 }))
    await ok(call(app, 'POST', `/api/proposals/${id}/events`, { body: { kind: 'approve' }, cookie: a3 }))
    const trunk = git(repo, 'rev-parse HEAD').trim()
    const { tip } = await buildBranch(repo, { id, author: entry.author, ops: entry.ops as never }, trunk, {})
    expect(emails(repo, `${tip} -1`, '%ae')).toEqual(['admin-test@local'])
    expect(git(repo, `rev-parse ${tip}^`).trim()).toBe(trunk) // it stands on the trunk tip: only its author is foreign
    // then the instance moves to hosting: no identity of its own, the Hub's in the environment
    git(repo, 'config --unset user.email'); git(repo, 'config --unset user.name'); git(repo, 'config user.useConfigOnly true')
    useHubIdent(process.env)
    await ok(call(app, 'POST', `/api/proposals/${id}/ratify`, { body: {}, cookie: a2 }))
    const merged = git(repo, `rev-parse refs/heads/proposal/${id}`).trim()
    expect(merged).not.toBe(tip)
    expect(emails(repo, `${merged} -1`, '%ae')).toEqual([HOUSE_IDENT.email])
    expect(emails(repo, `${merged} -1`, '%ce')).toEqual([HOUSE_IDENT.email])
    expect(git(repo, `rev-parse ${merged}^`).trim()).toBe(trunk)
  }, 60_000)

  it('the git vocabulary allows log -1 --format=%ae and nothing new besides', () => {
    expect(gitModule.__internal.ALLOWED.log).toEqual(['-1', '--format=%B', '--format=%ae'])
    expect(() => gitModule.__internal.checkArgv(['log', '-1', '--format=%ae', 'a'.repeat(40)])).not.toThrow()
    for (const flag of ['--format=%an', '--format=%H', '--all', '-2', '--format=%ae%n']) {
      expect(() => gitModule.__internal.checkArgv(['log', flag, 'a'.repeat(40)]), flag).toThrow()
    }
  })

  it('authorEmail answers the author of a commit', async () => {
    const { repo } = repoWith(GOVERNANCE)
    expect(await gitModule.authorEmail(repo, 'HEAD')).toBe('admin-test@local')
  })

  it('useHubIdent sets the four variables to the Hub, and only those', () => {
    const env: NodeJS.ProcessEnv = { KEEP: 'yes' }
    useHubIdent(env)
    expect(env).toEqual({
      KEEP: 'yes',
      GIT_AUTHOR_NAME: HOUSE_IDENT.name, GIT_AUTHOR_EMAIL: HOUSE_IDENT.email,
      GIT_COMMITTER_NAME: HOUSE_IDENT.name, GIT_COMMITTER_EMAIL: HOUSE_IDENT.email,
    })
  })

  it('local mode: a visit-built branch is still authored by git\'s identity', async () => {
    const { repo } = repoWith(LOCAL_GOVERNANCE, FILES)
    const mount = (a: Hono, ctx: { withLock: <T>(fn: () => Promise<T>) => Promise<T> }) =>
      mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => T0 })
    const app = createApp(repo, mount)
    await ok(call(app, 'POST', '/api/changes/ops', { body: { ops: [PEOPLE_OP] } }))
    const id = String((await ok(call(app, 'POST', '/api/proposals', { body: { title: 'Rename steward-b' } }), 201)).id)
    const detail = await ok(call(app, 'GET', `/api/proposals/${id}`))
    expect(detail.diff).toContain('Steward B')
    const tip = git(repo, `rev-parse refs/heads/proposal/${id}`).trim()
    expect(emails(repo, `${tip} -1`, '%ae')).toEqual(['admin-test@local'])
    expect(process.env.GIT_AUTHOR_EMAIL).toBeUndefined()
  }, 60_000)
})
