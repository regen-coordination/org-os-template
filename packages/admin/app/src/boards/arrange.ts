// packages/admin/app/src/boards/arrange.ts
import { CANVAS_MIN, GRID_COLUMNS, MIN_SPAN } from '../../../lib/board-query.mjs'
import type { BlockEntry, BoardDef, BoardRead, CanvasPlace, ChangeView, GridPlace, Layout, StageOp } from '../api.ts'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const gridOf = (x: BlockEntry): GridPlace => ({ col: 1, span: GRID_COLUMNS, row: 1, ...(x.place as Partial<GridPlace> | undefined) })
const canvasOf = (x: BlockEntry): CanvasPlace => ({ x: 0, y: 0, w: 480, h: 320, ...(x.place as Partial<CanvasPlace> | undefined) })
const mapBlock = (b: BoardDef, id: string, f: (x: BlockEntry) => BlockEntry): BoardDef => ({ ...b, blocks: b.blocks.map(x => (x.id === id ? f(x) : x)) })

/** Move by cells (grid), pixels (canvas) or places (flow, by dy's sign). */
export function moveBy(b: BoardDef, id: string, dx: number, dy: number): BoardDef {
  if (b.layout === 'flow') {
    const i = b.blocks.findIndex(x => x.id === id)
    const j = clamp(i + Math.sign(dy), 0, b.blocks.length - 1)
    if (i < 0 || i === j) return b
    const blocks = [...b.blocks]
    const [x] = blocks.splice(i, 1)
    blocks.splice(j, 0, x!)
    return { ...b, blocks }
  }
  return mapBlock(b, id, x => {
    if (b.layout === 'grid') {
      const p = gridOf(x)
      return { ...x, place: { col: clamp(p.col + dx, 1, GRID_COLUMNS - p.span + 1), span: p.span, row: Math.max(1, p.row + dy) } }
    }
    const p = canvasOf(x)
    return { ...x, place: { x: Math.max(0, p.x + dx), y: Math.max(0, p.y + dy), w: p.w, h: p.h } }
  })
}

/** Resize by columns (grid; height follows the content) or pixels (canvas). A flow has no sizes. */
export function resizeBy(b: BoardDef, id: string, dw: number, dh: number): BoardDef {
  if (b.layout === 'flow') return b
  return mapBlock(b, id, x => {
    if (b.layout === 'grid') {
      const p = gridOf(x)
      return { ...x, place: { col: p.col, span: clamp(p.span + dw, MIN_SPAN, GRID_COLUMNS - p.col + 1), row: p.row } }
    }
    const p = canvasOf(x)
    return { ...x, place: { x: p.x, y: p.y, w: Math.max(CANVAS_MIN.w, p.w + dw), h: Math.max(CANVAS_MIN.h, p.h + dh) } }
  })
}

/** A key as an edit while a block is picked up (ruling R-4): arrows move (grid by a cell, canvas by 8 px,
 *  Alt by 64), Shift+arrows resize. Null for any other key. */
export function keyDelta(e: { key: string; shiftKey: boolean; altKey: boolean }, layout: Layout): { resize: boolean; dx: number; dy: number } | null {
  const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
  const d = dir[e.key]
  if (!d) return null
  const step = layout === 'canvas' ? (e.altKey ? 64 : 8) : 1
  return { resize: e.shiftKey, dx: d[0] * step, dy: d[1] * step }
}

/** What a new block of each type starts as. A record or system block starts without its target, and
 *  staging says so until its settings name one. */
export const NEW_BLOCK: Record<string, Omit<BlockEntry, 'id' | 'place'>> = {
  list: { type: 'list', title: 'Projects', source: { kind: 'project' } },
  kanban: { type: 'kanban', title: 'Projects by status', source: { kind: 'project' }, view: { group: 'status', columns: ['idea', 'active', 'done'] } },
  map: { type: 'map', title: 'Organization map', source: { map: 'organization' } },
  record: { type: 'record', source: { record: '' } },
  metric: { type: 'metric', title: 'Projects', source: { kind: 'project' }, view: { measure: 'count', label: 'projects' } },
  system: { type: 'system', source: { system: '' } },
  proposals: { type: 'proposals', title: 'Open proposals', source: { proposals: 'open' } },
  note: { type: 'note', title: 'Note', text: '', view: { empty: 'This note is empty. Arrange, then Settings, to write it.' } },
}

