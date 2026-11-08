import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { startServer, type Running } from '../../server/serve.ts'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { READ_ONLY_NO_DIFF } from '../../server/proposals/view.ts'
import { readHostedConfig, type HostedConfig } from '../../server/hosted/config.ts'
import {
  BEFORE_PILOT_OPEN, INSTANCE_WRITES, READ_ONLY, readInstanceWrites, type InstanceWrite,
} from '../../server/hosted/instance-writes.ts'
import { HOSTED_WRITES } from '../../server/hosted/writes.ts'
import * as privateProposals from '../../server/private/proposals.ts'

// Lane 3 Task 11 (C1): HOUSE_INSTANCE_WRITES. While it is off the house writes nothing to the instance: route by route,
// the page visit, the start-up reconcile and the push. Every repository is a fresh one under the temp directory; the
// remote, where there is one, is a bare repository on disk. No network.

vi.mock('../../server/private/proposals.ts', async orig => {
  const real = await orig<typeof import('../../server/private/proposals.ts')>()
  return { ...real, reconcilePrivate: vi.fn(real.reconcilePrivate) }
})

const cleanup: (() => void | Promise<void>)[] = []
const savedEnv = { ...process.env }
beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null')
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  vi.stubEnv('ORG_OS_ADMIN_HOME', tmp('iw-home-'))
  vi.stubEnv('ORG_OS_PRIVATE_DIR', tmp('iw-private-'))
})
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f()
  vi.unstubAllEnvs()
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]
  Object.assign(process.env, savedEnv) // a hosted start sets the Hub's ident in process.env (L9 §5.5)
  vi.restoreAllMocks()
  vi.mocked(privateProposals.reconcilePrivate).mockClear()
})
function tmp(prefix: string): string { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(() => rmSync(d, { recursive: true, force: true })); return d }
const noNetwork = async () => { throw new Error('no network in this test') }
async function serve(o: Parameters<typeof startServer>[0]): Promise<Running> {
  const s = await startServer(o)
  cleanup.push(() => s.close())
  return s
}
/** Everything a write could move: every ref, HEAD, the index and the working tree. */
const snapshot = (repo: string) => [git(repo, 'for-each-ref'), git(repo, 'rev-parse HEAD'), git(repo, 'status --porcelain'), git(repo, 'ls-files -s')].join('\n--\n')
/** A route's path with its parameters filled in. */
const concrete = (path: string) => path.replace(':name', 'projects').replace(':board', 'organization').replace(':op', 'validate').replace(':n', '0').replace(/:id/g, 'x')
async function send(server: Running, w: Pick<InstanceWrite, 'method' | 'path'>) {
  const res = await fetch(`http://localhost:${server.port}${concrete(w.path)}`, {
    method: w.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'x', ops: [], title: 'T' }),
  })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try { body = JSON.parse(text) as Record<string, unknown> } catch { /* not JSON */ }
  return { status: res.status, body }
}

describe('readInstanceWrites (Lane 3 Task 11)', () => {
  it('hosted default off; local default on; only on or off, in any case; anything else refuses the start', () => {
    expect(readInstanceWrites({}, true)).toBe('off')
    expect(readInstanceWrites({}, false)).toBe('on')
    expect(readInstanceWrites({ HOUSE_INSTANCE_WRITES: ' OFF ' }, false)).toBe('off')
    expect(readInstanceWrites({ HOUSE_INSTANCE_WRITES: 'off' }, true)).toBe('off')
    expect(readInstanceWrites({ HOUSE_INSTANCE_WRITES: 'On' }, false)).toBe('on')
    expect(readInstanceWrites({ HOUSE_INSTANCE_WRITES: 'yes' }, true)).toEqual({ refuse: 'HOUSE_INSTANCE_WRITES is "yes", not on or off.' })
  })

  it('hosted with writes on refuses to start while BEFORE_PILOT_OPEN is not empty', async () => {
    expect(BEFORE_PILOT_OPEN).toEqual(['ledger-149', 'ledger-232-M8', 'ledger-249', 'ledger-257'])
    const refused = readInstanceWrites({ HOUSE_INSTANCE_WRITES: 'on' }, true)
    expect(refused).toEqual({ refuse: expect.stringContaining('ledger-149, ledger-232-M8, ledger-249, ledger-257') })
    expect((refused as { refuse: string }).refuse).toMatch(/^HOUSE_INSTANCE_WRITES is on, .*Set HOUSE_INSTANCE_WRITES=off/)
    // Once the writes lane has emptied the list, on is read.
    expect(readInstanceWrites({ HOUSE_INSTANCE_WRITES: 'on' }, true, [])).toBe('on')
    // The start itself stops, before anything listens.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const repo = makeFixtureRepo(); cleanup.push(() => removeFixtureRepo(repo))
    vi.stubEnv('HOUSE_INSTANCE_WRITES', 'on')
    await expect(startServer({ repo, port: 0, hosted: true, fetch: noNetwork })).rejects.toThrow(/^HOUSE_INSTANCE_WRITES is on, /)
    vi.stubEnv('HOUSE_INSTANCE_WRITES', 'sometimes')
    await expect(startServer({ repo, port: 0, hosted: false, fetch: noNetwork })).rejects.toThrow('HOUSE_INSTANCE_WRITES is "sometimes", not on or off.')
  })
})

