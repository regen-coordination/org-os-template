import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { BackupUnreadable, readKey, readOpeningKey, readPublicKey, seal, sealTo, unseal } from './crypto.ts'
import { placeInRepo, privateDir, STORE_FILE } from './paths.ts'
import { checkStorePlace, SCHEMA_VERSION, type Git, type PrivateStore } from './store.ts'
import { isIgnored } from '../git.ts'
import { runningServer } from '../state.ts'
import type { Attention } from '../resources/types.ts'

export { createKey, createKeyPair } from './crypto.ts'

/** The private store is backed up on its own (L5 spec §10.4, ADR 0001): a consistent copy (`VACUUM INTO` on the store's
 *  read connection, a WAL snapshot that holds no write lock: L9 §7.1, carry 5), sealed with AES-256-GCM, either to a
 *  maintainer's X25519 public key (`ORGOSPK1`, L9 §7.1: the only way when hosted, so the server cannot open its own
 *  backups) or under L5's symmetric key file (`ORGOSPS1`, locally), written as `house-<UTC time>.db.enc` beside a
 *  manifest of one JSON line per backup (`manifest.jsonl`: its SHA-256, schema version and row counts). Nothing in clear
 *  is ever written outside the store's own folder, which git ignores whole. */

export const BACKUP_EVERY_MS = 86_400_000
export const BACKUP_KEEP = 14
export const MANIFEST = 'manifest.jsonl'

const NAME = /^house-(\d{8}T\d{6}Z)\.db\.enc$/

/** A time as the backup names write it: `20261029T120000Z`, UTC, sorting as it reads. */
export const stamp = (at: Date): string => at.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '')

export interface BackupMade { file: string; sha256: string; counts: Record<string, number> }
interface ManifestLine { file: string; at: string; sha256: string; version: number; counts: Record<string, number> }

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const inside = (folder: string, path: string) => placeInRepo(folder, path) !== null

/** Where a key file must not be (§10.4): in the store's folder or the backup folder, where one copy carries both the
 *  backups and what opens them; or in the repository, where a commit can carry it. Throws the sentence. */
export function checkKeyPlace(keyFile: string, places: { storeDir: string; backupDir?: string; repo?: string }): void {
  if (inside(places.storeDir, keyFile)) throw new Error("Keep the key outside the private store's folder, or one copy loses both.")
  if (places.backupDir !== undefined && inside(places.backupDir, keyFile)) throw new Error('Keep the key outside the backup folder, or one copy loses both.')
  if (places.repo !== undefined && inside(places.repo, keyFile)) throw new Error('Keep the key outside the repository, or a commit can carry it.')
}

/** What a store file holds: its schema version and the rows of each table. `PRAGMA integrity_check` first, when asked. */
function inspect(file: string, check: boolean): { version: number; counts: Record<string, number> } {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    if (check) {
      const found = (db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]).map(r => r.integrity_check)
      if (found.join() !== 'ok') throw new BackupUnreadable(`This backup does not pass SQLite's integrity check (${found[0]}); it was not restored.`)
    }
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    const tables = (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(t => t.name)
    const counts: Record<string, number> = {}
    for (const t of tables) counts[t] = (db.prepare(`SELECT count(*) AS n FROM "${t.replace(/"/g, '""')}"`).get() as { n: number }).n
    return { version, counts }
  } finally { db.close() }
}

/** Takes a backup of `store` into `dir`: the copy is made in a folder of its own inside the store's folder (ignored
 *  by git like the store), sealed, written mode 600 as `house-<stamp(now)>.db.enc`, and noted in the manifest. Sealed to
 *  the public key in `publicKeyFile` when one is given (L9 §7.1), else under the symmetric key in `keyFile`, which must
 *  be outside the store's folder and `dir` (and the repository, when `repo` is given). The copy is taken on the read
 *  connection and waits for no write (L9 §7.1). */
