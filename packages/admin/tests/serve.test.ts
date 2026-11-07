// The server as a caller meets it: a real listener on a free port, called over
// HTTP. `app.request()` cannot see what only exists once the UI is mounted and
// a socket is open: the Host header, the SPA fallback, the WebSocket upgrade.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { request } from 'node:http'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { makeFixtureRepo, removeFixtureRepo } from './fixtures.ts'
import { startServer, type Running } from '../server/serve.ts'
import { JobStore, stateDir, newJobId, type JobRecord } from '../server/state.ts'

let repo: string
let server: Running
beforeAll(async () => {
  repo = makeFixtureRepo()
  const appDist = join(repo, '.dist') // stands in for the built UI
  mkdirSync(appDist)
  writeFileSync(join(appDist, 'index.html'), '<!doctype html><title>admin</title>')
  server = await startServer({ repo, port: 0, appDist })
})
afterAll(async () => { await server.close(); removeFixtureRepo(repo) })

interface Reply { status: number; type: string; body: string; json: () => { error?: string } }

/** A raw HTTP call: unlike fetch, it lets a test set Host and Origin. */
function call(method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.port, method, path, headers }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => resolve({
        status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body: text,
        json: () => JSON.parse(text),
      }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

const commits = () => Number(execSync('git rev-list --count HEAD', { cwd: repo }).toString().trim())
const idea = (id: string) => JSON.stringify({ id, title: 'T', status: 'surfaced' })
const JSON_TYPE = { 'content-type': 'application/json' }

// There is no sign-in: the only thing between a web page the operator happens
// to have open and this repository's git history is that the browser says
// where a request came from. A browser sends a cross-site POST with a
// text/plain body without asking first, and a DNS-rebinding page reaches
// 127.0.0.1 under its own host name. Each is refused, with a sentence.
describe('jobs', () => {
  it('answers the jobs list over HTTP', async () => {
    const res = await call('GET', '/api/jobs', { host: `localhost:${server.port}` })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
  })

  it('serves Sync: GET /api/sync reads the last fetch (a repository with no remote has nothing to sync)', async () => {
    const res = await call('GET', '/api/sync', { host: `localhost:${server.port}` })
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ remote: null, state: 'no remote', sentence: 'There is no remote: nothing to sync.' })
  })

  it('closes with no jobs running', async () => {
    const other = await startServer({ repo, port: 0 })
    await expect(other.close()).resolves.toBeUndefined()
  })
})

describe('a request that is not the app\'s own is refused in words', () => {
  it('refuses a write from a page on another origin, and writes nothing', async () => {
    const before = commits()
    const res = await call('POST', '/api/registries/ideas',
      { ...JSON_TYPE, origin: 'https://evil.example' }, idea('idea-forged'))
    expect(res.status).toBe(403)
    expect(res.json().error).toMatch(/https:\/\/evil\.example/)
    expect(res.json().error).toMatch(/only the admin app's own page/i)
    expect(commits()).toBe(before)
  })
  it('refuses another local page on a different port', async () => {
    const res = await call('POST', '/api/registries/ideas',
      { ...JSON_TYPE, host: `localhost:${server.port}`, origin: 'http://localhost:9' }, idea('idea-neighbour'))
    expect(res.status).toBe(403)
  })
  it('refuses a request addressed to another host name, reads included', async () => {
    const before = commits()
    const write = await call('POST', '/api/registries/ideas', { ...JSON_TYPE, host: 'evil.example' }, idea('idea-rebound'))
    expect(write.status).toBe(403)
    expect(write.json().error).toMatch(/evil\.example/)
    expect(write.json().error).toMatch(/localhost/)
    expect(commits()).toBe(before)
    const read = await call('GET', '/api/registries/members', { host: 'evil.example' })
    expect(read.status).toBe(403)
  })
  // The HTTP adapter turns these away itself, before the guard runs, and used
  // to answer a bare 400 with an empty body.
  for (const host of ['LOCALHOST:4680', 'localhost@evil.example', 'user@localhost:4680']) {
    it(`says in words why it cannot read "Host: ${host}"`, async () => {
      const res = await call('GET', '/api/status', { host })
      expect(res.status).toBe(400)
      expect(res.type).toMatch(/application\/json/)
      expect(res.json().error).toContain(host)
      expect(res.json().error).toContain(`http://localhost:${server.port}`) // the address to use
    })
  }
  it('refuses a write that is not sent as JSON, and says which header to set', async () => {
    const before = commits()
    const res = await call('POST', '/api/registries/ideas', { 'content-type': 'text/plain' }, idea('idea-plaintext'))
    expect(res.status).toBe(415)
    expect(res.json().error).toMatch(/content-type: application\/json/)
    expect(res.json().error).toMatch(/text\/plain/)
    const none = await call('PUT', '/api/registries/members/ana', {}, JSON.stringify({ id: 'ana' }))
    expect(none.status).toBe(415)
    expect(commits()).toBe(before)
  })
  it('refuses a delete from another origin', async () => {
    const res = await call('DELETE', '/api/registries/members/ana', { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect((await call('GET', '/api/registries/members')).body).toContain('"ana"')
  })
  it('does not open the event stream for a page on another origin', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/events`, { origin: 'https://evil.example' })
    const outcome = await new Promise<string>(resolve => {
      ws.on('open', () => { ws.terminate(); resolve('opened') })
      ws.on('unexpected-response', (_req, res) => resolve(`refused ${res.statusCode}`))
      ws.on('error', () => resolve('error'))
    })
    expect(outcome).toBe('refused 403')
  })
})

// With the UI mounted, the SPA fallback used to catch every unknown address,
// /api/ included: a client asking for a route that is not built (the graph,
// a proposal's sub-address) was told 200 and handed the app's HTML page.
// (GET /api/proposals is built since 0.6 P2 Task 15; its pin moved to an address under it that is not.)
describe('an unknown /api/ address answers 404 in JSON', () => {
  for (const [method, path] of [
    ['GET', '/api/graph'], ['GET', '/api/proposals/p-2026-10-18-001/diff'], ['GET', '/api'], ['GET', '/api/'],
    ['POST', '/api/graph'], ['PUT', '/api/views'], ['DELETE', '/api/registries'],
  ] as const) {
    it(`${method} ${path}`, async () => {
      const res = await call(method, path, method === 'GET' || method === 'DELETE' ? {} : JSON_TYPE, method === 'GET' || method === 'DELETE' ? undefined : '{}')
      expect(res.status).toBe(404)
      expect(res.type).toMatch(/application\/json/)
      expect(res.json().error).toContain(`${method} ${path}`)
      expect(res.json().error).toMatch(/GET \/api\/registries/) // says where to look
    })
  }
  it('a UI address that merely starts with the letters "api" is still the app', async () => {
    const res = await call('GET', '/apiary')
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/text\/html/)
  })
})

describe('the server answers its own callers', () => {
  it('serves the API and the UI on one port', async () => {
    const status = await call('GET', '/api/status')
    expect(status.status).toBe(200)
    expect(status.json()).toMatchObject({ org: 'Fixture Org' })
    const page = await call('GET', '/registries/projects') // a UI route: the SPA fallback
    expect(page.status).toBe(200)
    expect(page.type).toMatch(/text\/html/)
  })
  it('accepts a JSON write with no Origin (curl, a script, an agent)', async () => {
    const res = await call('POST', '/api/registries/ideas', JSON_TYPE, idea('idea-plain'))
    expect(res.status).toBe(201)
  })
  it('accepts a write from its own page', async () => {
    const origin = `http://localhost:${server.port}`
    const res = await call('POST', '/api/registries/ideas',
      { ...JSON_TYPE, host: `localhost:${server.port}`, origin }, idea('idea-own-page'))
    expect(res.status).toBe(201)
  })
  it('opens the event stream for a client with no Origin', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/events`)
    await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
    ws.terminate()
  })
})

describe('DECISIONS.md', () => {
  it('announces an edit to it, so an open Governance page re-reads the decisions', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/events`)
    const seen: string[] = []
    ws.on('message', m => seen.push(String(m)))
    await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
    // Re-written until seen: a watcher's baseline can swallow a single early write.
    let n = 0
    const rewrite = setInterval(() => writeFileSync(join(repo, 'DECISIONS.md'), `# Decisions\n\n<!-- ${n++} -->\n`), 100)
    try {
      await expect.poll(() => seen.some(m => JSON.parse(m).type === 'decisions-changed'), { interval: 50, timeout: 8000 }).toBe(true)
    } finally { clearInterval(rewrite); ws.terminate() }
  })
})

