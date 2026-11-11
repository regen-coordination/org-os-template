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
//   wider level than it had (R2 review Rule 4; R2b I-1): one deleted and restored at its level keeps it. And what is there
//   at the end at a looser level than at the start takes it too, deleted or not (Rule 4 as amended, PR7-R32): a delete and
//   re-make on a side branch merged in, an edit of a level in git, a parent page or the policy loosened. A widening made in
//   the Hub asks first and keeps the conversation (its commits move the cursor, below); one made outside asked nobody;
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
import { firstParentChanges, isAncestor, mergeBase, namesAt, onCommit, resolveRev, showFile, type LineStep } from '../git.ts'
import { fullLevel, narrowerOrEqual, readFullPolicy, type ParsedLevel } from '../../lib/visibility.mjs'
import { pageEntries, pageLevel, PRIVATE_PAGE_ID } from '../../lib/workspace/pages.mjs'
import type { VisibilityPolicy } from '../visibility/config.ts'
import type { StageOp } from '../changes/types.ts'

/** What hears that git targets are gone, per repository: the conversation routes' purger (`mountConversation`). */
type Purger = (targets: string[], at: string) => Promise<void>
const purgers = new Map<string, Purger>()
const pending = new Map<string, Set<Promise<unknown>>>()

export function onTargetsGone(repo: string, fn: Purger): void { purgers.set(resolve(repo), fn); watched.add(resolve(repo)) }

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

/** Resolves once every purge and cursor job queued for `repo` has run (tests; the server's stop). */
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

/** A file's text at a revision; null when the revision does not hold it. */
type TextAt = (rev: string, rel: string) => Promise<string | null>
/** The page ids a revision holds. */
type PagesAt = (rev: string) => Promise<string[]>

const POLICY_FILE = 'data/visibility.yaml'

const EMPTY_POLICY = Object.freeze({ collections: {}, defaults: {} }) as unknown as VisibilityPolicy

/** What the trunk's first-parent line `from..to` deleted, each commit (a merge too) read against its first parent: a page
 *  file removed, or a collection's entry left out. A side branch's own commits are not read: what its merge brought is the
 *  merge's diff, so a branch merged with `-s ours`, or a delete its own later commit undid, deletes nothing.
 *  A target deleted on the line is purged only when it is absent at `to`, or there at a level looser than one it had on the
 *  line: at `from`, after each change, or just before each delete (rule R-9a's risk is a conversation inheriting a wider
 *  level; one kept at the same level, or a narrower one, keeps its conversation). A level that cannot be read is no reason
 *  to keep it.
 *  And a target the line did not delete, there at `to`, is purged when its level at `to` is looser than one it held on the
 *  line (Rule 4 as amended, PR7-R32; T2c I-c: the strictest of `from`'s and each revision's where it changed, so a cursor
 *  that lagged past a narrowing the Hub served, public → stewards → public, misses none): a page or an entry changed on the
 *  line; every subpage when a page it may inherit from went looser (or went, leaving its subpages the pages' default), read
 *  at `from` and at each commit that changed such a page or the policy; every page and entry when the policy file moved,
 *  entries read too as each policy change found them. Here a level that cannot be read (a proposal's) keeps it: nothing
 *  was deleted, so no purge on a guess.
 *  The collections are the ones the tree defines now. */
