import { describe, it, expect, afterEach, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { makeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { openPrivateStore, type RolesDoc } from '../../server/private/store.ts'
import { readSignInConfig, type SignInConfig } from '../../server/session/config.ts'
import { mountEmailSignIn, type EmailSignIn } from '../../server/session/email.ts'
import { recordingMailer } from '../../server/session/mail.ts'
import { Membership } from '../../server/session/membership.ts'
import { mountSession } from '../../server/session/routes.ts'
import { personSessionHash } from '../../server/session/sessions.ts'
import { personFromCookie, viewerRoles } from '../../server/session/person.ts'
import { NO_ROLE, withRequest } from '../../server/request.ts'
import { connectionViewer, mountVisibility } from '../../server/visibility/routes.ts'
import { MEMBERS_ONLY } from '../../server/visibility/gate.ts'
import type { HostedConfig } from '../../server/hosted/config.ts'
import { emailKey, verifySession, type SessionClaims } from '../../lib/session-token.mjs'

// Lane 3 Task 9: the person an I5 cookie names, on every request. Roles are read from the table now, not from the
// claims; a token with under 12 h left is re-issued with the Roles as they are; sign-out and a removed person end the
// session at the house. Hosted (no session is the public), so "as the public" can be seen. Synthetic values only.

const HUB = 'https://hub.example.org'
const HOST = 'localhost:4680'
const PEPPER = '0f'.repeat(32)
const T0 = new Date('2026-11-18T10:00:00.000Z')
const H = 3_600_000
const CELO = 'eip155:42220'
const ID = { steward: 'example-org:person:example-steward', both: 'example-org:person:example-both', contributor: 'example-org:person:example-contributor' }
const MAIL = { steward: 'steward@example.org', both: 'both@example.org', contributor: 'contributor@example.org' }
const DOC: RolesDoc = {
  roles_version: '2026-11-18',
  people: [
    { id: ID.steward, name: 'Example Steward', email_keys: [emailKey(MAIL.steward, PEPPER)], roles: ['network-member', 'steward'], nodes: [] },
    { id: ID.both, name: 'Example Both', email_keys: [emailKey(MAIL.both, PEPPER)], roles: ['steward', 'node-lead'], nodes: ['node-one', 'node-two'] },
    { id: ID.contributor, name: 'Example Contributor', email_keys: [emailKey(MAIL.contributor, PEPPER)], roles: [], nodes: [] },
  ],
}
// The steward is a member in git, and the governance role `council` lists them: they hold it beside their Roles.
const MEMBERS = `schema_version: "2.0"
members:
  - { id: "${ID.steward}", name: "Example Steward", kind: person }
`
const GOVERNANCE = `schema_version: "2.0"
governance:
  model: "steward-council"
  roles:
    council: { members: ["${ID.steward}"] }
`
const SYSTEMS = `schema_version: "2.0"
systems:
  - { id: hats-main, kind: hats-tree, name: Hats, chain: "${CELO}", address: "13", driver: hats-tree }
`

const cleanup: (() => void)[] = []
afterEach(() => { vi.restoreAllMocks(); for (const f of cleanup.splice(0).reverse()) { try { f() } catch { /* gone */ } } })

function signInConfig(name = 'org_session_dev'): SignInConfig {
  const read = readSignInConfig({
    HOUSE_EMAIL_PEPPER: PEPPER, HOUSE_SESSION_PRIVATE_JWK: JSON.stringify(generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })),
    SESSION_COOKIE_NAME: name, SESSION_COOKIE_DOMAIN: 'example.org', RESEND_API_KEY: 're_test_synthetic', MAIL_FROM: 'hub@example.org',
  }, { hosted: true, origin: HUB })
  if ('refuse' in read || read.config === null) throw new Error('no config')
  return read.config
}

