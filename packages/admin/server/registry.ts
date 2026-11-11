import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocument, isSeq, isMap, isScalar, isNode, isAlias, isCollection, visit, LineCounter, YAMLSeq, YAMLMap, type Node, type YAMLError } from 'yaml'
import { REGISTRIES, registriesOf, registryDef, registryFileOf, resolveTopKey, knowledgeFileDef, type RegistryDef, type RegistryKind } from './registries.ts'
import { canonRecords, kindOfFile } from '../lib/workspace/knowledge.mjs'
import { STRINGIFY, spliceUpdate, spliceCreate, spliceDelete, spliceCreateKey, spliceDeleteKey } from './splice.ts'
import { whyNot, type Edit, type Unintended } from './verify.ts'
import { HttpError } from './errors.ts'
import { readGovernance } from '../lib/governance-read.mjs'
import { deepFreeze, readCacheFor } from './hosted/readCache.ts'

export type Entity = Record<string, unknown>

export interface RegistryRead {
  name: string
  kind: RegistryKind
  schemaVersion: string | null
  entries?: Entity[]
  document?: Record<string, unknown>
}

/** A registry, named or as its def (L6 §7.1: readers and writers take either, so a custom collection or a map-shaped
 *  file is read as its def says). A name is looked up in the instance's list when `repo` is given, else in REGISTRIES. */
export type Registry = string | RegistryDef

function defOf(registry: Registry, repo?: string): RegistryDef {
  return typeof registry === 'string' ? registryDef(registry, repo) : registry
}

/** The registry's file as a sentence names it: its def's (`registryFileOf`), else data/<name>.yaml. Never throws. */
function fileOf(registry: Registry): string {
  if (typeof registry !== 'string') return registryFileOf(registry)
  return registryFileOf(REGISTRIES.find(r => r.name === registry) ?? { name: registry })
}

export function registryPath(repo: string, registry: Registry): string {
  return join(repo, registryFileOf(defOf(registry, repo))) // throws on unknown
}

/** A map entry's fields without `id`: in a map-shaped file the key is the id (L6 §7.1). */
const withoutId = (entity: Entity): Entity => Object.fromEntries(Object.entries(entity).filter(([key]) => key !== 'id'))

type Parsed = { src: string; lines: LineCounter; doc: ReturnType<typeof parseDocument> }

/** A registry's text, parsed. `forWrite` reads integers as BigInt (see `loadDoc`). */
function parseText(src: string, forWrite: boolean): Parsed {
  const lines = new LineCounter()
  return { src, lines, doc: parseDocument(src, { intAsBigInt: forWrite, lineCounter: lines }) }
}

/** `forWrite` reads integers as BigInt, so that a document that has to be
 *  re-serialized writes an integer of any length back digit for digit. Reads
 *  answer in JSON, which cannot carry such a number, and keep plain numbers. */
function loadDoc(repo: string, registry: Registry, forWrite = false) {
  const def = defOf(registry, repo)
  const path = registryPath(repo, def)
  if (!existsSync(path)) throw new Error(`registry file missing: ${def.name}`)
  return { path, ...parseText(readFileSync(path, 'utf8'), forWrite) }
}

/** What the YAML library found wrong, in a reader's words. The three named
 *  here are the ones met in hand-written registries; any other keeps the
 *  library's own sentence. */
function yamlFault(error: YAMLError): string {
  const at = error.linePos ? `at line ${error.linePos[0].line}, column ${error.linePos[0].col}, ` : ''
  const said = (error.message.split('\n')[0] ?? '').replace(/ at line \d+, column \d+:?$/, '')
  const words: Record<string, string> = {
    DUPLICATE_KEY: 'the same key is written twice in one entry or map, and only one of the two values can be read',
    MULTIPLE_DOCS: 'a line `---` starts a second document, so the file holds more than one YAML document where a registry is one',
    TAB_AS_INDENT: 'a tab is used to indent, and YAML allows only spaces there',
  }
  return at + (words[error.code] ?? said)
}

/**
 * An alias (`*name`) reuses the value marked by an anchor (`&name`). When no
 * value before it carries that mark, the file cannot be read. The YAML
 * library reports that only when the value is asked for, so it is looked for
 * here and said in words: what is wrong, where, and what to do.
 */
