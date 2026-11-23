// packages/admin/server/workspace/sources.ts
//
// Sources and the from mark (DAO-OS L6 spec §10, Q70; Task 14). `GET /api/sources` answers where the Hub's things come
// from: the instance (its collections with gated counts, its pages, its other governed files, its last commit), each
// System (what its driver's read supplies, with the read's age and state; a `repo` System its files, "from
// <owner>/<repo>"), and each import (the items of that export the viewer may read). `fromOf` answers one thing's from
// mark in L4c's `From` shape (R-L6-FM): an imported item "from Notion · exported 12 Aug", a `repo` item "from
// <owner>/<repo>" with the read's age, a record its file with that file's last commit, a page (and a record the private
// store keeps) the instance with its last write.
//
// Rule 7 throughout: a source, a count, a name or a mark of anything the viewer may not read is absent, never a zero or a
// hint; counts are counts of what the gate lets through. The public is refused before any route (`publicReads`), and
// is given no mark. Nothing here asks a driver: a System's read is the one its reader last cached (`cached`), and
// nothing calls a network. A file's last commit is one `git log -1` per file, cached per HEAD.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Hono } from 'hono'
import { parseDocument } from 'yaml'
import { simpleGit } from 'simple-git'
import type { From } from '../../app/src/elements/atoms/from.ts'
import type { DriverRead, ReadingState } from '../systems/driver.ts'
import type { SystemReader } from '../systems/reader.ts'
import { registriesOf, registryFile } from '../registries.ts'
import { lastCommit } from '../resources/changed.ts'
import { orgName } from '../resources/util.ts'
import { viewerOf } from '../request.ts'
import { gateItems, gateRecord, gateRegistry, gateRegistryEntries, gateRegistryList, isObj, Levels, MAINTAINERS, PUBLIC_VIEWER } from '../visibility/gate.ts'
import { fileLevels } from './reads.ts'
import { readConfig } from '../visibility/config.ts'
import { levelOfToken, NO_PRIVATE, privateCollections, privateReads } from '../private/reads.ts'
import { noStore, reach, type PrivateAccess } from '../private/ops.ts'
import { chainKept } from '../deploy/private-flip.ts'
import type { PrivateStore } from '../private/store.ts'
import { admits, fullLevel, type ParsedLevel, type Viewer } from '../../lib/visibility.mjs'
import { editorRowFor } from '../../lib/workspace/editors.mjs'
import { withChainFields } from '../resources/adapters/systems.ts'

/** One source (§10), as `GET /api/sources` answers it. `from` is a `repo` System's "from <owner>/<repo>" (L7 §12). */
export interface Source {
  id: string
  kind: 'instance' | 'repo' | 'system' | 'import'
  name: string
  href?: string
  from?: string
  supplies: { what: string; count?: number; href?: string }[]
  read: { at: string | null; state: ReadingState }
}

/** What the Sources page needs of the System reader: its cache, never a read. */
export type SourceReader = Pick<SystemReader, 'cached'>

/** A thing whose from mark is asked: a record (`registry`, `id`), a collection (`registry` alone), a page, or an item
 *  carrying a mark of its own (`from`: an import's `{ source, id, exported }`, or a System's `{ system, path? }`). */
export interface FromItem { registry?: string; id?: string; page?: string; from?: unknown }

export interface FromDeps {
  repo: string
  store: PrivateStore | null
  /** The Systems' cached reads, by system id. */
  reads: Record<string, DriverRead>
  /** Who asks: a mark of what they may not read is absent. */
  viewer: Viewer
  /** Shared by the marks of one answer, so each file's last commit is asked once. */
  times?: CommitTimes
  levels?: Levels
  /** One collection's records judged once for one answer's many marks (Tasks 13–14 review I3): each record's level and
   *  where it is kept, as `Levels.target` and the registry list would answer them one by one. */
  judged?: Judged
  /** The org's name, read once for one answer's many marks. */
  instance?: string
}

/** A collection's records judged once (`judgeRecords`). */
export interface Judged { registry: string; git: boolean; at: ReadonlyMap<string, { level: ParsedLevel; where: 'git' | 'store' }> }

/** Every record of `registry` judged once, as `fromOf` judges one (`Levels.target`: the git record first, else the
 *  store's; kept in git when the registry is one and its file holds it): one read of each side, not one per record. */
