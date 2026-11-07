import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import type { Hono } from 'hono'
import { parse } from 'yaml'
import { makeChangeRepo } from '../changes/fixtures.ts'
import { removeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { mountSync } from '../../server/proposals/sync.ts'
import { mountOperations } from '../../server/operations/routes.ts'
import { opById, needsConfirm, type InProcess } from '../../server/operations/catalogue.ts'
import { LocalExecutor } from '../../server/operations/executor.ts'
import { Plans } from '../../server/operations/plans.ts'
import { ResourceStore } from '../../server/resources/index.ts'
import { runCommand } from '../../server/resources/run.ts'
import { JobStore, stateDir } from '../../server/state.ts'
import * as gitModule from '../../server/git.ts'
import { parseTrailers } from '../../lib/trailers.mjs'
import { mergeLedgers } from '../../lib/proposals.mjs'
import type { Adapter, Resource } from '../../server/resources/types.ts'

// Sync (0.6 P2 spec §3.12, P2-R18, P2-R31): the fetch through the executor, then a fast-forward or a merge of the
// ledger by id. Every test builds its own world under the OS temp directory: a bare remote and two clones of it, `a`
// (user.email ana) and `b` (user.email bruno), with synthetic members ana, bruno and carla. Nothing here reaches a
// real instance or a real network: the remote is a directory. The clock is injected, anchored near the real now, so a
// commit's real date, FETCH_HEAD's real time and the clock agree.
const ENV = {
  ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.test',
}
const sh = (cwd: string, cmd: string): string => execSync(cmd, { cwd, env: ENV, stdio: 'pipe' }).toString()
const sha = (cwd: string, rev = 'HEAD') => sh(cwd, `git rev-parse ${rev}`).trim()

const MEMBERS = `schema_version: "2.0"
members:
  - { id: ana, name: Ana, kind: person, handles: { git: ["ana@example.test"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
  - { id: carla, name: Carla, kind: person, handles: { git: ["carla@example.test"] } }
`
const PROJECTS = `schema_version: "2.0"
projects:
  - id: "proj-001"
    title: "Node Onboarding Program"
    status: "execute"
    type: "program"
    lead: "bruno"
    contributors: ["ana"]
`
// ana and bruno decide, both of them (count 2); carla proposes.
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [ana, bruno] }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 2 } }
  decisions: []
