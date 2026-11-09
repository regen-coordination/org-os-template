import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REAL_REPO } from '../fixtures.ts'
import { startLauncher, type DoctorSummary } from '../../launcher/serve.ts'
import { defaultCloneFolder } from '../../launcher/folders.ts'
import { cloneName } from '../../lib/clone-name.mjs'
import * as gitWrite from '../../launcher/git-write.ts'

vi.mock('../../launcher/git-write.ts', async orig => {
  const real = await orig<typeof import('../../launcher/git-write.ts')>()
  return { ...real, launcherGit: vi.fn(real.launcherGit) }
})

const clean: DoctorSummary = { status: 'ok', blockers: 0, warnings: 0, findings: [] }
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' })

/** A bare repo with one pushed commit, in a fresh temp folder; returns its file:// address. */
function source(root: string, name: string, files: Record<string, string>): string {
  const bare = join(root, `${name}.git`)
  const work = join(root, `${name}-work`)
  mkdirSync(bare); mkdirSync(work)
  git(bare, 'init', '--bare', '-b', 'main')
  git(work, 'init', '-b', 'main')
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(work, f, '..'), { recursive: true })
    writeFileSync(join(work, f), text)
  }
  git(work, 'add', '.')
  git(work, 'commit', '-m', 'first')
  git(work, 'push', bare, 'main')
  return `file://${bare}`
}

let root: string
let launcher: Awaited<ReturnType<typeof startLauncher>>
let fakeStartAdmin: ReturnType<typeof vi.fn>
let origin: string

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'clone-')))
  mkdirSync(join(root, 'into'))
  fakeStartAdmin = vi.fn(async () => ({ url: 'http://localhost:4999', stop: async () => {}, exited: new Promise<void>(() => {}) }))
  launcher = await startLauncher({ port: 0, frameworkDir: REAL_REPO, base: join(root, 'into'), startAdmin: fakeStartAdmin, assess: async () => clean })
  origin = `http://localhost:${launcher.port}`
  vi.mocked(gitWrite.launcherGit).mockClear()
})
afterEach(async () => { await launcher.close(); rmSync(root, { recursive: true, force: true }) })

const clone = (url: string, folder: string) =>
  launcher.app.request(`http://127.0.0.1:${launcher.port}/api/launcher/clone`, {
    method: 'POST', body: JSON.stringify({ url, folder }),
    headers: { 'content-type': 'application/json', host: `localhost:${launcher.port}`, origin },
  })

