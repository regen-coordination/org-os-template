import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Hono } from 'hono'
import { removeFixtureRepo, REAL_REPO } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { readRegistry } from '../../server/registry.ts'
import { baseOf } from '../../server/changes/canonical.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { buildBranch, buildFailureWords, type BuildResult } from '../../server/proposals/branch.ts'
import { stateDir } from '../../server/state.ts'
import { revOf } from '../../lib/proposals.mjs'

// A branch build commits in a detached worktree under the admin state directory (0.6 P2 spec §3.5), and the
// repository's pre-commit hook runs there. The final review (I1) found the framework's hook refusing every build (its
// checks import js-yaml, and a linked worktree has no node_modules), each failure leaving a worktree behind, and every
// page visit building again. Here: the real hook lets the build through; a hook that does refuse leaves no worktree
// and no local path in what a viewer reads; and a visit does not build again what already failed at the same rev and
// trunk tip. Every repository is a throwaway one under the temp directory (makeChangeRepo), every git command runs
// with it as its cwd, and the state directory is the temp one tests/setup.ts names.

let repo: string
afterEach(() => { vi.restoreAllMocks(); removeFixtureRepo(repo) })

const ID = 'p-2026-10-18-001-a3f9'
const REF = `refs/heads/proposal/${ID}`
const head = () => git(repo, 'rev-parse HEAD').trim()
const worktrees = () => git(repo, 'worktree list --porcelain').split('\n').filter(l => l.startsWith('worktree ')).length
const sandbox = () => join(stateDir(repo), 'proposals')
const left = () => (existsSync(sandbox()) ? readdirSync(sandbox()) : [])
const hasRef = () => { try { git(repo, `rev-parse --verify -q ${REF}`); return true } catch { return false } }
const hooksDir = () => resolve(repo, git(repo, 'rev-parse --git-path hooks').trim())
const rejection = async (p: Promise<unknown>) => { try { await p } catch (e) { return e } throw new Error('expected a refusal') }

function installHook(text: string | null, from?: string): void {
  mkdirSync(hooksDir(), { recursive: true })
  const path = join(hooksDir(), 'pre-commit')
  if (from) copyFileSync(from, path); else writeFileSync(path, text ?? '')
  chmodSync(path, 0o755)
}
/** A hook that refuses a commit made in a linked worktree (a build), and lets the main checkout's through. */
const REFUSES_IN_WORKTREES = `#!/bin/sh
if [ "$(cd "$(git rev-parse --git-dir)" && pwd -P)" != "$(cd "$(git rev-parse --git-common-dir)" && pwd -P)" ]; then
  echo "no commits from a worktree today" >&2
  exit 1
fi
exit 0
`

const proposalOf = () => {
  const p = readRegistry(repo, 'projects').entries!.find(e => e.id === 'proj-001')!
  const ops = [{ op: 'update' as const, record: 'projects:proj-001', set: { status: 'develop' }, base: baseOf(p) }]
  return { id: ID, author: 'ana', rev: revOf(ops), ops }
}

describe('the framework pre-commit hook in a branch build (I1 a)', () => {
  beforeEach(() => {
    repo = makeChangeRepo()
    // validate:structure needs a module only the main checkout's node_modules holds, as the real one needs js-yaml
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fixture', private: true, scripts: { 'validate:structure': 'node -e "require(\'only-in-main\')"' } }))
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\n')
    git(repo, 'add package.json .gitignore'); git(repo, 'commit -qm "fixture: a package with a check"')
    mkdirSync(join(repo, 'node_modules', 'only-in-main'), { recursive: true })
    writeFileSync(join(repo, 'node_modules', 'only-in-main', 'index.js'), 'module.exports = {}\n')
    installHook(null, join(REAL_REPO, '.github', 'hooks', 'pre-commit.sh'))
  })

  it('the hook passes in the main checkout (the module is there)', () => {
    writeFileSync(join(repo, 'notes.txt'), 'a note'); git(repo, 'add notes.txt')
    expect(() => git(repo, 'commit -qm "a note"')).not.toThrow()
  })
  it('the build succeeds: the hook skips its node checks in a worktree with no node_modules, and nothing is left behind', async () => {
    const built = await buildBranch(repo, proposalOf(), head())
    expect(built.moved).toBe(true)
    expect(hasRef()).toBe(true)
    expect(worktrees()).toBe(1)
    expect(left()).toEqual([])
  })
})

