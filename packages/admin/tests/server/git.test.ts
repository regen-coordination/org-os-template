import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, statSync, utimesSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import * as git from '../../server/git.ts'
import { withGitTrace } from '../git-shim.ts'
import { stateDir } from '../../server/state.ts'

// Every test builds a throwaway repository (and, for lastFetch, a bare remote) in a temporary
// directory, with an explicit author and no global configuration. Nothing here touches a real instance.
const ENV = {
  ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.org', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.org',
}
const sh = (cwd: string, cmd: string): string => execSync(cmd, { cwd, env: ENV, stdio: 'pipe' }).toString()
const sha = (cwd: string, rev = 'HEAD') => sh(cwd, `git rev-parse ${rev}`).trim()
const ID = 'p-2026-10-18-001-a3f9'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'git-vocab-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

/** A repository on `main` with one commit holding a.txt and data/x.yaml. */
function repoAt(name = 'repo'): string {
  const dir = join(root, name)
  mkdirSync(join(dir, 'data'), { recursive: true })
  sh(dir, 'git init -q -b main')
  writeFileSync(join(dir, 'a.txt'), 'hello\n')
  writeFileSync(join(dir, 'data', 'x.yaml'), 'x: 1\n')
  sh(dir, 'git add -A && git commit -qm first')
  return dir
}
const commitFile = (dir: string, file: string, text: string, msg = file) => {
  mkdirSync(join(dir, file, '..'), { recursive: true })
  writeFileSync(join(dir, file), text)
  sh(dir, `git add -A && git commit -qm "${msg}"`)
  return sha(dir)
}

describe('gitVersion', () => {
  it('parses git’s own words, with a distribution suffix and a fourth number', () => {
    expect(git.parseGitVersion('git version 2.43.0')).toEqual({ major: 2, minor: 43, patch: 0 })
    expect(git.parseGitVersion('git version 2.39.5 (Apple Git-154)\n')).toEqual({ major: 2, minor: 39, patch: 5 })
    expect(git.parseGitVersion('git version 2.45.1.windows.1')).toEqual({ major: 2, minor: 45, patch: 1 })
    expect(git.parseGitVersion('git version 2.38')).toEqual({ major: 2, minor: 38, patch: 0 })
    expect(() => git.parseGitVersion('not git')).toThrow(/git version/)
  })
  it('reads the installed git', async () => {
    const v = await git.gitVersion()
    expect(v.major).toBeGreaterThanOrEqual(2)
  })
})

describe('showFile', () => {
  it('returns the blob’s bytes at a revision, and refuses a path that is not in it', async () => {
    const dir = repoAt()
    const first = sha(dir)
    commitFile(dir, 'a.txt', 'changed\n')
    expect(await git.showFile(dir, first, 'a.txt')).toBe('hello\n')
    expect(await git.showFile(dir, 'HEAD', 'a.txt')).toBe('changed\n')
    await expect(git.showFile(dir, first, 'nope.txt')).rejects.toThrow(/nope\.txt is not in/)
  })
  it('keeps CRLF and a missing final newline as they are', async () => {
    const dir = repoAt()
    commitFile(dir, 'crlf.txt', 'one\r\ntwo')
    expect(await git.showFile(dir, 'HEAD', 'crlf.txt')).toBe('one\r\ntwo')
  })
})

describe('worktrees', () => {
  it('addWorktree makes a detached worktree at a ref and refuses an existing path', async () => {
    const dir = repoAt()
    const wt = join(root, 'wt')
    await git.addWorktree(dir, wt, 'HEAD')
    expect(readFileSync(join(wt, 'a.txt'), 'utf8')).toBe('hello\n')
    expect(sh(wt, 'git rev-parse --abbrev-ref HEAD').trim()).toBe('HEAD')
    expect(sha(wt)).toBe(sha(dir))
    await expect(git.addWorktree(dir, wt, 'HEAD')).rejects.toThrow(/already exists/)
    const empty = join(root, 'empty')
    mkdirSync(empty)
    await expect(git.addWorktree(dir, empty, 'HEAD')).rejects.toThrow(/already exists/)
  })
  it('removeWorktree refuses a dirty worktree without a force flag, and removes a clean one', async () => {
    const dir = repoAt()
    const wt = join(stateDir(dir), 'proposals', `${ID}-1`)
    await git.addWorktree(dir, wt, 'HEAD')
    writeFileSync(join(wt, 'untracked.txt'), 'work')
    await expect(git.removeWorktree(dir, wt)).rejects.toThrow()
    expect(existsSync(wt)).toBe(true)
    rmSync(join(wt, 'untracked.txt'))
    await git.removeWorktree(dir, wt)
    expect(existsSync(wt)).toBe(false)
    expect(sh(dir, 'git worktree list').trim().split('\n')).toHaveLength(1)
  })
  // Final review M5: the one removal the platform makes is of a build's worktree, under the admin state directory.
  it('removeWorktree refuses, before git runs, a path outside stateDir(repo)/proposals', async () => {
    const dir = repoAt()
    const outside = join(root, 'wt')
    await git.addWorktree(dir, outside, 'HEAD')
    const home = join(stateDir(dir), 'proposals')
    for (const bad of [outside, home, join(home, '..', 'elsewhere'), `${home}-sibling/x`, 'relative/proposals/x', dir]) {
      await withGitTrace(async started => {
        await expect(git.removeWorktree(dir, bad), bad).rejects.toThrow(/guardrail: refusing to remove .*: the platform removes only the worktrees it builds, under /)
        expect(started(), bad).toEqual([])
      })
    }
    expect(existsSync(outside)).toBe(true)
    expect(sh(dir, 'git worktree list').trim().split('\n')).toHaveLength(2)
  })
})

