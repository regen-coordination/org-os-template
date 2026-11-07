import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { git } from '../changes/fixtures.ts'
import { startServer, type Running } from '../../server/serve.ts'
import { readHostedConfig } from '../../server/hosted/config.ts'
import { READ_ONLY } from '../../server/hosted/instance-writes.ts'
import { recordingMailer } from '../../server/session/mail.ts'
import { emailKey, verifySession } from '../../lib/session-token.mjs'
import { main as rolesMain } from '../../scripts/house-roles.ts'
import { main as keyMain, newPrivateJwk, publicJwkOf } from '../../scripts/house-session-key.ts'

// Lane 3 Task 12: the session key tool, and the emailed-link sign-in end to end on a real hosted server (startServer on
// a free port, a fresh repository under the temp directory, a recording mailer). Synthetic values only; no network.

const HUB = 'https://hub.example.org'
const PEPPER = '0f'.repeat(32)
const STEWARD = { id: 'refidao:person:example-steward', mail: 'steward@example.org' }

const cleanup: (() => void | Promise<void>)[] = []
const savedEnv = { ...process.env }
beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null')
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f()
  vi.unstubAllEnvs()
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k]
  Object.assign(process.env, savedEnv) // a hosted start sets the Hub's ident in process.env (L9 §5.5)
  vi.restoreAllMocks()
})
const tmp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(() => rmSync(d, { recursive: true, force: true })); return d }

async function run(argv: string[], stdin = '') {
  const out: string[] = [], err: string[] = []
  const code = await keyMain(argv, { stdin: async () => stdin, out: t => out.push(t), err: t => err.push(t) })
  return { code, out, err }
}

describe('npm run house:session-key (Lane 3 Task 12)', () => {
  it('new writes a private Ed25519 JWK and nothing else', async () => {
    const r = await run(['new'])
    expect([r.code, r.err]).toEqual([0, []])
    expect(r.out).toHaveLength(1)
    const jwk = JSON.parse(r.out[0]!) as JsonWebKey
    expect(Object.keys(jwk).sort()).toEqual(['crv', 'd', 'kty', 'x'])
    expect([jwk.kty, jwk.crv]).toEqual(['OKP', 'Ed25519'])
    expect(jwk.d).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // Two runs, two keys.
    expect(JSON.parse((await run(['new'])).out[0]!).d).not.toBe(jwk.d)
  })

  it('public derives the matching public JWK and drops d', async () => {
    const priv = newPrivateJwk()
    const r = await run(['public'], `${JSON.stringify(priv)}\n`)
    expect([r.code, r.err]).toEqual([0, []])
    expect(JSON.parse(r.out[0]!)).toEqual({ kty: 'OKP', crv: 'Ed25519', x: priv.x })
    expect(r.out[0]).not.toContain(priv.d!)
    // Without x, it is derived; with another key's x, refused.
    expect(publicJwkOf(JSON.stringify({ ...priv, x: undefined }))).toEqual({ kty: 'OKP', crv: 'Ed25519', x: priv.x })
    const other = newPrivateJwk()
    const wrong = await run(['public'], JSON.stringify({ ...priv, x: other.x }))
    expect([wrong.code, wrong.out]).toEqual([1, []])
    expect(wrong.err.join('\n')).not.toContain(priv.d!)
    // Not a key, or a public key alone: refused, and what was read is not repeated.
    for (const text of ['not json', JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: priv.x }), JSON.stringify({ kty: 'RSA', d: 'secret-ish' })]) {
      const bad = await run(['public'], text)
      expect([bad.code, bad.out]).toEqual([1, []])
      expect(bad.err.join('\n')).not.toMatch(/secret-ish|not json/)
    }
    expect((await run([])).code).toBe(1)
    expect((await run(['new', 'extra'])).code).toBe(1)
  })
})

