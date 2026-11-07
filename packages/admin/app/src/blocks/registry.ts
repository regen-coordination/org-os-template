import type { BlockDef } from './types.ts'

// The registry holds defs of any config; each def types its own.
const TYPES = new Map<string, BlockDef<any>>()

/** Registers a block type (spec §4.3). A type defined twice is a mistake, except when the dev
 *  server reloads the module that defined it. */
export function defineBlock<C>(def: BlockDef<C>): BlockDef<C> {
  if (TYPES.has(def.type) && !(import.meta as { hot?: unknown }).hot) throw new Error(`block type "${def.type}" is defined twice`)
  TYPES.set(def.type, def)
  return def
}

export const blockType = (type: string): BlockDef | undefined => TYPES.get(type)
export const blockTypes = (): BlockDef[] => [...TYPES.values()]
