import { describe, it, expect, afterEach } from 'vitest'
import { Hono } from 'hono'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPrivateStore, type NetworkEntry } from '../../server/private/store.ts'
import type { AtprotoIdentity } from '../../server/session/atproto.ts'
import type { CheckResult } from '../../server/network/check.ts'
import {
  addNodeAccount, withdrawNodeAccount, readNode, readKnown,
  ADDED, ALREADY, PENDING, PENDING_HELD, NODE_UNKNOWN, NODE_PERSON, NODE_TAKEN, CHECK_FAILED, WITHDRAWN, NOT_ON, HELD_NOTE,
} from '../../server/network/entries.ts'

// A node adds or withdraws its own network account (refi-dao-os network app spec §5.4, §5.7; plan task B5). The
// round-trip proves control of the account (B2); the Hub runs the two-way check, then the match rule (A2): a match goes
// live, anything else waits for a steward (pending). It never creates or changes a session. Review Focus 5: one account
// claiming a second node is refused; a node with a live account receiving another that matches holds it as pending.
// Synthetic values only.

const T0 = new Date('2026-12-18T10:00:00.000Z')
const PERSON = 'example-org:person:example-one'
const DID_A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const DID_B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'
const DID_C = 'did:plc:cccccccccccccccccccccccc'
const ORGS = `entries:
  refi-x:
    title: ReFi X
    org_type: local-node
    url: https://refi-x.org/
  refi-y:
    title: ReFi Y
    org_type: local-node
    url: https://refi-y.org
    links:
      bluesky: https://bsky.app/profile/refi-y.bsky.social
  refi-z:
    title: ReFi Z
    org_type: local-node
  partner-co:
    title: Partner Co
    org_type: partner
    url: https://partner.example
`
const NETWORK = `nodes:
  refi-z:
    did: ${DID_C}
    handle: refi-z.bsky.social
    check: pass
`

const cleanup: (() => void)[] = []
afterEach(() => { for (const f of cleanup.splice(0).reverse()) { try { f() } catch { /* gone */ } } })

type Checked = Record<string, Partial<CheckResult>>

async function house(o: { checks?: Checked; resolves?: Record<string, string> } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'network-entries-repo-')); cleanup.push(() => rmSync(repo, { recursive: true, force: true }))
  mkdirSync(join(repo, 'data', 'kb'), { recursive: true }); mkdirSync(join(repo, 'data', 'nodes'), { recursive: true })
  writeFileSync(join(repo, 'data', 'kb', 'organization.yaml'), ORGS)
  writeFileSync(join(repo, 'data', 'nodes', 'network.yaml'), NETWORK)
  const dir = mkdtempSync(join(tmpdir(), 'network-entries-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const store = await openPrivateStore(repo, { dir }); cleanup.push(() => store.close())
  const checked: string[] = []
  // The two-way check, stood in: every account passes (on Bluesky) unless `checks` says otherwise.
  const check = async (rec: { handle: string; did?: string }): Promise<CheckResult> => {
    checked.push(rec.did ?? rec.handle)
    return { check: 'pass', did: rec.did, handle: rec.handle, on: ['bluesky'], reason: null, ...(o.checks?.[rec.did ?? ''] ?? {}) }
  }
  const resolveHandle = async (h: string) => o.resolves?.[h] ?? null
  let n = 0
  const deps = { store, repo, check, resolveHandle, now: () => T0, newId: () => `ne-${++n}` }
  const add = addNodeAccount(deps)
  const withdraw = withdrawNodeAccount(deps)
  const app = new Hono()
  // Stands in for B2's callback: the round-trip proved `did` (with `handle`) for `node`, started by `by` (or nobody).
  const who = (c: { req: { query(k: string): string | undefined } }, purpose: 'add-node' | 'withdraw-node'): AtprotoIdentity => ({
    did: c.req.query('did')!, handle: c.req.query('handle')!, scope: 'atproto', purpose, node: c.req.query('node') ?? null, by: c.req.query('by') ?? null,
  })
  app.get('/add', c => add(c, who(c, 'add-node')))
  app.get('/withdraw', c => withdraw(c, who(c, 'withdraw-node')))
  return { app, store, checked }
}
type House = Awaited<ReturnType<typeof house>>

const q = (p: Record<string, string | null | undefined>) => Object.entries(p).filter(([, v]) => v != null).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')
const add = (h: House, node: string | null, did: string, handle: string, by: string | null = null) =>
  h.app.request(`http://hub.test/add?${q({ node, did, handle, by })}`)
const withdraw = (h: House, node: string, did: string, handle: string) => h.app.request(`http://hub.test/withdraw?${q({ node, did, handle })}`)
const only = (h: House, state?: NetworkEntry['state']) => h.store.networkEntries(state)

describe('the node registry', () => {
  it('readNode gives a local node\'s website and links; anything else, or a missing file, is null', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'network-entries-read-')); cleanup.push(() => rmSync(repo, { recursive: true, force: true }))
    expect(readNode(repo, 'refi-x')).toBe(null)
    mkdirSync(join(repo, 'data', 'kb'), { recursive: true }); writeFileSync(join(repo, 'data', 'kb', 'organization.yaml'), ORGS)
    expect(readNode(repo, 'refi-x')).toEqual({ title: 'ReFi X', url: 'https://refi-x.org/', links: null })
    expect(readNode(repo, 'partner-co')).toBe(null)
    expect(readNode(repo, 'nope')).toBe(null)
    writeFileSync(join(repo, 'data', 'kb', 'organization.yaml'), ': not yaml : [')
    expect(readNode(repo, 'refi-x')).toBe(null)
  })

  it('readKnown gives the node\'s Dec 9 entry (DID and check), or null', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'network-entries-read-')); cleanup.push(() => rmSync(repo, { recursive: true, force: true }))
    expect(readKnown(repo, 'refi-z')).toBe(null)
    mkdirSync(join(repo, 'data', 'nodes'), { recursive: true }); writeFileSync(join(repo, 'data', 'nodes', 'network.yaml'), NETWORK)
    expect(readKnown(repo, 'refi-z')).toEqual({ did: DID_C, check: 'pass' })
    expect(readKnown(repo, 'refi-x')).toBe(null)
  })
})

