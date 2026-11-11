import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classOf } from '../../lib/change-classes.mjs'
import { readGovernance } from '../../lib/governance-read.mjs'
import { MAINTAINER, effectiveRules } from '../../lib/rules.mjs'
import { StageError, parseRecord } from '../changes/records.ts'
import { builtinBoards, instanceBoards } from '../boards/read.ts'
import { currentEntries, project } from '../changes/stage.ts'
import type { StageOp } from '../changes/types.ts'
import type { Entity } from '../registry.ts'
import { DRIVERS } from '../systems/drivers.ts'
import type { Actor } from '../actor.ts'
import { installsOf, loadLibrary } from './read.ts'
import { resolveInstalls } from './config.ts'
import { decidedBy, installedReceipts } from './remove.ts'
import type { Fits, InstallOp, LibraryEntry, LibraryList, LibraryPreview, ListedEntry, Shelf } from './types.ts'

const isMapping = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const NOUN: Record<string, string> = { boards: 'board', systems: 'system' }

/** What a `requires` item says to a person: `system-kind:safe` is "a system of kind safe". */
const requirementText = (r: string): string => {
  const [kind, name = ''] = r.split(':')
  return kind === 'system-kind' ? `a system of kind ${name}` : r
}

/** The org's registries as the actor's own staged change would leave them: the files, with `staged` applied. A file
 *  that cannot be read is refused in the engine's own sentence (strict). */
export function throughChange(repo: string, staged: StageOp[]): (registry: string) => Entity[] {
  const projected = staged.length > 0 ? project(r => currentEntries(repo, r, true), staged) : new Map<string, Entity[]>()
  return registry => projected.get(registry) ?? currentEntries(repo, registry, true)
}

/** The kinds of the org's systems; `unreadable` carries the file's own sentence when it cannot be read. */
function systemKinds(repo: string, staged: StageOp[] = []): { kinds: Set<string>; unreadable: string | null } {
  try { return { kinds: new Set(throughChange(repo, staged)('systems').map(e => String(e.kind))), unreadable: null } } catch (err) {
    return { kinds: new Set(), unreadable: err instanceof Error ? err.message : String(err) }
  }
}

const met = (r: string, kinds: Set<string>): boolean => (r.startsWith('system-kind:') ? kinds.has(r.slice('system-kind:'.length)) : false)