describe('the route table while writes are off (Lane 3 Task 11)', () => {
  it('every write route answers 403 read-only while writes are off; the instance is unchanged after every one', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const repo = makeFixtureRepo(); cleanup.push(() => removeFixtureRepo(repo))
    vi.stubEnv('HOUSE_INSTANCE_WRITES', 'off')
    const server = await serve({ repo, port: 0, fetch: noNetwork })
    // The table names every non-GET route the app registers, and nothing else (the HOSTED_WRITES pattern).
    const routes = server.app.routes.filter(r => r.path.startsWith('/api'))
    const writes = [...new Set(routes.filter(r => r.method !== 'GET' && r.method !== 'ALL').map(r => `${r.method} ${r.path}`))]
    const listed = new Set(INSTANCE_WRITES.map(e => `${e.method} ${e.path}`))
    expect(writes.length).toBeGreaterThan(30)
    expect(writes.filter(w => !listed.has(w))).toEqual([])
    expect([...listed].filter(w => !writes.includes(w))).toEqual([])
    expect([...listed].sort()).toEqual(HOSTED_WRITES.map(e => `${e.method} ${e.path}`).sort())
    const before = snapshot(repo)
    for (const w of INSTANCE_WRITES.filter(e => e.class === 'instance')) {
      expect([`${w.method} ${w.path}`, await send(server, w)]).toEqual([`${w.method} ${w.path}`, { status: 403, body: { error: READ_ONLY, code: 'INSTANCE_READ_ONLY' } }])
      expect(snapshot(repo)).toBe(before)
    }
    // What is kept outside the instance, and sign-in, still reach their routes.
    for (const w of INSTANCE_WRITES.filter(e => e.class !== 'instance')) {
      expect([`${w.method} ${w.path}`, (await send(server, w)).body.code]).not.toEqual([`${w.method} ${w.path}`, 'INSTANCE_READ_ONLY'])
    }
    expect(snapshot(repo)).toBe(before)
    // The client reads the switch from the status, and hides every write control.
    expect(await (await fetch(`http://localhost:${server.port}/api/status`)).json()).toMatchObject({ instanceWrites: 'off' })
    expect((await (await fetch(`http://localhost:${server.port}/api/session`)).json()).instanceWrites).toBe('off')
  }, 60_000)

  it('the four before-pilot items each sit behind the switch, by their routes', () => {
    const tagged = (item: string) => INSTANCE_WRITES.filter(e => e.pilot?.includes(item)).map(e => `${e.method} ${e.path} ${e.class}`)
    expect(tagged('ledger-149')).toEqual(['POST /api/proposals/:id/events instance', 'POST /api/proposals/:id/check instance'])
    expect(tagged('ledger-232-M8')).toEqual(['POST /api/proposals/:id/ratify instance'])
    expect(tagged('ledger-249')).toEqual(['POST /api/visibility/narrow instance'])
    expect(tagged('ledger-257')).toEqual(['POST /api/proposals/:id/ratify instance'])
    for (const item of BEFORE_PILOT_OPEN) expect([item, tagged(item).length > 0]).toEqual([item, true])
  })

  for (const [name, method, path] of [
    ['events is refused while off (149)', 'POST', '/api/proposals/:id/events'],
    ['check is refused while off (149)', 'POST', '/api/proposals/:id/check'],
    ['ratify is refused while off (232 M8, 257)', 'POST', '/api/proposals/:id/ratify'],
    ['narrow is refused while off (249)', 'POST', '/api/visibility/narrow'],
  ] as const) {
    it(name, async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const repo = makeFixtureRepo(); cleanup.push(() => removeFixtureRepo(repo))
      const server = await serve({ repo, port: 0, fetch: noNetwork, instanceWrites: 'off' })
      const before = snapshot(repo)
      expect(await send(server, { method, path })).toEqual({ status: 403, body: { error: READ_ONLY, code: 'INSTANCE_READ_ONLY' } })
      expect(snapshot(repo)).toBe(before)
    })
  }

  it('local default is on; nothing changes for a local house', async () => {
    const repo = makeFixtureRepo(); cleanup.push(() => removeFixtureRepo(repo))
    const server = await serve({ repo, port: 0, fetch: noNetwork })
    const head = git(repo, 'rev-parse HEAD')
    const res = await fetch(`http://localhost:${server.port}/api/registries/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'local-write', title: 'A local write' }),
    })
    expect(res.status).toBe(201)
    expect(git(repo, 'rev-parse HEAD')).not.toBe(head)
    expect(await (await fetch(`http://localhost:${server.port}/api/status`)).json()).not.toHaveProperty('instanceWrites')
  })
})

