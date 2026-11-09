import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { makeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { openPrivateStore, type PrivateStore, type RolesDoc } from '../../server/private/store.ts'
import { readSignInConfig, type SignInConfig } from '../../server/session/config.ts'
import { mountEmailSignIn, type EmailSignIn, LINK_REFUSED, NEW_LINK, LINK_TTL_MS } from '../../server/session/email.ts'
import { recordingMailer } from '../../server/session/mail.ts'
import { personSessionHash, sessionFromCookie, tokenHash } from '../../server/session/sessions.ts'
import type { HostedConfig } from '../../server/hosted/config.ts'
import { emailKey, verifySession } from '../../lib/session-token.mjs'
import { main as houseRoles } from '../../scripts/house-roles.ts'
import { collectPortalInput } from '../../server/portal/inputs.ts'
import { scanPortal } from '../../server/portal/scan.ts'
import { CELO, PORTAL_ORIGIN, NOW, addr, makePortalInstance, standInReader } from '../fixtures/portal/instance.ts'

// Lane 3 Task 8: POST /api/session/link spends an emailed link once and answers the I5 cookie. Synthetic values only:
// keys are made per test, the mailer records, the addresses are example.org's.

const HUB = 'https://hub.example.org'
const PEPPER = '0f'.repeat(32)
const T0 = new Date('2026-11-18T10:00:00.000Z')
const STEWARD = 'steward@example.org', LEAD = 'lead@example.org', BOTH = 'both@example.org', CONTRIBUTOR = 'contributor@example.org'
const ID = { steward: 'example-org:person:example-steward', lead: 'example-org:person:example-lead', both: 'example-org:person:example-both', contributor: 'example-org:person:example-contributor' }
const DOC: RolesDoc = {
  roles_version: '2026-11-18',
  people: [
    { id: ID.steward, name: 'Example Steward', email_keys: [emailKey(STEWARD, PEPPER)], roles: ['network-member', 'steward'], nodes: [] },
    { id: ID.lead, name: 'Example Lead', email_keys: [emailKey(LEAD, PEPPER)], roles: ['network-member', 'node-lead'], nodes: ['node-one'] },
    { id: ID.both, name: 'Example Both', email_keys: [emailKey(BOTH, PEPPER)], roles: ['steward', 'node-lead'], nodes: ['node-one', 'node-two'] },
    { id: ID.contributor, name: 'Example Contributor', email_keys: [emailKey(CONTRIBUTOR, PEPPER)], roles: [], nodes: [] },
  ],
}

const cleanup: (() => void)[] = []
afterEach(() => { for (const f of cleanup.splice(0).reverse()) { try { f() } catch { /* gone */ } } })

const temp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(() => rmSync(d, { recursive: true, force: true })); return d }

/** A hosted sign-in configuration (I5's attributes) with its own key; `name` the cookie's, per environment. */
function hostedConfig(name = 'org_session_dev'): SignInConfig {
  const { privateKey } = generateKeyPairSync('ed25519')
  const read = readSignInConfig({
    HOUSE_EMAIL_PEPPER: PEPPER, HOUSE_SESSION_PRIVATE_JWK: JSON.stringify(privateKey.export({ format: 'jwk' })),
    SESSION_COOKIE_NAME: name, SESSION_COOKIE_DOMAIN: 'example.org', RESEND_API_KEY: 're_test_synthetic', MAIL_FROM: 'hub@example.org',
  }, { hosted: true, origin: HUB })
  if ('refuse' in read || read.config === null) throw new Error('no config')
  return read.config
}
function localConfig(): SignInConfig {
  const read = readSignInConfig({ HOUSE_EMAIL_PEPPER: PEPPER }, { hosted: false, origin: 'http://localhost:4680' })
  if ('refuse' in read || read.config === null) throw new Error('no config')
  return read.config
}

async function house(o: { config?: SignInConfig; local?: boolean; store?: PrivateStore; repo?: string; doc?: RolesDoc | null } = {}) {
  const repo = o.repo ?? (() => { const r = makeFixtureRepo(); cleanup.push(() => rmSync(r, { recursive: true, force: true })); return r })()
  const store = o.store ?? await (async () => { const s = await openPrivateStore(repo, { dir: temp('link-store-') }); cleanup.push(() => s.close()); return s })()
  if (o.doc !== null) await store.replaceRoles(o.doc ?? DOC)
  const config = o.config ?? (o.local ? localConfig() : hostedConfig())
  const state = { clock: T0 }
  const mailer = recordingMailer()
  const hosted = o.local ? {} : { hosted: { origin: HUB, trustProxy: false } as HostedConfig }
  let signIn: EmailSignIn | undefined
  const app = createApp(repo, a => { signIn = mountEmailSignIn(a, { repo, store, config, mailer, now: () => state.clock, ...hosted }) })
  return { app, store, config, state, mailer, host: 'localhost:4680', settled: () => signIn!.settled() }
}
type House = Awaited<ReturnType<typeof house>>

