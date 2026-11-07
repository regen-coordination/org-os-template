import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import type { BoardRead } from '../api.ts'

/** packages/admin/boards/*.yaml as GET /api/boards serves them with no data/boards.yaml.
 *  Paths, not URLs: under jsdom the global URL is not Node's, and fs refuses it. */
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'boards')
export const BUILTIN_BOARDS: BoardRead[] = readdirSync(DIR).filter(f => f.endsWith('.yaml')).sort()
  .map(f => ({ ...(parse(readFileSync(join(DIR, f), 'utf8')) as Omit<BoardRead, 'origin' | 'overrides'>), origin: 'builtin', overrides: false }))
export const builtinBoard = (id: string): BoardRead => BUILTIN_BOARDS.find(b => b.id === id)!
