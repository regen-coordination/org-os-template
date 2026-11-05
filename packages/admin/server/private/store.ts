import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { isIgnored } from '../git.ts'
import { placeInRepo, privateDir, STORE_FILE } from './paths.ts'

/** The private store (L5 spec §10): what git must never hold — private records, restricted fields, private
 *  collections' definitions — with its own append-only history, since git keeps none of it. One SQLite file
 *  through `node:sqlite` (no native dependency), in WAL mode, outside git or refused (§10.1).
 *
 *  Two connections (controller ruling P7). Every write goes through the one write connection, one transaction at
 *  a time: `begin()` may be held open across an async git commit (§10.3's order), so a write lock serialises
 *  `tx`, `begin`…`commit`/`rollback` and the single puts and deletes, which wait their turn. Reads go through a
 *  second, read-only connection, so a read made while a transaction is open sees what was last committed and
 *  never a row that may yet be rolled back. */

export const SCHEMA_VERSION = 1

/** The store cannot be used: its place is not ignored by git, its file cannot be opened, or a newer org-os wrote
 *  it. The git side keeps serving; private reads and writes refuse with this message as attention (§10.1). */
export class StoreUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'StoreUnavailable' }
}

export interface PrivateRecord { collection: string; id: string; visibility: string; body: Record<string, unknown>; rev: string }
export interface PrivateField { registry: string; record: string; field: string; visibility: string; value: unknown }
/** A private collection (§9.2): never named in git, its definition kept here. */
export interface PrivateCollection { id: string; visibility: string; definition: unknown }
/** One staged op on private data (§10.2 `staged`), kept here so a restricted value is in one place on disk: the change
 *  file in the state directory holds a placeholder (`stg-<seq>`). `op` is the op as JSON (Task 14's `PrivateOp`). */
export interface StagedRow { change: string; seq: number; actor: string; op: unknown }
/** One write. `target` is `<collection>/<id>` for a record, `<registry>/<record>/<field>` for a field (the wallet
 *  link is `members/<id>/wallet`); `before`/`after` the whole record or field, null where there was none. */
export interface HistoryRow {
  seq: number; at: string; by: string; target: string
  before: unknown; after: unknown; change: string | null; decision: string | null
}

/** The private part of an open proposal (§10.2 `pending`, §9.6): one row per placeholder the ledger holds (`ref`,
 *  `prv_<16 hex>`), with the real ops, the salt and the digest over both (`sha256:<hex>` of salt ‖ canonical JSON). */
export interface PendingRow { ref: string; proposal: string; salt: string; ops: unknown[]; digest: string }
/** A proposal whose private part is applied (§10.2 `applied`): the commit it was applied with, and when. */
export interface AppliedRow { proposal: string; commit: string; at: string }

/** A sign-in session (§4.4, `sessions` table): the SHA-256 of its token, never the token. Not private data, so not in
 *  `history`. */
export interface SessionRow { tokenHash: string; account: string; created: string; expires: string }

/** The writes a transaction may make. `decision`, on a write a ratify makes, is the decision row's id (history's
 *  `decision`); null otherwise. */
export interface PrivateWriter {
  putRecord(r: PrivateRecord, by: string, change: string | null, decision?: string | null): void
  deleteRecord(collection: string, id: string, by: string, change: string | null, decision?: string | null): void
  putField(f: PrivateField, by: string, change: string | null, decision?: string | null): void
  deleteField(registry: string, record: string, field: string, by: string, change: string | null, decision?: string | null): void
  /** A private collection's definition, written whole; its history target is the collection's id alone. */
  putCollection(c: PrivateCollection, by: string): void
  /** One staged op, put at (change, seq): a later put at the same place replaces it. Not private data's history. */
  putStaged(row: StagedRow): void
  /** The staged op of `change` at `seq`, or, with no `seq`, every one (after it is applied, or when it is discarded). */
  deleteStaged(change: string, seq?: number): void
  /** One row of a proposal's private part. Not private data's history: the ops are written there when applied. */
  putPending(row: PendingRow): void
  /** Every row of proposal `proposal`'s private part (it was revised, closed, or applied). */
  deletePending(proposal: string): void
  /** Proposal `row.proposal`'s private part is applied. */
  putApplied(row: AppliedRow): void
}
/** An open write transaction (`begin()`): its writes, then exactly one of `commit` or `rollback`. */
export interface PrivateTransaction extends PrivateWriter { commit(): void; rollback(): void }

