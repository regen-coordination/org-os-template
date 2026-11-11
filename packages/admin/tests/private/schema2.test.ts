import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { makeFixtureRepo } from '../fixtures.ts'
import { openPrivateStore, SCHEMA_VERSION, type PrivateStore } from '../../server/private/store.ts'
import { backup, createKey, restore, verifyBackup } from '../../server/private/backup.ts'
import { readKey, seal } from '../../server/private/crypto.ts'

// DAO-OS L6 §8.1, Task 3: the private store's schema 2. Every test runs in a fresh temporary repository (makeFixtureRepo)
// and keeps its store, backups and key in folders of their own under the temp directory: nothing is written inside this
// worktree. A version-1 store is built here from the version-1 tables, exactly as L5 made them.

const V1 = `
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
INSERT INTO records VALUES ('grievances', 'g-1', 'hat:Ops', '{"note":"kept"}', 'r1', '2026-10-01T10:00:00.000Z', 'steward-a');
INSERT INTO collections VALUES ('grievances', 'hat:Ops', '{"fields":[{"id":"note","type":"text"}]}');
INSERT INTO sessions VALUES ('h1', 'eip155:42220:0x00000000000000000000000000000000000000a1', '2026-10-29T11:00:00.000Z', '2026-10-30T11:00:00.000Z');
PRAGMA user_version = 1;
`
const NEW_TABLES = ['comments', 'drafts', 'mentions', 'notifications', 'reads', 'view_state']
// With the Roles, the email keys and the sign-in links (Lane 3 Task 2), which the same schema holds.
const ALL_TABLES = ['applied', 'collections', 'comments', 'drafts', 'email_keys', 'fields', 'history', 'mentions', 'notifications', 'pending',
  'reads', 'records', 'roles', 'roles_meta', 'sessions', 'sign_in_links', 'staged', 'view_state']
const NOW = new Date('2026-10-30T12:00:00Z')

const cleanup: string[] = []
const open: PrivateStore[] = []
afterEach(() => {
  for (const s of open.splice(0)) { try { s.close() } catch { /* already closed */ } }
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true })
})
const temp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); cleanup.push(d); return d }
const repo = () => { const r = makeFixtureRepo(); cleanup.push(r); return r }
const opened = async (r: string, dir: string) => { const s = await openPrivateStore(r, { dir }); open.push(s); return s }

/** A version-1 store file at `file`, holding one private record, one private collection and one session. */
function versionOne(file: string): void {
  const db = new DatabaseSync(file)
  try { db.exec(V1) } finally { db.close() }
}
function tablesOf(file: string): { tables: string[]; version: number } {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(t => t.name)
    return { tables, version: (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version }
  } finally { db.close() }
}