function post(h: House, path: string, body: unknown) {
  return h.app.request(`http://${h.host}${path}`, { method: 'POST', headers: { host: h.host, 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
/** Asks for a link for `email` and answers its token. */
async function linkFor(h: House, email: string, ret?: string): Promise<string> {
  const before = h.mailer.sent.length
  expect((await post(h, '/api/session/email', { email, ...(ret ? { return: ret } : {}) })).status).toBe(202)
  await h.settled()
  expect(h.mailer.sent).toHaveLength(before + 1)
  return new URL(h.mailer.sent[before]!.link).searchParams.get('token')!
}
const cookieOf = (res: Response) => res.headers.get('set-cookie') ?? ''
const jwsOf = (res: Response, name = 'org_session_dev') => new RegExp(`^${name}=([^;]+)`).exec(cookieOf(res))?.[1] ?? ''
const claimsOf = (h: House, res: Response) => verifySession(jwsOf(res, h.config.cookie.name), h.config.publicJwk, h.state.clock, { iss: h.config.issuer })

describe('POST /api/session/link (Lane 3 Task 8)', () => {
  it('link works once', async () => {
    const h = await house()
    const token = await linkFor(h, STEWARD, 'https://ideas.example.org/idea/7')
    const first = await post(h, '/api/session/link', { token })
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ signedIn: true, return: 'https://ideas.example.org/idea/7' })
    expect(claimsOf(h, first)?.sub).toBe(ID.steward)
    const again = await post(h, '/api/session/link', { token })
    expect(again.status).toBe(401)
    expect(await again.json()).toEqual({ error: LINK_REFUSED, hint: NEW_LINK, code: 'LINK_REFUSED' })
    expect(cookieOf(again)).toBe('')
  })

  it('link expires after 15 min', async () => {
    const h = await house()
    const token = await linkFor(h, STEWARD)
    h.state.clock = new Date(T0.getTime() + LINK_TTL_MS)
    const res = await post(h, '/api/session/link', { token })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: LINK_REFUSED, hint: NEW_LINK })
  })

  it('an unknown token is refused alike, and a malformed one is 400', async () => {
    const h = await house()
    const unknown = await post(h, '/api/session/link', { token: 'A'.repeat(43) })
    expect([unknown.status, await unknown.json()]).toEqual([401, { error: LINK_REFUSED, hint: NEW_LINK, code: 'LINK_REFUSED' }])
    for (const body of [{}, { token: 7 }, { token: 'has space' }, { token: 'short' }]) expect((await post(h, '/api/session/link', body)).status).toBe(400)
  })

  it('a person removed since the link was sent does not sign in', async () => {
    const h = await house()
    const token = await linkFor(h, STEWARD)
    await h.store.replaceRoles({ ...DOC, people: DOC.people.filter(p => p.id !== ID.steward) })
    const res = await post(h, '/api/session/link', { token })
    expect([res.status, await res.json()]).toEqual([401, { error: LINK_REFUSED, hint: NEW_LINK, code: 'LINK_REFUSED' }])
    expect(cookieOf(res)).toBe('')
  })

  it("cookie attributes are I5's", async () => {
    const h = await house()
    const res = await post(h, '/api/session/link', { token: await linkFor(h, STEWARD) })
    const jws = jwsOf(res)
    expect(jws).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(cookieOf(res)).toBe(`org_session_dev=${jws}; Domain=example.org; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax`)
    // Locally: no Domain and no Secure; the local name.
    const l = await house({ local: true })
    const local = await post(l, '/api/session/link', { token: await linkFor(l, STEWARD) })
    expect(cookieOf(local)).toBe(`house_person_dev=${jwsOf(local, 'house_person_dev')}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax`)
  })

  it('token exp is 24h', async () => {
    const h = await house()
    const res = await post(h, '/api/session/link', { token: await linkFor(h, STEWARD) })
    const claims = claimsOf(h, res)!
    expect(claims.iat).toBe(T0.getTime() / 1000)
    expect(claims.exp - claims.iat).toBe(86_400)
    expect(claims.iss).toBe(HUB)
    // The session row ends with the token.
    expect(h.store.session(personSessionHash(claims.jti))).toEqual({
      tokenHash: personSessionHash(claims.jti), account: ID.steward, created: T0.toISOString(), expires: new Date(T0.getTime() + 86_400_000).toISOString(),
    })
    expect(verifySession(jwsOf(res), h.config.publicJwk, new Date(T0.getTime() + 86_400_000))).toBeNull()
  })

  it('roles union (the claims)', async () => {
    const h = await house()
    const claims = claimsOf(h, await post(h, '/api/session/link', { token: await linkFor(h, BOTH) }))!
    expect([claims.sub, claims.roles, claims.nodes]).toEqual([ID.both, ['steward', 'node-lead'], ['node-one', 'node-two']])
  })

  it('no role: a cookie all the same, with no Roles in it', async () => {
    const h = await house()
    const res = await post(h, '/api/session/link', { token: await linkFor(h, CONTRIBUTOR) })
    expect(res.status).toBe(200)
    expect(claimsOf(h, res)).toMatchObject({ sub: ID.contributor, roles: [], nodes: [] })
  })

  it('a staging cookie name is not a production one: two configurations, two names, two keys', async () => {
    const staging = await house({ config: hostedConfig('org_session_dev') })
    const production = await house({ config: hostedConfig('org_session') })
    const s = await post(staging, '/api/session/link', { token: await linkFor(staging, STEWARD) })
    const p = await post(production, '/api/session/link', { token: await linkFor(production, STEWARD) })
    expect(cookieOf(s).startsWith('org_session_dev=')).toBe(true)
    expect(cookieOf(p).startsWith('org_session=')).toBe(true)
    expect(verifySession(jwsOf(s, 'org_session_dev'), production.config.publicJwk, T0)).toBeNull()
  })

  it('the session row is kept apart from a wallet session: its id opens no house_session', async () => {
    const h = await house()
    const claims = claimsOf(h, await post(h, '/api/session/link', { token: await linkFor(h, STEWARD) }))!
    expect(h.store.session(tokenHash(claims.jti))).toBeNull()
    expect(sessionFromCookie(h.store, `house_session=${claims.jti}`, () => T0)).toBeNull()
    expect(h.store.session(personSessionHash(claims.jti))?.account).toBe(ID.steward)
  })

  it('the server reads the roles a load wrote', async () => {
    const repo = makeFixtureRepo(); cleanup.push(() => rmSync(repo, { recursive: true, force: true }))
    const dir = temp('link-load-')
    const out: string[] = []
    const code = await houseRoles(['load'], { repo, env: { ORG_OS_PRIVATE_DIR: dir }, stdin: async () => JSON.stringify(DOC), out: t => out.push(t), err: () => {} })
    expect(code).toBe(0)
    const store = await openPrivateStore(repo, { dir }); cleanup.push(() => store.close())
    const h = await house({ repo, store, doc: null })
    const claims = claimsOf(h, await post(h, '/api/session/link', { token: await linkFor(h, LEAD) }))!
    expect([claims.sub, claims.roles, claims.nodes]).toEqual([ID.lead, ['network-member', 'node-lead'], ['node-one']])
  })
})

