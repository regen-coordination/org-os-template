// packages/admin/server/workspace/files.ts
//
// The `file` op (DAO-OS L6 spec §11.2): a governed file edited whole, by the source editor. It is staged, proposed and
// applied as a record op is, through the same change engine, and checked at stage and again at apply: the path is one
// the server may write (§11.3) and has an editor that is neither `generated` nor `ledger` (nor `ratify`); its text is at
// most FILE_OP_MAX_BYTES; YAML parses; a registry file's entries validate against their schema; data/governance.yaml
// passes `checkGovernance` (so L5's lockout check sees it); data/visibility.yaml passes `checkVisibilityPolicy`, and a
// loosening adds `publication`; `assertGitSafe` over the text. A change holds a file op or record ops on one file, never
// both. Its base is the file's git blob id when it was staged: one that differs from the file now is 0.6's stale.
//
// GET /api/editors answers the §11.1 table; GET /api/files?path= a governed file as the source editor opens it.

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, sep } from 'node:path'
import type { Hono } from 'hono'
import { parseDocument } from 'yaml'
import { EDITORS, editorFor, wholeFileRefusal } from '../../lib/workspace/editors.mjs'
import { CHANGE_CLASSES, classOf, governedClassOf, publishes, widens } from '../../lib/change-classes.mjs'
import { isFileOp as isFileOpLib } from '../../lib/ops.mjs'
import { readGovernance } from '../../lib/governance-read.mjs'
import { checkGovernance, membershipTree } from '../../lib/rules.mjs'
import { PAGE_FILE_NAME } from '../../lib/workspace/pages.mjs'
import { KNOWLEDGE_FILE } from '../../lib/workspace/knowledge.mjs'
import { checkVisibilityPolicy, fullLevel, narrowerOrEqual, parseLevel, readFullPolicy, type VisibilityPolicy } from '../../lib/visibility.mjs'
import { registriesOf, registryFileOf, REGISTRIES, type RegistryDef } from '../registries.ts'
import { entriesFromText, type Entity } from '../registry.ts'
import { validateEntity } from '../schema.ts'
import { assertTracked, assertWritablePath, blobText, isIgnored, mergeThree } from '../git.ts'
import { placeInRepo, privateDir } from '../private/paths.ts'
import { gitSafetyProblems } from '../private/guard.ts'
import { readConfig } from '../visibility/config.ts'
import { HttpError } from '../errors.ts'
import type { FileOp, Op, RecordError, RecordOp, StageOp } from '../changes/types.ts'

/** The most a file op's text may hold (L6 spec, constants): 1 MiB. */
export const FILE_OP_MAX_BYTES = 1048576

// The refusals of a file no file op writes live in lib/workspace/editors.mjs, so the source editor says them too.
export { GENERATED, CANON_FILE } from '../../lib/workspace/editors.mjs'
export const FILE_AND_RECORDS = (path: string): string =>
  `This change already edits records in ${path}; apply or discard those first, then edit the file whole. Nothing was staged.`
/** The other way round: a record op on a file the change already edits whole (copy of this task; the spec gives one direction). */
export const RECORDS_AND_FILE = (path: string): string =>
  `This change already edits ${path} whole; apply or discard that first, then edit its records. Nothing was staged.`
const NOT_GOVERNED = (path: string) => `${path} is not a governed file, so it has no editor here. Nothing was staged.`
const TOO_BIG = (path: string, n: number) =>
  `${path} would be ${n} bytes, and a file is edited whole up to ${FILE_OP_MAX_BYTES} bytes. Nothing was staged.`
const NOT_YAML = (path: string, why: string) => `${path} is not valid YAML (${why}), so it cannot be written. Nothing was staged.`
const NO_FILE = (path: string) => `There is no ${path} to delete. Nothing was staged.`

export const isFileOp = (op: unknown): op is FileOp => isFileOpLib(op)
/** A record op, as the record engine reads it: neither a file op nor a private placeholder. */
export const isRecordOp = <T extends StageOp | Op>(op: T): op is Exclude<T, FileOp> => !isFileOp(op)

/** An op as the ledger stores it: a record op without the `before` only the tray keeps (its `base` stays); a file op as it is. */
export function withoutBefore(op: Op): StageOp & { base: string | null } {
  if (op.op === 'file') return { op: 'file', path: op.path, text: op.text, base: op.base }
  const { before: _before, ...rest } = op
  return rest
}

