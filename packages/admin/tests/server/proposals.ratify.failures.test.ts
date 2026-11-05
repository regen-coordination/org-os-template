import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { buildBranch, type BranchProposal } from '../../server/proposals/branch.ts'
import { ratify, type RatifyDeps } from '../../server/proposals/ratify.ts'
import { readLedger } from '../../server/proposals/ledger.ts'
import { GitExit, mergeAbort, mergeNoFf, stageMergeFiles, showFile } from '../../server/git.ts'
import { validateRepo } from '../../lib/data-validate.mjs'

// Spec §3.8's table, one row each, forced by injecting a failing dependency. Each runs on a branch whose content
// commit also edits data/governance.yaml, a file ratify writes (N2): the branch is built by the real buildBranch and
// then amended, in a worktree of the throwaway repository, to carry that edit too (the change engine cannot stage it,
// P2-R33). After every case: no MERGE_HEAD file, a clean status, HEAD the old trunk tip, every tracked file's bytes as
// before. Every repository is created here under the temp directory; members are synthetic.
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
const DECISIONS_MD = '# Decisions\n\n## Conventions\n\nNewest first.\n\n---\n\n## 2026-10-01 · LD-2026-001 — The first decision\n\n**Status:** active\n'
const GOV = `schema_version: "2.0"\ngovernance:\n  model: "consensus"\n  roles:\n    maintainer: { members: [bruno] }\n    member: { all: true }\n  rules:\n    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }\n  decisions: []\n`
const BASE = Math.floor(Date.now() / 1000) * 1000 - 120_000
const PROJECT = { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } }
const STATEMENT = { title: 'Develop the onboarding program', decision: 'proj-001 moves to develop.', why: 'It is ready.', scope: 'records' }
const BRUNO = { id: 'bruno', name: 'Bruno', kind: 'person' }

let repo: string
let app: Hono
let clock: Date
let ID = ''
const extra: string[] = []
beforeEach(() => { clock = new Date(BASE) })
afterEach(() => { removeFixtureRepo(repo); for (const d of extra.splice(0)) rmSync(d, { recursive: true, force: true }) })

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const as = (who: string) => { git(repo, `config user.email ${who}@example.test`) }
const sha = (rev = 'HEAD') => git(repo, `rev-parse ${rev}`).trim()

/** A met proposal with a statement, opened by ana and approved by bruno; the trunk has moved since its branch was built. */
async function ready(decisions = DECISIONS_MD) {
  repo = makeChangeRepo(GOV)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS)
  writeFileSync(join(repo, 'DECISIONS.md'), decisions)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture"')
  app = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', now: () => clock }))
  as('ana')
  expect((await app.request('/api/changes/ops', json({ ops: [PROJECT] }))).status).toBe(200)
  const res = await app.request('/api/proposals', json({ title: 'Move one project', statement: STATEMENT }))
  expect(res.status).toBe(201)
  ID = (await res.json()).id
  clock = new Date(clock.getTime() + 60e3)
  as('bruno')
  expect((await app.request(`/api/proposals/${ID}/events`, json({ kind: 'approve' }))).status).toBe(200)
  clock = new Date(clock.getTime() + 60e3)
}

/** buildBranch, then the content commit amended (same parent) to edit data/governance.yaml too, and other.txt when asked. */
const handBuild = (also: { other?: boolean } = {}) => async (r: string, proposal: BranchProposal, from: string) => {
  const built = await buildBranch(r, proposal, from)
  const wt = join(mkdtempSync(join(tmpdir(), 'ratify-wt-')), 'wt'); extra.push(join(wt, '..'))
  git(r, `worktree add -q --detach ${wt} ${built.tip}`)
  const gov = join(wt, 'data', 'governance.yaml')
  writeFileSync(gov, `${readFileSync(gov, 'utf8')}# edited on the branch\n`)
  if (also.other) { writeFileSync(join(wt, 'other.txt'), 'not named by any op\n'); git(wt, 'add other.txt') }
  git(wt, 'commit -q -a --amend --no-edit')
  const tip = git(wt, 'rev-parse HEAD').trim()
  git(r, `worktree remove ${wt}`)
  git(r, `update-ref refs/heads/proposal/${proposal.id} ${tip} ${built.tip}`)
  return { tip, from, moved: true }
}

/** The proposal's ops as the ledger stores them (with their bases). */
const ledgerOps = () => readLedger(repo).entries[0]!.ops as BranchProposal['ops']
/** A pre-commit hook that refuses, installed once the branch is built (the build commits in a worktree, which runs it too). */
const thenHook = (body: string) => async (r: string, proposal: BranchProposal, from: string) => {
  const built = await handBuild()(r, proposal, from)
  writeFileSync(join(r, '.git', 'hooks', 'pre-commit'), body, { mode: 0o755 })
  return built
}

