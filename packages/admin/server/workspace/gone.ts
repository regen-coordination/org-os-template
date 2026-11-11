// packages/admin/server/workspace/gone.ts
//
// Targets that are gone (DAO-OS L6 §8.2, controller ruling R-9a). A comment, a mention, a notification and a read have no
// level of their own: they follow their target's, found by its id. A page or record deleted and later made again under the
// same id (a slug id, or a narrowing that kept the id) would otherwise inherit them at its own, perhaps looser, level. So
// when the Hub deletes a page or a record, its conversation goes with it:
// - a private page or record: in the store's own delete, in the same transaction (store.ts `deleteRecordIn`);
// - a git page or record: once the commit that deletes it is made (`applyOps`, a ratify's merge), through the purger the
//   conversation routes register here. The purge waits its turn on the store's write lock, so it is never awaited inside
//   a transaction the caller holds. A thing the store keeps under that id by then (it moved there) keeps its rows.
// - a git page or record deleted by commits the Hub did not make (the Refresher's fast-forward of a read-only hosted Hub,
//   Sync's fast-forward or merge): once the trunk has moved, read along its first-parent line, each merge against its first
//   parent (`goneBetween`). What the line deleted takes its conversation when it is gone at the end, or there again at a
//   wider level than it had (R2 review Rule 4; R2b I-1): one deleted and restored at its level keeps it;
// - the store down at that moment: a tombstone (the target and when it went) is kept in the server's state directory, and
//   applied the moment the store is reached again, before any conversation is read or written: every row on the target
//   goes (none can be newer: nothing is written to a store that is down, and the tombstone goes first when it is back).
// The state directory is outside git; a tombstone names only git pages and records (with the store down nothing private
// can be deleted), whose ids members may read.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { registriesOf, registryFileOf } from '../registries.ts'
import { entriesFromText } from '../registry.ts'
import { stateDir } from '../state.ts'
import { parse as parseYaml } from 'yaml'
import { resolveRev, showFile, treeDiffNames, trunkLine } from '../git.ts'
import { fullLevel, narrowerOrEqual, readFullPolicy, type ParsedLevel } from '../../lib/visibility.mjs'
import { pageEntries, pageLevel, PRIVATE_PAGE_ID } from '../../lib/workspace/pages.mjs'
import type { VisibilityPolicy } from '../visibility/config.ts'
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