/** Git's blob id of a text (`git hash-object`): SHA-1 over `blob <bytes>\0<text>`. */
export function blobId(text: string | Buffer): string {
  const bytes = typeof text === 'string' ? Buffer.from(text, 'utf8') : text
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

/** The file's text now, or null when there is none. */
export function fileText(repo: string, path: string): string | null {
  const abs = join(repo, path)
  try { return existsSync(abs) ? readFileSync(abs, 'utf8') : null } catch { return null }
}

/** The file's blob id now, or null when there is none: what a file op is staged against. */
export function fileBase(repo: string, path: string): string | null {
  const abs = join(repo, path)
  try { return existsSync(abs) ? blobId(readFileSync(abs)) : null } catch { return null }
}

/** Whether the file changed since the op was staged (0.6's stale). */
export const isFileStale = (repo: string, op: FileOp): boolean => fileBase(repo, op.path) !== op.base

/** Keep mine refused on a file op whose file left the repository since (Task 20 review C1, PF-R95): never made again. */
export const KEEP_GONE = (path: string): string =>
  `${path} is no longer in the repository, so your edit cannot be kept over it: take theirs. Nothing was changed.`
/** Keep mine refused where the file and the op change the same lines (Task 20 review I1, PF-R96). */
export const KEEP_CONFLICT = (path: string): string =>
  `${path} changed since you staged your edit, and both change the same lines: take theirs and make your edit again over it. Nothing was changed.`
/** Keep mine refused on a deletion of a file that changed since (PF-R96): what changed would go unread. */
export const KEEP_DELETE = (path: string): string =>
  `${path} changed since you staged its deletion: take theirs, then delete it again if it should still go. Nothing was changed.`

/** The op brought up to date with the file as it is now (Compare's Keep mine / Take theirs): `theirs` drops it; `mine` is a
 *  three-way merge (Task 20 review I1, PF-R96: `git merge-file`, as an editing session merges) of the op's text over the
 *  file now, from the text it was staged against, restaged on the file's blob now. Refused 409: a file that is gone
 *  (`GONE`, C1: a page narrowed out is never made again), a merge that does not come out clean, or a base git does not
 *  hold (`CONFLICT`), a deletion of a file that changed (`CONFLICT`). An op that is not stale is returned as it is; one
 *  that the file now holds already is dropped. */
export async function rebaseFileOp(repo: string, op: FileOp, keep: 'mine' | 'theirs'): Promise<FileOp | null> {
  if (!isFileStale(repo, op)) return op
  if (keep === 'theirs') return null
  const base = fileBase(repo, op.path)
  const theirs = fileText(repo, op.path)
  if (op.text === theirs || (op.text === null && base === null)) return null
  if (theirs === null) throw new HttpError(409, KEEP_GONE(op.path), 'GONE')
  if (op.text === null) throw new HttpError(409, KEEP_DELETE(op.path), 'CONFLICT')
  const was = op.base === null ? '' : await blobText(repo, op.base)
  const merged = was === null ? { clean: false as const } : await mergeThree(repo, was, theirs, op.text)
  if (!merged.clean) throw new HttpError(409, KEEP_CONFLICT(op.path), 'CONFLICT')
  return merged.text === theirs ? null : { ...op, text: merged.text, base }
}

/** Refused where an editor that started from another text than the one the change holds for the file changes the same
 *  lines as it (the walk's I4, review G5): the staged text is never silently replaced. */
export const PENDING_CONFLICT = (path: string): string =>
  `${path} has a staged edit your editor did not start from, and both change the same lines: reload the page to edit the ` +
  'staged text. Nothing was staged.'

/** The text a change holds for `path` (its file op's), or undefined when it holds none or a deletion. */
export function pendingText(ops: readonly Op[], path: string): string | undefined {
  const op = ops.find(o => isFileOp(o) && o.path === path) as FileOp | undefined
  return op && op.text !== null ? op.text : undefined
}

/** The walk's I4 (review G5), the backstop: `incoming` was edited from `from`; where the change already holds another text
 *  for the file, the edit is merged three ways over that text (`git merge-file` through git.ts' one door, as an editing
 *  session merges: base `from`, theirs the pending text, mine the incoming), so the pending text is never silently
 *  replaced. Answers the op to fold and the text it now stands on (what `mergeFileOp` is told it started from). 409
 *  CONFLICT (PENDING_CONFLICT) when the two change the same lines. */
export async function overPending(repo: string, ops: readonly Op[], incoming: FileOp, from: string): Promise<{ op: FileOp; from: string }> {
  const pending = pendingText(ops, incoming.path)
  if (pending === undefined || pending === from || incoming.text === null) return { op: incoming, from }
  const merged = await mergeThree(repo, from, pending, incoming.text)
  if (!merged.clean) throw new HttpError(409, PENDING_CONFLICT(incoming.path), 'CONFLICT')
  return { op: { ...incoming, text: merged.text }, from: pending }
}

/** A later file op on a path the change already edits whole: the later text, on the first one's base (as `mergeOp` keeps
 *  a record op's first base). Null when nothing is left: the text is the file as it is (or a delete of a file not there).
 *  `from`, when the caller knows it, is the text the incoming edit started from: one that is not the text the change holds
 *  is refused (409 CONFLICT, PENDING_CONFLICT), never a silent replacement; `overPending` merges it first (G5). */
export function mergeFileOp(ops: Op[], incoming: FileOp, repo: string, from?: string): Op[] {
  const at = ops.findIndex(o => isFileOp(o) && o.path === incoming.path)
  if (from !== undefined && incoming.text !== null) {
    const pending = pendingText(ops, incoming.path)
    if (pending !== undefined && pending !== from) throw new HttpError(409, PENDING_CONFLICT(incoming.path), 'CONFLICT')
  }
  const base = at >= 0 ? (ops[at] as FileOp).base : incoming.base
  const now = fileText(repo, incoming.path)
  const same = incoming.text === now && base === fileBase(repo, incoming.path)
  const next: FileOp | null = same ? null : { op: 'file', path: incoming.path, text: incoming.text, base }
  const out = [...ops]
  if (at >= 0) { if (next) out[at] = next; else out.splice(at, 1) } else if (next) out.push(next)
  return out
}

/** Per-path checks other tasks add (L6 preflight row 26: a page passes §4's checks, registered by the pages task). */
export type FileCheck = (repo: string, op: FileOp) => RecordError[]
const CHECKS: FileCheck[] = []
/** Adds a check every file op passes, at stage and again at apply. Answers the function that removes it. */
export function registerFileCheck(check: FileCheck): () => void {
  CHECKS.push(check)
  return () => { const at = CHECKS.indexOf(check); if (at >= 0) CHECKS.splice(at, 1) }
}

/** The registry whose file `path` is, in the instance's own list (its custom collections too), or null. */
function registryAt(repo: string, path: string): RegistryDef | null {
  return registriesOf(repo).find(d => registryFileOf(d) === path) ?? null
}

/** The registry files the record ops of `ops` write. */
export function recordFilesOf(repo: string, ops: readonly StageOp[]): Set<string> {
  const defs = registriesOf(repo)
  const out = new Set<string>()
  for (const op of ops) {
    if (isFileOp(op) || typeof (op as { record?: unknown }).record !== 'string') continue
    const record = (op as { record: string }).record
    const at = record.indexOf(':')
    const def = defs.find(d => d.name === (at < 0 ? record : record.slice(0, at)))
    // Knowledge's file is its record's kind's (L6 §7.5, Task 10): `registryFileOf(def, id)`.
    if (def) out.add(registryFileOf(def, at < 0 ? undefined : record.slice(at + 1)))
  }
  return out
}

/** A file op and record ops on one file (§11.2), in `ops`: an error per file op whose path a record op writes. */
export function mixedFileErrors(repo: string, ops: readonly StageOp[]): RecordError[] {
  const files = recordFilesOf(repo, ops)
  return ops.flatMap((op): RecordError[] => (isFileOp(op) && files.has(op.path) ? [{ record: op.path, field: '', message: FILE_AND_RECORDS(op.path) }] : []))
}

const problemsKey = (p: { path: string; message: string }) => `${p.path}\u0000${p.message}`

/** The governance block of a text, or null when it cannot be read. */
function governanceOf(text: string | null): Record<string, unknown> | null {
  const read = readGovernance(text)
  return (read.governance as Record<string, unknown> | null) ?? null
}

/** The entries of `registry` as the repository holds them, or null when they cannot be read. */
function entriesNow(repo: string, registry: string): Entity[] | null {
  const def = REGISTRIES.find(d => d.name === registry)
  if (!def) return null
  const text = fileText(repo, registryFileOf(def))
  if (text === null) return []
  try { return entriesFromText(text, def) } catch { return null }
}

/** What a visibility policy text reads as, or null when it cannot be read. */
function policyOf(text: string | null): VisibilityPolicy | null {
  if (text === null) return { collections: {}, defaults: {} }
  try { return readFullPolicy(parseDocument(text).toJS()).policy } catch { return null }
}

/** Whether `now` makes something readable by more people than `was` did: a collection's default, a field, or a default
 *  that is wider after than before (two levels that are not ordered, or one that cannot be read, count as wider). */
export function policyLoosens(was: VisibilityPolicy, now: VisibilityPolicy): boolean {
  const keys = (a: object | undefined, b: object | undefined) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]
  for (const name of keys(was.collections, now.collections)) {
    if (!narrowerOrEqual(fullLevel(now, name, null), fullLevel(was, name, null))) return true
    for (const field of keys(was.collections[name]?.fields, now.collections[name]?.fields)) {
      if (!narrowerOrEqual(fullLevel(now, name, null, field), fullLevel(was, name, null, field))) return true
    }
  }
  for (const key of keys(was.defaults, now.defaults)) {
    if (was.defaults?.[key] === now.defaults?.[key]) continue
    const a = parseLevel(was.defaults?.[key])
    const b = parseLevel(now.defaults?.[key])
    if (a === null || b === null || !narrowerOrEqual(b, a)) return true
  }
  return false
}

