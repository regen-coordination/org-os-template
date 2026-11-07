import { describe, it, expect, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRemote, remoteVisibility } from '../../server/visibility/remote.ts'
import { startServer, type Running } from '../../server/serve.ts'
import type { FetchLike } from '../../server/systems/driver.ts'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(here, 'fixtures', 'remote', `${name}.json`), 'utf8'))

interface Seen { url: string; init: Parameters<FetchLike>[1] }
function fake(status: number, body: unknown, seen: Seen[] = []): FetchLike {
  return async (url, init) => { seen.push({ url, init }); return { ok: status >= 200 && status < 300, status, json: async () => body } }
}
const never: FetchLike = async () => { throw new Error('asked the network') }

const HOSTS = [
  { host: 'github.com', api: 'https://api.github.com/repos/example-org/example-house', slug: 'github' },
  { host: 'gitlab.com', api: 'https://gitlab.com/api/v4/projects/example-org%2Fexample-house', slug: 'gitlab' },
  { host: 'codeberg.org', api: 'https://codeberg.org/api/v1/repos/example-org/example-house', slug: 'codeberg' },
]

describe('remoteVisibility', () => {
  for (const { host, api, slug } of HOSTS) {
    for (const url of [`https://${host}/example-org/example-house.git`, `https://${host}/example-org/example-house`, `git@${host}:example-org/example-house.git`]) {
      it(`${host}: ${url}`, async () => {
        const seen: Seen[] = []
        expect(await remoteVisibility(url, fake(200, fixture(`${slug}-public`), seen))).toBe('public')
        expect(seen.map(s => s.url)).toEqual([api])
        expect(await remoteVisibility(url, fake(200, fixture(`${slug}-private`)))).toBe('not-public')
        expect(await remoteVisibility(url, fake(404, fixture(`${slug}-404`)))).toBe('not-public')
        expect(await remoteVisibility(url, fake(500, {}))).toBe('unknown')
        expect(await remoteVisibility(url, never)).toBe('unknown')
      })
    }
  }

  it('another host is unknown and nothing is asked', async () => {
    expect(await remoteVisibility('https://git.example.net/example-org/example-house.git', never)).toBe('unknown')
    expect(await remoteVisibility('not a url', never)).toBe('unknown')
  })

  it('the request carries no credentials, even when the address does', async () => {
    const seen: Seen[] = []
    await remoteVisibility('https://token-abc123@github.com/example-org/example-house.git', fake(200, fixture('github-private'), seen))
    expect(seen).toHaveLength(1)
    expect(Object.keys(seen[0]!.init.headers)).toEqual(['accept'])
    expect(seen[0]!.url).not.toContain('token-abc123')
  })
})

describe('checkRemote', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
  function repoWith(remote: string | null): string {
    const dir = mkdtempSync(join(tmpdir(), 'remote-check-'))
    dirs.push(dir)
    execSync('git init -q -b main', { cwd: dir })
    if (remote) execSync(`git remote add origin ${remote}`, { cwd: dir })
    return dir
  }
  const PUBLIC_SENTENCE = 'The repository at github.com/example-org/example-house is public, and it holds what only members may read. Make it private, then start again.'
  const url = 'https://github.com/example-org/example-house.git'

  it('no remote: nothing is asked', async () => {
    expect(await checkRemote(repoWith(null), { hosted: true, fetch: never, env: {} })).toEqual({ refuse: null, attention: null })
  })
  it('hosted and public refuses with the sentence', async () => {
    const r = await checkRemote(repoWith(url), { hosted: true, fetch: fake(200, fixture('github-public')), env: {} })
    expect(r).toEqual({ refuse: PUBLIC_SENTENCE, attention: null })
  })
  it('hosted and private starts', async () => {
    expect(await checkRemote(repoWith(url), { hosted: true, fetch: fake(404, fixture('github-404')), env: {} })).toEqual({ refuse: null, attention: null })
  })
  it('hosted and unknown refuses unless the deployer confirmed', async () => {
    const repo = repoWith('https://git.example.net/example-org/example-house.git')
    const refused = await checkRemote(repo, { hosted: true, fetch: never, env: {} })
    expect(refused.refuse).toContain('git.example.net/example-org/example-house')
    expect(refused.refuse).toContain('ORG_OS_REMOTE_PRIVATE=confirmed')
    expect(await checkRemote(repo, { hosted: true, fetch: never, env: { ORG_OS_REMOTE_PRIVATE: 'confirmed' } })).toEqual({ refuse: null, attention: null })
  })
  it('local and public is an alert, not a refusal; local and unknown is nothing', async () => {
    expect(await checkRemote(repoWith(url), { hosted: false, fetch: fake(200, fixture('github-public')), env: {} }))
      .toEqual({ refuse: null, attention: PUBLIC_SENTENCE })
    expect(await checkRemote(repoWith(url), { hosted: false, fetch: never, env: {} })).toEqual({ refuse: null, attention: null })
  })
  it('no sentence names a token carried by the address', async () => {
    const repo = repoWith('https://token-abc123@github.com/example-org/example-house.git')
    const r = await checkRemote(repo, { hosted: true, fetch: fake(200, fixture('github-public')), env: {} })
    expect(r.refuse).not.toContain('token-abc123')
    const u = await checkRemote(repoWith('https://token-abc123@git.example.net/example-org/example-house.git'), { hosted: true, fetch: never, env: {} })
    expect(u.refuse).not.toContain('token-abc123')
  })
})

describe('startServer', () => {
  const dirs: string[] = []
  let running: Running | null = null
  afterEach(async () => { await running?.close(); running = null; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
  function repoWith(remote: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'remote-serve-'))
    dirs.push(dir)
    execSync('git init -q -b main', { cwd: dir })
    execSync(`git remote add origin ${remote}`, { cwd: dir })
    return dir
  }
  const url = 'https://github.com/example-org/example-house.git'

  it('hosted on a public repository does not start', async () => {
    await expect(startServer({ repo: repoWith(url), port: 0, hosted: true, fetch: fake(200, fixture('github-public')) }))
      .rejects.toThrow('is public, and it holds what only members may read')
  })
  it('local on a public repository starts and says so on Home', async () => {
    running = await startServer({ repo: repoWith(url), port: 0, fetch: fake(200, fixture('github-public')) })
    const res = await globalThis.fetch(`http://127.0.0.1:${running.port}/api/resources`)
    expect(JSON.stringify(await res.json())).toContain('is public, and it holds what only members may read')
  })
})