/** Resolves once every purge queued for `repo` has run (tests; the server's stop). */
export async function goneSettled(repo: string): Promise<void> {
  const set = pending.get(resolve(repo))
  while (set && set.size > 0) await Promise.all([...set])
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

/** One commit of the trunk's first-parent line, read against its first parent: the paths it added (A), modified (M) or
 *  deleted (D). A rename is a delete and an add (R2b review M-3, accepted). */
interface LineStep { commit: string; changes: { status: string; path: string }[] }
/** A file's text at a revision; null when the revision does not hold it. */
type TextAt = (rev: string, rel: string) => Promise<string | null>

const EMPTY_POLICY = Object.freeze({ collections: {}, defaults: {} }) as unknown as VisibilityPolicy

/** What the trunk's first-parent line `from..to` deleted, each commit (a merge too) read against its first parent: a page
 *  file removed, or a collection's entry left out. A side branch's own commits are not read: what its merge brought is the
 *  merge's diff, so a branch merged with `-s ours`, or a delete its own later commit undid, deletes nothing.
 *  A target deleted on the line is purged only when it is absent at `to`, or there at a level looser than one it had before:
 *  at `from`, or just before each delete (rule R-9a's risk is a conversation inheriting a wider level; one kept at the same
 *  level, or a narrower one, keeps its conversation). A level that cannot be read is no reason to keep it.
 *  The collections are the ones the tree defines now. */
async function goneOnLine(repo: string, from: string, to: string, steps: readonly LineStep[], textAt: TextAt): Promise<string[]> {
  const defs = registriesOf(repo).filter(d => d.kind === 'collection' && d.filesGlob === undefined)
  const byFile = new Map(defs.map(d => [registryFileOf(d), d]))
  const pages = new Map<string, { commit: string; status: string }[]>()
  const files = new Map<string, { commit: string; status: string }[]>()
  for (const step of steps) {
    for (const ch of step.changes) {
      const page = PAGE_FILE.exec(ch.path)
      const into = page ? pages : byFile.has(ch.path) ? files : null
      if (!into) continue
      const key = page ? page[1]! : ch.path
      into.set(key, [...(into.get(key) ?? []), { commit: step.commit, status: ch.status }])
    }
  }
  const levels = new LevelsAt(textAt)
  /** Whether the level `now` admits nobody that every level of `before` did not. */
  const keeps = (now: ParsedLevel | null, before: readonly (ParsedLevel | null)[]) =>
    now !== null && before.every(b => b !== null && narrowerOrEqual(now, b))
  const out: string[] = []
  for (const [id, events] of pages) {
    const deletes = events.filter(e => e.status === 'D')
    if (deletes.length === 0) continue
    const target = `page:${id}`
    if (events[events.length - 1]!.status === 'D') { out.push(target); continue }
    const revs = [...(events[0]!.status !== 'A' ? [from] : []), ...deletes.map(d => `${d.commit}^`)]
    const before: (ParsedLevel | null)[] = []
    for (const rev of revs) before.push(await levels.page(rev, id))
    if (!keeps(await levels.page(to, id), before)) out.push(target)
  }
  for (const [rel, events] of files) {
    const def = byFile.get(rel)!
    const read = (text: string | null): Map<string, Record<string, unknown>> | null => {
      if (text === null) return new Map()
      try { return new Map(entriesFromText(text, def).map(e => [String(e.id), e as Record<string, unknown>])) } catch { return null }
    }
    // A version that cannot be read is passed over: its neighbours are compared (no purge on a guess, no delete missed).
    const atFrom = events[0]!.status === 'A' ? new Map<string, Record<string, unknown>>() : read(await textAt(from, rel))
    let last = atFrom
    const removed = new Map<string, { rev: string; entry: Record<string, unknown> }[]>()
    for (const e of events) {
      const next = e.status === 'D' ? new Map<string, Record<string, unknown>>() : read(await textAt(e.commit, rel))
      if (next === null) { if (e === events[events.length - 1]) last = null; continue }
      if (last !== null) {
        for (const [eid, entry] of last) if (!next.has(eid)) removed.set(eid, [...(removed.get(eid) ?? []), { rev: `${e.commit}^`, entry }])
      }
      last = next
    }
    for (const [eid, gone] of removed) {
      const target = `record:${def.name}:${eid}`
      const now = last?.get(eid)
      if (!now) { out.push(target); continue }
      const was = [...(atFrom?.has(eid) ? [{ rev: from, entry: atFrom.get(eid)! }] : []), ...gone]
      const before: (ParsedLevel | null)[] = []
      for (const w of was) before.push(await levels.record(w.rev, def.name, w.entry))
      if (!keeps(await levels.record(to, def.name, now), before)) out.push(target)
    }
  }
  return out
}

/** Levels as a revision of the tree held them: data/visibility.yaml and the pages' own levels and parents at that
 *  revision. A private parent page reads as `pageLevel` reads it now. Null: a level this cannot say. */
class LevelsAt {
  private readonly policies = new Map<string, VisibilityPolicy>()
  constructor(private readonly textAt: TextAt) {}

  private async policy(rev: string): Promise<VisibilityPolicy> {
    let p = this.policies.get(rev)
    if (!p) {
      const text = await this.textAt(rev, 'data/visibility.yaml')
      try { p = text === null ? EMPTY_POLICY : (readFullPolicy(parseYaml(text)).policy as VisibilityPolicy) } catch { p = EMPTY_POLICY }
      this.policies.set(rev, p)
    }
    return p
  }

  /** The page's level at `rev` (its own, else its parents', else the pages' default), null when no page has that id there. */
  async page(rev: string, id: string): Promise<ParsedLevel | null> {
    const chain: { id: string; text: string }[] = []
    const seen = new Set<string>()
    let at: string | null = id
    while (at !== null && !seen.has(at) && !PRIVATE_PAGE_ID.test(at)) {
      seen.add(at)
      const text = await this.textAt(rev, `pages/${at}.md`)
      if (text === null) break
      chain.push({ id: at, text })
      const e = pageEntries([{ id: at, text }], []).get(at)
      at = e && (e.own === undefined || e.own === null) ? e.parent : null
    }
    if (chain.length === 0 || chain[0]!.id !== id) return null
    return pageLevel(id, pageEntries(chain, []), await this.policy(rev)) as ParsedLevel
  }

  /** A git record's level at `rev`. A proposal's depends on what its ops touch, so it is not read here (null). */
  async record(rev: string, registry: string, entry: Record<string, unknown>): Promise<ParsedLevel | null> {
    if (registry === 'proposals') return null
    return fullLevel(await this.policy(rev), registry, entry) as ParsedLevel
  }
}

/** The targets the trunk's first-parent line `from..to` deleted and that must take their conversation (`goneOnLine`). A
 *  commit or file git cannot read says nothing. */
export async function goneBetween(repo: string, from: string, to: string): Promise<string[]> {
  if (from === to) return []
  const collections = new Set(registriesOf(repo).filter(d => d.kind === 'collection').map(d => registryFileOf(d)))
  const textAt = async (rev: string, rel: string): Promise<string | null> => {
    try { return await showFile(repo, rev, rel) } catch { return null }
  }
  const steps: LineStep[] = []
  for (const commit of await trunkLine(repo, from, to)) {
    const parent = await resolveRev(repo, `${commit}^`)
    if (parent === null) continue
    const changes: LineStep['changes'] = []
    for (const rel of (await treeDiffNames(repo, parent, commit)).filter(r => PAGE_FILE.test(r) || collections.has(r))) {
      const [was, now] = [await textAt(parent, rel), await textAt(commit, rel)]
      changes.push({ status: was === null ? 'A' : now === null ? 'D' : 'M', path: rel })
    }
    steps.push({ commit, changes })
  }
  return goneOnLine(repo, from, to, steps, textAt)
}

/** After the trunk moved from `from` to `to` by commits the Hub did not make: queue the purge of what they deleted, of
 *  what was written at or before `at`, the time taken before the move (R2b I-2). Never throws (the move stands, and a
 *  failure is said on the console). */
export async function trunkMoved(repo: string, from: string | null, to: string | null, at: Date): Promise<void> {
  if (from === null || to === null || from === to) return
  try { targetsGone(repo, await goneBetween(repo, from, to), at) } catch (err) {
    console.error(`org-os admin: what the commits ${from.slice(0, 7)}..${to.slice(0, 7)} deleted could not be read: ${err instanceof Error ? err.message : String(err)}`)
  }
}

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