/** Whether a file op on data/visibility.yaml widens a level (§11.2: it adds `publication`). */
export function fileLoosens(repo: string, op: StageOp | Op): boolean {
  if (!isFileOp(op) || op.path !== 'data/visibility.yaml') return false
  const was = policyOf(fileText(repo, op.path))
  const now = policyOf(op.text)
  if (was === null || now === null) return now === null ? false : true
  return policyLoosens(was, now)
}

/** A file op's class (§11.2): `governedClassOf(path)`, else the class table's own reading of the path. */
export const fileClassOf = (op: FileOp): string => governedClassOf(op.path) ?? String(classOf({ path: op.path }))

/** Whether the server may write a file op's path at all (§11.2, §11.3): an editor that is not `generated`, `ledger`,
 *  `ratify` or `knowledge` (PF-R1), a governed path, and one `assertWritablePath` allows. Checked before any git runs. */
export function filePathErrors(repo: string, op: FileOp): RecordError[] {
  const no = (message: string): RecordError[] => [{ record: op.path, field: 'path', message }]
  const editor = editorFor(op.path)
  const refused = wholeFileRefusal(editor)
  if (refused !== null) return no(refused)
  if (editor === null || governedClassOf(op.path) === null) return no(NOT_GOVERNED(op.path))
  try { assertWritablePath(repo, op.path) } catch (err) {
    return no(`${(err instanceof Error ? err.message : String(err)).replace(/^guardrail: /, 'Not staged: ')} Nothing was staged.`)
  }
  if (placeRefused(repo, op.path)) return no(NOT_GOVERNED(op.path))
  return []
}

