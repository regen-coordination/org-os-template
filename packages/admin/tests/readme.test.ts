// The README's run instructions, run as written.
//
// The README said "Flags: --repo <path>, --port <n>" under `npm run admin`.
// Followed literally (`npm run admin -- --port 4691`) the server came up on
// 4680: the root script's own command ended in `run start`, so npm took the
// flags for itself. Nothing tested the document, so nothing noticed. This test
// takes the flags example out of the README and runs it from the repository root.
import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { testTimeoutMs } from './time-limit.ts'
import { makeFixtureRepo, removeFixtureRepo, REAL_REPO } from './fixtures.ts'

const README = readFileSync(join(REAL_REPO, 'packages', 'admin', 'README.md'), 'utf8')

const freePort = () => new Promise<number>(resolve => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as { port: number }
    probe.close(() => resolve(port))
  })
})

let child: ChildProcess | undefined
let repo: string | undefined
afterAll(() => {
  if (child?.pid) { try { process.kill(-child.pid) } catch { /* already gone */ } }
  if (repo) removeFixtureRepo(repo)
})

describe('the README\'s run instructions work as written', () => {
  it('the flags example starts the server on that port, over that repository', async () => {
    // The indented command line in the README that shows both flags.
    const example = README.split('\n').map(l => l.trim()).find(l => l.startsWith('npm run admin ') && l.includes('--port') && l.includes('--repo'))
    expect(example, 'the README shows one command line using --port and --repo').toBeDefined()

    repo = makeFixtureRepo()
    const port = await freePort()
    const command = example!.replace(/--port \S+/, `--port ${port}`).replace(/--repo \S+/, `--repo ${repo}`)

    child = spawn(command, { cwd: REAL_REPO, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const announced = await new Promise<string>(resolve => {
      let out = ''
      const seen = (chunk: Buffer) => {
        out += chunk
        const line = out.split('\n').find(l => l.includes('org-os admin →'))
        if (line) resolve(line)
      }
      child!.stdout!.on('data', seen)
      child!.stderr!.on('data', seen)
      child!.on('exit', code => resolve(`exited with ${code} before announcing itself:\n${out}`))
    })
    expect(announced).toContain(`http://localhost:${port}`)
    expect(announced).toContain(`(repo: ${repo})`)

    const status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json()
    expect(status).toMatchObject({ org: 'Fixture Org' })
  // The command builds the app before it serves, so it gets two minutes, or the suite's limit if that is longer.
  }, Math.max(120_000, testTimeoutMs()))
})

/** A section of the README, from its `## ` heading to the next one. */
const section = (title: string) => {
  const at = README.indexOf(`\n## ${title}\n`)
  if (at < 0) return ''
  const next = README.indexOf('\n## ', at + 1)
  return README.slice(at, next < 0 ? undefined : next)
}

describe('the README says the look as built (C10, E-78)', () => {
  it('names house as the default skin and the fallback, bare as a test skin, and no sleek or sample', () => {
    const skins = section('Skins')
    expect(skins).toMatch(/\*\*`house` is the default and the fallback\.\*\*/)
    expect(skins).toMatch(/\*\*`bare` is a test skin\.\*\*/)
    expect(skins).toContain('`sleek` and `sample` are gone.')
    for (const part of ['**Fonts.**', '**Icons.**', 'Tokens come in groups']) expect(skins, part).toContain(part)
  })

  it('points at the spec, the gallery and /parts for the house\'s look', () => {
    const look = section('The Hub\'s look')
    for (const where of ['docs/superpowers/specs/2026-10-29-dao-os-l4-element-set-design.md', 'docs/design/dao-os-element-gallery.html', '`/parts`'])
      expect(look, where).toContain(where)
  })

  it('lists only test scripts that exist (C11 adds e2e:routes, e2e:a11y and e2e:keys with their scripts)', () => {
    const scripts = (JSON.parse(readFileSync(join(REAL_REPO, 'packages', 'admin', 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts
    const named = [...section('Test').matchAll(/npm run ([a-z0-9:-]+)/g)].map(m => m[1]!)
    expect(named).toEqual(expect.arrayContaining(['e2e', 'e2e:parts', 'e2e:reflow', 'e2e:routes', 'e2e:a11y', 'e2e:keys']))
    for (const n of named) expect(scripts[n], `npm run ${n}`).toBeDefined()
    expect(section('Test')).toContain('npm run e2e:parts -- --group')
    expect(section('Test')).toContain('tests/e2e/gallery-compare.mts')
    expect(existsSync(join(REAL_REPO, 'packages', 'admin', 'tests', 'e2e', 'gallery-compare.mts'))).toBe(true)
  })
})