describe('moveProposalBranch', () => {
  it('creates the ref only when old is null, moves it only when old matches, and refuses otherwise', async () => {
    const dir = repoAt()
    const a = sha(dir)
    const b = commitFile(dir, 'b.txt', 'b')
    const ref = `refs/heads/proposal/${ID}`
    await git.moveProposalBranch(dir, ID, a, null)
    expect(sha(dir, ref)).toBe(a)
    await expect(git.moveProposalBranch(dir, ID, b, null)).rejects.toThrow(/cannot lock ref|expected|exists/i)
    expect(sha(dir, ref)).toBe(a)
    await expect(git.moveProposalBranch(dir, ID, b, b)).rejects.toThrow(/cannot lock ref|expected/i)
    expect(sha(dir, ref)).toBe(a)
    await git.moveProposalBranch(dir, ID, b, a)
    expect(sha(dir, ref)).toBe(b)
  })
  it('refuses an id that is not p-YYYY-MM-DD-NNN-xxxx, and never takes a ref', async () => {
    const dir = repoAt()
    const a = sha(dir)
    for (const bad of ['main', 'p-2026-10-18-1', '../main', 'p-2026-10-18-001-a3f9/x', 'refs/heads/main', '', 'p-2026-10-18-001', 'p-2026-10-18-001-A3F9', 'p-2026-10-18-001-a3f90']) {
      await expect(git.moveProposalBranch(dir, bad, a, null), bad).rejects.toThrow(/proposal id/)
    }
    expect(sh(dir, 'git for-each-ref refs/heads').trim().split('\n')).toHaveLength(1)
  })
  it('cannot delete: an all-zero new value is refused (the review’s LOW-3)', async () => {
    const dir = repoAt()
    const a = sha(dir)
    await git.moveProposalBranch(dir, ID, a, null)
    await expect(git.moveProposalBranch(dir, ID, '0'.repeat(40), a)).rejects.toThrow(/never deleted|zero/i)
    expect(sha(dir, `refs/heads/proposal/${ID}`)).toBe(a)
    expect(() => git.__internal.checkArgv(['update-ref', `refs/heads/proposal/${ID}`, '0'.repeat(40), a])).toThrow()
    // The control: git itself deletes the ref on exactly that argument list, which is why the guard has to refuse it.
    sh(dir, `git update-ref refs/heads/proposal/${ID} ${'0'.repeat(40)} ${a}`)
    expect(() => sha(dir, `refs/heads/proposal/${ID}`)).toThrow()
  })
  it('refuses a new value that is not 40 hex', async () => {
    const dir = repoAt()
    await expect(git.moveProposalBranch(dir, ID, 'HEAD', null)).rejects.toThrow(/40-hex/)
  })
})

describe('reading history', () => {
  it('isAncestor, mergeBase, resolveRev', async () => {
    const dir = repoAt()
    const a = sha(dir)
    sh(dir, 'git branch topic')
    const b = commitFile(dir, 'b.txt', 'b')
    expect(await git.isAncestor(dir, a, b)).toBe(true)
    expect(await git.isAncestor(dir, b, a)).toBe(false)
    expect(await git.isAncestor(dir, 'topic', 'main')).toBe(true) // a branch already in the trunk
    expect(await git.mergeBase(dir, 'topic', 'main')).toBe(a)
    expect(await git.resolveRev(dir, 'main')).toBe(b)
    expect(await git.resolveRev(dir, `${b}^`)).toBe(a)
    expect(await git.resolveRev(dir, 'no-such-branch')).toBeNull()
    await expect(git.isAncestor(dir, 'no-such-branch', 'main')).rejects.toThrow()
  })
  it('messageOf reads a commit’s whole message (log -1 --format=%B), and refuses a revision that names nothing', async () => {
    const dir = repoAt()
    sh(dir, 'git commit -q --allow-empty -m "subject line" -m "a body line"')
    expect((await git.messageOf(dir, 'HEAD')).trim()).toBe('subject line\n\na body line')
    expect((await git.messageOf(dir, 'HEAD~1')).trim()).toBe('first')
    await expect(git.messageOf(dir, 'no-such-branch')).rejects.toThrow()
    await expect(git.messageOf(dir, '--format=%H')).rejects.toThrow(/not a flag log may carry/)
  })
  it('trunkLine is the first-parent line, and not what lies beneath a merge’s second parent', async () => {
    const dir = repoAt()
    const a = sha(dir)
    sh(dir, 'git checkout -q -b feature')
    commitFile(dir, 'f1.txt', '1', 'f1')
    commitFile(dir, 'f2.txt', '2', 'f2')
    sh(dir, 'git checkout -q main')
    const m1 = commitFile(dir, 'm1.txt', '1', 'm1')
    sh(dir, 'git merge -q --no-ff -m merge feature')
    const merge = sha(dir)
    const m2 = commitFile(dir, 'm2.txt', '2', 'm2')
    expect(await git.trunkLine(dir, a, m2)).toEqual([m1, merge, m2])
    expect(await git.trunkLine(dir, m2, m2)).toEqual([])
  })
  it('diffNames, stagedNames, treeDiffNames, diffText', async () => {
    const dir = repoAt()
    const a = sha(dir)
    const b = commitFile(dir, 'b.txt', 'b')
    writeFileSync(join(dir, 'a.txt'), 'staged\n')
    sh(dir, 'git add a.txt')
    expect(await git.diffNames(dir, a, b)).toEqual(['b.txt'])
    expect(await git.stagedNames(dir)).toEqual(['a.txt'])
    expect(await git.treeDiffNames(dir, a, b)).toEqual(['b.txt'])
    expect(await git.diffText(dir, a, b)).toContain('+b')
    expect(await git.diffNames(dir, a, a)).toEqual([])
  })
  it('countBetween counts ahead and behind', async () => {
    const dir = repoAt()
    const a = sha(dir)
    sh(dir, 'git branch other')
    commitFile(dir, 'b.txt', 'b')
    commitFile(dir, 'c.txt', 'c')
    expect(await git.countBetween(dir, 'other', 'main')).toBe(2)
    expect(await git.countBetween(dir, 'main', 'other')).toBe(0)
    expect(await git.countBetween(dir, a, 'main')).toBe(2)
  })
})