function fitsOf(e: LibraryEntry, kinds: Set<string>): Fits | null {
  const req = e.requires ?? []
  if (req.length === 0) return null
  const missing = req.filter(r => !met(r, kinds)).map(requirementText)
  return { met: missing.length === 0, missing }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The rules of an op's `set`, and its roles. */
const rulesOf = (op: InstallOp): Record<string, unknown>[] => (Array.isArray(op.set?.rules) ? (op.set!.rules as unknown[]).filter(isMapping) : [])
const rolesOf = (op: InstallOp): [string, unknown][] => (isMapping(op.set?.roles) ? Object.entries(op.set!.roles as object) : [])
const blocksOf = (op: InstallOp): Record<string, unknown>[] =>
  (isMapping(op.value) && Array.isArray(op.value.blocks) ? (op.value.blocks as unknown[]).filter(isMapping) : [])

/** "what it adds", in the mockup's words: `adds 1 board · 4 blocks`. */
function addsLine(e: LibraryEntry): string {
  if (e.builtin) return 'built in'
  const ops = installsOf(e)
  if (ops.length === 0) return 'adds nothing'
  const parts: string[] = []
  for (const op of ops) {
    const registry = op.record.split(':')[0] ?? ''
    if (registry === 'boards') parts.push('1 board', plural(blocksOf(op).length, 'block'))
    else if (registry === 'systems') parts.push('1 system')
    else if (registry === 'governance') {
      if (rolesOf(op).length) parts.push(plural(rolesOf(op).length, 'role'))
      parts.push(plural(rulesOf(op).length, 'rule'))
    } else parts.push(plural(1, 'record'))
  }
  return `adds ${parts.join(' · ')}`
}

const maturityOf = (e: LibraryEntry) => e.tags?.maturity ?? null

/** The browse list: every shelf served (the framework's first) and, for each entry, what it adds and whether this org has what it needs. */
export async function listEntries(repo: string, entries?: LibraryEntry[]): Promise<LibraryList> {
  const lib = entries ? null : loadLibrary(repo)
  entries = entries ?? lib!.entries
  const { kinds } = systemKinds(repo)
  const receipts = installedReceipts(repo)
  const shelves = new Map<Shelf, number>()
  for (const e of entries) shelves.set(e.shelf, (shelves.get(e.shelf) ?? 0) + 1)
  const listed: ListedEntry[] = entries.map(e => ({
    id: e.id, shelf: e.shelf, title: e.title, summary: e.summary, version: e.version, source: e.source, standing: e.standing, as_of: e.as_of,
    maturity: maturityOf(e), tags: e.tags ?? {}, builtin: e.builtin === true, installable: installsOf(e).length > 0, adds: addsLine(e), fits: fitsOf(e, kinds),
    added: receipts.filter(r => r.entry === e.id).map(r => ({ receipt: r.id, at: r.at })),
  }))
  return { sources: [...new Set(entries.map(e => e.source))], shelves: [...shelves].map(([shelf, count]) => ({ shelf, count })), entries: listed, problems: lib?.problems ?? [] }
}

const DURATION: Record<string, string> = { D: 'day', W: 'week', H: 'hour', M: 'minute' }
/** P7D → "7 days"; PT36H → "36 hours". Written in ISO 8601 (F2 section 3.2). */
function duration(iso: unknown): string {
  const m = /^P(?:(\d+)([DW]))?(?:T(\d+)([HM]))?$/.exec(String(iso))
  const [n, u] = m?.[1] ? [m[1], m[2]!] : m?.[3] ? [m[3], m[4]!] : [String(iso), '']
  return u ? plural(Number(n), DURATION[u]!) : String(iso)
}

/** One rule said in a sentence a person can check against the file. */
function ruleSentence(rule: Record<string, unknown>): string {
  const d = isMapping(rule.decide) ? rule.decide : {}
  const by = String(d.by ?? '')
  const target = Array.isArray(rule.applies_to) ? (rule.applies_to as unknown[]).join(', ') : ''
  const how = d.method === 'direct' ? `${by} decides alone`
    : d.method === 'approve' ? (Number(d.count ?? 1) === 1 ? `one ${by} approves` : `${d.count} ${by}s approve`)
    : d.method === 'consent' ? `${by} decides by consent, ${duration(d.window)} to object`
    : d.method === 'vote' ? `${by}s vote for ${duration(d.window)}; ${d.quorum} votes cast and ${Math.round(Number(d.threshold) * 100)}% yes pass it`
    : by === 'system' ? `the system ${String(d.system)} decides` : String(d.method)
  return `${target}: ${how}`
}

const roleSentence = (id: string, v: unknown): string =>
  (isMapping(v) && v.all === true ? `${id}: every member who is a person` : isMapping(v) && Array.isArray(v.members) ? `${id}: ${(v.members as unknown[]).join(', ')}` : id)

/** The sentence a taken id is refused with, and the next free id (`<slug>-2`, `-3`…). */
function refuseTaken(op: InstallOp, taken: Set<string>): LibraryPreview['refusal'] {
  const [registry = '', id = ''] = op.record.split(':')
  if (op.op !== 'create' || !taken.has(id)) return null
  let n = 2
  while (taken.has(`${id}-${n}`)) n++
  return { sentence: `A ${NOUN[registry] ?? 'record'} with the id \`${id}\` already exists. Add it under another id.`, nextFreeId: `${id}-${n}` }
}

const registryOf = (op: InstallOp) => op.record.split(':')[0] ?? ''

/** The ids a create could not take, per registry, through the actor's change: the registry's own and, for boards,
 *  the built-in boards. */
function takenIds(ops: InstallOp[], entriesOf: (registry: string) => Entity[]): (registry: string) => Set<string> {
  const seen = new Map<string, Set<string>>()
  for (const r of new Set(ops.filter(op => op.op === 'create').map(registryOf))) {
    const ids = entriesOf(r).map(e => String(e.id))
    seen.set(r, new Set(r === 'boards' ? [...builtinBoards().map(b => b.id), ...ids] : ids))
  }
  return r => seen.get(r) ?? new Set()
}

/** The first create among `ops` whose id is taken in `entriesOf`, as the sentence and the next free id; null when
 *  every id is free. */
function firstTaken(ops: InstallOp[], entriesOf: (registry: string) => Entity[]): LibraryPreview['refusal'] {
  const taken = takenIds(ops, entriesOf)
  return ops.map(op => refuseTaken(op, taken(registryOf(op)))).find(Boolean) ?? null
}

/** The first of `ops` (resolved installs) whose id is taken, on file or in the actor's own change `staged`. */
export const takenRefusal = (repo: string, ops: InstallOp[], staged: StageOp[]): LibraryPreview['refusal'] =>
  firstTaken(ops, throughChange(repo, staged))

const BUILT_IN = 'Built in: every instance has this board.'
const NOT_CREATE_OR_UPDATE = 'Adding is built for entries that create records or update ones the org has; this one replaces or deletes records, which a removal could not give back.'

const NARROWS = 'This org decides alone today. Adding this rule set would narrow that to the maintainer role; define the rules first.'

/** The rules in force when the org has written none (the solo default, `lib/rules.mjs effectiveRules`), as plain
 *  values to write; [] when its rules are written, or when its model implies none. `now` is the governance record
 *  through the actor's change; the model is the file's. */
function impliedRules(repo: string, now: Entity): unknown[] {
  const path = join(repo, 'data', 'governance.yaml')
  const block = existsSync(path) ? readGovernance(readFileSync(path, 'utf8')).governance as Record<string, unknown> | null : null
  const { rules, implied } = effectiveRules({ ...(block ?? {}), rules: now.rules })
  return implied ? JSON.parse(JSON.stringify(rules)) as unknown[] : []
}

/** The roles and rules an entry's governance op adds, merged into what the org has (through the actor's change): the
 *  entry's rules after the org's, its roles beside the org's. An org that has written no rules has the implied ones in
 *  force, and they are written first, so what was in force stays in force (a removal's `rules: null` returns the org
 *  to them). A rule id or a role the org already has is refused in the library's sentence (L7 §5.3). Any other op is
 *  returned as it is. */
export function mergedGovernance(repo: string, op: InstallOp, entriesOf: (registry: string) => Entity[]): { op: InstallOp; refusal: string | null } {
  if (op.op !== 'update' || registryOf(op) !== 'governance' || !op.set) return { op, refusal: null }
  const now = entriesOf('governance')[0] ?? {}
  const set: Record<string, unknown> = { ...op.set }
  if (Array.isArray(op.set.rules)) {
    const written = Array.isArray(now.rules) ? (now.rules as unknown[]) : []
    const implied = written.length > 0 ? [] : impliedRules(repo, now)
    const had = written.length > 0 ? written : implied
    if (implied.length > 0) {
      // Implied, any person member decides alone and roles are not read; written, `maintainer` resolves through
      // roles, so a maintainer the org or the entry defines would narrow who decides every class (review NB1).
      const defines = (roles: unknown) => isMapping(roles) && Object.hasOwn(roles, MAINTAINER)
      if (defines(now.roles) || defines(op.set.roles)) return { op, refusal: NARROWS }
    }
    const ids = new Set(had.filter(isMapping).map(r => String(r.id)))
    const taken = (op.set.rules as unknown[]).filter(isMapping).find(r => ids.has(String(r.id)))
    if (taken) {
      return { op, refusal: implied.length > 0
        ? `rule ${String(taken.id)} has the id of the rule this org follows without writing it (the solo default), so that id is reserved; the entry's rule needs another.`
        : `rule ${String(taken.id)} is already written.` }
    }
    set.rules = [...had, ...(op.set.rules as unknown[])]
  }
  if (isMapping(op.set.roles)) {
    const had = isMapping(now.roles) ? now.roles : {}
    const taken = Object.keys(op.set.roles).find(k => Object.hasOwn(had, k))
    if (taken) return { op, refusal: `role ${taken} is already written.` }
    set.roles = { ...had, ...op.set.roles }
  }
  return { op: { ...op, set }, refusal: null }
}

/** The first thing that keeps `e` from being added, in the sentence the library says it with (first match wins), or
 *  null when it can be added. Requirements and taken ids are read through `staged`, the actor's own change. A taken id
 *  the person can change (`id` in the entry's config) is not one of these: it is the preview's `refusal`. */
export function cannotAdd(repo: string, e: LibraryEntry, staged: StageOp[]): string | null {
  if (e.builtin) return BUILT_IN
  const raw = installsOf(e)
  if (raw.length === 0) return 'It adds nothing.'
  // An update is a modifying install (L7-D11): its receipt says what it changed, and a removal restores it.
  if (raw.some(op => op.op !== 'create' && op.op !== 'update')) return NOT_CREATE_OR_UPDATE
  if (e.tags?.maturity === 'raw') return 'This entry is raw: the library shows it and does not add it.'
  const entriesOf = throughChange(repo, staged)
  const reqs = e.requires ?? []
  if (reqs.length > 0) {
    const kinds = new Set(entriesOf('systems').map(x => String(x.kind)))
    const lacking = reqs.find(r => !met(r, kinds))
    if (lacking) return `It needs ${requirementText(lacking)}, which this organization does not have yet. Add it first.`
  }
  for (const op of resolveInstalls(e, {}, { lenient: true }).ops.filter(o => o.op === 'update')) {
    if (op.record.includes('${')) continue // its id is the person's to give; the engine says it if there is none
    let at: { registry: string; id: string }
    try { at = parseRecord(op.record) } catch (err) { if (err instanceof StageError) continue; throw err } // the engine says it at stage
    // A modifying add's receipt holds the record's base as the org has it; a change that already edits it would fold
    // the two into one op, and a removal of either would give back neither (review I2).
    if (staged.some(s => s.op !== 'file' && s.record === op.record)) return `Your change already edits ${op.record}. Apply or propose it first, then add this.`
    if (at.registry !== 'governance' && !entriesOf(at.registry).some(x => String(x.id) === at.id)) {
      return `It changes ${op.record}, which this organization does not have.`
    }
    const { refusal } = mergedGovernance(repo, op, entriesOf)
    if (refusal) return refusal
  }
  if (!Object.hasOwn(e.config?.properties ?? {}, 'id')) {
    const refused = firstTaken(resolveInstalls(e, {}, { lenient: true }).ops, entriesOf)
    if (refused) return refused.sentence
  }
  return null
}

/** What adding `entry` would change, without adding it: the design's "prepare". Reads the org's files and writes
 *  none. Its installs are resolved with config defaults only. A board's id that is taken, by a built-in board or the
 *  org's own, is refused here, in words. `staged` is the actor's own change, through which needs and ids are read. */
export async function previewEntry(repo: string, entry: LibraryEntry, who: Actor, staged: StageOp[] = []): Promise<LibraryPreview> {
  const { ops } = resolveInstalls(entry, {}, { lenient: true })
  const { kinds, unreadable } = systemKinds(repo, staged)
  const classes = [...new Set(ops.map(op => String(classOf({ registry: op.record.split(':')[0] ?? '' }))))]
  // Who decides is the rule's answer, not the reader's (a stand-in person asks the rule for a reader who is no member).
  const decided = decidedBy(repo, who, classes)

  const needs = (entry.requires ?? []).map(r => ({ text: requirementText(r), met: met(r, kinds) }))
  const refusal = takenRefusal(repo, ops, staged)

  const hosts = new Set<string>()
  for (const op of ops.filter(o => registryOf(o) === 'systems')) {
    const name = typeof op.value?.driver === 'string' ? op.value.driver : 'link'
    for (const h of DRIVERS.find(d => d.name === name)?.hosts ?? []) hosts.add(h)
  }

  let note: string | null = null
  if (entry.builtin) {
    const mine = entry.id.startsWith('board:') && instanceBoards(repo).some(b => `board:${b.id}` === entry.id)
    note = mine
      ? "Built in. This org's own board of the same id is shown in its place; deleting it restores this one."
      : BUILT_IN
  } else if (entry.shelf === 'rules' && ops.length === 0) {
    note = 'Adds nothing: this is what an org has until it writes rules.'
  } else if (unreadable && needs.length > 0) {
    note = `What this needs could not be checked: ${unreadable}`
  }

  const board = builtinBoards().find(b => `board:${b.id}` === entry.id)
  const required = new Set(entry.config?.required ?? [])
  let blocked: string | null
  try { blocked = cannotAdd(repo, entry, staged) } catch (err) { blocked = err instanceof Error ? err.message : String(err) }
  return {
    id: entry.id,
    builtin: entry.builtin === true,
    adds: ops.map(op => ({
      record: op.record, op: op.op, class: String(classOf({ registry: registryOf(op) })),
      summary: registryOf(op) === 'boards' ? `board, ${plural(blocksOf(op).length, 'block')}` : registryOf(op) === 'systems' ? `system of kind ${String(op.value?.kind ?? '')}`
        : registryOf(op) === 'governance' ? `${rolesOf(op).length ? `${plural(rolesOf(op).length, 'role')} and ` : ''}${plural(rulesOf(op).length, 'rule')}` : 'record',
    })),
    blocks: [...ops.flatMap(blocksOf), ...(board ? board.blocks as unknown as Record<string, unknown>[] : [])]
      .map(b => ({ id: String(b.id), type: String(b.type), title: typeof b.title === 'string' ? b.title : null })),
    roles: ops.flatMap(rolesOf).map(([id, v]) => ({ id, sentence: roleSentence(id, v) })),
    rules: ops.flatMap(rulesOf).map(r => ({ id: String(r.id), sentence: ruleSentence(r) })),
    needs,
    asks: Object.keys(entry.config?.properties ?? {}),
    fields: Object.entries(entry.config?.properties ?? {}).map(([name, p]) => ({
      name, description: typeof p?.description === 'string' ? p.description : null, default: p?.default ?? null, required: required.has(name),
    })),
    reaches: [...hosts].map(host => ({ host, reads: 'read only' as const })),
    decided,
    source: { name: entry.source, version: entry.version, standing: entry.standing, as_of: entry.as_of },
    refusal,
    cannotAdd: blocked,
    receipts: installedReceipts(repo).filter(r => r.entry === entry.id).map(r => ({ id: r.id, at: r.at, by: r.by })),
    note,
  }
}
