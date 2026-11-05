import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeSyntheticRepo, git } from '../changes/fixtures.ts'
import { revOf } from '../../lib/proposals.mjs'
import { readRegistry } from '../../server/registry.ts'
import { baseOf } from '../../server/changes/canonical.ts'
import { Refusal } from '../../server/changes/apply.ts'
import { createEntry, appendEvent, readLedger, type LedgerWho } from '../../server/proposals/ledger.ts'
import { buildBranch, replayBranch } from '../../server/proposals/branch.ts'

// Every repository here is a throwaway under the temp directory: `repo`, and the local clones the merges run in.
// The first draft's replay (a merge that keeps the branch's tree) is rebuilt in a clone, to show it is wrong.
const GOV = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [bruno] }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const PROJECTS = `schema_version: "2.0"

projects:
  - id: "proj-001"
    title: "Node Onboarding Program"
    status: "execute"
    type: "program"
    lead: "bruno"
    contributors: ["ana"]
    tags: ["nodes", "onboarding"]
  # the second project
  - id: "proj-002"
    title: "Second"
    status: "idea"
    type: "program"
    lead: "ana"
`
const ID = 'p-2026-10-18-001-a3f9'
const REF = `refs/heads/proposal/${ID}`
const NOW = () => new Date('2026-10-18T12:00:00Z')
const OPTS = { now: NOW, startBranch: 'main' }
const bruno: LedgerWho = { actor: 'bruno', rule: 'records/approve' }
const RULE = { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } }

let repo: string
const clones: string[] = []
beforeEach(() => {
  repo = makeSyntheticRepo()
  writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS)
  writeFileSync(join(repo, 'data', 'governance.yaml'), GOV)
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: two projects and rules"')
})
afterEach(() => { removeFixtureRepo(repo); for (const c of clones.splice(0)) rmSync(c, { recursive: true, force: true }) })

