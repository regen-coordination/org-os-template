import { describe, it, expect, afterEach, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { openPrivateStore, type NetworkEntry, type RolesDoc } from '../../server/private/store.ts'
import { readSignInConfig, type SignInConfig } from '../../server/session/config.ts'
import { Membership } from '../../server/session/membership.ts'
import { mountSession } from '../../server/session/routes.ts'
import { issueSession } from '../../server/session/person.ts'
import { withRequest } from '../../server/request.ts'
import { mountNetworkBoard, STEWARDS_ONLY, PENDING_DAYS } from '../../server/network/board.ts'
import { INSTANCE_WRITES } from '../../server/hosted/instance-writes.ts'
import { HOSTED_WRITES } from '../../server/hosted/writes.ts'
import { emailKey } from '../../lib/session-token.mjs'

// What stewards see (refi-dao-os network app spec §5.4, §5.6; plan task B6): the node accounts that are live ("New",
// each with Remove, which asks a reason kept privately) and those waiting for a steward ("Waiting", with Confirm, which
// asks which channel on the node's record was used, and Decline, which asks a reason). Pending older than 30 days
// drops. The export (contract C1) is what the weekly copy reads. Stewards only. Synthetic values only.

const HUB = 'https://hub.example.org'
const HOST = 'localhost:4680'
const PEPPER = '0f'.repeat(32)
const T0 = new Date('2026-12-18T10:00:00.000Z')
const STEWARD = 'example-org:person:example-steward'
const MEMBER = 'example-org:person:example-member'
const DOC: RolesDoc = {
  roles_version: '2026-12-18',
  people: [
    { id: STEWARD, name: 'Example Steward', email_keys: [emailKey('steward@example.org', PEPPER)], roles: ['steward'], nodes: [] },
    { id: MEMBER, name: 'Example Member', email_keys: [emailKey('member@example.org', PEPPER)], roles: ['network-member', 'node-lead'], nodes: [] },
  ],
}
const DID_A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const DID_B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'
const DID_C = 'did:plc:cccccccccccccccccccccccc'
const ORGS = `entries:
  refi-x:
    title: ReFi X
    org_type: local-node
    url: https://refi-x.org/
    links:
      telegram: https://t.me/refix
      bluesky: https://bsky.app/profile/refi-x-claim.bsky.social
  refi-y:
    title: ReFi Y
    org_type: local-node
`

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

const base = (over: Partial<NetworkEntry>): NetworkEntry => ({
  id: 'ne-1', did: DID_A, node: 'refi-x', handle: 'refi-x.org', on: ['bluesky'], state: 'live', why: 'domain',
  added: T0.toISOString(), addedBy: DID_A, check: 'pass', checkedOn: '2026-12-18', reason: null, channel: null, decided: null, ...over,
})

async function house(at: Date = T0) {
  const repo = makeFixtureRepo(); cleanup.push(() => rmSync(repo, { recursive: true, force: true }))
  mkdirSync(join(repo, 'data', 'kb'), { recursive: true })
  writeFileSync(join(repo, 'data', 'kb', 'organization.yaml'), ORGS)
  const dir = mkdtempSync(join(tmpdir(), 'network-board-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const store = await openPrivateStore(repo, { dir }); cleanup.push(() => store.close())
  await store.replaceRoles(DOC)
  const now = () => at
  // The board's own clock, so a test can move it a month on without the steward's 24-hour session ending.
  let clock = at
  const reader = {
    wearer: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
    wearers: vi.fn(async () => ({ ok: false as const, failed: true as const, error: 'unused' })),
  }
  const membership = new Membership({ repo, reader, now })
  const signIn = signInConfig()
  const app = createApp(repo, a => {
    mountSession(a, { repo, store, membership, hosted: true, signIn, now, atproto: true })
    mountNetworkBoard(a, { store, repo, now: () => clock })
  }, { request: withRequest({ repo, hosted: true, membership, store, signIn, now }), hosted: true })
  const cookieOf = async (sub: string, roles: string[]) => /^([^;]*)/.exec(await issueSession(store, signIn, { sub, roles, nodes: [] }, T0))![1]!
  return { app, store, steward: await cookieOf(STEWARD, ['steward']), member: await cookieOf(MEMBER, ['network-member', 'node-lead']), later: (d: Date) => { clock = d } }
}
type House = Awaited<ReturnType<typeof house>>

function call(h: House, method: string, path: string, cookie?: string, body?: unknown) {
  const headers: Record<string, string> = { host: HOST }
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  return h.app.request(`http://${HOST}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
}
const list = async (h: House) => (await (await call(h, 'GET', '/api/network/entries', h.steward)).json()) as {
  new: { id: string; node: string; title: string; handle: string; added: string; check: string; why: string }[]
  waiting: { id: string; node: string; title: string; handle: string; added: string; note: string | null; channels: { key: string; url: string }[] }[]
}

describe('only stewards', () => {
  it('the list, Remove, Confirm, Decline and the export: the public is asked to sign in, a member who is no steward is refused', async () => {
    const h = await house()
    await h.store.putNetworkEntry(base({}))
    await h.store.putNetworkEntry(base({ id: 'ne-p', did: DID_B, handle: 'x.bsky.social', state: 'pending', why: null, node: 'refi-y' }))
    const routes: [string, string, unknown?][] = [
      ['GET', '/api/network/entries'], ['GET', '/api/network/export'],
      ['POST', '/api/network/entries/ne-1/remove', { reason: 'not theirs' }],
      ['POST', '/api/network/entries/ne-p/confirm', { channel: 'website' }],
      ['POST', '/api/network/entries/ne-p/decline', { reason: 'not theirs' }],
    ]
    for (const [method, path, body] of routes) {
      expect((await call(h, method, path, undefined, body)).status, `${method} ${path} public`).toBe(401)
      const res = await call(h, method, path, h.member, body)
      expect(res.status, `${method} ${path} member`).toBe(403)
      expect(await res.json()).toEqual({ error: STEWARDS_ONLY, code: 'STEWARDS_ONLY' })
    }
    expect(h.store.networkEntries().map(e => [e.id, e.state])).toEqual([['ne-1', 'live'], ['ne-p', 'pending']])
  })

  it('every action is named in both write tables: private-store writes (on while the instance is read-only), each route checks its steward', () => {
    for (const a of ['remove', 'confirm', 'decline']) {
      expect(INSTANCE_WRITES).toContainEqual({ method: 'POST', path: `/api/network/entries/:id/${a}`, class: 'conversation' })
      expect(HOSTED_WRITES).toContainEqual({ method: 'POST', path: `/api/network/entries/:id/${a}`, class: 'actor' })
    }
  })
})

describe('the two lists', () => {
  it('New: the live accounts (node, handle, when, check, why); Waiting: the pending ones with their note and the node\'s channels, never the claimed account', async () => {
    const h = await house()
    await h.store.putNetworkEntry(base({ node: 'refi-y', handle: 'refi-y.org' }))
    await h.store.putNetworkEntry(base({ id: 'ne-p', did: DID_B, handle: 'refi-x-claim.bsky.social', state: 'pending', why: null, reason: 'the node already has a live account' }))
    const l = await list(h)
    expect(l.new).toEqual([{ id: 'ne-1', node: 'refi-y', title: 'ReFi Y', handle: 'refi-y.org', added: T0.toISOString(), check: 'pass', why: 'domain' }])
    expect(l.waiting).toEqual([{ id: 'ne-p', node: 'refi-x', title: 'ReFi X', handle: 'refi-x-claim.bsky.social', added: T0.toISOString(),
      note: 'the node already has a live account', channels: [{ key: 'website', url: 'https://refi-x.org/' }, { key: 'telegram', url: 'https://t.me/refix' }] }])
  })

  it(`a pending account older than ${PENDING_DAYS} days drops (removed, with why) and is not listed`, async () => {
    const h = await house()
    await h.store.putNetworkEntry(base({ id: 'ne-p', state: 'pending', why: null }))
    h.later(new Date(T0.getTime() + (PENDING_DAYS - 1) * 86_400_000))
    expect((await list(h)).waiting.map(w => w.id)).toEqual(['ne-p'])
    h.later(new Date(T0.getTime() + (PENDING_DAYS + 1) * 86_400_000))
    expect((await list(h)).waiting).toEqual([])
    expect(h.store.networkEntries()[0]).toMatchObject({ state: 'removed', reason: `dropped: not confirmed in ${PENDING_DAYS} days` })
    expect((await call(h, 'POST', '/api/network/entries/ne-p/confirm', h.steward, { channel: 'website' })).status).toBe(404)
  })
})

describe('Remove', () => {
  it('a live account comes down at once, with the reason kept privately', async () => {
    const h = await house()
    await h.store.putNetworkEntry(base({}))
    expect((await call(h, 'POST', '/api/network/entries/ne-1/remove', h.steward, { reason: 'the node asked us by email' })).status).toBe(204)
    expect(h.store.networkEntries()[0]).toMatchObject({ state: 'removed', reason: 'the node asked us by email', decided: T0.toISOString() })
    expect((await list(h)).new).toEqual([])
  })

  it('asks a reason; only a live account; an unknown id is not found', async () => {
    const h = await house()
    await h.store.putNetworkEntry(base({}))
    await h.store.putNetworkEntry(base({ id: 'ne-p', did: DID_B, state: 'pending', why: null, node: 'refi-y' }))
    expect((await call(h, 'POST', '/api/network/entries/ne-1/remove', h.steward, { reason: '  ' })).status).toBe(400)
    expect((await call(h, 'POST', '/api/network/entries/ne-1/remove', h.steward, {})).status).toBe(400)
    expect((await call(h, 'POST', '/api/network/entries/ne-p/remove', h.steward, { reason: 'x' })).status).toBe(404)
    expect((await call(h, 'POST', '/api/network/entries/ne-9/remove', h.steward, { reason: 'x' })).status).toBe(404)
    expect(h.store.networkEntries('live')).toHaveLength(1)
  })
})

describe('Confirm', () => {
  it('a pending account goes live with why: steward and the channel used; the node\'s other pending accounts close', async () => {
    const h = await house()
    await h.store.putNetworkEntry(base({ id: 'ne-p', state: 'pending', why: null }))
    await h.store.putNetworkEntry(base({ id: 'ne-q', did: DID_B, handle: 'other.bsky.social', state: 'pending', why: null }))
    expect((await call(h, 'POST', '/api/network/entries/ne-p/confirm', h.steward, { channel: 'telegram' })).status).toBe(204)
    const byId = Object.fromEntries(h.store.networkEntries().map(e => [e.id, e]))
    expect(byId['ne-p']).toMatchObject({ state: 'live', why: 'steward', channel: 'telegram', decided: T0.toISOString() })
    expect(byId['ne-q']).toMatchObject({ state: 'removed', reason: 'closed: another account went live for this node' })
  })

  it('asks which channel on the node\'s record: anything else, or the claimed account\'s own profile, is refused', async () => {
    const h = await house()
    await h.store.putNetworkEntry(base({ id: 'ne-p', handle: 'refi-x-claim.bsky.social', state: 'pending', why: null }))
    for (const channel of [undefined, '', 'signal', 'bluesky']) {
      expect((await call(h, 'POST', '/api/network/entries/ne-p/confirm', h.steward, { channel })).status, String(channel)).toBe(400)
    }
    expect(h.store.networkEntries('live')).toEqual([])
  })

  it('a node that already has a live account takes no other: refused until that one is removed', async () => {
    const h = await house()
    await h.store.putNetworkEntry(base({}))
    await h.store.putNetworkEntry(base({ id: 'ne-p', did: DID_B, handle: 'other.bsky.social', state: 'pending', why: null }))
    expect((await call(h, 'POST', '/api/network/entries/ne-p/confirm', h.steward, { channel: 'website' })).status).toBe(409)
    await call(h, 'POST', '/api/network/entries/ne-1/remove', h.steward, { reason: 'replaced' })
    expect((await call(h, 'POST', '/api/network/entries/ne-p/confirm', h.steward, { channel: 'website' })).status).toBe(204)
  })

  it('an account live for another node, or linked to a person since, is refused', async () => {
    const h = await house()
    await h.store.putNetworkEntry(base({ node: 'refi-y', handle: 'refi-y.org' }))
    await h.store.putNetworkEntry(base({ id: 'ne-p', state: 'pending', why: null }))
    expect((await call(h, 'POST', '/api/network/entries/ne-p/confirm', h.steward, { channel: 'website' })).status).toBe(409)
    await h.store.putNetworkEntry(base({ id: 'ne-c', did: DID_C, handle: 'c.bsky.social', state: 'pending', why: null }))
    await h.store.putAccountLink({ did: DID_C, personId: MEMBER, handle: 'c.bsky.social', linked: T0.toISOString() })
    expect((await call(h, 'POST', '/api/network/entries/ne-c/confirm', h.steward, { channel: 'website' })).status).toBe(409)
    expect(h.store.networkEntries('live').map(e => e.id)).toEqual(['ne-1'])
  })
})

describe('Decline', () => {
  it('a pending account is declined with a reason kept privately; it never shows', async () => {
    const h = await house()
    await h.store.putNetworkEntry(base({ id: 'ne-p', state: 'pending', why: null }))
    expect((await call(h, 'POST', '/api/network/entries/ne-p/decline', h.steward, {})).status).toBe(400)
    expect((await call(h, 'POST', '/api/network/entries/ne-p/decline', h.steward, { reason: 'the node did not know it' })).status).toBe(204)
    expect(h.store.networkEntries()[0]).toMatchObject({ state: 'removed', why: null, reason: 'the node did not know it' })
    expect((await list(h)).waiting).toEqual([])
  })
})

describe('the export (contract C1)', () => {
  it('the live entries with the export fields; removed: the nodes whose live account came down, by date; never a pending, a declined, a reason or an added-by', async () => {
    const h = await house()
    await h.store.putNetworkEntry(base({ addedBy: STEWARD }))
    await h.store.putNetworkEntry(base({ id: 'ne-r', node: 'refi-y', did: DID_B, handle: 'refi-y.org' }))
    await h.store.setNetworkEntryState('ne-r', 'removed', { reason: 'private words', at: '2026-12-19T08:00:00.000Z' })
    await h.store.putNetworkEntry(base({ id: 'ne-p', node: 'refi-y', did: DID_C, handle: 'c.bsky.social', state: 'pending', why: null }))
    await h.store.putNetworkEntry(base({ id: 'ne-d', node: 'refi-y', did: DID_C, handle: 'd.bsky.social', state: 'pending', why: null }))
    await h.store.setNetworkEntryState('ne-d', 'removed', { reason: 'declined', at: '2026-12-20T08:00:00.000Z' })
    const res = await call(h, 'GET', '/api/network/export', h.steward)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      as_of: T0.toISOString(),
      entries: [{ node: 'refi-x', did: DID_A, handle: 'refi-x.org', on: ['bluesky'], added: '2026-12-18', check: 'pass', checked_on: '2026-12-18', why: 'domain' }],
      removed: [{ node: 'refi-y', on: '2026-12-19' }],
    })
    expect(JSON.stringify(body)).not.toMatch(/private words|example-steward|c\.bsky\.social/)
  })

  it('a node removed and live again is not in removed', async () => {
    const h = await house()
    await h.store.putNetworkEntry(base({ id: 'ne-r' }))
    await h.store.setNetworkEntryState('ne-r', 'removed', { reason: 'x', at: '2026-12-18T11:00:00.000Z' })
    await h.store.putNetworkEntry(base({ id: 'ne-2', did: DID_B, handle: 'refi-x.org' }))
    expect((await (await call(h, 'GET', '/api/network/export', h.steward)).json()).removed).toEqual([])
  })
})