`
const PROJECT = { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }
const BASE = Math.floor(Date.now() / 1000) * 1000 - 120_000
const SELF: Resource = { id: 'instance:self', kind: 'instance', board: 'systems', name: 'this instance', status: null, attention: null, changed: null, facts: { self: true }, source: null }
const PEER: Resource = { ...SELF, id: 'instance:peer', name: 'a peer', facts: { self: false } }
const VERSION_SENTENCE = "this machine's git is 2.34; Sync needs 2.38 to merge two histories safely; update git, or merge with git yourself"

let root: string
let clock: Date
const seeds: string[] = []
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'sync-')); clock = new Date(BASE) })
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
  for (const s of seeds.splice(0)) removeFixtureRepo(s)
})

const tick = (s = 10) => { clock = new Date(clock.getTime() + s * 1000) }
const as = (repo: string, who: string) => sh(repo, `git config user.email ${who}@example.test`)
const commitFile = (repo: string, file: string, text: string) => { writeFileSync(join(repo, file), text); sh(repo, `git add -A && git commit -qm "${file}"`) }

function clone(remote: string, name: string, who: string): string {
  const dir = join(root, name)
  sh(root, `git clone -q ${remote} ${dir}`)
  sh(dir, `git config user.name ${who} && git config user.email ${who}@example.test`)
  return dir
}

/** A bare remote holding one organisation, and two clones of it: `a` (ana) and `b` (bruno). */
function world(): { remote: string; a: string; b: string } {
  const seed = makeChangeRepo(GOVERNANCE); seeds.push(seed)
  writeFileSync(join(seed, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(seed, 'data', 'projects.yaml'), PROJECTS)
  sh(seed, 'git add -A && git commit -qm "fixture: three synthetic members"')
  const remote = join(root, 'remote.git')
  sh(root, `git init -q --bare -b main ${remote}`)
  sh(seed, `git remote add origin ${remote} && git push -q origin main`)
  return { remote, a: clone(remote, 'a', 'ana'), b: clone(remote, 'b', 'bruno') }
}

interface Served { app: Hono; executor: LocalExecutor; plans: Plans }
/** The server's routes for one clone: operations (the fetch), proposals and Sync, one executor and one set of plans. */
function serve(repo: string): Served {
  const jobs = new JobStore(repo)
  const fleet: Adapter = { name: 'fleet', board: 'systems', title: 'Fleet', watch: [], async read() { return { nodes: [SELF, PEER], edges: [] } } }
  const store = new ResourceStore({ repo, now: () => new Date(), run: runCommand, lastOk: () => null }, [fleet])
  const executor = new LocalExecutor(repo, jobs, { started: () => {}, output: () => {}, finished: () => {} }, { killGraceMs: 200 })
  const plans = new Plans()
  const app = createApp(repo, (a, ctx) => {
    mountOperations(a, { repo, store, jobs, executor, plans })
    mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => clock })
    mountSync(a, { repo, withLock: ctx.withLock, store, jobs, executor, plans, startBranch: 'main', now: () => clock })
  })
  return { app, executor, plans }
}

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
async function planFetch(app: Hono): Promise<string> {
  const res = await app.request('/api/operations/fetch/plan', json({ resource: SELF.id }))
  const plan = await res.json()
  expect(res.status, JSON.stringify(plan)).toBe(200)
  expect(plan).toMatchObject({ op: 'fetch', confirm: true, writes: [], inProcess: true, summary: 'fetch origin: it downloads, it changes no file' })
  expect(plan.nonce).toMatch(/^[0-9a-f]{48}$/)
  return plan.nonce
}
/** The Sync button: the fetch's plan (the confirmation), then POST /api/sync with its nonce. */
async function sync(app: Hono): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request('/api/sync', json({ nonce: await planFetch(app) }))
  return { status: res.status, body: await res.json() }
}
async function propose(served: Served, repo: string, who = 'carla'): Promise<string> {
  as(repo, who)
  expect((await served.app.request('/api/changes/ops', json({ ops: [PROJECT] }))).status).toBe(200)
  const res = await served.app.request('/api/proposals', json({ title: 'Move one project' }))
  const body = await res.json()
  expect(res.status, JSON.stringify(body)).toBe(201)
  return body.id
}
async function approve(served: Served, repo: string, id: string, who: string) {
  tick(); as(repo, who)
  const res = await served.app.request(`/api/proposals/${id}/events`, json({ kind: 'approve' }))
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(200)
}
/** Every tracked file's bytes, the status, HEAD and whether a merge waits: "nothing was touched". */
const snapshot = (repo: string) => ({
  head: sha(repo),
  files: sh(repo, 'git ls-files -z | xargs -0 shasum'),
  status: sh(repo, 'git status --porcelain --untracked-files=no'),
  merging: existsSync(join(repo, '.git', 'MERGE_HEAD')),
})
const ledgerAt = (repo: string, rev: string) => (parse(sh(repo, `git show ${rev}:data/proposals.yaml`)) ?? {}).proposals ?? []

describe('the fetch operation', () => {
  it('is a catalogue entry that reaches the network, declares no writes, and asks for a confirmation', () => {
    const op = opById('fetch')
    expect(op).toBeDefined()
    expect(op).toMatchObject({ network: true, effect: 'reads', kinds: ['instance'] })
    expect(needsConfirm(op!)).toBe(true)
    const planned = op!.plan(SELF, {}, root) as InProcess
    expect(typeof planned.inProcess).toBe('function')
    expect(planned.summary).toBe('fetch origin: it downloads, it changes no file')
    expect(op!.unavailable(SELF, root)).toBeNull()
    expect(op!.unavailable(PEER, root)).toBe("offered on this instance's own card")
  })

  it('runs only on its nonce, as a job through the executor; it moves the remote-tracking ref and no HEAD', async () => {
    const { a, b } = world()
    commitFile(a, 'new.txt', 'n\n'); sh(a, 'git push -q origin main')
    const served = serve(b)
    const fetches = vi.spyOn(gitModule, 'fetchRemote')
    const direct = await served.app.request('/api/jobs', json({ op: 'fetch', resource: SELF.id }))
    expect(direct.status).toBe(403)
    expect((await direct.json()).error).toMatch(/runs only with a confirmation/)
    expect(fetches).not.toHaveBeenCalled()

    const head = sha(b)
    const nonce = await planFetch(served.app)
    const started = await served.app.request('/api/jobs', json({ nonce }))
    expect(started.status).toBe(202)
    const { id } = await started.json()
    await expect.poll(async () => (await (await served.app.request(`/api/jobs/${id}`)).json()).job.status, { interval: 20, timeout: 10_000 }).toBe('ok')
    const { job } = await (await served.app.request(`/api/jobs/${id}`)).json()
    expect(job).toMatchObject({ op: 'fetch', changed: [], surprises: [], sentence: 'Done. No file changed.' })
    expect(sha(b)).toBe(head)
    expect(sha(b, 'refs/remotes/origin/main')).toBe(sha(a))
    expect(fetches).toHaveBeenCalledTimes(1)
    expect(fetches).toHaveBeenCalledWith(b, 'origin')
    // single use
    expect((await served.app.request('/api/jobs', json({ nonce }))).status).toBe(409)
  })
})

describe('POST /api/sync and GET /api/sync', () => {
  it('behind and clean: a fast-forward', async () => {
    const { a, b } = world()
    commitFile(a, 'new.txt', 'n\n'); sh(a, 'git push -q origin main')
    const { status, body } = await sync(serve(b).app)
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ state: 'fast-forwarded', ahead: 0, behind: 0, remote: 'origin' })
    expect(sha(b)).toBe(sha(a))
    expect(sh(b, 'git status --porcelain')).toBe('')
  })

  it('ahead only: nothing to do, and GET /api/sync says "1 commit not shared" without touching the network', async () => {
    const { b } = world()
    commitFile(b, 'mine.txt', 'm\n')
    const served = serve(b)
    const head = sha(b)
    const { status, body } = await sync(served.app)
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ state: 'up-to-date', ahead: 1, behind: 0 })
    expect(String(body.sentence)).toMatch(/nothing to do/)
    expect(String(body.sentence)).toMatch(/1 commit not shared/)
    expect(sha(b)).toBe(head)

    // The remote is gone from here on: a read that reached it would fail. GET reads the last fetch only.
    sh(b, `git remote set-url origin ${join(root, 'nowhere.git')}`)
    const fetches = vi.spyOn(gitModule, 'fetchRemote')
    const submits = vi.spyOn(served.executor, 'submit')
    const res = await served.app.request('/api/sync')
    const view = await res.json()
    expect(res.status, JSON.stringify(view)).toBe(200)
    expect(view).toMatchObject({ ahead: 1, behind: 0, remote: 'origin', state: 'fetched' })
    expect(view.sentence).toBe('1 commit not shared')
    expect(fetches).not.toHaveBeenCalled()
    expect(submits).not.toHaveBeenCalled()
  })

  it('both deciders approve the same proposal on their own clone: Sync merges the ledger by id, keeps both events, carries no Org-Proposal, and the second clone ratifies', async () => {
    const { a, b } = world()
    const A = serve(a); const B = serve(b)
    sh(a, 'git fetch -q origin')
    const id = await propose(A, a)
    sh(a, 'git push -q origin main')
    expect((await sync(B.app)).body).toMatchObject({ state: 'fast-forwarded' })

    await approve(A, a, id, 'ana'); sh(a, 'git push -q origin main')
    await approve(B, b, id, 'bruno')
    const ours = sha(b)
    const { status, body } = await sync(B.app)
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ state: 'merged', ledger: 'merged by id', ahead: 2, behind: 0 })

    // one merge commit: our approval first, the remote's second; no Org-Proposal (the validator expands it, §3.10)
    const theirs = sha(b, 'refs/remotes/origin/main')
    expect(sh(b, 'git rev-list --parents -1 HEAD').trim().split(' ')).toEqual([sha(b), ours, theirs])
    expect(body.commit).toBe(sha(b))
    expect(parseTrailers(sh(b, 'git log -1 --format=%B HEAD')).proposal).toBeUndefined()
    const entry = ledgerAt(b, 'HEAD').find((p: { id: string }) => p.id === id)
    expect(entry.events.map((e: { kind: string; by: string }) => `${e.kind}:${e.by}`).sort()).toEqual(['approve:ana', 'approve:bruno'])
    // the file is mergeLedgers of the base and the two sides, entry for entry
    const base = sh(b, `git merge-base ${ours} ${theirs}`).trim()
    const merged = mergeLedgers(ledgerAt(b, base), ledgerAt(b, ours), ledgerAt(b, theirs))
    expect(merged.ok).toBe(true)
    expect(ledgerAt(b, 'HEAD')).toEqual((merged as { entries: unknown[] }).entries)
    expect(sh(b, 'git status --porcelain --untracked-files=no')).toBe('')

    // and now the rule is met on b: bruno ratifies
    tick(); as(b, 'bruno')
    const ratified = await B.app.request(`/api/proposals/${id}/ratify`, json({}))
    expect(ratified.status, JSON.stringify(await ratified.clone().json())).toBe(200)
    expect(ledgerAt(b, 'HEAD').find((p: { id: string }) => p.id === id).state).toBe('ratified')
  })

  it('a divergence that git merges cleanly: one merge commit, no Org-Proposal, the ledger untouched', async () => {
    const { a, b } = world()
    commitFile(a, 'theirs.txt', 't\n'); sh(a, 'git push -q origin main')
    commitFile(b, 'mine.txt', 'm\n')
    const ours = sha(b)
    const { status, body } = await sync(serve(b).app)
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ state: 'merged', ledger: null })
    expect(sh(b, 'git rev-list --parents -1 HEAD').trim().split(' ')).toEqual([sha(b), ours, sha(a)])
    expect(parseTrailers(sh(b, 'git log -1 --format=%B HEAD')).proposal).toBeUndefined()
    expect(readFileSync(join(b, 'theirs.txt'), 'utf8')).toBe('t\n')
  })

  it('diverged with data/governance.yaml changed on both sides: refused in words, nothing touched', async () => {
    const { a, b } = world()
    commitFile(a, 'data/governance.yaml', GOVERNANCE.replace('model: "consensus"', 'model: "consent"')); sh(a, 'git push -q origin main')
    commitFile(b, 'data/governance.yaml', GOVERNANCE.replace('model: "consensus"', 'model: "sociocracy"'))
    const before = snapshot(b)
    const { status, body } = await sync(serve(b).app)
    expect(status, JSON.stringify(body)).toBe(409)
    expect(body.state).toBe('refused')
    expect(String(body.error)).toContain('both sides changed `data/governance.yaml`; resolve it with git, then Sync again')
    expect(snapshot(b)).toEqual(before)
  })

  it('an unreachable remote: refused in words, nothing touched', async () => {
    const { b } = world()
    sh(b, `git remote set-url origin ${join(root, 'nowhere.git')}`)
    const before = snapshot(b)
    const { status, body } = await sync(serve(b).app)
    expect(status, JSON.stringify(body)).toBe(409)
    expect(body).toMatchObject({ state: 'refused', code: 'FETCH_FAILED' })
    expect(String(body.error)).toMatch(/^Not synced: the fetch from origin did not succeed \(.+\)\. Nothing was changed\.$/s)
    expect(snapshot(b)).toEqual(before)
  })

  it('a remote that holds no trunk: nothing to bring in, the absence recorded, nothing else touched (F-L3-2)', async () => {
    const { b } = world()
    const empty = join(root, 'empty.git')
    sh(root, `git init -q --bare -b main ${empty}`)
    sh(b, `git remote set-url origin ${empty}`)
    sh(b, 'git update-ref -d refs/remotes/origin/main') // a trunk never pushed has no tracking ref
    const before = snapshot(b)
    const served = serve(b)
    const { status, body } = await sync(served.app)
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ state: 'up-to-date', trunk: 'main', ahead: 0, behind: 0 })
    expect(body.sentence).toBe('The remote has no main yet: nothing to bring in. Share publishes it.')
    expect(snapshot(b)).toEqual(before)
    const file = join(stateDir(b), 'remote-trunk-absent.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ url: empty, trunk: 'main', at: clock.toISOString() })
    const read = await (await served.app.request('/api/sync')).json()
    expect(read).toMatchObject({ state: 'remote has no trunk', sentence: 'The remote has no main yet: nothing to bring in. Share publishes it.' })
  })
  it('a remote with one other branch and no trunk reads the same way; the trunk arriving makes it fetched, behind', async () => {
    const { a, b } = world()
    const other = join(root, 'other.git')
    sh(root, `git init -q --bare -b main ${other}`)
    sh(a, `git push -q ${other} main:refs/heads/elsewhere`)
    sh(b, `git remote set-url origin ${other}`)
    sh(b, 'git update-ref -d refs/remotes/origin/main')
    const served = serve(b)
    expect((await sync(served.app)).body.sentence).toBe('The remote has no main yet: nothing to bring in. Share publishes it.')
    expect((await gitModule.lastFetch(b, 'main', clock)).state).toBe('remote has no trunk')
    sh(a, `git push -q ${other} main:refs/heads/main`)
    commitFile(a, 'two.txt', '2\n'); sh(a, `git push -q ${other} main`)
    sh(b, 'git fetch -q origin')
    expect(await gitModule.lastFetch(b, 'main', clock)).toMatchObject({ state: 'fetched', behind: 1, ahead: 0 })
  })
  it('the record voids when the remote url changes, and after 15 minutes', async () => {
    const { b } = world()
    const empty = join(root, 'empty.git')
    sh(root, `git init -q --bare -b main ${empty}`)
    sh(b, `git remote set-url origin ${empty}`)
    sh(b, 'git update-ref -d refs/remotes/origin/main')
    await sync(serve(b).app)
    expect((await gitModule.lastFetch(b, 'main', clock)).state).toBe('remote has no trunk')
    expect((await gitModule.lastFetch(b, 'main', new Date(clock.getTime() + 15 * 60e3))).state).toBe('remote has no trunk')
    expect((await gitModule.lastFetch(b, 'main', new Date(clock.getTime() + 15 * 60e3 + 1000))).state).not.toBe('remote has no trunk')
    const elsewhere = join(root, 'elsewhere.git')
    sh(root, `git init -q --bare -b main ${elsewhere}`)
    sh(b, `git remote set-url origin ${elsewhere}`)
    expect((await gitModule.lastFetch(b, 'main', clock)).state).not.toBe('remote has no trunk')
    sh(b, `git remote set-url origin ${empty}`)
    expect((await gitModule.lastFetch(b, 'main', clock)).state).toBe('remote has no trunk')
    expect((await gitModule.lastFetch(b, 'release', clock)).state).not.toBe('remote has no trunk') // another trunk name
  })
  it('with no local trunk there is nothing to share: no absence is recorded and the sentence is not said', async () => {
    const { b } = world()
    const empty = join(root, 'empty.git')
    sh(root, `git init -q --bare -b main ${empty}`)
    sh(b, `git remote set-url origin ${empty}`)
    sh(b, 'git update-ref -d refs/remotes/origin/main')
    sh(b, 'git checkout -q --detach && git branch -q -D main')
    const { body } = await sync(serve(b).app)
    expect(JSON.stringify(body)).not.toContain('Share publishes it')
    expect(existsSync(join(stateDir(b), 'remote-trunk-absent.json'))).toBe(false)
  })

  it('behind with a tracked file changed: refused, nothing touched', async () => {
    const { a, b } = world()
    commitFile(a, 'new.txt', 'n\n'); sh(a, 'git push -q origin main')
    writeFileSync(join(b, 'data', 'projects.yaml'), `${PROJECTS}# an edit not committed\n`)
    const before = snapshot(b)
    const { status, body } = await sync(serve(b).app)
    expect(status, JSON.stringify(body)).toBe(409)
    expect(body).toMatchObject({ state: 'refused', code: 'DIRTY' })
    expect(String(body.error)).toMatch(/data\/projects\.yaml has changes that are not committed/)
    expect(snapshot(b)).toEqual(before)
  })

  it('a request without a nonce, or with a nonce for another operation, is refused and fetches nothing', async () => {
    const { b } = world()
    const served = serve(b)
    const fetches = vi.spyOn(gitModule, 'fetchRemote')
    const bare = await served.app.request('/api/sync', json({}))
    expect(bare.status).toBe(403)
    expect((await bare.json()).error).toMatch(/POST \/api\/operations\/fetch\/plan/)
    const other = served.plans.issue({ op: 'module.doctor', resource: SELF.id, params: {}, cmd: 'npm', args: ['run', 'x:doctor'], writes: [], timeoutMs: 1000 })
    const wrong = await served.app.request('/api/sync', json({ nonce: other }))
    expect(wrong.status).toBe(409)
    expect((await wrong.json()).error).toMatch(/^This confirmation is not for a fetch/)
    expect(fetches).not.toHaveBeenCalled()
  })

  it('no remote: nothing to sync; Propose and Ratify skip the up-to-date check', async () => {
    const repo = makeChangeRepo(GOVERNANCE); seeds.push(repo)
    writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
    writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS)
    sh(repo, 'git add -A && git commit -qm "fixture: three synthetic members"')
    const served = serve(repo)
    const post = await served.app.request('/api/sync', json({}))
    const body = await post.json()
    expect(post.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ state: 'up-to-date', remote: null, sentence: 'There is no remote: nothing to sync.' })
    const view = await (await served.app.request('/api/sync')).json()
    expect(view).toMatchObject({ remote: null, ahead: 0, behind: 0, state: 'no remote', sentence: 'There is no remote: nothing to sync.' })

    const id = await propose(served, repo)
    await approve(served, repo, id, 'ana'); await approve(served, repo, id, 'bruno')
    tick(); as(repo, 'bruno')
    const ratified = await served.app.request(`/api/proposals/${id}/ratify`, json({}))
    expect(ratified.status, JSON.stringify(await ratified.clone().json())).toBe(200)
    expect(existsSync(join(repo, '.git', 'FETCH_HEAD'))).toBe(false)
  })

  it('git below 2.38 (the version stubbed): a fast-forward still works, a divergence is refused with the version sentence', async () => {
    const { a, b } = world()
    vi.spyOn(gitModule, 'gitVersion').mockResolvedValue({ major: 2, minor: 34, patch: 1 })
    const B = serve(b)
    commitFile(a, 'one.txt', '1\n'); sh(a, 'git push -q origin main')
    expect((await sync(B.app)).body).toMatchObject({ state: 'fast-forwarded' })
    expect(sha(b)).toBe(sha(a))

    commitFile(a, 'two.txt', '2\n'); sh(a, 'git push -q origin main')
    commitFile(b, 'mine.txt', 'm\n')
    const before = snapshot(b)
    const { status, body } = await sync(B.app)
    expect(status, JSON.stringify(body)).toBe(409)
    expect(body).toMatchObject({ state: 'refused', code: 'GIT_VERSION' })
    expect(String(body.error)).toContain(VERSION_SENTENCE)
    expect(snapshot(b)).toEqual(before)
  })
})