const head = () => git(repo, 'rev-parse HEAD').trim()
const sha = (rev: string) => git(repo, `rev-parse ${rev}`).trim()
const entry = (registry: string, id: string) => readRegistry(repo, registry).entries!.find(e => e.id === id)!
const names = (a: string, b: string) => git(repo, `diff --name-only ${a} ${b}`).trim().split('\n').filter(Boolean).sort()
const commitFile = (file: string, text: string, msg = 'trunk change') => { writeFileSync(join(repo, file), text); git(repo, 'add -A'); git(repo, `commit -qm "${msg}"`) }
const edit = (file: string, from: string, to: string) => commitFile(file, readFileSync(join(repo, file), 'utf8').replace(from, to), `edit ${file}`)
/** A local clone of `repo` as it is now (a throwaway directory), with the proposal branch available as origin/proposal/<id>. */
function clone(): string {
  const dir = mkdtempSync(join(tmpdir(), 'replay-clone-'))
  clones.push(dir)
  execSync(`git clone -q --local ${repo} ${dir}`, { stdio: 'pipe' })
  execSync('git config user.email t@local && git config user.name t', { cwd: dir, stdio: 'pipe' })
  return dir
}
const sh = (dir: string, cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' }).toString()
const rejection = async (p: Promise<unknown>) => { try { await p } catch (e) { return e } throw new Error('expected a refusal') }

/** The proposal as the ledger holds it: one op on proj-001's tags, opened against the trunk as it is now. */
async function open(set: Record<string, unknown> = { tags: ['nodes', 'onboarding', 'replay'] }) {
  const ops = [{ op: 'update' as const, record: 'projects:proj-001', set, base: baseOf(entry('projects', 'proj-001')) }]
  const proposal = {
    id: ID, title: 'Tag the project', author: 'ana', classes: ['records'], rules: [RULE], state: 'open', opened: '2026-10-18T10:00:00Z',
    rev: revOf(ops), base: head(), branch: `proposal/${ID}`, ops, events: [], closed: null,
  }
  await createEntry(repo, proposal, { actor: 'ana', rule: 'records/approve' }, OPTS)
  return readLedger(repo).entries[0]!
}
/** The trunk moves: a file no op names, the ledger, and the comment line beside the op's entry. */
async function trunkMoves() {
  commitFile('other.txt', 'a file no op names\n', 'a file no op names')
  await appendEvent(repo, ID, { kind: 'comment', text: 'a word from the trunk' }, bruno, OPTS)
  edit('data/projects.yaml', '# the second project', '# the second project, renamed')
}

describe('replay never merges (H1)', () => {
  it('NEGATIVE CONTROL: the first draft’s replay (merge -s ours, then check out the ops’ files) would make a ratify merge undo the trunk’s own work', async () => {
    const p = await open()
    await buildBranch(repo, p as never, head())
    await trunkMoves()
    const dir = clone()
    sh(dir, `git checkout -q -b first-draft origin/proposal/${ID}`)
    sh(dir, 'git merge -q -s ours origin/main -m "bring the trunk in"') // the branch keeps its old tree
    sh(dir, 'git checkout -q origin/main -- data/projects.yaml')
    sh(dir, 'git commit -qm "re-apply the ops" --allow-empty')
    // merging first-draft into the trunk: the trunk is an ancestor, so the result is first-draft's tree
    const undone = sh(dir, 'git diff --name-only origin/main first-draft').trim().split('\n').sort()
    expect(undone).toContain('other.txt') // the trunk's file is gone
    expect(undone).toContain('data/proposals.yaml') // the ledger is back to its old values
    // if this assertion passed with the real replay as well, the test below could not fail
  })

  it('WITHOUT a rebuild, a trunk that edited beside the op’s entry makes the merge conflict in git (the reason ratify rebuilds)', async () => {
    const p = await open()
    await buildBranch(repo, p as never, head())
    await trunkMoves()
    const dir = clone()
    let conflict = ''
    try { sh(dir, `git merge --no-ff --no-commit origin/proposal/${ID}`) } catch (err) { conflict = String((err as { stdout?: Buffer }).stdout ?? err) }
    expect(conflict).toMatch(/CONFLICT/)
  })

  it('REPLAY builds again from the new tip: parent is the new tip, only the ops’ files differ, a `replay` event records the new base, `rev` is unchanged', async () => {
    const p = await open()
    await buildBranch(repo, p as never, head())
    const old = sha(REF)
    await trunkMoves()
    const tip = head()
    const result = await replayBranch(repo, readLedger(repo).entries[0]! as never, tip, bruno, OPTS)
    expect(result).toMatchObject({ from: tip, moved: true })
    expect(sha(`${REF}^`)).toBe(tip) // the branch's first parent is the trunk tip it was built on
    expect(sha(REF)).not.toBe(old)
    expect(names(tip, REF)).toEqual(['data/projects.yaml']) // the ops' files, and only those
    const [after] = readLedger(repo).entries
    expect(after!.rev).toBe(p.rev)
    expect(after!.base).toBe(tip)
    expect(after!.events.at(-1)).toMatchObject({ kind: 'replay', base: tip, by: 'bruno' })
    expect(git(repo, 'log -1 --format=%s').trim()).toBe(`proposals: replay ${ID}`)
  })

  it('a merge of the replayed branch into the trunk changes exactly the ops’ files; every other tracked file is the trunk’s', async () => {
    const p = await open()
    await buildBranch(repo, p as never, head())
    await trunkMoves()
    await replayBranch(repo, readLedger(repo).entries[0]! as never, head(), bruno, OPTS)
    const dir = clone()
    const trunk = sh(dir, 'git rev-parse HEAD').trim()
    sh(dir, `git merge --no-ff --no-commit origin/proposal/${ID}`) // clean: the branch's parent is a trunk commit, so there is nothing to conflict
    expect(sh(dir, 'git diff --cached --name-only').trim().split('\n')).toEqual(['data/projects.yaml'])
    for (const file of sh(dir, 'git ls-files').trim().split('\n').filter(f => f !== 'data/projects.yaml')) {
      expect(sh(dir, `git hash-object ${file}`).trim(), file).toBe(sh(dir, `git rev-parse ${trunk}:${file}`).trim())
    }
    expect(readFileSync(join(dir, 'other.txt'), 'utf8')).toBe('a file no op names\n') // the trunk's own work is still there
    expect(readFileSync(join(dir, 'data', 'projects.yaml'), 'utf8')).toContain('# the second project, renamed') // and the edit beside the op
    expect(readFileSync(join(dir, 'data', 'projects.yaml'), 'utf8')).toContain('tags: [nodes, onboarding, replay]') // and the op
    sh(dir, 'git merge --abort')
  })

  it('a replay with nothing to do (the branch already stands on this tip) writes nothing: an event moves the trunk, so it would be needed again at once', async () => {
    const p = await open()
    await buildBranch(repo, p as never, head())
    const commitsBefore = git(repo, 'rev-list --count HEAD').trim()
    const result = await replayBranch(repo, readLedger(repo).entries[0]! as never, head(), bruno, OPTS)
    expect(result.moved).toBe(false)
    expect(result.event).toBeNull()
    expect(git(repo, 'rev-list --count HEAD').trim()).toBe(commitsBefore)
    expect(p.rev).toBe(readLedger(repo).entries[0]!.rev)
  })

  // Review LOW-B: a 7-hex base can be ambiguous or collected; the base is the whole sha, and a base that cannot be found is said so.
  describe('the base the ledger stores', () => {
    it('is the full sha of the trunk tip the branch was built on', async () => {
      const p = await open()
      await buildBranch(repo, p as never, head())
      const tip = head()
      commitFile('other.txt', 'moves the trunk\n')
      await replayBranch(repo, readLedger(repo).entries[0]! as never, head(), bruno, OPTS)
      expect(readLedger(repo).entries[0]!.base).toMatch(/^[0-9a-f]{40}$/)
      expect(readLedger(repo).entries[0]!.base).toBe(git(repo, 'rev-parse HEAD~1').trim()) // the tip before the replay event
      expect(readLedger(repo).entries[0]!.base).not.toBe(tip)
    })
    it('TAKE THEIRS with a base that names no commit says so, and does not claim every field was changed', async () => {
      const p = await open({ tags: ['nodes', 'onboarding', 'replay'], status: 'develop' })
      await buildBranch(repo, p as never, head())
      edit('data/projects.yaml', 'status: "execute"', 'status: "archive"')
      const lost = { ...readLedger(repo).entries[0]!, base: 'deadbee' }
      const err = await rejection(replayBranch(repo, lost as never, head(), bruno, { ...OPTS, choose: 'theirs' })) as Refusal
      expect(err.body).toMatchObject({ code: 'BASE_LOST' })
      expect(String(err.body.error)).toMatch(/deadbee.*names no commit.*Keep mine/s)
      expect(String(err.body.error)).not.toMatch(/every field/)
    })
  })

  describe('the trunk changed the op’s own entry', () => {
    it('is refused until the author chooses; nothing moves, nothing is written', async () => {
      const p = await open()
      await buildBranch(repo, p as never, head())
      const tip = sha(REF)
      edit('data/projects.yaml', 'status: "execute"', 'status: "archive"')
      const ledgerBefore = readFileSync(join(repo, 'data', 'proposals.yaml'), 'utf8')
      const err = await rejection(replayBranch(repo, readLedger(repo).entries[0]! as never, head(), bruno, OPTS)) as Refusal
      expect(err.body).toMatchObject({ code: 'STALE', records: ['projects:proj-001'] })
      expect(sha(REF)).toBe(tip)
      expect(readFileSync(join(repo, 'data', 'proposals.yaml'), 'utf8')).toBe(ledgerBefore)
    })

    it('KEEP MINE re-bases the op: same `rev` (approvals stand), a `replay` event, the branch holds both changes', async () => {
      const p = await open()
      await buildBranch(repo, p as never, head())
      edit('data/projects.yaml', 'status: "execute"', 'status: "archive"')
      const result = await replayBranch(repo, readLedger(repo).entries[0]! as never, head(), bruno, { ...OPTS, choose: 'mine' })
      expect(result.rev).toBe(p.rev)
      const [after] = readLedger(repo).entries
      expect(after!.rev).toBe(p.rev)
      expect(after!.ops[0]!.base).toBe(baseOf(entry('projects', 'proj-001'))) // re-based on the entry as the trunk holds it
      expect(after!.events.at(-1)).toMatchObject({ kind: 'replay' })
      const branch = git(repo, `show ${REF}:data/projects.yaml`)
      expect(branch).toContain('status: "archive"') // the trunk's change
      expect(branch).toContain('tags: [nodes, onboarding, replay]') // mine
      expect(names(`${REF}^`, REF)).toEqual(['data/projects.yaml'])
    })

    it('KEEP MINE that changes the ops (it drops a field the trunk already holds) is a revision: a new `rev`, a `revise` event with the new ops', async () => {
      const p = await open({ tags: ['nodes', 'onboarding', 'replay'], status: 'archive' })
      await buildBranch(repo, p as never, head())
      edit('data/projects.yaml', 'status: "execute"', 'status: "archive"') // the trunk sets the very status the op sets
      const result = await replayBranch(repo, readLedger(repo).entries[0]! as never, head(), { actor: 'ana', rule: 'records/approve' }, { ...OPTS, choose: 'mine' })
      const [after] = readLedger(repo).entries
      expect(after!.ops).toEqual([expect.objectContaining({ op: 'update', record: 'projects:proj-001', set: { tags: ['nodes', 'onboarding', 'replay'] } })])
      expect(after!.rev).toBe(revOf(after!.ops))
      expect(after!.rev).not.toBe(p.rev)
      expect(result.rev).toBe(after!.rev)
      expect(after!.events.at(-1)).toMatchObject({ kind: 'revise', by: 'ana', rev: after!.rev, ops: after!.ops })
      const branch = git(repo, `show ${REF}:data/projects.yaml`)
      expect(branch).toContain('status: "archive"')
      expect(branch).toContain('tags: [nodes, onboarding, replay]')
    })

    it('TAKE THEIRS drops the op’s conflicting fields and revises: a new `rev` (approvals clear), a `revise` event with the new ops', async () => {
      const p = await open({ tags: ['nodes', 'onboarding', 'replay'], status: 'develop' })
      await buildBranch(repo, p as never, head())
      edit('data/projects.yaml', 'status: "execute"', 'status: "archive"') // the trunk changed the field the op also sets
      const result = await replayBranch(repo, readLedger(repo).entries[0]! as never, head(), bruno, { ...OPTS, choose: 'theirs' })
      const [after] = readLedger(repo).entries
      expect(after!.rev).not.toBe(p.rev)
      expect(result.rev).toBe(after!.rev)
      expect(after!.ops).toHaveLength(1)
      expect(after!.ops[0]).toMatchObject({ op: 'update', record: 'projects:proj-001', set: { tags: ['nodes', 'onboarding', 'replay'] } })
      expect((after!.ops[0] as { set: object }).set).not.toHaveProperty('status')
      expect(after!.events.at(-1)).toMatchObject({ kind: 'revise', rev: after!.rev })
      const branch = git(repo, `show ${REF}:data/projects.yaml`)
      expect(branch).toContain('status: "archive"') // theirs stands
      expect(branch).toContain('tags: [nodes, onboarding, replay]')
    })

    // Review LOW-A: Keep mine on a record the trunk deleted made a create from the changed fields alone, failed validation
    // in a plain Error (a 500) and left a worktree behind.
    describe('the trunk deleted the op’s record', () => {
      const deleteProject = () => edit('data/projects.yaml', /  - id: "proj-001"[\s\S]*?(?=  # the second project)/.exec(readFileSync(join(repo, 'data', 'projects.yaml'), 'utf8'))![0], '')
      const worktreesLeft = () => git(repo, 'worktree list --porcelain').split('\n').filter(l => l.startsWith('worktree ')).length
      it('KEEP MINE is refused in a sentence that names the record, with no worktree left behind and nothing moved', async () => {
        const p = await open()
        await buildBranch(repo, p as never, head())
        deleteProject()
        const [tip, ledgerBefore, trees] = [sha(REF), readFileSync(join(repo, 'data', 'proposals.yaml'), 'utf8'), worktreesLeft()]
        const err = await rejection(replayBranch(repo, readLedger(repo).entries[0]! as never, head(), bruno, { ...OPTS, choose: 'mine' }))
        expect(err).toBeInstanceOf(Refusal)
        expect((err as Refusal).status).toBe(409)
        expect((err as Refusal).body).toMatchObject({ code: 'RECORD_DELETED', records: ['projects:proj-001'] })
        expect(String((err as Refusal).body.error)).toMatch(/projects:proj-001 was deleted on the trunk.*Keep mine.*Withdraw/s)
        expect(worktreesLeft()).toBe(trees)
        expect(sha(REF)).toBe(tip)
        expect(readFileSync(join(repo, 'data', 'proposals.yaml'), 'utf8')).toBe(ledgerBefore)
      })
      it('without a choice it is still the STALE refusal, and TAKE THEIRS says nothing is left', async () => {
        const p = await open()
        await buildBranch(repo, p as never, head())
        deleteProject()
        const entryNow = () => readLedger(repo).entries[0]! as never
        expect(((await rejection(replayBranch(repo, entryNow(), head(), bruno, OPTS))) as Refusal).body).toMatchObject({ code: 'STALE' })
        expect(((await rejection(replayBranch(repo, entryNow(), head(), bruno, { ...OPTS, choose: 'theirs' }))) as Refusal).body).toMatchObject({ code: 'NOTHING_LEFT' })
      })
    })

    it('TAKE THEIRS when nothing of the op is left: refused in words, nothing moves', async () => {
      const p = await open({ status: 'develop' })
      await buildBranch(repo, p as never, head())
      const tip = sha(REF)
      edit('data/projects.yaml', 'status: "execute"', 'status: "archive"')
      const err = await rejection(replayBranch(repo, readLedger(repo).entries[0]! as never, head(), bruno, { ...OPTS, choose: 'theirs' })) as Refusal
      expect(err.body).toMatchObject({ code: 'NOTHING_LEFT' })
      expect(String(err.body.error)).toMatch(/Nothing of this proposal is left/)
      expect(sha(REF)).toBe(tip)
      expect(readLedger(repo).entries[0]!.rev).toBe(p.rev)
    })
  })
})