/** How the store asks git whether its folder is ignored: `server/git.ts`, or a stand-in in a test. */
export interface Git { isIgnored(repo: string, path: string): Promise<boolean> }

// Spec §10.2, table for table and column for column. JSON is kept as TEXT. History is append only, in the file too.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, visibility TEXT NOT NULL, body TEXT NOT NULL,
  rev TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY (collection, id)) STRICT;
CREATE TABLE IF NOT EXISTS fields (registry TEXT NOT NULL, record TEXT NOT NULL, field TEXT NOT NULL, visibility TEXT NOT NULL,
  value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY (registry, record, field)) STRICT;
CREATE TABLE IF NOT EXISTS collections (id TEXT NOT NULL PRIMARY KEY, visibility TEXT NOT NULL, definition TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS history (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, "by" TEXT NOT NULL, target TEXT NOT NULL,
  "before" TEXT, "after" TEXT, change TEXT, decision TEXT) STRICT;
CREATE TRIGGER IF NOT EXISTS history_no_update BEFORE UPDATE ON history BEGIN SELECT RAISE(ABORT, 'the private store''s history is append only'); END;
CREATE TRIGGER IF NOT EXISTS history_no_delete BEFORE DELETE ON history BEGIN SELECT RAISE(ABORT, 'the private store''s history is append only'); END;
CREATE TABLE IF NOT EXISTS staged (change TEXT NOT NULL, seq INTEGER NOT NULL, actor TEXT NOT NULL, op TEXT NOT NULL, PRIMARY KEY (change, seq)) STRICT;
CREATE TABLE IF NOT EXISTS pending (ref TEXT NOT NULL PRIMARY KEY, proposal TEXT NOT NULL, salt TEXT NOT NULL, ops TEXT NOT NULL, digest TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS applied (proposal TEXT NOT NULL PRIMARY KEY, "commit" TEXT NOT NULL, at TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT NOT NULL PRIMARY KEY, account TEXT NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL) STRICT;
`

/** §10.1's sentence for a place inside the repository that git does not ignore. */
function notIgnored(place: string): string {
  if (place === '') return `The private store would be at ${STORE_FILE}, at the root of the repository, which git does not ignore. Set ORG_OS_PRIVATE_DIR to a folder outside it, or to a folder .gitignore names.`
  return `The private store would be at ${place}/${STORE_FILE}, which git does not ignore. Add \`${place}/\` to .gitignore first.`
}
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** §10.1's location rule, alone: resolves when the folder `dir` is outside `repo`, or inside it and ignored by git
 *  whole (`<folder>/`, so the WAL files and backups beside the file are ignored too) with the file itself; otherwise
 *  rejects with `StoreUnavailable` and the sentence. Creates nothing. A restore asks it before it writes a file. */
export async function checkStorePlace(repo: string, dir: string, git: Git = { isIgnored }): Promise<void> {
  const place = placeInRepo(repo, dir)
  if (place === '') throw new StoreUnavailable(notIgnored(place))
  if (place === null) return
  let ignored: boolean
  try {
    ignored = (await git.isIgnored(repo, `${place}/`)) && (await git.isIgnored(repo, `${place}/${STORE_FILE}`))
  } catch (err) {
    throw new StoreUnavailable(`The private store would be at ${place}/${STORE_FILE}, and git could not say whether it ignores that folder: ${reason(err)}`)
  }
  if (!ignored) throw new StoreUnavailable(notIgnored(place))
}

/** Opens (creating when absent) the private store of `repo`: in `opts.dir`, else `privateDir(repo)`. A folder inside
 *  the repository must be one git ignores, whole (`<folder>/`, so the WAL files and backups beside the file are
 *  ignored too) and the file itself (a tracked file is not ignored): otherwise `StoreUnavailable` with §10.1's
 *  sentence, and nothing is created. A file that cannot be opened, or that a newer schema wrote, is
 *  `StoreUnavailable` too, naming the file and never what it holds. */
export async function openPrivateStore(repo: string, opts: { dir?: string; git?: Git; lockWaitMs?: number } = {}): Promise<PrivateStore> {
  const dir = resolve(opts.dir ?? privateDir(repo))
  await checkStorePlace(repo, dir, opts.git)
  try { mkdirSync(dir, { recursive: true, mode: 0o700 }) } catch (err) {
    throw new StoreUnavailable(`The private store's folder ${dir} could not be made: ${reason(err)}`)
  }
  const file = join(dir, STORE_FILE)
  const fresh = !existsSync(file)
  let db: DatabaseSync | undefined
  let reader: DatabaseSync | undefined
  try {
    db = new DatabaseSync(file)
    if (fresh) chmodSync(file, 0o600)
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (version > SCHEMA_VERSION) throw new StoreUnavailable(`This private store was written by a newer org-os (schema ${version}); update first.`)
    const mode = (db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode: string }).journal_mode
    if (mode !== 'wal') throw new Error(`it could not be put in WAL mode (it is in ${mode} mode)`)
    db.exec('PRAGMA busy_timeout = 5000')
    if (version < SCHEMA_VERSION) {
      db.exec('BEGIN IMMEDIATE')
      try { db.exec(`${SCHEMA}\nPRAGMA user_version = ${SCHEMA_VERSION};`); db.exec('COMMIT') } catch (err) { db.exec('ROLLBACK'); throw err }
    }
    reader = new DatabaseSync(file, { readOnly: true })
    reader.exec('PRAGMA busy_timeout = 5000')
    return new PrivateStore(file, db, reader, opts.lockWaitMs ?? LOCK_WAIT_MS)
  } catch (err) {
    for (const c of [reader, db]) { try { c?.close() } catch { /* closing what failed to open */ } }
    if (err instanceof StoreUnavailable) throw err
    throw new StoreUnavailable(`The private store at ${file} could not be opened: ${reason(err)}`)
  }
}

