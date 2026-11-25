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
import { withRequest } from '../../server/request.ts'
import { signInWithAccount } from '../../server/network/signin.ts'
import type { AtprotoIdentity } from '../../server/session/atproto.ts'
import { emailKey, verifySession, type SessionClaims } from '../../lib/session-token.mjs'

// Sign-in with a Bluesky or Certified account (refi-dao-os network app spec §5.1, §5.7; plan task B3). A DID linked to a
// person signs in as that person with their Roles; any other is a Guest: `sub` guest:<did>, no Roles, kept by DID and
// handle only. Both get the shared ReFi DAO cookie, issued by the same function as the emailed link, which the org's
// other sites verify with the Hub's public key. The OAuth round-trip itself is B2's; here its result is handed in.

const HUB = 'https://hub.example.org'
const HOST = 'localhost:4680'
const PEPPER = '0f'.repeat(32)
const T0 = new Date('2026-12-18T10:00:00.000Z')
const STEWARD = 'example-org:person:example-steward'
const GONE = 'example-org:person:example-gone'
const DOC: RolesDoc = {
  roles_version: '2026-12-18',
  people: [{ id: STEWARD, name: 'Example Steward', email_keys: [emailKey('steward@example.org', PEPPER)], roles: ['network-member', 'steward'], nodes: ['node-one'] }],
}
const DID_LINKED = 'did:plc:llllllllllllllllllllllll'
const DID_GUEST = 'did:plc:gggggggggggggggggggggggg'
const DID_GONE = 'did:plc:oooooooooooooooooooooooo'

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

