import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo, REAL_REPO } from '../fixtures.ts'
import { startLauncher } from '../../launcher/serve.ts'
import { stateDir } from '../../server/state.ts'
import { splitInviteLink } from '../../launcher/join.ts'

const TOKEN = 'tok_SECRET_0123456789abcdef'
const HUB = 'https://hub.alder.example'
const doc = (over: Record<string, unknown> = {}) => ({
  spec: 'org-os/federation/1', name: 'Alder Hub', type: 'LocalNode',
  networks: [{ name: 'Alder Network', role: 'hub' }],
  join: { policy: 'invite', types: ['LocalNode', 'PersonalNode'], asks: ['Why do you want to join?'] },
  ...over,
})
const clean = { status: 'ok', blockers: 0, warnings: 0, findings: [] }

let repo: string
let calls: string[]
let logs: string[]
let launcher: Awaited<ReturnType<typeof startLauncher>>
let startAdmin: ReturnType<typeof vi.fn>
let served: Record<string, unknown>

const fakeFetch = async (url: string) => {
  calls.push(url)
  const body = JSON.stringify(served)
  return { ok: true, status: 200, headers: new Headers(), text: async () => body, json: async () => JSON.parse(body) } as never
}

beforeEach(async () => {
  repo = makeFixtureRepo()
  calls = []; logs = []; served = doc()
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a) => { logs.push(a.join(' ')) })
  startAdmin = vi.fn(async () => ({ url: 'http://localhost:4999', stop: async () => {}, exited: new Promise<void>(() => {}) }))
  launcher = await startLauncher({ port: 0, frameworkDir: REAL_REPO, startAdmin, assess: async () => clean, fetch: fakeFetch as never, lookup: async () => ['93.184.216.34'] })
})
afterEach(async () => { vi.restoreAllMocks(); await launcher.close(); removeFixtureRepo(repo) })

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  launcher.app.request(`http://127.0.0.1:${launcher.port}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', host: `localhost:${launcher.port}`, origin: `http://localhost:${launcher.port}`, ...headers } })

describe('the launcher Join door', () => {
  it('lists Join as available', async () => {
    const res = await launcher.app.request(`http://127.0.0.1:${launcher.port}/api/launcher/state`, { headers: { host: `localhost:${launcher.port}` } })
    const s = await res.json() as { doors: { id: string; available: boolean }[] }
    expect(s.doors.find(d => d.id === 'join')?.available).toBe(true)
  })

  it('refuses a foreign Origin before reading anything', async () => {
    const res = await post('/api/launcher/join/inspect', { address: HUB }, { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(calls).toEqual([])
  })

  it('looks a plain hub address up and answers the hub', async () => {
    const res = await post('/api/launcher/join/inspect', { address: HUB })
    expect(res.status).toBe(200)
    expect(calls).toEqual([`${HUB}/.well-known/federation.json`])
    expect(await res.json()).toEqual({
      invite: false,
      hub: { name: 'Alder Hub', type: 'LocalNode', url: HUB, network: 'Alder Network', networks: ['Alder Network'], policy: 'invite', types: ['LocalNode', 'PersonalNode'], asks: ['Why do you want to join?'] },
    })
  })

  it('splits the fragment off before fetching: the token reaches no fetch, no answer, no log', async () => {
    const res = await post('/api/launcher/join/inspect', { address: `${HUB}/.well-known/federation.json#invite=${TOKEN}` })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(calls).toEqual([`${HUB}/.well-known/federation.json`])
    expect(calls.join(' ')).not.toContain(TOKEN)
    expect(text).not.toContain(TOKEN)
    expect(JSON.parse(text).invite).toBe(true)
    expect(logs.join('\n')).not.toContain(TOKEN)
  })

  it('a hub with no join block is closed, and open without a decision is open-with-approval', async () => {
    served = doc({ join: undefined })
    expect(((await (await post('/api/launcher/join/inspect', { address: HUB })).json()) as any).hub.policy).toBe('closed')
    served = doc({ join: { policy: 'open' } })
    expect(((await (await post('/api/launcher/join/inspect', { address: HUB })).json()) as any).hub.policy).toBe('open-with-approval')
  })

  it('a malformed link or address gets a plain sentence and no fetch', async () => {
    for (const address of ['not an address', 'http://hub.alder.example', `${HUB}#invite=`, `${HUB}#other=1`, '', 42]) {
      const res = await post('/api/launcher/join/inspect', { address })
      expect(res.status).toBe(400)
      const { error } = await res.json() as { error: string }
      expect(error).toMatch(/^[A-Z].*\.$/)
      expect(error).not.toMatch(/Error|undefined|\{/)
    }
    expect(calls).toEqual([])
  })

  it('a hub that does not publish federation.json is refused with the reader\'s sentence', async () => {
    served = { spec: 'something-else' }
    const res = await post('/api/launcher/join/inspect', { address: HUB })
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: string }).error).toContain('does not publish')
  })

  it('splitInviteLink keeps no token', () => {
    expect(JSON.stringify(splitInviteLink(`${HUB}#invite=${TOKEN}`))).not.toContain(TOKEN)
  })

  it('open lands on the Federation page with the hub and network in the query, never the invite', async () => {
    const res = await post('/api/launcher/open', { path: repo, landing: { hub: HUB, network: 'Alder Network', invite: TOKEN } })
    const { url } = await res.json() as { url: string }
    expect(url).toBe(`http://localhost:4999/federation?hub=${encodeURIComponent(HUB)}&network=Alder+Network`)
    expect(url).not.toContain(TOKEN)
  })

  it('a landing that is not a public hub is ignored', async () => {
    const res = await post('/api/launcher/open', { path: repo, landing: { hub: 'http://localhost:1/x#invite=a' } })
    expect(((await res.json()) as { url: string }).url).toBe('http://localhost:4999/systems/map?first=1')
  })

  it('the token is in no file the launcher wrote for the instance, nor any log', async () => {
    await post('/api/launcher/join/inspect', { address: `${HUB}#invite=${TOKEN}` })
    await post('/api/launcher/open', { path: repo, landing: { hub: HUB, network: 'Alder Network' } })
    const dir = stateDir(realpathSync(repo))
    const seen = readdirSync(dir).map(f => readFileSync(join(dir, f), 'utf8')).join('\n')
    expect(seen).not.toContain(TOKEN)
    expect(logs.join('\n')).not.toContain(TOKEN)
  })
})
