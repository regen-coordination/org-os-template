import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'

describe('makeFixtureRepo', () => {
  it('creates a committed git repo with seeded registries', () => {
    const dir = makeFixtureRepo()
    try {
      expect(existsSync(join(dir, 'data', 'members.yaml'))).toBe(true)
      const status = execSync('git status --porcelain', { cwd: dir }).toString()
      expect(status.trim()).toBe('')
      const members = readFileSync(join(dir, 'data', 'members.yaml'), 'utf8')
      expect(members).toContain('# Members Registry')
    } finally {
      removeFixtureRepo(dir)
    }
  })
})