/** How long a write waits for the one before it before saying so: a transaction held longer was left open. */
export const LOCK_WAIT_MS = 30_000

/** Serialises the write transactions: each `acquire` resolves, in order, once every earlier holder has released.
 *  A wait longer than `waitMs` rejects with `StoreUnavailable`, naming the transaction left open; the waiter that
 *  gave up passes its turn on at once when it comes, so the writes queued after it still run. */
class WriteLock {
  private tail: Promise<void> = Promise.resolve()
  constructor(private readonly waitMs: number) {}
  acquire(): Promise<() => void> {
    let free!: () => void
    const done = new Promise<void>(r => { free = r })
    const turn = this.tail
    this.tail = turn.then(() => done)
    let released = false
    const release = () => { if (!released) { released = true; free() } }
    return new Promise((resolve, reject) => {
      let gaveUp = false
      const timer = setTimeout(() => {
        gaveUp = true
        reject(new StoreUnavailable(`A write to the private store waited ${this.waitMs} ms for the one before it, which was never finished: a transaction was left open (begin() without commit() or rollback()), so nothing was written.`))
      }, this.waitMs)
      timer.unref() // a wait never keeps the process alive by itself
      void turn.then(() => {
        clearTimeout(timer)
        if (gaveUp) release()
        else resolve(release)
      })
    })
  }
}

interface RecordRow { collection: string; id: string; visibility: string; body: string; rev: string }
interface FieldRow { registry: string; record: string; field: string; visibility: string; value: string }
interface HistoryRaw { seq: number; at: string; by: string; target: string; before: string | null; after: string | null; change: string | null; decision: string | null }

const asRecord = (r: RecordRow): PrivateRecord => ({ collection: r.collection, id: r.id, visibility: r.visibility, body: JSON.parse(r.body) as Record<string, unknown>, rev: r.rev })
const asField = (f: FieldRow): PrivateField => ({ registry: f.registry, record: f.record, field: f.field, visibility: f.visibility, value: JSON.parse(f.value) as unknown })
const json = (v: unknown): string | null => (v === null ? null : JSON.stringify(v))