async function house(o: { signIn?: SignInConfig | null } = {}) {
  const repo = makeFixtureRepo(); cleanup.push(() => rmSync(repo, { recursive: true, force: true }))
  writeFileSync(join(repo, 'data', 'members.yaml'), 'schema_version: "2.0"\nmembers: []\n')
  const dir = mkdtempSync(join(tmpdir(), 'network-signin-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const store = await openPrivateStore(repo, { dir }); cleanup.push(() => store.close())
  await store.replaceRoles(DOC)
  await store.putAccountLink({ did: DID_LINKED, personId: STEWARD, handle: 'steward.bsky.social', linked: T0.toISOString() })
  await store.putAccountLink({ did: DID_GONE, personId: GONE, handle: 'gone.bsky.social', linked: T0.toISOString() })
  const state = { clock: T0 }
  const now = () => state.clock
  const reader = {
    wearer: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
    wearers: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
  }
  const membership = new Membership({ repo, reader, now })
  const signIn = o.signIn === undefined ? signInConfig() : o.signIn
  const handler = signInWithAccount({ store, signIn, now })
  const app = createApp(repo, a => {
    mountSession(a, { repo, store, membership, hosted: true, signIn, now, atproto: true })
    // Stands in for B2's callback, which hands the proven account to the purpose's handler.
    a.get('/api/session/atproto/proven', c => handler(c, {
      did: c.req.query('did')!, handle: c.req.query('handle') ?? 'handle.invalid', scope: 'atproto', purpose: 'sign-in', node: null, by: null, return: c.req.query('return') ?? null,
    } satisfies AtprotoIdentity))
    a.put('/api/registries/:name/:id', c => c.json({ wrote: true }))
  }, { request: withRequest({ repo, hosted: true, membership, store, signIn, now }), hosted: true })
  return { app, store, signIn, state }
}
type House = Awaited<ReturnType<typeof house>>

function call(h: House, method: string, path: string, cookie?: string) {
  const headers: Record<string, string> = { host: HOST }
  if (cookie) headers.cookie = cookie
  const write = method === 'PUT' || method === 'POST'
  if (write) headers['content-type'] = 'application/json'
  return h.app.request(`http://${HOST}${path}`, { method, headers, ...(write ? { body: '{}' } : {}) })
}
const jwsOf = (res: Response) => res.headers.getSetCookie().map(l => /^org_session_dev=([^;]*)/.exec(l)?.[1]).find(v => v !== undefined) ?? null
async function proven(h: House, did: string, handle = 'someone.bsky.social') {
  const res = await call(h, 'GET', `/api/session/atproto/proven?did=${encodeURIComponent(did)}&handle=${encodeURIComponent(handle)}`)
  const jws = jwsOf(res)
  return { res, jws, cookie: jws ? `org_session_dev=${jws}` : '', claims: jws ? verifySession(jws, h.signIn!.publicJwk, h.state.clock) as SessionClaims | null : null }
}

describe('a proven account signs in', () => {
  it('goes back to where the sign-in started (B8: the network site), else to the Hub\'s home', async () => {
    const h = await house()
    const back = 'https://network.example.org/refi-x/'
    const res = await call(h, 'GET', `/api/session/atproto/proven?did=${encodeURIComponent(DID_GUEST)}&handle=g.bsky.social&return=${encodeURIComponent(back)}`)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(back)
    expect((await proven(h, DID_GUEST)).res.headers.get('location')).toBe('/')
  })

  it('a linked DID signs in as that person, with their Roles and nodes', async () => {
    const h = await house()
    const { res, claims } = await proven(h, DID_LINKED)
    expect(res.status).toBe(303)
    expect(claims).toMatchObject({ iss: HUB, sub: STEWARD, roles: ['network-member', 'steward'], nodes: ['node-one'] })
    expect(h.store.guest(DID_LINKED)).toBe(null)
  })

  it('any other DID is a Guest: guest:<did>, no Roles, kept by DID and handle', async () => {
    const h = await house()
    const { claims } = await proven(h, DID_GUEST, 'guest.bsky.social')
    expect(claims).toMatchObject({ iss: HUB, sub: `guest:${DID_GUEST}`, roles: [], nodes: [] })
    expect(h.store.guest(DID_GUEST)).toEqual({ did: DID_GUEST, handle: 'guest.bsky.social', firstSeen: T0.toISOString(), lastSeen: T0.toISOString() })
  })

  it('a DID linked to someone no longer on the records signs in as a Guest', async () => {
    const h = await house()
    expect((await proven(h, DID_GONE)).claims).toMatchObject({ sub: `guest:${DID_GONE}`, roles: [] })
  })

  it('the cookie is the shared one: the Hub\'s name and Domain, 24 h, verified with the public key', async () => {
    const h = await house()
    const { res, jws } = await proven(h, DID_GUEST)
    const line = res.headers.getSetCookie().find(l => l.startsWith('org_session_dev='))!
    expect(line).toMatch(/; Domain=example\.org; Path=\/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax$/)
    expect(verifySession(jws!, h.signIn!.publicJwk, h.state.clock, { iss: HUB })).not.toBe(null)
  })

  it('nothing about a Guest is kept but the DID and the handle: no address, no name', async () => {
    const h = await house()
    await proven(h, DID_GUEST, 'guest.bsky.social')
    const all = [...h.store.allStrings()]
    expect(all.filter(s => /@/.test(s) && !s.startsWith('did:'))).toEqual([])
  })

  it('without the emailed-link sign-in\'s keys there is no shared cookie to issue: refused, nothing kept', async () => {
    const h = await house({ signIn: null })
    const { res, jws } = await proven(h, DID_GUEST)
    expect(res.status).toBe(503)
    expect(jws).toBe(null)
    expect(h.store.guest(DID_GUEST)).toBe(null)
  })
})

describe('a Guest on the Hub', () => {
  it('GET /api/session says signed in, as a Guest, with no Roles', async () => {
    const h = await house()
    const { cookie } = await proven(h, DID_GUEST, 'guest.bsky.social')
    const res = await call(h, 'GET', '/api/session', cookie)
    expect(await res.json()).toMatchObject({ signedIn: true, via: 'atproto', guest: { did: DID_GUEST, handle: 'guest.bsky.social' }, roles: [] })
    // The house does not take a Guest's cookie for a removed person: it is not cleared.
    expect(res.headers.getSetCookie().filter(l => l.startsWith('org_session_dev=;'))).toEqual([])
  })

  it('reads as the public, and may write nothing', async () => {
    const h = await house()
    const { cookie } = await proven(h, DID_GUEST)
    const res = await call(h, 'PUT', '/api/registries/members/x', cookie)
    expect([401, 403]).toContain(res.status)
  })

  it('signing out ends the Guest\'s session at the house: the same cookie, replayed, is signed out', async () => {
    const h = await house()
    const { cookie } = await proven(h, DID_GUEST)
    expect((await call(h, 'DELETE', '/api/session', cookie)).status).toBe(204)
    expect(await (await call(h, 'GET', '/api/session', cookie)).json()).toMatchObject({ signedIn: false })
  })

  it('signing out from another of the org\'s sites: the Hub says where to go back (I6), and only on the org\'s domain', async () => {
    const h = await house()
    const { cookie } = await proven(h, DID_GUEST)
    const back = 'https://network.example.org/refi-x/'
    const res = await call(h, 'DELETE', `/api/session?return=${encodeURIComponent(back)}`, cookie)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ next: back })
    expect(await (await call(h, 'GET', '/api/session', cookie)).json()).toMatchObject({ signedIn: false })
    expect(await (await call(h, 'DELETE', `/api/session?return=${encodeURIComponent('https://evil.example.com/')}`)).json()).toEqual({ next: `${HUB}/` })
  })

  it('a Guest whose row is gone (they linked their account, or were removed) is signed out', async () => {
    const h = await house()
    const { cookie } = await proven(h, DID_GUEST)
    await h.store.deleteGuest(DID_GUEST)
    expect(await (await call(h, 'GET', '/api/session', cookie)).json()).toMatchObject({ signedIn: false })
  })
})
