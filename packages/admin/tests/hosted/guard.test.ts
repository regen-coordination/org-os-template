// The guard when hosted (L9 spec §5.2, §10; Review Focus 1): one configured host and one https origin, writes as JSON,
// and the container's own health check on loopback. The WebSocket upgrade asks the same question, and the members'
// side's /door goes to the door's origin. A fresh fixture repository under the temp directory (makeFixtureRepo), no
// network (ruling S13).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { request } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { refusal, type Caller, type GuardScope } from '../../server/guard.ts'
import { readHostedConfig, type HostedConfig } from '../../server/hosted/config.ts'
import { startServer, type Running } from '../../server/serve.ts'

const savedEnv = { ...process.env }
const restoreEnv = () => { for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]; Object.assign(process.env, savedEnv) }
afterEach(restoreEnv) // startServer hosted sets the Hub's ident in process.env (L9 §5.5)

const ORIGIN = 'https://hub.example.org'
const HOSTED: GuardScope = { kind: 'hosted', host: 'hub.example.org', origin: ORIGIN }
const WRONG_HOST = (host: string) => `Refused: this Hub answers at ${ORIGIN}, and the request was addressed to "${host}".`
const WRONG_ORIGIN = (origin: string) =>
  `Refused: the request came from a page at ${origin}. Only the Hub's own pages (${ORIGIN}) may call it.`
const NOT_JSON = 'Refused: a write must be sent as JSON. Set the header "content-type: application/json" (the request had "text/plain").'

const caller = (o: Partial<Caller> = {}): Caller =>
  ({ method: 'GET', host: 'hub.example.org', origin: undefined, contentType: undefined, path: '/api/status', ...o })

function config(env: Record<string, string> = {}): HostedConfig {
  const r = readHostedConfig({ ORG_OS_PUBLIC_ORIGIN: ORIGIN, ORG_OS_BIND: '127.0.0.1', ORG_OS_PRIVATE_DIR: process.env.ORG_OS_PRIVATE_DIR!, ...env }, '/work/instance')
  if (!('config' in r)) throw new Error(r.refuse)
  return r.config
}

describe('refusal(caller, hosted scope)', () => {
  it('passes Host hub.example.org with Origin https://hub.example.org, and with no Origin', () => {
    expect(refusal(caller({ origin: ORIGIN }), HOSTED)).toBeNull()
    expect(refusal(caller(), HOSTED)).toBeNull()
    expect(refusal(caller({ method: 'POST', origin: ORIGIN, contentType: 'application/json; charset=utf-8' }), HOSTED)).toBeNull()
  })

  it('refuses a Host other than the configured one, with the sentence (Review Focus 1)', () => {
    for (const host of ['203.0.113.5', '203.0.113.5:4680', 'hub.example.org:4680', 'example.org', 'localhost:4680', 'door.example.test', 'evil.example.org']) {
      expect(refusal(caller({ host }), HOSTED)).toEqual({ status: 403, error: WRONG_HOST(host) })
    }
    expect(refusal(caller({ host: undefined }), HOSTED)).toEqual({ status: 403, error: WRONG_HOST('') })
  })

  it('refuses Origin http://hub.example.org, and any other page, with the wrong-origin sentence', () => {
    for (const origin of ['http://hub.example.org', 'https://example.org', 'https://door.example.test', 'https://hub.example.org:8443', 'null']) {
      expect(refusal(caller({ origin }), HOSTED)).toEqual({ status: 403, error: WRONG_ORIGIN(origin) })
    }
  })

  it('a write must still be JSON', () => {
    expect(refusal(caller({ method: 'POST', origin: ORIGIN, contentType: 'text/plain' }), HOSTED)).toEqual({ status: 415, error: NOT_JSON })
  })

  it('GET /api/health with Host 127.0.0.1, localhost or [::1] passes; any other path with that Host is refused', () => {
    for (const host of ['127.0.0.1:4680', '127.0.0.1', 'localhost:4680', '[::1]:4680']) {
      expect(refusal(caller({ host, path: '/api/health' }), HOSTED)).toBeNull()
    }
    expect(refusal(caller({ host: '127.0.0.1:4680', path: '/api/status' }), HOSTED)).toEqual({ status: 403, error: WRONG_HOST('127.0.0.1:4680') })
    expect(refusal(caller({ host: '127.0.0.1:4680', path: '/' }), HOSTED)).toEqual({ status: 403, error: WRONG_HOST('127.0.0.1:4680') })
    expect(refusal(caller({ host: '127.0.0.1:4680', path: '/api/health', method: 'POST', contentType: 'application/json' }), HOSTED))
      .toEqual({ status: 403, error: WRONG_HOST('127.0.0.1:4680') })
    expect(refusal(caller({ host: '203.0.113.5', path: '/api/health' }), HOSTED)).toEqual({ status: 403, error: WRONG_HOST('203.0.113.5') })
  })

  it('local scope (and no scope) answers as before', () => {
    const local = caller({ host: 'localhost:4680', origin: 'http://localhost:4680' })
    expect(refusal(local)).toBeNull()
    expect(refusal(local, { kind: 'local' })).toBeNull()
    expect(refusal(caller({ host: 'hub.example.org' }), { kind: 'local' })).toEqual(refusal(caller({ host: 'hub.example.org' })))
    expect(refusal(caller({ host: 'hub.example.org' }))?.error).toMatch(/^Refused: this server answers only on this machine/)
  })
})