describe("the portal and a signed-in person (Lane I's batch 2 note, point 2)", () => {
  const page = (body: string) =>
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n\n<link rel="stylesheet" href="/assets/portal-1a2b.css">\n</head>\n<body>\n${body}\n<script type="module" src="/assets/portal-1a2b.js"></script>\n</body>\n</html>\n`

  it('a portal page that names a signed-in person still renders; a wallet account stays withheld', async () => {
    const inst = await makePortalInstance(); cleanup.push(() => inst.remove())
    const h = await house({ repo: inst.repo, store: inst.store })
    expect((await post(h, '/api/session/link', { token: await linkFor(h, STEWARD) })).status).toBe(200)
    const wallet = `${CELO}:${addr('b7')}`
    await inst.store.putSession({ tokenHash: 'f'.repeat(64), account: wallet, created: T0.toISOString(), expires: new Date(T0.getTime() + 86_400_000).toISOString() })
    expect(inst.store.allStrings().has(ID.steward)).toBe(false)
    expect(inst.store.allStrings().has(wallet)).toBe(true)
    const input = await collectPortalInput(inst.repo, { reader: standInReader(), store: inst.store, storeConfigured: true, now: NOW, portalOrigin: PORTAL_ORIGIN })
    if ('refuse' in input) throw new Error(input.refuse)
    const files = {
      'index.html': page(`<main><h1>Portal Test Org</h1><p>Steward: ${ID.steward}</p></main>`),
      'robots.txt': 'User-agent: *\nAllow: /\n',
    }
    expect(scanPortal(files, input)).toEqual([])
    // The wallet account is still refused where a page prints it.
    const leaked = scanPortal({ ...files, 'index.html': page(`<main><p>${wallet}</p></main>`) }, input)
    expect(leaked.map(p => p.file)).toEqual(['index.html'])
  }, 60_000)
})
