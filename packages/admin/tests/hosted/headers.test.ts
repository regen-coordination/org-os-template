// Security headers when hosted (L9 spec §5.10): the CSP with the built index.html's prepaint hash, nosniff,
// Referrer-Policy, Permissions-Policy, and no-store on /api/*. Locally none of them. Fresh fixture repositories.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { request } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { prepaintHashes } from '../../server/hosted/headers.ts'
import { readHostedConfig, type HostedConfig } from '../../server/hosted/config.ts'
import { startServer, type Running } from '../../server/serve.ts'

const savedEnv = { ...process.env }
const restoreEnv = () => { for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]; Object.assign(process.env, savedEnv) }
afterEach(restoreEnv)

const PREPAINT = `
      (function () { var v = null; try { v = localStorage.getItem('org-os-admin.skin'); } catch (e) {} })();
    `
const INDEX = `<!doctype html>
<html><head><title>admin</title>
    <script>${PREPAINT}</script>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
</head><body><div id="root"></div></body></html>`
const sha = (text: string) => `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`

describe('prepaintHashes', () => {
  it('the CSP holds the hash of the built index.html\'s prepaint script: one hash per inline script, none for src scripts', () => {
    expect(prepaintHashes(INDEX)).toEqual([sha(PREPAINT)])
    expect(prepaintHashes('<script>a</script><SCRIPT type="text/javascript">b</SCRIPT><script src="/x.js"></script>')).toEqual([sha('a'), sha('b')])
    expect(prepaintHashes('<p>no scripts</p>')).toEqual([])
  })
})

describe('a server, hosted and local', () => {
  let repo: string
  let server: Running | null = null
  afterEach(async () => { await server?.close(); server = null; removeFixtureRepo(repo) })

  function config(): HostedConfig {
    const r = readHostedConfig({ ORG_OS_PUBLIC_ORIGIN: 'https://hub.example.org', ORG_OS_BIND: '127.0.0.1', ORG_OS_PRIVATE_DIR: process.env.ORG_OS_PRIVATE_DIR! }, '/work/instance')
    if (!('config' in r)) throw new Error(r.refuse)
    return r.config
  }
  async function start(hosted: boolean) {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    repo = makeFixtureRepo()
    const appDist = join(repo, '.dist'); mkdirSync(appDist)
    writeFileSync(join(appDist, 'index.html'), INDEX)
    server = await startServer({ repo, port: 0, appDist, ...(hosted ? { hosted: true, hostedConfig: config() } : {}), fetch: async () => { throw new Error('no network in this test') } })
  }
  function call(path: string, host: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: server!.port, method: 'GET', path, headers: { host, connection: 'close' } }, res => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }))
      })
      req.on('error', reject)
      req.end()
    })
  }
  const CSP = `default-src 'self'; script-src 'self' '${sha(PREPAINT)}'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss://hub.example.org; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`

  it('every hosted answer has the five headers; /api/* is no-store; local answers have none of them', async () => {
    await start(true)
    for (const [path, host] of [['/', 'hub.example.org'], ['/api/status', 'hub.example.org'], ['/api/nowhere', 'hub.example.org'], ['/api/status', 'elsewhere.example.org']] as const) {
      const res = await call(path, host)
      expect(res.headers['content-security-policy'], path).toBe(CSP)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['referrer-policy']).toBe('same-origin')
      expect(res.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()')
      if (path.startsWith('/api/')) expect(res.headers['cache-control']).toBe('no-store')
      else expect(res.headers['cache-control']).not.toBe('no-store')
    }
    expect((await call('/api/status', 'elsewhere.example.org')).status).toBe(403) // a refusal carries them too
    await server!.close(); server = null; removeFixtureRepo(repo)

    await start(false)
    for (const path of ['/', '/api/status']) {
      const res = await call(path, 'localhost')
      for (const h of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'permissions-policy']) expect(res.headers[h], `${path} ${h}`).toBeUndefined()
      expect(res.headers['cache-control']).not.toBe('no-store')
    }
  })
})