describe('Propose, Ratify and the closings never fetch: they read the last fetch and ask for a Sync', () => {
  const FETCH_HEAD = (repo: string) => join(repo, '.git', 'FETCH_HEAD')
  const cases: [string, (ctx: { a: string; b: string }) => void, RegExp][] = [
    ['older than PT15M', ({ b }) => { const t = new Date(clock.getTime() - 16 * 60e3); utimesSync(FETCH_HEAD(b), t, t) }, /^Sync first: the last fetch was 1[67] minutes ago/],
    ['never made', ({ b }) => { rmSync(FETCH_HEAD(b)) }, /^Sync first: this repository has never fetched/],
    ['showing commits the trunk lacks', ({ a, b }) => { commitFile(a, 'remote.txt', 'r\n'); sh(a, 'git push -q origin main'); sh(b, 'git fetch -q origin') }, /^Sync first: the remote has 1 commit you have not merged/],
  ]
  it.each(cases)('the last fetch %s: Propose, Ratify and Close refuse "Sync first", and fetchRemote is never called', async (_name, make, said) => {
    const { a, b } = world()
    const B = serve(b)
    sh(b, 'git fetch -q origin')
    const id = await propose(B, b)
    await approve(B, b, id, 'ana'); await approve(B, b, id, 'bruno')
    const fetches = vi.spyOn(gitModule, 'fetchRemote')
    const submits = vi.spyOn(B.executor, 'submit')
    make({ a, b })
    const head = sha(b)

    as(b, 'carla')
    expect((await B.app.request('/api/changes/ops', json({ ops: [{ op: 'update', record: 'projects:proj-001', set: { title: 'Renamed' } }] }))).status).toBe(200)
    const proposed = await B.app.request('/api/proposals', json({ title: 'Rename it' }))
    expect(proposed.status).toBe(409)
    expect((await proposed.json()).error).toMatch(said)

    tick(); as(b, 'bruno')
    const ratified = await B.app.request(`/api/proposals/${id}/ratify`, json({}))
    expect(ratified.status).toBe(409)
    expect((await ratified.json()).error).toMatch(said)

    as(b, 'carla')
    const withdrawn = await B.app.request(`/api/proposals/${id}/close`, json({ outcome: 'withdrawn' }))
    expect(withdrawn.status).toBe(409)
    expect((await withdrawn.json()).error).toMatch(said)

    expect(fetches).not.toHaveBeenCalled()
    expect(submits).not.toHaveBeenCalled()
    expect(sha(b)).toBe(head)
  })
})