function danglingAlias(loaded: Pick<Parsed, 'doc' | 'lines'>): { fault: string; repair: string } | null {
  let found: { fault: string; repair: string } | null = null
  visit(loaded.doc, {
    Alias(_key, alias) {
      if (alias.resolve(loaded.doc)) return undefined
      const pos = alias.range ? loaded.lines.linePos(alias.range[0]) : null
      found = {
        fault: `${pos ? `at line ${pos.line}, column ${pos.col}, ` : ''}*${alias.source} reuses a value marked &${alias.source}, ` +
          `and no value before it in the file carries that mark.`,
        repair: `In the file, write the value in place of *${alias.source}, or put &${alias.source} on the value it should reuse, then try again.`,
      }
      return visit.BREAK
    },
  })
  return found
}

/** The registry as a write starts from it, from its text. A text the YAML library reads with
 *  errors is refused here, for what is wrong with it: the library will not write such a
 *  document back, and a guess at what it meant is not an edit. */
export function parseForWrite(src: string, registry: Registry, verb: 'saved' | 'deleted'): Parsed {
  const loaded = parseText(src, true)
  const [first, ...more] = loaded.doc.errors
  if (first) {
    throw new HttpError(409,
      `Not ${verb}: ${fileOf(registry)} is not valid YAML, so this app will not rewrite it: ${yamlFault(first)}` +
      `${more.length > 0 ? ` (and ${more.length} more ${more.length === 1 ? 'fault' : 'faults'} after it)` : ''}. ` +
      `Nothing was written. Correct the file by hand, then try again.`)
  }
  const dangling = danglingAlias(loaded)
  if (dangling) {
    throw new HttpError(409,
      `Not ${verb}: ${fileOf(registry)} cannot be read, so this app will not rewrite it: ${dangling.fault} Nothing was written. ${dangling.repair}`)
  }
  return loaded
}

/** The records of the collection `knowledge` (L6 §7.5, Task 10): every data/kb/<type>.yaml whose `entries:` is a map, each
 *  record `{ id: '<type>/<slug>', ...fields }` (lib/workspace/knowledge.mjs `canonRecords`), the files in name order. A
 *  file that is no such map holds none. `textOf` gives a file's text where it is not (yet) the file's (Apply's texts, the
 *  ops' result); undefined reads the file. With `strict`, a canon file that is not valid YAML is refused (the writes' 409)
 *  rather than read as holding none. */
export function knowledgeEntries(repo: string, strict = false, textOf: (rel: string) => string | undefined = () => undefined): Entity[] {
  let names: string[]
  try { names = readdirSync(join(repo, 'data', 'kb')) } catch { return [] }
  const out: Entity[] = []
  for (const name of [...names].sort()) {
    const rel = `data/kb/${name}`
    const type = kindOfFile(rel)
    if (type === null) continue
    let text = textOf(rel)
    if (text === undefined) { try { text = readFileSync(join(repo, rel), 'utf8') } catch { continue } }
    if (strict) parseForWrite(text, knowledgeFileDef(rel), 'saved')
    out.push(...(canonRecords(text, type) as Entity[]))
  }
  return out
}

/** A registry file's path and text, or the error a missing one has always been. */
function readSource(repo: string, registry: Registry): { path: string; src: string } {
  const def = defOf(registry, repo)
  const path = registryPath(repo, def)
  if (!existsSync(path)) throw new Error(`registry file missing: ${def.name}`)
  return { path, src: readFileSync(path, 'utf8') }
}

/** A collection's count as GET /api/registries lists it: the items of its top key, a list's or a map's (L6 §7.1). */
function countOf(doc: ReturnType<typeof parseDocument>, def: RegistryDef): number {
  const node = doc.get(resolveTopKey(k => doc.has(k), def))
  return def.shape === 'map' ? (isMap(node) ? node.items.length : 0) : isSeq(node) ? node.items.length : 0
}

/** The registries of the instance at `repo` whose file is there, its custom collections among them (L6 §7.1): a custom
 *  collection is listed once data/collections.yaml defines it, with no records yet as with some. */