/**
 * The half of the one check of where a path really is (T19 review I1, PF-R83) that the file system answers: true when
 * `path` lies under the private store's place in the repository (whatever the ignore rules say), when any segment of it
 * that exists is a link (a link file or a linked folder, wherever it points), or when the real place of the part that
 * exists is outside the repository. A segment that cannot be read for any reason but its absence is refused too.
 */
export function placeRefused(repo: string, path: string): boolean {
  const store = placeInRepo(repo, privateDir(repo))
  if (store !== null && (store === '' || path === store || path.startsWith(`${store}/`))) return true
  let at = repo
  let deepest = repo
  for (const seg of path.split('/')) {
    at = join(at, seg)
    try { if (lstatSync(at).isSymbolicLink()) return true } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') break
      return true
    }
    deepest = at
  }
  try {
    const root = realpathSync(repo)
    const real = realpathSync(deepest)
    return real !== root && !real.startsWith(root + sep)
  } catch { return true }
}

/** The other half, git's (async: this service's git runs through server/git.ts alone): a file that exists is one git
 *  tracks (an untracked file is no governed file yet, PF-R83); one that does not is at a path git does not ignore, so a
 *  new file may still be created where a file op makes one. Anything git cannot answer is refused. */
async function gitHolds(repo: string, path: string): Promise<boolean> {
  let exists = true
  try { lstatSync(join(repo, path)) } catch { exists = false }
  try {
    if (exists) { await assertTracked(repo, [path]); return true }
    return !(await isIgnored(repo, path))
  } catch { return false }
}

/** Whether `path` is one this service reads or writes at all (T19 review I1, M2; PF-R83): its real place is the
 *  repository's, through no link, not the private store's, and git holds it (or would, a file not made yet). A path that
 *  is not is answered as an ungoverned one, so nothing tells a viewer whether the file exists. */