/** Every tracked file's bytes, the status, HEAD and the merge file. */
const snapshot = () => ({
  head: sha(),
  files: execSync('git ls-files -z | xargs -0 shasum', { cwd: repo, stdio: 'pipe' }).toString(),
  status: git(repo, 'status --porcelain --untracked-files=no'),
  merging: existsSync(join(repo, '.git', 'MERGE_HEAD')),
})
/** Calls of the real merge and abort, counted. */
function spies() {
  const calls = { merge: 0, abort: 0, build: 0 }
  const ratifyGit: NonNullable<RatifyDeps['ratifyGit']> = {
    merge: async (r, rev) => { calls.merge++; return mergeNoFf(r, rev) },
    abort: async r => { calls.abort++; return mergeAbort(r) },
  }
  return { calls, ratifyGit }
}
const run = (deps: RatifyDeps) => ratify(repo, BRUNO, ID, { now: () => clock, startBranch: 'main', ...deps })
async function refusal(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try { await p } catch (err) { const e = err as { status: number; body: Record<string, unknown> }; return { status: e.status, body: e.body } }
  throw new Error('expected a refusal')
}

describe('a failed ratify leaves the trunk as it was: one row of spec §3.8’s table each', () => {
  it('(1) DECISIONS.md untracked: refused before anything is written', async () => {
    await ready()
    git(repo, 'rm -q --cached DECISIONS.md'); git(repo, 'commit -qm "untrack DECISIONS.md"')
    const before = snapshot()
    const { calls, ratifyGit } = spies()
    const r = await refusal(run({ ratifyGit, build: async (...a) => { calls.build++; return handBuild()(...a) } }))
    expect(r).toMatchObject({ status: 409, body: { code: 'UNTRACKED', error: expect.stringMatching(/DECISIONS\.md is not tracked/) } })
    expect(calls).toEqual({ merge: 0, abort: 0, build: 0 })
    expect(snapshot()).toEqual(before)
  })

  it('(2) an unreadable DECISIONS.md (step 4): refused, nothing written, no merge file ever created', async () => {
    await ready('# Decisions\n\nNo conventions here.\n')
    const before = snapshot()
    const { calls, ratifyGit } = spies()
    const r = await refusal(run({ ratifyGit, build: handBuild() }))
    expect(r).toMatchObject({ status: 409, body: { code: 'CANNOT_RECORD', error: expect.stringMatching(/Conventions/) } })
    expect(calls.merge).toBe(0)
    expect(snapshot()).toEqual(before)
  })

  it('(3) the branch already in the trunk (isAncestor): refused with its sentence, and mergeAbort was not called', async () => {
    await ready()
    const before = snapshot()
    const { calls, ratifyGit } = spies()
    const r = await refusal(run({ ratifyGit: { ...ratifyGit, isAncestor: async () => true }, build: handBuild() }))
    expect(r).toMatchObject({ status: 409, body: { code: 'NOTHING_TO_MERGE', error: expect.stringMatching(/already in the trunk; there is nothing to merge/) } })
    expect(calls).toMatchObject({ merge: 0, abort: 0 })
    expect(snapshot()).toEqual(before)
  })

  it('(4) a merge that leaves no merge file: stop, and no abort', async () => {
    await ready()
    const before = snapshot()
    const { calls, ratifyGit } = spies()
    const r = await refusal(run({ ratifyGit: { ...ratifyGit, merge: async () => { calls.merge++; return { pending: false, said: 'Already up to date.' } } }, build: handBuild() }))
    expect(r).toMatchObject({ status: 409, body: { code: 'NOTHING_TO_MERGE', error: expect.stringMatching(/Already up to date/) } })
    expect(calls).toMatchObject({ merge: 1, abort: 0 })
    expect(snapshot()).toEqual(before)
  })

  it('(5) a throw between governance.yaml’s write and its git add (a file the merge also changed): the step-5 bytes go back and are staged, then the abort; the tree is clean', async () => {
    await ready()
    const before = snapshot()
    const { calls, ratifyGit } = spies()
    const write = (path: string, text: string) => {
      writeFileSync(path, text)
      if (path.endsWith(join('data', 'governance.yaml'))) throw new Error('the disk filled up after the write')
    }
    const r = await refusal(run({ ratifyGit: { ...ratifyGit, write }, build: handBuild() }))
    expect(r).toMatchObject({ status: 503, body: { code: 'RATIFY_UNDONE', error: expect.stringMatching(/data\/governance\.yaml.*the disk filled up.*git merge --abort/) } })
    expect(calls).toMatchObject({ merge: 1, abort: 1 })
    expect(snapshot()).toEqual(before)
  })

  it('(5) negative control, the second draft (proofs N2.U and N2.S): HEAD’s bytes written back and left unstaged make the abort refuse, 128 and MM; staged they let it succeed, so a control that restaged would prove nothing', async () => {
    await ready()
    const T = sha()
    const C = (await handBuild()(repo, { id: ID, author: 'ana', ops: ledgerOps() }, T)).tip
    const gov = join(repo, 'data', 'governance.yaml')
    const headBytes = await showFile(repo, 'HEAD', 'data/governance.yaml')
    // N2.U: unstaged
    await mergeNoFf(repo, C)
    writeFileSync(gov, 'governance: {}\n') // the write that failed
    writeFileSync(gov, headBytes) // the second draft's rollback, not staged
    const refused = await mergeAbort(repo).then(() => null, (err: unknown) => err)
    expect(refused).toBeInstanceOf(GitExit)
    expect((refused as GitExit).code).toBe(128)
    expect((refused as GitExit).message).toMatch(/not uptodate/)
    expect(git(repo, 'status --porcelain --untracked-files=no')).toMatch(/^MM data\/governance\.yaml$/m)
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(true)
    // N2.S: the same bytes, staged, on a fresh repository
    removeFixtureRepo(repo)
    await ready()
    const C2 = (await handBuild()(repo, { id: ID, author: 'ana', ops: ledgerOps() }, sha())).tip
    const before = snapshot()
    await mergeNoFf(repo, C2)
    writeFileSync(join(repo, 'data', 'governance.yaml'), 'governance: {}\n') // the write that failed
    writeFileSync(join(repo, 'data', 'governance.yaml'), await showFile(repo, 'HEAD', 'data/governance.yaml'))
    git(repo, 'add data/governance.yaml')
    await mergeAbort(repo)
    expect(snapshot()).toEqual(before)
  })

  it('(6) a throw after the second file’s add: the abort; the tree is clean', async () => {
    await ready()
    const before = snapshot()
    const { calls, ratifyGit } = spies()
    let adds = 0
    const stage = async (r: string, paths: string[], allowed: string[]) => {
      await stageMergeFiles(r, paths, allowed)
      if (++adds === 2) throw new Error('index.lock exists: another git process is running')
    }
    const r = await refusal(run({ ratifyGit: { ...ratifyGit, stage }, build: handBuild() }))
    expect(r).toMatchObject({ status: 503, body: { code: 'RATIFY_UNDONE', error: expect.stringMatching(/index\.lock/) } })
    expect(calls).toMatchObject({ merge: 1, abort: 1 })
    expect(adds).toBeGreaterThanOrEqual(3) // the re-add of the files written
    expect(snapshot()).toEqual(before)
  })

  it('(7) a staged path outside the allowed set (the branch also changed other.txt): the abort; the tree is clean', async () => {
    await ready()
    const before = snapshot()
    const { calls, ratifyGit } = spies()
    const r = await refusal(run({ ratifyGit, build: handBuild({ other: true }) }))
    expect(r).toMatchObject({ status: 409, body: { code: 'STAGED_OUTSIDE', error: expect.stringMatching(/other\.txt/) } })
    expect(calls).toMatchObject({ merge: 1, abort: 1 })
    expect(snapshot()).toEqual(before)
    expect(existsSync(join(repo, 'other.txt'))).toBe(false)
  })

  it('(8) a pre-commit hook that exits 1: the abort; the tree is clean', async () => {
    await ready()
    const before = snapshot()
    const { calls, ratifyGit } = spies()
    const r = await refusal(run({ ratifyGit, build: thenHook('#!/bin/sh\necho "the hook says no" >&2\nexit 1\n') }))
    expect(r).toMatchObject({ status: 503, body: { code: 'RATIFY_UNDONE', error: expect.stringMatching(/the hook says no/) } })
    expect(calls).toMatchObject({ merge: 1, abort: 1 })
    expect(snapshot()).toEqual(before)
  })

  it('after the abort the result is verified: an abort that leaves the merge pending is reported in words, and nothing else is run', async () => {
    await ready()
    const T = sha()
    let aborts = 0
    const r = await refusal(run({ ratifyGit: { abort: async () => { aborts++ }, isAncestor: undefined, commit: async () => { throw new Error('refused for the test') } }, build: handBuild() }))
    expect(r).toMatchObject({ status: 500, body: { code: 'RATIFY_STUCK', error: expect.stringMatching(/a merge is still in progress/) } })
    expect(aborts).toBe(1)
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(true) // left as git has it: reported, not repaired
    expect(sha()).toBe(T)
    await mergeAbort(repo)
  })

  it('fix 1: a throw from reading C’s blob after the merge began goes to the abort; the tree is as it was', async () => {
    await ready()
    const before = snapshot()
    const { calls, ratifyGit } = spies()
    const show = async () => { throw new Error('git show could not read the blob') }
    const r = await refusal(run({ ratifyGit: { ...ratifyGit, show }, build: handBuild() }))
    expect(r).toMatchObject({ status: 503, body: { code: 'RATIFY_UNDONE', error: expect.stringMatching(/git show could not read the blob.*git merge --abort/) } })
    expect(calls).toMatchObject({ merge: 1, abort: 1 })
    expect(snapshot()).toEqual(before)
  })

  it('fix 1: a throw from reading the staged set (step 7) goes to the abort; the tree is as it was', async () => {
    await ready()
    const before = snapshot()
    const { calls, ratifyGit } = spies()
    const staged = async () => { throw new Error('git diff --cached failed') }
    const r = await refusal(run({ ratifyGit: { ...ratifyGit, staged }, build: handBuild() }))
    expect(r).toMatchObject({ status: 503, body: { code: 'RATIFY_UNDONE', error: expect.stringMatching(/git diff --cached failed/) } })
    expect(calls).toMatchObject({ merge: 1, abort: 1 })
    expect(snapshot()).toEqual(before)
  })

  it('fix 1: a verification read that throws after the abort is reported as RATIFY_STUCK, in git’s words', async () => {
    await ready()
    const { ratifyGit } = spies()
    const r = await refusal(run({
      ratifyGit: { ...ratifyGit, staged: async () => { throw new Error('the staged set could not be read') }, tracked: async () => { throw new Error('git status: index file corrupt') } },
      build: handBuild(),
    }))
    expect(r).toMatchObject({ status: 500, body: { code: 'RATIFY_STUCK', error: expect.stringMatching(/the staged set could not be read.*git status: index file corrupt/) } })
  })

  it('fix 2 (step 7): an unmerged entry in the index is an abort; the tree is as it was', async () => {
    await ready()
    const before = snapshot()
    const { calls, ratifyGit } = spies()
    const r = await refusal(run({ ratifyGit: { ...ratifyGit, unmerged: async () => ['data/governance.yaml'] }, build: handBuild() }))
    expect(r).toMatchObject({ status: 409, body: { code: 'UNMERGED', error: expect.stringMatching(/data\/governance\.yaml.*not merged/) } })
    expect(calls).toMatchObject({ merge: 1, abort: 1 })
    expect(snapshot()).toEqual(before)
  })

  it('fix 3 (step 4): a tree-to-be that validateRepo refuses is refused before the merge, with its errors; nothing is written', async () => {
    await ready()
    const before = snapshot()
    const { calls, ratifyGit } = spies()
    const seen: string[] = []
    // the real validator, plus one planted error that only the texts with the ratification carry
    const validate = (root: string) => {
      const ledger = readFileSync(join(root, 'data', 'proposals.yaml'), 'utf8')
      seen.push(/state: "?ratified/.test(ledger) ? 'after' : 'before')
      const planted = /state: "?ratified/.test(ledger) ? [{ file: 'data/proposals.yaml', path: 'state', level: 'error' as const, message: 'a planted cross-registry error' }] : []
      return [...validateRepo(root), ...planted]
    }
    const r = await refusal(run({ ratifyGit, build: handBuild(), validate }))
    expect(r).toMatchObject({ status: 422, body: { code: 'INVALID', error: expect.stringMatching(/a planted cross-registry error/), errors: [{ file: 'data/proposals.yaml', path: 'state' }] } })
    expect(seen).toEqual(['before', 'after'])
    expect(calls).toMatchObject({ merge: 0, abort: 0 })
    expect(snapshot()).toEqual(before)
  })

  it('negative control: with the staging step removed from the code under test, a refused commit leaves a dirty tree', async () => {
    await ready()
    const before = snapshot()
    const r = await refusal(run({ ratifyGit: { stage: async () => {} }, build: thenHook('#!/bin/sh\nexit 1\n') }))
    expect(r.status).toBeGreaterThanOrEqual(500)
    expect(snapshot().status).not.toBe('')
    expect(snapshot()).not.toEqual(before)
  })
})