async function goneOnLine(repo: string, from: string, to: string, steps: readonly LineStep[], textAt: TextAt, pagesAt: PagesAt): Promise<string[]> {
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
  const policyCommits = steps.filter(step => step.changes.some(ch => ch.path === POLICY_FILE)).map(step => step.commit)
  const policyMoved = policyCommits.length > 0
  const levels = new LevelsAt(textAt)
  /** Whether the level `now` admits nobody that every level of `before` did not. */
  const keeps = (now: ParsedLevel | null, before: readonly (ParsedLevel | null)[]) =>
    now !== null && before.every(b => b !== null && narrowerOrEqual(now, b))
  /** Whether a target there at `to` at `now` is looser than a level it held (`held`); a level not read says no. */
  const widened = (held: readonly (ParsedLevel | null)[], now: ParsedLevel | null) => now !== null && held.some(b => b !== null && !narrowerOrEqual(now, b))
  const out: string[] = []
  // Whether a subpage that inherits may have moved with a page it inherits from: its level is that page's, or the pages'
  // default under a parent that is not there, so only a page read looser at `to` than at a revision it held (or the
  // policy) moves it; such a subpage is read at `from` and at each commit that changed such a page or the policy.
  let reach = policyMoved
  const reachRevs = new Set(policyCommits)
  for (const [id, events] of pages) {
    const deletes = events.filter(e => e.status === 'D')
    const target = `page:${id}`
    const atFrom = events[0]!.status !== 'A'
    const atTo = events[events.length - 1]!.status !== 'D'
    // Each revision of the line at which the page was there: `from`, after each change that left it, before each delete.
    const revs = [...(atFrom ? [from] : []), ...events.filter(e => e.status !== 'D').map(e => e.commit), ...deletes.map(d => `${d.commit}^`)]
    const held: (ParsedLevel | null)[] = []
    for (const rev of revs) held.push(await levels.page(rev, id))
    const now = atTo ? await levels.page(to, id) : null
    const was = atFrom ? held : [await levels.pagesDefault(from), ...held]
    if (!keeps(atTo ? now : await levels.pagesDefault(to), was)) {
      reach = true
      for (const e of events) reachRevs.add(e.commit)
    }
    if (deletes.length === 0) { if (widened(held, now)) out.push(target); continue }
    if (!atTo) { out.push(target); continue }
    if (!keeps(now, held)) out.push(target)
  }
  if (reach) {
    const revs = [from, ...reachRevs]
    for (const id of await pagesAt(to)) {
      if (pages.has(id)) continue // read above
      const held: (ParsedLevel | null)[] = []
      for (const rev of revs) held.push(await levels.page(rev, id))
      if (widened(held, await levels.page(to, id))) out.push(`page:${id}`)
    }
  }
  const recordFiles = policyMoved ? [...byFile.keys()] : [...files.keys()]
  for (const rel of recordFiles) {
    const events = files.get(rel) ?? []
    const def = byFile.get(rel)!
    const read = (text: string | null): Map<string, Record<string, unknown>> | null => {
      if (text === null) return new Map()
      try { return new Map(entriesFromText(text, def).map(e => [String(e.id), e as Record<string, unknown>])) } catch { return null }
    }
    /** Each version of each entry the line held, with the revision it was read at (T2c I-c). */
    const held = new Map<string, { rev: string; entry: Record<string, unknown> }[]>()
    const hold = (rev: string, versions: Map<string, Record<string, unknown>>, always: boolean) => {
      for (const [eid, entry] of versions) {
        const list = held.get(eid) ?? []
        const prior = list[list.length - 1]
        if (always || prior === undefined || JSON.stringify(prior.entry) !== JSON.stringify(entry)) list.push({ rev, entry })
        held.set(eid, list)
      }
    }
    // A version that cannot be read is passed over: its neighbours are compared (no purge on a guess, no delete missed).
    const atFrom = events[0]?.status === 'A' ? new Map<string, Record<string, unknown>>() : read(await textAt(from, rel))
    if (atFrom !== null) hold(from, atFrom, true)
    let last = events.length === 0 ? read(await textAt(to, rel)) : atFrom
    const removed = new Map<string, { rev: string; entry: Record<string, unknown> }[]>()
    for (const e of events) {
      const next = e.status === 'D' ? new Map<string, Record<string, unknown>>() : read(await textAt(e.commit, rel))
      if (next === null) { if (e === events[events.length - 1]) last = null; continue }
      if (last !== null) {
        for (const [eid, entry] of last) if (!next.has(eid)) removed.set(eid, [...(removed.get(eid) ?? []), { rev: `${e.commit}^`, entry }])
      }
      hold(e.commit, next, false)
      last = next
    }
    // Each move of the policy: the entries as the file held them then, under it.
    for (const commit of policyCommits) {
      const then = read(await textAt(commit, rel))
      if (then !== null) hold(commit, then, true)
    }
    const levelsOf = async (versions: readonly { rev: string; entry: Record<string, unknown> }[]) => {
      const out: (ParsedLevel | null)[] = []
      for (const v of versions) out.push(await levels.record(v.rev, def.name, v.entry))
      return out
    }
    for (const [eid, gone] of removed) {
      const target = `record:${def.name}:${eid}`
      const now = last?.get(eid)
      if (!now) { out.push(target); continue }
      if (!keeps(await levels.record(to, def.name, now), await levelsOf([...(held.get(eid) ?? []), ...gone]))) out.push(target)
    }
    if (last === null) continue
    for (const [eid, now] of last) {
      if (removed.has(eid)) continue
      const versions = held.get(eid) ?? []
      if (versions.length === 0) continue
      if (widened(await levelsOf(versions), await levels.record(to, def.name, now))) out.push(`record:${def.name}:${eid}`)
    }
  }
  return out
}

