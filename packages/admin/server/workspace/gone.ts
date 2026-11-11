// packages/admin/server/workspace/gone.ts
//
// Targets that are gone (DAO-OS L6 §8.2, controller ruling R-9a), and the conversation's housekeeping (PR7-R45). A comment,
// a mention and a notification keep the level their target had when they were written, and are read only by a viewer
// admitted to it and to the target's level now (written.ts): that is the privacy guard, whatever moves the trunk. What is
// here only keeps the store tidy: talk on a target that is not there any more goes.
// - a private page or record deleted: in the store's own delete, in the same transaction (store.ts `deleteRecordIn`);
// - a git page or record deleted by the Hub: once the commit that deletes it is made (`applyOps`, a ratify's merge), through
//   the purger the conversation routes register here. The purge waits its turn on the store's write lock, so it is never
//   awaited inside a transaction the caller holds. A thing the store keeps under that id by then (it moved there) keeps
//   its rows;
// - after each trunk move by commits the Hub did not make (the Refresher's fast-forward of a read-only hosted Hub, Sync's
//   fast-forward or merge), and at the start: the housekeeper the conversation routes register lists the store's targets
//   and purges those that do not exist in the tree or the store now (`trunkMoved`, `housekeepAtStart`). No history is read:
//   a mistake can only leave rows behind, or take those of a target that is gone;
// - the store down at the moment of a Hub delete: a tombstone (the target and when it went) is kept in the server's state
//   directory, and applied the moment the store is reached again, before any conversation is read or written.
// The state directory is outside git; a tombstone names only git pages and records (with the store down nothing private
// can be deleted), whose ids members may read.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { registriesOf, registryFileOf } from '../registries.ts'
import { entriesFromText } from '../registry.ts'
import { stateDir } from '../state.ts'
import type { StageOp } from '../changes/types.ts'

/** What hears that git targets are gone, per repository: the conversation routes' purger (`mountConversation`). */
type Purger = (targets: string[], at: string) => Promise<void>
const purgers = new Map<string, Purger>()
const pending = new Map<string, Set<Promise<unknown>>>()

export function onTargetsGone(repo: string, fn: Purger): void { purgers.set(resolve(repo), fn) }

/** `targets` (`page:<id>`, `record:<registry>:<id>`) are gone from git. Never throws and never waits: the purge is queued. */
export function targetsGone(repo: string, targets: readonly string[], at: Date = new Date()): void {
  const fn = purgers.get(resolve(repo))
  if (!fn || targets.length === 0) return
  const key = resolve(repo)
  const set = pending.get(key) ?? new Set()
  pending.set(key, set)
  const p = fn([...new Set(targets)], at.toISOString())
    .catch(err => console.error(`org-os admin: the conversation of ${targets.join(', ')} could not be removed: ${err instanceof Error ? err.message : String(err)}`))
    .finally(() => set.delete(p))
  set.add(p)
}

/** Resolves once every purge and housekeeping job queued for `repo` has run (tests; the server's stop). */
export async function goneSettled(repo: string): Promise<void> {
  const key = resolve(repo)
  for (;;) {
    const job = jobs.get(key)
    await job
    const set = pending.get(key)
    if (set && set.size > 0) { await Promise.all([...set]); continue }
    if (jobs.get(key) === job) return
  }
}

const PAGE_FILE = /^pages\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.md$/

/** The targets a set of file writes deletes: a page file removed, and each entry of a collection's file that the write
 *  leaves out. A file that cannot be read before or after says nothing (no purge on a guess). */
export function goneOfFiles(repo: string, files: readonly { rel: string; before: Buffer | string | null; text: string | null }[]): string[] {
  const defs = registriesOf(repo).filter(d => d.kind === 'collection')
  const out: string[] = []
  for (const f of files) {
    if (f.before === null) continue
    const page = PAGE_FILE.exec(f.rel)
    if (page) { if (f.text === null) out.push(`page:${page[1]}`); continue }
    const def = defs.find(d => registryFileOf(d) === f.rel)
    if (!def) continue
    try {
      const ids = (text: string) => new Set(entriesFromText(text, def).map(e => String(e.id)))
      const was = ids(f.before.toString())
      const now = f.text === null ? new Set<string>() : ids(f.text)
      for (const id of was) if (!now.has(id)) out.push(`record:${def.name}:${id}`)
    } catch { /* unreadable: nothing is purged */ }
  }
  return out
}

