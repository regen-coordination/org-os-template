import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Hono } from 'hono'
import { makeFixtureRepo } from '../fixtures.ts'
import { addressOfKey, key, sign } from './keys.ts'
import { createApp } from '../../server/app.ts'
import { openPrivateStore, type PrivateStore } from '../../server/private/store.ts'
import { Membership, HATS_GRACE_MS } from '../../server/session/membership.ts'
import { NONCE_LIMIT } from '../../server/session/nonces.ts'
import { SESSION_TTL_MS, sessionFromCookie } from '../../server/session/sessions.ts'
import { mountSession } from '../../server/session/routes.ts'
import { readHosted } from '../../server/serve.ts'
import { parseSiweMessage } from '../../lib/siwe.mjs'
import type { WearerReading } from '../../server/systems/hats.ts'
import type { WearerRefusal } from '../../server/systems/reader.ts'

// L5 spec §4 and §13's /api/session rows, against a fresh fixture repository, a store in a temp folder of its own and a
// fake Hats reader (no network, ruling S13). Signing keys are made here, in the test; the server signs nothing.

const CELO = 'eip155:42220'
const COUNCIL = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
const HOST = 'localhost:4680'
const T0 = new Date('2026-10-29T10:00:00.000Z')
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
const TREE_UNREADABLE = 'The Hats tree could not be read, so membership is not known. Try again.'
const TOO_MANY = 'Too many sign-ins are waiting. Try again in a minute.'
const EOA_ONLY = 'Only an address with its own key can sign in for now.'
const BAND = 'Your hats could not be read for an hour; you see what anyone sees until they can be.'

// ── keys and signatures: tests/session/keys.ts ──

