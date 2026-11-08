// SIWE behind a TLS proxy and the hosted cookie (L9 spec §5.2, §5.8; Review Focus 1 and 5). Behind the proxy the server
// sees `http://` and its own port; the message must still name the configured host and `https://` origin, and nothing
// the proxy forwards changes that. When hosted, the session cookie is the host-only `__Host-house_session`, and a
// `house_session` cookie is not read. Fresh fixture repositories under the temp directory, stores in temp folders of
// their own, a fake Hats reader (no network, ruling S13); signing keys are made here (tests/session/keys.ts).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { request } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { makeFixtureRepo } from '../fixtures.ts'
import { addressOfKey, key, sign } from '../session/keys.ts'
import { createApp } from '../../server/app.ts'
import { withRequest } from '../../server/request.ts'
import { readHostedConfig, type HostedConfig } from '../../server/hosted/config.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { Membership } from '../../server/session/membership.ts'
import { mountSession } from '../../server/session/routes.ts'
import { clearedCookie, sessionCookie, sessionCookieName, sessionFromCookie, sessionToken } from '../../server/session/sessions.ts'
import { startServer, type Running } from '../../server/serve.ts'
import { connectionViewer } from '../../server/visibility/routes.ts'
import { parseSiweMessage } from '../../lib/siwe.mjs'
import { HOUSE_IDENT } from '../../lib/trailers.mjs'
import type { WearerReading } from '../../server/systems/hats.ts'

const savedEnv = { ...process.env }
const restoreEnv = () => { for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]; Object.assign(process.env, savedEnv) }
afterEach(restoreEnv) // startServer hosted sets the Hub's ident in process.env (L9 §5.5)

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const T0 = new Date('2026-10-30T10:00:00.000Z')
const ORIGIN = 'https://hub.example.org'
const HOST = 'hub.example.org'
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "steward-council"
  membership: { tree: hats-main }
  roles:
    council: { hat: "${COUNCIL}" }
`
const OTHER_ADDRESS = 'The wallet signed with another address than the one it gave. Choose one address in the wallet and sign again.'
// What the proxy forwards, and what a client may send in its place: none of it is read.
const FORWARDED = { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'evil.example.org', 'x-forwarded-port': '4680' }

function config(env: Record<string, string> = {}): HostedConfig {
  const r = readHostedConfig({ ORG_OS_PUBLIC_ORIGIN: ORIGIN, ORG_OS_BIND: '127.0.0.1', ORG_OS_PRIVATE_DIR: process.env.ORG_OS_PRIVATE_DIR!, ...env }, '/work/instance')
  if (!('config' in r)) throw new Error(r.refuse)
  return r.config
}

const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

function treeRepo(): string {
  const repo = makeFixtureRepo(); cleanup.push(repo)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  writeFileSync(join(repo, 'data', 'governance.yaml'), GOVERNANCE)
  return repo
}

/** A hosted house with its binding: the hosted guard, the session routes with the configuration, a fake Hats reader. */
async function house(cfg: HostedConfig = config({ ORG_OS_PORTAL_ORIGIN: 'https://portal.example.test' })) {
  const repo = treeRepo()
  const dir = mkdtempSync(join(tmpdir(), 'hosted-session-store-')); cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const now = () => T0
  const reader = {
    wearer: vi.fn(async (_s: Record<string, unknown>, account: string): Promise<WearerReading> =>
      ({ ok: true, system: 'hats-main', chain: CELO, account, hats: [COUNCIL], block: 100, readAt: T0.toISOString() })),
    wearers: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
  }
  const membership = new Membership({ repo, reader, now })
  const deps = { repo, hosted: true, membership, store, now, config: cfg }
  const app = createApp(repo, a => mountSession(a, deps), {
    guard: { kind: 'hosted', host: cfg.host, origin: cfg.origin },
    request: withRequest(deps),
  })
  return { app, repo, store, membership, deps }
}

/** A request as the proxy hands it on: the container's own address and scheme in the URL, the public Host preserved. */
function call(app: Hono, method: string, path: string, o: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: HOST, origin: ORIGIN, ...FORWARDED, ...o.headers }
  if (o.body !== undefined) headers['content-type'] = 'application/json'
  if (o.cookie) headers.cookie = o.cookie
  return app.request(`http://127.0.0.1:4680${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
}
async function signIn(app: Hono, sk: Uint8Array) {
  const n = await (await call(app, 'POST', '/api/session/nonce', { body: { address: addressOfKey(sk) } })).json() as { nonce: string; message: string }
  return call(app, 'POST', '/api/session', { body: { nonce: n.nonce, signature: sign(sk, n.message) } })
}
const cookieOf = (res: Response) => res.headers.get('set-cookie') ?? ''
const hostTokenOf = (res: Response) => /^__Host-house_session=([^;]*)/.exec(cookieOf(res))?.[1] ?? ''

