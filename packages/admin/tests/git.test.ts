import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { repoStatus, commitDataPaths, configuredEmail } from '../server/git.ts'
import { withFailingCommit } from './git-shim.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

describe('repoStatus', () => {
  it('reports branch and cleanliness', async () => {
    expect(await repoStatus(repo)).toEqual({ branch: 'main', dirty: false })
    writeFileSync(join(repo, 'data', 'members.yaml'), 'schema_version: "2.0"\nmembers: []\n')
    expect((await repoStatus(repo)).dirty).toBe(true)
  })
})

describe('commitDataPaths', () => {
  it('commits only the given data files with the structured message', async () => {
    writeFileSync(join(repo, 'data', 'members.yaml'), 'schema_version: "2.0"\nmembers: []\n')
    writeFileSync(join(repo, 'untracked.txt'), 'left alone')
    await commitDataPaths(repo, ['data/members.yaml'], 'admin(members): update steward-a')
    const log = execSync('git log -1 --pretty=%s', { cwd: repo }).toString().trim()
    expect(log).toBe('admin(members): update steward-a')
    const status = execSync('git status --porcelain', { cwd: repo }).toString()
    expect(status).toContain('untracked.txt') // untouched
    expect(status).not.toContain('members.yaml')
  })
  it('refuses paths outside data/', async () => {
    await expect(commitDataPaths(repo, ['federation.yaml'], 'x')).rejects.toThrowError(/outside data\//i)
    await expect(commitDataPaths(repo, ['data/../federation.yaml'], 'x')).rejects.toThrowError(/outside data\//i)
    await expect(commitDataPaths(repo, ['/etc/passwd'], 'x')).rejects.toThrowError(/outside data\//i)
  })
})

describe('commitDataPaths: the sha and the trailers', () => {
  const edit = () => writeFileSync(join(repo, 'data', 'members.yaml'), 'schema_version: "2.0"\nmembers: []\n')
  const read = (command: string) => execSync(command, { cwd: repo }).toString()

  it('answers the full sha of the commit it made', async () => {
    edit()
    const sha = await commitDataPaths(repo, ['data/members.yaml'], 'admin(members): update steward-a')
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
    expect(sha).toBe(read('git rev-parse HEAD').trim())
  })
  it('writes the trailers it is given, and git reads them back', async () => {
    edit()
    await commitDataPaths(repo, ['data/members.yaml'], 'admin(members): update steward-a', { actor: 'unknown <admin-test@local>', rule: 'solo/direct' })
    expect(read('git log -1 --pretty=%s').trim()).toBe('admin(members): update steward-a')
    expect(execSync('git interpret-trailers --parse', { input: read('git log -1 --pretty=%B') }).toString())
      .toBe('Org-Actor: unknown <admin-test@local>\nOrg-Rule: solo/direct\n')
  })
  it('a hook that refuses without a word is still a refusal, not the old sha', async () => {
    // simple-git counts a non-zero exit with nothing on stderr as success; the writes must not.
    edit()
    const head = read('git rev-parse HEAD').trim()
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    await expect(commitDataPaths(repo, ['data/members.yaml'], 'admin(members): update steward-a')).rejects.toThrowError(/exited with code 1/)
    expect(read('git rev-parse HEAD').trim()).toBe(head)
  })
  it('a commit that landed is answered with its sha even when HEAD cannot be read afterwards', async () => {
    edit()
    writeFileSync(join(repo, '.git', 'hooks', 'post-commit'), '#!/bin/sh\ngit symbolic-ref HEAD refs/heads/nowhere\n', { mode: 0o755 })
    const sha = await commitDataPaths(repo, ['data/members.yaml'], 'admin(members): update steward-a')
    execSync('git symbolic-ref HEAD refs/heads/main', { cwd: repo })
    expect(sha).toBe(read('git rev-parse main').trim())
    expect(read('git log -1 --pretty=%s').trim()).toBe('admin(members): update steward-a')
  })
  it('a commit git says failed after the ref update (exit 128) is landed: its sha, never a throw (F-1)', async () => {
    edit()
    const before = read('git rev-parse HEAD').trim()
    const sha = await withFailingCommit('after-landing', () =>
      commitDataPaths(repo, ['data/members.yaml'], 'admin(members): update steward-a', { actor: 'steward-a', change: 'chg_f1', rule: 'solo/direct' }))
    expect(sha).toBe(read('git rev-parse HEAD').trim())
    expect(sha).not.toBe(before)
    expect(read('git log -1 --pretty=%s').trim()).toBe('admin(members): update steward-a')
  })
  it('without an Org-Change trailer, the landed commit is known by its exact message', async () => {
    edit()
    const sha = await withFailingCommit('after-landing', () => commitDataPaths(repo, ['data/members.yaml'], 'admin(members): update steward-a'))
    expect(sha).toBe(read('git rev-parse HEAD').trim())
  })
  it('HEAD moved by a commit that is not this one is still a failure', async () => {
    edit()
    await expect(withFailingCommit('someone-else', () =>
      commitDataPaths(repo, ['data/members.yaml'], 'admin(members): update steward-a', { change: 'chg_f1' }))).rejects.toThrow(/unable to write new index file/)
    await expect(withFailingCommit('someone-else', () =>
      commitDataPaths(repo, ['data/members.yaml'], 'admin(members): update steward-a'))).rejects.toThrow(/unable to write new index file/)
    expect(read('git log -1 --pretty=%s').trim()).toBe("someone else's commit")
  })
  it('without trailers, the message is exactly the one given', async () => {
    edit()
    await commitDataPaths(repo, ['data/members.yaml'], 'admin(members): update steward-a')
    expect(read('git log -1 --pretty=%B').trim()).toBe('admin(members): update steward-a')
  })
})

describe('configuredEmail', () => {
  it('reads git config user.email', async () => expect(await configuredEmail(repo)).toBe('admin-test@local'))
  it('is null when it is set empty', async () => {
    execSync('git config user.email ""', { cwd: repo })
    expect(await configuredEmail(repo)).toBeNull()
  })
})