export async function isHeld(repo: string, path: string): Promise<boolean> {
  return !placeRefused(repo, path) && await gitHolds(repo, path)
}

/** Each file op's path checked whole (`filePathErrors`, then git's half of `isHeld`): what the stage route asks before it
 *  stages and apply asks before it writes, so a file op on an ignored, untracked or linked path is refused early, in the
 *  ungoverned sentence, and nothing is written. */
export async function heldFileErrors(repo: string, ops: readonly FileOp[]): Promise<RecordError[]> {
  const out: RecordError[] = []
  for (const op of ops) {
    const path = filePathErrors(repo, op)
    if (path.length > 0) { out.push(...path); continue }
    if (!(await gitHolds(repo, op.path))) out.push({ record: op.path, field: 'path', message: NOT_GOVERNED(op.path) })
  }
  return out
}

/** DAO-OS L6 Task 20 review C1 (PF-R95): a page's file, `pages/<id>.md`. */
const PAGE_PATH = /^pages\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.md$/
/** What a file op that would write a page the private store keeps is told: the same words whoever reads them, so nothing
 *  says whether a private page holds that id. */
export const NO_PAGE_HERE = (id: string, nothing: string): string =>
  `There is no page ${id} in the repository for this edit to write: discard it. ${nothing}`

/**
 * The pages `ops` would write in git (a file op on `pages/<id>.md` with a text: a create, an edit or a replace) while the
 * private store keeps a page with that id (C1, PF-R95): a page that left the repository is never made again there by an op
 * staged before it left, or one built after. A file git holds now is no private page (a narrowing deletes it, a move
 * makes it only when the store gives it up), so only a page git does not hold is asked of the store; a store that cannot
 * be read then is taken to keep it (refused, never guessed). Without a store at all, none.
 */
export function keptPageIds(repo: string, store: { record(collection: string, id: string): unknown } | null, ops: readonly unknown[]): { path: string; id: string }[] {
  if (!store) return []
  const out: { path: string; id: string }[] = []
  for (const op of ops) {
    if (!isFileOp(op) || op.text === null) continue
    const m = PAGE_PATH.exec(op.path)
    if (!m || fileBase(repo, op.path) !== null) continue
    let kept: unknown
    try { kept = store.record('pages', m[1]!) } catch { kept = true }
    if (kept) out.push({ path: op.path, id: m[1]! })
  }
  return out
}

/** `keptPageIds` as the stage and apply routes answer it: one error per op, `nothing` ending its sentence. */
export function keptPageErrors(repo: string, store: { record(collection: string, id: string): unknown } | null, ops: readonly unknown[], nothing: string): RecordError[] {
  return keptPageIds(repo, store, ops).map(k => ({ record: k.path, field: '', message: NO_PAGE_HERE(k.id, nothing) }))
}

/** The registries whose entries decide who can propose under the written rules (L5 §7.6), as the record ops' lockout check
 *  (stage.ts `lockoutErrors`) reads them. */
const WHO_CAN_PROPOSE: Record<string, 'members' | 'systems'> = { 'data/members.yaml': 'members', 'data/systems.yaml': 'systems' }

/** A file op on the members or the systems (or a delete of either) that leaves a written rule with nobody able to propose
 *  under it (L5 §7.6, F-L3-1): each new error `checkGovernance` gives with the file as the op leaves it. */
function lockoutOfFile(repo: string, op: FileOp): RecordError[] {
  const registry = WHO_CAN_PROPOSE[op.path]
  if (registry === undefined) return []
  const governance = governanceOf(fileText(repo, 'data/governance.yaml'))
  if (governance === null) return []
  const def = REGISTRIES.find(d => d.name === registry)!
  let after: Entity[] | null
  try { after = op.text === null ? [] : entriesFromText(op.text, def) } catch { return [] }
  const ctx = { members: entriesNow(repo, 'members'), systems: entriesNow(repo, 'systems'), classes: CHANGE_CLASSES, live: true }
  const was = new Set(checkGovernance(governance, ctx).filter(p => p.level === 'error').map(problemsKey))
  return checkGovernance(governance, { ...ctx, [registry]: after }).filter(p => p.level === 'error' && !was.has(problemsKey(p)))
    .map(p => ({ record: op.path, field: '', message: p.message }))
}