export function listRegistries(repo: string) {
  return registriesOf(repo).filter(def => def.custom === true || existsSync(registryPath(repo, def)))
    .map(def => {
      if (def.kind === 'document') return { name: def.name, kind: def.kind, count: null }
      if (!existsSync(registryPath(repo, def))) return { name: def.name, kind: def.kind, count: 0 }
      return { name: def.name, kind: def.kind, count: countOf(loadDoc(repo, def).doc, def) }
    })
}

/** A node as plain JSON-ready data. The document is passed so that an alias
 *  (`*name`) reads as the value it stands for; without it the library answers
 *  `{source: "name"}`. Integers read as BigInt (see `loadDoc`) become numbers. */
function plain(node: Node, doc: ReturnType<typeof parseDocument>): unknown {
  return JSON.parse(JSON.stringify(node.toJS(doc), (_key, value) => (typeof value === 'bigint' ? Number(value) : value)))
}

/** A collection's entries from its top node: a list's items, or a map's entries with `id` from their key (L6 §7.1). */
function entriesOf(node: unknown, doc: ReturnType<typeof parseDocument>, def: RegistryDef): Entity[] {
  if (def.shape !== 'map') return isSeq(node) ? (plain(node, doc) as Entity[]) : []
  if (!isMap(node)) return []
  return node.items.map(pair => {
    const key = isScalar(pair.key) ? pair.key.value : pair.key
    const value = isNode(pair.value) ? plain(pair.value, doc) : null
    const fields = typeof value === 'object' && value !== null && !Array.isArray(value) ? withoutId(value as Entity) : {}
    return { id: String(key), ...fields }
  })
}

export function readRegistry(repo: string, registry: Registry): RegistryRead {
  const def = defOf(registry, repo)
  return readLoaded(def, loadDoc(repo, def))
}

/** A registry as `readRegistry` answers it, from its parsed text. */
function readLoaded(def: RegistryDef, loaded: Parsed): RegistryRead {
  const name = def.name
  const { doc } = loaded
  const dangling = danglingAlias(loaded)
  if (dangling) throw new HttpError(409, `${fileOf(def)} cannot be read: ${dangling.fault} ${dangling.repair}`)
  const schemaVersion = (doc.get('schema_version') as string | undefined) ?? null
  if (name === 'governance') {
    // Read as instances write it (lib/governance-read.mjs): the `governance:`
    // wrapper, a flat file, `decision_model`. A file of several YAML documents
    // is refused, never merged: only its people know where each part belongs.
    const read = readGovernance(loaded.src)
    if (read.shape === 'multi-document') throw new HttpError(409, `data/governance.yaml ${read.problems[0]}`, 'MULTIPLE_DOCS')
    if (read.governance) return { name, kind: def.kind, schemaVersion, document: read.governance }
  }
  const node = doc.get(resolveTopKey(k => doc.has(k), def), true)
  if (def.kind === 'document') {
    return { name, kind: def.kind, schemaVersion,
      document: (isMap(node) ? plain(node, doc) : {}) as Record<string, unknown> }
  }
  return { name, kind: def.kind, schemaVersion, entries: entriesOf(node, doc, def) }
}

/** What a GET answers: the registry, or, when this instance has no such file, an empty one. A file that
 *  is not there is a registry with nothing in it, not an error a page has to show in its console; an
 *  unknown name is still refused. */
export function readRegistryOrEmpty(repo: string, registry: Registry): RegistryRead {
  const def = defOf(registry, repo)
  if (existsSync(registryPath(repo, def))) return readRegistry(repo, def)
  return def.kind === 'document'
    ? { name: def.name, kind: def.kind, schemaVersion: null, document: {} }
    : { name: def.name, kind: def.kind, schemaVersion: null, entries: [] }
}

// ── through the read cache (L9 §7.6) ───────────────────────────────────────────────────────────────

/** What one reading of a registry's text holds: its count as `listRegistries` gives it, and what `readRegistry` answers
 *  (or the error it throws: a text that cannot be read fails the same way every time until it changes). */
type Held = { count: number; read: RegistryRead } | { count: number; read?: undefined; error: unknown }

/** One parser per registry, defined once, so the read cache can tell it apart (`ReadCache.get`). Only the framework's
 *  registries (REGISTRIES) are held this way: a custom collection's or the canon's definition comes from the instance's
 *  own files and may change, so those are read as `readRegistryOrEmpty` reads them. */
