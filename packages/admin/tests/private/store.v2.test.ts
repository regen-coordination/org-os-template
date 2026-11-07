import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { makeFixtureRepo } from '../fixtures.ts'
import { openPrivateStore, SCHEMA_VERSION, type PrivateStore, type RolesDoc, type RolesLink } from '../../server/private/store.ts'
import { backup, createKey, restore } from '../../server/private/backup.ts'

// Lane 3 Task 2: the private store's schema 2 — the Roles loaded from the records dump (I4), the email keys (I3) and the
// single-use sign-in links. Synthetic values only: no address is ever written, and the byte scan below holds the store
// to it.

const cleanup: string[] = []
const open: PrivateStore[] = []
afterEach(() => {
  for (const s of open.splice(0)) { try { s.close() } catch { /* already closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})

function temp(prefix: string): string { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(d); return d }
function repo(): string { const r = makeFixtureRepo(); cleanup.push(r); return r }
async function opened(r = repo(), dir = temp('private-v2-')): Promise<PrivateStore> {
  const s = await openPrivateStore(r, { dir }); open.push(s); return s
}

const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64), KEY_C = 'c'.repeat(64)
const DOC: RolesDoc = {
  roles_version: '2026-11-18',
  people: [
    { id: 'refidao:person:example-steward', name: 'Example Steward', email_keys: [KEY_A], roles: ['network-member', 'steward'], nodes: [] },
    { id: 'refidao:person:example-lead', name: 'Example Lead', email_keys: [KEY_B, KEY_C], roles: ['node-lead'], nodes: ['node-one', 'node-two'] },
  ],
}
const NOW = new Date('2026-11-18T09:00:00.000Z')
/** An email address's shape, as text in a file. */
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/
const later = (ms: number) => new Date(NOW.getTime() + ms)
const link = (tokenHash: string, expires = later(15 * 60_000)): Omit<RolesLink, 'usedAt'> => ({
  tokenHash, personId: 'refidao:person:example-steward', returnTo: 'https://hub.example.org/', created: NOW.toISOString(), expires: expires.toISOString(),
})

/** Schema 1 as org-os 0.6 wrote it (L5 §10.2), so a store made before this lane can be opened by it. */
const SCHEMA_1 = `
CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, visibility TEXT NOT NULL, body TEXT NOT NULL,
  rev TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY (collection, id)) STRICT;
CREATE TABLE fields (registry TEXT NOT NULL, record TEXT NOT NULL, field TEXT NOT NULL, visibility TEXT NOT NULL,
  value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY (registry, record, field)) STRICT;
CREATE TABLE collections (id TEXT NOT NULL PRIMARY KEY, visibility TEXT NOT NULL, definition TEXT NOT NULL) STRICT;
CREATE TABLE history (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, "by" TEXT NOT NULL, target TEXT NOT NULL,
  "before" TEXT, "after" TEXT, change TEXT, decision TEXT) STRICT;
CREATE TRIGGER history_no_update BEFORE UPDATE ON history BEGIN SELECT RAISE(ABORT, 'the private store''s history is append only'); END;
CREATE TRIGGER history_no_delete BEFORE DELETE ON history BEGIN SELECT RAISE(ABORT, 'the private store''s history is append only'); END;
CREATE TABLE staged (change TEXT NOT NULL, seq INTEGER NOT NULL, actor TEXT NOT NULL, op TEXT NOT NULL, PRIMARY KEY (change, seq)) STRICT;
CREATE TABLE pending (ref TEXT NOT NULL PRIMARY KEY, proposal TEXT NOT NULL, salt TEXT NOT NULL, ops TEXT NOT NULL, digest TEXT NOT NULL) STRICT;
CREATE TABLE applied (proposal TEXT NOT NULL PRIMARY KEY, "commit" TEXT NOT NULL, at TEXT NOT NULL) STRICT;
CREATE TABLE sessions (token_hash TEXT NOT NULL PRIMARY KEY, account TEXT NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL) STRICT;
PRAGMA user_version = 1;
`

describe('schema 2 (Lane 3 Task 2)', () => {
  it('a schema 1 file opens as schema 2 and keeps its rows', async () => {
    const r = repo(), dir = temp('private-v1-')
    const raw = new DatabaseSync(join(dir, 'house.db'))
    raw.exec('PRAGMA journal_mode = WAL')
    raw.exec(SCHEMA_1)
    raw.exec(`INSERT INTO records VALUES ('grievances', 'g-1', 'hat:Ops', '{"note":"kept"}', 'r1', '2026-10-29T10:00:00.000Z', 'steward-a');
      INSERT INTO history (at, "by", target, "before", "after", change, decision) VALUES ('2026-10-29T10:00:00.000Z', 'steward-a', 'grievances/g-1', NULL, '{}', NULL, NULL);
      INSERT INTO sessions VALUES ('h1', 'eip155:42220:0x00000000000000000000000000000000000000a1', '2026-10-29T11:00:00.000Z', '2026-10-30T11:00:00.000Z');`)
    raw.close()

    expect(SCHEMA_VERSION).toBe(2)
    const s = await opened(r, dir)
    expect(s.record('grievances', 'g-1')?.body).toEqual({ note: 'kept' })
    expect(s.history()).toHaveLength(1)
    expect(s.session('h1')?.account).toBe('eip155:42220:0x00000000000000000000000000000000000000a1')
    expect(s.rolesVersion()).toBeNull()
    expect(s.person('refidao:person:example-steward')).toBeNull()
    await s.replaceRoles(DOC)
    expect(s.rolesVersion()).toBe('2026-11-18')
    s.close()

    const db = new DatabaseSync(join(dir, 'house.db'), { readOnly: true })
    try {
      const columns = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(c => c.name)
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 })
      expect(columns('roles')).toEqual(['person_id', 'name', 'roles', 'nodes'])
      expect(columns('email_keys')).toEqual(['email_key', 'person_id'])
      expect(columns('roles_meta')).toEqual(['k', 'v'])
      expect(columns('sign_in_links')).toEqual(['token_hash', 'person_id', 'return_to', 'created', 'expires', 'used_at'])
    } finally { db.close() }
  })

  it('a fresh store is made at schema 2', async () => {
    const s = await opened()
    s.close()
    const db = new DatabaseSync(s.file, { readOnly: true })
    try { expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 }) } finally { db.close() }
  })
})

