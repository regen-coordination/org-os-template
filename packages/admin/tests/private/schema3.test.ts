import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { makeFixtureRepo } from '../fixtures.ts'
import { openPrivateStore, SCHEMA_VERSION, type PrivateStore, type RolesDoc } from '../../server/private/store.ts'

// The private store's schema 3: the one store of both lines. 0.6.1 (Lane 3 Task 2) and the workspace (DAO-OS L6 §8.1)
// each wrote a schema 2 with tables of its own; a store either one wrote opens here at 3 with the other's tables added,
// every row kept. Every test makes its store in a fresh temporary repository and folder; synthetic values only.

const cleanup: string[] = []
const open: PrivateStore[] = []
afterEach(() => {
  for (const s of open.splice(0)) { try { s.close() } catch { /* already closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})
const temp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(d); return d }
const repo = () => { const r = makeFixtureRepo(); cleanup.push(r); return r }
const opened = async (r: string, dir: string) => { const s = await openPrivateStore(r, { dir }); open.push(s); return s }

/** L5's tables, as schema 1 made them: both lines' schema 2 starts from these. */
const L5 = `
CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, visibility TEXT NOT NULL, body TEXT NOT NULL,
  rev TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY (collection, id)) STRICT;
CREATE TABLE fields (registry TEXT NOT NULL, record TEXT NOT NULL, field TEXT NOT NULL, visibility TEXT NOT NULL,
  value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY (registry, record, field)) STRICT;
CREATE TABLE collections (id TEXT NOT NULL PRIMARY KEY, visibility TEXT NOT NULL, definition TEXT NOT NULL) STRICT;
CREATE TABLE history (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, "by" TEXT NOT NULL, target TEXT NOT NULL,
  "before" TEXT, "after" TEXT, change TEXT, decision TEXT) STRICT;
CREATE TABLE staged (change TEXT NOT NULL, seq INTEGER NOT NULL, actor TEXT NOT NULL, op TEXT NOT NULL, PRIMARY KEY (change, seq)) STRICT;
CREATE TABLE pending (ref TEXT NOT NULL PRIMARY KEY, proposal TEXT NOT NULL, salt TEXT NOT NULL, ops TEXT NOT NULL, digest TEXT NOT NULL) STRICT;
CREATE TABLE applied (proposal TEXT NOT NULL PRIMARY KEY, "commit" TEXT NOT NULL, at TEXT NOT NULL) STRICT;
CREATE TABLE sessions (token_hash TEXT NOT NULL PRIMARY KEY, account TEXT NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL) STRICT;
INSERT INTO records VALUES ('grievances', 'g-1', 'hat:Ops', '{"note":"kept"}', 'r1', '2026-10-29T10:00:00.000Z', 'steward-a');
`
/** Schema 2 as 0.6.1 and 0.6.2 wrote it: L5's tables and the Roles, the email keys and the sign-in links. */
const MAIN_2 = `${L5}
CREATE TABLE roles (person_id TEXT PRIMARY KEY, name TEXT NOT NULL, roles TEXT NOT NULL, nodes TEXT NOT NULL) STRICT;
CREATE TABLE email_keys (email_key TEXT PRIMARY KEY, person_id TEXT NOT NULL) STRICT;
CREATE TABLE roles_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) STRICT;
CREATE TABLE sign_in_links (token_hash TEXT PRIMARY KEY, person_id TEXT NOT NULL, return_to TEXT NOT NULL,
  created TEXT NOT NULL, expires TEXT NOT NULL, used_at TEXT) STRICT;
INSERT INTO roles VALUES ('example-org:person:example-steward', 'Example Steward', '["steward"]', '[]');
INSERT INTO roles_meta VALUES ('roles_version', '2026-11-18');
PRAGMA user_version = 2;
`
/** Schema 2 as the workspace's line wrote it: L5's tables and the six of the conversation, view state and drafts. */
const WORKSPACE_2 = `${L5}
CREATE TABLE comments (id TEXT NOT NULL PRIMARY KEY, target TEXT NOT NULL, parent TEXT, anchor TEXT, "by" TEXT NOT NULL,
  body TEXT NOT NULL, created TEXT NOT NULL, edited TEXT, resolved_by TEXT, resolved_at TEXT, deleted TEXT, task TEXT) STRICT;
CREATE TABLE mentions (source TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, told INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source, kind, ref)) STRICT;
CREATE TABLE notifications (id TEXT NOT NULL PRIMARY KEY, member TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
  source TEXT NOT NULL, "by" TEXT NOT NULL, created TEXT NOT NULL, read_at TEXT) STRICT;
CREATE TABLE reads (member TEXT NOT NULL, target TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (member, target)) STRICT;
CREATE TABLE view_state (member TEXT NOT NULL, collection TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY (member, collection)) STRICT;
CREATE TABLE drafts (session TEXT NOT NULL PRIMARY KEY, target TEXT NOT NULL, actor TEXT NOT NULL, base TEXT, body TEXT NOT NULL,
  opened TEXT NOT NULL, updated TEXT NOT NULL) STRICT;
INSERT INTO comments VALUES ('cmt_1', 'page:p-1', NULL, NULL, 'steward-a', 'kept', '2026-10-31T12:00:00.000Z', NULL, NULL, NULL, NULL, NULL);
INSERT INTO view_state VALUES ('steward-a', 'tasks', '{"view":"open"}');
PRAGMA user_version = 2;
`
// Schema 4 (the ReFi DAO Network, B1) adds five tables of its own: account_links, network_entries, network_guests,
// oauth_sessions, oauth_state.
const ALL_TABLES = ['account_links', 'applied', 'collections', 'comments', 'drafts', 'email_keys', 'fields', 'history', 'mentions', 'network_entries',
  'network_guests', 'notifications', 'oauth_sessions', 'oauth_state', 'pending', 'reads', 'records', 'roles', 'roles_meta', 'sessions', 'sign_in_links', 'staged', 'view_state']
const DOC: RolesDoc = {
  roles_version: '2026-11-25',
  people: [{ id: 'example-org:person:example-lead', name: 'Example Lead', email_keys: ['b'.repeat(64)], roles: ['node-lead'], nodes: ['node-one'] }],
}

/** A store file at `dir/house.db`, written by `sql`. */
function written(dir: string, sql: string): void {
  const db = new DatabaseSync(join(dir, 'house.db'))
  try { db.exec('PRAGMA journal_mode = WAL'); db.exec(sql) } finally { db.close() }
}
function tablesOf(file: string): { tables: string[]; version: number } {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(t => t.name)
    return { tables, version: (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version }
  } finally { db.close() }
}

describe('the private store, schema 3: both lines\' tables', () => {
  it('SCHEMA_VERSION is 3, and a fresh store has every table of both lines', async () => {
    expect(SCHEMA_VERSION).toBe(4) // 4 (B1) adds the network's five tables on top of both lines'
    const s = await opened(repo(), temp('schema3-fresh-'))
    expect(tablesOf(s.file)).toEqual({ tables: ALL_TABLES, version: 4 })
  })

  it('a schema 2 store 0.6.1 wrote opens at 3 with the workspace\'s tables, its Roles and records kept', async () => {
    const r = repo(), dir = temp('schema3-main2-')
    written(dir, MAIN_2)
    const s = await opened(r, dir)
    expect(tablesOf(s.file)).toEqual({ tables: ALL_TABLES, version: 4 })
    expect(s.record('grievances', 'g-1')?.body).toEqual({ note: 'kept' })
    expect(s.person('example-org:person:example-steward')).toMatchObject({ name: 'Example Steward', roles: ['steward'] })
    expect(s.rolesVersion()).toBe('2026-11-18')
    // The workspace's tables work at once.
    await s.putViewState('steward-a', 'tasks', { view: 'open' })
    expect(s.viewState('steward-a', 'tasks')).toEqual({ view: 'open' })
  })

  it('a schema 2 store the workspace wrote opens at 3 with the Roles\' tables, its comments and view state kept', async () => {
    const r = repo(), dir = temp('schema3-ws2-')
    written(dir, WORKSPACE_2)
    const s = await opened(r, dir)
    expect(tablesOf(s.file)).toEqual({ tables: ALL_TABLES, version: 4 })
    expect(s.comment('cmt_1')).toMatchObject({ body: 'kept', task: null })
    expect(s.viewState('steward-a', 'tasks')).toEqual({ view: 'open' })
    // The Roles' tables work at once.
    await s.replaceRoles(DOC)
    expect(s.rolesVersion()).toBe('2026-11-25')
  })
})
