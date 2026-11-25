import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launcherHome, readRecent, remember, forget } from '../../launcher/home.ts'

beforeEach(() => { rmSync(join(launcherHome(), 'instances.json'), { force: true }) })

describe('the launcher home', () => {
  it('lives under ORG_OS_LAUNCHER_HOME, which the test setup points at a temp folder', () => {
    expect(launcherHome()).toBe(process.env.ORG_OS_LAUNCHER_HOME)
    expect(launcherHome().startsWith(tmpdir())).toBe(true)
  })
  it('keeps paths only, most recent first, at most 20', () => {
    for (let i = 0; i < 25; i++) remember(`/tmp/i${i}`)
    const raw = JSON.parse(readFileSync(join(launcherHome(), 'instances.json'), 'utf8'))
    expect(Object.keys(raw)).toEqual(['instances'])
    expect(raw.instances).toHaveLength(20)
    expect(raw.instances[0]).toBe('/tmp/i24')
  })
  it('reads a corrupt list as empty', () => {
    mkdirSync(launcherHome(), { recursive: true })
    writeFileSync(join(launcherHome(), 'instances.json'), '{nope')
    expect(readRecent()).toEqual([])
    expect(remember('/tmp/a')).toEqual(['/tmp/a'])
    expect(JSON.parse(readFileSync(join(launcherHome(), 'instances.json'), 'utf8'))).toEqual({ instances: ['/tmp/a'] })
  })
  it('reads a missing list as empty, and ignores entries that are not strings', () => {
    expect(readRecent()).toEqual([])
    mkdirSync(launcherHome(), { recursive: true })
    writeFileSync(join(launcherHome(), 'instances.json'), JSON.stringify({ instances: ['/tmp/a', 3, null, '/tmp/b'] }))
    expect(readRecent()).toEqual(['/tmp/a', '/tmp/b'])
  })
  it('moves a repeated path to the front instead of listing it twice', () => {
    remember('/tmp/a'); remember('/tmp/b')
    expect(remember('/tmp/a')).toEqual(['/tmp/a', '/tmp/b'])
  })
  it('de-duplicates by real path when the folder exists, and stores the real path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'launcher-real-'))
    const link = `${dir}-link`
    symlinkSync(dir, link)
    const real = realpathSync(dir)
    expect(remember(dir)).toEqual([real])
    expect(remember(link)).toEqual([real])
    expect(readRecent()).toEqual([real])
    rmSync(link); rmSync(dir, { recursive: true })
  })
  it('forgets a path, leaving the rest', () => {
    remember('/tmp/a'); remember('/tmp/b')
    expect(forget('/tmp/a')).toEqual(['/tmp/b'])
    expect(readRecent()).toEqual(['/tmp/b'])
  })
  it('leaves no temp file behind', () => {
    remember('/tmp/a')
    expect(readdirSync(launcherHome())).toEqual(['instances.json'])
  })
})