describe('the private store, schema 2 (L6 §8.1)', () => {
  it('a schema-2 store made before a comment kept its task gains the column when opened (Task 18 fix round 1)', async () => {
    const r = repo(), dir = temp('schema2-task-')
    const s = await opened(r, dir)
    await s.writeConversation({ comments: [{ id: 'cmt_1', target: 'page:p-1', parent: null, anchor: null, by: 'steward-a', body: 'b',
      created: '2026-10-31T12:00:00.000Z', edited: null, resolvedBy: null, resolvedAt: null, deleted: null }] })
    const file = s.file
    s.close(); open.splice(0)
    const db = new DatabaseSync(file)
    try { db.exec('ALTER TABLE comments DROP COLUMN task') } finally { db.close() }
    const again = await opened(r, dir)
    expect(again.comment('cmt_1')).toMatchObject({ id: 'cmt_1', task: null })
    await again.writeConversation({ comments: [{ ...again.comment('cmt_1')!, task: 'check-the-season' }] })
    expect(again.comment('cmt_1')!.task).toBe('check-the-season')
  })

  it('SCHEMA_VERSION is 2, and a new store has the six new tables, STRICT, column for column', async () => {
    expect(SCHEMA_VERSION).toBe(3) // schema 3 holds these tables and the Roles'
    const s = await opened(repo(), temp('schema2-'))
    expect(tablesOf(s.file)).toEqual({ tables: ALL_TABLES, version: 3 })
    const db = new DatabaseSync(s.file, { readOnly: true })
    try {
      const columns = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(c => c.name)
      expect(columns('comments')).toEqual(['id', 'target', 'parent', 'anchor', 'by', 'body', 'created', 'edited', 'resolved_by', 'resolved_at', 'deleted', 'task'])
      expect(columns('mentions')).toEqual(['source', 'kind', 'ref', 'told'])
      expect(columns('notifications')).toEqual(['id', 'member', 'kind', 'target', 'source', 'by', 'created', 'read_at'])
      expect(columns('reads')).toEqual(['member', 'target', 'at'])
      expect(columns('view_state')).toEqual(['member', 'collection', 'state'])
      expect(columns('drafts')).toEqual(['session', 'target', 'actor', 'base', 'body', 'opened', 'updated'])
      for (const t of NEW_TABLES) {
        const sql = (db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").get(t) as { sql: string }).sql
        expect(sql, t).toMatch(/\) STRICT$/)
      }
    } finally { db.close() }
  })

  it('a store at version 1 opens as version 2 with the new tables and its rows kept', async () => {
    const r = repo(), dir = temp('schema2-v1-')
    versionOne(join(dir, 'house.db'))
    expect(tablesOf(join(dir, 'house.db')).version).toBe(1)
    const s = await opened(r, dir)
    expect(tablesOf(s.file)).toEqual({ tables: ALL_TABLES, version: 3 })
    expect(s.record('grievances', 'g-1')).toEqual({ collection: 'grievances', id: 'g-1', visibility: 'hat:Ops', body: { note: 'kept' }, rev: 'r1' })
    expect(s.collections()).toEqual([{ id: 'grievances', visibility: 'hat:Ops', definition: { fields: [{ id: 'note', type: 'text' }] } }])
    expect(s.session('h1')?.account).toBe('eip155:42220:0x00000000000000000000000000000000000000a1')
    // The new tables work at once, and the store opens again as it is.
    await s.putViewState('steward-a', 'tasks', { view: 'open' })
    s.close(); open.splice(0)
    const again = await opened(r, dir)
    expect(again.viewState('steward-a', 'tasks')).toEqual({ view: 'open' })
    expect(again.record('grievances', 'g-1')?.body).toEqual({ note: 'kept' })
  })

  it('a version-1 backup restores into a version-2 server, migrated when it opens', async () => {
    const r = repo(), from = temp('schema2-from-'), to = temp('schema2-to-'), backups = temp('schema2-backups-')
    const keyFile = join(temp('schema2-key-'), 'house.key'); createKey(keyFile)
    const plain = join(from, 'house.db')
    versionOne(plain)
    // A backup written by a version-1 server: the store file, sealed under the key.
    const file = join(backups, 'house-20261029T120000Z.db.enc')
    writeFileSync(file, seal(readKey(keyFile), readFileSync(plain)), { mode: 0o600 })
    expect(verifyBackup(file, keyFile, { dir: to })).toMatchObject({ ok: true, version: 1 })
    await restore(r, file, keyFile, { dir: to, now: NOW })
    expect(tablesOf(join(to, 'house.db')).version).toBe(1) // restored as it was written
    const s = await opened(r, to)
    expect(tablesOf(s.file)).toEqual({ tables: ALL_TABLES, version: 3 })
    expect(s.record('grievances', 'g-1')?.body).toEqual({ note: 'kept' })
  })

  it('backup counts list the six new tables, the exact set of tables', async () => {
    const r = repo(), dir = temp('schema2-counts-'), backups = temp('schema2-backups-')
    const keyFile = join(temp('schema2-key-'), 'house.key'); createKey(keyFile)
    const s = await opened(r, dir)
    await s.putViewState('steward-a', 'tasks', { view: 'open' })
    await s.putDraft({ session: 's-1', target: 'page:p-000000000001', actor: 'steward-a', base: null, body: '# Notes', opened: NOW.toISOString(), updated: NOW.toISOString() })
    const made = await backup(s, { dir: backups, keyFile, now: NOW })
    expect(Object.keys(made.counts).sort()).toEqual(ALL_TABLES)
    expect(made.counts).toMatchObject({ comments: 0, mentions: 0, notifications: 0, reads: 0, view_state: 1, drafts: 1 })
    const line = JSON.parse(readFileSync(join(backups, 'manifest.jsonl'), 'utf8').trim()) as { version: number }
    expect(line.version).toBe(3)
  })
})