/** Levels as a revision of the tree held them: data/visibility.yaml and the pages' own levels and parents at that
 *  revision. A private parent page reads as `pageLevel` reads it now. Null: a level this cannot say. */
class LevelsAt {
  private readonly policies = new Map<string, VisibilityPolicy>()
  private readonly texts = new Map<string, Promise<string | null>>()
  private readonly textAt: TextAt
  /** Each file read once per revision. */
  constructor(textAt: TextAt) {
    this.textAt = (rev, rel) => {
      const key = `${rev}\0${rel}`
      let t = this.texts.get(key)
      if (!t) { t = textAt(rev, rel); this.texts.set(key, t) }
      return t
    }
  }

  private async policy(rev: string): Promise<VisibilityPolicy> {
    let p = this.policies.get(rev)
    if (!p) {
      const text = await this.textAt(rev, POLICY_FILE)
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

  /** The level a page reads at `rev` under a parent that is not there, or with no level of its own and no parent. */
  async pagesDefault(rev: string): Promise<ParsedLevel> {
    return fullLevel(await this.policy(rev), 'pages', null) as ParsedLevel
  }

  /** A git record's level at `rev`. A proposal's depends on what its ops touch, so it is not read here (null). */
  async record(rev: string, registry: string, entry: Record<string, unknown>): Promise<ParsedLevel | null> {
    if (registry === 'proposals') return null
    return fullLevel(await this.policy(rev), registry, entry) as ParsedLevel
  }
}

/** A file's text at a revision: null when the revision does not hold it (rev-parse says so); a read git cannot make throws
 *  (R2b I-3: an error is not an absence, so the purge cursor stays and the next run reads again). */
const textAtOf = (repo: string): TextAt => async (rev, rel) => ((await resolveRev(repo, `${rev}:${rel}`)) === null ? null : showFile(repo, rev, rel))

/** The page ids a commit holds (PR7-R32: the subpages a looser page or policy may reach), in one git process. */
const pagesAtOf = (repo: string): PagesAt => async rev => {
  const commit = HEX40.test(rev) ? rev : await resolveRev(repo, `${rev}^{commit}`)
  if (commit === null) return []
  return (await namesAt(repo, commit, 'pages/')).flatMap(name => { const m = PAGE_FILE.exec(name); return m ? [m[1]!] : [] })
}

/** The targets the trunk's first-parent line `from..to` deleted and that must take their conversation (`goneOnLine`),
 *  the line read in one git process (R2b I-4; a rename is a delete and an add, M-3 accepted). A read git cannot make
 *  throws. */
export async function goneBetween(repo: string, from: string, to: string): Promise<string[]> {
  if (from === to) return []
  const files = registriesOf(repo).filter(d => d.kind === 'collection' && d.filesGlob === undefined).map(d => registryFileOf(d))
  const steps = await firstParentChanges(repo, from, to, ['pages/', POLICY_FILE, ...new Set(files)])
  return goneOnLine(repo, from, to, steps, textAtOf(repo), pagesAtOf(repo))
}

/** What the line `steps` (`to..cursor`, a line the trunk at `to` does not hold) changed, compared at `cursor` and at `to`
 *  (T2c I-b): a page or an entry there at the cursor that is absent at `to`, or there at a looser level, is purged. Every
 *  page at the cursor is compared when a changed page reads looser at `to` (or went) or the policy moved; every entry of
 *  every collection when the policy moved. That line's versions were taken away, as a delete takes them: a level that
 *  cannot be read (a proposal's) purges an entry that differs, and a file at `to` that cannot be read purges what the
 *  cursor's held. A file the cursor's version cannot be read from says nothing. */
async function goneOffLine(repo: string, cursor: string, to: string, steps: readonly LineStep[], textAt: TextAt, pagesAt: PagesAt): Promise<string[]> {
  const defs = registriesOf(repo).filter(d => d.kind === 'collection' && d.filesGlob === undefined)
  const byFile = new Map(defs.map(d => [registryFileOf(d), d]))
  const pageIds = new Set<string>()
  const changedFiles = new Set<string>()
  let policyMoved = false
  for (const step of steps) {
    for (const ch of step.changes) {
      const page = PAGE_FILE.exec(ch.path)
      if (page) pageIds.add(page[1]!)
      else if (byFile.has(ch.path)) changedFiles.add(ch.path)
      else if (ch.path === POLICY_FILE) policyMoved = true
    }
  }
  const levels = new LevelsAt(textAt)
  /** Whether a target there at the cursor at `was` is absent at `to` (null) or looser there. */
  const looser = (was: ParsedLevel, now: ParsedLevel | null) => now === null || !narrowerOrEqual(now, was)
  const out: string[] = []
  let reach = policyMoved
  for (const id of pageIds) {
    const was = await levels.page(cursor, id)
    const now = await levels.page(to, id)
    if (!reach && looser(was ?? await levels.pagesDefault(cursor), now ?? await levels.pagesDefault(to))) reach = true
    if (was !== null && looser(was, now)) out.push(`page:${id}`)
  }
  if (reach) {
    for (const id of await pagesAt(cursor)) {
      if (pageIds.has(id)) continue // read above
      const was = await levels.page(cursor, id)
      if (was !== null && looser(was, await levels.page(to, id))) out.push(`page:${id}`)
    }
  }
  for (const rel of policyMoved ? [...byFile.keys()] : [...changedFiles]) {
    const def = byFile.get(rel)!
    const read = (text: string | null): Map<string, Record<string, unknown>> | null => {
      if (text === null) return new Map()
      try { return new Map(entriesFromText(text, def).map(e => [String(e.id), e as Record<string, unknown>])) } catch { return null }
    }
    const atCursor = read(await textAt(cursor, rel))
    if (atCursor === null) continue
    const atTo = read(await textAt(to, rel))
    for (const [eid, entry] of atCursor) {
      const target = `record:${def.name}:${eid}`
      const now = atTo?.get(eid)
      if (now === undefined) { out.push(target); continue }
      if (!policyMoved && JSON.stringify(entry) === JSON.stringify(now)) continue
      const was = await levels.record(cursor, def.name, entry)
      if (was === null || looser(was, await levels.record(to, def.name, now))) out.push(target)
    }
  }
  return out
}

/** At the start, a cursor that is not an ancestor of the trunk `to` (T2c I-b: the trunk rewound, or moved to another line,
 *  while the server was down). What the cursor's own line changed past the trunk's (`to..cursor`, read as the trunk's line
 *  is) is compared at the cursor and at `to` (`goneOffLine`), and the trunk's line is read from the merge-base as any move
 *  is (`goneOnLine`). With no merge-base only the first is read. A read git cannot make throws. */
export async function goneAcross(repo: string, cursor: string, to: string): Promise<string[]> {
  const files = registriesOf(repo).filter(d => d.kind === 'collection' && d.filesGlob === undefined).map(d => registryFileOf(d))
  const paths = ['pages/', POLICY_FILE, ...new Set(files)]
  const textAt = textAtOf(repo), pagesAt = pagesAtOf(repo)
  const out = await goneOffLine(repo, cursor, to, await firstParentChanges(repo, to, cursor, paths), textAt, pagesAt)
  const base = await mergeBase(repo, cursor, to)
  if (base !== null && base !== to) out.push(...await goneOnLine(repo, base, to, await firstParentChanges(repo, base, to, paths), textAt, pagesAt))
  return [...new Set(out)]
}

// ── the purge cursor (R2b I-3) ─────────────────────────────────────────────────────────────────────────
// The last trunk commit whose deletions are fully purged (or buried), kept in the admin state directory beside the
// tombstones. Every move by commits the Hub did not make (`trunkMoved`), and every start (`trunkAtStart`), reads from it to
// the trunk, and it advances only once the targets are purged or buried: a read git cannot make leaves it where it is, and
// the next move or start reads again; a trunk moved while the server was down is read at the start. With no cursor yet, the
// start sets it to the trunk: a fresh install purges nothing retroactively. The Hub's own commits (`onCommit`) move it on
// when it stands at their parent: what they delete is purged where they are made (applyOps, a ratify), and read again it
// would take the talk of a page the Hub made again after. Sync's merge commit is the Hub's but brings what it did not make:
// it is made inside `outsideMove`, so the cursor leaves it to `trunkMoved` (T2c I-a). One job at a time per repository,
// outside the write lock.

const cursorFile = (repo: string) => join(stateDir(repo), 'conversation-cursor.json')
const HEX40 = /^[0-9a-f]{40}$/

/** The purge cursor, or null when there is none (or it cannot be read). */
export function purgeCursor(repo: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(cursorFile(repo), 'utf8')) as { commit?: unknown }
    return typeof raw.commit === 'string' && HEX40.test(raw.commit) ? raw.commit : null
  } catch { return null }
}