describe('the app with a hosted guard', () => {
  const repos: string[] = []
  afterEach(() => { for (const r of repos.splice(0)) removeFixtureRepo(r) })
  const app = () => {
    const repo = makeFixtureRepo(); repos.push(repo)
    return createApp(repo, undefined, { guard: HOSTED })
  }
  // Behind the proxy the request URL is the container's own address and scheme; only Host and Origin are read.
  const ask = (a: ReturnType<typeof app>, path: string, headers: Record<string, string>) =>
    a.request(`http://127.0.0.1:4680${path}`, { headers })

  it('passes the configured Host, and refuses another, before any route', async () => {
    const a = app()
    expect((await ask(a, '/api/registries', { host: 'hub.example.org', origin: ORIGIN })).status).toBe(200)
    const res = await ask(a, '/api/registries', { host: '127.0.0.1:4680' })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: WRONG_HOST('127.0.0.1:4680') })
  })

  it('X-Forwarded-Proto and X-Forwarded-Host change nothing', async () => {
    const a = app()
    const forwarded = { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'hub.example.org' }
    // a wrong Host stays wrong, whatever the forwarded host says
    const wrong = await ask(a, '/api/registries', { host: 'evil.example.org', ...forwarded })
    expect(wrong.status).toBe(403)
    expect(await wrong.json()).toEqual({ error: WRONG_HOST('evil.example.org') })
    // an http Origin stays wrong, whatever the forwarded scheme says
    const http = await ask(a, '/api/registries', { host: 'hub.example.org', origin: 'http://hub.example.org', 'x-forwarded-proto': 'http' })
    expect(http.status).toBe(403)
    expect(await http.json()).toEqual({ error: WRONG_ORIGIN('http://hub.example.org') })
    // and the right Host and Origin still pass with forwarded headers that disagree
    const right = await ask(a, '/api/registries', { host: 'hub.example.org', origin: ORIGIN, 'x-forwarded-proto': 'http', 'x-forwarded-host': 'evil.example.org' })
    expect(right.status).toBe(200)
  })

  it('GET /api/health on loopback passes the guard; another path on loopback does not', async () => {
    const a = app()
    expect((await ask(a, '/api/health', { host: '127.0.0.1:4680' })).status).not.toBe(403)
    expect((await ask(a, '/api/status', { host: '127.0.0.1:4680' })).status).toBe(403)
  })
})

describe('a hosted server (a real listener on localhost)', () => {
  let repo: string
  let server: Running | null = null
  afterEach(async () => { await server?.close(); server = null; removeFixtureRepo(repo) })

  async function start(cfg: HostedConfig) {
    vi.spyOn(console, 'error').mockImplementation(() => {}) // hosted with no backup key says so (§10.4)
    repo = makeFixtureRepo()
    const appDist = join(repo, '.dist') // stands in for the built UI
    mkdirSync(appDist)
    writeFileSync(join(appDist, 'index.html'), '<!doctype html><title>admin</title>')
    server = await startServer({ repo, port: 0, appDist, hosted: true, hostedConfig: cfg, fetch: async () => { throw new Error('no network in this test') } })
    return server
  }

  function call(path: string, headers: Record<string, string>): Promise<{ status: number; location?: string; body: string }> {
    return new Promise((resolve, reject) => {
      // connection: close, so the server's close does not wait on a kept-alive socket
      const req = request({ host: '127.0.0.1', port: server!.port, method: 'GET', path, headers: { connection: 'close', ...headers } }, res => {
        let body = ''
        res.on('data', chunk => { body += chunk })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, body }))
      })
      req.on('error', reject)
      req.end()
    })
  }

  function upgrade(headers: Record<string, string>): Promise<string> {
    const ws = new WebSocket(`ws://127.0.0.1:${server!.port}/api/events`, { headers })
    return new Promise<string>(resolve => {
      ws.on('open', () => { ws.terminate(); resolve('opened') })
      ws.on('unexpected-response', (_req, res) => resolve(`refused ${res.statusCode}`))
      ws.on('error', () => resolve('error'))
    })
  }

  it('the WebSocket upgrade with a wrong Origin, or to a wrong Host, is refused; the Hub\'s own page is answered', async () => {
    await start(config())
    expect(await upgrade({ host: 'hub.example.org', origin: 'https://evil.example.org' })).toBe('refused 403')
    expect(await upgrade({ host: 'hub.example.org', origin: 'http://hub.example.org' })).toBe('refused 403')
    expect(await upgrade({ host: `127.0.0.1:${server!.port}`, origin: ORIGIN })).toBe('refused 403')
    expect(await upgrade({ host: 'hub.example.org', origin: ORIGIN })).toBe('opened')
  })

  it('hosted /door answers 302 to the door origin', async () => {
    await start(config({ ORG_OS_DOOR_ORIGIN: 'https://door.example.test' }))
    const res = await call('/door', { host: 'hub.example.org' })
    expect(res.status).toBe(302)
    expect(res.location).toBe('https://door.example.test')
  })

  it('with no door origin, /door answers the SPA as now', async () => {
    await start(config())
    const res = await call('/door', { host: 'hub.example.org' })
    expect(res.status).toBe(200)
    expect(res.body).toContain('<title>admin</title>')
  })

  it('the guard runs before the SPA: a wrong Host is refused there too', async () => {
    await start(config({ ORG_OS_DOOR_ORIGIN: 'https://door.example.test' }))
    expect((await call('/door', { host: `127.0.0.1:${server!.port}` })).status).toBe(403)
    expect((await call('/', { host: 'door.example.test' })).status).toBe(403)
  })
})
