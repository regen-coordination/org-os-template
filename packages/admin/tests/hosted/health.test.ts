// The health route (L9 spec §5.11): public, { ok: true } with 200 while the store is open, { ok: false } with 503
// otherwise, and nothing else. Mounted in every mode (ruling P1); in PUBLIC_READS.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { request } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { mountHealth } from '../../server/hosted/health.ts'
import { PUBLIC_READS, publicMayAsk } from '../../server/visibility/gate.ts'
import { readHostedConfig } from '../../server/hosted/config.ts'
import { startServer, type Running } from '../../server/serve.ts'

const savedEnv = { ...process.env }
const restoreEnv = () => { for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]; Object.assign(process.env, savedEnv) }
afterEach(restoreEnv)

describe('mountHealth', () => {
  it('health: 200 { ok: true } with the store open, 503 { ok: false } with it down, nothing else in the body; public', async () => {
    let up = true
    const a = new Hono()
    mountHealth(a, { store: () => up })
    const res = await a.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"ok":true}')
    up = false
    const down = await a.request('/api/health')
    expect(down.status).toBe(503)
    expect(await down.text()).toBe('{"ok":false}')
    expect(PUBLIC_READS).toContain('/api/health')
    expect(publicMayAsk('GET', '/api/health')).toBe(true)
    expect(publicMayAsk('POST', '/api/health')).toBe(false)
  })
})

describe('a real server', () => {
  let repo: string
  let server: Running | null = null
  const dirs: string[] = []
  afterEach(async () => { await server?.close(); server = null; removeFixtureRepo(repo); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
  function get(path: string, host: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: server!.port, method: 'GET', path, headers: { host, connection: 'close' } }, res => {
        let body = ''
        res.on('data', c => { body += c })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      })
      req.on('error', reject)
      req.end()
    })
  }

  it('hosted, the public and the container\'s own check on loopback read it; a store that could not open is 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    repo = makeFixtureRepo()
    const r = readHostedConfig({ ORG_OS_PUBLIC_ORIGIN: 'https://hub.example.org', ORG_OS_BIND: '127.0.0.1', ORG_OS_PRIVATE_DIR: process.env.ORG_OS_PRIVATE_DIR! }, '/work/instance')
    if (!('config' in r)) throw new Error(r.refuse)
    server = await startServer({ repo, port: 0, hosted: true, hostedConfig: r.config, fetch: async () => { throw new Error('no network in this test') } })
    expect(await get('/api/health', 'hub.example.org')).toEqual({ status: 200, body: '{"ok":true}' })
    expect(await get('/api/health', `127.0.0.1:${server.port}`)).toEqual({ status: 200, body: '{"ok":true}' })
    await server.close(); server = null

    // a private dir that is a file: the store cannot open
    const d = mkdtempSync(join(tmpdir(), 'health-')); dirs.push(d)
    writeFileSync(join(d, 'not-a-folder'), 'x')
    const bad = readHostedConfig({ ORG_OS_PUBLIC_ORIGIN: 'https://hub.example.org', ORG_OS_BIND: '127.0.0.1', ORG_OS_PRIVATE_DIR: join(d, 'not-a-folder') }, '/work/instance')
    if (!('config' in bad)) throw new Error(bad.refuse)
    server = await startServer({ repo, port: 0, hosted: true, hostedConfig: bad.config, fetch: async () => { throw new Error('no network in this test') } })
    expect(await get('/api/health', 'localhost')).toEqual({ status: 503, body: '{"ok":false}' })
  })

  it('locally too (ruling P1)', async () => {
    repo = makeFixtureRepo()
    server = await startServer({ repo, port: 0 })
    expect(await get('/api/health', 'localhost')).toEqual({ status: 200, body: '{"ok":true}' })
  })
})
