// Rate limits when hosted (L9 spec §5.9, §10 `RATE`; Q-L9-7). In memory, token buckets per key, at most 10,000 keys.
// The client address is X-Real-IP only with ORG_OS_TRUST_PROXY on, else the socket's peer. A fresh fixture repository
// for the server test, no network (ruling S13). Addresses are documentation ranges (RFC 5737).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { WebSocket } from 'ws'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { Buckets, clientAddress, RATE, rateLimits, WS_PER_ADDRESS } from '../../server/hosted/limits.ts'
import { readHostedConfig, type HostedConfig } from '../../server/hosted/config.ts'
import { startServer, type Running } from '../../server/serve.ts'

const savedEnv = { ...process.env }
const restoreEnv = () => { for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]; Object.assign(process.env, savedEnv) }
afterEach(restoreEnv)

const A = '192.0.2.10', B = '198.51.100.20'

function app(o: { trustProxy?: boolean; now?: () => number } = {}): Hono {
  const a = new Hono()
  a.use('*', rateLimits({ trustProxy: o.trustProxy ?? true, ...(o.now ? { now: o.now } : {}) }))
  a.post('/api/session/nonce', c => c.json({ nonce: 'n' }))
  a.post('/api/session', c => c.json({ ok: true }))
  a.get('/api/proposals/:id', c => c.json({ id: c.req.param('id') }))
  a.put('/api/registries/:name/:id', c => c.json({ ok: true }))
  return a
}
const from = (ip: string, extra: Record<string, string> = {}) => ({ 'x-real-ip': ip, ...extra })

describe('Buckets', () => {
  it('a bucket holds its burst, refills at its rate, and says how long to wait', () => {
    let t = 0
    const b = new Buckets({ ratePerMin: 10, burst: 5, now: () => t })
    for (let i = 0; i < 5; i++) expect(b.take('k')).toEqual({ ok: true })
    expect(b.take('k')).toEqual({ ok: false, retryAfterS: 6 })
    t += 6_000
    expect(b.take('k')).toEqual({ ok: true })
    expect(b.take('k')).toEqual({ ok: false, retryAfterS: 6 })
    t += 3_000
    expect(b.take('k')).toEqual({ ok: false, retryAfterS: 3 })
  })

  it('10,001 keys keep at most 10,000: the least recently used goes', () => {
    const b = new Buckets({ ratePerMin: 10, burst: 1, now: () => 0 })
    b.take('k-0')
    for (let i = 1; i <= 10_000; i++) b.take(`k-${i}`)
    expect(b.size).toBe(10_000)
    expect(b.take('k-0')).toEqual({ ok: true }) // dropped, so a fresh bucket
    expect(b.take('k-10000')).toMatchObject({ ok: false })
    const small = new Buckets({ ratePerMin: 10, burst: 1, maxKeys: 2, now: () => 0 })
    small.take('a'); small.take('b'); small.take('a'); small.take('c') // b is the least recently used
    expect(small.take('a')).toMatchObject({ ok: false })
    expect(small.take('b')).toEqual({ ok: true })
  })
})

