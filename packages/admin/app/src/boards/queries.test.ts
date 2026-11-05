import { describe, it, expect } from 'vitest'
import { stagedBoard } from './queries.ts'
import { boardRead, changeView } from '../test/data.ts'
import type { Op } from '../api.ts'

const op = (o: Partial<Op> & Pick<Op, 'op'>): Op => ({ record: 'boards:team', base: null, before: null, ...o } as Op)

describe('stagedBoard (Review Focus 5: a staged board shows after a reload)', () => {
  it('is the board on file when nothing is staged for it', () => {
    const read = boardRead({ id: 'team' })
    expect(stagedBoard('team', read, changeView())).toEqual({ board: read, staged: false })
  })
  it('is a staged create, as an instance board, even with nothing on file', () => {
    const view = changeView({ ops: [op({ op: 'create', value: { id: 'team', name: 'Team', layout: 'flow', blocks: [] } })] })
    expect(stagedBoard('team', undefined, view)).toEqual({ staged: true,
      board: { id: 'team', name: 'Team', audience: 'members', layout: 'flow', blocks: [], origin: 'instance', overrides: false } })
  })
  it('is a staged copy of a built-in, as overriding it', () => {
    const read = boardRead({ id: 'team', origin: 'builtin' })
    const view = changeView({ ops: [op({ op: 'create', value: { ...read, name: 'Ours' } })] })
    expect(stagedBoard('team', read, view).board).toMatchObject({ name: 'Ours', origin: 'instance', overrides: true })
  })
  it('folds a staged update onto the board on file, and a staged delete leaves none', () => {
    const read = boardRead({ id: 'team', origin: 'instance' })
    expect(stagedBoard('team', read, changeView({ ops: [op({ op: 'update', set: { layout: 'grid' } })] })).board!.layout).toBe('grid')
    expect(stagedBoard('team', read, changeView({ ops: [op({ op: 'delete' })] }))).toEqual({ board: null, staged: true })
  })
  it('shows the built-in a staged delete of its override brings back, saying so (final review M-3)', () => {
    const read = boardRead({ id: 'team', origin: 'instance', overrides: true, name: 'Ours' })
    const builtin = boardRead({ id: 'team', origin: 'builtin', overrides: false, name: 'Team' })
    const view = changeView({ ops: [op({ op: 'delete' })] })
    expect(stagedBoard('team', read, view, builtin)).toEqual({ board: builtin, staged: true, restores: true })
    expect(stagedBoard('team', read, view)).toEqual({ board: null, staged: true })
  })
  it('folds several staged ops in order, so a second edit builds on the first (no fork)', () => {
    const read = boardRead({ id: 'team', origin: 'instance', name: 'Old' })
    const view = changeView({ ops: [op({ op: 'update', set: { name: 'One' } }), op({ op: 'update', set: { layout: 'grid' } })] })
    expect(stagedBoard('team', read, view).board).toMatchObject({ name: 'One', layout: 'grid' })
  })
})