export function judgeRecords(repo: string, registry: string, levels: Levels): Judged {
  const git = registriesOf(repo).some(d => d.name === registry)
  const at = new Map<string, { level: ParsedLevel; where: 'git' | 'store' }>()
  for (const e of levels.records(registry)) {
    const id = String(e.id)
    if (!at.has(id)) at.set(id, { level: levels.record(registry, e), where: git ? 'git' : 'store' })
  }
  for (const r of levels.priv.records(registry)) if (!at.has(r.id)) at.set(r.id, { level: levelOfToken(r.visibility), where: 'store' })
  return { registry, git, at }
}

// ── the last commit of a file, cached per HEAD ───────────────────────────────────────────────────────────

const TIMES = new Map<string, { head: string; at: Map<string, Promise<string | null>> }>()

/** Each file's last commit time (`git log -1`), cached per repository and HEAD: a new commit reads them again. */
export class CommitTimes {
  private head: Promise<string | null> | null = null
  constructor(private readonly repo: string) {}

  async at(file: string): Promise<string | null> {
    const head = await (this.head ??= simpleGit(this.repo).revparse(['HEAD']).then(s => s.trim() || null, () => null))
    if (head === null) return null
    let slot = TIMES.get(this.repo)
    if (!slot || slot.head !== head) {
      if (!slot && TIMES.size >= 64) TIMES.clear() // a long run of temporary repositories (tests) holds no more than this
      slot = { head, at: new Map() }
      TIMES.set(this.repo, slot)
    }
    let got = slot.at.get(file)
    if (!got) {
      got = lastCommit(this.repo, file).then(c => c?.at ?? null)
      slot.at.set(file, got)
    }
    return got
  }
}

// ── reading ────────────────────────────────────────────────────────────────────────────────────────────

const levelsFor = (repo: string, store: PrivateStore | null) =>
  new Levels(repo, readConfig(repo), MAINTAINERS, store ? privateReads(() => store) : NO_PRIVATE)

const IMPORT_NAMES: Record<string, string> = { notion: 'Notion', fileverse: 'Fileverse' }
const importName = (source: string) => IMPORT_NAMES[source] ?? source

/** An import's mark (L6 §9.6): `{ source, id, exported }`, a Fileverse tab's with its keys besides (R-L6-T13-5). */
const isImportMark = (v: unknown): v is { source: string; id: string; exported?: unknown } =>
  isObj(v) && typeof v.source === 'string' && typeof v.id === 'string'
/** A System's item's mark (L7 §12's items, read by the Hub): `{ system, path? }`. */
const isSystemMark = (v: unknown): v is { system: string; path?: unknown } => isObj(v) && typeof v.system === 'string'

/** "<owner>/<repo>" of a GitHub repository's address, or null. */
function ownerRepoOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url)
  return m ? `${m[1]}/${m[2]}` : null
}

const isRepoSystem = (s: Record<string, unknown>) => s.kind === 'repo' || s.driver === 'repo'

/** A read's state as the from mark reads it (`readStateOf`): its own, else fresh when it read and failed when not. */
const stateOf = (read: DriverRead | null): ReadingState => (read === null ? 'unknown' : read.state ?? (read.ok ? 'fresh' : 'failed'))

/** The Systems `viewer` may see, gated as records are (§10: "a System only as its gated record does"). */
const visibleSystems = (viewer: Viewer, levels: Levels) =>
  gateRegistryEntries(viewer, 'systems', levels).filter(s => typeof s.id === 'string' && s.id !== '')

/** A System's entry as the reader reads it (the file's record, not its gated copy), so a read under that entry as it is
 *  now is told from one under an older entry (`SystemReader.cached`). */
/** The entry a System's read was made under (the systems adapter: git's, with the chain fields the store keeps laid over;
 *  walk fix wave 5), so its cached read is found. Asked only for a System none of whose chain fields is kept from the
 *  viewer (`chain`). */
const entryOf = (levels: Levels, s: Record<string, unknown>): Record<string, unknown> => {
  const git = levels.records('systems').find(e => String(e.id) === String(s.id)) ?? s
  try { return withChainFields(git, levels.priv.fields('systems', String(s.id))) } catch { return git }
}

/** The cached reads of the Systems `viewer` may see, by id: never a driver read. `chain`: the chain fields of each System
 *  kept from them (deploy/private-flip.ts `chainKept`): a System with any kept has no read here (walk fix wave 4, PF-R256). */