// Final review I2 (A5): a member's own Share moves the tracking ref to what they pushed and leaves FETCH_HEAD naming the
// old tip; Propose, Ratify and the closings read that as fresh (the only difference is what this clone pushed), and a
// teammate's push, once fetched, still asks for a Sync. The Share is the push the platform's own Share runs.
describe('right after one\'s own Share: Propose, Ratify and Withdraw go ahead', () => {
  const share = (repo: string) => sh(repo, 'git push -q -- origin refs/heads/main:refs/heads/main')
  it('propose, ratify and withdraw each succeed after the member\'s own Share; nothing is fetched', async () => {
    const { b } = world()
    const B = serve(b)
    sh(b, 'git fetch -q origin')
    const id = await propose(B, b)
    await approve(B, b, id, 'ana'); await approve(B, b, id, 'bruno')
    const fetches = vi.spyOn(gitModule, 'fetchRemote')
    share(b)

    // Propose, right after the Share
    tick(); as(b, 'carla')
    expect((await B.app.request('/api/changes/ops', json({ ops: [{ op: 'update', record: 'projects:proj-001', set: { title: 'Renamed' } }] }))).status).toBe(200)
    const proposed = await B.app.request('/api/proposals', json({ title: 'Rename it' }))
    expect(proposed.status, JSON.stringify(await proposed.clone().json())).toBe(201)
    const second = (await proposed.json()).id as string

    // Ratify, after another Share
    share(b)
    tick(); as(b, 'bruno')
    const ratified = await B.app.request(`/api/proposals/${id}/ratify`, json({}))
    expect(ratified.status, JSON.stringify(await ratified.clone().json())).toBe(200)

    // Withdraw, after another Share
    share(b)
    tick(); as(b, 'carla')
    const withdrawn = await B.app.request(`/api/proposals/${second}/events`, json({ kind: 'withdraw' }))
    expect(withdrawn.status, JSON.stringify(await withdrawn.clone().json())).toBe(200)
    expect(fetches).not.toHaveBeenCalled()
  })
  it('a teammate\'s push, once fetched, still makes them refuse "Sync first"', async () => {
    const { a, b } = world()
    const B = serve(b)
    sh(b, 'git fetch -q origin')
    const id = await propose(B, b)
    await approve(B, b, id, 'ana'); await approve(B, b, id, 'bruno')
    share(b)
    sh(a, 'git pull -q --no-rebase origin main'); commitFile(a, 'remote.txt', 'r\n'); sh(a, 'git push -q origin main')
    sh(b, 'git fetch -q origin')
    const said = /^Sync first: the remote has 1 commit you have not merged/
    tick(); as(b, 'carla')
    expect((await B.app.request('/api/changes/ops', json({ ops: [{ op: 'update', record: 'projects:proj-001', set: { title: 'Renamed' } }] }))).status).toBe(200)
    const proposed = await B.app.request('/api/proposals', json({ title: 'Rename it' }))
    expect(proposed.status).toBe(409)
    expect((await proposed.json()).error).toMatch(said)
    tick(); as(b, 'bruno')
    const ratified = await B.app.request(`/api/proposals/${id}/ratify`, json({}))
    expect(ratified.status).toBe(409)
    expect((await ratified.json()).error).toMatch(said)
    as(b, 'carla')
    const withdrawn = await B.app.request(`/api/proposals/${id}/events`, json({ kind: 'withdraw' }))
    expect(withdrawn.status).toBe(409)
    expect((await withdrawn.json()).error).toMatch(said)
  })
})