const holders = new Map<string, (src: string) => Held>()
function holderOf(def: RegistryDef): (src: string) => Held {
  let holder = holders.get(def.name)
  if (!holder) {
    holder = (src: string): Held => {
      const loaded = parseText(src, false)
      const count = def.kind === 'collection' ? countOf(loaded.doc, def) : 0
      try { return { count, read: deepFreeze(readLoaded(def, loaded)) } } catch (error) { return { count, error } }
    }
    holders.set(def.name, holder)
  }
  return holder
}

const heldOf = (repo: string, def: RegistryDef): Held => readCacheFor(repo).get(registryPath(repo, def), holderOf(def))
/** A registry the read cache holds: one of the framework's (REGISTRIES), never an instance's own definition. */
const cacheable = (def: RegistryDef): boolean => REGISTRIES.includes(def)

/** `readRegistryOrEmpty` through the repository's read cache (L9 §7.6): a file that has not changed is not parsed again.
 *  What it answers is frozen, as every request shares it. The gate reads registries through it. */
export function readRegistryOrEmptyCached(repo: string, registry: Registry): RegistryRead {
  const def = defOf(registry, repo)
  if (!cacheable(def) || !existsSync(registryPath(repo, def))) return readRegistryOrEmpty(repo, def)
  const held = heldOf(repo, def)
  if (held.read === undefined) throw held.error
  return held.read
}

/** `listRegistries` through the repository's read cache (the framework's registries; the rest as `listRegistries`). */
export function listRegistriesCached(repo: string): ReturnType<typeof listRegistries> {
  return registriesOf(repo).filter(def => def.custom === true || existsSync(registryPath(repo, def)))
    .map(def => {
      if (def.kind === 'document') return { name: def.name, kind: def.kind, count: null }
      if (!existsSync(registryPath(repo, def))) return { name: def.name, kind: def.kind, count: 0 }
      return { name: def.name, kind: def.kind, count: cacheable(def) ? heldOf(repo, def).count : countOf(loadDoc(repo, def).doc, def) }
    })
}

/** A collection's entries from a text that is not (yet) the file: what the change engine
 *  validates against before it writes. Same reading as `readRegistry`. */
export function entriesFromText(src: string, registry: Registry): Entity[] {
  const def = defOf(registry)
  const loaded = parseText(src, false)
  const dangling = danglingAlias(loaded)
  if (dangling) throw new HttpError(409, `${fileOf(def)} cannot be read: ${dangling.fault} ${dangling.repair}`)
  const node = loaded.doc.get(resolveTopKey(k => loaded.doc.has(k), def), true)
  return entriesOf(node, loaded.doc, def)
}

/** Shared by the write half. Returns the collection seq, creating it if the key is null/absent. */
export function collectionSeq(doc: ReturnType<typeof parseDocument>, registry: Registry): YAMLSeq {
  const def = defOf(registry)
  const name = def.name
  if (def.kind !== 'collection') throw new Error(`${name} is a document registry`)
  const topKey = resolveTopKey(k => doc.has(k), def)
  let node = doc.get(topKey)
  if (!isSeq(node)) {
    node = doc.createNode([])
    doc.set(topKey, node)
  }
  return node as YAMLSeq
}

/** Whether an entry's `id` is `id`, compared as strings so that a numeric id is addressable. */
function hasId(it: unknown, id: unknown): boolean {
  if (!isMap(it)) return false
  const held = (it as YAMLMap).get('id')
  return held !== undefined && held !== null && String(held) === String(id)
}

export function findEntity(seq: YAMLSeq, id: string): { index: number; item: YAMLMap } {
  const index = seq.items.findIndex(it => hasId(it, id))
  if (index < 0) throw new Error(`entity not found: ${id}`)
  return { index, item: seq.items[index] as YAMLMap }
}

/** A map-shaped registry's map of entries (L6 §7.1), created when the key is null or absent. */
function collectionMap(doc: ReturnType<typeof parseDocument>, def: RegistryDef): YAMLMap {
  if (def.kind !== 'collection') throw new Error(`${def.name} is a document registry`)
  const topKey = resolveTopKey(k => doc.has(k), def)
  let node = doc.get(topKey)
  if (!isMap(node)) {
    node = doc.createNode({})
    doc.set(topKey, node)
  }
  return node as YAMLMap
}