export function cachedReads(viewer: Viewer, levels: Levels, reader: SourceReader | null | undefined, chain: (system: string) => ReadonlySet<string>): Record<string, DriverRead> {
  if (!reader || viewer.kind !== 'member') return {}
  const out: Record<string, DriverRead> = {}
  for (const s of visibleSystems(viewer, levels)) {
    if (chain(String(s.id)).size > 0) continue
    const read = reader.cached(String(s.id), entryOf(levels, s))
    if (read) out[String(s.id)] = read
  }
  return out
}

/** The file a git collection keeps its records in, or the glob of the files it is spread over (knowledge). */
const collectionFile = (repo: string, name: string, id?: string): string | null => {
  try { return registryFile(repo, name, id) } catch { return null }
}

/**
 * The from mark of `item` (§10, R-L6-FM), in L4c's `From` shape, or null when the viewer may not read it, or it is not
 * there: an imported item → `{ import, exportedAt }`; a `repo` System's item → `{ repo, file?, readAt }`; another
 * System's item → `{ system, read }`; a record of the instance → `{ file, readAt }` (that file's last commit); a page, or
 * a record the private store keeps → `{ instance, readAt }` (the page file's last commit, or the store's `updated_at`).
 */
export async function fromOf(item: FromItem, deps: FromDeps): Promise<From | null> {
  const { repo, store, viewer } = deps
  if (viewer.kind !== 'member') return null
  const levels = deps.levels ?? levelsFor(repo, store)
  const times = deps.times ?? new CommitTimes(repo)

  // What the item names must be one the viewer may read, before any of its marks is read.
  let pageWhere: 'git' | 'store' | null = null
  let recordWhere: 'git' | 'store' | 'collection' | null = null
  if (typeof item.page === 'string') {
    const e = levels.pages().get(item.page)
    const level = levels.page(item.page)
    if (!e || !level || !admits(level, viewer)) return null
    pageWhere = e.where === 'git' ? 'git' : 'store'
  } else if (typeof item.registry === 'string') {
    const registry = item.registry
    const judged = deps.judged?.registry === registry ? deps.judged : null
    const git = judged ? judged.git : registriesOf(repo).some(d => d.name === registry)
    if (typeof item.id === 'string' && judged) {
      const hit = judged.at.get(item.id)
      if (!hit || !admits(hit.level, viewer)) return null
      recordWhere = hit.where
    } else if (typeof item.id === 'string') {
      const level = levels.target(`record:${registry}:${item.id}`)
      if (!level || !admits(level, viewer)) return null
      recordWhere = git && levels.records(registry).some(e => String(e.id) === item.id) ? 'git' : 'store'
    } else {
      if (!git && !privateCollections(viewer, levels.priv).some(c => c.id === registry)) return null
      recordWhere = git ? 'git' : 'collection'
    }
  }

  const mark = item.from
  if (isImportMark(mark)) return { import: importName(mark.source), exportedAt: typeof mark.exported === 'string' ? mark.exported : null }
  if (isSystemMark(mark)) {
    const system = visibleSystems(viewer, levels).find(s => s.id === mark.system)
    if (!system) return null
    const read = deps.reads[mark.system] ?? null
    const facts = read?.facts ?? {}
    const ownerRepo = typeof facts.repo === 'string' ? facts.repo : isRepoSystem(system) ? ownerRepoOf(system.url) : null
    if (ownerRepo !== null) {
      return { repo: ownerRepo, ...(typeof mark.path === 'string' ? { file: mark.path } : {}), readAt: read?.readAt ?? null }
    }
    return { system: typeof system.name === 'string' ? system.name : mark.system, read }
  }

  const instance = deps.instance ?? orgName(repo)
  if (pageWhere === 'git') return { instance, readAt: await times.at(`pages/${item.page}.md`) }
  if (pageWhere === 'store') return { instance, readAt: storeTime(store, 'pages', String(item.page)) }
  if (recordWhere === 'store') return { instance, readAt: storeTime(store, String(item.registry), String(item.id)) }
  if (recordWhere === 'collection') return { instance, readAt: null }
  if (recordWhere === 'git') {
    const file = collectionFile(repo, String(item.registry), item.id)
    return file === null ? null : { file, readAt: await times.at(file) }
  }
  return null
}

function storeTime(store: PrivateStore | null, collection: string, id: string): string | null {
  try { return store?.updatedAt(collection, id) ?? null } catch { return null }
}

