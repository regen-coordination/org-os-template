import { describe, it, expect, afterEach, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { openPrivateStore, type RolesDoc } from '../../server/private/store.ts'
import { readSignInConfig, type SignInConfig } from '../../server/session/config.ts'
import { Membership } from '../../server/session/membership.ts'
import { mountSession } from '../../server/session/routes.ts'
import { issueSession } from '../../server/session/person.ts'
import { personOf, withRequest } from '../../server/request.ts'
import { linkAccount, mountAccountLinks } from '../../server/network/links.ts'
import type { AtprotoIdentity } from '../../server/session/atproto.ts'
import { INSTANCE_WRITES } from '../../server/hosted/instance-writes.ts'
import { HOSTED_WRITES } from '../../server/hosted/writes.ts'
import { MEMBERS_ONLY } from '../../server/visibility/gate.ts'
import { emailKey } from '../../lib/session-token.mjs'

// Linking a member's own network account (refi-dao-os network app spec §5.3; plan task B4): a person signed in with
// their emailed link proves a Bluesky or Certified account is theirs by an OAuth round-trip (B2), and the Hub keeps the
// link (person id ↔ DID, and the handle to show it by) privately. Never matched in the background; unlinking is one
// button; linking shows nothing publicly. Synthetic values only.

const HUB = 'https://hub.example.org'
const HOST = 'localhost:4680'
const PEPPER = '0f'.repeat(32)
const T0 = new Date('2026-12-18T10:00:00.000Z')
const ONE = 'example-org:person:example-one'
const TWO = 'example-org:person:example-two'
const DOC: RolesDoc = {
  roles_version: '2026-12-18',
  people: [
    { id: ONE, name: 'Example One', email_keys: [emailKey('one@example.org', PEPPER)], roles: ['network-member'], nodes: [] },
    { id: TWO, name: 'Example Two', email_keys: [emailKey('two@example.org', PEPPER)], roles: ['steward'], nodes: [] },
  ],
}
const DID_A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const DID_B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'
const DID_NODE = 'did:plc:nnnnnnnnnnnnnnnnnnnnnnnn'

const cleanup: (() => void)[] = []
afterEach(() => { vi.restoreAllMocks(); for (const f of cleanup.splice(0).reverse()) { try { f() } catch { /* gone */ } } })

function signInConfig(): SignInConfig {
  const read = readSignInConfig({
    HOUSE_EMAIL_PEPPER: PEPPER, HOUSE_SESSION_PRIVATE_JWK: JSON.stringify(generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })),
    SESSION_COOKIE_NAME: 'org_session_dev', SESSION_COOKIE_DOMAIN: 'example.org', RESEND_API_KEY: 're_test_synthetic', MAIL_FROM: 'hub@example.org',
  }, { hosted: true, origin: HUB })
  if ('refuse' in read || read.config === null) throw new Error('no config')
  return read.config
}