describe('add-node', () => {
  it('an account on the node\'s own domain goes live (why: domain), with the check\'s apps, added by the person who started it', async () => {
    const h = await house()
    const res = await add(h, 'refi-x', DID_A, 'refi-x.org', PERSON)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(ADDED('refi-x.org', 'ReFi X'))
    expect(only(h)).toEqual([{ id: 'ne-1', did: DID_A, node: 'refi-x', handle: 'refi-x.org', on: ['bluesky'], state: 'live', why: 'domain',
      added: T0.toISOString(), addedBy: PERSON, check: 'pass', checkedOn: '2026-12-18', reason: null, channel: null, decided: null }])
  })

  it('never creates or changes a session: no cookie is set and no Guest is recorded; a signed-out lead\'s entry is added by the node\'s DID', async () => {
    const h = await house()
    const res = await add(h, 'refi-x', DID_A, 'refi-x.org')
    expect(res.headers.get('set-cookie')).toBe(null)
    expect(h.store.guest(DID_A)).toBe(null)
    expect(only(h)[0]?.addedBy).toBe(DID_A)
  })

  it('the node\'s record already naming the account makes it live (why: record): its Dec 9 entry, or a profile link on its page', async () => {
    const h = await house({ resolves: { 'refi-y.bsky.social': DID_B } })
    expect((await add(h, 'refi-z', DID_C, 'refi-z.bsky.social')).status).toBe(200)
    expect((await add(h, 'refi-y', DID_B, 'refi-y.bsky.social')).status).toBe(200)
    expect(only(h, 'live').map(e => [e.node, e.why])).toEqual([['refi-z', 'record'], ['refi-y', 'record']])
  })

  it('any other account waits for a steward (pending), never shown, with the lead told so; trying again adds no second row', async () => {
    const h = await house()
    const res = await add(h, 'refi-x', DID_A, 'refi-somewhere.bsky.social')
    expect(res.status).toBe(202)
    expect(await res.text()).toBe(PENDING)
    expect((await add(h, 'refi-x', DID_A, 'refi-somewhere.bsky.social')).status).toBe(202)
    expect(only(h).map(e => [e.state, e.why])).toEqual([['pending', null]])
  })

  it('a subdomain handle under the node\'s domain is pending (exact host only)', async () => {
    const h = await house()
    expect((await add(h, 'refi-x', DID_A, 'someone.refi-x.org')).status).toBe(202)
    expect(only(h, 'live')).toEqual([])
  })

  it('a node not in the organization registry (or not a local node) is refused, nothing kept, nothing checked', async () => {
    const h = await house()
    for (const node of ['nope', 'partner-co']) {
      const res = await add(h, node, DID_A, 'partner.example')
      expect(res.status).toBe(404)
      expect(await res.text()).toBe(NODE_UNKNOWN)
    }
    expect((await add(h, null, DID_A, 'refi-x.org')).status).toBe(400)
    expect(only(h)).toEqual([])
    expect(h.checked).toEqual([])
  })

  it('an account linked to a person is refused as a node\'s', async () => {
    const h = await house()
    await h.store.putAccountLink({ did: DID_A, personId: PERSON, handle: 'refi-x.org', linked: T0.toISOString() })
    const res = await add(h, 'refi-x', DID_A, 'refi-x.org', PERSON)
    expect(res.status).toBe(409)
    expect(await res.text()).toBe(NODE_PERSON)
    expect(only(h)).toEqual([])
  })

  it('an account whose handle does not check out both ways is refused, with the reason', async () => {
    const h = await house({ checks: { [DID_A]: { check: 'fail', reason: 'DID document does not name the handle' } } })
    const res = await add(h, 'refi-x', DID_A, 'refi-x.org')
    expect(res.status).toBe(422)
    expect(await res.text()).toBe(CHECK_FAILED('DID document does not name the handle'))
    expect(only(h)).toEqual([])
  })

  it('a handle the round-trip could not check (handle.invalid) is refused before any check', async () => {
    const h = await house()
    expect((await add(h, 'refi-x', DID_A, 'handle.invalid')).status).toBe(422)
    expect(h.checked).toEqual([])
    expect(only(h)).toEqual([])
  })

  it('the same live account on the same node again: already there, nothing added', async () => {
    const h = await house()
    await add(h, 'refi-x', DID_A, 'refi-x.org')
    const res = await add(h, 'refi-x', DID_A, 'refi-x.org')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(ALREADY('refi-x.org', 'ReFi X'))
    expect(only(h)).toHaveLength(1)
  })

  it('going live closes the node\'s other pending accounts, and this account\'s pending claims on other nodes', async () => {
    const h = await house()
    await add(h, 'refi-x', DID_B, 'refi-x-fan.bsky.social')
    await add(h, 'refi-z', DID_A, 'refi-x.org')
    await add(h, 'refi-x', DID_A, 'refi-x.org')
    const byId = Object.fromEntries(only(h).map(e => [`${e.node}:${e.did}`, e]))
    expect(byId[`refi-x:${DID_A}`]?.state).toBe('live')
    expect(byId[`refi-x:${DID_B}`]).toMatchObject({ state: 'removed', reason: 'closed: another account went live for this node', decided: T0.toISOString() })
    expect(byId[`refi-z:${DID_A}`]).toMatchObject({ state: 'removed', reason: 'closed: this account went live for another node' })
  })
})