export async function backup(store: PrivateStore, opts: { dir: string; keyFile?: string; publicKeyFile?: string; now: Date; repo?: string }): Promise<BackupMade> {
  const storeDir = dirname(store.file)
  const dir = resolve(opts.dir)
  let sealWith: (plain: Buffer) => Buffer
  if (opts.publicKeyFile !== undefined) {
    const pem = readPublicKey(opts.publicKeyFile)
    sealWith = plain => sealTo(pem, plain)
  } else if (opts.keyFile !== undefined) {
    checkKeyPlace(opts.keyFile, { storeDir, backupDir: dir, ...(opts.repo !== undefined ? { repo: opts.repo } : {}) })
    const key = readKey(opts.keyFile)
    sealWith = plain => seal(key, plain)
  } else throw new Error('A backup needs a key: a public key file to seal it to, or a key file.')
  const name = `house-${stamp(opts.now)}.db.enc`
  const file = join(dir, name)
  if (existsSync(file)) throw new Error(`A backup named ${name} is already in ${dir}; nothing was written.`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const work = mkdtempSync(join(storeDir, '.backup-'))
  try {
    const plain = join(work, STORE_FILE)
    await store.copyInto(plain)
    const { version, counts } = inspect(plain, false)
    const sealed = sealWith(readFileSync(plain))
    const partial = join(dir, `.${name}.partial`)
    writeFileSync(partial, sealed, { mode: 0o600 })
    chmodSync(partial, 0o600)
    renameSync(partial, file)
    const sum = sha256(sealed)
    const line: ManifestLine = { file: name, at: opts.now.toISOString(), sha256: sum, version, counts }
    appendFileSync(join(dir, MANIFEST), `${JSON.stringify(line)}\n`, { mode: 0o600 })
    return { file, sha256: sum, counts }
  } finally { rmSync(work, { recursive: true, force: true }) }
}

/** The manifest line that names `file`, read from the manifest beside it; null when there is none. */
function manifestLine(file: string): ManifestLine | null {
  let text: string
  try { text = readFileSync(join(dirname(file), MANIFEST), 'utf8') } catch { return null }
  let found: ManifestLine | null = null
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    try {
      const line = JSON.parse(raw) as ManifestLine
      if (line.file === basename(file)) found = line
    } catch { /* a line that is not JSON names nothing */ }
  }
  return found
}

/** Opens `file` under the key in `keyFile` and writes the store file it holds to `target` (mode 600; `written` is
 *  called once that file is this call's), then checks it: `PRAGMA integrity_check` and a schema this org-os can read.
 *  The manifest beside the file is read only when the file does not open (R-L5-5.2). Throws the sentence to say. */
function openTo(file: string, keyFile: string, target: string, written: () => void = () => {}): { version: number; counts: Record<string, number> } {
  const key = readOpeningKey(keyFile)
  let sealed: Buffer
  try { sealed = readFileSync(file) } catch (err) { throw new BackupUnreadable(`The backup ${file} could not be read: ${(err as Error).message}`) }
  const plain = unseal(key, sealed, () => {
    const listed = manifestLine(file)
    return listed === null ? null : listed.sha256 === sha256(sealed)
  })
  writeFileSync(target, plain, { mode: 0o600, flag: 'wx' })
  written()
  chmodSync(target, 0o600)
  let read: { version: number; counts: Record<string, number> }
  try { read = inspect(target, true) } catch (err) {
    if (err instanceof BackupUnreadable) throw err
    throw new BackupUnreadable(`This backup does not hold a store that can be opened (${(err as Error).message}); it was not restored.`)
  }
  if (read.version > SCHEMA_VERSION) throw new BackupUnreadable(`This backup was written by a newer org-os (schema ${read.version}); update first. It was not restored.`)
  if (read.version < 1) throw new BackupUnreadable('This backup holds no private store (schema 0); it was not restored.')
  return read
}