/** A decision row's id, or null for a write no ratify made. */
function decisionOf(v: unknown): string | null {
  if (v === null || v === undefined) return null
  return nonEmpty('a decision id, or null,', v)
}

/** A change id, or null for a write outside any change. */
function changeOf(v: unknown): string | null {
  if (v === null) return null
  return nonEmpty('a change id, or null,', v)
}

function nonEmpty(name: string, v: unknown): string {
  if (typeof v !== 'string' || v === '') throw new Error(`the private store needs ${name} as a non-empty string`)
  return v
}

export class PrivateStore {
  readonly file: string
  /** Told, with the sentence to show, when the store fails after it opened (a damaged file, a full disk): the server raises
   *  it as the store's attention (§10.1). Null: nobody is told but the log. */
  onFailure: ((sentence: string) => void) | null = null
  private readonly lock: WriteLock
  private readonly w: Record<'recordGet' | 'recordPut' | 'recordDelete' | 'fieldGet' | 'fieldPut' | 'fieldDelete' | 'historyAdd' | 'sessionPut' | 'sessionDelete' | 'sessionsExpired'
    | 'collectionGet' | 'collectionPut' | 'stagedPut' | 'stagedDelete' | 'stagedDeleteOne' | 'pendingPut' | 'pendingDelete' | 'appliedPut', StatementSync>
  private readonly r: Record<'record' | 'records' | 'fields' | 'fieldsNamed' | 'collections' | 'history' | 'historyOf' | 'session' | 'staged'
    | 'stagedAll' | 'pending' | 'pendingAll' | 'applied', StatementSync>