describe('Review Focus 5: one node, one account; one account, one node', () => {
  it('an account live for one node claiming a second node is refused, even when it matches the second', async () => {
    const h = await house()
    await add(h, 'refi-z', DID_C, 'refi-z.bsky.social')
    const res = await add(h, 'refi-x', DID_C, 'refi-x.org')
    expect(res.status).toBe(409)
    expect(await res.text()).toBe(NODE_TAKEN)
    expect(only(h).map(e => [e.node, e.state])).toEqual([['refi-z', 'live']])
  })

  it('a node with a live account receiving another that matches holds it as pending, with the note; the first stays live', async () => {
    const h = await house({ resolves: { 'refi-y.bsky.social': DID_B } })
    await add(h, 'refi-y', DID_A, 'refi-y.org')
    const res = await add(h, 'refi-y', DID_B, 'refi-y.bsky.social')
    expect(res.status).toBe(202)
    expect(await res.text()).toBe(PENDING_HELD('ReFi Y'))
    const second = only(h).find(e => e.did === DID_B)
    expect(second).toMatchObject({ state: 'pending', why: null, reason: HELD_NOTE })
    expect(only(h, 'live').map(e => e.did)).toEqual([DID_A])
  })
})

describe('withdraw-node', () => {
  it('the node\'s own account takes itself down at once (removed), with its pending claim on the node', async () => {
    const h = await house()
    await add(h, 'refi-x', DID_A, 'refi-x.org')
    const res = await withdraw(h, 'refi-x', DID_A, 'refi-x.org')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(WITHDRAWN('refi-x.org', 'ReFi X'))
    expect(res.headers.get('set-cookie')).toBe(null)
    expect(only(h)).toMatchObject([{ state: 'removed', reason: 'withdrawn by the node', decided: T0.toISOString() }])
  })

  it('a pending account withdraws too', async () => {
    const h = await house()
    await add(h, 'refi-x', DID_B, 'refi-x-fan.bsky.social')
    expect((await withdraw(h, 'refi-x', DID_B, 'refi-x-fan.bsky.social')).status).toBe(200)
    expect(only(h, 'pending')).toEqual([])
  })

  it('an account that is not on the node withdraws nothing', async () => {
    const h = await house()
    await add(h, 'refi-x', DID_A, 'refi-x.org')
    const res = await withdraw(h, 'refi-x', DID_B, 'other.bsky.social')
    expect(res.status).toBe(404)
    expect(await res.text()).toBe(NOT_ON('ReFi X'))
    expect(only(h, 'live')).toHaveLength(1)
  })

  it('after a withdrawal the node can take another account live', async () => {
    const h = await house()
    await add(h, 'refi-x', DID_A, 'refi-x.org')
    await withdraw(h, 'refi-x', DID_A, 'refi-x.org')
    expect((await add(h, 'refi-x', DID_B, 'refi-x.org')).status).toBe(200)
    expect(only(h, 'live').map(e => [e.node, e.did])).toEqual([['refi-x', DID_B]])
  })
})
