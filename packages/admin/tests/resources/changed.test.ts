import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { parseBlame, entityChanges, lastCommit } from '../../server/resources/changed.ts'

let repo: string
beforeEach(() => { repo = makeFixtureRepo() })
afterEach(() => removeFixtureRepo(repo))

const commitAs = (name: string, msg: string) =>
  execSync(`git -c user.name="${name}" -c user.email=x@y commit -qam "${msg}"`, { cwd: repo })

describe('parseBlame', () => {
  it('gives every line its commit, author and time, even when the header repeats without metadata', () => {
    const sha = 'a'.repeat(40)
    const porcelain = [
      `${sha} 1 1 2`, 'author Ana', 'author-time 1700000000', 'summary x', '\tline one',
      `${sha} 2 2`, '\tline two', '',
    ].join('\n')
    expect(parseBlame(porcelain)).toEqual([
      { sha, author: 'Ana', time: 1700000000 }, { sha, author: 'Ana', time: 1700000000 },
    ])
  })
})

describe('entityChanges', () => {
  it('names, for each entity, who last changed one of its lines', async () => {
    const path = join(repo, 'data', 'members.yaml')
    writeFileSync(path, readFileSync(path, 'utf8').replace('"Contributor"', '"Steward"'))
    commitAs('Ana Silva', 'promote ana')
    const changes = await entityChanges(repo, 'members')
    expect(changes.get('ana')?.by).toBe('Ana Silva')
    expect(changes.get('steward-a')?.by).toBe('admin-test')
    expect(changes.get('steward-a')?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('says "not committed yet" for an entity with uncommitted lines', async () => {
    const path = join(repo, 'data', 'members.yaml')
    writeFileSync(path, readFileSync(path, 'utf8').replace('"Core Steward"', '"Lead"'))
    expect((await entityChanges(repo, 'members')).get('steward-a')?.by).toBe('not committed yet')
  })

  it('reads again after the same bytes are committed, not only after an edit', async () => {
    const path = join(repo, 'data', 'members.yaml')
    writeFileSync(path, readFileSync(path, 'utf8').replace('"Core Steward"', '"Lead"'))
    expect((await entityChanges(repo, 'members')).get('steward-a')?.by).toBe('not committed yet')
    commitAs('Ana Silva', 'lead steward-a')
    expect((await entityChanges(repo, 'members')).get('steward-a')?.by).toBe('Ana Silva')
  })

  it('answers an empty map for a registry that is not there', async () => {
    expect((await entityChanges(repo, 'relationships')).size).toBe(0)
  })
})

describe('lastCommit', () => {
  it('reads the last commit of a path, or null for an untracked one', async () => {
    expect(await lastCommit(repo, 'data/projects.yaml')).toMatchObject({ by: 'admin-test' })
    writeFileSync(join(repo, 'new.md'), 'x')
    expect(await lastCommit(repo, 'new.md')).toBeNull()
  })
})