/** Everything a restore does but the move (`house:backup -- --verify <file>`). The store is opened in a `.verify-*`
 *  folder of its own inside `opts.dir`, the private store's folder (ignored by git with it), and that folder is gone
 *  after: nothing in clear is written anywhere else. Never throws: an unreadable backup is `{ ok: false, error }`
 *  with the sentence. */
export function verifyBackup(file: string, keyFile: string, opts: { dir: string }): { ok: true; version: number; counts: Record<string, number> } | { ok: false; error: string } {
  let work: string
  try {
    mkdirSync(opts.dir, { recursive: true, mode: 0o700 })
    work = mkdtempSync(join(resolve(opts.dir), '.verify-'))
  } catch (err) {
    return { ok: false, error: `The private store's folder ${opts.dir} could not take a backup to check: ${(err as Error).message}` }
  }
  try {
    const { version, counts } = openTo(file, keyFile, join(work, STORE_FILE))
    return { ok: true, version, counts }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally { rmSync(work, { recursive: true, force: true }) }
}

/** Restores `file` as the private store of `repo` (in `opts.dir`, else `privateDir(repo)`): refused while a server
 *  of the repository runs (its pid file), and where §10.1 refuses a store; opened into the store's folder and checked
 *  there; then the current file (with any `-wal`/`-shm` beside it) is kept as `house.db.before-restore-<time>` and
 *  the restored one moved in. `kept` is null when there was no store to keep. */
export async function restore(repo: string, file: string, keyFile: string, opts: { dir?: string; now?: Date; git?: Git } = {}): Promise<{ restored: string; kept: string | null }> {
  if (runningServer(repo) !== null) throw new Error('Stop the server for this repository first.')
  const dir = resolve(opts.dir ?? privateDir(repo))
  await checkStorePlace(repo, dir, opts.git)
  const at = stamp(opts.now ?? new Date())
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const incoming = join(dir, `${STORE_FILE}.restoring-${at}`)
  if (existsSync(incoming)) {
    throw new Error(`A restore begun at ${at} did not finish: ${incoming} is still there. Move it away and restore again; nothing was changed.`)
  }
  let created = false
  try { openTo(file, keyFile, incoming, () => { created = true }) } catch (err) {
    if (created) rmSync(incoming, { force: true }) // never a file another restore left or is writing
    throw err
  }
  const current = join(dir, STORE_FILE)
  let kept: string | null = null
  if (existsSync(current)) {
    // Fold the WAL into the file first, so the kept copy is whole; a file too damaged for that keeps its WAL beside it.
    try { const db = new DatabaseSync(current); try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } finally { db.close() } } catch { /* kept as it is */ }
    kept = `${current}.before-restore-${at}`
    for (const part of ['', '-wal', '-shm']) if (existsSync(current + part)) renameSync(current + part, kept + part)
  }
  try { renameSync(incoming, current) } catch (err) {
    // Never leave the folder without a store: the kept file goes back where it was.
    if (kept !== null) for (const part of ['', '-wal', '-shm']) if (existsSync(kept + part)) renameSync(kept + part, current + part)
    rmSync(incoming, { force: true })
    throw err
  }
  return { restored: current, kept }
}

/** At start, with no other live server for the repository (L9 §7.1, carry 6): the `.backup-*` folders a backup left in
 *  the store's folder and the `house.db.restoring-*` files a restore left, each removed and named through `log`. Answers
 *  what was removed. A folder that does not exist has none. */