  /** Use `openPrivateStore`. */
  constructor(file: string, private readonly db: DatabaseSync, private readonly reader: DatabaseSync, lockWaitMs: number = LOCK_WAIT_MS) {
    this.file = file
    this.lock = new WriteLock(lockWaitMs)
    this.w = {
      recordGet: db.prepare('SELECT collection, id, visibility, body, rev FROM records WHERE collection = ? AND id = ?'),
      recordPut: db.prepare(`INSERT INTO records (collection, id, visibility, body, rev, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (collection, id) DO UPDATE SET visibility = excluded.visibility, body = excluded.body, rev = excluded.rev,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by`),
      recordDelete: db.prepare('DELETE FROM records WHERE collection = ? AND id = ?'),
      fieldGet: db.prepare('SELECT registry, record, field, visibility, value FROM fields WHERE registry = ? AND record = ? AND field = ?'),
      fieldPut: db.prepare(`INSERT INTO fields (registry, record, field, visibility, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (registry, record, field) DO UPDATE SET visibility = excluded.visibility, value = excluded.value,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by`),
      fieldDelete: db.prepare('DELETE FROM fields WHERE registry = ? AND record = ? AND field = ?'),
      historyAdd: db.prepare('INSERT INTO history (at, "by", target, "before", "after", change, decision) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      sessionPut: db.prepare('INSERT INTO sessions (token_hash, account, created, expires) VALUES (?, ?, ?, ?)'),
      sessionDelete: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
      sessionsExpired: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
      collectionGet: db.prepare('SELECT id, visibility, definition FROM collections WHERE id = ?'),
      collectionPut: db.prepare(`INSERT INTO collections (id, visibility, definition) VALUES (?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET visibility = excluded.visibility, definition = excluded.definition`),
      stagedPut: db.prepare(`INSERT INTO staged (change, seq, actor, op) VALUES (?, ?, ?, ?)
        ON CONFLICT (change, seq) DO UPDATE SET actor = excluded.actor, op = excluded.op`),
      stagedDelete: db.prepare('DELETE FROM staged WHERE change = ?'),
      stagedDeleteOne: db.prepare('DELETE FROM staged WHERE change = ? AND seq = ?'),
      pendingPut: db.prepare('INSERT INTO pending (ref, proposal, salt, ops, digest) VALUES (?, ?, ?, ?, ?)'),
      pendingDelete: db.prepare('DELETE FROM pending WHERE proposal = ?'),
      appliedPut: db.prepare('INSERT INTO applied (proposal, "commit", at) VALUES (?, ?, ?)'),
    }
    this.r = {
      record: reader.prepare('SELECT collection, id, visibility, body, rev FROM records WHERE collection = ? AND id = ?'),
      records: reader.prepare('SELECT collection, id, visibility, body, rev FROM records WHERE collection = ? ORDER BY id'),
      fields: reader.prepare('SELECT registry, record, field, visibility, value FROM fields WHERE registry = ? AND record = ? ORDER BY field'),
      fieldsNamed: reader.prepare('SELECT registry, record, field, visibility, value FROM fields WHERE registry = ? AND field = ? ORDER BY record'),
      collections: reader.prepare('SELECT id, visibility, definition FROM collections ORDER BY id'),
      history: reader.prepare('SELECT seq, at, "by", target, "before", "after", change, decision FROM history ORDER BY seq'),
      historyOf: reader.prepare('SELECT seq, at, "by", target, "before", "after", change, decision FROM history WHERE target = ? ORDER BY seq'),
      session: reader.prepare('SELECT token_hash, account, created, expires FROM sessions WHERE token_hash = ?'),
      staged: reader.prepare('SELECT change, seq, actor, op FROM staged WHERE change = ? ORDER BY seq'),
      stagedAll: reader.prepare('SELECT change, seq, actor, op FROM staged ORDER BY change, seq'),
      pending: reader.prepare('SELECT ref, proposal, salt, ops, digest FROM pending WHERE proposal = ? ORDER BY rowid'),
      pendingAll: reader.prepare('SELECT ref, proposal, salt, ops, digest FROM pending ORDER BY rowid'),
      applied: reader.prepare('SELECT proposal, "commit", at FROM applied WHERE proposal = ?'),
    }
  }

  // ── writes ───────────────────────────────────────────────────────────────────────────────────

  /** Opens a write transaction once every earlier one has finished (`BEGIN IMMEDIATE`) and hands it over: the caller
   *  must end it with `commit()` or `rollback()`, or every later write waits until the lock's bound and is refused.
   *  Prefer `within`, which cannot be left open. Never call the store's own writes while holding one. */
  async begin(): Promise<PrivateTransaction> {
    const release = await this.lock.acquire()
    try { this.db.exec('BEGIN IMMEDIATE') } catch (err) { release(); throw err }
    let live = true
    const open = () => { if (!live) throw new Error('this private store transaction is finished: it was committed or rolled back') }
    const finish = (sql: 'COMMIT' | 'ROLLBACK') => {
      open()
      live = false
      try { this.db.exec(sql) } catch (err) {
        if (sql === 'COMMIT') { try { this.db.exec('ROLLBACK') } catch { /* nothing left open */ } }
        throw err
      } finally { release() }
    }
    return {
      putRecord: (r, by, change, decision = null) => { open(); this.atomic(() => this.putRecordIn(r, by, change, decision)) },
      deleteRecord: (collection, id, by, change, decision = null) => { open(); this.atomic(() => this.deleteRecordIn(collection, id, by, change, decision)) },
      putField: (f, by, change, decision = null) => { open(); this.atomic(() => this.putFieldIn(f, by, change, decision)) },
      deleteField: (registry, record, field, by, change, decision = null) => {
        open(); this.atomic(() => this.deleteFieldIn(registry, record, field, by, change, decision))
      },
      putCollection: (c, by) => { open(); this.atomic(() => this.putCollectionIn(c, by)) },
      putStaged: row => { open(); this.atomic(() => this.putStagedIn(row)) },
      deleteStaged: (change, seq) => {
        open()
        if (seq === undefined) this.w.stagedDelete.run(nonEmpty('a change id', change))
        else this.w.stagedDeleteOne.run(nonEmpty('a change id', change), seq)
      },
      putPending: row => { open(); this.putPendingIn(row) },
      deletePending: proposal => { open(); this.w.pendingDelete.run(nonEmpty('a proposal id', proposal)) },
      putApplied: row => { open(); this.putAppliedIn(row) },
      commit: () => finish('COMMIT'),
      rollback: () => finish('ROLLBACK'),
    }
  }

  /** One write transaction held across awaits, for §10.3's git-ordered writes: `fn` writes, makes the git commit,
   *  and resolves; the transaction is committed then, or rolled back when `fn` rejects (the rejection rethrown). The
   *  lock is released either way. */
  async within<T>(fn: (w: PrivateWriter) => Promise<T>): Promise<T> {
    const t = await this.begin()
    let out: T
    try { out = await fn(t) } catch (err) {
      try { t.rollback() } catch { /* the error to tell is fn's */ }
      throw err
    }
    t.commit()
    return out
  }

  /** Runs `fn` in one write transaction: committed when it returns, rolled back when it throws. `fn` is
   *  synchronous; for a transaction held across an await, use `within`. */
  async tx<T>(fn: (w: PrivateWriter) => T): Promise<T> {
    const t = await this.begin()
    let out: T
    try { out = fn(t) } catch (err) {
      try { t.rollback() } catch { /* the error to tell is fn's */ }
      throw err
    }
    if (out !== null && typeof out === 'object' && typeof (out as { then?: unknown }).then === 'function') {
      t.rollback()
      Promise.resolve(out).catch(() => { /* its writes are rolled back; its outcome is not awaited */ })
      throw new Error('tx takes a synchronous function; to hold a transaction across an await, use within()')
    }
    t.commit()
    return out
  }

  /** A consistent copy of the whole file at `target` (`VACUUM INTO`, which must not exist yet), taken under the write
   *  lock like any write, so it never waits inside, or slips between, another caller's transaction (§10.4, ruling
   *  R-L5-4.1). The copy is made with mode 600. */
  async copyInto(target: string): Promise<void> {
    const release = await this.lock.acquire()
    try {
      this.db.prepare('VACUUM INTO ?').run(target)
      chmodSync(target, 0o600)
    } finally { release() }
  }

  putRecord(r: PrivateRecord, by: string, change: string | null): Promise<void> { return this.tx(w => w.putRecord(r, by, change)) }
  putCollection(c: PrivateCollection, by: string): Promise<void> { return this.tx(w => w.putCollection(c, by)) }
  deleteRecord(collection: string, id: string, by: string, change: string | null): Promise<void> { return this.tx(w => w.deleteRecord(collection, id, by, change)) }
  putField(f: PrivateField, by: string, change: string | null): Promise<void> { return this.tx(w => w.putField(f, by, change)) }
  deleteField(registry: string, record: string, field: string, by: string, change: string | null): Promise<void> {
    return this.tx(w => w.deleteField(registry, record, field, by, change))
  }

  // Sessions (§4.4, Task 6): one statement each, under the write lock like any write, so none lands inside another
  // caller's open transaction. Times are ISO 8601 UTC strings (`toISOString`), which compare as they sort.

  async putSession(s: SessionRow): Promise<void> {
    for (const [name, v] of Object.entries(s)) nonEmpty(`a session's ${name}`, v)
    await this.locked(() => { this.w.sessionPut.run(s.tokenHash, s.account, s.created, s.expires) })
  }
  async deleteSession(tokenHash: string): Promise<void> {
    await this.locked(() => { this.w.sessionDelete.run(tokenHash) })
  }
  /** Removes every session that expired at or before `at`. */
  async deleteSessionsExpired(at: string): Promise<void> {
    await this.locked(() => { this.w.sessionsExpired.run(at) })
  }

  private async locked<T>(fn: () => T): Promise<T> {
    const release = await this.lock.acquire()
    try { return fn() } finally { release() }
  }

  /** One write and its history row, or neither: a savepoint inside the open transaction. */
  private atomic(fn: () => void): void {
    this.db.exec('SAVEPOINT write_and_history')
    try { fn() } catch (err) {
      try { this.db.exec('ROLLBACK TO write_and_history') } catch { /* the error to tell is fn's */ }
      this.db.exec('RELEASE write_and_history')
      throw err
    }
    this.db.exec('RELEASE write_and_history')
  }

  private remember(by: string, target: string, before: unknown, after: unknown, change: string | null, decision: string | null = null): void {
    this.w.historyAdd.run(new Date().toISOString(), by, target, json(before), json(after), change, decision)
  }

  private putRecordIn(r: PrivateRecord, by: string, change: string | null, decision: string | null): void {
    const collection = nonEmpty('a collection', r.collection), id = nonEmpty('a record id', r.id)
    const visibility = nonEmpty('a visibility', r.visibility)
    nonEmpty('who wrote', by); changeOf(change); decisionOf(decision)
    if (r.body === null || typeof r.body !== 'object' || Array.isArray(r.body)) throw new Error('the private store needs a record body as an object')
    if (typeof r.rev !== 'string') throw new Error('the private store needs a record rev as a string')
    const old = this.w.recordGet.get(collection, id) as RecordRow | undefined
    const after: PrivateRecord = { collection, id, visibility, body: r.body, rev: r.rev }
    this.w.recordPut.run(collection, id, visibility, JSON.stringify(r.body), r.rev, new Date().toISOString(), by)
    this.remember(by, `${collection}/${id}`, old ? asRecord(old) : null, after, change, decision)
  }

  private deleteRecordIn(collection: string, id: string, by: string, change: string | null, decision: string | null): void {
    nonEmpty('a collection', collection); nonEmpty('a record id', id); nonEmpty('who wrote', by); changeOf(change); decisionOf(decision)
    const old = this.w.recordGet.get(collection, id) as RecordRow | undefined
    if (!old) return
    this.w.recordDelete.run(collection, id)
    this.remember(by, `${collection}/${id}`, asRecord(old), null, change, decision)
  }

  private putFieldIn(f: PrivateField, by: string, change: string | null, decision: string | null): void {
    const registry = nonEmpty('a registry', f.registry), record = nonEmpty('a record id', f.record), field = nonEmpty('a field', f.field)
    const visibility = nonEmpty('a visibility', f.visibility)
    nonEmpty('who wrote', by); changeOf(change); decisionOf(decision)
    const value = JSON.stringify(f.value) as string | undefined
    if (value === undefined) throw new Error(`the private store needs ${registry}/${record}/${field}'s value as JSON`)
    const old = this.w.fieldGet.get(registry, record, field) as FieldRow | undefined
    const after: PrivateField = { registry, record, field, visibility, value: f.value }
    this.w.fieldPut.run(registry, record, field, visibility, value, new Date().toISOString(), by)
    this.remember(by, `${registry}/${record}/${field}`, old ? asField(old) : null, after, change, decision)
  }

  private putCollectionIn(c: PrivateCollection, by: string): void {
    const id = nonEmpty('a collection id', c.id), visibility = nonEmpty('a visibility', c.visibility)
    nonEmpty('who wrote', by)
    const definition = JSON.stringify(c.definition) as string | undefined
    if (definition === undefined) throw new Error(`the private store needs collection ${id}'s definition as JSON`)
    const old = this.w.collectionGet.get(id) as { id: string; visibility: string; definition: string } | undefined
    this.w.collectionPut.run(id, visibility, definition)
    const before = old ? { id: old.id, visibility: old.visibility, definition: JSON.parse(old.definition) as unknown } : null
    this.remember(by, id, before, { id, visibility, definition: c.definition }, null)
  }

  private putStagedIn(row: StagedRow): void {
    const change = nonEmpty('a change id', row.change), actor = nonEmpty('who staged', row.actor)
    if (!Number.isInteger(row.seq) || row.seq < 0) throw new Error('the private store needs a staged op\'s seq as a whole number')
    const op = JSON.stringify(row.op) as string | undefined
    if (op === undefined || row.op === null || typeof row.op !== 'object') throw new Error('the private store needs a staged op as an object')
    this.w.stagedPut.run(change, row.seq, actor, op)
  }

  private deleteFieldIn(registry: string, record: string, field: string, by: string, change: string | null, decision: string | null): void {
    nonEmpty('a registry', registry); nonEmpty('a record id', record); nonEmpty('a field', field); nonEmpty('who wrote', by); changeOf(change)
    decisionOf(decision)
    const old = this.w.fieldGet.get(registry, record, field) as FieldRow | undefined
    if (!old) return
    this.w.fieldDelete.run(registry, record, field)
    this.remember(by, `${registry}/${record}/${field}`, asField(old), null, change, decision)
  }

  private putPendingIn(row: PendingRow): void {
    const ref = nonEmpty('a pending ref', row.ref), proposal = nonEmpty('a proposal id', row.proposal)
    const salt = nonEmpty('a salt', row.salt), digest = nonEmpty('a digest', row.digest)
    if (!Array.isArray(row.ops) || row.ops.length === 0) throw new Error('the private store needs a pending row\'s ops as a list that is not empty')
    this.w.pendingPut.run(ref, proposal, salt, JSON.stringify(row.ops), digest)
  }

  private putAppliedIn(row: AppliedRow): void {
    this.w.appliedPut.run(nonEmpty('a proposal id', row.proposal), nonEmpty('a commit', row.commit), nonEmpty('a time', row.at))
  }

  // ── reads (the read-only connection: what was last committed) ─────────────────────────────────

  record(collection: string, id: string): PrivateRecord | null {
    const row = this.r.record.get(collection, id) as RecordRow | undefined
    return row ? asRecord(row) : null
  }

  records(collection: string): PrivateRecord[] {
    return (this.r.records.all(collection) as unknown as RecordRow[]).map(asRecord)
  }

  fields(registry: string, record: string): PrivateField[] {
    return (this.r.fields.all(registry, record) as unknown as FieldRow[]).map(asField)
  }

  /** Field `field` of every record of `registry` the store keeps it for (a narrowing re-levels them, L5 §9.7). */
  fieldsNamed(registry: string, field: string): PrivateField[] {
    return (this.r.fieldsNamed.all(registry, field) as unknown as FieldRow[]).map(asField)
  }

  collections(): { id: string; visibility: string; definition: unknown }[] {
    return (this.r.collections.all() as unknown as { id: string; visibility: string; definition: string }[])
      .map(c => ({ id: c.id, visibility: c.visibility, definition: JSON.parse(c.definition) as unknown }))
  }

  /** The ops staged for `change`, in their order; with no change, every staged op of every change. */
  staged(change?: string): StagedRow[] {
    const rows = change === undefined ? this.r.stagedAll.all() : this.r.staged.all(change)
    return (rows as unknown as { change: string; seq: number; actor: string; op: string }[])
      .map(s => ({ change: s.change, seq: s.seq, actor: s.actor, op: JSON.parse(s.op) as unknown }))
  }

  /** The private part of proposal `proposal` (§10.2 `pending`), in the order it was written; with no proposal, every
   *  row the store holds. */
  pending(proposal?: string): PendingRow[] {
    const rows = (proposal === undefined ? this.r.pendingAll.all() : this.r.pending.all(proposal)) as unknown as
      { ref: string; proposal: string; salt: string; ops: string; digest: string }[]
    return rows.map(p => ({ ref: p.ref, proposal: p.proposal, salt: p.salt, ops: JSON.parse(p.ops) as unknown[], digest: p.digest }))
  }

  /** Whether proposal `proposal`'s private part is applied, and with which commit; null when it is not. */
  applied(proposal: string): AppliedRow | null {
    const row = this.r.applied.get(proposal) as { proposal: string; commit: string; at: string } | undefined
    return row ? { proposal: row.proposal, commit: row.commit, at: row.at } : null
  }

  /** Every write, oldest first; with `target`, that target's only. */
  history(target?: string): HistoryRow[] {
    const rows = (target === undefined ? this.r.history.all() : this.r.historyOf.all(target)) as unknown as HistoryRaw[]
    return rows.map(h => ({
      seq: h.seq, at: h.at, by: h.by, target: h.target,
      before: h.before === null ? null : JSON.parse(h.before) as unknown,
      after: h.after === null ? null : JSON.parse(h.after) as unknown,
      change: h.change, decision: h.decision,
    }))
  }

  /** The session whose token hashes to `tokenHash`, expired or not; null when there is none. */
  session(tokenHash: string): SessionRow | null {
    const row = this.r.session.get(tokenHash) as { token_hash: string; account: string; created: string; expires: string } | undefined
    return row ? { tokenHash: row.token_hash, account: row.account, created: row.created, expires: row.expires } : null
  }

  /** Closes both connections, each whether or not the other closed; the first failure is rethrown after. */
  close(): void {
    let failed: unknown = null
    for (const c of [this.reader, this.db]) {
      try { c.close() } catch (err) { failed ??= err }
    }
    if (failed !== null) throw failed
  }
}
