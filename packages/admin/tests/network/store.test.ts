import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { makeFixtureRepo } from '../fixtures.ts'
import { openPrivateStore, SCHEMA_VERSION, type PrivateStore, type RolesDoc, type NetworkEntry } from '../../server/private/store.ts'
import { backup, createKey } from '../../server/private/backup.ts'

// The private store's schema 4 (refi-dao-os network app spec §5.1, §5.3, §5.6; plan task B1; A5 findings): the ReFi
// DAO Network's Guests, member account links, network entries and the OAuth client's state and sessions, each in a table
// of its own, never touched by a roles load. Synthetic values only.

const cleanup: string[] = []
const open: PrivateStore[] = []
afterEach(() => {
  for (const s of open.splice(0)) { try { s.close() } catch { /* already closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})
const temp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(d); return d }
const repo = () => { const r = makeFixtureRepo(); cleanup.push(r); return r }
const opened = async (r: string, dir: string) => { const s = await openPrivateStore(r, { dir }); open.push(s); return s }
const fresh = async () => opened(repo(), temp('network-store-'))

const NETWORK_TABLES = ['account_links', 'network_entries', 'network_guests', 'oauth_sessions', 'oauth_state']
const DID_A = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'
const DID_B = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb'
const DID_G = 'did:plc:gggggggggggggggggggggggg'
const AT = new Date('2026-12-18T10:00:00.000Z')
const entry = (over: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id: 'ne-1', did: DID_A, node: 'refi-a', handle: 'refi-a.org', on: ['bluesky'], state: 'live', why: 'domain',
  added: '2026-12-18', addedBy: DID_A, check: 'pass', checkedOn: '2026-12-18', reason: null, channel: null, decided: null, ...over,
})
const DOC: RolesDoc = {
  roles_version: '2026-12-01',
  people: [{ id: 'example-org:person:example-steward', name: 'Example Steward', roles: ['steward'], nodes: [], email_keys: ['a'.repeat(64)] }],
} as unknown as RolesDoc

function tablesOf(file: string) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const rows = db.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string; sql: string }[]
    return { names: rows.map(r => r.name).sort(), sql: Object.fromEntries(rows.map(r => [r.name, r.sql])), version: (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version }
  } finally { db.close() }
}

describe('schema 4', () => {
  it('SCHEMA_VERSION is 4, and a fresh store has the five network tables, STRICT', async () => {
    expect(SCHEMA_VERSION).toBe(4)
    const s = await fresh()
    const t = tablesOf(s.file)
    expect(t.version).toBe(4)
    for (const name of NETWORK_TABLES) {
      expect(t.names).toContain(name)
      expect(t.sql[name]).toMatch(/STRICT$/)
    }
  })

  it('a schema-3 file opens and migrates to 4, keeping its rows', async () => {
    const r = repo(); const dir = temp('network-store-')
    const first = await openPrivateStore(r, { dir })
    await first.replaceRoles(DOC, AT)
    const file = first.file
    first.close()
    // Back to what 0.7.3 wrote: no network tables, user_version 3.
    const raw = new DatabaseSync(file)
    for (const name of NETWORK_TABLES) raw.exec(`DROP TABLE ${name}`)
    raw.exec('PRAGMA user_version = 3')
    raw.close()
    expect(tablesOf(file).version).toBe(3)
    const s = await opened(r, dir)
    expect(tablesOf(file).version).toBe(4)
    expect(tablesOf(file).names).toEqual(expect.arrayContaining(NETWORK_TABLES))
    expect(s.person('example-org:person:example-steward')?.roles).toEqual(['steward'])
  })
})

describe('a roles load', () => {
  it('leaves all five network tables untouched', async () => {
    const s = await fresh()
    await s.putGuest(DID_G, 'guest.bsky.social', AT)
    await s.putAccountLink({ did: DID_B, personId: 'example-org:person:example-steward', handle: 'steward.bsky.social', linked: AT.toISOString() })
    await s.putNetworkEntry(entry())
    const stores = s.oauthStores(() => AT)
    await stores.stateStore.set('state-key', { iss: 'x' } as never)
    await stores.sessionStore.set(DID_A, { tokenSet: {} } as never)
    await s.replaceRoles(DOC, AT)
    await s.replaceRoles({ ...DOC, people: [] } as RolesDoc, AT)
    expect(s.guest(DID_G)?.handle).toBe('guest.bsky.social')
    expect(s.accountLink(DID_B)?.personId).toBe('example-org:person:example-steward')
    expect(s.networkEntries().map(e => e.id)).toEqual(['ne-1'])
    expect(await stores.stateStore.get('state-key')).toEqual({ iss: 'x' })
    expect(await stores.sessionStore.get(DID_A)).toEqual({ tokenSet: {} })
  })
})

describe('network entries', () => {
  it('round-trip whole', async () => {
    const s = await fresh()
    await s.putNetworkEntry(entry({ on: ['bluesky', 'certified'] }))
    expect(s.networkEntries()).toEqual([entry({ on: ['bluesky', 'certified'] })])
    expect(s.networkEntries('pending')).toEqual([])
  })

  it('a second live entry for the same node is refused by the database', async () => {
    const s = await fresh()
    await s.putNetworkEntry(entry())
    await expect(s.putNetworkEntry(entry({ id: 'ne-2', did: DID_B, handle: 'other.bsky.social' }))).rejects.toThrow()
    expect(s.networkEntries().map(e => e.id)).toEqual(['ne-1'])
  })

  it('one account live for two nodes is refused by the database', async () => {
    const s = await fresh()
    await s.putNetworkEntry(entry())
    await expect(s.putNetworkEntry(entry({ id: 'ne-2', node: 'refi-b' }))).rejects.toThrow()
  })

  it('pending and removed entries do not block a live one', async () => {
    const s = await fresh()
    await s.putNetworkEntry(entry({ id: 'ne-p', state: 'pending', why: null, did: DID_B, handle: 'x.bsky.social' }))
    await s.putNetworkEntry(entry({ id: 'ne-r', state: 'removed', reason: 'withdrawn' }))
    await s.putNetworkEntry(entry({ id: 'ne-l' }))
    expect(s.networkEntries('live').map(e => e.id)).toEqual(['ne-l'])
  })

  it('a state change keeps the one-live rule', async () => {
    const s = await fresh()
    await s.putNetworkEntry(entry())
    await s.putNetworkEntry(entry({ id: 'ne-2', state: 'pending', why: null, did: DID_B, handle: 'x.bsky.social' }))
    await expect(s.setNetworkEntryState('ne-2', 'live', { why: 'steward', channel: 'website' })).rejects.toThrow()
    await s.setNetworkEntryState('ne-1', 'removed', { reason: 'steward removed' })
    await s.setNetworkEntryState('ne-2', 'live', { why: 'steward', channel: 'website' })
    const live = s.networkEntries('live')
    expect(live.map(e => [e.id, e.why, e.channel])).toEqual([['ne-2', 'steward', 'website']])
    expect(s.networkEntries('removed')[0].reason).toBe('steward removed')
  })

  it('a state change records when it was decided (a removal\'s date for the export)', async () => {
    const s = await fresh()
    await s.putNetworkEntry(entry())
    expect(s.networkEntries()[0].decided).toBe(null)
    await s.setNetworkEntryState('ne-1', 'removed', { reason: 'withdrawn by the node', at: '2026-12-19T09:00:00.000Z' })
    expect(s.networkEntries()[0]).toMatchObject({ state: 'removed', decided: '2026-12-19T09:00:00.000Z' })
  })

  it('a state outside live, pending, removed is refused', async () => {
    const s = await fresh()
    await expect(s.putNetworkEntry(entry({ state: 'shown' as never }))).rejects.toThrow()
  })
})

describe('Guests and account links', () => {
  it('a Guest keeps its first sighting; a later sign-in moves last_seen and the handle', async () => {
    const s = await fresh()
    await s.putGuest(DID_G, 'guest.bsky.social', AT)
    await s.putGuest(DID_G, 'guest2.bsky.social', new Date('2026-12-19T10:00:00.000Z'))
    expect(s.guest(DID_G)).toEqual({ did: DID_G, handle: 'guest2.bsky.social', firstSeen: AT.toISOString(), lastSeen: '2026-12-19T10:00:00.000Z' })
    await s.deleteGuest(DID_G)
    expect(s.guest(DID_G)).toBe(null)
  })

  it('a Guest is never asked for an e-mail: a handle holding an address is refused', async () => {
    const s = await fresh()
    await expect(s.putGuest(DID_G, 'a@b.example', AT)).rejects.toThrow()
    expect(s.guest(DID_G)).toBe(null)
  })

  it('a DID links to one person only; unlinking removes the row', async () => {
    const s = await fresh()
    await s.putAccountLink({ did: DID_B, personId: 'org:person:one', handle: 'one.bsky.social', linked: AT.toISOString() })
    await expect(s.putAccountLink({ did: DID_B, personId: 'org:person:two', handle: 'one.bsky.social', linked: AT.toISOString() })).rejects.toThrow()
    expect(s.accountLinksOf('org:person:one').map(l => l.did)).toEqual([DID_B])
    await s.deleteAccountLink(DID_B)
    expect(s.accountLink(DID_B)).toBe(null)
  })
})

describe('the OAuth client\'s stores', () => {
  it('state expires; a session stays until deleted', async () => {
    let now = AT
    const s = await fresh()
    const { stateStore, sessionStore } = s.oauthStores(() => now)
    await stateStore.set('k', { v: 1 } as never)
    expect(await stateStore.get('k')).toEqual({ v: 1 })
    now = new Date(AT.getTime() + 60 * 60 * 1000 + 1)
    expect(await stateStore.get('k')).toBe(undefined)
    await sessionStore.set(DID_A, { v: 2 } as never)
    expect(await sessionStore.get(DID_A)).toEqual({ v: 2 })
    await sessionStore.del(DID_A)
    expect(await sessionStore.get(DID_A)).toBe(undefined)
  })
})

describe('what must never be published (A5 findings)', () => {
  it('a live entry\'s public fields are not in allStrings(); pending entries, Guests and links are', async () => {
    const s = await fresh()
    await s.putNetworkEntry(entry({ handle: 'refi-a-public.org' }))
    await s.putNetworkEntry(entry({ id: 'ne-p', state: 'pending', why: null, did: DID_B, handle: 'pending-claim.bsky.social', node: 'refi-b' }))
    await s.putGuest(DID_G, 'guest-person.bsky.social', AT)
    await s.putAccountLink({ did: 'did:plc:llllllllllllllllllllllll', personId: 'org:person:one', handle: 'linked-person.bsky.social', linked: AT.toISOString() })
    const all = s.allStrings()
    expect(all.has('refi-a-public.org')).toBe(false)
    expect(all.has(DID_A)).toBe(false)
    for (const secret of ['pending-claim.bsky.social', DID_B, DID_G, 'guest-person.bsky.social', 'did:plc:llllllllllllllllllllllll', 'linked-person.bsky.social']) expect(all.has(secret)).toBe(true)
  })

  it('an entry\'s adder (a person id, public in git), its reason and its channel (plain words) are not taken', async () => {
    const s = await fresh()
    await s.putNetworkEntry(entry({ id: 'ne-p', state: 'pending', why: null, did: DID_B, handle: 'pending-claim.bsky.social', addedBy: 'org:person:someone' }))
    await s.setNetworkEntryState('ne-p', 'removed', { reason: 'declined after a call', channel: 'website' })
    const all = s.allStrings()
    for (const word of ['org:person:someone', 'declined after a call', 'website']) expect(all.has(word)).toBe(false)
  })

  it('a node\'s own account that also signed in as a Guest stays publishable', async () => {
    const s = await fresh()
    await s.putNetworkEntry(entry({ handle: 'refi-a-public.org' }))
    await s.putGuest(DID_A, 'refi-a-public.org', AT)
    const all = s.allStrings()
    expect(all.has(DID_A)).toBe(false)
    expect(all.has('refi-a-public.org')).toBe(false)
  })

  it('a backup counts the five network tables', async () => {
    const r = repo(); const dir = temp('network-store-')
    const s = await opened(r, dir)
    await s.putNetworkEntry(entry())
    const keyFile = join(temp('network-key-'), 'house.key'); createKey(keyFile)
    const made = await backup(s, { dir: temp('network-backups-'), keyFile, now: AT, repo: r })
    for (const name of NETWORK_TABLES) expect(made.counts).toHaveProperty(name)
    expect(made.counts.network_entries).toBe(1)
  })
})