describe('paths, tracking and names', () => {
  it('gitPath names where MERGE_HEAD and FETCH_HEAD are', async () => {
    const dir = repoAt()
    expect(await git.gitPath(dir, 'MERGE_HEAD')).toBe(join(dir, '.git', 'MERGE_HEAD'))
    expect(await git.gitPath(dir, 'FETCH_HEAD')).toBe(join(dir, '.git', 'FETCH_HEAD'))
  })
  it('gitPath in a linked worktree names that worktree’s own git directory', async () => {
    const dir = repoAt()
    const wt = join(root, 'wt')
    await git.addWorktree(dir, wt, 'HEAD')
    expect(await git.gitPath(wt, 'MERGE_HEAD')).toContain(join('.git', 'worktrees'))
  })
  it('a branch named MERGE_HEAD does not make a merge in progress (LOW-2, proof L2)', async () => {
    const dir = repoAt()
    sh(dir, 'git branch MERGE_HEAD')
    expect(sh(dir, 'git rev-parse --verify -q MERGE_HEAD').trim()).toMatch(/^[0-9a-f]{40}$/) // the trap: git answers "present"
    expect(await git.mergeInProgress(dir)).toBe(false)
    writeFileSync(join(dir, '.git', 'MERGE_HEAD'), `${sha(dir)}\n`)
    expect(await git.mergeInProgress(dir)).toBe(true)
  })
  it('assertTracked refuses an untracked file and names it', async () => {
    const dir = repoAt()
    writeFileSync(join(dir, 'loose.txt'), 'x')
    await git.assertTracked(dir, ['a.txt', 'data/x.yaml'])
    await expect(git.assertTracked(dir, ['a.txt', 'loose.txt'])).rejects.toThrow(/loose\.txt is not tracked/)
  })
  it('validBranchName rejects what git rejects and the names the pattern lets through (proof L1)', async () => {
    const dir = repoAt()
    for (const ok of ['main', 'release/1.0', 'trunk-2']) expect(await git.validBranchName(dir, ok), ok).toBe(true)
    for (const bad of ['a/.b', 'a.lock/b', 'a..b', 'a b', 'x/', '', '-x', '+main', 'a:b', 'a~1', 'a^']) {
      expect(await git.validBranchName(dir, bad), bad).toBe(false)
    }
  })
  it('trackedChanges ignores untracked files', async () => {
    const dir = repoAt()
    writeFileSync(join(dir, 'loose.txt'), 'x')
    expect(await git.trackedChanges(dir)).toEqual([])
    writeFileSync(join(dir, 'a.txt'), 'changed\n')
    expect(await git.trackedChanges(dir)).toEqual(['a.txt'])
    sh(dir, 'git add a.txt')
    expect(await git.trackedChanges(dir)).toEqual(['a.txt'])
  })
})

