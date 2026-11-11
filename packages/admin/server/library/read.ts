import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import { parse } from 'yaml'
import { builtinBoards } from '../boards/read.ts'
import type { BoardDef } from '../boards/types.ts'
import { strayPlaceholder } from './config.ts'
import { readWizardFile, type WizardDef } from '../../lib/wizards.mjs'
import { RECEIPTS } from '../../lib/receipts.mjs'
import type { InstallOp, LibraryEntry, Shelf, ShelfProblem } from './types.ts'

/** The framework's shelf: shipped with the platform, versioned with it. */
export const LIBRARY_DIR = fileURLToPath(new URL('../../library/', import.meta.url))
const SHELF_ORDER: Shelf[] = ['board', 'rules', 'system', 'template', 'wizard']

/** The folder each served entry was read from, kept beside the entry and never in it: an entry is sent to the browser
 *  as it is, and no path the server resolved may reach it. */
const FOLDERS = new WeakMap<LibraryEntry, string>()
/** A shelf wizard's definition, read and checked with its entry. */
const WIZARDS = new WeakMap<LibraryEntry, WizardDef>()

const isMapping = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** A directory as its sentences print it: the framework's by its place in the repository, a registered shelf's by the
 *  path the instance wrote (passed in as `shown`), so no sentence the browser gets holds where the server resolved it. */
const shownOf = (dir: string): string => (dir === LIBRARY_DIR ? 'packages/admin/library' : dir)
const where = (shown: string, file: string) => `${shown}/${file}`
const firstLine = (err: unknown): string => (err instanceof Error ? err.message.split('\n')[0] ?? '' : String(err))

function yamlAt(dir: string, file: string, shown: string = shownOf(dir)): unknown {
  const path = join(dir, file)
  try { return parse(readFileSync(path, 'utf8')) } catch (err) {
    throw new Error(`${where(shown, file)} cannot be read: ${firstLine(err)}`)
  }
}

/** What a built-in board is, in a line a person can tell from the next one's: a section's list, a map, or (Home,
 *  or a board the framework adds later) its blocks and layout. */
function builtinSummary(b: BoardDef): string {
  const only = b.blocks.length === 1 ? b.blocks[0] : undefined
  const source = isMapping(only?.source) ? only.source : {}
  if (only?.type === 'list' && typeof source.section === 'string') return `The ${source.section} section: its list, with a switch to its map.`
  if (only?.type === 'map' && typeof source.map === 'string') return `The ${source.map} map: how its records connect.`
  return `${b.blocks.length === 1 ? 'One block' : `${b.blocks.length} blocks`}, laid out as ${b.layout}.`
}

/** A built-in board as an entry: previewable, with nothing to install. */
function builtinEntry(b: BoardDef): LibraryEntry {
  return {
    id: `board:${b.id}`, shelf: 'board', title: b.name.includes('{org}') ? 'Home' : b.name, summary: builtinSummary(b),
    version: 'built in', source: 'framework', standing: 'recorded', as_of: '', builtin: true, tags: { maturity: 'field-informed' },
  }
}

/** One entry's folder, read and checked. Every failure names the file and says what is wrong. `listed` is the sentence
 *  for a name with no folder, which differs between the framework's first-set.yaml and a shelf's shelf.yaml; `shown`
 *  is how the sentences print `dir`. */
function readEntry(dir: string, id: string, check: (e: unknown) => string | null, builtinIds: Set<string>, listed?: string, shown: string = shownOf(dir)): LibraryEntry {
  const [shelf = '', slug = ''] = id.split(':')
  const file = `${shelf}/${slug}/entry.yaml`
  if (!existsSync(join(dir, file))) {
    throw new Error(listed ?? `first-set.yaml names ${id}, but there is no library/${file}. Remove the name from the list or add the folder.`)
  }
  const entry = yamlAt(dir, file, shown)
  const problem = check(entry)
  if (problem) throw new Error(`${where(shown, file)}: ${problem}`)
  const e = entry as LibraryEntry
  if (e.id !== id) throw new Error(`${where(shown, file)}: its id ${e.id} is not ${id}, the id its folder library/${shelf}/${slug} gives it.`)
  // Every ${config.…} must be ${config.<name>} with a name its config declares (L7 §5.1); ${hat.…} and ${system.…} are text.
  const stray = strayPlaceholder(e)
  if (stray !== null) throw new Error(`${id}: "${stray}" names no property of config.`)
  for (const op of e.installs ?? []) {
    const [registry = '', rid = ''] = op.record.split(':')
    if (registry === RECEIPTS) throw new Error(`${id}: an entry never writes receipts (${RECEIPTS}:).`)
    if (registry === 'boards' && op.op === 'create') {
      const made = isMapping(op.value) ? op.value.id : undefined
      if (made !== rid) throw new Error(`${where(shown, file)}: it creates ${op.record}, but the board's own id is ${String(made)}. They must be the same.`)
      if (builtinIds.has(rid)) throw new Error(`${where(shown, file)}: it creates a board with the id ${rid}, which is a built-in board. A library entry never shadows a built-in; give it an id of its own.`)
    }
  }
  const folder = join(dir, shelf, slug)
  FOLDERS.set(e, folder)
  if (e.wizard !== undefined) WIZARDS.set(e, wizardIn(folder, e, slug))
  return e
}