export function cleanLeftovers(storeDir: string, log: (line: string) => void): string[] {
  let names: string[]
  try { names = readdirSync(storeDir) } catch { return [] }
  const gone: string[] = []
  for (const name of names) {
    const what = name.startsWith('.backup-') ? 'a backup' : name.startsWith(`${STORE_FILE}.restoring-`) ? 'a restore' : null
    if (what === null) continue
    const path = join(storeDir, name)
    try { rmSync(path, { recursive: true, force: true }) } catch (err) {
      log(`Could not remove ${path}, left by ${what} that did not finish: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    gone.push(path)
    log(`Removed ${path}, left by ${what} that did not finish.`)
  }
  return gone
}

/** Where backups may be written (L9 §7.1, carry 6): hosted, never inside the repository (the §10 sentence); locally,
 *  inside it only in a folder git ignores whole, the store's own check. Rejects with the sentence; creates nothing. */
export async function checkBackupPlace(repo: string, dir: string, hosted: boolean, git: Git = { isIgnored }): Promise<void> {
  const place = placeInRepo(repo, dir)
  if (place === null) return
  if (hosted) throw new Error('ORG_OS_BACKUP_DIR is inside the repository. Put it on its own volume, then start again.')
  if (place === '') throw new Error('The backups would be at the root of the repository, which git does not ignore. Set ORG_OS_BACKUP_DIR to a folder outside it, or to a folder .gitignore names.')
  let ignored: boolean
  try { ignored = await git.isIgnored(repo, `${place}/`) } catch (err) {
    throw new Error(`The backups would be in ${place}, and git could not say whether it ignores that folder: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!ignored) throw new Error(`The backups would be in ${place}, which git does not ignore. Add \`${place}/\` to .gitignore first.`)
}

/** Removes all but the newest `keep` backups in `dir` (by the time in their names); answers the files removed, newest
 *  first. Nothing else in the folder is touched; the manifest keeps their lines. */
export function prune(dir: string, keep: number): string[] {
  const backups = readdirSync(dir).filter(f => NAME.test(f)).sort().reverse()
  const gone = backups.slice(Math.max(0, keep)).map(f => join(dir, f))
  for (const f of gone) rmSync(f, { force: true })
  return gone
}

/** When the newest backup in `dir` was taken, from its name; null when there is none. */
export function newestBackup(dir: string): Date | null {
  let names: string[]
  try { names = readdirSync(dir).filter(f => NAME.test(f)).sort() } catch { return null }
  const last = names.at(-1)?.match(NAME)?.[1]
  if (!last) return null
  return new Date(`${last.slice(0, 4)}-${last.slice(4, 6)}-${last.slice(6, 8)}T${last.slice(9, 11)}:${last.slice(11, 13)}:${last.slice(13, 15)}Z`)
}

/** `ORG_OS_BACKUP_EVERY`: milliseconds, or a number with s, m, h or d. */
export function parseEvery(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?\s*$/.exec(text)
  if (!m) return null
  const n = Number(m[1]) * { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[(m[2] ?? 'ms') as 'ms']
  return n >= 1 ? Math.round(n) : null
}

/** The longest a timer waits: Node runs a longer `setInterval` every millisecond instead (about 24.8 days). */
export const MAX_EVERY_MS = 2_147_483_647

/** Where the server's attention for the backups goes (`server/attention.ts`). */
export interface BackupAttention { raise(key: string, name: string, attention: Attention): void; clear(key: string): void }

const NOT_BACKED_UP = 'The private store was not backed up: '

/** The server's backups (§10.4): every `ORG_OS_BACKUP_EVERY` (default 24 h; `everyMs` overrides it in tests), into
 *  `ORG_OS_BACKUP_DIR` (default `<the store's folder>/backups`; never inside the repository when hosted, and only in a
 *  folder git ignores locally, L9 §7.1), keeping the newest `ORG_OS_BACKUP_KEEP` (default 14). Sealed to the public key in
 *  `ORG_OS_BACKUP_PUBLIC_KEY_FILE` (L9 §7.1); locally, without one, under L5's key in `ORG_OS_BACKUP_KEY_FILE`. Hosted,
 *  only a public key is used: the server never holds what opens its backups. A backup is taken at once when the newest
 *  is older than the interval. A failure, or no public key in hosted mode, is the attention item "The private store was
 *  not backed up: <why>."; the next good backup clears it. Locally, no key means no backups and nothing said. */
export function scheduleBackups(d: {
  store: PrivateStore; repo: string; hosted: boolean; attention: BackupAttention
  env?: NodeJS.ProcessEnv; everyMs?: number; now?: () => Date
}): { stop: () => Promise<void> } {
  const env = d.env ?? process.env
  const now = d.now ?? (() => new Date())
  let said: string | null = null
  const say = (why: string) => {
    const text = `${NOT_BACKED_UP}${why}`
    if (text !== said) console.error(`org-os admin: ${text}`) // once, not at every tick
    said = text
    d.attention.raise('backup', 'Private store backup', { level: 'warn', text })
  }
  const idle = { stop: async () => {} }
  const publicKeyFile = env.ORG_OS_BACKUP_PUBLIC_KEY_FILE?.trim() ? resolve(d.repo, env.ORG_OS_BACKUP_PUBLIC_KEY_FILE) : null
  const keyFile = !d.hosted && env.ORG_OS_BACKUP_KEY_FILE?.trim() ? resolve(d.repo, env.ORG_OS_BACKUP_KEY_FILE) : null
  if (publicKeyFile === null && keyFile === null) {
    if (d.hosted) say("no public key is set. Make a key pair on a maintainer's machine with npm run house:backup:keypair -- <private file> <public file>, and set ORG_OS_BACKUP_PUBLIC_KEY_FILE to the public one.")
    return idle
  }
  const key = publicKeyFile !== null ? { publicKeyFile } : { keyFile: keyFile! }
  const every = d.everyMs ?? (env.ORG_OS_BACKUP_EVERY?.trim() ? parseEvery(env.ORG_OS_BACKUP_EVERY) : BACKUP_EVERY_MS)
  if (every === null) { say(`ORG_OS_BACKUP_EVERY is "${env.ORG_OS_BACKUP_EVERY}", not a time such as 24h.`); return idle }
  if (every > MAX_EVERY_MS) { say(`ORG_OS_BACKUP_EVERY is "${env.ORG_OS_BACKUP_EVERY ?? every}", longer than the server can wait (24 days at most).`); return idle }
  const keep = env.ORG_OS_BACKUP_KEEP?.trim() ? Number(env.ORG_OS_BACKUP_KEEP) : BACKUP_KEEP
  if (!Number.isInteger(keep) || keep < 1) { say(`ORG_OS_BACKUP_KEEP is "${env.ORG_OS_BACKUP_KEEP}", not a whole number of backups to keep.`); return idle }
  const dir = env.ORG_OS_BACKUP_DIR?.trim() ? resolve(d.repo, env.ORG_OS_BACKUP_DIR) : join(dirname(d.store.file), 'backups')

  let inFlight: Promise<void> | null = null
  let stopped = false
  let prunedSaid: string | null = null
  const take = () => {
    const at = now()
    // A backup already named for this second is this one: a short interval in a test, or a clock set back.
    if (inFlight || stopped || existsSync(join(dir, `house-${stamp(at)}.db.enc`))) return
    inFlight = checkBackupPlace(d.repo, dir, d.hosted)
      .then(() => backup(d.store, { dir, ...key, now: at, repo: d.repo }))
      .then(() => {
        said = null
        d.attention.clear('backup')
        // The backup was taken: a prune that fails is said as what it is, not as a backup not taken.
        try { prune(dir, keep); prunedSaid = null; d.attention.clear('backup-prune') } catch (err) {
          const text = `Old backups of the private store were not removed: ${err instanceof Error ? err.message : String(err)}`
          if (text !== prunedSaid) console.error(`org-os admin: ${text}`) // once, not at every tick
          prunedSaid = text
          d.attention.raise('backup-prune', 'Private store backup', { level: 'warn', text })
        }
      })
      .catch((err: unknown) => { if (!stopped) say(err instanceof Error ? err.message : String(err)) })
      .finally(() => { inFlight = null })
  }
  const last = newestBackup(dir)
  if (last === null || now().getTime() - last.getTime() >= every) take()
  const timer = setInterval(take, every)
  return {
    stop: async () => {
      stopped = true
      clearInterval(timer)
      if (inFlight) await inFlight
    },
  }
}
