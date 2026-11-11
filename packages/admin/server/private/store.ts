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

/** 1: L5 §10.2's tables. 2 was written by two lines, each with tables of its own: 0.6.1's the Roles from the records
 *  dump, the email keys and the sign-in links (Lane 3 Task 2); the workspace's comments, mentions, notifications, reads,
 *  view state and drafts (DAO-OS L6 §8.1). 3: both. A store at 1, or at either line's 2, is brought up when it opens:
 *  the tables it lacks are added, every row kept. */
export const SCHEMA_VERSION = 3

/** The store cannot be used: its place is not ignored by git, its file cannot be opened, or a newer org-os wrote
 *  it. The git side keeps serving; private reads and writes refuse with this message as attention (§10.1). */
export class StoreUnavailable extends Error {
  /** Set where the store refused to open (§7.4): what `classifyOpenError` reads. Unset: a failure of another kind. */
  constructor(message: string, readonly kind?: StoreOpenFailure) { super(message); this.name = 'StoreUnavailable' }
}

/** Why the store could not be opened (L9 spec §7.4, carry 8). */
export type StoreOpenFailure = 'not-ignored' | 'cannot-open' | 'newer'

/** §7.4's fixed sentences. An answer or Home's attention says one of them; the store's own words (SQLite's, the OS's,
 *  the file's path) go to the server's log only. The not-ignored sentence is §10.1's own, which names only the
 *  repository-relative place and no text of SQLite's or the OS's. */
export const STORE_CANNOT_OPEN = 'The private store could not be opened. A maintainer can read why in the server\'s log.'
export const STORE_NEWER = 'The private store was written by a newer org-os. Update this Hub first.'

/** The class of an error `openPrivateStore` threw, and the sentence to show for it. Anything it does not know is
 *  cannot-open: the sentence then points to the log, and nothing of the error reaches an answer. */