/** A wizard entry's wizard: a file inside the entry's own folder that lib/wizards.mjs reads as a wizard whose id is
 *  the entry's slug. Throws the sentence that says what is wrong. */
function wizardIn(folder: string, e: LibraryEntry, slug: string): WizardDef {
  const path = resolve(folder, e.wizard!)
  const inside = !isAbsolute(e.wizard!) && relative(folder, path) !== '' && !relative(folder, path).startsWith(`..${sep}`) && relative(folder, path) !== '..'
  if (!inside || !existsSync(path) || !statSync(path).isFile()) throw new Error(`${e.id}: its wizard ${e.wizard} is not a file in its folder.`)
  const { def, problems } = readWizardFile(path, e.wizard!)
  if (!def) throw new Error(`${e.id}: ${problems[0]}`)
  if (def.id !== slug) throw new Error(`${e.id}: ${e.wizard}: the id "${def.id}" must be the entry's slug, ${slug}.`)
  return def
}

/** The folder an entry was read from (null for a built-in board). Server-side only. */
export const entryFolder = (e: LibraryEntry): string | null => FOLDERS.get(e) ?? null

/** Every wizard the instance's registered shelves serve, each with the id /api/wizards gives it: `<shelf>/<slug>`
 *  (`<shelf>` is the shelf's name, the entry's `source`), so no shelf wizard clashes with the framework's flat ids. */
export function shelfWizards(repo: string): WizardDef[] {
  return loadLibrary(repo).entries.flatMap(e => {
    const def = WIZARDS.get(e)
    return def ? [{ ...def, id: `${e.source}/${e.id.slice(e.id.indexOf(':') + 1)}` }] : []
  })
}