function setCursor(repo: string, commit: string): void {
  const file = cursorFile(repo)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ commit }, null, 2)}\n`)
  renameSync(tmp, file)
}

const jobs = new Map<string, Promise<void>>()
/** The repositories whose cursor the Hub's own commits move (a purger or a cursor job has named them). */
const watched = new Set<string>()
/** The Hub's own commits not yet taken by the cursor, parent → commit, per repository (a few: the cursor is behind). */
const own = new Map<string, Map<string, string>>()
const OWN_KEPT = 256

/** `job` after every job queued for `repo` before it; a failure is said on the console and ends only that job. */
function queue(repo: string, what: string, job: () => Promise<void>): Promise<void> {
  const key = resolve(repo)
  watched.add(key)
  const next = (jobs.get(key) ?? Promise.resolve()).then(job).catch(err => {
    console.error(`org-os admin: ${what} could not be read, so their conversation is not purged yet (the next move or start reads again): ${err instanceof Error ? err.message : String(err)}`)
  })
  jobs.set(key, next)
  return next
}

/** The cursor moved on through the Hub's own commits that stand on it. */
function followOwn(repo: string): void {
  const edges = own.get(resolve(repo))
  let at = purgeCursor(repo)
  if (!edges || at === null) return
  let moved = false
  for (let next = edges.get(at); next !== undefined; next = edges.get(at)) { edges.delete(at); at = next; moved = true }
  if (moved) setCursor(repo, at)
}

/** Repositories where a commit the Hub is making now brings commits it did not make (Sync's merge): the cursor does not
 *  take it, `trunkMoved` reads it (T2c I-a). */
const outsideNow = new Map<string, number>()

/** `make` (Sync's merge, the Refresher's or Sync's fast-forward) moves the trunk to commits the Hub did not make: a commit
 *  it lands meanwhile is not the Hub's own for the cursor, so a read of it that fails leaves the cursor before it and the
 *  next move or start reads it again. The caller then calls `trunkMoved`. */
export async function outsideMove<T>(repo: string, make: () => Promise<T>): Promise<T> {
  const key = resolve(repo)
  outsideNow.set(key, (outsideNow.get(key) ?? 0) + 1)
  try { return await make() } finally {
    const left = (outsideNow.get(key) ?? 1) - 1
    if (left > 0) outsideNow.set(key, left)
    else outsideNow.delete(key)
  }
}

onCommit(({ repo, commit }) => {
  const key = resolve(repo)
  if (!watched.has(key) || !HEX40.test(commit) || outsideNow.has(key)) return
  void queue(key, `the Hub's commit ${commit.slice(0, 7)}`, async () => {
    const parent = await resolveRev(key, `${commit}^`)
    if (parent === null) return
    const edges = own.get(key) ?? new Map<string, string>()
    own.set(key, edges)
    edges.set(parent, commit)
    if (edges.size > OWN_KEPT) edges.delete(edges.keys().next().value!)
    followOwn(key)
  })
})