export function classifyOpenError(err: unknown): { kind: StoreOpenFailure; sentence: string } {
  if (err instanceof StoreUnavailable && err.kind === 'not-ignored') return { kind: 'not-ignored', sentence: err.message }
  if (err instanceof StoreUnavailable && err.kind === 'newer') return { kind: 'newer', sentence: STORE_NEWER }
  return { kind: 'cannot-open', sentence: STORE_CANNOT_OPEN }
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

/** The Role names (I2): what a person holds, compiled from the records dump (I4), never read live. */
export const ROLES = ['steward', 'node-lead', 'network-member'] as const
export type Role = typeof ROLES[number]

/** A person as the Roles table holds them (I4, without the email keys): an id (I1, `<org>:person:<slug>`), the name to
 *  show, their Roles and the nodes they are a Node Lead or member of. A person with no Role is a person still: they
 *  sign in to their Profile. */
export interface RolesPerson { id: string; name: string; roles: Role[]; nodes: string[] }
/** The I4 Roles document: what `house:roles load` replaces the table with, whole. Never a file in a repository. */
export interface RolesDoc { roles_version: string; people: (RolesPerson & { email_keys: string[] })[] }

/** A single-use sign-in link (Lane 3): the SHA-256 of its token, never the token; whose it is; where to go after
 *  (already judged by the I6 return rule); and when it was used, or null. Times are ISO 8601 UTC. */
export interface RolesLink { tokenHash: string; personId: string; returnTo: string; created: string; expires: string; usedAt: string | null }

/** A private page's draft (L6 §6, §8.1 `drafts`): one row per editing session, its body the page's Markdown as the session
 *  last saved it; `base` the page's text the session opened on (null for a page the session creates). Not private data's
 *  history: a draft is written into the page (and its history) when the session ends. */
export interface DraftRow { session: string; target: string; actor: string; base: string | null; body: string; opened: string; updated: string }

/** A W3C TextQuoteSelector (L6 §8.1): the quoted text, and the text just before and after it; each at most 500 characters. */
export interface Anchor { exact: string; prefix: string; suffix: string }
/** A comment (L6 §8.1, §8.2, `comments` table). `target` is `page:<id>` or `record:<registry>:<id>`; `parent` the comment it
 *  replies to; `deleted`, `edited`, `resolvedAt` times (ISO 8601) or null. A deleted comment's body is ''. */
export interface CommentRow {
  id: string; target: string; parent: string | null; anchor: Anchor | null; by: string; body: string
  created: string; edited: string | null; resolvedBy: string | null; resolvedAt: string | null; deleted: string | null
  /** DAO-OS L6 Task 18 fix round 1: the task the comment was turned into (its id), so it is turned into one only once. */
  task?: string | null
  /** PR7-R45: the level its target had when it was written (a level token). Read only by a viewer admitted to it and to the
   *  target's level now. Set once: a later put of the row keeps the first. */
  writtenLevel: string
}
/** One mention (L6 §8.1, `mentions`): `source` is `comment:<id>` or `page:<id>`; `told` whether anyone was told by it;
 *  `writtenLevel` its target's level when it was made (PR7-R45). */
export interface MentionRow { source: string; kind: 'member' | 'role' | 'page' | 'record'; ref: string; told: boolean; writtenLevel: string }
/** One member told (L6 §8.1, `notifications`): a row of their Needs you. `readAt` null until read; `writtenLevel` its target's
 *  level when it was told (PR7-R45). */
export interface StoredNotification {
  id: string; member: string; kind: 'mention'; target: string; source: string; by: string; created: string; readAt: string | null; writtenLevel: string
}
/** What one conversation write holds, written in one transaction: comments put whole, mentions put (one per source, kind
 *  and ref), notifications added, and the notifications of `dropSources` (a deleted comment's) removed. */
export interface ConversationWrite {
  comments?: CommentRow[]
  mentions?: MentionRow[]
  notifications?: StoredNotification[]
  dropSources?: string[]
}

/** The writes a transaction may make. `decision`, on a write a ratify makes, is the decision row's id (history's
 *  `decision`); null otherwise. */
export interface PrivateWriter {
  putRecord(r: PrivateRecord, by: string, change: string | null, decision?: string | null): void
  /** `purge` false (DAO-OS L6 §12, a record moved into the repository): its conversation stays with it. */
  deleteRecord(collection: string, id: string, by: string, change: string | null, decision?: string | null, purge?: boolean): void
  putField(f: PrivateField, by: string, change: string | null, decision?: string | null): void
  deleteField(registry: string, record: string, field: string, by: string, change: string | null, decision?: string | null): void
  /** A private collection's definition, written whole; its history target is the collection's id alone. */
  putCollection(c: PrivateCollection, by: string): void
  /** A private collection's definition removed (L6 §7.4: the caller has refused one that holds records). */
  deleteCollection(id: string, by: string): void
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
// The Roles' four tables (Lane 3 Task 2) close it, and SCHEMA_2 below adds the workspace's; every statement is IF NOT
// EXISTS, so the one script makes a fresh store and brings an older one (1, or either line's 2) up to 3 in one transaction,
// keeping its rows. `roles` and `nodes` are JSON lists.
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
CREATE TABLE IF NOT EXISTS roles (person_id TEXT PRIMARY KEY, name TEXT NOT NULL, roles TEXT NOT NULL, nodes TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS email_keys (email_key TEXT PRIMARY KEY, person_id TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS roles_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS sign_in_links (token_hash TEXT PRIMARY KEY, person_id TEXT NOT NULL, return_to TEXT NOT NULL,
  created TEXT NOT NULL, expires TEXT NOT NULL, used_at TEXT) STRICT;
`

// Schema 2 (DAO-OS L6 §8.1), table for table and column for column; times ISO 8601. `target` is `page:<id>` or
// `record:<registry>:<id>`; a comment's `anchor` a W3C TextQuoteSelector as JSON, or null; `deleted` and the other times
// null until they happen; a mention's `told` 0 or 1. Schema 3 (unreleased when PR7-R45 was ruled) adds `written_level` to
// comments, mentions and notifications: the level their target had when they were written. A store made before it gains
// the column with every row `unfilled` (WRITTEN_UNFILLED), which admits nobody until the server's start fills it.
const SCHEMA_2 = `
CREATE TABLE IF NOT EXISTS comments (id TEXT NOT NULL PRIMARY KEY, target TEXT NOT NULL, parent TEXT, anchor TEXT, "by" TEXT NOT NULL,
  body TEXT NOT NULL, created TEXT NOT NULL, edited TEXT, resolved_by TEXT, resolved_at TEXT, deleted TEXT, task TEXT,
  written_level TEXT NOT NULL DEFAULT 'unfilled') STRICT;
CREATE INDEX IF NOT EXISTS comments_target ON comments (target);
CREATE TABLE IF NOT EXISTS mentions (source TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, told INTEGER NOT NULL DEFAULT 0,
  written_level TEXT NOT NULL DEFAULT 'unfilled', PRIMARY KEY (source, kind, ref)) STRICT;
CREATE TABLE IF NOT EXISTS notifications (id TEXT NOT NULL PRIMARY KEY, member TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
  source TEXT NOT NULL, "by" TEXT NOT NULL, created TEXT NOT NULL, read_at TEXT, written_level TEXT NOT NULL DEFAULT 'unfilled') STRICT;
CREATE INDEX IF NOT EXISTS notifications_member ON notifications (member);
CREATE TABLE IF NOT EXISTS reads (member TEXT NOT NULL, target TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (member, target)) STRICT;
CREATE TABLE IF NOT EXISTS view_state (member TEXT NOT NULL, collection TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY (member, collection)) STRICT;
CREATE TABLE IF NOT EXISTS drafts (session TEXT NOT NULL PRIMARY KEY, target TEXT NOT NULL, actor TEXT NOT NULL, base TEXT, body TEXT NOT NULL,
  opened TEXT NOT NULL, updated TEXT NOT NULL) STRICT;
`

/** What a conversation row written before `written_level` existed holds until the server's start fills it (PR7-R45). */
export const WRITTEN_UNFILLED = 'unfilled'

/** §10.1's sentence for a place inside the repository that git does not ignore. */
function notIgnored(place: string): string {
  if (place === '') return `The private store would be at ${STORE_FILE}, at the root of the repository, which git does not ignore. Set ORG_OS_PRIVATE_DIR to a folder outside it, or to a folder .gitignore names.`
  return `The private store would be at ${place}/${STORE_FILE}, which git does not ignore. Add \`${place}/\` to .gitignore first.`
}
/** Later than any ISO time: a purge with no time bound (a private record's own delete). */
const UNBOUNDED = '\uffff'
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** §10.1's location rule, alone: resolves when the folder `dir` is outside `repo`, or inside it and ignored by git
 *  whole (`<folder>/`, so the WAL files and backups beside the file are ignored too) with the file itself; otherwise
 *  rejects with `StoreUnavailable` and the sentence. Creates nothing. A restore asks it before it writes a file. */
export async function checkStorePlace(repo: string, dir: string, git: Git = { isIgnored }): Promise<void> {
  const place = placeInRepo(repo, dir)
  if (place === '') throw new StoreUnavailable(notIgnored(place), 'not-ignored')
  if (place === null) return
  let ignored: boolean
  try {
    ignored = (await git.isIgnored(repo, `${place}/`)) && (await git.isIgnored(repo, `${place}/${STORE_FILE}`))
  } catch (err) {
    throw new StoreUnavailable(`The private store would be at ${place}/${STORE_FILE}, and git could not say whether it ignores that folder: ${reason(err)}`)
  }
  if (!ignored) throw new StoreUnavailable(notIgnored(place), 'not-ignored')
}

/** Opens (creating when absent) the private store of `repo`: in `opts.dir`, else `privateDir(repo)`. A folder inside
 *  the repository must be one git ignores, whole (`<folder>/`, so the WAL files and backups beside the file are
 *  ignored too) and the file itself (a tracked file is not ignored): otherwise `StoreUnavailable` with §10.1's
 *  sentence, and nothing is created. A file that cannot be opened, or that a newer schema wrote, is
 *  `StoreUnavailable` too, naming the file and never what it holds. */
export async function openPrivateStore(repo: string, opts: { dir?: string; git?: Git; lockWaitMs?: number } = {}): Promise<PrivateStore> {
  const lockWaitMs = opts.lockWaitMs ?? LOCK_WAIT_MS
  if (!Number.isInteger(lockWaitMs) || lockWaitMs < LOCK_WAIT_MIN_MS || lockWaitMs > LOCK_WAIT_MAX_MS) {
    throw new StoreUnavailable(lockWaitRefusal(lockWaitMs), 'cannot-open')
  }
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
    if (version > SCHEMA_VERSION) throw new StoreUnavailable(`This private store was written by a newer org-os (schema ${version}); update first.`, 'newer')
    const mode = (db.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode: string }).journal_mode
    if (mode !== 'wal') throw new Error(`it could not be put in WAL mode (it is in ${mode} mode)`)
    db.exec('PRAGMA busy_timeout = 5000')
    if (version < SCHEMA_VERSION) {
      db.exec('BEGIN IMMEDIATE')
      try { db.exec(`${SCHEMA}\n${SCHEMA_2}\nPRAGMA user_version = ${SCHEMA_VERSION};`); db.exec('COMMIT') } catch (err) { db.exec('ROLLBACK'); throw err }
    }
    // DAO-OS L6 Task 18 fix round 1: a schema-2 store made before a comment kept the task it became gains the column.
    const columnsOf = (t: string) => (db!.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(c => c.name)
    if (!columnsOf('comments').includes('task')) db.exec('ALTER TABLE comments ADD COLUMN task TEXT')
    // PR7-R45, in schema 3's migration: the conversation's rows gain the level they were written at, every row kept as
    // `unfilled` (admitting nobody) until the start fills it with its target's level then (`fillWrittenLevels`).
    const lacking = ['comments', 'mentions', 'notifications'].filter(t => !columnsOf(t).includes('written_level'))
    if (lacking.length > 0) {
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const t of lacking) db.exec(`ALTER TABLE ${t} ADD COLUMN written_level TEXT NOT NULL DEFAULT '${WRITTEN_UNFILLED}'`)
        db.exec('COMMIT')
      } catch (err) { db.exec('ROLLBACK'); throw err }
    }
    reader = new DatabaseSync(file, { readOnly: true })
    reader.exec('PRAGMA busy_timeout = 5000')
    return new PrivateStore(file, db, reader, lockWaitMs)
  } catch (err) {
    for (const c of [reader, db]) { try { c?.close() } catch { /* closing what failed to open */ } }
    if (err instanceof StoreUnavailable) throw err
    throw new StoreUnavailable(`The private store at ${file} could not be opened: ${reason(err)}`)
  }
}

