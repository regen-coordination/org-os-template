import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REAL_REPO } from '../fixtures.ts'
import { startLauncher, type DoctorSummary } from '../../launcher/serve.ts'
import { ADOPT_BRANCH, NOTHING_TO_ADD, adoptProblem, applyAdopt, planAdopt } from '../../launcher/adopt.ts'
import { isInstance } from '../../launcher/folders.ts'
import * as scaffoldMod from '../../launcher/scaffold.ts'

vi.mock('../../launcher/scaffold.ts', async orig => {
  const real = await orig<typeof import('../../launcher/scaffold.ts')>()
  return { ...real, scaffold: vi.fn(real.scaffold) }
})

const clean: DoctorSummary = { status: 'ok', blockers: 0, warnings: 0, findings: [] }
const answers = { name: 'Alder Commons', type: 'LocalNode', description: 'A cooperative of seed keepers.', language: 'en', license: 'MIT', operatorName: 'Ana Costa', email: 'ana@alder.example' }

// The test's own git (never the launcher's): it sets up and reads the fixture repos.
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()
const headOf = async (dir: string, ref: string) => git(dir, 'rev-parse', `refs/heads/${ref}`).trim()

let roots: string[] = []
/** A fresh temp repo on `main` with one commit holding README.md, package.json and .gitignore, and its own identity. */
function repo(opts: { commit?: boolean; gitignore?: string } = {}): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'adopt-repo-')))
  roots.push(dir)
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.name', 'Repo Owner')
  git(dir, 'config', 'user.email', 'owner@repo.example')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'README.md'), '# My project\n\nMine.\n')
  writeFileSync(join(dir, 'package.json'), '{ "name": "mine", "private": true }\n')
  writeFileSync(join(dir, '.gitignore'), opts.gitignore ?? 'node_modules/\n*.log\nfederation.yaml.local\n')
  if (opts.commit !== false) {
    git(dir, 'add', '.')
    git(dir, 'commit', '-m', 'first')
  }
  return dir
}
/** Everything in the working tree outside .git, as a sorted list. */
const tree = (dir: string) => (readdirSync(dir, { recursive: true }) as string[]).filter(p => p.split('/')[0] !== '.git').sort()
const branches = (dir: string) => { try { return git(dir, 'branch', '--list', '-a') } catch { return 'no repo' } }
const status = (dir: string) => { try { return git(dir, 'status', '--porcelain', '--untracked-files=all') } catch { return 'no repo' } }