describe('SIWE behind the proxy names the public origin (a real server on localhost, Review Focus 1)', () => {
  let server: Running | null = null
  afterEach(async () => { await server?.close(); server = null })

  function raw(method: string, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const text = JSON.stringify(body)
      const req = request({
        host: '127.0.0.1', port: server!.port, method, path,
        headers: { host: HOST, origin: ORIGIN, 'content-type': 'application/json', connection: 'close', ...FORWARDED },
      }, res => {
        let out = ''
        res.on('data', chunk => { out += chunk })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(out) }))
      })
      req.on('error', reject)
      req.end(text)
    })
  }

  it('the message\'s domain is hub.example.org and its URI https://hub.example.org/; verify compares with the configured values', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}) // hosted with no backup key says so (§10.4)
    const repo = treeRepo()
    server = await startServer({ repo, port: 0, hosted: true, hostedConfig: config(), fetch: async () => { throw new Error('no network in this test') } })
    expect(process.env.GIT_AUTHOR_EMAIL).toBe(HOUSE_IDENT.email) // hosted start set the Hub's ident (L9 §5.5)
    expect(process.env.GIT_COMMITTER_EMAIL).toBe(HOUSE_IDENT.email)
    const sk = key()
    const n = await raw('POST', '/api/session/nonce', { address: addressOfKey(sk) })
    expect(n.status).toBe(200)
    expect(parseSiweMessage(n.json.message as string)).toMatchObject({ domain: 'hub.example.org', uri: 'https://hub.example.org/' })
    // The kept message is judged against the configuration, not the request URL (http://127.0.0.1:<port>): step 2's
    // checks pass, and the answer is step 3's, about the signer.
    const res = await raw('POST', '/api/session', { nonce: n.json.nonce, signature: sign(key(), n.json.message as string) })
    expect(res.status).toBe(401)
    expect(res.json).toEqual({ error: OTHER_ADDRESS })
  })
})

describe('SIWE from configuration (the app)', () => {
  it('a sign-in behind the proxy succeeds against the configured origin', async () => {
    const { app } = await house()
    const sk = key()
    const n = await (await call(app, 'POST', '/api/session/nonce', { body: { address: addressOfKey(sk) } })).json() as { nonce: string; message: string }
    expect(parseSiweMessage(n.message)).toMatchObject({ domain: HOST, uri: `${ORIGIN}/` })
    const res = await call(app, 'POST', '/api/session', { body: { nonce: n.nonce, signature: sign(sk, n.message) } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ mode: 'hosted', signedIn: true, account: `${CELO}:${addressOfKey(sk)}` })
  })

  it('GET /api/session answers the portal origin, or null when there is none (and as door, its name until 0.6.2)', async () => {
    const P = 'https://portal.example.test'
    const withPortal = await house()
    expect(await (await call(withPortal.app, 'GET', '/api/session')).json()).toMatchObject({ mode: 'hosted', signedIn: false, portal: P, door: P })
    const token = hostTokenOf(await signIn(withPortal.app, key()))
    expect(await (await call(withPortal.app, 'GET', '/api/session', { cookie: `__Host-house_session=${token}` })).json())
      .toMatchObject({ signedIn: true, portal: P, door: P })
    const noPortal = await house(config())
    expect(await (await call(noPortal.app, 'GET', '/api/session')).json()).toMatchObject({ signedIn: false, portal: null, door: null })
  })
})

describe('the hosted cookie (Review Focus 5)', () => {
  it('is __Host-house_session=…; HttpOnly; SameSite=Strict; Path=/; Secure, with no Domain', async () => {
    const { app } = await house()
    const res = await signIn(app, key())
    expect(res.status).toBe(200)
    const token = hostTokenOf(res)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(cookieOf(res)).toBe(`__Host-house_session=${token}; HttpOnly; SameSite=Strict; Path=/; Secure`)
    expect(cookieOf(res)).not.toMatch(/domain/i)
    const out = await call(app, 'DELETE', '/api/session', { cookie: `__Host-house_session=${token}` })
    expect(out.status).toBe(204)
    expect(cookieOf(out)).toBe('__Host-house_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure')
    expect(await (await call(app, 'GET', '/api/session', { cookie: `__Host-house_session=${token}` })).json()).toMatchObject({ signedIn: false })
  })

  it('a house_session cookie is ignored when hosted: the routes, the request\'s actor and the WebSocket\'s viewer', async () => {
    const { app, store, deps } = await house()
    const token = hostTokenOf(await signIn(app, key()))
    expect(await (await call(app, 'GET', '/api/session', { cookie: `house_session=${token}` })).json()).toMatchObject({ signedIn: false })
    expect(await (await call(app, 'GET', '/api/session', { cookie: `house_session=x; __Host-house_session=${token}` })).json()).toMatchObject({ signedIn: true })
    // a write carrying only the plain name has no actor: 401, before any route
    const write = await call(app, 'POST', '/api/registries/ideas', { body: { id: 'idea-x', title: 'T', status: 'surfaced' }, cookie: `house_session=${token}` })
    expect(write.status).toBe(401)
    expect(await write.json()).toMatchObject({ code: 'SIGN_IN' })
    // signing out with the plain name ends nothing
    await call(app, 'DELETE', '/api/session', { cookie: `house_session=${token}` })
    expect(sessionFromCookie(store, `__Host-house_session=${token}`, () => T0, true)).not.toBeNull()
    expect(sessionFromCookie(store, `house_session=${token}`, () => T0, true)).toBeNull()
    // the WebSocket upgrade reads the connection's viewer the same way
    const viewer = connectionViewer(deps)
    expect(await viewer(`house_session=${token}`)).toEqual({ kind: 'public' })
    expect((await viewer(`__Host-house_session=${token}`)).kind).toBe('member')
  })

  it('the names and values by mode', () => {
    expect(sessionCookieName(false)).toBe('house_session')
    expect(sessionCookieName(true)).toBe('__Host-house_session')
    expect(sessionToken('a=b; house_session=t1; __Host-house_session=t2')).toBe('t1')
    expect(sessionToken('a=b; house_session=t1; __Host-house_session=t2', true)).toBe('t2')
    expect(sessionToken('house_session=t1', true)).toBe('')
    expect(sessionCookie('t', true)).toBe('__Host-house_session=t; HttpOnly; SameSite=Strict; Path=/; Secure')
    expect(sessionCookie('t', false)).toBe('house_session=t; HttpOnly; SameSite=Strict; Path=/')
    expect(clearedCookie(true)).toBe('__Host-house_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure')
    expect(clearedCookie(false)).toBe('house_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
  })
})