describe('lastFetch: what the last fetch says, with no network (M-c, LOW-4; proofs LF and FH)', () => {
  /** A bare remote, and two clones of it, `mine` and `theirs`; main holds one commit. */
  function pair() {
    const remote = join(root, 'remote.git')
    sh(root, `git init -q --bare -b main ${remote}`)
    const seed = repoAt('seed')
    sh(seed, `git remote add origin ${remote} && git push -q origin main`)
    sh(root, `git clone -q ${remote} mine && git clone -q ${remote} theirs`)
    return { remote, mine: join(root, 'mine'), theirs: join(root, 'theirs') }
  }
  const push = (dir: string, file: string, branch = 'main') => {
    commitFile(dir, file, file)
    sh(dir, `git push -q origin HEAD:refs/heads/${branch}`)
  }

  it('a repository with no remote reads "no remote"', async () => {
    const dir = repoAt()
    expect((await git.lastFetch(dir, 'main')).state).toBe('no remote')
  })
  it('a fresh clone has no FETCH_HEAD and reads "never fetched"', async () => {
    const { mine } = pair()
    expect(existsSync(join(mine, '.git', 'FETCH_HEAD'))).toBe(false)
    const r = await git.lastFetch(mine, 'main')
    expect(r.state).toBe('never fetched')
    expect(r.fetchedAt).toBeNull()
  })
  it('after a fetch it reads the file’s age; after another clone pushed and we fetched, behind 1 — and it fetches nothing itself', async () => {
    const { mine, theirs } = pair()
    sh(mine, 'git fetch -q origin')
    let r = await git.lastFetch(mine, 'main')
    expect(r).toMatchObject({ state: 'fetched', behind: 0, ahead: 0 })
    expect(r.fetchedAt!.getTime()).toBe(statSync(join(mine, '.git', 'FETCH_HEAD')).mtime.getTime())

    push(theirs, 'theirs.txt')
    r = await git.lastFetch(mine, 'main') // not fetched yet: the platform says what it last saw
    expect(r.behind).toBe(0)
    sh(mine, 'git fetch -q origin main')
    r = await git.lastFetch(mine, 'main')
    expect(r).toMatchObject({ state: 'fetched', behind: 1, ahead: 0 })
    commitFile(mine, 'mine.txt', 'm')
    expect(await git.lastFetch(mine, 'main')).toMatchObject({ behind: 1, ahead: 1 })
  })
  it('does no network: an unreachable remote, and no git process that was started is a fetch', async () => {
    const { mine } = pair()
    sh(mine, 'git fetch -q origin')
    sh(mine, 'git remote set-url origin /nonexistent/nowhere.git')
    await withGitTrace(async started => {
      const r = await git.lastFetch(mine, 'main')
      expect(r.state).toBe('fetched')
      expect(started().length, 'control: the marker sees the git processes lastFetch starts').toBeGreaterThan(0)
      for (const call of started()) expect(call.split(' ')).not.toContain('fetch')
    })
  })
  it('a clone whose trunk is not a local branch reads a state, and does not throw (LOW-B)', async () => {
    const { mine } = pair()
    sh(mine, 'git fetch -q origin main')
    sh(mine, 'git checkout -q --detach && git branch -q -D main')
    const r = await git.lastFetch(mine, 'main')
    expect(r).toEqual({ state: 'no local trunk', fetchedAt: null, ahead: 0, behind: 0 })
  })
  it('after a fetch of another branch the file is fresh but does not name the trunk (LOW-4, proof FH)', async () => {
    const { mine, theirs } = pair()
    sh(mine, 'git fetch -q origin')
    push(theirs, 'ahead.txt') // the remote's main moves; the tracking ref in `mine` stays behind it
    push(theirs, 'o.txt', 'other')
    sh(mine, 'git fetch -q origin other')
    expect(readFileSync(join(mine, '.git', 'FETCH_HEAD'), 'utf8').trim().split('\n')).toHaveLength(1)
    const r = await git.lastFetch(mine, 'main')
    expect(r.state).toBe('the last fetch was not of the trunk')
    expect(r.behind).toBe(0) // the old reader would have read "fresh, behind 0"
    expect(r.fetchedAt).toBeNull()
  })
  it('another branch at the very commit the trunk is at does not speak for the trunk either: the line must name it', async () => {
    const { mine, theirs } = pair()
    sh(mine, 'git fetch -q origin')
    sh(theirs, 'git push -q origin HEAD:refs/heads/same-commit') // same sha as origin/main
    sh(mine, 'git fetch -q origin same-commit')
    const fh = readFileSync(join(mine, '.git', 'FETCH_HEAD'), 'utf8')
    expect(fh.split('\t')[0]).toBe(sha(mine, 'refs/remotes/origin/main')) // the sha alone would pass
    expect((await git.lastFetch(mine, 'main')).state).toBe('the last fetch was not of the trunk')
  })
  it('a fetch that found nothing new still names the trunk and reads fresh; a --dry-run leaves the age alone', async () => {
    const { mine } = pair()
    sh(mine, 'git fetch -q origin main')
    const file = join(mine, '.git', 'FETCH_HEAD')
    const old = new Date(Date.now() - 3 * 3600 * 1000)
    utimesSync(file, old, old)
    sh(mine, 'git fetch -q --dry-run origin main')
    expect(statSync(file).mtime.getTime()).toBe(old.getTime())
    expect((await git.lastFetch(mine, 'main')).fetchedAt!.getTime()).toBe(old.getTime())
    sh(mine, 'git fetch -q origin main') // nothing new
    const r = await git.lastFetch(mine, 'main')
    expect(r.state).toBe('fetched')
    expect(r.fetchedAt!.getTime()).toBeGreaterThan(old.getTime())
  })
  it('a plain `git fetch` from a clone sitting on another branch is marked not-for-merge and still counts', async () => {
    const { mine } = pair()
    sh(mine, 'git checkout -q -b elsewhere')
    sh(mine, 'git fetch -q origin')
    expect(readFileSync(join(mine, '.git', 'FETCH_HEAD'), 'utf8')).toMatch(/not-for-merge/)
    expect((await git.lastFetch(mine, 'main')).state).toBe('fetched')
  })
  it('reads a trunk named release/1.0 from "branch \'release/1.0\' of"', async () => {
    const { mine, theirs } = pair()
    sh(theirs, 'git checkout -q -b release/1.0')
    push(theirs, 'r.txt', 'release/1.0')
    sh(mine, 'git fetch -q origin release/1.0')
    sh(mine, 'git checkout -q -b release/1.0 origin/release/1.0') // the trunk is a branch of this clone
    expect(readFileSync(join(mine, '.git', 'FETCH_HEAD'), 'utf8')).toContain("branch 'release/1.0' of ")
    expect((await git.lastFetch(mine, 'release/1.0')).state).toBe('fetched')
    expect((await git.lastFetch(mine, 'main')).state).toBe('the last fetch was not of the trunk')
  })
  it('the line’s sha must equal the tracking ref: a stale file naming the trunk is not trusted', async () => {
    const { mine, theirs } = pair()
    sh(mine, 'git fetch -q origin main')
    push(theirs, 't.txt')
    sh(mine, 'git fetch -q origin main:refs/remotes/origin/main') // moves the tracking ref and rewrites FETCH_HEAD
    const fh = join(mine, '.git', 'FETCH_HEAD')
    writeFileSync(fh, readFileSync(fh, 'utf8').replace(/^[0-9a-f]{40}/, '1'.repeat(40)))
    expect((await git.lastFetch(mine, 'main')).state).toBe('the last fetch was not of the trunk')
  })
  // Final review I2: a Share moves the tracking ref to what this clone pushed, and FETCH_HEAD still names the old tip.
  // Fresh when FETCH_HEAD's sha is an ancestor of the tracking ref and the tracking ref of the local trunk.
  it('after one\'s own push (a Share) the reading is fresh, with the age of the last fetch, and nothing behind', async () => {
    const { mine } = pair()
    sh(mine, 'git fetch -q origin')
    const fetchedAt = statSync(join(mine, '.git', 'FETCH_HEAD')).mtime.getTime()
    commitFile(mine, 'mine.txt', 'm')
    sh(mine, 'git push -q -- origin refs/heads/main:refs/heads/main') // the Share's own refspec
    expect(sha(mine, 'refs/remotes/origin/main')).toBe(sha(mine))
    const r = await git.lastFetch(mine, 'main')
    expect(r).toMatchObject({ state: 'fetched', ahead: 0, behind: 0 })
    expect(r.fetchedAt!.getTime()).toBe(fetchedAt)
    commitFile(mine, 'after.txt', 'a') // a write after the Share
    expect(await git.lastFetch(mine, 'main')).toMatchObject({ state: 'fetched', ahead: 1, behind: 0 })
  })
  it('a teammate\'s push, once fetched, is behind again; a tracking ref moved past the local trunk without a FETCH_HEAD is not trusted', async () => {
    const { mine, theirs } = pair()
    sh(mine, 'git fetch -q origin')
    commitFile(mine, 'mine.txt', 'm'); sh(mine, 'git push -q origin main')
    sh(theirs, 'git pull -q --no-rebase origin main'); push(theirs, 'theirs.txt')
    sh(mine, 'git fetch -q --no-write-fetch-head origin') // the tracking ref moves to the teammate's commit; FETCH_HEAD stays
    expect((await git.lastFetch(mine, 'main')).state).toBe('the last fetch was not of the trunk')
    sh(mine, 'git fetch -q origin')
    expect(await git.lastFetch(mine, 'main')).toMatchObject({ state: 'fetched', behind: 1, ahead: 0 })
  })
})