export function addBlock(b: BoardDef, type: string): { board: BoardDef; id: string } {
  const ids = new Set(b.blocks.map(x => x.id))
  let n = 1
  while (ids.has(`${type}-${n}`)) n++
  const id = `${type}-${n}`
  const base: BlockEntry = { ...(NEW_BLOCK[type] ?? { type }), id }
  if (b.layout === 'flow') return { board: { ...b, blocks: [...b.blocks, base] }, id }
  const place = b.layout === 'grid'
    ? { col: 1, span: GRID_COLUMNS, row: Math.max(0, ...b.blocks.map(x => gridOf(x).row)) + 1 }
    : { x: 0, y: Math.max(0, ...b.blocks.map(x => { const p = canvasOf(x); return p.y + p.h + 16 })), w: 480, h: 320 }
  return { board: { ...b, blocks: [...b.blocks, { ...base, place }] }, id }
}

export const removeBlock = (b: BoardDef, id: string): BoardDef => ({ ...b, blocks: b.blocks.filter(x => x.id !== id) })

/** A block field by its dot path (`title`, `source.kind`, `view.columns`: P4-C11). */
export function getField(entry: BlockEntry, path: string): unknown {
  return path.split('.').reduce<unknown>((v, k) => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[k] : undefined), entry)
}

/** Set a block field by its dot path; '' or undefined removes it. */
export function setField(b: BoardDef, id: string, path: string, value: unknown): BoardDef {
  const keys = path.split('.')
  const put = (obj: Record<string, unknown>, i: number): Record<string, unknown> => {
    const k = keys[i]!
    const out = { ...obj }
    if (i === keys.length - 1) { if (value === '' || value === undefined) delete out[k]; else out[k] = value; return out }
    const inner = typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k]) ? (obj[k] as Record<string, unknown>) : {}
    out[k] = put(inner, i + 1)
    return out
  }
  return mapBlock(b, id, x => put(x as unknown as Record<string, unknown>, 0) as unknown as BlockEntry)
}

/** What Arrange changed, in a line each, for the review. */
export function changeSummary(base: BoardDef, draft: BoardDef): string[] {
  const out: string[] = []
  if (base.name !== draft.name) out.push(`renamed to ${draft.name}`)
  if (base.layout !== draft.layout) out.push(`layout ${base.layout} → ${draft.layout}`)
  const before = new Map(base.blocks.map(x => [x.id, x]))
  const after = new Map(draft.blocks.map(x => [x.id, x]))
  for (const id of before.keys()) if (!after.has(id)) out.push(`removed ${id}`)
  for (const [id, x] of after) {
    const was = before.get(id)
    if (!was) { out.push(`added ${id}`); continue }
    const { place: p1, ...rest1 } = was
    const { place: p2, ...rest2 } = x
    if (JSON.stringify(rest1) !== JSON.stringify(rest2)) out.push(`changed ${id}`)
    else if (JSON.stringify(p1) !== JSON.stringify(p2)) out.push(`moved ${id}`)
  }
  if (base.layout === 'flow' && draft.layout === 'flow' && out.length === 0 && base.blocks.map(x => x.id).join() !== draft.blocks.map(x => x.id).join()) out.push('reordered')
  return out
}

/** The one op Done stages (contract "P4c produces"). A board already in your change, or one the instance's
 *  file holds, is updated, so the change keeps one op for it. A built-in, or a board new to both, is created. */
export function stageOpFor(base: BoardRead | null, draft: BoardDef, change: ChangeView | null): StageOp {
  const record = `boards:${draft.id}`
  const inChange = change?.ops.some(o => o.record === record) ?? false
  if (inChange || base?.origin === 'instance') return { op: 'update', record, set: { name: draft.name, layout: draft.layout, blocks: draft.blocks } }
  return { op: 'create', record, value: { id: draft.id, name: draft.name, audience: draft.audience, layout: draft.layout, blocks: draft.blocks } }
}