/** How long a write waits for the one before it before saying so, and how long a holder may hold the lock before it is
 *  said to be stuck (§7.5). */
export const LOCK_WAIT_MS = 30_000
/** The bounds `lockWaitMs` must keep (§7.5): a whole number of milliseconds from 1 s to 300 s. */
export const LOCK_WAIT_MIN_MS = 1_000
export const LOCK_WAIT_MAX_MS = 300_000

/** The store refuses to open with a wait outside the bounds. */
export const lockWaitRefusal = (v: number): string =>
  `The private store's write wait (lockWaitMs) is ${String(v)}, not a whole number of milliseconds from ${LOCK_WAIT_MIN_MS} to ${LOCK_WAIT_MAX_MS}, so the store was not opened.`
/** A write that waited its bound (§7.5): it does not guess why the one before has not finished. */
export const lockWaited = (ms: number): string =>
  `A write to the private store waited ${ms} ms for the one before it, which has not finished (it is slow, or was left open). Nothing was written.`
/** The attention while a holder is stuck (§7.5). */
export const STORE_STUCK = (heldMs: number): string =>
  `A write to the private store has been open for ${Math.round(heldMs / 1000)} s; writes after it wait.`

/** Serialises the write transactions: each `acquire` resolves, in order, once every earlier holder has released.
 *  A wait longer than `waitMs` rejects with `StoreUnavailable` (`lockWaited`); the waiter that gave up passes its turn on
 *  at once when it comes, so the writes queued after it still run. A holder that keeps the lock longer than `waitMs` is
 *  told to `stuck` once, and `unstuck` when it releases (§7.5); one that releases in time tells neither. */
class WriteLock {
  private tail: Promise<void> = Promise.resolve()
  constructor(private readonly waitMs: number, private readonly hooks: { stuck: (heldMs: number) => void; unstuck: () => void }) {}
  acquire(): Promise<() => void> {
    let free!: () => void
    const done = new Promise<void>(r => { free = r })
    const turn = this.tail
    this.tail = turn.then(() => done)
    let released = false
    let watch: ReturnType<typeof setTimeout> | null = null
    let stuck = false
    const release = () => {
      if (released) return
      released = true
      if (watch) clearTimeout(watch)
      free()
      if (stuck) this.tell(() => this.hooks.unstuck())
    }
    return new Promise((resolve, reject) => {
      let gaveUp = false
      const timer = setTimeout(() => {
        gaveUp = true
        reject(new StoreUnavailable(lockWaited(this.waitMs)))
      }, this.waitMs)
      timer.unref() // a wait never keeps the process alive by itself
      void turn.then(() => {
        clearTimeout(timer)
        if (gaveUp) { release(); return }
        const since = Date.now()
        watch = setTimeout(() => { stuck = true; this.tell(() => this.hooks.stuck(Date.now() - since)) }, this.waitMs)
        watch.unref()
        resolve(release)
      })
    })
  }
  /** A hook's failure is not the write's: it is logged. */
  private tell(fn: () => void): void {
    try { fn() } catch (err) { console.error(`org-os admin: the private store's lock could not say so: ${err instanceof Error ? err.message : String(err)}`) }
  }
}

interface RecordRow { collection: string; id: string; visibility: string; body: string; rev: string }
interface FieldRow { registry: string; record: string; field: string; visibility: string; value: string }
interface HistoryRaw { seq: number; at: string; by: string; target: string; before: string | null; after: string | null; change: string | null; decision: string | null }

interface PersonRow { person_id: string; name: string; roles: string; nodes: string }
interface LinkRow { token_hash: string; person_id: string; return_to: string; created: string; expires: string; used_at: string | null }
const asPerson = (p: PersonRow | undefined): RolesPerson | null =>
  p ? { id: p.person_id, name: p.name, roles: JSON.parse(p.roles) as Role[], nodes: JSON.parse(p.nodes) as string[] } : null

const EMAIL_KEY = /^[0-9a-f]{64}$/
/** A person's id (I1, `<org>:person:<slug>`), as the Roles document's schema writes it. */
export const PERSON_ID = /^[a-z0-9][a-z0-9-]*:person:[a-z0-9][a-z0-9-]*$/

/** Why the store will not hold `doc`, as a sentence that names no value, or null. Every string must be free of `@` (the
 *  house holds no address); ids non-empty and unique; Roles only I2's; nodes strings; email keys 64 lowercase hex. A key
 *  held twice is the load's own refusal (one email key, one person). */
export function rolesDocRefusal(doc: unknown): string | null {
  const d = doc as RolesDoc
  if (d === null || typeof d !== 'object' || Array.isArray(d)) return 'A Roles document is an object with roles_version and people; nothing was loaded.'
  if (typeof d.roles_version !== 'string' || d.roles_version.trim() === '') return 'A Roles document needs a roles_version (the dump\'s date); nothing was loaded.'
  if (!Array.isArray(d.people)) return 'A Roles document needs a list of people; nothing was loaded.'
  let address = false
  const scan = (v: unknown): void => {
    if (typeof v === 'string') { if (v.includes('@')) address = true }
    else if (Array.isArray(v)) v.forEach(scan)
    else if (v !== null && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { scan(k); scan(x) })
  }
  scan(d)
  if (address) return 'A Roles document must hold no address (a string with @); nothing was loaded.'
  const seen = new Set<string>()
  for (const [i, p] of d.people.entries()) {
    const at = `person ${i + 1}`
    if (p === null || typeof p !== 'object') return `In the Roles document, ${at} is not an object; nothing was loaded.`
    if (typeof p.id !== 'string' || p.id === '') return `In the Roles document, ${at} has no id; nothing was loaded.`
    if (seen.has(p.id)) return `In the Roles document, ${at} is listed twice; nothing was loaded.`
    seen.add(p.id)
    if (typeof p.name !== 'string') return `In the Roles document, ${at} has no name; nothing was loaded.`
    if (!Array.isArray(p.roles) || !p.roles.every(r => (ROLES as readonly string[]).includes(r))) return `In the Roles document, ${at} holds an unknown Role (only ${ROLES.join(', ')}); nothing was loaded.`
    if (!Array.isArray(p.nodes) || !p.nodes.every(n => typeof n === 'string' && n !== '')) return `In the Roles document, ${at} has nodes that are not names; nothing was loaded.`
    if (!Array.isArray(p.email_keys) || !p.email_keys.every(k => typeof k === 'string' && EMAIL_KEY.test(k))) return `In the Roles document, ${at} has an email key that is not 64 lowercase hex; nothing was loaded.`
  }
  return null
}

