import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeSyntheticRepo, git } from '../changes/fixtures.ts'
import { parseTrailers } from '../../lib/trailers.mjs'
import { revOf } from '../../lib/proposals.mjs'
import { readRegistry } from '../../server/registry.ts'
import { baseOf } from '../../server/changes/canonical.ts'
import { Refusal } from '../../server/changes/apply.ts'
import * as gitModule from '../../server/git.ts'
import { buildBranch, buildFailureWords } from '../../server/proposals/branch.ts'
import { stateDir } from '../../server/state.ts'
import { withGitTrace } from '../git-shim.ts'

// Every test builds a throwaway repository (makeSyntheticRepo) under the temp directory; the worktrees
// the build makes are under ORG_OS_ADMIN_HOME, which tests/setup.ts points at a temp directory too.
let repo: string
beforeEach(() => { repo = makeSyntheticRepo() })
afterEach(() => { vi.restoreAllMocks(); removeFixtureRepo(repo) })

const ID = 'p-2026-10-18-001-a3f9'
const REF = `refs/heads/proposal/${ID}`
const entry = (registry: string, id: string) => readRegistry(repo, registry).entries!.find(e => e.id === id)!
const OPS = () => [
  { op: 'update' as const, record: 'projects:proj-001', set: { status: 'develop' }, base: baseOf(entry('projects', 'proj-001')) },
  { op: 'update' as const, record: 'members:ana', set: { role: 'Steward' }, base: baseOf(entry('members', 'ana')) },
]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proposal = (ops: any[] = OPS()) => ({ id: ID, author: 'bruno', rev: revOf(ops), ops })
const head = () => git(repo, 'rev-parse HEAD').trim()
const sha = (rev: string) => git(repo, `rev-parse ${rev}`).trim()
const hasRef = () => { try { git(repo, `rev-parse --verify -q ${REF}`); return true } catch { return false } }
const reflog = () => { const p = join(repo, '.git', 'logs', REF); return existsSync(p) ? readFileSync(p, 'utf8') : '' }
const worktrees = () => git(repo, 'worktree list --porcelain').split('\n').filter(l => l.startsWith('worktree ')).length
const sandbox = () => join(stateDir(repo), 'proposals')
/** The main checkout as one string: the index, the status, and every tracked file's bytes. */
function checkout(): string {
  const files = git(repo, 'ls-files').trim().split('\n').map(f => `${f} ${createHash('sha1').update(readFileSync(join(repo, f))).digest('hex')}`)
  return [git(repo, 'ls-files -s'), git(repo, 'status --porcelain'), ...files, git(repo, 'rev-parse HEAD'), git(repo, 'symbolic-ref HEAD')].join('\n')
}
const rejection = async (p: Promise<unknown>) => { try { await p } catch (e) { return e } throw new Error('expected a refusal') }

// Review MEDIUM-C: a trunk named proposal/<id> made buildBranch move the trunk to the proposal's commit, with no ratify.
// Review LOW-C: the idempotence rule is "tree equal AND first parent equal `from`"; no test could see the second half.
describe('buildBranch idempotence needs the parent as well as the tree', () => {
  it('a trunk that moved without changing any tree: the branch is built again on the new tip', async () => {
    const first = await buildBranch(repo, proposal(), head())
    git(repo, 'commit -q --allow-empty -m "the trunk moves, no file changes"')
    const second = await buildBranch(repo, proposal(), head())
    expect(second.moved).toBe(true)
    expect(second.tip).not.toBe(first.tip)
    expect(sha(`${REF}^`)).toBe(head()) // parent is the new trunk tip
    expect(sha(`${REF}^{tree}`)).toBe(sha(`${first.tip}^{tree}`)) // the same tree, a different commit
  })
  it('the same tip again moves nothing', async () => {
    const first = await buildBranch(repo, proposal(), head())
    expect(await buildBranch(repo, proposal(), head())).toEqual({ tip: first.tip, from: head(), moved: false })
  })
  // Fix round 1 of Task 15: the content commit names the rev it was built from, so a tip built from older ops is known.
  it('the content commit says which rev of the ops it holds; a tip that does not say this rev is built again, even on the same tree', async () => {
    const first = await buildBranch(repo, proposal(), head())
    expect(git(repo, `log -1 --format=%B ${REF}`)).toContain(`Built from rev ${revOf(OPS())} of the proposal's ops.`)
    // a tip of the same tree and parent whose message names no rev (a branch built before the mark existed)
    const bare = git(repo, `commit-tree ${sha(`${first.tip}^{tree}`)} -p ${sha(`${first.tip}^`)} -m "proposal ${ID}: an old build"`).trim()
    git(repo, `update-ref ${REF} ${bare} ${first.tip}`)
    const again = await buildBranch(repo, proposal(), sha(`${first.tip}^`))
    expect(again.moved).toBe(true)
    expect(git(repo, `log -1 --format=%B ${REF}`)).toContain(`Built from rev ${revOf(OPS())}`)
  })
})