describe('a build the hook genuinely refuses (I1 b)', () => {
  beforeEach(() => { repo = makeChangeRepo(); installHook(REFUSES_IN_WORKTREES) })

  it('removes its worktree; the message a viewer reads names no local path; the path is kept for the log', async () => {
    const err = await rejection(buildBranch(repo, proposalOf(), head())) as Error
    expect(worktrees()).toBe(1)
    expect(left()).toEqual([])
    expect(hasRef()).toBe(false)
    expect(err.message).toMatch(/no commits from a worktree today/)
    expect(err.message).not.toContain(tmpdir())
    expect(err.message).not.toContain(sandbox())
    const { words, left: note } = buildFailureWords(err)
    expect(words).not.toContain(sandbox())
    expect(note).toContain(join(sandbox(), `${ID}-1`))
    expect(note).toMatch(/removed/)
  })
  it('the next build takes a fresh worktree and succeeds once the hook lets it', async () => {
    await rejection(buildBranch(repo, proposalOf(), head()))
    installHook('#!/bin/sh\nexit 0\n')
    await buildBranch(repo, proposalOf(), head())
    expect(hasRef()).toBe(true)
    expect(left()).toEqual([])
  })
})

// One organisation served whole: bruno decides records, ana proposes them; `builds` counts the branch builds.
let app: Hono
let builds: number
const MEMBERS = `schema_version: "2.0"
members:
  - { id: ana, name: Ana, kind: person, handles: { git: ["ana@example.test"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
`
const GOV = `schema_version: "2.0"\ngovernance:\n  model: "consensus"\n  roles:\n    maintainer: { members: [bruno] }\n    member: { all: true }\n  rules:\n` +
  `    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }\n  decisions: []\n`
const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const as = (who: string) => git(repo, `config user.email ${who}@example.test`)
let clock: Date
function serveWith(hook: string): void {
  repo = makeChangeRepo(GOV)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'projects.yaml'), 'schema_version: "2.0"\nprojects:\n  - { id: "proj-001", title: "Garden", status: "execute", type: "program", lead: "bruno" }\n')
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: synthetic members"')
  as('ana')
  installHook(hook)
  builds = 0
  clock = new Date('2026-10-18T12:00:00Z')
  app = createApp(repo, (a, ctx) => mountProposals(a, {
    repo, withLock: ctx.withLock, startBranch: 'main', now: () => clock,
    build: (...args: Parameters<typeof buildBranch>): Promise<BuildResult> => { builds++; return buildBranch(...args) },
  }))
}
/** ana stages a status change and proposes it; the answer's body. */
async function proposeOne(): Promise<Record<string, unknown>> {
  expect((await app.request('/api/changes/ops', json({ ops: [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }] }))).status).toBe(200)
  const opened = await app.request('/api/proposals', json({ title: 'Move one project' }))
  expect(opened.status).toBe(201)
  return opened.json()
}