/** A gated registry answer (`gateRegistry`) with the from mark of the collection (`fromMark`) and of each record it holds
 *  (§10: "gated records carry `from` when asked"). The record's own `from` (an import's mark) is left as it is. */
export async function withFromMarks<A extends { entries?: Record<string, unknown>[] }>(answer: A, registry: string, deps: FromDeps): Promise<A & { fromMark?: From }> {
  const levels = deps.levels ?? levelsFor(deps.repo, deps.store)
  // The records are judged once for the whole answer (I3): one read of the file and of the store, not one per record.
  const shared = { ...deps, times: deps.times ?? new CommitTimes(deps.repo), levels, judged: judgeRecords(deps.repo, registry, levels), instance: orgName(deps.repo) }
  const own = await fromOf({ registry }, shared)
  const entries = answer.entries === undefined ? undefined : await Promise.all(answer.entries.map(async e => {
    if (typeof e.id !== 'string' && typeof e.id !== 'number') return e
    const m = await fromOf({ registry, id: String(e.id), from: e.from }, shared)
    return m ? { ...e, fromMark: m } : e
  }))
  return { ...answer, ...(entries !== undefined ? { entries } : {}), ...(own ? { fromMark: own } : {}) }
}

// ── the sources ────────────────────────────────────────────────────────────────────────────────────────

/** Where a collection is opened in the Hub. */
const collectionHref = (name: string): string =>
  name === 'proposals' ? '/governance/proposals' : name === 'library' ? '/library' : name === 'boards' ? '/boards' : `/c/${encodeURIComponent(name)}`

/** A `<dir>/*.<ext>` glob, or an exact path, read as editors.mjs reads its rows. */
function inFiles(file: string, path: string): boolean {
  const star = file.indexOf('*')
  if (star < 0) return file === path
  const head = file.slice(0, star), tail = file.slice(star + 1)
  return path.startsWith(head) && path.endsWith(tail) && path.length > head.length + tail.length && !path.slice(head.length, path.length - tail.length).includes('/')
}

async function trackedFiles(repo: string): Promise<string[]> {
  try { return (await simpleGit(repo).raw(['ls-files', '-z'])).split('\0').filter(p => p !== '') } catch { return [] }
}

/**
 * `GET /api/sources` for `viewer` (§10): the instance, then each System they may see, then each import. Every count is
 * of what the gate lets them read; a private collection, a System or an item they may not read is not named, counted
 * or hinted at. An import is one export (a re-run of it is the same source, named by its newest receipt); what it
 * supplies is the items carrying its mark that the viewer may read now, and one supplying them nothing is absent. Its receipt's own lines (a restricted count
 * among them, PF-R22) are not repeated here.
 */
