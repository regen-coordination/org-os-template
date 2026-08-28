import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { repoStatus, commitDataPaths } from '../server/git.ts'

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
    await commitDataPaths(repo, ['data/members.yaml'], 'admin(members): update luiz')
    const log = execSync('git log -1 --pretty=%s', { cwd: repo }).toString().trim()
    expect(log).toBe('admin(members): update luiz')
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