describe('the Roles (I4) and the email keys (I3)', () => {
  it('reads a person by id and by any of their email keys', async () => {
    const s = await opened()
    await s.replaceRoles(DOC)
    const lead = { id: 'refidao:person:example-lead', name: 'Example Lead', roles: ['node-lead'], nodes: ['node-one', 'node-two'] }
    expect(s.person('refidao:person:example-lead')).toEqual(lead)
    expect(s.personByEmailKey(KEY_B)).toEqual(lead)
    expect(s.personByEmailKey(KEY_C)).toEqual(lead)
    expect(s.personByEmailKey(KEY_A)?.id).toBe('refidao:person:example-steward')
    expect(s.personByEmailKey('d'.repeat(64))).toBeNull()
    expect(s.person('refidao:person:nobody')).toBeNull()
  })

  it('replaceRoles replaces, never merges', async () => {
    const s = await opened()
    await s.replaceRoles(DOC)
    await s.replaceRoles({ roles_version: '2026-11-25', people: [{ ...DOC.people[0]!, roles: ['network-member'], email_keys: [KEY_C] }] })
    expect(s.rolesVersion()).toBe('2026-11-25')
    expect(s.person('refidao:person:example-lead')).toBeNull()
    expect(s.personByEmailKey(KEY_B)).toBeNull()
    expect(s.personByEmailKey(KEY_A)).toBeNull() // the steward's old key went with the old doc
    expect(s.personByEmailKey(KEY_C)).toEqual({ id: 'refidao:person:example-steward', name: 'Example Steward', roles: ['network-member'], nodes: [] })
    expect(s.history()).toEqual([]) // the dump is the source: no history row
  })

  it('one email key, one person', async () => {
    const s = await opened()
    await s.replaceRoles(DOC)
    const twice: RolesDoc = { roles_version: '2026-11-25', people: [
      { ...DOC.people[0]!, email_keys: [KEY_A] },
      { ...DOC.people[1]!, email_keys: [KEY_A] },
    ] }
    await expect(s.replaceRoles(twice)).rejects.toThrow('An email key is held by two people in this Roles document; nothing was loaded.')
    // nothing written: the old doc stands whole
    expect(s.rolesVersion()).toBe('2026-11-18')
    expect(s.personByEmailKey(KEY_B)?.id).toBe('refidao:person:example-lead')
  })

  it('refuses a doc it must not hold, in words that name no value', async () => {
    const s = await opened()
    const cases: [RolesDoc, string][] = [
      [{ ...DOC, people: [{ ...DOC.people[0]!, name: 'steward@example.org' }] }, 'A Roles document must hold no address'],
      [{ ...DOC, people: [{ ...DOC.people[0]!, roles: ['admin' as never] }] }, 'unknown Role'],
      [{ ...DOC, people: [{ ...DOC.people[0]!, email_keys: ['ABC'] }] }, 'not 64 lowercase hex'],
      [{ ...DOC, people: [DOC.people[0]!, DOC.people[0]!] }, 'listed twice'],
      [{ ...DOC, roles_version: '' }, 'roles_version'],
    ]
    for (const [doc, words] of cases) {
      const err = await s.replaceRoles(doc).then(() => null, (e: Error) => e)
      expect(err?.message).toContain(words)
      expect(err?.message).not.toContain('example.org')
      expect(err?.message).not.toContain('Example Steward')
    }
    expect(s.rolesVersion()).toBeNull()
  })
})