/** The targets purged now, or buried (a tombstone) when no purger is there to take them; throws when neither happened. */
async function purgeNow(repo: string, targets: readonly string[], at: Date): Promise<void> {
  if (targets.length === 0) return
  const fn = purgers.get(resolve(repo))
  if (!fn) { bury(repo, targets, at.toISOString()); return }
  await fn([...new Set(targets)], at.toISOString())
}

/** One cursor job: from the cursor (or, with none, from `from`) to `to`; with neither, the cursor is set to `to`. */
async function catchUp(repo: string, from: string | null, to: string, at: Date): Promise<void> {
  let cursor = purgeCursor(repo)
  if (cursor !== null && (await resolveRev(repo, `${cursor}^{commit}`)) === null) {
    // A cursor git no longer holds (a history rewritten outside, a store restored from elsewhere) can never be read from:
    // it starts again at the trunk, as a fresh install does, and says so.
    console.error(`org-os admin: the conversation purge cursor ${cursor.slice(0, 7)} is not a commit of this repository; it starts again at ${to.slice(0, 7)}, and what was deleted between them keeps its conversation.`)
    setCursor(repo, to)
    return
  }
  let start: string | null
  if (from === null || cursor === null || cursor === from) start = cursor ?? from
  else start = (await isAncestor(repo, cursor, from)) ? cursor : from
  if (start !== null && start !== to) {
    // At the start the cursor may stand off the trunk's line (rewound, or moved to another line): read across (T2c I-b).
    const across = from === null && !(await isAncestor(repo, start, to))
    await purgeNow(repo, across ? await goneAcross(repo, start, to) : await goneBetween(repo, start, to), at)
  }
  setCursor(repo, to)
  followOwn(repo)
}

/** After the trunk moved from `from` to `to` by commits the Hub did not make: queue the purge of what the line from the
 *  cursor to `to` deleted, of what was written at or before `at`, the time taken before the move (R2b I-2). Never throws
 *  and never waits: the history is read after the caller (Sync, under the write lock) goes on. */
export function trunkMoved(repo: string, from: string | null, to: string | null, at: Date): void {
  if (to === null || !HEX40.test(to) || (from !== null && !HEX40.test(from))) return
  void queue(repo, `the commits up to ${to.slice(0, 7)}`, () => catchUp(repo, from, to, at))
}

/** At the server's start: queue the purge of what the trunk's commits since the cursor deleted (a move made while the
 *  server was down), of what was written before `at`; with no cursor, set it to the trunk. Resolves when the job ends. */
export function trunkAtStart(repo: string, trunk: () => Promise<string>, at: Date): Promise<void> {
  return queue(repo, 'the commits made while the server was stopped', async () => {
    const name = await trunk()
    const to = await resolveRev(repo, `refs/heads/${name}`)
    if (to !== null) await catchUp(repo, null, to, at)
  })
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