let launcher: Awaited<ReturnType<typeof startLauncher>>
let fakeStartAdmin: ReturnType<typeof vi.fn>
beforeEach(async () => {
  roots = []
  fakeStartAdmin = vi.fn(async () => ({ url: 'http://localhost:4999', stop: async () => {}, exited: new Promise<void>(() => {}) }))
  launcher = await startLauncher({ port: 0, frameworkDir: REAL_REPO, base: tmpdir(), startAdmin: fakeStartAdmin, assess: async () => clean })
  vi.mocked(scaffoldMod.scaffold).mockClear()
})
afterEach(async () => {
  vi.useRealTimers()
  await launcher.close()
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

const post = (route: string, body: unknown) =>
  launcher.app.request(`http://127.0.0.1:${launcher.port}/api/launcher/adopt/${route}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', host: `localhost:${launcher.port}`, origin: `http://localhost:${launcher.port}` },
  })

describe('adopting a repo', () => {
  it('adds only what is missing, on org-os/adopt, and the default branch is untouched', async () => {
    const dir = repo()
    const before = await headOf(dir, 'main'); const readme = readFileSync(join(dir, 'README.md'))
    const plan = await planAdopt(dir, answers, REAL_REPO)
    expect(plan.kept).toEqual(expect.arrayContaining(['README.md', 'package.json', '.gitignore']))
    expect(plan.add).toEqual(expect.arrayContaining(['federation.yaml']))
    expect(plan.add).toEqual([...plan.add].sort())
    expect(plan.kept).toEqual([...plan.kept].sort())
    expect(plan.add.some(p => plan.kept.includes(p))).toBe(false)
    expect(plan.scratch.startsWith(realpathSync(tmpdir())) || plan.scratch.startsWith(tmpdir())).toBe(true)
    // planning wrote nothing in the repo
    expect(status(dir)).toBe('')
    expect(branches(dir)).not.toContain(ADOPT_BRANCH)

    const r = await applyAdopt(plan)
    expect(r.branch).toBe('org-os/adopt')
    expect(r).toMatchObject({ added: plan.add.length, kept: plan.kept.length })
    expect(await headOf(dir, 'main')).toBe(before)
    expect(readFileSync(join(dir, 'README.md'))).toEqual(readme)
    expect(isInstance(dir)).toBe(true)
    expect(existsSync(plan.scratch)).toBe(false)
    // one commit on the branch, by the repo's own identity, with the brief's message, holding exactly the added files
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('org-os/adopt')
    expect(git(dir, 'rev-parse', 'HEAD').trim()).toBe(r.commit)
    expect(git(dir, 'rev-parse', 'HEAD~1').trim()).toBe(before)
    expect(git(dir, 'log', '-1', '--format=%an <%ae>').trim()).toBe('Repo Owner <owner@repo.example>')
    expect(git(dir, 'log', '-1', '--format=%s').trim()).toBe(`chore(org-os): adopt — add the org-os files (${plan.add.length} added, ${plan.kept.length} kept as they were)`)
    const changed = git(dir, 'diff', '--name-only', '--no-renames', `${before}..HEAD`).trim().split('\n').sort()
    expect(changed).toEqual(plan.add)
    expect(status(dir)).toBe('')
  }, 120_000)

  it('apply lands on the Federation page when the request carries a landing', async () => {
    const dir = repo()
    const planned = await post('plan', { path: dir, answers })
    const { planId } = await planned.json()
    const r = await post('apply', { planId, landing: { hub: 'https://hub.alder.example', network: 'Alder Network', invite: 'tok_SECRET' } })
    const body = await r.json()
    expect(r.status, JSON.stringify(body)).toBe(200)
    expect(body.url).toBe('http://localhost:4999/federation?hub=https%3A%2F%2Fhub.alder.example&network=Alder+Network')
  }, 120_000)

  it('keeps the scaffold file mode (an executable stays executable)', async () => {
    const dir = repo()
    const plan = await planAdopt(dir, answers, REAL_REPO)
    const exe = plan.add.find(p => (statSync(join(plan.scratch, 'scaffold', p)).mode & 0o111) !== 0)
    expect(exe, 'the scaffold has an executable file').toBeDefined()
    await applyAdopt(plan)
    expect(statSync(join(dir, exe!)).mode & 0o777).toBe(0o755)
    expect(git(dir, 'ls-files', '-s', '--', exe!)).toMatch(/^100755 /)
  }, 120_000)

  it('keeps a path whose parent is a file or a symlink in the repo, and never writes through the link', async () => {
    const dir = repo()
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'adopt-outside-'))); roots.push(outside)
    writeFileSync(join(dir, 'memory'), 'a file, not a folder\n')
    symlinkSync(outside, join(dir, 'docs'))
    git(dir, 'add', '.'); git(dir, 'commit', '-m', 'odd shapes')
    const plan = await planAdopt(dir, answers, REAL_REPO)
    expect(plan.kept.some(p => p.startsWith('memory/'))).toBe(true)
    expect(plan.kept.some(p => p.startsWith('docs/'))).toBe(true)
    expect(plan.add.some(p => p.startsWith('memory/') || p.startsWith('docs/'))).toBe(false)
    await applyAdopt(plan)
    expect(readdirSync(outside)).toEqual([])
    expect(readFileSync(join(dir, 'memory'), 'utf8')).toBe('a file, not a folder\n')
  }, 120_000)

  it('leaves out the paths the repo\'s .gitignore ignores, lists them, and commits cleanly', async () => {
    const dir = repo({ gitignore: 'node_modules/\n.claude/\n*.json\n' })
    const main = await headOf(dir, 'main')
    const plan = await planAdopt(dir, answers, REAL_REPO)
    const scaffolded = (readdirSync(join(plan.scratch, 'scaffold'), { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
      .filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(join(plan.scratch, 'scaffold').length + 1))
    const matching = scaffolded.filter(p => p.startsWith('.claude/') || (p.endsWith('.json') && p !== 'package.json')).sort()
    expect(matching.length, 'the scaffold makes .claude/ and .json files').toBeGreaterThan(2)
    expect(plan.ignored).toEqual(matching)
    expect(plan.ignored).toEqual(expect.arrayContaining(['.claude/settings.json', 'package-lock.json']))
    expect(plan.add.filter(p => plan.ignored.includes(p))).toEqual([])
    expect(plan.add).toContain('federation.yaml')
    expect(plan.kept).toContain('package.json') // tracked, so kept rather than ignored
    expect(status(dir)).toBe('') // the dry run wrote nothing
    const r = await applyAdopt(plan)
    expect(r.added).toBe(plan.add.length)
    expect(await headOf(dir, 'main')).toBe(main)
    const changed = git(dir, 'diff', '--name-only', '--no-renames', `${main}..HEAD`).trim().split('\n').sort()
    expect(changed).toEqual(plan.add)
    for (const p of plan.ignored) expect(existsSync(join(dir, p)), p).toBe(false)
    expect(status(dir)).toBe('')
  }, 120_000)

  it('refuses a repo that ignores everything the scaffold would add, and makes no branch', async () => {
    const dir = repo({ gitignore: '*\n!.gitignore\n' })
    const before = { status: status(dir), branches: branches(dir), tree: tree(dir) }
    await expect(planAdopt(dir, answers, REAL_REPO)).rejects.toThrow(NOTHING_TO_ADD)
    const r = await post('plan', { path: dir, answers })
    expect(r.status).toBe(409)
    expect((await r.json()).error).toBe('There is nothing to add: the repo already has every file, or ignores it.')
    expect({ status: status(dir), branches: branches(dir), tree: tree(dir) }).toEqual(before)
    const scratches = vi.mocked(scaffoldMod.scaffold).mock.calls.map(c => c[1].replace(/\/scaffold$/, ''))
    expect(scratches.length).toBe(2)
    for (const s of scratches) expect(existsSync(s)).toBe(false)
  }, 120_000)

  it('refuses every unsafe repo state and writes nothing', async () => {
    const cases: [string, () => string, RegExp?][] = [
      ['an untracked file', () => { const d = repo(); writeFileSync(join(d, 'notes.txt'), 'mine'); return d }, /notes\.txt/],
      ['a modified file', () => { const d = repo(); writeFileSync(join(d, 'README.md'), 'changed'); return d }, /README\.md/],
      ['a staged file', () => { const d = repo(); writeFileSync(join(d, 'new.md'), 'x'); git(d, 'add', 'new.md'); return d }],
      ['MERGE_HEAD present', () => { const d = repo(); writeFileSync(join(d, '.git', 'MERGE_HEAD'), `${git(d, 'rev-parse', 'HEAD')}`); return d }, /merge or rebase/],
      ['a rebase in progress', () => { const d = repo(); mkdirSync(join(d, '.git', 'rebase-merge')); return d }, /merge or rebase/],
      ['a rebase-apply in progress', () => { const d = repo(); mkdirSync(join(d, '.git', 'rebase-apply')); return d }, /merge or rebase/],
      ['no commits', () => repo({ commit: false }), /no commits/],
      ['org-os/adopt exists', () => { const d = repo(); git(d, 'branch', 'org-os/adopt'); return d }, /org-os\/adopt/],
      ['already an instance', () => {
        const d = repo(); mkdirSync(join(d, 'data')); writeFileSync(join(d, 'data', 'x.yaml'), 'a: 1\n'); writeFileSync(join(d, 'federation.yaml'), 'identity: {}\n')
        git(d, 'add', '.'); git(d, 'commit', '-m', 'instance'); return d
      }, /^This is already an org-os instance\. Open it instead\.$/],
      ['not a git repo', () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'adopt-plain-'))); roots.push(d); writeFileSync(join(d, 'a.md'), 'x'); return d }, /git/],
      ['a folder inside a repo', () => { const d = repo(); mkdirSync(join(d, 'sub')); writeFileSync(join(d, 'sub', 'k.md'), 'x'); git(d, 'add', '.'); git(d, 'commit', '-m', 'sub'); return join(d, 'sub') }, /inside/],
    ]
    for (const [name, make, sentence] of cases) {
      const dir = make()
      const before = { status: status(dir), branches: branches(dir), tree: tree(dir) }
      const problem = await adoptProblem(dir)
      expect(problem, name).toEqual(expect.any(String))
      if (sentence) expect(problem, name).toMatch(sentence)
      const r = await post('plan', { path: dir, answers })
      expect(r.status, name).toBe(409)
      expect((await r.json()).error, name).toBe(problem)
      await expect(planAdopt(dir, answers, REAL_REPO), name).rejects.toThrow(problem!)
      expect({ status: status(dir), branches: branches(dir), tree: tree(dir) }, name).toEqual(before)
    }
    expect(scaffoldMod.scaffold).not.toHaveBeenCalled()
  }, 120_000)

  it('stops on a file that appeared after planning, naming it', async () => {
    const dir = repo()
    const plan = await planAdopt(dir, answers, REAL_REPO)
    writeFileSync(join(dir, 'federation.yaml'), 'mine\n')
    await expect(applyAdopt(plan)).rejects.toThrow(/federation\.yaml/)
    expect(readFileSync(join(dir, 'federation.yaml'), 'utf8')).toBe('mine\n')
    expect(branches(dir)).not.toContain(ADOPT_BRANCH)
    expect(existsSync(plan.scratch)).toBe(false)
  }, 120_000)

  it('stops on a committed or ignored file that appeared after planning: nothing overwritten, copies left uncommitted on the branch', async () => {
    for (const how of ['committed', 'ignored'] as const) {
      const dir = repo()
      const main = await headOf(dir, 'main')
      const plan = await planAdopt(dir, answers, REAL_REPO)
      // an ignored file does not make the repo unclean, so only the exclusive copy catches it
      const late = 'federation.yaml'
      if (how === 'ignored') writeFileSync(join(dir, '.git', 'info', 'exclude'), 'federation.yaml\n')
      writeFileSync(join(dir, late), 'mine\n')
      if (how === 'committed') { git(dir, 'add', late); git(dir, 'commit', '-m', 'mine') }
      const mainNow = await headOf(dir, 'main')
      const err = await applyAdopt(plan).then(() => null, e => e as Error)
      expect(err?.message, how).toMatch(/federation\.yaml/)
      expect(err?.message, how).toMatch(/org-os\/adopt/)
      expect(err?.message, how).toMatch(/not committed/)
      expect(readFileSync(join(dir, late), 'utf8')).toBe('mine\n')
      expect(await headOf(dir, 'main')).toBe(mainNow)
      expect(await headOf(dir, ADOPT_BRANCH)).toBe(mainNow) // no commit on the branch
      expect(mainNow === main).toBe(how === 'ignored')
      // the files copied before it are there, untracked
      const first = plan.add[0]!
      expect(existsSync(join(dir, first))).toBe(true)
      expect(status(dir)).toContain('??')
      expect(existsSync(plan.scratch)).toBe(false)
    }
  }, 120_000)

  it('answers with git\'s sentence when the commit fails, and leaves the files uncommitted on org-os/adopt', async () => {
    const dir = repo()
    git(dir, 'config', '--unset', 'user.name'); git(dir, 'config', '--unset', 'user.email')
    git(dir, 'config', 'user.useConfigOnly', 'true')
    const main = await headOf(dir, 'main')
    const r1 = await post('plan', { path: dir, answers })
    expect(r1.status).toBe(200)
    const { planId } = await r1.json()
    const r2 = await post('apply', { planId })
    expect([409, 500]).toContain(r2.status)
    const { error } = await r2.json()
    expect(error).toMatch(/email|identity|name/i)
    expect(error).toMatch(/org-os\/adopt/)
    expect(error).toMatch(/not committed/)
    expect(await headOf(dir, 'main')).toBe(main)
    expect(await headOf(dir, ADOPT_BRANCH)).toBe(main)
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(ADOPT_BRANCH)
    expect(existsSync(join(dir, 'federation.yaml'))).toBe(true)
    expect(fakeStartAdmin).not.toHaveBeenCalled()
  }, 120_000)
})

