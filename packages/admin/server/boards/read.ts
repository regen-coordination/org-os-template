import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { currentEntries } from '../changes/stage.ts'
import type { BoardDef, BoardRead, Layout } from './types.ts'

/** The framework's boards (P4 spec §5.2): one per file, served in this order. */
export const BUILTIN_DIR = fileURLToPath(new URL('../../boards/', import.meta.url))
export const BUILTIN_ORDER = ['home', 'projects', 'people', 'funding', 'partners', 'ideas', 'meetings', 'treasury',
  'crew', 'modules', 'fleet', 'sources', 'outside-systems', 'organization', 'systems']

const LAYOUTS: Layout[] = ['grid', 'canvas', 'flow']
const isMapping = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** An entry as a board, with the defaults a hand-written one may leave out; null when it has no id.
 *  What it may still get wrong (a block type, a place) is validate:data's to say, and the block's
 *  frame shows it. */
function asBoard(e: unknown): BoardDef | null {
  if (!isMapping(e) || typeof e.id !== 'string' || e.id === '') return null
  return {
    id: e.id,
    name: typeof e.name === 'string' && e.name !== '' ? e.name : e.id,
    audience: typeof e.audience === 'string' && e.audience !== '' ? e.audience : 'members',
    layout: LAYOUTS.includes(e.layout as Layout) ? (e.layout as Layout) : 'flow',
    blocks: Array.isArray(e.blocks) ? (e.blocks.filter(isMapping) as unknown as BoardDef['blocks']) : [],
  }
}

export function builtinBoards(dir: string = BUILTIN_DIR): BoardDef[] {
  const boards = readdirSync(dir).filter(f => f.endsWith('.yaml')).map(f => {
    const b = asBoard(parse(readFileSync(join(dir, f), 'utf8')))
    if (!b || `${b.id}.yaml` !== f) throw new Error(`packages/admin/boards/${f}: a built-in board's file is named after its id`)
    return b
  })
  const rank = (id: string) => { const i = BUILTIN_ORDER.indexOf(id); return i < 0 ? BUILTIN_ORDER.length : i }
  return boards.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
}

/** data/boards.yaml's boards, the first of each id (validate:data warns of a repeated one). A file with
 *  YAML errors throws the writes' own 409 (`currentEntries` strict), so no half-read board is served. */
export function instanceBoards(repo: string): BoardDef[] {
  const seen = new Set<string>()
  const out: BoardDef[] = []
  for (const e of currentEntries(repo, 'boards', true)) {
    const b = asBoard(e)
    if (b && !seen.has(b.id)) { seen.add(b.id); out.push(b) }
  }
  return out
}

/** The built-ins in order, each replaced wholesale by the instance's board of its id (spec §12), then
 *  the instance's own boards in file order. */
export function boardsOf(repo: string, builtins: BoardDef[] = builtinBoards()): BoardRead[] {
  const own = new Map(instanceBoards(repo).map(b => [b.id, b]))
  const out: BoardRead[] = builtins.map(b => {
    const mine = own.get(b.id)
    return mine ? { ...mine, origin: 'instance', overrides: true } : { ...b, origin: 'builtin', overrides: false }
  })
  for (const b of own.values()) if (!builtins.some(x => x.id === b.id)) out.push({ ...b, origin: 'instance', overrides: false })
  return out
}