describe('opening from a git address', () => {
  it('clones an instance-shaped repo and opens it', async () => {
    const url = source(root, 'inst', { 'federation.yaml': 'identity: {}\n', 'data/x.yaml': 'a: 1\n' })
    const target = join(root, 'into', 'inst')
    const r = await clone(url, target)
    expect(r.status).toBe(200)
    expect((await r.json()).url).toContain('http://localhost:4999')
    expect(fakeStartAdmin).toHaveBeenCalledWith(realpathSync(target))
    expect(vi.mocked(gitWrite.launcherGit).mock.calls[0]!.slice(1)).toEqual(['clone', ['--', url, target]])
  })

  it('clones into an empty folder that was already there', async () => {
    const url = source(root, 'inst', { 'federation.yaml': 'identity: {}\n', 'data/x.yaml': 'a: 1\n' })
    const target = join(root, 'into', 'empty'); mkdirSync(target)
    expect((await clone(url, target)).status).toBe(200)
  })

  it('clones a plain repo and answers adoptable', async () => {
    const url = source(root, 'plain', { 'README.md': 'hi\n' })
    const target = join(root, 'into', 'plain')
    const r = await clone(url, target)
    expect(r.status).toBe(409)
    expect(await r.json()).toMatchObject({ adoptable: true, path: realpathSync(target) })
    expect(fakeStartAdmin).not.toHaveBeenCalled()
  })

  it('refuses a non-empty target with nothing written', async () => {
    const url = source(root, 'inst', { 'federation.yaml': 'identity: {}\n', 'data/x.yaml': 'a: 1\n' })
    const target = join(root, 'into', 'full'); mkdirSync(target)
    writeFileSync(join(target, 'mine.md'), 'keep')
    const r = await clone(url, target)
    expect(r.status).toBe(409)
    expect(readdirSync(target)).toEqual(['mine.md'])
    expect(gitWrite.launcherGit).not.toHaveBeenCalled()
  })

  it('refuses ext:: and option addresses before git runs', async () => {
    for (const bad of ['ext::sh -c touch% /tmp/x', 'ext::sh', 'fd::3', '--upload-pack=x', 'https://user:tok@github.com/o/n']) {
      expect((await clone(bad, join(root, 'into', 'x'))).status).toBe(400)
    }
    expect(gitWrite.launcherGit).not.toHaveBeenCalled()
    expect(existsSync(join(root, 'into', 'x'))).toBe(false)
  })

  it('a failed clone into a new folder leaves no folder behind', async () => {
    const target = join(root, 'into', 'nope')
    const r = await clone(`file://${join(root, 'missing.git')}`, target)
    expect(r.status).toBe(502)
    expect(typeof (await r.json()).error).toBe('string')
    expect(existsSync(target)).toBe(false)
  })

  it('a failed clone into an empty folder that was there leaves it empty', async () => {
    const target = join(root, 'into', 'kept'); mkdirSync(target)
    expect((await clone(`file://${join(root, 'missing.git')}`, target)).status).toBe(502)
    expect(readdirSync(target)).toEqual([])
  })

  it('a failed clone does not delete a folder that appeared meanwhile', async () => {
    const target = join(root, 'into', 'raced')
    const real = (await vi.importActual<typeof import('../../launcher/git-write.ts')>('../../launcher/git-write.ts')).launcherGit
    vi.mocked(gitWrite.launcherGit).mockImplementationOnce(async (cwd, verb, args) => {
      writeFileSync(join(target, 'theirs.md'), 'keep')
      return real(cwd, verb, args)
    })
    const r = await clone(`file://${join(root, 'missing.git')}`, target)
    expect(r.status).toBe(502)
    expect(readdirSync(target)).toEqual(['theirs.md'])
  })

  it('the launcher removes what it made when git itself throws', async () => {
    const target = join(root, 'into', 'deep', 'er', 'x')
    vi.mocked(gitWrite.launcherGit).mockImplementationOnce(async () => { throw new Error('no git here') })
    const r = await clone('https://github.com/o/n', target)
    expect(r.status).toBe(502)
    expect(existsSync(join(root, 'into', 'deep'))).toBe(false)
    expect(existsSync(join(root, 'into'))).toBe(true)
  })

  it('openFlow refuses a folder that is not an instance', async () => {
    const plain = join(root, 'into', 'plain2'); mkdirSync(plain)
    await expect(launcher.openFlow(plain)).rejects.toThrow(/not an org-os instance/)
    expect(fakeStartAdmin).not.toHaveBeenCalled()
  })
})

describe('cloneName', () => {
  it('is the last segment without .git', () => {
    expect(cloneName('https://github.com/o/name.git')).toBe('name')
    expect(cloneName('git@github.com:o/name.git')).toBe('name')
    expect(cloneName('https://github.com/')).toBe('github.com')
    expect(cloneName('')).toBe('instance')
    expect(cloneName('x/..')).toBe('instance')
  })
})

describe('defaultCloneFolder', () => {
  it('is the last segment without .git, inside the base', () => {
    expect(defaultCloneFolder('https://github.com/o/name.git', '/b')).toBe('/b/name')
    expect(defaultCloneFolder('https://github.com/o/name/', '/b')).toBe('/b/name')
    expect(defaultCloneFolder('git@github.com:o/name.git', '/b')).toBe('/b/name')
    expect(defaultCloneFolder('file:///x/y.git', '/b')).toBe('/b/y')
  })
})