async function house() {
  const repo = makeFixtureRepo(); cleanup.push(() => rmSync(repo, { recursive: true, force: true }))
  writeFileSync(join(repo, 'data', 'members.yaml'), 'schema_version: "2.0"\nmembers: []\n')
  const dir = mkdtempSync(join(tmpdir(), 'network-links-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const store = await openPrivateStore(repo, { dir }); cleanup.push(() => store.close())
  await store.replaceRoles(DOC)
  await store.putNetworkEntry({ id: 'ne-1', did: DID_NODE, node: 'refi-n', handle: 'refi-n.org', on: ['bluesky'], state: 'live', why: 'domain',
    added: '2026-12-18', addedBy: DID_NODE, check: 'pass', checkedOn: '2026-12-18', reason: null, channel: null, decided: null })
  const now = () => T0
  const reader = {
    wearer: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
    wearers: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
  }
  const membership = new Membership({ repo, reader, now })
  const signIn = signInConfig()
  const current = (c: Parameters<typeof personOf>[0]) => { const p = personOf(c); return p?.kind === 'person' ? p.person.id : null }
  const handler = linkAccount({ store, personOf: current, now })
  const app = createApp(repo, a => {
    mountSession(a, { repo, store, membership, hosted: true, signIn, now, atproto: true })
    mountAccountLinks(a, { store, personOf: current })
    // Stands in for B2's callback: the round-trip was started by `by` and proved `did`.
    a.get('/api/session/atproto/proven', c => handler(c, {
      did: c.req.query('did')!, handle: c.req.query('handle') ?? 'handle.invalid', scope: 'atproto', purpose: 'link', node: null, by: c.req.query('by') ?? null,
    } satisfies AtprotoIdentity))
  }, { request: withRequest({ repo, hosted: true, membership, store, signIn, now }), hosted: true })
  const cookieOf = async (sub: string, roles: string[]) => /^([^;]*)/.exec(await issueSession(store, signIn, { sub, roles, nodes: [] }, T0))![1]!
  return { app, store, one: await cookieOf(ONE, ['network-member']), two: await cookieOf(TWO, ['steward']) }
}
type House = Awaited<ReturnType<typeof house>>

function call(h: House, method: string, path: string, cookie?: string) {
  const headers: Record<string, string> = { host: HOST }
  if (cookie) headers.cookie = cookie
  return h.app.request(`http://${HOST}${path}`, { method, headers })
}
const proven = (h: House, cookie: string | undefined, did: string, by: string | null, handle = 'me.bsky.social') =>
  call(h, 'GET', `/api/session/atproto/proven?did=${encodeURIComponent(did)}&handle=${encodeURIComponent(handle)}${by ? `&by=${encodeURIComponent(by)}` : ''}`, cookie)

describe('linking (the round-trip\'s link purpose)', () => {
  it('links the proven account to the person who started it, with its handle, and goes back to their links', async () => {
    const h = await house()
    const res = await proven(h, h.one, DID_A, ONE, 'one.bsky.social')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/account-links?linked=1')
    expect(h.store.accountLink(DID_A)).toEqual({ did: DID_A, personId: ONE, handle: 'one.bsky.social', linked: T0.toISOString() })
  })

  it('a linked DID\'s Guest row goes', async () => {
    const h = await house()
    await h.store.putGuest(DID_A, 'one.bsky.social', T0)
    await proven(h, h.one, DID_A, ONE)
    expect(h.store.guest(DID_A)).toBe(null)
  })

  it('needs a signed-in person: a round-trip with no one behind it, or a Guest, is refused', async () => {
    const h = await house()
    expect((await proven(h, undefined, DID_A, null)).status).toBe(401)
    expect(h.store.accountLink(DID_A)).toBe(null)
  })

  it('the person who comes back must be the one who started it', async () => {
    const h = await house()
    expect((await proven(h, h.two, DID_A, ONE)).status).toBe(401)
    expect((await proven(h, undefined, DID_A, ONE)).status).toBe(401)
    expect(h.store.accountLink(DID_A)).toBe(null)
  })

  it('a DID linked to another person is refused; linking your own again is fine', async () => {
    const h = await house()
    await proven(h, h.one, DID_A, ONE)
    expect((await proven(h, h.two, DID_A, TWO)).status).toBe(409)
    expect(h.store.accountLink(DID_A)?.personId).toBe(ONE)
    expect((await proven(h, h.one, DID_A, ONE)).status).toBe(303)
  })

  it('a node\'s live account is never a person\'s: refused', async () => {
    const h = await house()
    expect((await proven(h, h.one, DID_NODE, ONE)).status).toBe(409)
    expect(h.store.accountLink(DID_NODE)).toBe(null)
  })
})

describe('the links routes', () => {
  it('GET lists the signed-in person\'s own links, and nobody else\'s', async () => {
    const h = await house()
    await proven(h, h.one, DID_A, ONE, 'one.bsky.social')
    await proven(h, h.two, DID_B, TWO, 'two.certified.one')
    const res = await call(h, 'GET', '/api/session/atproto/links', h.one)
    expect(await res.json()).toEqual({ links: [{ did: DID_A, handle: 'one.bsky.social', linked: T0.toISOString() }] })
  })

  it('GET for the public is the members-only refusal', async () => {
    const h = await house()
    const res = await call(h, 'GET', '/api/session/atproto/links')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: MEMBERS_ONLY, code: 'SIGN_IN' })
  })

  it('DELETE unlinks your own; another person\'s is not found; the public is refused', async () => {
    const h = await house()
    await proven(h, h.one, DID_A, ONE)
    expect((await call(h, 'DELETE', `/api/session/atproto/links/${encodeURIComponent(DID_A)}`, h.two)).status).toBe(404)
    expect((await call(h, 'DELETE', `/api/session/atproto/links/${encodeURIComponent(DID_A)}`)).status).toBe(401)
    expect(h.store.accountLink(DID_A)).not.toBe(null)
    expect((await call(h, 'DELETE', `/api/session/atproto/links/${encodeURIComponent(DID_A)}`, h.one)).status).toBe(204)
    expect(h.store.accountLink(DID_A)).toBe(null)
  })

  it('the unlink route is named in both write tables, as a session write', () => {
    expect(INSTANCE_WRITES).toContainEqual({ method: 'DELETE', path: '/api/session/atproto/links/:did', class: 'session' })
    expect(HOSTED_WRITES).toContainEqual({ method: 'DELETE', path: '/api/session/atproto/links/:did', class: 'session' })
  })
})