/** The key of a map entry, as a string (a numeric key is addressable as its digits). */
const keyText = (pair: { key: unknown }): string => String(isScalar(pair.key) ? pair.key.value : pair.key)

function findEntry(map: YAMLMap, id: string): { index: number; item: YAMLMap } {
  const index = map.items.findIndex(pair => keyText(pair) === String(id) && isMap(pair.value))
  if (index < 0) throw new Error(`entity not found: ${id}`)
  return { index, item: map.items[index]!.value as YAMLMap }
}

/** The entries of a collection's node, each with the id a sentence names it by: what an alias is reused from. */
type Holders = { node: unknown; id: unknown }[]
const seqHolders = (seq: YAMLSeq): Holders => seq.items.map(item => ({ node: item, id: isMap(item) ? item.get('id') : undefined }))
const mapHolders = (map: YAMLMap): Holders => map.items.map(pair => ({ node: pair.value, id: keyText(pair) }))

/** The entry `id` of a collection, in a list or a map, for an edit. */
function locate(src: string, def: RegistryDef, id: string, verb: 'saved' | 'deleted') {
  const { doc } = parseForWrite(src, def, verb)
  if (def.shape === 'map') {
    const map = collectionMap(doc, def)
    return { doc, holders: mapHolders(map), ...findEntry(map, id), seq: null, map }
  }
  const seq = collectionSeq(doc, def)
  return { doc, holders: seqHolders(seq), ...findEntity(seq, id), seq, map: null }
}

/**
 * The text to write for an edit, or a refusal. `candidates` are tried in order: first
 * the original text with only the edited lines changed (see splice.ts), then
 * the whole document re-serialized. Each is parsed back and compared with the
 * text as it was (see verify.ts) and the first that holds exactly the old data
 * plus the edit is returned. If none does, nothing is returned: a refusal in
 * words beats a file that quietly says something else.
 */
function chooseText(src: string, def: RegistryDef, edit: Edit, candidates: (() => string | null)[]): string {
  // A file that ends every line with CRLF keeps doing so on the lines an edit writes.
  const crlf = src.includes('\r\n') && !/(^|[^\r])\n/.test(src)
  let why: Unintended = { what: 'no way of writing it was found', digits: false }
  for (const make of candidates) {
    let text: string | null
    try { text = make() } catch (err) { why = { what: err instanceof Error ? err.message : String(err), digits: false }; continue }
    if (text === null) continue
    if (crlf) text = text.replace(/\r?\n/g, '\r\n')
    const diff = whyNot(src, text, def, edit)
    if (diff === null) return text
    why = diff
  }
  // The advice about numbers is given only when a number is the cause.
  throw new HttpError(409,
    `Not saved: writing this change to ${fileOf(def)} would also have changed something that was not asked for (${why.what}). ` +
    `Nothing was written. ` + (why.digits
      ? `The file holds a number with more digits than this app can keep (a request carries numbers as JSON does, about 16 digits), ` +
        `and writing this change would round it: put that number in quotes in the file, or make this edit in the file by hand.`
      : `This app found no way to write the change that leaves the rest of the file as it is: make this edit in the file by hand.`))
}

/**
 * An anchor (`&name`) marks a value so that an alias (`*name`) elsewhere can
 * reuse it. Changing or removing the marked value would change every entry
 * that reuses it, so the edit is refused when an alias outside `doomed` (the
 * values about to be replaced or removed) refers to an anchor inside it.
 */
function refuseSharedAnchors(
  doc: ReturnType<typeof parseDocument>, holders: Holders, def: RegistryDef, doomed: Node[], what: string, verb: 'saved' | 'deleted',
): void {
  const anchors = new Set<string>()
  for (const node of doomed) {
    visit(node, { Node(_key, inner) { if (inner.anchor) anchors.add(inner.anchor) } })
  }
  if (anchors.size === 0) return
  const users = new Map<string, Set<string>>() // anchor → where it is reused
  visit(doc, {
    Alias(_key, alias, path) {
      if (!anchors.has(alias.source) || path.some(p => doomed.includes(p as Node))) return
      const id = holders.find(h => path.includes(h.node as Node))?.id
      const where = id === undefined || id === null ? 'another part of the file' : `"${String(id)}"`
      users.set(alias.source, (users.get(alias.source) ?? new Set()).add(where))
    },
  })
  const first = [...users.entries()][0]
  if (!first) return
  const [anchor, where] = first
  throw new HttpError(409,
    `Not ${verb}: in ${fileOf(def)}, ${what} carries the YAML anchor &${anchor}, and ${[...where].join(', ')} ` +
    `reuse${where.size === 1 ? 's' : ''} it as *${anchor}. Changing it here would change ${where.size === 1 ? 'that entry' : 'those entries'} too. ` +
    `Nothing was written. In the file, replace each *${anchor} with its own value, then try again.`)
}