/** The targets `ops` delete from git, read before they are applied (a ratify's, whose merge writes them). */
export function goneOfOps(repo: string, ops: readonly StageOp[]): string[] {
  const out: string[] = []
  const files: { rel: string; before: string | null; text: string | null }[] = []
  for (const op of ops) {
    if (op.op === 'delete') out.push(`record:${op.record}`)
    else if (op.op === 'file') {
      let before: string | null = null
      try { before = existsSync(join(repo, op.path)) ? readFileSync(join(repo, op.path), 'utf8') : null } catch { before = null }
      files.push({ rel: op.path, before, text: op.text })
    }
  }
  return [...out, ...goneOfFiles(repo, files)]
}

// ── the housekeeping (PR7-R45) ───────────────────────────────────────────────────────────────────────

/** What purges the talk of targets that are not there now, per repository: the conversation routes' (`mountConversation`). */
type Housekeeper = () => Promise<void>
const keepers = new Map<string, Housekeeper>()
const jobs = new Map<string, Promise<void>>()

export function onHousekeeping(repo: string, fn: Housekeeper): void { keepers.set(resolve(repo), fn) }

/** The housekeeping, queued after every job queued for `repo` before it; a failure is said on the console and ends only
 *  that job (the next move or start runs it again). Resolves when it has run. */
function queue(repo: string, why: string): Promise<void> {
  const key = resolve(repo)
  const next = (jobs.get(key) ?? Promise.resolve()).then(async () => {
    const fn = keepers.get(key)
    if (fn) await fn()
  }).catch(err => {
    console.error(`org-os admin: the conversation of targets that are gone could not be removed ${why}; the next move or start tries again: ${err instanceof Error ? err.message : String(err)}`)
  })
  jobs.set(key, next)
  return next
}

/** After the trunk moved by commits the Hub did not make (the Refresher, Sync): the housekeeping is queued. Never throws and
 *  never waits: it runs after the caller (Sync, under the write lock) goes on. */
export function trunkMoved(repo: string): void { void queue(repo, 'after the trunk moved') }

/** At the server's start: the housekeeping is queued (a page deleted while the server was down takes its talk). Resolves
 *  when it has run. */
export function housekeepAtStart(repo: string): Promise<void> { return queue(repo, 'at the start') }

// ── tombstones, while the store is down ──────────────────────────────────────────────────────────────

export interface Tombstone { target: string; at: string }
const tombFile = (repo: string) => join(stateDir(repo), 'conversation-gone.json')

/** The tombstones not yet applied. */
export function tombstones(repo: string): Tombstone[] {
  try {
    const raw = JSON.parse(readFileSync(tombFile(repo), 'utf8')) as { gone?: unknown }
    return Array.isArray(raw.gone) ? raw.gone.filter((t): t is Tombstone => typeof t?.target === 'string' && typeof t?.at === 'string') : []
  } catch { return [] }
}

function writeTombs(repo: string, list: Tombstone[]): void {
  const file = tombFile(repo)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ gone: list }, null, 2)}\n`)
  renameSync(tmp, file)
}

/** Keeps a tombstone for each target (the latest time wins). */
export function bury(repo: string, targets: readonly string[], at: string): void {
  const kept = new Map(tombstones(repo).map(t => [t.target, t]))
  for (const target of targets) {
    const was = kept.get(target)
    if (!was || was.at < at) kept.set(target, { target, at })
  }
  writeTombs(repo, [...kept.values()])
}

/** The tombstones applied: removed from the file (one buried again since is kept). */
export function unbury(repo: string, applied: readonly Tombstone[]): void {
  const done = new Map(applied.map(t => [t.target, t.at]))
  const left = tombstones(repo).filter(t => done.get(t.target) !== t.at)
  if (left.length === 0 && !existsSync(tombFile(repo))) return
  writeTombs(repo, left)
}
