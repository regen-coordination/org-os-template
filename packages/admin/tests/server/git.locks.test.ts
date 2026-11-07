import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// Whatever the shell that started the tests says, this file starts with git's optional locks on: the setting under
// test must come from server/git.ts itself. (vi.hoisted runs before the imports below.)
vi.hoisted(() => { delete process.env.GIT_OPTIONAL_LOCKS })

import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { commitDataPaths, commitMerge, mergeNoFf, repoStatus, stageMergeFiles, trackedChanges, uncommittedDataPaths } from '../../server/git.ts'

// A write takes git's index lock and is refused when the lock is there ("Unable to create …/index.lock: File exists").
// `git status` refreshes the index and, unless optional locks are off, takes that lock while it does. The server's reads
// (GET /api/status, the actor and changes reads) run status outside the write lock, so a write could meet one mid-way
// (0.6 P2 Task 18c, about 1 e2e run in 20). Every repository here is a fresh fixture under the OS temp dir.
const ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'admin-test', GIT_AUTHOR_EMAIL: 'admin-test@local', GIT_COMMITTER_NAME: 'admin-test', GIT_COMMITTER_EMAIL: 'admin-test@local',
}
const READERS = 4
const WRITES = 40
const MERGES = 15

let repo: string
beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v)
  repo = makeFixtureRepo()
})
afterEach(() => { removeFixtureRepo(repo); vi.unstubAllEnvs() })

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim()
/** The test's own clean-up after a refused write, which may itself meet the lock on the old code. */
const tidy = async (...args: string[]) => {
  for (let tries = 0; tries < 20; tries++) {
    try { git(...args); return } catch { await new Promise(r => setTimeout(r, 25)) }
  }
}

/** Run `writes` while `READERS` loops call the server's status reads as fast as they can; answer each failure in words. */
async function underReads(writes: () => Promise<void>): Promise<{ writeErrors: string[]; readErrors: string[]; reads: number }> {
  let done = false
  let reads = 0
  const readErrors: string[] = []
  const reader = async () => {
    while (!done) {
      try {
        await trackedChanges(repo)
        await repoStatus(repo)
        await uncommittedDataPaths(repo, ['data/projects.yaml'])
        reads += 3
      } catch (err) { readErrors.push(err instanceof Error ? err.message : String(err)) }
    }
  }
  const loops = Array.from({ length: READERS }, reader)
  const writeErrors: string[] = []
  try { await writes() } catch (err) { writeErrors.push(err instanceof Error ? err.message : String(err)) } finally { done = true }
  await Promise.all(loops)
  return { writeErrors, readErrors, reads }
}

describe("the server's reads never take git's index lock", () => {
  it('a run of saves (add + commit) is never refused while status is read alongside', async () => {
    const failed: string[] = []
    const { readErrors, reads } = await underReads(async () => {
      for (let i = 0; i < WRITES; i++) {
        writeFileSync(join(repo, 'data', 'projects.yaml'), `schema_version: "2.0"\nprojects:\n  - id: "proj-${i}"\n    title: "Save ${i}"\n`)
        try { await commitDataPaths(repo, ['data/projects.yaml'], `save ${i}`) } catch (err) {
          failed.push(`save ${i}: ${err instanceof Error ? err.message : String(err)}`)
          await tidy('add', '--', 'data/projects.yaml') // leave the index as a later save expects
        }
      }
    })
    expect(reads).toBeGreaterThan(WRITES)
    expect(failed, failed.join('\n')).toEqual([])
    expect(readErrors).toEqual([])
    expect(Number(git('rev-list', '--count', 'HEAD'))).toBe(1 + WRITES)
  })

  it('a run of merges (merge --no-commit, add, commit) is never refused while status is read alongside', async () => {
    // Every side branch first, with nobody reading: each changes a file of its own under data/.
    for (let i = 0; i < MERGES; i++) {
      git('checkout', '-q', '-b', `side-${i}`, 'main')
      writeFileSync(join(repo, 'data', `side-${i}.yaml`), `side: ${i}\n`)
      git('add', '--', `data/side-${i}.yaml`)
      git('commit', '-qm', `side ${i}`)
    }
    git('checkout', '-q', 'main')
    const failed: string[] = []
    const { readErrors, reads } = await underReads(async () => {
      for (let i = 0; i < MERGES; i++) {
        const file = `data/side-${i}.yaml`
        try {
          const started = await mergeNoFf(repo, `side-${i}`)
          if (!started.pending) throw new Error(`no merge pending after merging side-${i}: ${started.said}`)
          await stageMergeFiles(repo, [file], [file])
          await commitMerge(repo, `merge side ${i}`, [file])
        } catch (err) {
          failed.push(`merge ${i}: ${err instanceof Error ? err.message : String(err)}`)
          if (existsSync(join(repo, '.git', 'MERGE_HEAD'))) await tidy('merge', '--abort') // the one undo, so the next merge starts clean
        }
      }
    })
    expect(reads).toBeGreaterThan(MERGES)
    expect(failed, failed.join('\n')).toEqual([])
    expect(readErrors).toEqual([])
    expect(Number(git('rev-list', '--count', '--merges', 'HEAD'))).toBe(MERGES)
  })
})