// ── the house under test ──
const cleanup: string[] = []
const stores: PrivateStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) { try { s.close() } catch { /* closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

type Answer = (account: string) => WearerReading | WearerRefusal
const wears = (hats: string[]): Answer => account => ({ ok: true, system: 'hats-main', chain: CELO, account, hats, block: 100, readAt: T0.toISOString() })
const FAILED: Answer = () => ({ ok: false, failed: true, error: 'the tree could not be read: rpc down' })

async function house(o: { hosted?: boolean; systems?: string | null; answer?: Answer; dir?: string; repo?: string } = {}) {
  const repo = o.repo ?? makeFixtureRepo()
  if (!o.repo) {
    cleanup.push(repo)
    if (o.systems !== null) writeFileSync(join(repo, 'data', 'systems.yaml'), o.systems ?? SYSTEMS)
    writeFileSync(join(repo, 'data', 'governance.yaml'), GOVERNANCE)
  }
  const dir = o.dir ?? mkdtempSync(join(tmpdir(), 'session-store-'))
  if (!o.dir) cleanup.push(dir)
  const store = await openPrivateStore(repo, { dir }); stores.push(store)
  const state = { clock: T0, answer: o.answer ?? wears([COUNCIL]) }
  const now = () => state.clock
  const reader = {
    wearer: vi.fn(async (_s: Record<string, unknown>, account: string) => state.answer(account)),
    wearers: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
  }
  const membership = new Membership({ repo, reader, now })
  const app = createApp(repo, a => mountSession(a, { repo, store, membership, hosted: o.hosted ?? false, now }))
  return { app, repo, dir, store, state, reader, membership }
}

function call(app: Hono, method: string, path: string, o: { body?: unknown; host?: string; cookie?: string } = {}) {
  const host = o.host ?? HOST
  const headers: Record<string, string> = { host }
  if (o.body !== undefined) headers['content-type'] = 'application/json'
  if (o.cookie) headers.cookie = o.cookie
  return app.request(`http://${host}${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) })
}
async function nonceFor(app: Hono, address: string, host = HOST) {
  const res = await call(app, 'POST', '/api/session/nonce', { body: { address }, host })
  expect(res.status).toBe(200)
  return await res.json() as { nonce: string; message: string }
}
async function signIn(app: Hono, sk: Uint8Array) {
  const n = await nonceFor(app, addressOfKey(sk))
  return call(app, 'POST', '/api/session', { body: { nonce: n.nonce, signature: sign(sk, n.message) } })
}
const cookieOf = (res: Response) => res.headers.get('set-cookie')
const tokenOf = (res: Response) => /house_session=([^;]*)/.exec(cookieOf(res) ?? '')?.[1] ?? ''
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

describe('POST /api/session/nonce (spec §4.1, §4.2)', () => {
  it('builds the whole message: the request Host as domain, the tree\'s chain id, the org\'s statement, a 10-minute expiry', async () => {
    const { app } = await house()
    const sk = key()
    const { nonce, message } = await nonceFor(app, addressOfKey(sk).toLowerCase())
    expect(nonce).toMatch(/^[A-Za-z0-9]{22}$/)
    expect(parseSiweMessage(message)).toEqual({
      domain: HOST, address: addressOfKey(sk),
      statement: "Sign in to Fixture Org's Hub. This proves you hold this address. Nothing is sent on chain and nothing is spent.",
      uri: 'http://localhost:4680/', version: '1', chainId: 42220, nonce,
      issuedAt: '2026-10-29T10:00:00.000Z', expirationTime: '2026-10-29T10:10:00.000Z',
    })
  })

  it('400 for what is not an address', async () => {
    const { app } = await house()
    const res = await call(app, 'POST', '/api/session/nonce', { body: { address: '0x1234' } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: '0x1234 is not an address (0x and 40 hex digits).' })
  })

  it(`refuses the ${NONCE_LIMIT + 1}st waiting nonce with 429 rather than evicting someone's`, async () => {
    const { app } = await house()
    const address = addressOfKey(key())
    const first = await nonceFor(app, address)
    for (let i = 1; i < NONCE_LIMIT; i++) await nonceFor(app, address)
    const res = await call(app, 'POST', '/api/session/nonce', { body: { address } })
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: TOO_MANY })
    // the first is still waiting: it is judged on its signature (here another key's), not refused as unknown
    const res2 = await call(app, 'POST', '/api/session', { body: { nonce: first.nonce, signature: sign(key(), first.message) } })
    expect(await res2.json()).toEqual({ error: OTHER_ADDRESS })
  })
})

describe('POST /api/session (spec §4.3)', () => {
  it('nonce, then signature, then a session cookie: HttpOnly, SameSite=Strict, Path=/, not Secure locally', async () => {
    const { app } = await house()
    const sk = key()
    const res = await signIn(app, sk)
    expect(res.status).toBe(200)
    const token = tokenOf(res)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(cookieOf(res)).toBe(`house_session=${token}; HttpOnly; SameSite=Strict; Path=/`)
    const account = `${CELO}:${addressOfKey(sk)}`
    expect(await res.json()).toEqual({
      mode: 'local', signedIn: true, actor: account, account,
      hats: [{ hat: COUNCIL, name: 'council' }], expiresAt: new Date(T0.getTime() + SESSION_TTL_MS).toISOString(),
    })
  })

  it('hosted: the cookie is always Secure (controller ruling P14)', async () => {
    const { app } = await house({ hosted: true })
    const res = await signIn(app, key())
    expect(res.status).toBe(200)
    expect(cookieOf(res)).toBe(`house_session=${tokenOf(res)}; HttpOnly; SameSite=Strict; Path=/; Secure`)
    const got = await (await call(app, 'GET', '/api/session', { cookie: `house_session=${tokenOf(res)}` })).json()
    expect(got.mode).toBe('hosted')
    const out = await call(app, 'DELETE', '/api/session', { cookie: `house_session=${tokenOf(res)}` })
    expect(cookieOf(out)).toBe('house_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure')
  })

  it('refuses a signature from another address than the one given, and spends the nonce (Review Focus 1)', async () => {
    const { app, store } = await house()
    const given = key(), other = key()
    const n = await nonceFor(app, addressOfKey(given))
    const res = await call(app, 'POST', '/api/session', { body: { nonce: n.nonce, signature: sign(other, n.message) } })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: OTHER_ADDRESS })
    expect(cookieOf(res)).toBeNull()
    const again = await call(app, 'POST', '/api/session', { body: { nonce: n.nonce, signature: sign(given, n.message) } })
    expect(again.status).toBe(401)
    expect(await again.json()).toEqual({ error: 'This sign-in message is not known here or was already used. Ask for a new one and sign again.' })
    expect(sessionRows(store)).toEqual([])
  })

  it('two posts of one nonce at once: exactly one session (fix round 1)', async () => {
    const { app, store } = await house()
    const sk = key()
    const n = await nonceFor(app, addressOfKey(sk))
    const body = { nonce: n.nonce, signature: sign(sk, n.message) }
    const both = await Promise.all([call(app, 'POST', '/api/session', { body }), call(app, 'POST', '/api/session', { body })])
    expect(both.map(r => r.status).sort()).toEqual([200, 401])
    expect(sessionRows(store)).toHaveLength(1)
  })

  it('401 when the message\'s URI is not this request\'s origin (another scheme) (fix round 1)', async () => {
    const { app } = await house()
    const sk = key()
    const n = await (await app.request(`https://${HOST}/api/session/nonce`, {
      method: 'POST', headers: { host: HOST, 'content-type': 'application/json' }, body: JSON.stringify({ address: addressOfKey(sk) }),
    })).json() as { nonce: string; message: string }
    expect(parseSiweMessage(n.message)).toMatchObject({ uri: 'https://localhost:4680/' })
    const res = await call(app, 'POST', '/api/session', { body: { nonce: n.nonce, signature: sign(sk, n.message) } })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'This sign-in message was made for https://localhost:4680/, and this request came to http://localhost:4680/. Sign in from the address the message names.' })
  })

  it('401 for a reused nonce, an expired one (10 min + 1 s), and a Host other than the message\'s', async () => {
    const h = await house()
    const sk = key()
    const n = await nonceFor(h.app, addressOfKey(sk))
    const body = { nonce: n.nonce, signature: sign(sk, n.message) }
    expect((await call(h.app, 'POST', '/api/session', { body })).status).toBe(200)
    const reused = await call(h.app, 'POST', '/api/session', { body })
    expect(reused.status).toBe(401)
    expect((await reused.json()).error).toBe('This sign-in message is not known here or was already used. Ask for a new one and sign again.')

    const late = await nonceFor(h.app, addressOfKey(sk))
    h.state.clock = new Date(T0.getTime() + 600_000 + 1000)
    const expired = await call(h.app, 'POST', '/api/session', { body: { nonce: late.nonce, signature: sign(sk, late.message) } })
    expect(expired.status).toBe(401)
    expect((await expired.json()).error).toBe('This sign-in message is more than 10 minutes old. Ask for a new one and sign again.')

    const elsewhere = await nonceFor(h.app, addressOfKey(sk))
    const moved = await call(h.app, 'POST', '/api/session', { host: '127.0.0.1:4680', body: { nonce: elsewhere.nonce, signature: sign(sk, elsewhere.message) } })
    expect(moved.status).toBe(401)
    expect((await moved.json()).error).toBe('This sign-in message was made for localhost:4680, and this request came to 127.0.0.1:4680. Sign in from the address the message names.')
  })

  it('a non-wearer gets { signedIn: false, notMember: true } and no cookie', async () => {
    const { app, store } = await house({ answer: wears([]) })
    const res = await signIn(app, key())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ signedIn: false, notMember: true })
    expect(cookieOf(res)).toBeNull()
    expect(sessionRows(store)).toEqual([])
  })

  it('a non-member\'s sign-in leaves no reading kept (fix round 1)', async () => {
    const { app, membership } = await house({ answer: wears([]) })
    const sk = key()
    await signIn(app, sk)
    expect(membership.forRead(`${CELO}:${addressOfKey(sk)}`)).toBeNull()
  })

  it('a tree that cannot be read is a 502 that says so, never "not a member" (Review Focus 3)', async () => {
    const { app, store } = await house({ answer: FAILED })
    const res = await signIn(app, key())
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: TREE_UNREADABLE })
    expect(cookieOf(res)).toBeNull()
    expect(sessionRows(store)).toEqual([])
  })

  it('refuses a signature that is not 65 bytes, as a contract account\'s is (Q5: EOAs only)', async () => {
    const { app } = await house()
    const n = await nonceFor(app, addressOfKey(key()))
    const res = await call(app, 'POST', '/api/session', { body: { nonce: n.nonce, signature: '0x' + 'ab'.repeat(97) } })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: EOA_ONLY })
  })
})

function sessionRows(store: PrivateStore) {
  const db = new DatabaseSync(store.file, { readOnly: true })
  try { return db.prepare('SELECT token_hash, account, created, expires FROM sessions').all() } finally { db.close() }
}

describe('sessions (spec §4.4)', () => {
  it('survive a server restart, stored hashed: the store holds no raw token', async () => {
    const first = await house()
    const sk = key()
    const res = await signIn(first.app, sk)
    const token = tokenOf(res)
    const account = `${CELO}:${addressOfKey(sk)}`
    expect(sessionRows(first.store)).toEqual([{
      token_hash: sha256(token), account, created: T0.toISOString(), expires: new Date(T0.getTime() + SESSION_TTL_MS).toISOString(),
    }])
    first.store.close(); stores.splice(stores.indexOf(first.store), 1)
    for (const f of readdirSync(first.dir)) expect(readFileSync(join(first.dir, f)).includes(token)).toBe(false)

    const again = await house({ repo: first.repo, dir: first.dir })
    const got = await call(again.app, 'GET', '/api/session', { cookie: `other=1; house_session=${token}` })
    expect(await got.json()).toMatchObject({ mode: 'local', signedIn: true, account })
  })

  it('after a restart, while no reading is kept, the answer marks the hats unread with the band, never as none worn (final review I1)', async () => {
    const first = await house()
    const sk = key()
    const token = tokenOf(await signIn(first.app, sk))
    first.store.close(); stores.splice(stores.indexOf(first.store), 1)
    // The restarted server keeps no reading, and the tree is down: the first background read fails.
    const again = await house({ repo: first.repo, dir: first.dir, answer: FAILED })
    const cookie = `house_session=${token}`
    const unread = await (await call(again.app, 'GET', '/api/session', { cookie })).json()
    expect(unread).toMatchObject({ signedIn: true, hats: [], unread: true, band: BAND })
    expect(unread.stale).toBeUndefined()
    await vi.waitFor(() => expect(again.reader.wearer).toHaveBeenCalled())
    // A reading that lands is a reading: no `unread`, no band; an empty one (the hat taken off since) too.
    const account = `${CELO}:${addressOfKey(sk)}`
    again.state.clock = new Date(T0.getTime() + 10 * 60_000)
    again.state.answer = wears([COUNCIL])
    await again.membership.forAct(account)
    expect(await (await call(again.app, 'GET', '/api/session', { cookie })).json()).toMatchObject({ hats: [{ hat: COUNCIL }] })
    again.state.answer = wears([])
    await again.membership.forAct(account)
    const read = await (await call(again.app, 'GET', '/api/session', { cookie })).json()
    expect(read).toMatchObject({ signedIn: true, hats: [] })
    expect(read.unread).toBeUndefined()
    expect(read.band).toBeUndefined()
  })

  it('DELETE /api/session ends it at once: 204, cookie cleared, the row gone', async () => {
    const { app, store } = await house()
    const token = tokenOf(await signIn(app, key()))
    const res = await call(app, 'DELETE', '/api/session', { cookie: `house_session=${token}` })
    expect(res.status).toBe(204)
    expect(cookieOf(res)).toBe('house_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
    expect(sessionRows(store)).toEqual([])
    expect(await (await call(app, 'GET', '/api/session', { cookie: `house_session=${token}` })).json()).toMatchObject({ signedIn: false })
  })

  it('after 24 h it is gone', async () => {
    const h = await house()
    const token = tokenOf(await signIn(h.app, key()))
    h.state.clock = new Date(T0.getTime() + SESSION_TTL_MS - 1)
    expect(await (await call(h.app, 'GET', '/api/session', { cookie: `house_session=${token}` })).json()).toMatchObject({ signedIn: true })
    h.state.clock = new Date(T0.getTime() + SESSION_TTL_MS)
    expect(await (await call(h.app, 'GET', '/api/session', { cookie: `house_session=${token}` })).json()).toMatchObject({ signedIn: false })
    await vi.waitFor(() => expect(sessionRows(h.store)).toEqual([]))
  })

  it('a store that fails to read a session is no session, not a 500 (fix round 1)', async () => {
    const { app, store } = await house()
    const token = tokenOf(await signIn(app, key()))
    const spy = vi.spyOn(store, 'session').mockImplementation(() => { throw new Error('disk I/O error') })
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await call(app, 'GET', '/api/session', { cookie: `house_session=${token}` })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ signedIn: false })
      expect(quiet).toHaveBeenCalledWith('org-os admin: a session could not be read from the private store: disk I/O error')
    } finally { spy.mockRestore(); quiet.mockRestore() }
  })

  it('an unknown token is no session', async () => {
    const { app, store } = await house()
    expect(await (await call(app, 'GET', '/api/session', { cookie: 'house_session=bm90LWEtdG9rZW4' })).json()).toMatchObject({ signedIn: false })
    expect(sessionFromCookie(store, 'house_session=bm90LWEtdG9rZW4', () => T0)).toBeNull()
    expect(sessionFromCookie(store, undefined, () => T0)).toBeNull()
  })

  it('the WebSocket upgrade reads the same cookie (sessionFromCookie)', async () => {
    const { app, store } = await house()
    const sk = key()
    const token = tokenOf(await signIn(app, sk))
    expect(sessionFromCookie(store, `a=b; house_session=${token}`, () => T0)).toMatchObject({ account: `${CELO}:${addressOfKey(sk)}`, tokenHash: sha256(token) })
  })
})

describe('GET /api/session (spec §13)', () => {
  it('signed out, with a tree: how to sign in', async () => {
    const { app } = await house()
    expect(await (await call(app, 'GET', '/api/session')).json()).toEqual({
      mode: 'local', signIn: { chainId: CELO, tree: 'eip155:42220:13' }, signedIn: false,
    })
  })

  it('no tree: signIn is null, and no nonce is given (spec §5.4)', async () => {
    const { app } = await house({ systems: null })
    expect(await (await call(app, 'GET', '/api/session')).json()).toEqual({ mode: 'local', signIn: null, signedIn: false })
    const res = await call(app, 'POST', '/api/session/nonce', { body: { address: addressOfKey(key()) } })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Sign-in is not offered here: this organisation names no Hats tree for its membership.', code: 'NO_TREE' })
  })

  it('past HATS_GRACE_MS with the tree unreadable, a session reads as public, with the band sentence (Review Focus 3)', async () => {
    const h = await house()
    const token = tokenOf(await signIn(h.app, key()))
    h.state.answer = FAILED
    h.state.clock = new Date(T0.getTime() + HATS_GRACE_MS + 1)
    const got = await (await call(h.app, 'GET', '/api/session', { cookie: `house_session=${token}` })).json()
    expect(got).toMatchObject({ signedIn: true, hats: [], stale: true, band: BAND })
    expect(h.reader.wearer).toHaveBeenCalledTimes(2) // sign-in, then the background read that failed
  })
})

describe('--hosted / ORG_OS_HOSTED (spec §3)', () => {
  it('reads the flag or the variable', () => {
    expect(readHosted(['node', 'index.ts'], {})).toBe(false)
    expect(readHosted(['node', 'index.ts', '--hosted'], {})).toBe(true)
    expect(readHosted(['node', 'index.ts'], { ORG_OS_HOSTED: '1' })).toBe(true)
    expect(readHosted(['node', 'index.ts'], { ORG_OS_HOSTED: '0' })).toBe(false)
    expect(readHosted(['node', 'index.ts'], { ORG_OS_HOSTED: '' })).toBe(false)
  })
})

describe('startServer mounts the session routes on its one store (Task 5)', () => {
  it('answers GET /api/session over HTTP, local or hosted', async () => {
    const { startServer } = await import('../../server/serve.ts')
    const repo = makeFixtureRepo(); cleanup.push(repo)
    for (const hosted of [false, true]) {
      const server = await startServer({ repo, port: 0, hosted, fetch: async () => { throw new Error('no network in this test') } })
      try {
        expect(server.privateStore).not.toBeNull()
        const res = await fetch(`http://localhost:${server.port}/api/session`)
        // Lane 3 Task 9: the server also says which methods are offered (locally the email method always is; hosted with
        // none of its variables, it is not) and whether the instance is written to (Task 11: off by default when hosted).
        expect(await res.json()).toEqual({
          mode: hosted ? 'hosted' : 'local', signIn: null, signedIn: false, methods: hosted ? [] : ['email'], instanceWrites: hosted ? 'off' : 'on',
        })
      } finally { await server.close() }
    }
  })
})