/**
 * Everything wrong with a file op (§11.2), checked at stage and again at apply, as RecordErrors named by its path (`record`)
 * and, for a registry's entry, `<registry>:<id>` with the field. A check reads the file as it is now to refuse only what
 * the op brings: an entry, a governance or a visibility problem the file already holds is not refused again. A text that
 * would add anything stricter than members is refused here as the person's input (`assertGitSafe`'s problems as
 * RecordErrors, naming the field, never the value); a narrowing of data/visibility.yaml while git still holds the values
 * it restricts is refused and pointed to the narrow control.
 */
export function fileOpErrors(repo: string, op: FileOp): RecordError[] {
  const no = (message: string, field = ''): RecordError[] => [{ record: op.path, field, message }]
  const path = filePathErrors(repo, op)
  if (path.length > 0) return path
  const now = fileText(repo, op.path)
  if (op.text === null) {
    if (now === null) return no(NO_FILE(op.path), 'text')
    // A delete drops values: it never puts one in git.
    return [...lockoutOfFile(repo, op), ...CHECKS.flatMap(check => check(repo, op))]
  }
  const bytes = Buffer.byteLength(op.text, 'utf8')
  if (bytes > FILE_OP_MAX_BYTES) return no(TOO_BIG(op.path, bytes), 'text')

  const errors: RecordError[] = []
  if (/\.ya?ml$/.test(op.path)) {
    const doc = parseDocument(op.text)
    const [first] = doc.errors
    if (first) return no(NOT_YAML(op.path, first.message.split('\n')[0] ?? 'a fault'), 'text')
    // A registry file: each entry against its schema, refusing what the file did not hold before.
    const def = registryAt(repo, op.path)
    if (def && def.kind === 'collection' && !def.ledger) {
      const errorsOf = (text: string | null): RecordError[] => {
        if (text === null) return []
        let entries: Entity[]
        try { entries = entriesFromText(text, def) } catch (err) { return no(NOT_YAML(op.path, err instanceof Error ? err.message : String(err)), 'text') }
        return entries.flatMap((entry, i) => {
          const id = entry.id === undefined || entry.id === null ? `#${i + 1}` : String(entry.id)
          const overlay = (registry: string) => (registry === def.name ? entries : undefined)
          return validateEntity(repo, def.name, entry, overlay).errors.map(e => ({ record: `${def.name}:${id}`, field: e.field, message: e.message }))
        })
      }
      const before = new Set(errorsOf(now).map(e => `${e.record}\u0000${e.field}\u0000${e.message}`))
      errors.push(...errorsOf(op.text).filter(e => !before.has(`${e.record}\u0000${e.field}\u0000${e.message}`)))
    }
    if (op.path === 'data/governance.yaml') {
      const read = readGovernance(op.text)
      if (read.governance === null && read.problems.length > 0) return no(`data/governance.yaml ${read.problems[0]}`, 'text')
      const ctx = { members: entriesNow(repo, 'members'), systems: entriesNow(repo, 'systems'), classes: CHANGE_CLASSES, live: true }
      const was = new Set(checkGovernance(governanceOf(now), ctx).filter(p => p.level === 'error').map(problemsKey))
      for (const p of checkGovernance(governanceOf(op.text), ctx)) {
        if (p.level === 'error' && !was.has(problemsKey(p))) errors.push({ record: op.path, field: p.path, message: p.message })
      }
    }
    if (op.path === 'data/visibility.yaml') {
      const governance = governanceOf(fileText(repo, 'data/governance.yaml'))
      const roles = governance && typeof governance.roles === 'object' && governance.roles !== null ? Object.keys(governance.roles) : []
      const ctx = { registries: registriesOf(repo).map(d => d.name), roles, tree: membershipTree(governance, entriesNow(repo, 'systems'))?.tree ?? null }
      const docOf = (text: string | null) => { try { return text === null ? {} : parseDocument(text).toJS() } catch { return {} } }
      const was = new Set(checkVisibilityPolicy(docOf(now), ctx).filter(p => p.level === 'error').map(problemsKey))
      for (const p of checkVisibilityPolicy(docOf(op.text), ctx)) {
        if (p.level === 'error' && !was.has(problemsKey(p))) errors.push({ record: op.path, field: p.path, message: p.message })
      }
    }
  }
  errors.push(...lockoutOfFile(repo, op))
  errors.push(...narrowedInGit(repo, op))
  errors.push(...CHECKS.flatMap(check => check(repo, op)))
  if (errors.length > 0) return errors
  // Nothing stricter than members enters git (L5 §10.5), down to one field: named, never repeated. A value the person typed
  // is their input, answered 422 in words (coordinator ruling, Task 4 review); what the file already held is not refused
  // again (`before`), as the other checks do. Apply's own `assertGitSafe` stays the 500 backstop.
  return restrictedErrors(repo, { ...op, text: op.text })
}

