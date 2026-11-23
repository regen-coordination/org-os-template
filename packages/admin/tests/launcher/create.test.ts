import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REAL_REPO } from '../fixtures.ts'
import { startLauncher, type DoctorSummary } from '../../launcher/serve.ts'
import * as scaffoldMod from '../../launcher/scaffold.ts'

vi.mock('../../launcher/scaffold.ts', async orig => {
  const real = await orig<typeof import('../../launcher/scaffold.ts')>()
  return { ...real, scaffold: vi.fn(real.scaffold) }
})

vi.mock('node:child_process', async orig => {
  const real = await orig<typeof import('node:child_process')>()
  return { ...real, spawn: vi.fn(real.spawn) }
})

const clean: DoctorSummary = { status: 'ok', blockers: 0, warnings: 0, findings: [] }
const answers = { start: 'open', name: 'Alder Commons', type: 'LocalNode', description: 'A cooperative of seed keepers.', language: 'en', license: 'MIT', operatorName: 'Ana Costa', email: 'ana@alder.example' }

let root: string
let launcher: Awaited<ReturnType<typeof startLauncher>>
let fakeStartAdmin: ReturnType<typeof vi.fn>

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'create-')))
  mkdirSync(join(root, 'into'))
  fakeStartAdmin = vi.fn(async () => ({ url: 'http://localhost:4999', stop: async () => {}, exited: new Promise<void>(() => {}) }))
  launcher = await startLauncher({ port: 0, frameworkDir: REAL_REPO, base: join(root, 'into'), startAdmin: fakeStartAdmin, assess: async () => clean })
  vi.mocked(scaffoldMod.scaffold).mockClear()
})
afterEach(async () => { await launcher.close(); rmSync(root, { recursive: true, force: true }) })

const create = (a: Record<string, unknown>, landing?: unknown) =>
  launcher.app.request(`http://127.0.0.1:${launcher.port}/api/launcher/create`, {
    method: 'POST', body: JSON.stringify({ answers: a, ...(landing ? { landing } : {}) }),
    headers: { 'content-type': 'application/json', host: `localhost:${launcher.port}`, origin: `http://localhost:${launcher.port}` },
  })

describe('creating an instance', () => {
  it('serves the wizard definition', async () => {
    const r = await launcher.app.request(`http://127.0.0.1:${launcher.port}/api/launcher/wizard`, { headers: { host: `localhost:${launcher.port}` } })
    expect(r.status).toBe(200)
    expect((await r.json()).id).toBe('open-instance')
  })

  it('creates into a new folder: federation.yaml, data/ and a git commit, then opens it', async () => {
    const target = join(root, 'into', 'alder-commons')
    const r = await create({ ...answers, folder: target })
    const body = await r.json()
    expect(r.status, JSON.stringify(body)).toBe(200)
    expect(body.url).toContain('http://localhost:4999')
    expect(existsSync(join(target, 'federation.yaml'))).toBe(true)
    expect(existsSync(join(target, 'data'))).toBe(true)
    expect(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: target }).toString().trim()).toBe('1')
    expect(fakeStartAdmin).toHaveBeenCalledWith(realpathSync(target))
    const args = vi.mocked(scaffoldMod.scaffold).mock.calls[0]!
    expect(args[2]).toEqual({ git: true })
  }, 120_000)

  it('lands on the Federation page when the request carries a landing (no token in it)', async () => {
    const r = await create({ ...answers, folder: join(root, 'into', 'joiner') }, { hub: 'https://hub.alder.example', network: 'Alder Network', invite: 'tok_SECRET' })
    const body = await r.json()
    expect(r.status, JSON.stringify(body)).toBe(200)
    expect(body.url).toBe('http://localhost:4999/federation?hub=https%3A%2F%2Fhub.alder.example&network=Alder+Network')
  }, 120_000)

  it('never passes --force or --dry to the command', async () => {
    vi.mocked(spawn).mockClear()
    const r = await create({ ...answers, folder: join(root, 'into', 'x') })
    expect(r.status).toBe(200)
    const spawned = vi.mocked(spawn).mock.calls.filter(c => String(c[1]?.[0]).endsWith('clone-framework.mjs')).map(c => c[1] as string[])
    expect(spawned).toHaveLength(1)
    expect(spawned[0]).toContain('--target')
    for (const argv of [...spawned, scaffoldMod.scaffoldArgs('/f', '/t', '/c', { git: true }), scaffoldMod.scaffoldArgs('/f', '/t', '/c', { git: false })]) {
      expect(argv).not.toContain('--force')
      expect(argv).not.toContain('--dry')
    }
    expect(scaffoldMod.scaffoldArgs('/f', '/t', '/c', { git: false })).toContain('--no-git')
    expect(scaffoldMod.scaffoldArgs('/f', '/t', '/c', { git: true })).not.toContain('--no-git')
  }, 120_000)

  it('refuses a non-empty folder and leaves it as it was', async () => {
    const target = join(root, 'into', 'full'); mkdirSync(target)
    writeFileSync(join(target, 'mine.md'), 'keep')
    const r = await create({ ...answers, folder: target })
    expect(r.status).toBe(409)
    expect(readdirSync(target)).toEqual(['mine.md'])
    expect(scaffoldMod.scaffold).not.toHaveBeenCalled()
  })

  it('refuses invalid answers with the sentence', async () => {
    const r = await create({ ...answers, name: '', folder: join(root, 'into', 'y') })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe("Write the organization's name.")
    const r2 = await create({ ...answers, email: 'nope', folder: join(root, 'into', 'y') })
    expect(r2.status).toBe(400)
    expect(scaffoldMod.scaffold).not.toHaveBeenCalled()
    expect(existsSync(join(root, 'into', 'y'))).toBe(false)
  })

  it('answers 500 with the log when the command fails, and leaves nothing it did not make', async () => {
    vi.mocked(scaffoldMod.scaffold).mockResolvedValueOnce({ code: 1, log: 'line\nboom' })
    const target = join(root, 'into', 'bad')
    const r = await create({ ...answers, folder: target })
    expect(r.status).toBe(500)
    expect(await r.json()).toMatchObject({ error: expect.any(String), log: 'line\nboom' })
  })
})