describe('the board API over HTTP', () => {
  it('serves the graph from a real listener', async () => {
    const res = await call('GET', '/api/graph/organization', { host: `localhost:${server.port}` })
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ board: 'organization' })
  })
})

describe('the clock tick', () => {
  it('re-reads time-based adapters on an interval it clears on close', async () => {
    const set = vi.spyOn(globalThis, 'setInterval')
    const clear = vi.spyOn(globalThis, 'clearInterval')
    const other = await startServer({ repo, port: 0, clockRefreshMs: 12_345 })
    const tick = set.mock.results.find((_r, i) => set.mock.calls[i]![1] === 12_345)
    expect(tick).toBeDefined()
    await other.close()
    expect(clear.mock.calls.map(c => c[0])).toContain(tick!.value)
    set.mockRestore(); clear.mockRestore()
  })
})

describe('a second server for the same repository', () => {
  const running = (): JobRecord => ({ id: newJobId(), op: 'module.checks', resource: 'module:a', label: 'Re-run checks', cmd: null, args: [], writes: [],
    status: 'running', created: new Date().toISOString(), started: new Date().toISOString(), ended: null, exitCode: null, changed: [], surprises: [], sentence: null })
  const pidFile = () => join(stateDir(repo), 'server.pid')

  it('leaves the jobs of a live server as they are, and says so', async () => {
    const jobs = new JobStore(repo)
    const job = running(); jobs.save(job)
    writeFileSync(pidFile(), String(process.ppid)) // another live process holds the repository
    const said = vi.spyOn(console, 'error').mockImplementation(() => {})
    const other = await startServer({ repo, port: 0 })
    expect(jobs.get(job.id)?.status).toBe('running')
    expect(said).toHaveBeenCalledWith(`org-os admin: another server (pid ${process.ppid}) is running for this repository; its jobs were left as they are.`)
    said.mockRestore()
    await other.close()
    jobs.save({ ...job, status: 'ok', ended: new Date().toISOString() })
  })

  it('marks leftovers interrupted when the recorded pid is gone, and records its own pid while it listens', async () => {
    const jobs = new JobStore(repo)
    const job = running(); jobs.save(job)
    writeFileSync(pidFile(), '2147483646') // no such process
    const other = await startServer({ repo, port: 0 })
    expect(jobs.get(job.id)?.status).toBe('interrupted')
    expect(readFileSync(pidFile(), 'utf8')).toBe(String(process.pid))
    await other.close()
    expect(existsSync(pidFile())).toBe(false)
  })
})