describe('the adopt routes', () => {
  it('plans then applies: answers the open url and the branch, and the plan cannot be used twice', async () => {
    const dir = repo()
    const main = await headOf(dir, 'main')
    const r1 = await post('plan', { path: dir, answers })
    const plan = await r1.json()
    expect(r1.status, JSON.stringify(plan)).toBe(200)
    expect(plan.planId).toMatch(/^[0-9a-f-]{36}$/)
    expect(plan.add).toContain('federation.yaml')
    expect(plan.kept).toEqual(expect.arrayContaining(['README.md', 'package.json', '.gitignore']))
    expect(plan.scratch).toBeUndefined() // where the scratch is stays on the server
    expect(plan.ignored).toEqual([])
    expect(vi.mocked(scaffoldMod.scaffold).mock.calls[0]![2]).toEqual({ git: false })
    const r2 = await post('apply', { planId: plan.planId })
    const body = await r2.json()
    expect(r2.status, JSON.stringify(body)).toBe(200)
    expect(body).toEqual({ url: 'http://localhost:4999/systems/map?first=1', branch: 'org-os/adopt' })
    expect(fakeStartAdmin).toHaveBeenCalledWith(dir)
    expect(await headOf(dir, 'main')).toBe(main)
    const again = await post('apply', { planId: plan.planId })
    expect(again.status).toBe(410)
    expect((await again.json()).error).toEqual(expect.any(String))
  }, 120_000)

  it('canonicalises the path: a symlink to the repo plans the real folder', async () => {
    const dir = repo()
    const link = join(realpathSync(mkdtempSync(join(tmpdir(), 'adopt-link-'))), 'via'); roots.push(join(link, '..'))
    symlinkSync(dir, link)
    const r = await post('plan', { path: link, answers })
    expect(r.status).toBe(200)
    const { planId } = await r.json()
    const r2 = await post('apply', { planId })
    expect(r2.status).toBe(200)
    expect(fakeStartAdmin).toHaveBeenCalledWith(dir)
  }, 120_000)

  it('answers 404 for a missing folder, 400 for bad answers, 410 for an unknown plan', async () => {
    expect((await post('plan', { path: join(tmpdir(), 'no-such-adopt-folder-x'), answers })).status).toBe(404)
    expect((await post('plan', { answers })).status).toBe(400)
    const dir = repo()
    const bad = await post('plan', { path: dir, answers: { ...answers, name: '' } })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe("Write the organization's name.")
    expect((await post('apply', { planId: 'not-a-plan' })).status).toBe(410)
    expect(scaffoldMod.scaffold).not.toHaveBeenCalled()
  })

  it('refuses a plan from another page (the /api guard)', async () => {
    const dir = repo()
    const r = await launcher.app.request(`http://127.0.0.1:${launcher.port}/api/launcher/adopt/plan`, {
      method: 'POST', body: JSON.stringify({ path: dir, answers }),
      headers: { 'content-type': 'application/json', host: `localhost:${launcher.port}`, origin: 'http://evil.example' },
    })
    expect(r.status).toBe(403)
    expect(scaffoldMod.scaffold).not.toHaveBeenCalled()
  })

  it('a plan expires after 30 minutes and its scratch is removed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const dir = repo()
    const r = await post('plan', { path: dir, answers })
    expect(r.status).toBe(200)
    const { planId } = await r.json()
    const scratch = vi.mocked(scaffoldMod.scaffold).mock.calls[0]![1].replace(/\/scaffold$/, '')
    expect(existsSync(scratch)).toBe(true)
    vi.advanceTimersByTime(29 * 60_000)
    expect(existsSync(scratch)).toBe(true)
    vi.advanceTimersByTime(2 * 60_000)
    expect(existsSync(scratch)).toBe(false)
    vi.useRealTimers()
    expect((await post('apply', { planId })).status).toBe(410)
    expect(branches(dir)).not.toContain(ADOPT_BRANCH)
  }, 120_000)

  it('close() removes the scratch of plans not yet applied', async () => {
    const dir = repo()
    const r = await post('plan', { path: dir, answers })
    expect(r.status).toBe(200)
    const scratch = vi.mocked(scaffoldMod.scaffold).mock.calls[0]![1].replace(/\/scaffold$/, '')
    expect(existsSync(scratch)).toBe(true)
    await launcher.close()
    expect(existsSync(scratch)).toBe(false)
    launcher = await startLauncher({ port: 0, frameworkDir: REAL_REPO, base: tmpdir(), startAdmin: fakeStartAdmin, assess: async () => clean })
  }, 120_000)

  it('the adopt module runs git only through the launcher vocabulary', () => {
    const here = fileURLToPath(new URL('.', import.meta.url))
    const text = readFileSync(join(here, '../../launcher/adopt.ts'), 'utf8')
    expect(text).not.toMatch(/child_process/)
    expect(text).toMatch(/launcherGit/)
  })
})