describe('view state (L6 §7.3)', () => {
  it('view state is per member and never in git', async () => {
    const r = repo()
    // The store kept inside the repository, in a folder git ignores (§10.1): git still holds nothing of it.
    writeFileSync(join(r, '.gitignore'), '.org-os/private/\n')
    execFileSync('git', ['add', '.gitignore'], { cwd: r }); execFileSync('git', ['commit', '-qm', 'fixture: ignore the store'], { cwd: r })
    const s = await opened(r, join(r, '.org-os', 'private'))
    await s.putViewState('steward-a', 'tasks', { view: 'open', filters: [{ field: 'status', op: 'is', value: 'sentinel-view-a' }] })
    await s.putViewState('steward-b', 'tasks', { view: 'by-owner', collapsed: ['done'] })
    expect(s.viewState('steward-a', 'tasks')).toEqual({ view: 'open', filters: [{ field: 'status', op: 'is', value: 'sentinel-view-a' }] })
    expect(s.viewState('steward-b', 'tasks')).toEqual({ view: 'by-owner', collapsed: ['done'] })
    expect(s.viewState('steward-c', 'tasks')).toBeNull()
    expect(s.viewState('steward-a', 'projects')).toBeNull()
    await s.putViewState('steward-a', 'tasks', { view: 'all' })
    expect(s.viewState('steward-a', 'tasks')).toEqual({ view: 'all' })
    await s.putViewState('steward-b', 'tasks', null)
    expect(s.viewState('steward-b', 'tasks')).toBeNull()
    expect(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: r, encoding: 'utf8' })).toBe('')
    expect(execFileSync('git', ['log', '-p', '--all'], { cwd: r, encoding: 'utf8' })).not.toContain('sentinel-view-a')
    // Not private data's history: a member's view is theirs alone.
    expect(s.history()).toEqual([])
  })
})

describe('drafts (L6 §6, §8.1; ruling P-10)', () => {
  it('a draft is put whole, read back, listed and deleted, and is no history row', async () => {
    const s = await opened(repo(), temp('schema2-drafts-'))
    const first = { session: 's-1', target: 'page:p-000000000001', actor: 'steward-a', base: '# Was', body: '# Was\n\nmore', opened: '2026-10-30T10:00:00.000Z', updated: '2026-10-30T10:00:01.000Z' }
    const second = { session: 's-2', target: 'page:p-000000000002', actor: 'steward-b', base: null, body: '', opened: '2026-10-30T11:00:00.000Z', updated: '2026-10-30T11:00:00.000Z' }
    await s.putDraft(first)
    await s.putDraft(second)
    expect(s.draft('s-1')).toEqual(first)
    expect(s.drafts()).toEqual([first, second])
    await s.putDraft({ ...first, body: '# Was\n\nmore still', updated: '2026-10-30T10:00:05.000Z' })
    expect(s.draft('s-1')?.body).toBe('# Was\n\nmore still')
    await s.deleteDraft('s-1')
    expect(s.draft('s-1')).toBeNull()
    expect(s.drafts()).toEqual([second])
    expect(s.history()).toEqual([])
    await expect(s.putDraft({ ...first, session: '' })).rejects.toThrow("the private store needs a draft's session as a non-empty string")
  })
})

describe('private collections (L5 §9.2, L6 §7.4)', () => {
  it('a private collection is removed with its history row', async () => {
    const s = await opened(repo(), temp('schema2-coll-'))
    await s.putCollection({ id: 'council-notes', visibility: 'hat:Ops', definition: { name: 'Council notes' } }, 'steward-a')
    await s.deleteCollection('council-notes', 'steward-a')
    expect(s.collections()).toEqual([])
    expect(s.history().map(h => [h.target, h.after])).toEqual([['council-notes', { id: 'council-notes', visibility: 'hat:Ops', definition: { name: 'Council notes' } }], ['council-notes', null]])
  })
})