// ── merge, the one undo, fetch (Task 5b) ──────────────────────────────────────────────────────
describe('merging and the one undo', () => {
  /** A repository whose `main` has gov.yaml and a.txt, and a branch `feat` one commit ahead that edits both
   *  gov.yaml and other.txt (so the merge changes gov.yaml, a file ratify also writes: proof N2). */
  function mergeable(name = 'repo'): { dir: string; feat: string } {
    const dir = repoAt(name)
    sh(dir, 'git config user.name Test && git config user.email test@example.org')
    commitFile(dir, 'gov.yaml', 'decisions: []\n')
    sh(dir, 'git checkout -q -b feat')
    commitFile(dir, 'gov.yaml', 'decisions: []\nop: 1\n')
    commitFile(dir, 'other.txt', 'op\n')
    const feat = sha(dir)
    sh(dir, 'git checkout -q main')
    return { dir, feat }
  }
  /** A hash of every tracked file's bytes in the working tree, and the status: "the tree is identical". */
  const treeHash = (dir: string): string => sh(dir, 'git ls-files -z | xargs -0 shasum | shasum') + sh(dir, 'git status --porcelain --untracked-files=no')
  const staged = (dir: string, file: string) => sh(dir, `git add ${file}`)

  it('mergeNoFf leaves a pending merge, and the pending test is the MERGE_HEAD file', async () => {
    const { dir, feat } = mergeable()
    const head = sha(dir)
    const r = await git.mergeNoFf(dir, feat)
    expect(r.pending).toBe(true)
    expect(existsSync(await git.gitPath(dir, 'MERGE_HEAD'))).toBe(true)
    expect(await git.mergeInProgress(dir)).toBe(true)
    expect(sha(dir)).toBe(head)
    expect(readFileSync(join(dir, 'other.txt'), 'utf8')).toBe('op\n')
  })
  it('mergeNoFf of a branch already in the trunk says so and leaves no merge file (proof 6)', async () => {
    const { dir } = mergeable()
    const r = await git.mergeNoFf(dir, 'HEAD')
    expect(r.pending).toBe(false)
    expect(r.said).toMatch(/already up to date/i)
    expect(existsSync(await git.gitPath(dir, 'MERGE_HEAD'))).toBe(false)
  })
  it('a branch called MERGE_HEAD does not make a merge pending', async () => {
    const { dir } = mergeable()
    sh(dir, 'git branch MERGE_HEAD')
    expect((await git.mergeNoFf(dir, 'HEAD')).pending).toBe(false)
  })
  it('mergeAbort after the files were written and staged returns a tree identical to the start', async () => {
    const { dir, feat } = mergeable()
    const before = treeHash(dir)
    await git.mergeNoFf(dir, feat)
    writeFileSync(join(dir, 'a.txt'), 'rewritten\n'); staged(dir, 'a.txt')
    writeFileSync(join(dir, 'gov.yaml'), 'decisions: []\nop: 1\nrow: 1\n'); staged(dir, 'gov.yaml')
    await git.mergeAbort(dir)
    expect(treeHash(dir)).toBe(before)
    expect(await git.mergeInProgress(dir)).toBe(false)
  })
  it('mergeAbort after a file was written and left unstaged keeps the edit: the tree is not the start (why step 6 stages)', async () => {
    const { dir, feat } = mergeable()
    const before = treeHash(dir)
    await git.mergeNoFf(dir, feat)
    writeFileSync(join(dir, 'a.txt'), 'rewritten\n') // unstaged
    await git.mergeAbort(dir)
    expect(treeHash(dir)).not.toBe(before)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('rewritten\n')
  })
  it('N2.A: a file the merge also changed, overwritten with HEAD’s bytes and left unstaged, makes the abort refuse "not uptodate" and leaves MM', async () => {
    const { dir, feat } = mergeable()
    await git.mergeNoFf(dir, feat)
    writeFileSync(join(dir, 'gov.yaml'), 'decisions: []\n') // HEAD's bytes, unstaged
    await expect(git.mergeAbort(dir)).rejects.toThrow(/not uptodate/)
    await expect(git.mergeAbort(dir)).rejects.toMatchObject({ name: 'GitExit', code: 128 }) // git's own exit status, kept
    expect(sh(dir, 'git status --porcelain --untracked-files=no')).toMatch(/^MM gov\.yaml/m)
    expect(await git.mergeInProgress(dir)).toBe(true)
  })
  it('N2.B and N2.C: with the step-5 bytes written back the same abort succeeds, staged or not', async () => {
    for (const stage of [false, true]) {
      const { dir, feat } = mergeable(`n2-${stage}`)
      const before = treeHash(dir)
      await git.mergeNoFf(dir, feat)
      const step5 = readFileSync(join(dir, 'gov.yaml'), 'utf8')
      writeFileSync(join(dir, 'gov.yaml'), 'decisions: []\nop: 1\nrow: 1\n'); if (stage) staged(dir, 'gov.yaml') // the failed write
      writeFileSync(join(dir, 'gov.yaml'), step5)
      if (stage) staged(dir, 'gov.yaml')
      await git.mergeAbort(dir)
      expect(treeHash(dir), `stage=${stage}`).toBe(before)
      expect(await git.mergeInProgress(dir)).toBe(false)
    }
  })
  it('mergeAbort with no merge in progress throws git’s sentence', async () => {
    const { dir } = mergeable()
    await expect(git.mergeAbort(dir)).rejects.toThrow(/no merge to abort/i)
  })
  it('mergeFfOnly moves a branch forward and refuses a diverged history', async () => {
    const { dir, feat } = mergeable()
    await git.mergeFfOnly(dir, feat)
    expect(sha(dir)).toBe(feat)
    const d = mergeable('other').dir
    commitFile(d, 'z.txt', 'z\n') // main moves: feat has diverged
    const feat2 = sha(d, 'feat')
    await expect(git.mergeFfOnly(d, feat2)).rejects.toThrow(/fast-forward|not possible|diverg/i)
  })
  it('mergeTree reports conflicting paths and the tree id without touching the working tree, also on exit 1', async () => {
    const { dir } = mergeable()
    commitFile(dir, 'gov.yaml', 'decisions: []\nmain: 1\n') // main edits the same line region as feat
    commitFile(dir, 'clean.txt', 'c\n')
    const before = treeHash(dir)
    const headBefore = sha(dir)
    const conflicted = await git.mergeTree(dir, 'main', 'feat')
    expect(conflicted.conflicts).toEqual(['gov.yaml'])
    expect(conflicted.tree).toMatch(/^[0-9a-f]{40}$/)
    expect(treeHash(dir)).toBe(before)
    expect(sha(dir)).toBe(headBefore)
    expect(await git.mergeInProgress(dir)).toBe(false)
    const dir2 = mergeable('other').dir
    commitFile(dir2, 'clean.txt', 'c\n')
    const clean = await git.mergeTree(dir2, 'main', 'feat')
    expect(clean.conflicts).toEqual([])
    expect(sh(dir2, `git cat-file -t ${clean.tree}`).trim()).toBe('tree')
  })
})

