// packages/admin/app/src/boards/arrange.test.ts
import { describe, it, expect } from 'vitest'
import { addBlock, changeSummary, keyDelta, moveBy, removeBlock, resizeBy, setField, stageOpFor } from './arrange.ts'
import { boardRead, changeView } from '../test/data.ts'
import type { BoardDef } from '../api.ts'

const grid: BoardDef = { id: 't', name: 'T', audience: 'members', layout: 'grid', blocks: [
  { id: 'a', type: 'note', text: '', place: { col: 1, span: 4, row: 1 } },
  { id: 'b', type: 'note', text: '', place: { col: 5, span: 8, row: 1 } },
] }
const placeOf = (b: BoardDef, id: string) => b.blocks.find(x => x.id === id)!.place

describe('moves and sizes', () => {
  it('moves a grid block by cells, inside the 12 columns and below row 1', () => {
    expect(placeOf(moveBy(grid, 'a', 3, 1), 'a')).toEqual({ col: 4, span: 4, row: 2 })
    expect(placeOf(moveBy(grid, 'a', 20, -5), 'a')).toEqual({ col: 9, span: 4, row: 1 })
  })
  it('resizes a grid block within MIN_SPAN and the right edge', () => {
    expect(placeOf(resizeBy(grid, 'a', -5, 0), 'a')).toEqual({ col: 1, span: 3, row: 1 })
    expect(placeOf(resizeBy(grid, 'b', 9, 0), 'b')).toEqual({ col: 5, span: 8, row: 1 })
  })
  it('moves and resizes a canvas block in pixels, at least 240 × 120', () => {
    const c: BoardDef = { ...grid, layout: 'canvas', blocks: [{ id: 'a', type: 'note', text: '', place: { x: 8, y: 8, w: 300, h: 200 } }] }
    expect(placeOf(moveBy(c, 'a', -64, 8), 'a')).toEqual({ x: 0, y: 16, w: 300, h: 200 })
    expect(placeOf(resizeBy(c, 'a', -200, -200), 'a')).toEqual({ x: 8, y: 8, w: 240, h: 120 })
  })
  it('reorders a flow block by one place', () => {
    const f: BoardDef = { ...grid, layout: 'flow', blocks: [{ id: 'a', type: 'note', text: '' }, { id: 'b', type: 'note', text: '' }] }
    expect(moveBy(f, 'a', 0, 1).blocks.map(x => x.id)).toEqual(['b', 'a'])
  })
})

describe('keys (ruling R-4)', () => {
  const k = (key: string, mods: Partial<Record<'shiftKey' | 'altKey', boolean>> = {}) => ({ key, shiftKey: false, altKey: false, ...mods })
  it('moves a grid by a cell, a canvas by 8 and Alt by 64, and Shift resizes', () => {
    expect(keyDelta(k('ArrowRight'), 'grid')).toEqual({ resize: false, dx: 1, dy: 0 })
    expect(keyDelta(k('ArrowDown'), 'canvas')).toEqual({ resize: false, dx: 0, dy: 8 })
    expect(keyDelta(k('ArrowLeft', { altKey: true }), 'canvas')).toEqual({ resize: false, dx: -64, dy: 0 })
    expect(keyDelta(k('ArrowRight', { shiftKey: true }), 'grid')).toEqual({ resize: true, dx: 1, dy: 0 })
    expect(keyDelta(k('a'), 'grid')).toBeNull()
  })
})

describe('adding, removing, settings', () => {
  it('adds a block under the others, with a fresh id and its type\'s defaults', () => {
    const { board, id } = addBlock(grid, 'kanban')
    expect(id).toBe('kanban-1')
    expect(board.blocks.at(-1)).toMatchObject({ id: 'kanban-1', type: 'kanban', view: { group: 'status' }, place: { col: 1, span: 12, row: 2 } })
  })
  it('removes a block and sets a field by its path, clearing an empty one', () => {
    expect(removeBlock(grid, 'a').blocks.map(x => x.id)).toEqual(['b'])
    const set = setField(grid, 'a', 'source.kind', 'project')
    expect(set.blocks[0]!.source).toEqual({ kind: 'project' })
    expect(setField(set, 'a', 'source.kind', '').blocks[0]!.source).toEqual({})
  })
  it('summarises what changed for the review', () => {
    expect(changeSummary(grid, removeBlock(moveBy(grid, 'b', 0, 1), 'a'))).toEqual(['removed a', 'moved b'])
  })
})

describe('stageOpFor: Done stages exactly one op', () => {
  it('updates an instance board on file', () => {
    expect(stageOpFor(boardRead({ id: 't', origin: 'instance' }), grid, changeView()))
      .toEqual({ op: 'update', record: 'boards:t', set: { name: 'T', layout: 'grid', blocks: grid.blocks } })
  })
  it('creates a copy of a built-in', () => {
    expect(stageOpFor(boardRead({ id: 't', origin: 'builtin' }), grid, changeView()))
      .toEqual({ op: 'create', record: 'boards:t', value: grid })
  })
  it('updates a board already in the change, so a staged create is folded, never forked (Review Focus 5)', () => {
    const view = changeView({ ops: [{ op: 'create', record: 'boards:t', base: null, before: null, value: { ...grid, blocks: [] } }] })
    expect(stageOpFor(boardRead({ id: 't', origin: 'instance' }), grid, view).op).toBe('update')
  })
})