describe('a page visit does not build again what already failed at the same rev and trunk tip (I1 c)', () => {
  beforeEach(() => serveWith(REFUSES_IN_WORKTREES))

  it('a second visit reads the same note without building; a new trunk tip builds again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const proposal = await proposeOne()
    expect(proposal.branchState).toBe('missing')
    expect(proposal.note).not.toContain(sandbox())
    expect(builds).toBe(1)

    const first = await (await app.request(`/api/proposals/${proposal.id}`)).json()
    expect(first.note).toMatch(/could not be built: .*no commits from a worktree today/)
    expect(first.note).not.toContain(sandbox())
    expect(builds).toBe(2)
    const second = await (await app.request(`/api/proposals/${proposal.id}`)).json()
    expect(second.note).toBe(first.note)
    expect(builds).toBe(2)
    expect(worktrees()).toBe(1)
    expect(left()).toEqual([])
    // the path went to the server's log, never to a viewer
    expect(warn.mock.calls.map(c => c.join(' ')).join('\n')).toContain(sandbox())

    writeFileSync(join(repo, 'notes.txt'), 'the trunk moves'); git(repo, 'add notes.txt'); git(repo, 'commit -qm "the trunk moves"')
    await app.request(`/api/proposals/${proposal.id}`)
    expect(builds).toBe(3)
    expect(left()).toEqual([])
  })
})

// Final review M1: Propose's and Revise's note, and Ratify's refusal, said a failed build in its own words, which held the
// worktree's path (the note the build added, or a hook's words). They say it as buildFailureWords does, and the path goes
// to the server's log. The hook here names the directory it ran in, as a hook's error often does.
describe('what Propose, Revise and Ratify say of a failed build names no local path (M1)', () => {
  const NAMES_ITS_PATH = `#!/bin/sh
if [ "$(cd "$(git rev-parse --git-dir)" && pwd -P)" != "$(cd "$(git rev-parse --git-common-dir)" && pwd -P)" ]; then
  echo "refused in $(pwd)" >&2
  exit 1
fi
exit 0
`
  beforeEach(() => serveWith(NAMES_ITS_PATH))
  const local = (text: unknown) => [sandbox(), tmpdir(), '/private/var', '/var/folders'].filter(p => String(text).includes(p))

  it('Propose\'s note', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = await proposeOne()
    expect(p.note).toMatch(/could not be built \(.*refused in the build's worktree.*\)/)
    expect(local(p.note)).toEqual([])
    expect(warn.mock.calls.map(c => c.join(' ')).join('\n')).toContain(sandbox())
  })
  it('Revise\'s note', async () => {
    const p = await proposeOne()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    clock = new Date(clock.getTime() + 60e3)
    const project = readRegistry(repo, 'projects').entries!.find(e => e.id === 'proj-001')!
    const res = await app.request(`/api/proposals/${p.id}/revise`, json({ ops: [{ op: 'update', record: 'projects:proj-001', set: { status: 'develop', title: 'Garden two' }, base: baseOf(project) }] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.note).toMatch(/revised, but its branch .* could not be built \(.*refused in the build's worktree.*\)/)
    expect(local(body.note)).toEqual([])
    expect(warn.mock.calls.map(c => c.join(' ')).join('\n')).toContain(sandbox())
  })
  it('Ratify\'s refusal', async () => {
    const p = await proposeOne()
    as('bruno'); clock = new Date(clock.getTime() + 60e3)
    expect((await app.request(`/api/proposals/${p.id}/events`, json({ kind: 'approve' }))).status).toBe(200)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    clock = new Date(clock.getTime() + 60e3)
    const before = git(repo, 'rev-parse HEAD')
    const res = await app.request(`/api/proposals/${p.id}/ratify`, json({}))
    const body = await res.json()
    expect(res.status, JSON.stringify(body)).toBe(409)
    expect(body).toMatchObject({ code: 'NO_BRANCH' })
    expect(body.error).toMatch(/^Not ratified: proposal\/p-.* could not be built \(.*refused in the build's worktree.*\)\. Nothing was written\.$/)
    expect(local(JSON.stringify(body))).toEqual([])
    expect(git(repo, 'rev-parse HEAD')).toBe(before)
    expect(warn.mock.calls.map(c => c.join(' ')).join('\n')).toContain(sandbox())
  })
})