describe('buildBranch never moves the trunk', () => {
  it('refuses when the repository is on proposal/<id>, and nothing moves', async () => {
    git(repo, `checkout -q -b proposal/${ID}`)
    const [tip, before] = [head(), checkout()]
    const err = await rejection(buildBranch(repo, proposal(), tip))
    expect(err).toBeInstanceOf(Refusal)
    expect(String((err as Refusal).body.error)).toMatch(/it is the trunk.*never a proposal branch.*Nothing was built/)
    expect(head()).toBe(tip)
    expect(checkout()).toBe(before)
    expect(worktrees()).toBe(1)
    expect(existsSync(sandbox()) ? readdirSync(sandbox()) : []).toEqual([])
  })
  it('refuses when governance.trunk names it, wherever HEAD is', async () => {
    writeFileSync(join(repo, 'data', 'governance.yaml'), `schema_version: "2.0"\ngovernance:\n  model: "solo-maintainer"\n  trunk: proposal/${ID}\n  decisions: []\n`)
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: a trunk"')
    const tip = head()
    const err = await rejection(buildBranch(repo, proposal(), tip))
    expect(err).toBeInstanceOf(Refusal)
    expect(hasRef()).toBe(false)
    expect(head()).toBe(tip)
  })
  // Re-review LOW-1: the `onBranch` arm. Here the trunk is named (`main`) and only the checkout sits on the proposal branch.
  it('refuses when governance.trunk is main but the checkout is on proposal/<id>, and nothing moves', async () => {
    writeFileSync(join(repo, 'data', 'governance.yaml'), `schema_version: "2.0"\ngovernance:\n  model: "solo-maintainer"\n  trunk: main\n  decisions: []\n`)
    git(repo, 'add -A'); git(repo, 'commit -qm "fixture: a named trunk"')
    git(repo, `checkout -q -b proposal/${ID}`)
    const [tip, before] = [head(), checkout()]
    const err = await rejection(buildBranch(repo, proposal(), tip))
    expect(err).toBeInstanceOf(Refusal)
    expect((err as Refusal).body.code).toBe('BRANCH_IS_TRUNK')
    expect(head()).toBe(tip)
    expect(checkout()).toBe(before)
    expect(worktrees()).toBe(1)
  })
  it('still builds on an ordinary trunk (the control: the refusal is about the name)', async () => {
    const built = await buildBranch(repo, proposal(), head())
    expect(built.moved).toBe(true)
    expect(git(repo, 'symbolic-ref --short HEAD').trim()).toBe('main')
  })
})