describe('single-use sign-in links', () => {
  it('takeLink works once', async () => {
    const s = await opened()
    await s.replaceRoles(DOC)
    await s.putLink(link('h'.repeat(64)))
    const [one, two] = await Promise.all([s.takeLink('h'.repeat(64), later(60_000)), s.takeLink('h'.repeat(64), later(60_000))])
    const taken = [one, two].filter(t => typeof t === 'object')
    expect(taken).toHaveLength(1)
    expect([one, two].filter(t => t === 'used')).toHaveLength(1)
    expect(taken[0]).toEqual({ ...link('h'.repeat(64)), usedAt: later(60_000).toISOString() })
    expect(await s.takeLink('h'.repeat(64), later(120_000))).toBe('used')
  })

  it("an expired link is 'expired'", async () => {
    const s = await opened()
    await s.putLink(link('e'.repeat(64)))
    expect(await s.takeLink('e'.repeat(64), later(15 * 60_000))).toBe('expired')
    expect(await s.takeLink('e'.repeat(64), later(15 * 60_000 - 1))).toMatchObject({ tokenHash: 'e'.repeat(64) }) // still unused, so still live before it
  })

  it("an unknown link is 'unknown'", async () => {
    const s = await opened()
    expect(await s.takeLink('0'.repeat(64), NOW)).toBe('unknown')
  })

  it('deleteLinksExpired removes the links expired at or before the time, used or not', async () => {
    const s = await opened()
    await s.putLink(link('1'.repeat(64), later(60_000)))
    await s.putLink(link('2'.repeat(64), later(120_000)))
    await s.deleteLinksExpired(later(60_000))
    expect(await s.takeLink('1'.repeat(64), NOW)).toBe('unknown')
    expect(await s.takeLink('2'.repeat(64), NOW)).toMatchObject({ tokenHash: '2'.repeat(64) })
  })

  it('a link that would hold an address is refused', async () => {
    const s = await opened()
    await expect(s.putLink({ ...link('3'.repeat(64)), returnTo: 'https://hub.example.org/?who=steward@example.org' })).rejects.toThrow('A sign-in link must hold no address')
    await expect(s.putLink({ ...link('3'.repeat(64)), returnTo: 'https://hub.example.org/?who=steward%40example.org' })).rejects.toThrow('A sign-in link must hold no address')
    expect(await s.takeLink('3'.repeat(64), NOW)).toBe('unknown')
  })
})

describe('what the file holds', () => {
  it("the store file holds no '@' after a load and a link", async () => {
    const s = await opened()
    await s.replaceRoles(DOC)
    await s.putLink({ ...link('4'.repeat(64)), returnTo: 'https://ideas.example.org/idea/1?x=y#z' })
    await s.takeLink('4'.repeat(64), later(1000))
    // SQLite's own page bytes can be 0x40, so the scan reads the file as text for an address's shape (ruling S2-2).
    for (const f of [s.file, `${s.file}-wal`]) {
      if (!existsSync(f)) continue
      const text = readFileSync(f).toString('latin1')
      expect(text).not.toMatch(ADDRESS)
    }
    expect(existsSync(`${s.file}-wal`)).toBe(true) // the scan read the WAL, where the writes are before a checkpoint
  })

  it('the email keys are among the strings the door refuses to publish; the names and ids are not', async () => {
    const s = await opened()
    await s.replaceRoles(DOC)
    const all = s.allStrings()
    expect(all.has(KEY_A)).toBe(true)
    expect(all.has('Example Steward')).toBe(false)
    expect(all.has('refidao:person:example-steward')).toBe(false)
  })

  it('a backup restores the roles tables', async () => {
    const r = repo(), from = temp('private-a-'), to = temp('private-b-'), backups = temp('backups-')
    const key = join(temp('backup-key-'), 'house.key'); createKey(key)
    const s = await opened(r, from)
    await s.replaceRoles(DOC)
    await s.putLink(link('5'.repeat(64)))
    const made = await backup(s, { dir: backups, keyFile: key, now: NOW })
    expect(made.counts).toMatchObject({ roles: 2, email_keys: 3, roles_meta: 2, sign_in_links: 1 })
    s.close()
    await restore(r, made.file, key, { dir: to, now: NOW })
    const back = await opened(r, to)
    expect(back.rolesVersion()).toBe('2026-11-18')
    expect(back.personByEmailKey(KEY_C)?.id).toBe('refidao:person:example-lead')
    expect(await back.takeLink('5'.repeat(64), later(1000))).toMatchObject({ personId: 'refidao:person:example-steward' })
  })
})