describe('the start and the page visit while writes are off (Lane 3 Task 11)', () => {
  it('reconcile does not run at start while off', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const repo = makeFixtureRepo(); cleanup.push(() => removeFixtureRepo(repo))
    const reconcile = vi.mocked(privateProposals.reconcilePrivate)
    const off = await serve({ repo, port: 0, fetch: noNetwork, instanceWrites: 'off' })
    expect(off.privateStore).not.toBeNull()
    expect(reconcile).not.toHaveBeenCalled()
    expect(log.mock.calls.flat().filter(l => String(l).includes('HOUSE_INSTANCE_WRITES is off'))).toHaveLength(1)
    await off.close(); cleanup.pop()
    await serve({ repo, port: 0, fetch: noNetwork })
    expect(reconcile).toHaveBeenCalledTimes(1)
  })

  it('a visit builds no branch while off', async () => {
    const repo = makeChangeRepo(`schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`)
    cleanup.push(() => removeFixtureRepo(repo))
    const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const on = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main' }))
    const record = (await (await on.request('/api/registries/projects')).json() as { entries: { id: string }[] }).entries[0]!.id
    expect((await on.request('/api/changes/ops', json({ ops: [{ op: 'update', record: `projects:${record}`, set: { title: 'Renamed' } }] }))).status).toBe(200)
    const opened = await on.request('/api/proposals', json({ title: 'Rename a project' }))
    expect(opened.status).toBe(201)
    const id = (await opened.json() as { id: string }).id
    // The branch a visit would build is not there (as after a restart on a fresh clone).
    git(repo, `branch -D proposal/${id}`)
    const before = snapshot(repo)
    const off = createApp(repo, (a, ctx) => mountProposals(a, { repo, withLock: ctx.withLock, startBranch: 'main', readOnly: true }), { instanceWrites: 'off' })
    const res = await off.request(`/api/proposals/${id}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ diff: null, note: READ_ONLY_NO_DIFF(id) })
    expect(git(repo, 'for-each-ref refs/heads/proposal')).toBe('')
    expect(snapshot(repo)).toBe(before)
    // With writes on, the same visit builds it (as before this switch).
    expect(await (await on.request(`/api/proposals/${id}`)).json()).toMatchObject({ branchState: 'built' })
  })
})

describe('no Pusher while writes are off (Lane 3 Task 11, from L9 batch 1)', () => {
  function hostedConfig(env: Record<string, string>): HostedConfig {
    const r = readHostedConfig({ ORG_OS_PUBLIC_ORIGIN: 'https://hub.example.org', ORG_OS_BIND: '127.0.0.1', ORG_OS_PRIVATE_DIR: process.env.ORG_OS_PRIVATE_DIR!, ...env }, '/work/instance')
    if (!('config' in r)) throw new Error(r.refuse)
    return r.config
  }

  it('hosted with ORG_OS_PUSH on and writes off: nothing is pushed, at start or later', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}) // hosted with no backup key says so (§10.4)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const repo = makeChangeRepo(); cleanup.push(() => removeFixtureRepo(repo))
    const bare = join(tmp('iw-remote-'), 'remote.git')
    git(tmp('iw-init-'), `init -q --bare -b main ${bare}`)
    git(repo, `remote add origin ${bare}`)
    git(repo, 'push -q origin refs/heads/main:refs/heads/main')
    vi.stubEnv('ORG_OS_REMOTE_PRIVATE', 'confirmed') // a local path: rule 4 cannot ask, the operator confirmed
    git(repo, 'commit -q --allow-empty -m "a commit the remote has not seen"')
    const remoteTip = () => git(bare, 'rev-parse refs/heads/main').trim()
    const before = remoteTip()
    const config = hostedConfig({ ORG_OS_PUSH: 'on' })
    expect(config.push).toBe(true)
    // Writes off is the hosted default: HOUSE_INSTANCE_WRITES is not set.
    const off = await serve({ repo, port: 0, hosted: true, hostedConfig: config, fetch: noNetwork })
    await new Promise(r => setTimeout(r, 1500))
    expect(remoteTip()).toBe(before)
    const local = git(repo, 'rev-parse HEAD').trim()
    expect(local).not.toBe(before)
    // The contrast: the same start with writes on (the tests' override) pushes the trunk at once.
    await off.close(); cleanup.pop()
    await serve({ repo, port: 0, hosted: true, hostedConfig: config, fetch: noNetwork, instanceWrites: 'on' })
    const end = Date.now() + 20_000
    while (remoteTip() !== local && Date.now() < end) await new Promise(r => setTimeout(r, 50))
    expect(remoteTip()).toBe(local)
  }, 40_000)
})

// The client half (the tray and the Propose button absent while off) is app/src/viewAs/writesOff.test.tsx.
