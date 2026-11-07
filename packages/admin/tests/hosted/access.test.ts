// The access log when hosted (L9 spec §7.4, Q-L9-7): one line per request, { t, method, route, status, ms }, where
// route is the matched path. No query, no cookie, no address and no actor.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { request } from 'node:http'
import { Hono } from 'hono'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { accessLog } from '../../server/hosted/access.ts'
import { readHostedConfig } from '../../server/hosted/config.ts'
import { startServer, type Running } from '../../server/serve.ts'

const savedEnv = { ...process.env }
const restoreEnv = () => { for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]; Object.assign(process.env, savedEnv) }
afterEach(restoreEnv)

describe('accessLog', () => {
  it('an access line holds route /api/proposals/:id, not the id, and no query, cookie, address or actor', async () => {
    const lines: string[] = []
    const a = new Hono()
    a.use('*', accessLog(l => lines.push(l)))
    a.get('/api/proposals/:id', c => c.json({ id: c.req.param('id') }))
    a.all('/api/*', c => c.json({ error: 'none' }, 404))
    await a.request('/api/proposals/p-2026-11-04-001-a1b2?SENTINEL-query-1=x', {
      headers: { cookie: '__Host-house_session=SENTINEL-token-1', 'x-real-ip': '192.0.2.10', 'x-actor': 'steward-a' },
    })
    await a.request('/api/SENTINEL-path-1', { method: 'DELETE' })
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(Object.keys(first).sort()).toEqual(['method', 'ms', 'route', 'status', 't'])
    expect(first).toMatchObject({ method: 'GET', route: '/api/proposals/:id', status: 200 })
    expect(typeof first.ms).toBe('number')
    expect(new Date(first.t as string).toISOString()).toBe(first.t)
    expect(JSON.parse(lines[1]!)).toMatchObject({ method: 'DELETE', route: '-', status: 404 })
    for (const l of lines) for (const bad of ['p-2026-11-04-001-a1b2', 'SENTINEL', '192.0.2.10', 'steward-a', '?']) expect(l).not.toContain(bad)
  })

  it('a hosted server writes one line per request to stdout; a local one writes none', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const repo = makeFixtureRepo()
    let server: Running | null = null
    try {
      const r = readHostedConfig({ ORG_OS_PUBLIC_ORIGIN: 'https://hub.example.org', ORG_OS_BIND: '127.0.0.1', ORG_OS_PRIVATE_DIR: process.env.ORG_OS_PRIVATE_DIR! }, '/work/instance')
      if (!('config' in r)) throw new Error(r.refuse)
      server = await startServer({ repo, port: 0, hosted: true, hostedConfig: r.config, fetch: async () => { throw new Error('no network in this test') } })
      const get = (path: string) => new Promise<void>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: server!.port, path, headers: { host: 'hub.example.org', connection: 'close' } }, res => { res.resume(); res.on('end', () => resolve()) })
        req.on('error', reject); req.end()
      })
      log.mockClear()
      await get('/api/proposals/p-2026-11-04-001-a1b2')
      const lines = log.mock.calls.map(c => String(c[0])).filter(l => l.startsWith('{'))
      expect(lines).toHaveLength(1)
      expect(JSON.parse(lines[0]!)).toMatchObject({ method: 'GET', route: '/api/proposals/:id' })
      await server.close()
      server = await startServer({ repo, port: 0 })
      log.mockClear()
      const local = () => new Promise<void>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: server!.port, path: '/api/status', headers: { host: 'localhost', connection: 'close' } }, res => { res.resume(); res.on('end', () => resolve()) })
        req.on('error', reject); req.end()
      })
      await local()
      expect(log.mock.calls.map(c => String(c[0])).filter(l => l.startsWith('{'))).toEqual([])
    } finally {
      await server?.close()
      removeFixtureRepo(repo)
    }
  })
})