describe('fetchRemote', () => {
  it('fetches from a local bare remote and moves the remote-tracking ref', async () => {
    const remote = join(root, 'remote.git')
    sh(root, `git init -q --bare -b main ${remote}`)
    const a = repoAt('a')
    sh(a, `git remote add origin ${remote} && git push -q origin main`)
    const b = join(root, 'b')
    sh(root, `git clone -q ${remote} ${b}`)
    commitFile(a, 'new.txt', 'n\n')
    sh(a, 'git push -q origin main')
    expect(await git.resolveRev(b, 'refs/remotes/origin/main')).not.toBe(sha(a))
    await git.fetchRemote(b, 'origin')
    expect(await git.resolveRev(b, 'refs/remotes/origin/main')).toBe(sha(a))
    expect((await git.lastFetch(b, 'main')).behind).toBe(1)
  })
  it('refuses a URL or a refspec before git starts', async () => {
    const a = repoAt('a')
    await withGitTrace(async started => {
      await expect(git.fetchRemote(a, 'https://example.org/x.git')).rejects.toThrow(/git guardrail/)
      await expect(git.fetchRemote(a, '-x')).rejects.toThrow(/git guardrail/)
      expect(started()).toEqual([])
    })
  })
  it('refuses a bare word that names a directory and not a configured remote, before any fetch starts', async () => {
    // `git fetch wdir` reads a word with no remote.wdir.url as a path, and fetches from the repository there (Task 5b).
    // The platform fetches origin only, and only when origin is configured: a directory called origin is not one.
    const a = repoAt('a')
    for (const dir of ['wdir', 'origin']) {
      sh(a, `git init -q -b main ${dir}`)
      commitFile(join(a, dir), 'inside.txt', 'i\n')
    }
    await withGitTrace(async started => {
      await expect(git.fetchRemote(a, 'wdir')).rejects.toThrow('"wdir" is not a remote this platform fetches: it fetches origin only, so nothing was fetched.')
      await expect(git.fetchRemote(a, 'origin')).rejects.toThrow('"origin" is not a remote of this repository (it has no remote.origin.url), so nothing was fetched.')
      expect(started().filter(line => line.startsWith('fetch'))).toEqual([])
    })
    expect(existsSync(join(a, '.git', 'FETCH_HEAD'))).toBe(false)
  })
})