/** `assertGitSafe`'s reading of a file op's text (`gitSafetyProblems`, the same function), against the file as it is
 *  (`before`), as RecordErrors: the path, the field, and its sentence naming the record and the field, never a value. */
function restrictedErrors(repo: string, op: FileOp & { text: string }): RecordError[] {
  const now = fileText(repo, op.path)
  const config = readConfig(repo)
  const key = (p: { path: string; record: string; field: string; message: string }) => JSON.stringify([p.path, p.record, p.field, p.message])
  const known = new Set(now === null ? [] : gitSafetyProblems(repo, [{ path: op.path, text: now }], config).map(key))
  return gitSafetyProblems(repo, [{ path: op.path, text: op.text }], config)
    .filter(p => !known.has(key(p)))
    .map(p => ({ record: op.path, field: p.field, message: `Not staged: ${p.message}, and git holds nothing stricter than members. Nothing was staged.` }))
}

/** The collection files git holds now, with their texts: what a new visibility policy is read against (custom collections'
 *  own files too, L6 ruling R-2b). */
function collectionFiles(repo: string): { path: string; text: string }[] {
  return registriesOf(repo).filter(d => d.kind === 'collection').flatMap(d => {
    const path = registryFileOf(d)
    const text = path === 'data/visibility.yaml' ? null : fileText(repo, path)
    return text === null ? [] : [{ path, text }]
  })
}

/** A file op on data/visibility.yaml that narrows a field (or a default) the repository still holds values of: those
 *  values would stay in git, stricter than members, and every later write of their file would be refused. L5's narrow
 *  control moves them to the private store first, so the file op is refused in words and points there. */
function narrowedInGit(repo: string, op: FileOp): RecordError[] {
  if (op.path !== 'data/visibility.yaml' || op.text === null) return []
  const next = policyOf(op.text)
  if (next === null) return []
  const files = collectionFiles(repo)
  const key = (p: { path: string; record: string; field: string }) => JSON.stringify([p.path, p.record, p.field])
  const was = new Set(gitSafetyProblems(repo, files, readConfig(repo)).map(key))
  const seen = new Set<string>()
  return gitSafetyProblems(repo, files, next).filter(p => !was.has(key(p))).flatMap(p => {
    const k = `${p.path}\u0000${p.field}`
    if (seen.has(k)) return []
    seen.add(k)
    return [{ record: op.path, field: p.field, message: NARROWED_IN_GIT(p.path, p.field) }]
  })
}

/** What a narrowing of data/visibility.yaml edited whole is told while git still holds the values it restricts. */
export const NARROWED_IN_GIT = (file: string, field: string): string =>
  `This would restrict ${field} in ${file}, which the repository still holds: narrow it with its visibility control, ` +
  'which moves those values to the private store first. Nothing was staged.'

/** The record ops a whole-file op on a collection registry's file amounts to, each with the entry it replaces (L6 §11.2,
 *  Task 4 review): a create for an entry it adds, a replace for one it changes, a delete for one it drops. What the record
 *  ops' rules judge (a widening, a wallet link put in git) is judged on these. A file that cannot be read gives none. */
export function recordDeltasOf(repo: string, op: StageOp | Op): { op: RecordOp; before: Entity | null }[] {
  if (!isFileOp(op)) return []
  const def = registryAt(repo, op.path)
  if (!def || def.kind !== 'collection' || def.ledger) return []
  const read = (text: string | null): Map<string, Entity> | null => {
    if (text === null) return new Map()
    try { return new Map(entriesFromText(text, def).filter(e => e.id !== undefined && e.id !== null).map(e => [String(e.id), e])) } catch { return null }
  }
  const was = read(fileText(repo, op.path))
  const now = read(op.text)
  if (was === null || now === null) return []
  const out: { op: RecordOp; before: Entity | null }[] = []
  for (const [id, value] of now) {
    const before = was.get(id) ?? null
    if (before === null) out.push({ op: { op: 'create', record: `${def.name}:${id}`, value }, before })
    else if (JSON.stringify(before) !== JSON.stringify(value)) out.push({ op: { op: 'replace', record: `${def.name}:${id}`, value }, before })
  }
  for (const [id, before] of was) if (!now.has(id)) out.push({ op: { op: 'delete', record: `${def.name}:${id}` }, before })
  return out
}