async function house(o: { tree?: boolean; config?: SignInConfig } = {}) {
  const repo = makeFixtureRepo(); cleanup.push(() => rmSync(repo, { recursive: true, force: true }))
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'data', 'governance.yaml'), GOVERNANCE)
  if (o.tree) writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS)
  const dir = mkdtempSync(join(tmpdir(), 'person-store-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const store = await openPrivateStore(repo, { dir }); cleanup.push(() => store.close())
  await store.replaceRoles(DOC)
  const state = { clock: T0 }
  const now = () => state.clock
  const reader = {
    wearer: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
    wearers: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
  }
  const membership = new Membership({ repo, reader, now })
  const signIn = o.config ?? signInConfig()
  const mailer = recordingMailer()
  const hostedConfig = { origin: HUB, trustProxy: false } as HostedConfig
  const deps = { repo, hosted: true, membership, store, signIn, now }
  let email: EmailSignIn | undefined
  const app = createApp(repo, a => {
    mountSession(a, { repo, store, membership, hosted: true, signIn, now })
    email = mountEmailSignIn(a, { repo, store, config: signIn, mailer, now, hosted: hostedConfig })
    mountVisibility(a, { repo, membership })
  }, { request: withRequest(deps), hosted: true })
  return { app, repo, store, state, signIn, mailer, deps, settled: () => email!.settled() }
}
type House = Awaited<ReturnType<typeof house>>

function call(h: House, method: string, path: string, o: { cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { host: HOST }
  if (o.cookie) headers.cookie = o.cookie
  if (o.body !== undefined) headers['content-type'] = 'application/json'
  return h.app.request(`http://${HOST}${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
}
const cookiesOf = (res: Response) => res.headers.getSetCookie()
const jwsIn = (lines: string[], name = 'org_session_dev') => lines.map(l => new RegExp(`^${name}=([^;]*)`).exec(l)?.[1]).find(v => v !== undefined) ?? null

/** Signs `email` in through the emailed link; the I5 cookie for the Cookie header, and its claims. */
async function signIn(h: House, email: string): Promise<{ cookie: string; claims: SessionClaims }> {
  const before = h.mailer.sent.length
  await call(h, 'POST', '/api/session/email', { body: { email } })
  await h.settled()
  const token = new URL(h.mailer.sent[before]!.link).searchParams.get('token')!
  const res = await call(h, 'POST', '/api/session/link', { body: { token } })
  expect(res.status).toBe(200)
  const jws = jwsIn(cookiesOf(res))!
  return { cookie: `${h.signIn.cookie.name}=${jws}`, claims: verifySession(jws, h.signIn.publicJwk, h.state.clock)! }
}
const session = async (h: House, cookie?: string) => (await call(h, 'GET', '/api/session', cookie ? { cookie } : {})).json()

describe('the signed-in person on every request (Lane 3 Task 9)', () => {
  it('GET /api/session names the person, their Roles now, and the methods offered', async () => {
    const h = await house()
    const { cookie, claims } = await signIn(h, MAIL.steward)
    expect(await session(h, cookie)).toEqual({
      mode: 'hosted', signedIn: true, via: 'email', actor: ID.steward,
      person: { id: ID.steward, name: 'Example Steward', roles: ['network-member', 'steward'], nodes: [] },
      viewer: 'member', expiresAt: new Date(claims.exp * 1000).toISOString(),
      signIn: null, methods: ['email'], instanceWrites: 'on',
    })
    expect(await (await call(h, 'GET', '/api/actor', { cookie })).json()).toEqual({
      id: ID.steward, name: 'Example Steward', kind: 'person', via: 'email', roles: ['network-member', 'steward'], nodes: [],
    })
  })

  it('no role: profile only', async () => {
    const h = await house()
    const { cookie } = await signIn(h, MAIL.contributor)
    expect(await session(h, cookie)).toMatchObject({ signedIn: true, via: 'email', viewer: 'public', person: { id: ID.contributor, roles: [] } })
    // Their own Profile answers them.
    const me = await call(h, 'GET', '/api/actor', { cookie })
    expect([me.status, await me.json()]).toEqual([200, { id: ID.contributor, name: 'Example Contributor', kind: 'person', via: 'email', roles: [], nodes: [] }])
    // A members-level read is answered as the public's.
    expect(await (await call(h, 'GET', '/api/status', { cookie })).json()).toEqual({ org: 'Fixture Org' })
    const members = await call(h, 'GET', '/api/visibility', { cookie })
    expect([members.status, await members.json()]).toEqual([401, { error: MEMBERS_ONLY, code: 'SIGN_IN' }])
    // And no act.
    const write = await call(h, 'POST', '/api/registries/projects', { cookie, body: { id: 'p-x', name: 'X' } })
    expect([write.status, await write.json()]).toEqual([403, { error: NO_ROLE, reason: NO_ROLE, code: 'NO_ROLE' }])
    // The public, with no cookie, is not answered the Profile route.
    expect((await call(h, 'GET', '/api/actor')).status).toBe(401)
  })

  it('roles union', async () => {
    const h = await house()
    const both = await signIn(h, MAIL.both)
    expect([both.claims.roles, both.claims.nodes]).toEqual([['steward', 'node-lead'], ['node-one', 'node-two']])
    expect(await session(h, both.cookie)).toMatchObject({ viewer: 'member', person: { roles: ['steward', 'node-lead'], nodes: ['node-one', 'node-two'] } })
    const levels = (await (await call(h, 'GET', '/api/visibility', { cookie: both.cookie })).json()).levels as string[]
    expect(levels).toEqual(expect.arrayContaining(['role:steward', 'role:node-lead']))
    // A steward the governance role lists holds it beside their Roles (I2 ∪ governance roles); `maintainer`, which this
    // governance does not define, is every person member (F2-R2), as for a wallet member.
    const steward = await signIn(h, MAIL.steward)
    const theirs = (await (await call(h, 'GET', '/api/visibility', { cookie: steward.cookie })).json()).levels as string[]
    expect(theirs.filter(l => l.startsWith('role:'))).toEqual(['role:council', 'role:maintainer', 'role:network-member', 'role:steward'])
    expect(viewerRoles({ id: ID.both, name: '', roles: ['steward', 'node-lead'], nodes: [] }, ['council', 'steward'])).toEqual(['council', 'node-lead', 'steward'])
  })

  it('re-issue under 12 h', async () => {
    const h = await house()
    const { cookie, claims } = await signIn(h, MAIL.steward)
    h.state.clock = new Date(T0.getTime() + 12 * H + 1000)
    const res = await call(h, 'GET', '/api/session', { cookie })
    const fresh = jwsIn(cookiesOf(res))!
    expect(cookiesOf(res)).toEqual([`org_session_dev=${fresh}; Domain=example.org; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax`])
    const again = verifySession(fresh, h.signIn.publicJwk, h.state.clock, { iss: HUB })!
    expect(again).toMatchObject({ sub: ID.steward, jti: claims.jti, iat: h.state.clock.getTime() / 1000, exp: h.state.clock.getTime() / 1000 + 86_400 })
    // The house's row ends with the new token; the old cookie still ends at its own 24 h.
    expect(h.store.session(personSessionHash(claims.jti))?.expires).toBe(new Date(again.exp * 1000).toISOString())
    h.state.clock = new Date(T0.getTime() + 24 * H)
    expect(await session(h, cookie)).toMatchObject({ signedIn: false })
    expect(await session(h, `org_session_dev=${fresh}`)).toMatchObject({ signedIn: true })
  })

  it('no re-issue over 12 h', async () => {
    const h = await house()
    const { cookie } = await signIn(h, MAIL.steward)
    h.state.clock = new Date(T0.getTime() + 12 * H - 1000)
    const res = await call(h, 'GET', '/api/session', { cookie })
    expect(await res.json()).toMatchObject({ signedIn: true })
    expect(cookiesOf(res)).toEqual([])
  })

  it('a role removed at reload: gone at the house now, and from the re-issued token', async () => {
    const h = await house()
    const { cookie } = await signIn(h, MAIL.both)
    await h.store.replaceRoles({ ...DOC, people: DOC.people.map(p => (p.id === ID.both ? { ...p, roles: ['node-lead'], nodes: ['node-two'] } : p)) })
    // At once, with the old token's claims still saying steward.
    h.state.clock = new Date(T0.getTime() + H)
    const now = await call(h, 'GET', '/api/session', { cookie })
    expect(await now.json()).toMatchObject({ person: { roles: ['node-lead'], nodes: ['node-two'] } })
    expect(cookiesOf(now)).toEqual([])
    const levels = (await (await call(h, 'GET', '/api/visibility', { cookie })).json()).levels as string[]
    expect(levels).not.toContain('role:steward')
    // The next re-issue carries the Roles as they are.
    h.state.clock = new Date(T0.getTime() + 13 * H)
    const fresh = verifySession(jwsIn(cookiesOf(await call(h, 'GET', '/api/session', { cookie })))!, h.signIn.publicJwk, h.state.clock)!
    expect([fresh.roles, fresh.nodes]).toEqual([['node-lead'], ['node-two']])
  })

  it('a removed person: cookie cleared at the next visit', async () => {
    const h = await house()
    const { cookie, claims } = await signIn(h, MAIL.steward)
    await h.store.replaceRoles({ ...DOC, people: DOC.people.filter(p => p.id !== ID.steward) })
    const res = await call(h, 'GET', '/api/session', { cookie })
    expect(await res.json()).toMatchObject({ signedIn: false })
    expect(cookiesOf(res)).toEqual(['org_session_dev=; Domain=example.org; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax'])
    expect(h.store.session(personSessionHash(claims.jti))).toBeNull()
  })

  it('sign-out ends it at the house', async () => {
    const h = await house()
    const { cookie, claims } = await signIn(h, MAIL.steward)
    const out = await call(h, 'DELETE', '/api/session', { cookie })
    expect(out.status).toBe(204)
    expect(cookiesOf(out)).toEqual([
      'house_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure',
      'org_session_dev=; Domain=example.org; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax',
    ])
    expect(h.store.session(personSessionHash(claims.jti))).toBeNull()
    // The same cookie, replayed: the public.
    expect(await session(h, cookie)).toMatchObject({ signedIn: false })
    expect((await call(h, 'GET', '/api/visibility', { cookie })).status).toBe(401)
    expect(personFromCookie(h.store, h.signIn, cookie, () => h.state.clock)).toBeNull()
  })

  it('no tree: email offered, wallet not', async () => {
    const none = await house()
    expect(await session(none)).toEqual({ mode: 'hosted', signIn: null, signedIn: false, methods: ['email'], instanceWrites: 'on' })
    const tree = await house({ tree: true })
    expect(await session(tree)).toMatchObject({ signIn: { chainId: CELO, tree: `${CELO}:13` }, methods: ['email', 'wallet'] })
  })

  it('a staging cookie name is not read by a production config', async () => {
    const staging = await house({ config: signInConfig('org_session_dev') })
    const { cookie } = await signIn(staging, MAIL.steward)
    const production = await house({ config: signInConfig('org_session') })
    // The production house reads its own name only; renamed, the staging token still fails its key.
    expect(await session(production, cookie)).toMatchObject({ signedIn: false })
    expect(await session(production, cookie.replace(/^org_session_dev=/, 'org_session='))).toMatchObject({ signedIn: false })
  })

  it('the WebSocket upgrade reads the I5 cookie', async () => {
    const h = await house()
    const viewerOf = connectionViewer(h.deps)
    const steward = await signIn(h, MAIL.steward)
    expect(await viewerOf(steward.cookie)).toEqual({ kind: 'member', id: ID.steward, hats: [], roles: ['council', 'maintainer', 'network-member', 'steward'] })
    const contributor = await signIn(h, MAIL.contributor)
    expect(await viewerOf(contributor.cookie)).toEqual({ kind: 'public' })
    expect(await viewerOf(undefined)).toEqual({ kind: 'public' })
  })
})