describe('buildBranch (spec §3.5: one commit on the trunk tip, the ops and nothing else)', () => {
  it('makes proposal/<id> one commit whose first parent is `from` and whose tree is from’s plus the ops', async () => {
    const from = head()
    const built = await buildBranch(repo, proposal(), from, { change: 'chg_1' })
    expect(built).toEqual({ tip: sha(REF), from, moved: true })
    expect(sha(`${REF}^`)).toBe(from)
    expect(git(repo, `diff --name-only ${from} ${REF}`).trim().split('\n').sort()).toEqual(['data/members.yaml', 'data/projects.yaml'])
    expect(git(repo, `rev-list --count ${from}..${REF}`).trim()).toBe('1')
    expect(entry('projects', 'proj-001').status).toBe('execute') // the main checkout's file is as it was
    expect(git(repo, `show ${REF}:data/projects.yaml`)).toContain('status: "develop"')
  })
  it('the commit carries Org-Actor (the author), Org-Change and Org-Proposal, and no rule', async () => {
    await buildBranch(repo, proposal(), head(), { change: 'chg_1' })
    expect(parseTrailers(git(repo, `log -1 --format=%B ${REF}`))).toEqual({ actor: 'bruno', change: 'chg_1', proposal: ID })
    expect(git(repo, `log -1 --format=%s ${REF}`)).toMatch(new RegExp(`^proposal ${ID}: admin\\(projects, members\\): apply 2 changes`))
  })
  it('the worktree directory is gone afterwards and the branch stays; nothing else is left behind', async () => {
    await buildBranch(repo, proposal(), head())
    expect(worktrees()).toBe(1)
    expect(existsSync(sandbox()) ? readdirSync(sandbox()) : []).toEqual([])
    expect(hasRef()).toBe(true)
  })
  it('does not touch the main checkout: its working tree, index and HEAD are as they were', async () => {
    writeFileSync(join(repo, 'notes.txt'), 'untracked work') // the operator’s own files stay
    const before = checkout()
    await buildBranch(repo, proposal(), head())
    expect(checkout()).toBe(before)
    expect(readFileSync(join(repo, 'notes.txt'), 'utf8')).toBe('untracked work')
  })
  it('builds from a `from` that is not HEAD: the checkout may be anywhere', async () => {
    const from = head()
    writeFileSync(join(repo, 'later.txt'), 'x'); git(repo, 'add later.txt'); git(repo, 'commit -qm later')
    await buildBranch(repo, proposal(), from)
    expect(sha(`${REF}^`)).toBe(from)
    expect(git(repo, `diff --name-only ${from} ${REF}`)).not.toContain('later.txt')
  })

  describe('idempotent by a stated rule: build, compare the tree id, move only when it differs (LOW-1 of the third review)', () => {
    it('a second call with the same `from` does not move the ref, leaves no worktree and no other ref', async () => {
      const from = head()
      const first = await buildBranch(repo, proposal(), from)
      const refs = git(repo, "for-each-ref --format='%(refname)=%(objectname)'")
      const log = reflog()
      expect(log).not.toBe('') // the control: a moved ref writes a reflog line, so an unchanged log means nothing moved
      await withGitTrace(async started => {
        const second = await buildBranch(repo, proposal(), from)
        expect(second).toEqual({ tip: first.tip, from, moved: false })
        const calls = started()
        expect(calls.filter(c => c.startsWith('worktree add')), 'it builds again (one worktree)').toHaveLength(1)
        expect(calls.filter(c => c.startsWith('update-ref')), 'and moves no ref').toHaveLength(0)
      })
      expect(git(repo, "for-each-ref --format='%(refname)=%(objectname)'")).toBe(refs)
      expect(reflog()).toBe(log)
      expect(worktrees()).toBe(1)
      expect(sha(REF)).toBe(first.tip)
    })
    it('the first call does move a ref (the control for the zero above)', async () => {
      await withGitTrace(async started => {
        await buildBranch(repo, proposal(), head())
        expect(started().filter(c => c.startsWith('update-ref'))).toHaveLength(1)
      })
    })
    it('a different `from` builds a new commit and moves the ref, from the old tip (compare-and-swap)', async () => {
      const first = await buildBranch(repo, proposal(), head())
      writeFileSync(join(repo, 'later.txt'), 'x'); git(repo, 'add later.txt'); git(repo, 'commit -qm later')
      const second = await buildBranch(repo, proposal(), head())
      expect(second.moved).toBe(true)
      expect(second.tip).not.toBe(first.tip)
      expect(sha(`${REF}^`)).toBe(head())
      expect(git(repo, `diff --name-only ${head()} ${REF}`).trim().split('\n').sort()).toEqual(['data/members.yaml', 'data/projects.yaml'])
    })
    it('changed ops build a new commit and move the ref', async () => {
      const from = head()
      const first = await buildBranch(repo, proposal(), from)
      const edited = OPS(); edited[0] = { ...edited[0]!, set: { status: 'archive' } }
      const second = await buildBranch(repo, proposal(edited), from)
      expect(second.moved).toBe(true)
      expect(second.tip).not.toBe(first.tip)
      expect(git(repo, `show ${REF}:data/projects.yaml`)).toContain('status: "archive"')
    })
  })

  describe('refusals', () => {
    it('an op whose record changed since it was staged: 409 naming it, nothing built, no worktree left', async () => {
      const ops = OPS()
      const bumped = readFileSync(join(repo, 'data', 'projects.yaml'), 'utf8').replace('status: "execute"', 'status: "archive"')
      writeFileSync(join(repo, 'data', 'projects.yaml'), bumped); git(repo, 'add -A'); git(repo, 'commit -qm "the trunk moved under it"')
      const err = await rejection(buildBranch(repo, proposal(ops), head())) as Refusal
      expect(err).toBeInstanceOf(Refusal)
      expect(err.status).toBe(409)
      expect(err.body).toMatchObject({ code: 'STALE', records: ['projects:proj-001'] })
      expect(String(err.body.error)).toMatch(/projects:proj-001/)
      expect(hasRef()).toBe(false)
      expect(worktrees()).toBe(1)
      expect(existsSync(sandbox()) ? readdirSync(sandbox()) : []).toEqual([])
    })
    it('a create whose record already exists is stale too', async () => {
      const ops = [{ op: 'create' as const, record: 'members:carla', value: { id: 'carla', name: 'Carla' }, base: null }]
      writeFileSync(join(repo, 'data', 'members.yaml'), `${readFileSync(join(repo, 'data', 'members.yaml'), 'utf8')}  - id: "carla"\n    name: "Carla"\n`)
      git(repo, 'add -A'); git(repo, 'commit -qm "carla joined"')
      const err = await rejection(buildBranch(repo, proposal(ops), head())) as Refusal
      expect(err.body).toMatchObject({ code: 'STALE', records: ['members:carla'] })
    })
    // Final review I1: a failed build removes its worktree (applyOps put its files back, so git removes it without force);
    // the path is the note for the server's log, never the error's words.
    it('a failed applyOps inside the worktree leaves the branch where it was, removes the worktree, and its words name no path', async () => {
      const from = head()
      const first = await buildBranch(repo, proposal(), from)
      const bad = [{ op: 'update' as const, record: 'projects:proj-001', set: { lead: 'ghost' }, base: baseOf(entry('projects', 'proj-001')) }]
      const err = await rejection(buildBranch(repo, proposal(bad), from)) as Error
      expect(err.message).toMatch(/Nothing was written/)
      expect(existsSync(sandbox()) ? readdirSync(sandbox()) : []).toEqual([])
      expect(worktrees()).toBe(1)
      expect(err.message).not.toContain(sandbox())
      const { words, left } = buildFailureWords(err)
      expect(words).not.toContain(sandbox())
      expect(left).toContain(join(sandbox(), `${ID}-1`))
      expect(left).toMatch(/was removed/)
      expect(sha(REF)).toBe(first.tip) // the branch did not move
    })
    it('a worktree left behind never blocks the next build: the next one takes the next number', async () => {
      mkdirSync(join(sandbox(), `${ID}-1`), { recursive: true }) // what a build git could not clean up would leave
      await buildBranch(repo, proposal(), head())
      expect(readdirSync(sandbox())).toEqual([`${ID}-1`]) // the one left; the good one removed its own
      expect(hasRef()).toBe(true)
    })
    it('ops that change nothing (the trunk already holds the result) are refused, with the worktree removed', async () => {
      const same = [{ op: 'update' as const, record: 'projects:proj-001', set: { status: 'execute' }, base: baseOf(entry('projects', 'proj-001')) }]
      const err = await rejection(buildBranch(repo, proposal(same), head())) as Refusal
      expect(err.status).toBe(409)
      expect(err.body).toMatchObject({ code: 'NOTHING_TO_BUILD' })
      expect(String(err.body.error)).toMatch(/already holds the result/)
      expect(hasRef()).toBe(false)
      expect(worktrees()).toBe(1)
      expect(existsSync(sandbox()) ? readdirSync(sandbox()) : []).toEqual([])
    })
    it('a branch moved while it was being built is refused, and stays where the other mover put it', async () => {
      const from = head()
      const first = await buildBranch(repo, proposal(), from)
      writeFileSync(join(repo, 'later.txt'), 'x'); git(repo, 'add later.txt'); git(repo, 'commit -qm later')
      const real = gitModule.moveProposalBranch
      const rival = sha('HEAD')
      vi.spyOn(gitModule, 'moveProposalBranch').mockImplementationOnce(async (r, id, next, old) => {
        git(repo, `update-ref ${REF} ${rival} ${first.tip}`) // somebody else moves it first
        return real(r, id, next, old)
      })
      const err = await rejection(buildBranch(repo, proposal(), head())) as Refusal
      expect(err.status).toBe(409)
      expect(err.body).toMatchObject({ code: 'MOVED' })
      expect(String(err.body.error)).toContain(`proposal/${ID}`)
      expect(sha(REF)).toBe(rival)
    })
    it('an id that is not a proposal id never reaches git', async () => {
      const err = await rejection(buildBranch(repo, { ...proposal(), id: 'main' }, head())) as Error
      expect(err.message).toMatch(/not a proposal id/)
    })
    it('a `from` that names nothing is refused', async () => {
      const err = await rejection(buildBranch(repo, proposal(), 'no-such-rev')) as Error
      expect(err.message).toMatch(/names no commit/)
    })
  })
})