describe('the sign-in round trip on a hosted server (Lane 3 Task 12)', () => {
  let server: Running | null = null

  /** One request to the hosted server, addressed to the Hub's host as its proxy would. */
  function http(method: string, path: string, o: { cookie?: string; body?: unknown } = {}): Promise<{ status: number; cookies: string[]; json: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const payload = o.body === undefined ? undefined : JSON.stringify(o.body)
      const headers: Record<string, string> = { host: 'hub.example.org', connection: 'close' }
      if (payload !== undefined) { headers['content-type'] = 'application/json'; headers.origin = HUB }
      if (o.cookie) headers.cookie = o.cookie
      const req = request({ host: '127.0.0.1', port: server!.port, method, path, headers }, res => {
        let text = ''
        res.on('data', d => { text += String(d) })
        res.on('end', () => {
          let json: Record<string, unknown> = {}
          try { json = JSON.parse(text) as Record<string, unknown> } catch { /* not JSON */ }
          const set = res.headers['set-cookie']
          resolve({ status: res.statusCode ?? 0, cookies: Array.isArray(set) ? set : set ? [set] : [], json })
        })
      })
      req.on('error', reject)
      req.end(payload)
    })
  }

  it('ask for a link, take it from the mailer, post it: the cookie, the Roles, a steward-gated read, and a write refused read-only', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}) // hosted with no backup key says so (§10.4)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const repo = makeFixtureRepo(); cleanup.push(() => removeFixtureRepo(repo))
    writeFileSync(join(repo, 'data', 'members.yaml'), `schema_version: "2.0"\nmembers:\n  - { id: "${STEWARD.id}", name: "Example Steward", kind: person }\n`)
    git(repo, 'commit -qam "fixture: the steward is a member"')
    const priv = newPrivateJwk()
    const env: Record<string, string> = {
      ORG_OS_HOSTED: '1', ORG_OS_PUBLIC_ORIGIN: HUB, ORG_OS_BIND: '127.0.0.1',
      ORG_OS_PRIVATE_DIR: tmp('rt-private-'), ORG_OS_ADMIN_HOME: tmp('rt-home-'), ORG_OS_PUSH: 'off',
      HOUSE_EMAIL_PEPPER: PEPPER, HOUSE_SESSION_PRIVATE_JWK: JSON.stringify(priv),
      SESSION_COOKIE_NAME: 'org_session_test', SESSION_COOKIE_DOMAIN: 'example.org',
      RESEND_API_KEY: 're_test_synthetic', MAIL_FROM: 'hub@example.org',
    }
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
    // The Roles, through house:roles (stdin only), into the store the hosted server opens.
    const doc = { roles_version: '2026-11-18', people: [{ id: STEWARD.id, name: 'Example Steward', email_keys: [emailKey(STEWARD.mail, PEPPER)], roles: ['network-member', 'steward'], nodes: [] }] }
    const said: string[] = []
    expect(await rolesMain(['load'], { repo, stdin: async () => JSON.stringify(doc), out: t => said.push(t), err: t => said.push(t), env })).toBe(0)
    expect(said).toEqual(['roles 2026-11-18: 1 people, 1 steward, 0 node-lead, 1 network-member'])
    const read = readHostedConfig(env, repo)
    if (!('config' in read)) throw new Error(read.refuse)
    const mailer = recordingMailer()
    server = await startServer({ repo, port: 0, hosted: true, hostedConfig: read.config, mailer, fetch: async () => { throw new Error('no network in this test') } })
    cleanup.push(async () => { await server?.close(); server = null })

    // Before: the public, the email method offered, writes off.
    expect(await http('GET', '/api/session').then(r => r.json)).toMatchObject({ mode: 'hosted', signedIn: false, methods: ['email'], instanceWrites: 'off' })
    expect((await http('GET', '/api/visibility')).status).toBe(401)

    // Ask: the same sentence; the link arrives at the mailer after the answer.
    const asked = await http('POST', '/api/session/email', { body: { email: ` ${STEWARD.mail.toUpperCase()} `, return: '/registries' } })
    expect([asked.status, asked.json]).toEqual([202, { sent: true, sentence: "If this address is on Fixture Org's records, a link is on its way." }])
    const end = Date.now() + 5000
    while (mailer.sent.length === 0 && Date.now() < end) await new Promise(r => setTimeout(r, 20))
    expect(mailer.sent).toHaveLength(1)
    const link = new URL(mailer.sent[0]!.link)
    expect(`${link.origin}${link.pathname}`).toBe(`${HUB}/sign-in/link`)

    // Post it: the I5 cookie, verifiable with the public key alone.
    const posted = await http('POST', '/api/session/link', { body: { token: link.searchParams.get('token') } })
    expect([posted.status, posted.json]).toEqual([200, { signedIn: true, return: '/registries' }])
    const line = posted.cookies.find(c => c.startsWith('org_session_test='))!
    expect(line).toMatch(/; Domain=example\.org; Path=\/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax$/)
    const jws = /^org_session_test=([^;]+)/.exec(line)![1]!
    const pub = publicJwkOf(JSON.stringify(priv)) as JsonWebKey
    expect(verifySession(jws, pub, new Date(), { iss: HUB })).toMatchObject({ sub: STEWARD.id, roles: ['network-member', 'steward'] })
    const cookie = `org_session_test=${jws}`

    // GET /api/session shows the Roles.
    expect((await http('GET', '/api/session', { cookie })).json).toMatchObject({
      signedIn: true, via: 'email', viewer: 'member', instanceWrites: 'off',
      person: { id: STEWARD.id, name: 'Example Steward', roles: ['network-member', 'steward'], nodes: [] },
    })
    // A steward-gated read answers; a write answers read-only, and the instance is as it was.
    const gated = await http('GET', '/api/visibility', { cookie })
    expect(gated.status).toBe(200)
    const head = git(repo, 'rev-parse HEAD')
    const write = await http('POST', '/api/registries/projects', { cookie, body: { id: 'p-x', title: 'X' } })
    expect([write.status, write.json]).toEqual([403, { error: READ_ONLY, code: 'INSTANCE_READ_ONLY' }])
    expect(git(repo, 'rev-parse HEAD')).toBe(head)
    // The link was spent: posting it again is refused.
    expect((await http('POST', '/api/session/link', { body: { token: link.searchParams.get('token') } })).status).toBe(401)
  }, 60_000)
})