export async function sourcesFor(repo: string, viewer: Viewer, deps: { reader: SourceReader | null; store: PrivateStore | null; access?: PrivateAccess }): Promise<Source[]> {
  if (viewer.kind !== 'member') return []
  const levels = levelsFor(repo, deps.store)
  const config = levels.config
  const store = deps.store
  // walk fix wave 4 (PF-R256): a System with a chain field kept from the viewer is listed with no read
  const chain = chainKept(repo, config, deps.access ?? (store ? () => store : noStore), viewer)

  // The instance's collections, each with the records the viewer may read.
  const collections: { name: string; entries: Record<string, unknown>[] | null }[] = []
  for (const r of gateRegistryList(viewer, repo, levels)) {
    if (r.kind !== 'collection') continue
    let entries: Record<string, unknown>[] | null
    try { entries = gateRegistry(viewer, repo, r.name, levels).entries ?? [] } catch { entries = null }
    collections.push({ name: r.name, entries })
  }
  const pages = gateItems(viewer, [...levels.pages().values()], e => levels.page(e.id) ?? fullLevel(config, 'pages', null))

  // The other governed files: what a rule governs, less the collections' own files and the pages.
  const gitNames = new Set(registriesOf(repo).map(d => d.name))
  const ownFiles = collections.flatMap(c => (gitNames.has(c.name) ? [collectionFile(repo, c.name)] : [])).filter((f): f is string => f !== null)
  const others = (await trackedFiles(repo)).filter(p => editorRowFor(p) !== null && !p.startsWith('pages/') && !ownFiles.some(f => inFiles(f, p)))

  const last = await lastCommit(repo, '.')
  const instance: Source = {
    id: 'instance', kind: 'instance', name: orgName(repo),
    supplies: [
      ...collections.map(c => ({ what: c.name, ...(c.entries !== null ? { count: c.entries.length } : {}), href: collectionHref(c.name) })),
      { what: 'pages', count: pages.length, href: '/workspace' },
      { what: 'other governed files', count: others.length },
    ],
    read: { at: last?.at ?? null, state: 'fresh' },
  }

  // Each System the viewer may see, from what its reader last cached.
  const systems: Source[] = visibleSystems(viewer, levels).map((s): Source => {
    const id = String(s.id)
    const read = chain(id).size > 0 ? null : deps.reader?.cached(id, entryOf(levels, s)) ?? null
    const name = typeof s.name === 'string' && s.name !== '' ? s.name : id
    const base = { id: `system:${id}`, name, href: `/r/system/${encodeURIComponent(id)}`, read: { at: read?.readAt ?? null, state: stateOf(read) } }
    if (!isRepoSystem(s)) {
      return { ...base, kind: 'system', supplies: (read?.sections ?? []).map(x => ({ what: x.title, count: x.rows.length })) }
    }
    const facts = read?.facts ?? {}
    const files = Array.isArray(facts.files)
      ? facts.files.filter(isObj).filter(f => typeof f.path === 'string')
        .map(f => (f.ok === true && typeof f.items === 'number' ? { what: String(f.path), count: f.items } : { what: String(f.path) }))
      : (Array.isArray(s.files) ? s.files : []).filter((f): f is string => typeof f === 'string').map(f => ({ what: f }))
    const ownerRepo = typeof facts.repo === 'string' ? facts.repo : ownerRepoOf(s.url)
    return { ...base, kind: 'repo', ...(ownerRepo !== null ? { from: `from ${ownerRepo}` } : {}), supplies: files }
  })

  // Each import: one export, its newest receipt; what of it the viewer may read now.
  // data/imports.yaml's top level is a list, which the registry layer's documents do not read: it is read here as the
  // import plan reads it, and admitted as that document would be (its level, then its field's).
  let receipts: unknown[] = []
  try {
    const file = collectionFile(repo, 'imports') ?? 'data/imports.yaml'
    const listed = parseDocument(readFileSync(join(repo, file), 'utf8')).toJS()?.imports
    // 0.7.2 round 3 (review 6): read as the public reads it by a member the `files` section keeps the file from.
    const as = viewer.kind === 'member' && !fileLevels(repo, viewer)(file) ? PUBLIC_VIEWER : viewer
    const gated = Array.isArray(listed) ? gateRecord(as, 'imports', { imports: listed }, config) : null
    receipts = gated && Array.isArray(gated.imports) ? gated.imports : []
  } catch { receipts = [] }
  const exports = new Map<string, { id: string; source: string; export: string | null }>()
  for (const r of receipts) {
    if (!isObj(r) || typeof r.id !== 'string' || typeof r.source !== 'string') continue
    const exported = typeof r.export === 'string' ? r.export : null
    exports.set(`${r.source}\u0000${exported ?? ''}`, { id: r.id, source: r.source, export: exported })
  }
  const marked = (from: unknown, x: { source: string; export: string | null }) =>
    isImportMark(from) && from.source === x.source && (typeof from.exported === 'string' ? from.exported : null) === x.export
  const imports: Source[] = [...exports.values()].map(x => {
    const supplies: Source['supplies'] = []
    const pageCount = pages.filter(p => marked(p.from, x)).length
    if (pageCount > 0) supplies.push({ what: 'pages', count: pageCount, href: '/workspace' })
    for (const c of collections) {
      const n = (c.entries ?? []).filter(e => marked(e.from, x)).length
      if (n > 0) supplies.push({ what: c.name, count: n, href: collectionHref(c.name) })
    }
    return { id: `import:${x.id}`, kind: 'import' as const, name: importName(x.source), supplies, read: { at: x.export, state: 'aged' as const } }
  }).filter(s => s.supplies.length > 0) // an import the viewer may read nothing of is absent (rule 7; Tasks 13-14 review M4)

  return [instance, ...systems, ...imports]
}

// ── the route ──────────────────────────────────────────────────────────────────────────────────────────

export function mountSources(app: Hono, deps: { repo: string; privateStore: PrivateAccess; systems?: SourceReader | null }): void {
  app.get('/api/sources', async c => c.json(await sourcesFor(deps.repo, viewerOf(c), { reader: deps.systems ?? null, store: reach(deps.privateStore).store, access: deps.privateStore })))
}
