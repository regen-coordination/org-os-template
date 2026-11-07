/** Boards (P4 spec §5.1; contract "P4c produces"). */
export type Layout = 'grid' | 'canvas' | 'flow'
export type GridPlace = { col: number; span: number; row: number }
export type CanvasPlace = { x: number; y: number; w: number; h: number }
export type Place = GridPlace | CanvasPlace | Record<string, never>
export interface BlockEntry { id: string; type: string; title?: string; source?: unknown; view?: Record<string, unknown>; text?: string; place?: Place }
export interface BoardDef { id: string; name: string; audience: string; layout: Layout; blocks: BlockEntry[] }
/** A board as GET /api/boards serves it. The contract calls it BoardView; it is BoardRead because
 *  app/src/api.ts already has a BoardView, a map's graph (P4-C8). */
export interface BoardRead extends BoardDef { origin: 'builtin' | 'instance'; overrides: boolean }

/** The record part of a served board: what a staged create or update holds. */
export const boardDefOf = (b: BoardDef): BoardDef => ({ id: b.id, name: b.name, audience: b.audience, layout: b.layout, blocks: b.blocks })