type Doc = ReturnType<typeof parseDocument>

/** The integers under `node` that are too long for a JSON number, by the
 *  number each one reads as in JSON. */
function longIntegers(node: unknown, doc: Doc, found = new Map<number, Set<bigint>>(), depth = 0): Map<number, Set<bigint>> {
  if (depth > 100) return found
  if (isAlias(node)) return longIntegers(node.resolve(doc), doc, found, depth + 1)
  if (isMap(node)) for (const pair of node.items) longIntegers(pair.value, doc, found, depth + 1)
  else if (isSeq(node)) for (const item of node.items) longIntegers(item, doc, found, depth + 1)
  else if (isScalar(node) && typeof node.value === 'bigint' && !Number.isSafeInteger(Number(node.value))) {
    found.set(Number(node.value), (found.get(Number(node.value)) ?? new Set()).add(node.value))
  }
  return found
}

/**
 * The value a request sent for a list or an object, with the file's own
 * digits put back where the request can only have meant them.
 *
 * Why: a request replaces a list or object whole, and its numbers are the
 * ones `GET` showed, which JSON rounds to about 16 digits. Where the value in
 * the file held a longer integer that reads as the same JSON number, the
 * request is taken to mean that integer, and it is written digit for digit.
 * Two different integers that read as the same number cannot be told apart
 * from the request, so `ambiguous` is called and the save is refused.
 */
function withFileDigits(value: unknown, long: Map<number, Set<bigint>>, ambiguous: (sent: number, held: bigint[]) => never): unknown {
  if (typeof value === 'number') {
    const held = [...(long.get(value) ?? [])]
    if (held.length > 1) ambiguous(value, held)
    return held[0] ?? value
  }
  if (Array.isArray(value)) return value.map(v => withFileDigits(v, long, ambiguous))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withFileDigits(v, long, ambiguous)]))
  }
  return value
}

/** A list or object written on one line (`[a, b]`) stays on one line when it
 *  is replaced, so that the edit is still a one-line diff. */
function keepFlow(old: unknown, fresh: unknown): void {
  if (isMap(old) && isMap(fresh)) {
    fresh.flow = old.flow
    for (const pair of fresh.items) keepFlow(old.get(pair.key, true), pair.value)
  } else if (isSeq(old) && isSeq(fresh)) {
    fresh.flow = old.flow
    fresh.items.forEach((item, i) => keepFlow(old.items[i], item))
  }
}

/** Entry `id` replaced by `entity` (minimal diff: changed keys set, absent keys removed), as
 *  text, checked by the exact-write verification. `src` itself when nothing differs. Writes nothing. */