/** An entry.schema.json as a checker (the framework's, unless a test points elsewhere): the first problem in words, or null. Every shelf is checked against it. */
function entryChecker(dir: string = LIBRARY_DIR): (e: unknown) => string | null {
  const validate = new Ajv({ allErrors: false, strict: false }).compile(yamlAt(dir, 'entry.schema.json') as object) // JSON is YAML
  return e => {
    if (validate(e)) return null
    const first = validate.errors?.[0]
    const at = first?.instancePath ? first.instancePath.slice(1).replace(/\//g, '.') : (first?.params as { missingProperty?: string } | undefined)?.missingProperty
    return `${at ? `${at} ` : ''}${first?.message ?? 'does not match the entry shape'} (library/entry.schema.json).`
  }
}

/** The entries the library serves: what first-set.yaml names (each checked against entry.schema.json), then the
 *  built-in boards when it says so. Q6 is answered in that list, so reversing the answer is editing it. */
export function loadEntries(dir: string = LIBRARY_DIR, builtins: BoardDef[] = builtinBoards()): LibraryEntry[] {
  const check = entryChecker(dir)
  const set = yamlAt(dir, 'first-set.yaml')
  if (!isMapping(set) || !Array.isArray(set.entries)) throw new Error(`${where(shownOf(dir), 'first-set.yaml')} must hold an \`entries:\` list of entry ids.`)
  const builtinIds = new Set(builtins.map(b => b.id))
  const made = set.entries.map(id => readEntry(dir, String(id), check, builtinIds))
  const ids = made.map(e => e.id)
  const dup = ids.find((id, i) => ids.indexOf(id) !== i)
  if (dup) throw new Error(`${where(shownOf(dir), 'first-set.yaml')} names ${dup} twice.`)
  const all = [...made, ...(set.built_in_boards === true ? builtins.map(builtinEntry) : [])]
  // What the framework adds first, by shelf; the boards every instance already has come last.
  const rank = (e: LibraryEntry) => (e.builtin ? SHELF_ORDER.length : SHELF_ORDER.indexOf(e.shelf))
  return all.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map(x => x.e)
}

export const installsOf = (e: LibraryEntry): InstallOp[] => (e.builtin ? [] : e.installs ?? [])

const ENTRY_ID = /^[a-z]+:[a-z0-9][a-z0-9-]*$/
const parseOrNull = (dir: string, file: string): unknown => { try { return parse(readFileSync(join(dir, file), 'utf8')) } catch { return null } }

/** One registered shelf: `shelf.yaml` (name, title, entries) and `<kind>/<slug>/entry.yaml` for each. Every entry is
 *  checked against the framework's entry.schema.json and must say it comes from this shelf. A bad entry is left out
 *  alone and said in `problems`; ids in `taken` (an id already served, with the name of the shelf serving it, or a
 *  bare set for the framework's) are left out too. `label` is the path as the instance wrote it. */
function readShelf(dir: string, label: string, taken: Set<string> | Map<string, string>, builtins: BoardDef[]): { name: string; title: string; entries: LibraryEntry[]; problems: ShelfProblem[] } {
  const none = { name: '', title: '', entries: [] as LibraryEntry[] }
  if (!existsSync(dir)) return { ...none, problems: [{ shelf: label, sentence: `federation.yaml registers the shelf ${label}, and there is no such directory.` }] }
  const set = parseOrNull(dir, 'shelf.yaml')
  const name = isMapping(set) && typeof set.name === 'string' && set.name.trim() !== '' ? set.name : ''
  if (!isMapping(set) || !name || !Array.isArray(set.entries)) {
    return { ...none, name: '', problems: [{ shelf: name || label, sentence: `${label}/shelf.yaml must hold a name and an entries: list of entry ids.` }], title: '' }
  }
  const title = typeof set.title === 'string' && set.title.trim() !== '' ? set.title : name
  const check = entryChecker()
  const builtinIds = new Set(builtins.map(b => b.id))
  const problems: ShelfProblem[] = []
  const entries: LibraryEntry[] = []
  const holder = (id: string) => (taken instanceof Map ? taken.get(id) : taken.has(id) ? 'framework' : undefined)
  const left = (sentence: string) => problems.push({ shelf: name, sentence })
  for (const raw of set.entries) {
    const id = String(raw)
    if (!ENTRY_ID.test(id)) { left(`${name}: ${id} is not an entry id; ids look like board:my-board.`); continue }
    let e: LibraryEntry
    try { e = readEntry(dir, id, check, builtinIds, `${name}: shelf.yaml names ${id}, but there is no ${id.replace(':', '/')}/entry.yaml. Remove the name from the list or add the folder.`, label) } catch (err) {
      left(err instanceof Error ? err.message : String(err)); continue
    }
    if (e.source !== name) { left(`${name}: ${id} says it comes from ${e.source}, but it is on the ${name} shelf.`); continue }
    const held = holder(id) ?? (entries.some(x => x.id === id) ? name : undefined)
    if (held) { left(`${name}: ${id} is also on the ${held} shelf, so this copy is left out. Ids are unique across shelves.`); continue }
    entries.push(e)
  }
  return { name, title, entries, problems }
}

/** One registered shelf, read from `dir`. `taken` holds the ids already served. */
export function loadShelf(dir: string, taken: Set<string>, builtins: BoardDef[] = builtinBoards()) {
  return readShelf(dir, dir, taken, builtins)
}

/** The instance's federation.yaml: {} when there is none, null and the problem when it will not parse. Read here rather
 *  than through the lenient reader, which would turn a parse error into "no shelves registered" and say nothing. */
function readFederation(repo: string): { doc: unknown; problem: ShelfProblem | null } {
  const path = join(repo, 'federation.yaml')
  if (!existsSync(path)) return { doc: {}, problem: null }
  try { return { doc: parse(readFileSync(path, 'utf8')), problem: null } } catch (err) {
    return { doc: null, problem: { shelf: 'federation.yaml', sentence: `federation.yaml cannot be read: ${firstLine(err)}; the shelves it registers are left out.` } }
  }
}

/** The framework's shelf (loadEntries, unchanged) and then every shelf federation.yaml registers, in its order.
 *  Only the framework's shelf refuses as a whole; a registered shelf that cannot be read leaves out only itself, and a
 *  federation.yaml that will not parse leaves out every registered shelf, said in one problem. */
export function loadLibrary(repo: string, builtins: BoardDef[] = builtinBoards()): { entries: LibraryEntry[]; sources: string[]; problems: ShelfProblem[] } {
  const entries = loadEntries(LIBRARY_DIR, builtins)
  const sources = ['framework']
  const problems: ShelfProblem[] = []
  const { doc, problem } = readFederation(repo)
  if (problem) return { entries, sources, problems: [problem] }
  const lib = isMapping(doc) ? doc.library : undefined
  if (lib === undefined || lib === null) return { entries, sources, problems }
  const shelves = isMapping(lib) ? lib.shelves : undefined
  if (shelves === undefined && isMapping(lib)) return { entries, sources, problems }
  const paths = Array.isArray(shelves) && shelves.every(s => isMapping(s) && typeof s.path === 'string' && s.path !== '')
    ? (shelves as { path: string }[]).map(s => s.path) : null
  if (!paths) return { entries, sources, problems: [{ shelf: 'federation.yaml', sentence: 'federation.yaml: library.shelves must be a list of { path }.' }] }
  const taken = new Map<string, string>(entries.map(e => [e.id, 'framework']))
  const names = new Set(['framework'])
  for (const path of paths) {
    const dir = isAbsolute(path) ? path : resolve(repo, path)
    const shelf = readShelf(dir, path, taken, builtins)
    if (shelf.name && names.has(shelf.name)) {
      problems.push({ shelf: path, sentence: `Two shelves are named ${shelf.name}; the second, ${path}, is left out.` })
      continue
    }
    problems.push(...shelf.problems)
    if (!shelf.name) continue
    names.add(shelf.name)
    for (const e of shelf.entries) { entries.push(e); taken.set(e.id, shelf.name) }
    if (shelf.entries.length > 0) sources.push(shelf.name)
  }
  return { entries, sources, problems }
}
