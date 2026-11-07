import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { resolveRev } from '../server/git.ts'

// Final review I6: the suite inherited the caller's GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE (a hook exports the first
// and the last), and every git call of a test, its `cwd` notwithstanding, read the caller's repository; it also read the
// caller's global and system git configuration. tests/setup.ts removes the six variables that point git at a repository
// and names no configuration file. Run this file with GIT_DIR exported to see the first half fail on the old setup.
const POINTERS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('the suite\'s git environment (tests/setup.ts)', () => {
  it('carries no variable that points git at another repository', () => {
    for (const key of POINTERS) expect(process.env[key], key).toBeUndefined()
  })
  it('reads no global or system configuration', () => {
    expect(process.env.GIT_CONFIG_GLOBAL).toBe('/dev/null')
    expect(process.env.GIT_CONFIG_SYSTEM).toBe('/dev/null')
  })
  it('a git command in a throwaway repository reads that repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'setup-env-'))
    dirs.push(dir)
    execSync('git init -q -b main && git config user.email ana@example.test && git config user.name ana', { cwd: dir, stdio: 'pipe' })
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    execSync('git add a.txt && git commit -qm a', { cwd: dir, stdio: 'pipe' })
    const own = execSync('git rev-parse HEAD', { cwd: dir, stdio: 'pipe' }).toString().trim()
    expect(await resolveRev(dir, 'HEAD')).toBe(own)
    // its own .git, not one a variable named: the commit above went there
    expect(execSync('git rev-parse --absolute-git-dir', { cwd: dir, stdio: 'pipe' }).toString().trim()).toBe(join(realpathSync(dir), '.git'))
  })
})

// Ruling R-10: amounts and dates are drawn in one locale and one zone whatever the host's (vitest.config.ts sets them
// before the workers start). Run the suite with LANG=pt_BR.UTF-8 LC_ALL=pt_BR.UTF-8 and these still hold.
describe('the suite\'s locale and time zone (vitest.config.ts)', () => {
  it('Intl defaults to en-US inside the worker, not the host\'s locale', () => {
    expect(new Intl.NumberFormat().resolvedOptions().locale).toBe('en-US')
    expect(new Intl.NumberFormat().format(1271.5)).toBe('1,271.5')
  })
  it('the local time zone is UTC', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC')
    expect(new Date('2026-10-17T00:30:00Z').getDate()).toBe(17)
  })
})
