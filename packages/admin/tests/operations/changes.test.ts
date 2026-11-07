import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { snapshot, changedBetween, outside } from '../../server/operations/changes.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

describe('snapshots', () => {
  it('see new files, edits to clean files, and further edits to already-dirty files', async () => {
    appendFileSync(join(repo, 'data', 'ideas.yaml'), '# dirty before\n')
    const before = await snapshot(repo)
    expect([...before.files.keys()]).toEqual(['data/ideas.yaml'])
    mkdirSync(join(repo, 'memory', 'reports'), { recursive: true })
    writeFileSync(join(repo, 'memory', 'reports', 'drift.md'), 'x')
    appendFileSync(join(repo, 'data', 'members.yaml'), '# edited\n')
    appendFileSync(join(repo, 'data', 'ideas.yaml'), '# edited again\n')
    expect(changedBetween(before, await snapshot(repo))).toEqual(['data/ideas.yaml', 'data/members.yaml', 'memory/reports/drift.md'])
  })

  it('see nothing when nothing changed', async () => {
    const a = await snapshot(repo)
    expect(changedBetween(a, await snapshot(repo))).toEqual([])
  })

  it('see a commit made by a job, even when the committed file is clean at both ends', async () => {
    const before = await snapshot(repo)
    appendFileSync(join(repo, 'data', 'members.yaml'), '# will be committed\n')
    execSync('git commit -qam "a job commits"', { cwd: repo, stdio: 'pipe' })
    const changed = changedBetween(before, await snapshot(repo))
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatch(/^HEAD moved [0-9a-f]{7} → [0-9a-f]{7}$/)
    expect(outside(changed, ['.'])).toEqual(changed)
    expect(outside(changed, ['memory/'])).toEqual(changed)
  })
})

describe('outside', () => {
  it('keeps the paths no declared write covers; "." covers everything', () => {
    const changed = ['memory/crew/a.md', 'memory/reports/x.md', 'data/kms-cursors.json', 'stray.md']
    expect(outside(changed, ['memory/crew/'])).toEqual(['memory/reports/x.md', 'data/kms-cursors.json', 'stray.md'])
    expect(outside(changed, ['memory/', 'data/kms-cursors.json'])).toEqual(['stray.md'])
    expect(outside(changed, ['.'])).toEqual([])
    expect(outside(changed, [])).toEqual(changed)
  })
})