// Final review I5: two members proposing on the same UTC day, before either Share is fetched, both counted the day's
// first proposal and minted the same id; Sync then refused the ledger ("both sides opened a proposal with this id"), and
// no hand fix could pass the validator. The id now ends in 4 hex of a random draw.
describe('two clones propose on the same day before either Share is fetched', () => {
  it('they get different ids, and Sync merges the ledger by id, keeping both', async () => {
    const { a, b } = world()
    const A = serve(a), B = serve(b)
    sh(a, 'git fetch -q origin'); sh(b, 'git fetch -q origin')
    const random = vi.spyOn(Math, 'random')
    random.mockReturnValue(0.25)
    const first = await propose(A, a, 'carla')
    random.mockReturnValue(0.75)
    const second = await propose(B, b, 'carla')
    random.mockRestore()
    const day = clock.toISOString().slice(0, 10)
    expect(first).toBe(`p-${day}-001-4000`)
    expect(second).toBe(`p-${day}-001-c000`)
    sh(a, 'git push -q -- origin refs/heads/main:refs/heads/main') // ana Shares first
    const { status, body } = await sync(B.app)
    expect(status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ state: 'merged' })
    expect(ledgerAt(b, 'HEAD').map((p: { id: string }) => p.id).sort()).toEqual([first, second].sort())
  })
})