const COMMENT_COLUMNS = 'id, target, parent, anchor, "by", body, created, edited, resolved_by, resolved_at, deleted, task, written_level'
interface CommentRaw {
  id: string; target: string; parent: string | null; anchor: string | null; by: string; body: string
  created: string; edited: string | null; resolved_by: string | null; resolved_at: string | null; deleted: string | null; task: string | null
  written_level: string
}
const asComment = (c: CommentRaw): CommentRow => ({
  id: c.id, target: c.target, parent: c.parent, anchor: c.anchor === null ? null : JSON.parse(c.anchor) as Anchor, by: c.by, body: c.body,
  created: c.created, edited: c.edited, resolvedBy: c.resolved_by, resolvedAt: c.resolved_at, deleted: c.deleted, task: c.task,
  writtenLevel: c.written_level,
})
interface NotificationRaw { id: string; member: string; kind: 'mention'; target: string; source: string; by: string; created: string; read_at: string | null; written_level: string }
const asNotification = (n: NotificationRaw): StoredNotification =>
  ({ id: n.id, member: n.member, kind: n.kind, target: n.target, source: n.source, by: n.by, created: n.created, readAt: n.read_at, writtenLevel: n.written_level })
/** A written level as a write must name it (PR7-R45): a non-empty token. */
const writtenOf = (what: string, v: unknown): string => nonEmpty(`${what}'s written level`, v)
const MENTION_KINDS = new Set(['member', 'role', 'page', 'record'])
const orNull = (name: string, v: unknown): string | null => (v === null ? null : nonEmpty(name, v))
function checkComment(r: CommentRow): CommentRow {
  for (const name of ['id', 'target', 'by', 'created'] as const) nonEmpty(`a comment's ${name}`, r[name])
  if (typeof r.body !== 'string') throw new Error('the private store needs a comment\'s body as a string')
  orNull('a comment\'s parent, or null,', r.parent); orNull('an edit time, or null,', r.edited)
  orNull('who resolved it, or null,', r.resolvedBy); orNull('a resolve time, or null,', r.resolvedAt); orNull('a delete time, or null,', r.deleted)
  if (r.task !== undefined) orNull('the task it became, or null,', r.task)
  writtenOf('a comment', r.writtenLevel)
  if (r.anchor !== null && (typeof r.anchor !== 'object' || typeof r.anchor.exact !== 'string' || typeof r.anchor.prefix !== 'string' || typeof r.anchor.suffix !== 'string')) {
    throw new Error('the private store needs a comment\'s anchor as { exact, prefix, suffix }, or null')
  }
  return r
}

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
  /** Told once when a write has held the lock longer than the wait (§7.5, `STORE_STUCK`), and `onUnstuck` when it lets go:
   *  the server raises and clears attention with them. */
  onStuck: ((heldMs: number) => void) | null = null
  onUnstuck: (() => void) | null = null
  /** Told, after a transaction that wrote or deleted records is committed, which collections it touched (DAO-OS L6 §8.5: a
   *  private page's write is a `pages-changed` event). Null: nobody. */
  onRecordsWritten: ((collections: string[]) => void) | null = null
  private readonly lock: WriteLock
  private readonly w: Record<'recordGet' | 'recordPut' | 'recordDelete' | 'fieldGet' | 'fieldPut' | 'fieldDelete' | 'historyAdd' | 'sessionPut' | 'sessionDelete' | 'sessionRenew' | 'sessionsExpired'
    | 'collectionGet' | 'collectionPut' | 'collectionDelete' | 'stagedPut' | 'stagedDelete' | 'stagedDeleteOne' | 'pendingPut' | 'pendingDelete' | 'appliedPut'
    | 'rolesClear' | 'rolePut' | 'keysClear' | 'keyPut' | 'metaPut' | 'linkPut' | 'linkGet' | 'linkUse' | 'linksExpired'
    | 'viewStatePut' | 'viewStateDelete' | 'draftPut' | 'draftDelete'
    | 'commentPut' | 'mentionPut' | 'notificationPut' | 'notificationsDrop' | 'notificationRead' | 'notificationsReadOf' | 'readPut'
    | 'goneComments' | 'goneComment' | 'goneMentions' | 'goneNotifications' | 'goneReads', StatementSync>
  private readonly r: Record<'record' | 'recordUpdated' | 'records' | 'fields' | 'fieldsNamed' | 'collections' | 'history' | 'historyOf' | 'session' | 'staged'
    | 'stagedAll' | 'pending' | 'pendingAll' | 'applied' | 'person' | 'personByKey' | 'meta' | 'viewState' | 'draft' | 'drafts'
    | 'comment' | 'comments' | 'mentions' | 'notifications' | 'read', StatementSync>

  /** Use `openPrivateStore`. */
  constructor(file: string, private readonly db: DatabaseSync, private readonly reader: DatabaseSync, lockWaitMs: number = LOCK_WAIT_MS) {
    this.file = file
    this.lock = new WriteLock(lockWaitMs, { stuck: ms => this.onStuck?.(ms), unstuck: () => this.onUnstuck?.() })
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
      sessionRenew: db.prepare('UPDATE sessions SET expires = ? WHERE token_hash = ?'),
      sessionsExpired: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
      collectionGet: db.prepare('SELECT id, visibility, definition FROM collections WHERE id = ?'),
      collectionPut: db.prepare(`INSERT INTO collections (id, visibility, definition) VALUES (?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET visibility = excluded.visibility, definition = excluded.definition`),
      collectionDelete: db.prepare('DELETE FROM collections WHERE id = ?'),
      stagedPut: db.prepare(`INSERT INTO staged (change, seq, actor, op) VALUES (?, ?, ?, ?)
        ON CONFLICT (change, seq) DO UPDATE SET actor = excluded.actor, op = excluded.op`),
      stagedDelete: db.prepare('DELETE FROM staged WHERE change = ?'),
      stagedDeleteOne: db.prepare('DELETE FROM staged WHERE change = ? AND seq = ?'),
      pendingPut: db.prepare('INSERT INTO pending (ref, proposal, salt, ops, digest) VALUES (?, ?, ?, ?, ?)'),
      pendingDelete: db.prepare('DELETE FROM pending WHERE proposal = ?'),
      appliedPut: db.prepare('INSERT INTO applied (proposal, "commit", at) VALUES (?, ?, ?)'),
      rolesClear: db.prepare('DELETE FROM roles'),
      rolePut: db.prepare('INSERT INTO roles (person_id, name, roles, nodes) VALUES (?, ?, ?, ?)'),
      keysClear: db.prepare('DELETE FROM email_keys'),
      keyPut: db.prepare('INSERT INTO email_keys (email_key, person_id) VALUES (?, ?)'),
      metaPut: db.prepare('INSERT INTO roles_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v'),
      linkPut: db.prepare('INSERT INTO sign_in_links (token_hash, person_id, return_to, created, expires, used_at) VALUES (?, ?, ?, ?, ?, NULL)'),
      linkGet: db.prepare('SELECT token_hash, person_id, return_to, created, expires, used_at FROM sign_in_links WHERE token_hash = ?'),
      linkUse: db.prepare('UPDATE sign_in_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL'),
      linksExpired: db.prepare('DELETE FROM sign_in_links WHERE expires <= ?'),
      viewStatePut: db.prepare(`INSERT INTO view_state (member, collection, state) VALUES (?, ?, ?)
        ON CONFLICT (member, collection) DO UPDATE SET state = excluded.state`),
      viewStateDelete: db.prepare('DELETE FROM view_state WHERE member = ? AND collection = ?'),
      draftPut: db.prepare(`INSERT INTO drafts (session, target, actor, base, body, opened, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (session) DO UPDATE SET target = excluded.target, actor = excluded.actor, base = excluded.base, body = excluded.body,
        opened = excluded.opened, updated = excluded.updated`),
      draftDelete: db.prepare('DELETE FROM drafts WHERE session = ?'),
      // PR7-R45: a row's written level is set once; a later put of it (a resolve, a delete, the task it became) keeps the first.
      commentPut: db.prepare(`INSERT INTO comments (id, target, parent, anchor, "by", body, created, edited, resolved_by, resolved_at, deleted, task, written_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET target = excluded.target, parent = excluded.parent,
        anchor = excluded.anchor, "by" = excluded."by", body = excluded.body, created = excluded.created, edited = excluded.edited,
        resolved_by = excluded.resolved_by, resolved_at = excluded.resolved_at, deleted = excluded.deleted, task = excluded.task`),
      mentionPut: db.prepare(`INSERT INTO mentions (source, kind, ref, told, written_level) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (source, kind, ref) DO UPDATE SET told = excluded.told`),
      notificationPut: db.prepare('INSERT INTO notifications (id, member, kind, target, source, "by", created, read_at, written_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      notificationsDrop: db.prepare('DELETE FROM notifications WHERE source = ?'),
      notificationRead: db.prepare('UPDATE notifications SET read_at = ? WHERE member = ? AND id = ? AND read_at IS NULL'),
      notificationsReadOf: db.prepare('UPDATE notifications SET read_at = ? WHERE member = ? AND target = ? AND read_at IS NULL'),
      readPut: db.prepare('INSERT INTO reads (member, target, at) VALUES (?, ?, ?) ON CONFLICT (member, target) DO UPDATE SET at = excluded.at'),
      // R-9a: a target's conversation, gone with it.
      goneComments: db.prepare('SELECT id, parent, created FROM comments WHERE target = ?'),
      goneComment: db.prepare('DELETE FROM comments WHERE id = ?'),
      goneMentions: db.prepare('DELETE FROM mentions WHERE source = ?'),
      goneNotifications: db.prepare('DELETE FROM notifications WHERE target = ? AND created <= ?'),
      goneReads: db.prepare('DELETE FROM reads WHERE target = ? AND at <= ?'),
    }
    this.r = {
      record: reader.prepare('SELECT collection, id, visibility, body, rev FROM records WHERE collection = ? AND id = ?'),
      recordUpdated: reader.prepare('SELECT updated_at FROM records WHERE collection = ? AND id = ?'),
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
      person: reader.prepare('SELECT person_id, name, roles, nodes FROM roles WHERE person_id = ?'),
      personByKey: reader.prepare('SELECT r.person_id, r.name, r.roles, r.nodes FROM email_keys k JOIN roles r ON r.person_id = k.person_id WHERE k.email_key = ?'),
      meta: reader.prepare('SELECT v FROM roles_meta WHERE k = ?'),
      viewState: reader.prepare('SELECT state FROM view_state WHERE member = ? AND collection = ?'),
      draft: reader.prepare('SELECT session, target, actor, base, body, opened, updated FROM drafts WHERE session = ?'),
      drafts: reader.prepare('SELECT session, target, actor, base, body, opened, updated FROM drafts ORDER BY opened, session'),
      comment: reader.prepare(`SELECT ${COMMENT_COLUMNS} FROM comments WHERE id = ?`),
      comments: reader.prepare(`SELECT ${COMMENT_COLUMNS} FROM comments WHERE target = ? ORDER BY created, id`),
      mentions: reader.prepare('SELECT source, kind, ref, told, written_level FROM mentions WHERE source = ? ORDER BY kind, ref'),
      notifications: reader.prepare('SELECT id, member, kind, target, source, "by", created, read_at, written_level FROM notifications WHERE member = ? ORDER BY created DESC, id DESC'),
      read: reader.prepare('SELECT at FROM reads WHERE member = ? AND target = ?'),
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
    const touched = new Set<string>()
    const open = () => { if (!live) throw new Error('this private store transaction is finished: it was committed or rolled back') }
    const finish = (sql: 'COMMIT' | 'ROLLBACK') => {
      open()
      live = false
      try { this.db.exec(sql) } catch (err) {
        if (sql === 'COMMIT') { try { this.db.exec('ROLLBACK') } catch { /* nothing left open */ } }
        throw err
      } finally { release() }
      if (sql === 'COMMIT' && touched.size > 0) { try { this.onRecordsWritten?.([...touched]) } catch { /* a listener never undoes a write */ } }
    }
    return {
      putRecord: (r, by, change, decision = null) => { open(); this.atomic(() => this.putRecordIn(r, by, change, decision)); touched.add(r.collection) },
      deleteRecord: (collection, id, by, change, decision = null, purge = true) => {
        open(); this.atomic(() => this.deleteRecordIn(collection, id, by, change, decision, purge)); touched.add(collection)
      },
      putField: (f, by, change, decision = null) => { open(); this.atomic(() => this.putFieldIn(f, by, change, decision)) },
      deleteField: (registry, record, field, by, change, decision = null) => {
        open(); this.atomic(() => this.deleteFieldIn(registry, record, field, by, change, decision))
      },
      putCollection: (c, by) => { open(); this.atomic(() => this.putCollectionIn(c, by)) },
      deleteCollection: (id, by) => { open(); this.atomic(() => this.deleteCollectionIn(id, by)) },
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

  /** A consistent copy of the whole file at `target` (`VACUUM INTO`, which must not exist yet), taken on the read
   *  connection (L9 §7.1, carry 5): a WAL snapshot of what was last committed, so it takes no write lock, never waits for
   *  a transaction held open, and never makes a queued write wait (it replaces ruling R-L5-4.1's copy under the lock). A
   *  transaction open on the write connection is not in it. The copy is made with mode 600. */
  async copyInto(target: string): Promise<void> {
    this.reader.prepare('VACUUM INTO ?').run(target)
    chmodSync(target, 0o600)
  }

  putRecord(r: PrivateRecord, by: string, change: string | null): Promise<void> { return this.tx(w => w.putRecord(r, by, change)) }
  putCollection(c: PrivateCollection, by: string): Promise<void> { return this.tx(w => w.putCollection(c, by)) }
  deleteCollection(id: string, by: string): Promise<void> { return this.tx(w => w.deleteCollection(id, by)) }
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
  /** Moves the end of the session `tokenHash` names to `expires` (an emailed-link session re-issued, Lane 3 Task 9).
   *  False when there is no such session, which is then not made. */
  async renewSession(tokenHash: string, expires: string): Promise<boolean> {
    nonEmpty('a session\'s expires', expires)
    return this.locked(() => Number(this.w.sessionRenew.run(expires, tokenHash).changes) === 1)
  }
  /** Removes every session that expired at or before `at`. */
  async deleteSessionsExpired(at: string): Promise<void> {
    await this.locked(() => { this.w.sessionsExpired.run(at) })
  }

  // The Roles (I4) and the sign-in links (Lane 3 Task 2). Not private data's history: the Roles' source is the dump, and a
  // link is a moment of a sign-in, like a session.

  /** Replaces the Roles, the email keys and `roles_version` with `doc`'s, whole, in one transaction: every row goes,
   *  then the doc's rows go in; never a merge. A doc this store must not hold (`rolesDocRefusal`), or a key held by two
   *  people, writes nothing and throws a sentence that names no value. `loaded_at` is the time of the load. */
  async replaceRoles(doc: RolesDoc, now: Date = new Date()): Promise<void> {
    const refusal = rolesDocRefusal(doc)
    if (refusal !== null) throw new Error(refusal)
    await this.locked(() => {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.w.rolesClear.run(); this.w.keysClear.run()
        for (const p of doc.people) this.w.rolePut.run(p.id, p.name, JSON.stringify(p.roles), JSON.stringify(p.nodes))
        for (const p of doc.people) {
          for (const k of p.email_keys) {
            try { this.w.keyPut.run(k, p.id) } catch { throw new Error('An email key is held by two people in this Roles document; nothing was loaded.') }
          }
        }
        this.w.metaPut.run('roles_version', doc.roles_version)
        this.w.metaPut.run('loaded_at', now.toISOString())
        this.db.exec('COMMIT')
      } catch (err) {
        try { this.db.exec('ROLLBACK') } catch { /* the error to tell is the load's */ }
        throw err
      }
    })
  }

  /** One sign-in link, unused. Refused when any part of it holds an address (`@`, or `%40`). */
  async putLink(row: Omit<RolesLink, 'usedAt'>): Promise<void> {
    for (const [name, v] of Object.entries(row)) nonEmpty(`a sign-in link's ${name}`, v)
    if (Object.values(row).some(v => typeof v === 'string' && /@|%40/i.test(v))) throw new Error('A sign-in link must hold no address; nothing was written.')
    await this.locked(() => { this.w.linkPut.run(row.tokenHash, row.personId, row.returnTo, row.created, row.expires) })
  }

  /** Spends the link `tokenHash` names, at `now`, once: the link, its `usedAt` now set; or why not — `unknown` (no such
   *  link), `used` (spent before, or by a take that won the race), `expired` (`expires <= now`; an expired link is not
   *  marked used). Under the write lock, and the mark is conditional on `used_at IS NULL`, so two takes never both win. */
  async takeLink(tokenHash: string, now: Date): Promise<RolesLink | 'unknown' | 'used' | 'expired'> {
    return this.locked(() => {
      const row = this.w.linkGet.get(tokenHash) as LinkRow | undefined
      if (!row) return 'unknown'
      if (row.used_at !== null) return 'used'
      if (Date.parse(row.expires) <= now.getTime()) return 'expired'
      const at = now.toISOString()
      if (Number(this.w.linkUse.run(at, tokenHash).changes) !== 1) return 'used'
      return { tokenHash: row.token_hash, personId: row.person_id, returnTo: row.return_to, created: row.created, expires: row.expires, usedAt: at }
    })
  }

  /** Removes every link that expired at or before `at`, used or not. */
  async deleteLinksExpired(at: Date): Promise<void> {
    await this.locked(() => { this.w.linksExpired.run(at.toISOString()) })
  }

  // View state and drafts (DAO-OS L6 §7.3, §6, §8.1): a member's own, and an editing session's. One statement each, under
  // the write lock like any write. Neither is private data's history: view state is nobody's but its member's, and a
  // draft is written into its page (with its history row) when its session ends.

  /** `member`'s state of `collection`'s view (their current view, unsaved filters, collapsed groups), whole; null removes it. */
  async putViewState(member: string, collection: string, state: unknown): Promise<void> {
    nonEmpty('a member', member); nonEmpty('a collection', collection)
    if (state === null) { await this.locked(() => { this.w.viewStateDelete.run(member, collection) }); return }
    const text = JSON.stringify(state) as string | undefined
    if (text === undefined) throw new Error(`the private store needs ${member}'s view state of ${collection} as JSON`)
    await this.locked(() => { this.w.viewStatePut.run(member, collection, text) })
  }

  /** One editing session's draft, written whole (a later put for the same session replaces it). */
  async putDraft(d: DraftRow): Promise<void> {
    for (const name of ['session', 'target', 'actor', 'opened', 'updated'] as const) nonEmpty(`a draft's ${name}`, d[name])
    if (typeof d.body !== 'string') throw new Error('the private store needs a draft\'s body as a string')
    if (d.base !== null && typeof d.base !== 'string') throw new Error('the private store needs a draft\'s base as a string, or null')
    await this.locked(() => { this.w.draftPut.run(d.session, d.target, d.actor, d.base, d.body, d.opened, d.updated) })
  }

  /** The draft of `session` gone (its session ended, or was discarded). */
  async deleteDraft(session: string): Promise<void> {
    await this.locked(() => { this.w.draftDelete.run(nonEmpty('a session id', session)) })
  }

  // Conversation (DAO-OS L6 §8.1–8.3): comments, mentions, notifications and read state. Not private data's history. A
  // comment, a mention and a notification keep the level their target had when written (PR7-R45); a viewer reads one only
  // when admitted to that and to the target's level now (workspace/written.ts). Each write is one transaction under the
  // write lock.

  /** Comments, mentions and notifications written together, or none of them (a comment and whom it told are one act). */
  async writeConversation(c: ConversationWrite): Promise<void> {
    const comments = (c.comments ?? []).map(checkComment)
    for (const m of c.mentions ?? []) {
      nonEmpty('a mention\'s source', m.source); nonEmpty('a mention\'s ref', m.ref); writtenOf('a mention', m.writtenLevel)
      if (!MENTION_KINDS.has(m.kind)) throw new Error(`the private store needs a mention's kind as member, role, page or record, not ${String(m.kind)}`)
    }
    for (const n of c.notifications ?? []) {
      for (const name of ['id', 'member', 'target', 'source', 'by', 'created'] as const) nonEmpty(`a notification's ${name}`, n[name])
      if (n.kind !== 'mention') throw new Error('the private store needs a notification\'s kind as mention')
      writtenOf('a notification', n.writtenLevel)
    }
    for (const s of c.dropSources ?? []) nonEmpty('a source', s)
    await this.locked(() => {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        for (const r of comments) {
          this.w.commentPut.run(r.id, r.target, r.parent, r.anchor === null ? null : JSON.stringify(r.anchor), r.by, r.body, r.created, r.edited,
            r.resolvedBy, r.resolvedAt, r.deleted, r.task ?? null, r.writtenLevel)
        }
        for (const m of c.mentions ?? []) this.w.mentionPut.run(m.source, m.kind, m.ref, m.told ? 1 : 0, m.writtenLevel)
        for (const s of c.dropSources ?? []) this.w.notificationsDrop.run(s)
        for (const n of c.notifications ?? []) this.w.notificationPut.run(n.id, n.member, n.kind, n.target, n.source, n.by, n.created, n.readAt, n.writtenLevel)
        this.db.exec('COMMIT')
      } catch (err) {
        try { this.db.exec('ROLLBACK') } catch { /* the error to tell is the write's */ }
        throw err
      }
    })
  }

  /** PR7-R45: the targets that hold conversation rows written before `written_level` existed (still `unfilled`). */
  unfilledTargets(): string[] {
    return (this.reader.prepare(`SELECT target FROM comments WHERE written_level = ?1 UNION SELECT target FROM notifications WHERE written_level = ?1
      UNION SELECT source AS target FROM mentions WHERE written_level = ?1 AND source NOT LIKE 'comment:%' ORDER BY target`).all(WRITTEN_UNFILLED) as { target: string }[])
      .map(r => r.target)
  }

  /** PR7-R45, once, at the start after schema 3's migration: every `unfilled` row takes its target's level then (`levels`,
   *  target → level token), `nobody` where `levels` has none (the target was not there to read); a comment's mentions take
   *  the comment's. One transaction. */
  async fillWrittenLevels(levels: ReadonlyMap<string, string>, nobody: string): Promise<void> {
    nonEmpty('the level that admits nobody', nobody)
    for (const [t, l] of levels) { nonEmpty('a target', t); nonEmpty('a level', l) }
    await this.locked(() => {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const targets = new Set(this.unfilledTargetsIn())
        for (const target of targets) {
          const level = levels.get(target) ?? nobody
          this.db.prepare('UPDATE comments SET written_level = ? WHERE target = ? AND written_level = ?').run(level, target, WRITTEN_UNFILLED)
          this.db.prepare('UPDATE notifications SET written_level = ? WHERE target = ? AND written_level = ?').run(level, target, WRITTEN_UNFILLED)
          this.db.prepare('UPDATE mentions SET written_level = ? WHERE source = ? AND written_level = ?').run(level, target, WRITTEN_UNFILLED)
        }
        this.db.prepare(`UPDATE mentions SET written_level = COALESCE((SELECT c.written_level FROM comments c WHERE 'comment:' || c.id = mentions.source), ?1)
          WHERE written_level = ?2 AND source LIKE 'comment:%'`).run(nobody, WRITTEN_UNFILLED)
        this.db.exec('COMMIT')
      } catch (err) {
        try { this.db.exec('ROLLBACK') } catch { /* the error to tell is the write's */ }
        throw err
      }
    })
  }

  private unfilledTargetsIn(): string[] {
    return (this.db.prepare(`SELECT target FROM comments WHERE written_level = ?1 UNION SELECT target FROM notifications WHERE written_level = ?1
      UNION SELECT source AS target FROM mentions WHERE written_level = ?1 AND source NOT LIKE 'comment:%'`).all(WRITTEN_UNFILLED) as { target: string }[]).map(r => r.target)
  }

  /** `member`'s notifications marked read at `at`: those of `ids`, and every one on `target`; answers how many were unread. */
  async markNotificationsRead(member: string, at: string, which: { ids?: readonly string[]; target?: string }): Promise<number> {
    nonEmpty('a member', member); nonEmpty('a time', at)
    return this.locked(() => {
      let n = 0
      for (const id of which.ids ?? []) n += Number(this.w.notificationRead.run(at, member, id).changes)
      if (which.target !== undefined) n += Number(this.w.notificationsReadOf.run(at, member, nonEmpty('a target', which.target)).changes)
      return n
    })
  }

  /** R-9a: the conversation of git targets that are gone, in one transaction: on each, the comments, read marks and
   *  notifications made at or before its `at` (when the trunk moved, or the delete was made; R2b I-2), so what was written
   *  on a page made again after that stays. A target the store keeps a record for (it moved here under the same id) keeps
   *  its rows. Answers the targets purged. */
  async purgeConversation(gone: readonly { target: string; at: string }[]): Promise<string[]> {
    for (const g of gone) { nonEmpty('a target', g.target); nonEmpty('a time', g.at) }
    return this.locked(() => {
      const out: string[] = []
      this.db.exec('BEGIN IMMEDIATE')
      try {
        for (const g of gone) {
          const m = /^page:(.+)$/.exec(g.target) ?? null
          const r = m ? null : /^record:([^:]+):(.+)$/.exec(g.target)
          const kept = m ? this.w.recordGet.get('pages', m[1]!) : r ? this.w.recordGet.get(r[1]!, r[2]!) : undefined
          if (kept) continue
          this.purgeIn(g.target, g.at)
          out.push(g.target)
        }
        this.db.exec('COMMIT')
      } catch (err) {
        try { this.db.exec('ROLLBACK') } catch { /* the error to tell is the write's */ }
        throw err
      }
      return out
    })
  }

  /** `member` opened `target` at `at` (read state, §8.3). */
  async putRead(member: string, target: string, at: string): Promise<void> {
    nonEmpty('a member', member); nonEmpty('a target', target); nonEmpty('a time', at)
    await this.locked(() => { this.w.readPut.run(member, target, at) })
  }

  private async locked<T>(fn: () => T): Promise<T> {
    const release = await this.lock.acquire()
    try { return fn() } finally { release() }
  }

  /** One write and its history row, or neither: a savepoint inside the open transaction. */
  private atomic(fn: () => void): void {
    this.db.exec('SAVEPOINT write_and_history')
    try { fn() } catch (err) {
      // The error to tell is fn's (§7.5): a failing ROLLBACK TO or RELEASE after it is logged, never thrown in its place.
      // The transaction around it is rolled back by its caller either way.
      for (const sql of ['ROLLBACK TO write_and_history', 'RELEASE write_and_history']) {
        try { this.db.exec(sql) } catch (second) {
          console.error(`org-os admin: the private store could not ${sql === 'RELEASE write_and_history' ? 'release' : 'roll back to'} a savepoint after a failed write: ${second instanceof Error ? second.message : String(second)}`)
        }
      }
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

  private deleteRecordIn(collection: string, id: string, by: string, change: string | null, decision: string | null, purge = true): void {
    nonEmpty('a collection', collection); nonEmpty('a record id', id); nonEmpty('who wrote', by); changeOf(change); decisionOf(decision)
    const old = this.w.recordGet.get(collection, id) as RecordRow | undefined
    if (!old) return
    this.w.recordDelete.run(collection, id)
    this.remember(by, `${collection}/${id}`, asRecord(old), null, change, decision)
    // R-9a: its conversation goes with it, in this transaction (a page is `page:<id>`, any other record `record:<c>:<id>`);
    // a record moved into the repository (L6 §12) keeps it.
    if (purge) this.purgeIn(collection === 'pages' ? `page:${id}` : `record:${collection}:${id}`)
  }

  /** `target`'s comments made at or before `at` (every one without it), the replies under them, and their mentions and
   *  notifications, whatever their time (T2c minor 3: a reply that goes takes what it told); the target's own (a page's)
   *  mentions, which hold no time; its other notifications and read marks made at or before `at`: gone. Inside an open
   *  transaction. */
  private purgeIn(target: string, at: string = UNBOUNDED): void {
    const rows = this.w.goneComments.all(target) as { id: string; parent: string | null; created: string }[]
    const gone = new Set(rows.filter(r => r.created <= at).map(r => r.id))
    // A reply answers what it is under: it goes with it, whenever it was written.
    for (let grew = true; grew;) {
      grew = false
      for (const r of rows) if (!gone.has(r.id) && r.parent !== null && gone.has(r.parent)) { gone.add(r.id); grew = true }
    }
    for (const id of gone) {
      this.w.goneMentions.run(`comment:${id}`)
      this.w.notificationsDrop.run(`comment:${id}`)
      this.w.goneComment.run(id)
    }
    this.w.goneMentions.run(target)
    this.w.goneNotifications.run(target, at)
    this.w.goneReads.run(target, at)
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

  private deleteCollectionIn(id: string, by: string): void {
    nonEmpty('a collection id', id); nonEmpty('who wrote', by)
    const old = this.w.collectionGet.get(id) as { id: string; visibility: string; definition: string } | undefined
    if (!old) return
    this.w.collectionDelete.run(id)
    this.remember(by, id, { id: old.id, visibility: old.visibility, definition: JSON.parse(old.definition) as unknown }, null, null)
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

  /** When record `id` of `collection` was last written (its `updated_at`, ISO), or null when the store holds none (DAO-OS L6
   *  §10, Task 14: a private page's or record's from mark). */
  updatedAt(collection: string, id: string): string | null {
    const row = this.r.recordUpdated.get(collection, id) as { updated_at: string } | undefined
    return row ? row.updated_at : null
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

  /** The person with id `id` in the Roles last loaded, or null. */
  person(id: string): RolesPerson | null {
    return asPerson(this.r.person.get(id) as PersonRow | undefined)
  }

  /** The person one of whose email keys is `key` (I3), or null. */
  personByEmailKey(key: string): RolesPerson | null {
    return asPerson(this.r.personByKey.get(key) as PersonRow | undefined)
  }

  /** The `roles_version` (the dump's date) of the Roles last loaded, or null when none has been. */
  rolesVersion(): string | null {
    return (this.r.meta.get('roles_version') as { v: string } | undefined)?.v ?? null
  }

  /** `member`'s state of `collection`'s view, as they last put it; null when they have none. */
  viewState(member: string, collection: string): unknown | null {
    const row = this.r.viewState.get(member, collection) as { state: string } | undefined
    return row ? JSON.parse(row.state) as unknown : null
  }

  /** The draft of editing session `session`, or null. */
  draft(session: string): DraftRow | null {
    const row = this.r.draft.get(session) as DraftRow | undefined
    return row ? { ...row } : null
  }

  /** Every draft the store holds, oldest session first (a server that restarts finds the sessions it left open). */
  drafts(): DraftRow[] {
    return (this.r.drafts.all() as unknown as DraftRow[]).map(d => ({ ...d }))
  }

  /** The comment `id`, or null. */
  comment(id: string): CommentRow | null {
    const row = this.r.comment.get(id) as CommentRaw | undefined
    return row ? asComment(row) : null
  }

  /** Every comment on `target`, oldest first (replies included: `parent` says where each goes). */
  comments(target: string): CommentRow[] {
    return (this.r.comments.all(target) as unknown as CommentRaw[]).map(asComment)
  }

  /** The mentions `source` (`comment:<id>` or `page:<id>`) has made. */
  mentionsOf(source: string): MentionRow[] {
    return (this.r.mentions.all(source) as unknown as { source: string; kind: MentionRow['kind']; ref: string; told: number; written_level: string }[])
      .map(m => ({ source: m.source, kind: m.kind, ref: m.ref, told: m.told === 1, writtenLevel: m.written_level }))
  }

  /** `member`'s notifications, newest first, as stored: the caller judges each against its target's level now and the level
   *  it was written at (§8.3, PR7-R45). */
  notifications(member: string): StoredNotification[] {
    return (this.r.notifications.all(member) as unknown as NotificationRaw[]).map(asNotification)
  }

  /** PR7-R45, the housekeeping: every target the conversation holds rows on (comments, notifications, read marks, a page's
   *  own mentions), each once, sorted. */
  conversationTargets(): string[] {
    return (this.reader.prepare(`SELECT target FROM comments UNION SELECT target FROM notifications UNION SELECT target FROM reads
      UNION SELECT source AS target FROM mentions WHERE source NOT LIKE 'comment:%' ORDER BY target`).all() as { target: string }[]).map(r => r.target)
  }

  /** When `member` last opened `target`, or null. */
  readOf(member: string, target: string): string | null {
    const row = this.r.read.get(member, target) as { at: string } | undefined
    return row ? row.at : null
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

  /** Every string the store holds of what must not be published (L9 spec §3.4 point 2), nested values read whole and
   *  object keys left out: its records' ids and bodies, its fields' values, its private collections' ids and
   *  definitions, its pending and staged ops, what its history kept (who wrote, before and after, so a deleted record
   *  stays one), and the wallet accounts its sessions were signed in with (not a person id, I1). Through the read-only
   *  connection: what was last committed. Throws when the store cannot be read. */
  allStrings(): Set<string> {
    const out = new Set<string>()
    const take = (v: unknown): void => {
      if (typeof v === 'string') out.add(v)
      else if (Array.isArray(v)) v.forEach(take)
      else if (v !== null && typeof v === 'object') Object.values(v).forEach(take)
    }
    const parsed = (text: unknown): unknown => (typeof text === 'string' ? JSON.parse(text) : null)
    const rows = (sql: string) => this.reader.prepare(sql).all() as Record<string, unknown>[]
    for (const r of rows('SELECT id, body FROM records')) { take(r.id); take(parsed(r.body)) }
    for (const f of rows('SELECT value FROM fields')) take(parsed(f.value))
    for (const c of rows('SELECT id, definition FROM collections')) { take(c.id); take(parsed(c.definition)) }
    for (const p of rows('SELECT ops FROM pending')) take(parsed(p.ops))
    for (const s of rows('SELECT op FROM staged')) take(parsed(s.op))
    for (const h of rows('SELECT "by", "before", "after" FROM history')) { take(h.by); take(parsed(h.before)); take(parsed(h.after)) }
    // A wallet session's account (CAIP-10) is private; an emailed-link session's is the person's id (I1), which is in git
    // and which a portal page may name (Lane 3 ruling S8-2), so it is left out.
    for (const s of rows('SELECT account FROM sessions')) if (!PERSON_ID.test(String(s.account))) take(s.account)
    // The email keys are private; the Roles' ids and names are not added: the ids are in git, and the stewards' names
    // are public, so the portal must stay free to print them (Lane 3 ruling S2-1).
    for (const k of rows('SELECT email_key FROM email_keys')) take(k.email_key)
    return out
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