export function updatedText(src: string, registry: Registry, id: string, sent: Entity): string {
  const def = defOf(registry)
  const keyed = def.shape === 'map'
  const { doc, holders, index, item } = locate(src, def, id, 'saved')
  // In a map the key is the id: neither the fields sent nor the entry's own are compared on it.
  const entity = keyed ? withoutId(sent) : sent
  const current = (keyed ? withoutId(plain(item, doc) as Entity) : plain(item, doc)) as Entity
  const changed = new Set(Object.keys(entity).filter(key => JSON.stringify(entity[key]) !== JSON.stringify(current[key])))
  // Own keys only: `'toString' in entity` is true of every object.
  const removed = Object.keys(current).filter(key => !Object.hasOwn(entity, key))
  // Nothing differs: the text stays exactly as it is.
  if (changed.size === 0 && removed.length === 0) return src
  const doomed = [...changed, ...removed].map(key => item.get(key, true) as unknown)
    .filter((node): node is Node => isNode(node) && !isAlias(node))
  refuseSharedAnchors(doc, holders, def, doomed, `a value of "${id}" that this edit changes`, 'saved')
  const spliced = spliceUpdate(src, item, () => {
    for (const key of changed) {
      // Mutate an existing scalar in place so its representation (quote style) survives;
      // fall back to replacing the node for structural or newly-added values.
      const value = entity[key]
      const existing = item.get(key, true)
      if (isScalar(existing) && (typeof value !== 'object' || value === null)) {
        existing.value = value
      } else {
        const fresh = doc.createNode(withFileDigits(value, longIntegers(existing, doc), (sent, held) => {
          throw new HttpError(409,
            `Not saved: in ${fileOf(def)}, entry "${id}", field "${key}" holds ${held.join(' and ')}: different numbers in the file, ` +
            `but the same number (${sent}) in JSON, which carries about 16 digits. The request cannot say which one it means. ` +
            `Nothing was written. Put those numbers in quotes in the file, or make this edit in the file by hand.`)
        }))
        keepFlow(existing, fresh)
        item.set(key, fresh)
      }
    }
    for (const key of removed) item.delete(key)
    return changed
  }, keyed)
  return chooseText(src, def, { kind: 'update', index, entity: sent }, [() => spliced, () => doc.toString(STRINGIFY)])
}

/** Minimal-diff update: set only changed keys, delete removed ones. */
export function updateEntity(repo: string, registry: Registry, id: string, entity: Entity): Entity {
  const def = defOf(registry, repo)
  const { path, src } = readSource(repo, def)
  const text = updatedText(src, def, id, entity)
  if (text !== src) writeFileSync(path, text)
  return readRegistry(repo, def).entries!.find(e => String(e.id) === String(id))!
}

function requireId(entity: Entity): void {
  if (typeof entity.id !== 'string' || entity.id.length === 0) {
    throw new Error('entity requires a non-empty string id')
  }
}

/** `entity` appended after the last entry, as text. Writes nothing. */
export function createdText(src: string, registry: Registry, entity: Entity): string {
  requireId(entity)
  const def = defOf(registry)
  const { doc } = parseForWrite(src, def, 'saved')
  if (def.shape === 'map') {
    // A map's entry is written under its id, which is no field of it (L6 §7.1).
    const map = collectionMap(doc, def)
    const id = String(entity.id)
    if (map.items.some(pair => keyText(pair) === id)) throw new Error(`entity already exists: ${id}`)
    if (map.flow && map.items.length === 0) map.flow = false // `key: {}` → block style
    const value = withoutId(entity)
    const spliced = spliceCreateKey(src, map, id, value)
    map.set(doc.createNode(id), doc.createNode(value))
    return chooseText(src, def, { kind: 'create', entity }, [() => spliced, () => doc.toString(STRINGIFY)])
  }
  const seq = collectionSeq(doc, def)
  if (seq.items.some(it => hasId(it, entity.id))) {
    throw new Error(`entity already exists: ${entity.id}`)
  }
  if (seq.flow && seq.items.length === 0) seq.flow = false // `key: []` → block style
  const spliced = spliceCreate(src, seq, entity)
  seq.add(doc.createNode(entity))
  return chooseText(src, def, { kind: 'create', entity }, [() => spliced, () => doc.toString(STRINGIFY)])
}

export function createEntity(repo: string, registry: Registry, entity: Entity): Entity {
  requireId(entity)
  const def = defOf(registry, repo)
  const { path, src } = readSource(repo, def)
  writeFileSync(path, createdText(src, def, entity))
  return entity
}

/** Entry `id` removed, with the comment lines directly above it, as text. Writes nothing. */
export function deletedText(src: string, registry: Registry, id: string): string {
  const def = defOf(registry)
  const { doc, holders, index, item, seq, map } = locate(src, def, id, 'deleted')
  refuseSharedAnchors(doc, holders, def, [item], `the entry "${id}"`, 'deleted')
  const spliced = map ? spliceDeleteKey(src, map, index) : spliceDelete(src, seq!, index)
  ;(map ?? seq!).items.splice(index, 1)
  return chooseText(src, def, { kind: 'delete', index }, [() => spliced, () => doc.toString(STRINGIFY)])
}

export function deleteEntity(repo: string, registry: Registry, id: string): void {
  const def = defOf(registry, repo)
  const { path, src } = readSource(repo, def)
  writeFileSync(path, deletedText(src, def, id))
}