describe('commitMerge', () => {
  function pending() {
    const dir = repoAt()
    sh(dir, 'git config user.name Test && git config user.email test@example.org')
    sh(dir, 'git checkout -q -b feat')
    commitFile(dir, 'data/x.yaml', 'x: 2\n')
    commitFile(dir, 'extra.txt', 'e\n')
    const feat = sha(dir)
    sh(dir, 'git checkout -q main')
    const trunk = sha(dir)
    return { dir, feat, trunk }
  }
  it('commits the staged set with the message and trailers; the merge has two parents', async () => {
    const { dir, feat, trunk } = pending()
    await git.mergeNoFf(dir, feat)
    writeFileSync(join(dir, 'a.txt'), 'ledger\n'); sh(dir, 'git add a.txt')
    const made = await git.commitMerge(dir, 'ratify: p-1', ['data/x.yaml', 'extra.txt', 'a.txt'], { change: 'c-1' })
    expect(made).toBe(sha(dir))
    expect(sh(dir, 'git rev-list --parents -1 HEAD').trim().split(' ')).toEqual([made, trunk, feat])
    const body = sh(dir, 'git log -1 --format=%B')
    expect(body).toMatch(/^ratify: p-1\n/)
    expect(body).toMatch(/Org-Change: c-1/)
    expect(await git.mergeInProgress(dir)).toBe(false)
  })
  it('refuses a staged path outside allowedPaths, and the merge stays pending for the abort', async () => {
    const { dir, feat } = pending()
    await git.mergeNoFf(dir, feat)
    await expect(git.commitMerge(dir, 'm', ['data/x.yaml'])).rejects.toThrow(/extra\.txt/)
    expect(await git.mergeInProgress(dir)).toBe(true)
    await git.mergeAbort(dir)
    expect(sh(dir, 'git status --porcelain --untracked-files=no')).toBe('')
  })
  it('refuses when no merge is pending', async () => {
    const { dir } = pending()
    await expect(git.commitMerge(dir, 'm', ['a.txt'])).rejects.toThrow(/no merge/)
  })
  it('a hook that refuses the commit throws and leaves the merge pending with the files staged', async () => {
    const { dir, feat } = pending()
    writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "no thanks" >&2\nexit 1\n', { mode: 0o755 })
    await git.mergeNoFf(dir, feat)
    await expect(git.commitMerge(dir, 'm', ['data/x.yaml', 'extra.txt'])).rejects.toThrow(/no thanks/)
    expect(await git.mergeInProgress(dir)).toBe(true)
    await git.mergeAbort(dir)
  })
  it('a rename out of a path not on the list is refused: the deleted old name is listed too', async () => {
    const dir = repoAt()
    sh(dir, 'git config user.name Test && git config user.email test@example.org')
    commitFile(dir, 'DECISIONS.md', 'a long enough decisions log\nline two\nline three\n')
    sh(dir, 'git checkout -q -b feat && git mv DECISIONS.md data/moved.md && git commit -qm mv')
    const feat = sha(dir)
    sh(dir, 'git checkout -q main')
    await git.mergeNoFf(dir, feat)
    expect(await git.stagedNames(dir)).toEqual(expect.arrayContaining(['DECISIONS.md', 'data/moved.md']))
    await expect(git.commitMerge(dir, 'm', ['data/moved.md'])).rejects.toThrow(/DECISIONS\.md/)
    expect(await git.mergeInProgress(dir)).toBe(true)
    await git.mergeAbort(dir)
  })
  it('merge.autoStash=true in the configuration makes no autostash, for either merge (git says "Created autostash" when it does)', async () => {
    const { dir, feat } = pending()
    sh(dir, 'git config merge.autoStash true')
    writeFileSync(join(dir, 'a.txt'), 'dirty\n') // a tracked file the merge does not touch, edited
    const hasStash = () => { try { sh(dir, 'git rev-parse -q --verify refs/stash'); return true } catch { return false } }
    const merged = await git.mergeNoFf(dir, feat)
    expect(merged.said).not.toMatch(/autostash/i)
    expect(hasStash()).toBe(false)
    await git.mergeAbort(dir)
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('dirty\n')
    expect(await git.mergeFfOnly(dir, feat)).not.toMatch(/autostash/i)
    expect(hasStash()).toBe(false)
  })
  it('commitDataPaths still refuses anything outside data/', async () => {
    const { dir } = pending()
    await expect(git.commitDataPaths(dir, ['extra.txt'], 'm')).rejects.toThrow(/outside data\//)
    await expect(git.commitDataPaths(dir, ['DECISIONS.md'], 'm')).rejects.toThrow(/outside data\//)
  })
})

describe('stageMergeFiles and hiddenMergePaths: ratify’s three files, DECISIONS.md included, and nothing else (Task 11a)', () => {
  /** A pending merge whose branch edits data/x.yaml and DECISIONS.md. */
  function pendingMerge() {
    const dir = repoAt()
    sh(dir, 'git config user.name Test && git config user.email test@example.org')
    commitFile(dir, 'DECISIONS.md', '# Decisions\n')
    commitFile(dir, 'README.md', 'readme\n')
    sh(dir, 'git checkout -q -b feat')
    commitFile(dir, 'data/x.yaml', 'x: 2\n')
    const feat = sha(dir)
    sh(dir, 'git checkout -q main')
    return { dir, feat }
  }
  const ALLOWED_HERE = ['data/x.yaml', 'data/proposals.yaml', 'data/governance.yaml', 'DECISIONS.md']
  const stagedNow = (dir: string) => sh(dir, 'git diff --cached --name-only').trim().split('\n').filter(Boolean)

  it('stages DECISIONS.md and a data file by name while a merge is pending', async () => {
    const { dir, feat } = pendingMerge()
    await git.mergeNoFf(dir, feat)
    writeFileSync(join(dir, 'DECISIONS.md'), '# Decisions\n\n## entry\n')
    writeFileSync(join(dir, 'data', 'x.yaml'), 'x: 3\n')
    await git.stageMergeFiles(dir, ['DECISIONS.md'], ALLOWED_HERE)
    await git.stageMergeFiles(dir, ['data/x.yaml'], ALLOWED_HERE)
    expect(stagedNow(dir).sort()).toEqual(['DECISIONS.md', 'data/x.yaml'])
    expect(sh(dir, 'git status --porcelain --untracked-files=no')).not.toMatch(/^.M/m) // nothing left unstaged
    await git.mergeAbort(dir)
  })
  it('refuses a path outside data/ and DECISIONS.md, even when the caller allows it, before git runs', async () => {
    const { dir, feat } = pendingMerge()
    await git.mergeNoFf(dir, feat)
    writeFileSync(join(dir, 'README.md'), 'changed\n')
    for (const bad of ['README.md', '../x', 'data/../README.md', 'data/../DECISIONS.md', '/etc/passwd', '-f', './DECISIONS.md']) {
      await withGitTrace(async started => {
        await expect(git.stageMergeFiles(dir, [bad], [...ALLOWED_HERE, bad]), bad).rejects.toThrow(/guardrail/)
        expect(started(), bad).toEqual([])
      })
    }
    expect(stagedNow(dir)).toEqual(['data/x.yaml']) // what the merge staged, and nothing more
    await git.mergeAbort(dir)
  })
  it('refuses a path that is not in allowedPaths', async () => {
    const { dir, feat } = pendingMerge()
    await git.mergeNoFf(dir, feat)
    writeFileSync(join(dir, 'DECISIONS.md'), 'changed\n')
    await expect(git.stageMergeFiles(dir, ['DECISIONS.md'], ['data/x.yaml'])).rejects.toThrow(/not on the list/)
    expect(stagedNow(dir)).toEqual(['data/x.yaml'])
    await git.mergeAbort(dir)
  })
  it('refuses with no merge in progress, and with no path', async () => {
    const { dir } = pendingMerge()
    writeFileSync(join(dir, 'DECISIONS.md'), 'changed\n')
    await expect(git.stageMergeFiles(dir, ['DECISIONS.md'], ALLOWED_HERE)).rejects.toThrow(/no merge in progress/)
    expect(stagedNow(dir)).toEqual([])
    sh(dir, 'git branch MERGE_HEAD') // a branch of that name is not a merge (LOW-2)
    await expect(git.stageMergeFiles(dir, ['DECISIONS.md'], ALLOWED_HERE)).rejects.toThrow(/no merge in progress/)
    await expect(git.stageMergeFiles(dir, [], ALLOWED_HERE)).rejects.toThrow(/no paths/)
  })
  it('hiddenMergePaths reads assume-unchanged and skip-worktree on DECISIONS.md and data files, and refuses any other path', async () => {
    const { dir } = pendingMerge()
    expect(await git.hiddenMergePaths(dir, ['DECISIONS.md', 'data/x.yaml'])).toEqual([])
    sh(dir, 'git update-index --assume-unchanged DECISIONS.md')
    sh(dir, 'git update-index --skip-worktree data/x.yaml')
    expect(await git.hiddenMergePaths(dir, ['DECISIONS.md', 'data/x.yaml'])).toEqual([
      { path: 'DECISIONS.md', flag: 'assume-unchanged' }, { path: 'data/x.yaml', flag: 'skip-worktree' },
    ])
    for (const bad of ['README.md', '../x', 'data/../README.md']) await expect(git.hiddenMergePaths(dir, [bad]), bad).rejects.toThrow(/guardrail/)
  })
  it('the data-only functions are as strict as before: DECISIONS.md is refused by each', async () => {
    const { dir } = pendingMerge()
    await expect(git.restageDataPaths(dir, ['DECISIONS.md'])).rejects.toThrow(/outside data\//)
    await expect(git.hiddenDataPaths(dir, ['DECISIONS.md'])).rejects.toThrow(/outside data\//)
    await expect(git.uncommittedDataPaths(dir, ['DECISIONS.md'])).rejects.toThrow(/outside data\//)
  })
})

describe('unmergedPaths: the index entries a merge left unmerged (Task 11a fix round, spec §3.8 step 7)', () => {
  it('names a conflicted file during a merge, and nothing on a clean tree or a clean pending merge', async () => {
    const dir = repoAt()
    sh(dir, 'git config user.name Test && git config user.email test@example.org')
    expect(await git.unmergedPaths(dir)).toEqual([])
    sh(dir, 'git checkout -q -b feat')
    commitFile(dir, 'data/x.yaml', 'x: feat\n')
    commitFile(dir, 'b.txt', 'b\n')
    const feat = sha(dir)
    sh(dir, 'git checkout -q main')
    commitFile(dir, 'data/x.yaml', 'x: main\n')
    await expect(git.mergeNoFf(dir, feat)).rejects.toThrow(/conflict/i)
    expect(await git.unmergedPaths(dir)).toEqual(['data/x.yaml'])
    await git.mergeAbort(dir)
    const clean = repoAt('clean')
    sh(clean, 'git config user.name Test && git config user.email test@example.org')
    sh(clean, 'git checkout -q -b feat')
    const f2 = commitFile(clean, 'b.txt', 'b\n')
    sh(clean, 'git checkout -q main')
    await git.mergeNoFf(clean, f2)
    expect(await git.unmergedPaths(clean)).toEqual([])
    await git.mergeAbort(clean)
  })
})
