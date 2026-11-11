// DAO-OS L7 (spec §5.5): scripts/check-shelf.mts reads a shelf the way the Hub serves it and fails on any problem.
// The dao-os repository runs it from its own directory with the framework's tsx (`npm --prefix
// "$ORG_OS_FRAMEWORK/packages/admin" run check:shelf -- shelf`), so that invocation is tested from a directory that is
// not this package. Shelves are copied into temporary directories before any edit.
import { describe, it, expect, afterEach } from 'vitest'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURE = join(ADMIN, 'tests', 'library', 'fixtures', 'test-shelf')
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const temp = (): string => { const d = mkdtempSync(join(tmpdir(), 'check-shelf-')); dirs.push(d); return d }

const check = (dir: string, cwd = ADMIN) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-shelf.mts', dir], { cwd, encoding: 'utf8' })

describe('check-shelf', () => {
  it('passes the test shelf: exit 0', () => {
    const run = check(FIXTURE)
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(run.stdout).toBe(`${FIXTURE}: 4 entries, no problems.\n`)
  })

  it('fails a copy with one bad entry: exit 1, that entry\'s problem on a line of its own', () => {
    const dir = join(temp(), 'shelf')
    cpSync(FIXTURE, dir, { recursive: true })
    const file = join(dir, 'template', 'test-council', 'entry.yaml')
    writeFileSync(file, readFileSync(file, 'utf8').replace('salt: "1"', 'salt: "${config.not_in_config}"'))
    const run = check(dir)
    expect(run.status).toBe(1)
    expect(run.stdout).toBe('template:test-council: "${config.not_in_config}" names no property of config.\n')
  })

  it('reports an id the framework\'s shelf already serves', () => {
    const dir = join(temp(), 'shelf')
    cpSync(FIXTURE, dir, { recursive: true })
    writeFileSync(join(dir, 'shelf.yaml'), 'name: test-shelf\nentries: [board:test-desk, system:link]\n')
    const run = check(dir)
    expect(run.status).toBe(1)
    expect(run.stdout).toMatch(/system:link/)
  })

  it('fails a directory that is no shelf, in words', () => {
    const run = check(join(temp(), 'nope'))
    expect(run.status).toBe(1)
    expect(run.stdout).toMatch(/no such directory/)
  })

  it('runs from another repository with the framework\'s tsx, a relative shelf path read from where it was run', () => {
    const other = temp()
    cpSync(FIXTURE, join(other, 'shelf'), { recursive: true })
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const run = spawnSync(npm, ['--prefix', ADMIN, 'run', '--silent', 'check:shelf', '--', 'shelf'], { cwd: other, encoding: 'utf8' })
    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('shelf: 4 entries, no problems.\n')
  })
})