/** DAO-OS L6 §4.1 (Task 7): the git pages, `pages/<id>.md` (flat; attachments under pages/assets/ are not pages). A folder
 *  that cannot be read holds none. */
export function gitPages(repo: string): { id: string; text: string }[] {
  let names: string[]
  try { names = readdirSync(join(repo, 'pages')) } catch { return [] }
  return names.filter(n => PAGE_FILE_NAME.test(n)).flatMap(n => {
    try { return [{ id: n.slice(0, -3), text: readFileSync(join(repo, 'pages', n), 'utf8') }] } catch { return [] }
  })
}

/** Whether a file op widens what it writes (§11.2: it adds `publication`): data/visibility.yaml loosened, or a collection
 *  file whose records, as record ops, would widen (`widens`: a record made more public, a wallet link put in git). */
export function fileWidens(repo: string, op: StageOp | Op): boolean {
  if (fileLoosens(repo, op)) return true
  const config = readConfig(repo)
  // DAO-OS L6 §4.4, §13 (Task 7 review I2; Task 10): a page made public, or one whose subpages it makes public, and a canon
  // text that makes a knowledge object publishable (refused as a file op by PF-R1; judged all the same), are publications:
  // lib's `publishes`, read against the file as it is and, for a page, the git pages.
  if (isFileOp(op) && /^pages\/[^/]+\.md$/.test(op.path)) return publishes(op, fileText(repo, op.path), config, { pages: gitPages(repo) })
  if (isFileOp(op) && KNOWLEDGE_FILE.test(op.path)) return publishes(op, fileText(repo, op.path), config)
  return recordDeltasOf(repo, op).some(d => widens(d.op, d.before, config))
}

/** What GET /api/files answers for a collection's file whose entries cannot be read (T19 review M1). */
export const UNREADABLE = (path: string): string =>
  `${path} cannot be read as its entries, so whether every member may read it cannot be said, and it is not served whole here. Fix it in the repository first.`

/** What GET /api/files answers (L6 §16): a governed file as the source editor opens it. */
export interface FileView { path: string; text: string | null; base: string | null; class: string; editor: string }

/** The file at `path` for a member, or the HttpError that says why not: 400 for a path that is not plain, 404 for one no
 *  rule governs or this service does not hold (`isHeld`), 403 for a file holding a value data/visibility.yaml restricts (named by nothing: no value, no field). */
export async function readFileView(repo: string, path: string): Promise<FileView> {
  const editor = editorFor(path)
  const cls = governedClassOf(path)
  const ungoverned = () => new HttpError(404, `${path || 'That path'} is not a governed file, so it has no editor here.`)
  if (editor === null || (cls === null && editor !== 'ledger' && editor !== 'ratify')) throw ungoverned()
  // T19 review I1 (PF-R83): an ignored, untracked or linked path, or the store's place, is answered as an ungoverned one.
  if (!(await isHeld(repo, path))) throw ungoverned()
  const text = fileText(repo, path)
  // T19 review M1: a collection's file whose entries cannot be read cannot be judged by the visibility policy, so it is
  // refused in a sentence rather than served whole.
  const def = registryAt(repo, path)
  if (text !== null && def && def.kind === 'collection') {
    let read = parseDocument(text).errors.length === 0
    if (read) { try { entriesFromText(text, def) } catch { read = false } }
    if (!read) throw new HttpError(403, UNREADABLE(path))
  }
  if (text !== null && gitSafetyProblems(repo, [{ path, text }], readConfig(repo)).length > 0) {
    throw new HttpError(403, `${path} holds values that not every member may read, so it is not served whole here.`)
  }
  return { path, text, base: text === null ? null : blobId(text), class: cls ?? '', editor }
}

/** GET /api/editors and GET /api/files?path= (L6 §16). Both are members' reads: the public is refused before any route. */
export function mountFiles(app: Hono, { repo }: { repo: string }): void {
  app.get('/api/editors', c => c.json(EDITORS))
  app.get('/api/files', async c => {
    const path = c.req.query('path') ?? ''
    if (path === '' || path.startsWith('/') || path.split('/').some(s => s === '..' || s === '.' || s === '')) {
      throw new HttpError(400, 'GET /api/files takes ?path=<a path relative to the repository>, for example data/governance.yaml.')
    }
    return c.json(await readFileView(repo, path))
  })
}