describe('rateLimits', () => {
  it('the 11th nonce from one address in a minute is 429 with Retry-After and RATE(n) verbatim; another address is not affected', async () => {
    const a = app({ now: () => 0 })
    const statuses: number[] = []
    let last: Response | null = null
    for (let i = 0; i < 11; i++) {
      last = await a.request('/api/session/nonce', { method: 'POST', headers: from(A) })
      statuses.push(last.status)
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]) // the burst
    expect(statuses[10]).toBe(429)
    expect(last!.headers.get('retry-after')).toBe('6')
    expect(await last!.json()).toEqual({ error: 'Too many requests from here in a short time. Wait 6 seconds, then try again.', code: 'RATE' })
    expect(RATE(6)).toBe('Too many requests from here in a short time. Wait 6 seconds, then try again.')
    expect((await a.request('/api/session/nonce', { method: 'POST', headers: from(B) })).status).toBe(200)
    // sign-in has its own bucket: the nonce's being spent does not spend it
    expect((await a.request('/api/session', { method: 'POST', headers: from(A) })).status).toBe(200)
  })

  it('writes are limited per session, reads per address', async () => {
    const a = app({ now: () => 0 })
    const put = (ip: string, token: string) => a.request('/api/registries/projects/p-1', { method: 'PUT', headers: from(ip, { cookie: `__Host-house_session=${token}` }) })
    // one session from two addresses shares its 20
    for (let i = 0; i < 10; i++) expect((await put(A, 'SENTINEL-token-1')).status).toBe(200)
    for (let i = 0; i < 10; i++) expect((await put(B, 'SENTINEL-token-1')).status).toBe(200)
    expect((await put(A, 'SENTINEL-token-1')).status).toBe(429)
    // another session from the same address has its own
    expect((await put(A, 'SENTINEL-token-2')).status).toBe(200)
    // reads: 100 from one address, then refused; the same address's writes are not spent by them
    for (let i = 0; i < 100; i++) expect((await a.request(`/api/proposals/p-${i}`, { headers: from(B) })).status).toBe(200)
    expect((await a.request('/api/proposals/p-x', { headers: from(B) })).status).toBe(429)
    expect((await a.request('/api/proposals/p-x', { headers: from(A) })).status).toBe(200)
    expect((await put(B, 'SENTINEL-token-3')).status).toBe(200)
  })

  it('X-Real-IP is read only with trustProxy', async () => {
    const socket = (ip: string) => ({ incoming: { socket: { remoteAddress: ip } } })
    const off = app({ trustProxy: false, now: () => 0 })
    for (let i = 0; i < 5; i++) {
      // a different X-Real-IP each time, one socket peer: one bucket
      expect((await off.request('/api/session/nonce', { method: 'POST', headers: from(`203.0.113.${i}`) }, socket(A))).status).toBe(200)
    }
    expect((await off.request('/api/session/nonce', { method: 'POST', headers: from('203.0.113.99') }, socket(A))).status).toBe(429)
    expect((await off.request('/api/session/nonce', { method: 'POST' }, socket(B))).status).toBe(200)
    const c = (headers: Record<string, string>, env: unknown, trust: boolean) => {
      let seen = ''
      const h = new Hono()
      h.get('/', ctx => { seen = clientAddress(ctx, trust); return ctx.text('') })
      return Promise.resolve(h.request('/', { headers }, env)).then(() => seen)
    }
    expect(await c(from(B), socket(A), true)).toBe(B)
    expect(await c(from(B), socket(A), false)).toBe(A)
    expect(await c({}, socket(A), true)).toBe(A) // no header: the peer
  })
})

describe('the WebSocket cap (a real hosted server)', () => {
  let repo: string
  let server: Running | null = null
  const sockets: WebSocket[] = []
  afterEach(async () => {
    for (const s of sockets.splice(0)) s.terminate()
    await server?.close(); server = null; removeFixtureRepo(repo)
  })

  function config(): HostedConfig {
    const r = readHostedConfig({ ORG_OS_PUBLIC_ORIGIN: 'https://hub.example.org', ORG_OS_BIND: '127.0.0.1', ORG_OS_PRIVATE_DIR: process.env.ORG_OS_PRIVATE_DIR! }, '/work/instance')
    if (!('config' in r)) throw new Error(r.refuse)
    return r.config
  }
  function upgrade(ip: string): Promise<string> {
    const ws = new WebSocket(`ws://127.0.0.1:${server!.port}/api/events`, { headers: { host: 'hub.example.org', origin: 'https://hub.example.org', 'x-real-ip': ip } })
    sockets.push(ws)
    return new Promise<string>(resolve => {
      ws.on('open', () => resolve('opened'))
      ws.on('unexpected-response', (_req, res) => resolve(`refused ${res.statusCode}`))
      ws.on('error', () => resolve('error'))
    })
  }

  it('the 11th WebSocket from one address is refused; another address opens; a closed one frees its place', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    repo = makeFixtureRepo()
    const appDist = join(repo, '.dist'); mkdirSync(appDist)
    writeFileSync(join(appDist, 'index.html'), '<!doctype html><title>admin</title>')
    server = await startServer({ repo, port: 0, appDist, hosted: true, hostedConfig: config(), fetch: async () => { throw new Error('no network in this test') } })
    expect(WS_PER_ADDRESS).toBe(10)
    for (let i = 0; i < 10; i++) expect(await upgrade(A)).toBe('opened')
    expect(await upgrade(A)).toBe('refused 429')
    expect(await upgrade(B)).toBe('opened')
    const first = sockets[0]!
    await new Promise<void>(done => { first.on('close', () => done()); first.close() })
    for (let i = 0; i < 50 && (await upgrade(A)) !== 'opened'; i++) await new Promise(r => setTimeout(r, 20))
    expect(await upgrade(A)).toBe('refused 429')
  })
})
