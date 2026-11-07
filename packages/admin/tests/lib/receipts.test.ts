import { describe, it, expect } from 'vitest'
import { RECEIPTS, receiptIdFor, receiptProblems, checkReceipts, judgedOps, judgedFiles } from '../../lib/receipts.mjs'
import { governedClassOf } from '../../lib/change-classes.mjs'
import type { StageOp } from '../../server/changes/types.ts'

// Pure: every op is built by hand, and `entriesOf` answers the files "as they are now" from a table.
type Entity = Record<string, unknown>
const files = (table: Record<string, Entity[]>) => (registry: string): Entity[] => table[registry] ?? []

const NAMES = 'library:board-onboarding names boards:onboarding, which this change does not create. Take the add out as a whole: remove its receipt op too, or discard the change.'
const NOT_DELETED = 'library:board-onboarding is marked removed, but boards:onboarding is not deleted by this change. Take the removal out as a whole, or stage it again from the library.'
const NEVER_DELETED = 'A receipt is never deleted: Remove in the library marks it removed.'
const ONLY_REMOVE = 'A receipt changes only by Remove in the library, which sets status and removed.'
const UNSEALED = 'this receipt was committed without its decision; it was not written by the platform. Correct it by hand from the commit that added it.'

const HEX = 'a'.repeat(64)
const board = (id: string, name = 'Onboarding'): StageOp => ({ op: 'create', record: `boards:${id}`, value: { id, name, layout: 'flow', blocks: [] } })
const staged = (created: string[], id = 'board-onboarding'): StageOp => ({
  op: 'create', record: `library:${id}`,
  value: {
    id, entry: 'board:onboarding', version: '1.0.0', shelf: 'framework',
    created: created.map(record => ({ record, base: null })),
    status: 'installed', by: null, at: null, decision: null, removed: null,
  },
})
const sealed = (created: string[], over: Entity = {}): Entity => ({
  id: 'board-onboarding', entry: 'board:onboarding', version: '1.0.0', shelf: 'framework',
  created: created.map(record => ({ record, base: HEX })),
  status: 'installed', by: 'bruno', at: '2026-10-29', decision: { rule: 'records/direct', change: 'chg_x' }, removed: null,
  ...over,
})
const removal: StageOp = { op: 'update', record: 'library:board-onboarding', set: { status: 'removed', removed: { by: null, at: null, decision: null } } }

describe('the receipts registry name', () => {
  it('is library', () => expect(RECEIPTS).toBe('library'))
})

describe('receiptIdFor', () => {
  it('turns the entry id into a record id', () => expect(receiptIdFor('board:onboarding', new Set())).toBe('board-onboarding'))
  it('counts on from -2 when the id is taken', () => {
    expect(receiptIdFor('board:onboarding', new Set(['board-onboarding']))).toBe('board-onboarding-2')
    expect(receiptIdFor('board:onboarding', new Set(['board-onboarding', 'board-onboarding-2']))).toBe('board-onboarding-3')
  })
})

describe('receiptProblems: an add is whole', () => {
  it('refuses a receipt that names a record the change does not create', () => {
    expect(receiptProblems([staged(['boards:onboarding'])], files({})))
      .toEqual([{ record: 'library:board-onboarding', field: '', message: NAMES }])
  })
  it('names each record the change does not create, and only those', () => {
    const ops = [board('desk'), staged(['boards:desk', 'boards:onboarding'])]
    expect(receiptProblems(ops, files({}))).toEqual([{ record: 'library:board-onboarding', field: '', message: NAMES }])
  })
  it('an update op on the named record is not a create', () => {
    const ops: StageOp[] = [{ op: 'update', record: 'boards:onboarding', set: { name: 'x' } }, staged(['boards:onboarding'])]
    expect(receiptProblems(ops, files({ boards: [{ id: 'onboarding', name: 'y' }] })))
      .toEqual([{ record: 'library:board-onboarding', field: '', message: NAMES }])
  })
  it('passes a coherent add of 2 records', () => {
    const ops = [board('onboarding'), board('desk'), staged(['boards:onboarding', 'boards:desk'])]
    expect(receiptProblems(ops, files({}))).toEqual([])
  })
  it('passes an add whose created records were folded into one create op apiece', () => {
    // A create followed by an edit in the tray is one create op holding the edit (merge.ts combine).
    const ops = [board('onboarding', 'Renamed in the tray'), staged(['boards:onboarding'])]
    expect(receiptProblems(ops, files({}))).toEqual([])
  })
})

describe('receiptProblems: a removal is whole', () => {
  it('refuses a removal while a created record that exists now has no delete op', () => {
    const now = files({ library: [sealed(['boards:onboarding'])], boards: [{ id: 'onboarding' }] })
    expect(receiptProblems([removal], now)).toEqual([{ record: 'library:board-onboarding', field: '', message: NOT_DELETED }])
  })
  it('passes a coherent removal where one created record is already gone from the file', () => {
    const now = files({ library: [sealed(['boards:onboarding', 'boards:desk'])], boards: [{ id: 'desk' }] })
    expect(receiptProblems([{ op: 'delete', record: 'boards:desk' }, removal], now)).toEqual([])
  })
  it('passes a removal whose records are all gone (the receipt alone)', () => {
    expect(receiptProblems([removal], files({ library: [sealed(['boards:onboarding'])] }))).toEqual([])
  })
})

// Task 1's review, carried into Task 6: a receipt moves one way, installed → removed, once.
describe('receiptProblems: a receipt\'s states', () => {
  const gone = sealed(['boards:onboarding'], { status: 'removed', removed: { by: 'ana', at: '2026-10-30', decision: { proposal: 'p-2026-10-30-001-ab12' } } })
  const refused = [{ record: 'library:board-onboarding', field: '', message: ONLY_REMOVE }]
  it('accepts status removed without removed (the seal adds it) on an installed receipt', () => {
    expect(receiptProblems([{ op: 'update', record: 'library:board-onboarding', set: { status: 'removed' } }], files({ library: [sealed(['boards:onboarding'])] }))).toEqual([])
  })
  it('refuses removed alone, without status', () => {
    const now = files({ library: [sealed(['boards:onboarding'])], boards: [{ id: 'onboarding' }] })
    expect(receiptProblems([{ op: 'update', record: 'library:board-onboarding', set: { removed: null } }], now)).toEqual(refused)
  })
  it('refuses un-removing a removed receipt', () => {
    expect(receiptProblems([{ op: 'update', record: 'library:board-onboarding', set: { status: 'installed', removed: null } }], files({ library: [gone] }))).toEqual(refused)
  })
  it('refuses removing a removed receipt again, which would overwrite the first removal\'s seal', () => {
    expect(receiptProblems([removal], files({ library: [gone] }))).toEqual(refused)
  })
  it('refuses an update of a receipt that is not on file', () => {
    expect(receiptProblems([removal], files({}))).toEqual(refused)
  })
  it('refuses a receipt created already removed', () => {
    const op = staged(['boards:onboarding'])
    const removedAtBirth: StageOp = { ...op, value: { ...(op as { value: Entity }).value, status: 'removed' } } as StageOp
    expect(receiptProblems([board('onboarding'), removedAtBirth], files({}))).toEqual(refused)
  })
})

describe('receiptProblems: a receipt changes only by Remove', () => {
  const now = files({ library: [sealed(['boards:onboarding'])], boards: [{ id: 'onboarding' }] })
  it('refuses a delete op on a receipt', () => {
    expect(receiptProblems([{ op: 'delete', record: 'library:board-onboarding' }], now))
      .toEqual([{ record: 'library:board-onboarding', field: '', message: NEVER_DELETED }])
  })
  it('refuses a replace on a receipt', () => {
    expect(receiptProblems([{ op: 'replace', record: 'library:board-onboarding', value: sealed(['boards:onboarding']) }], now))
      .toEqual([{ record: 'library:board-onboarding', field: '', message: ONLY_REMOVE }])
  })
  it('refuses an update setting anything but status and removed', () => {
    expect(receiptProblems([{ op: 'update', record: 'library:board-onboarding', set: { status: 'removed', version: '2.0.0' } }], now))
      .toEqual([{ record: 'library:board-onboarding', field: '', message: ONLY_REMOVE }])
  })
})

describe('receiptProblems: everything else', () => {
  it('passes a change that holds no library: op', () => {
    expect(receiptProblems([board('onboarding'), { op: 'delete', record: 'boards:desk' }], files({}))).toEqual([])
  })
  it('leaves a record that names no registry to the checks that say so', () => {
    expect(receiptProblems([{ op: 'delete', record: 'nowhere:x' }], files({}))).toEqual([])
  })
})

describe('checkReceipts: the committed tree', () => {
  it('passes a sealed receipt, installed or removed', () => {
    expect(checkReceipts([sealed(['boards:onboarding'])])).toEqual([])
    const gone = sealed(['boards:onboarding'], { status: 'removed', removed: { by: 'ana', at: '2026-10-30', decision: { proposal: 'p-2026-10-30-001-ab12' } } })
    expect(checkReceipts([gone])).toEqual([])
  })
  it('reports a receipt committed without its decision', () => {
    expect(checkReceipts([sealed(['boards:onboarding'], { decision: null })]))
      .toEqual([{ id: 'board-onboarding', path: 'decision', message: UNSEALED }])
  })
  it.each([
    ['by', { by: null }],
    ['at', { at: null }],
  ])('reports a null %s the same way', (path, over) => {
    expect(checkReceipts([sealed(['boards:onboarding'], over)])).toEqual([{ id: 'board-onboarding', path, message: UNSEALED }])
  })
  it('reports a null base, by its position', () => {
    const r = sealed(['boards:onboarding', 'boards:desk'])
    ;(r.created as Entity[])[1]!.base = null
    expect(checkReceipts([r])).toEqual([{ id: 'board-onboarding', path: 'created.1.base', message: UNSEALED }])
  })
  it('reports each null of removed on a removed receipt', () => {
    const r = sealed(['boards:onboarding'], { status: 'removed', removed: { by: null, at: null, decision: null } })
    expect(checkReceipts([r])).toEqual(['removed.by', 'removed.at', 'removed.decision'].map(path => ({ id: 'board-onboarding', path, message: UNSEALED })))
  })
})

// L1-C5: the receipt rides along. A change is judged by what it creates, never by the receipt's own class, unless it
// holds nothing else.
describe('judgedOps', () => {
  const receiptUpdate: StageOp = { op: 'update', record: 'library:board-onboarding', set: { status: 'removed' } }
  it('leaves the receipt out when the change holds anything else', () => {
    const boardOp = board('onboarding')
    expect(judgedOps([boardOp, staged(['boards:onboarding'])])).toEqual([boardOp])
  })
  it('keeps a receipt op that is alone', () => expect(judgedOps([receiptUpdate])).toEqual([receiptUpdate]))
  it('is empty for no ops', () => expect(judgedOps([])).toEqual([]))
  it('keeps an op whose record names no collection (other checks say so)', () => {
    const odd = { op: 'delete', record: 'no-colon' } as StageOp
    expect(judgedOps([odd, staged(['boards:onboarding'])])).toEqual([odd])
  })
})

describe('judgedFiles', () => {
  it('leaves data/library.yaml out when another file has a governed class', () => {
    expect(judgedFiles(['data/systems.yaml', 'data/library.yaml'], governedClassOf)).toEqual(['data/systems.yaml'])
  })
  it('keeps it when nothing else is governed', () => {
    expect(judgedFiles(['data/library.yaml', 'README.md'], governedClassOf)).toEqual(['data/library.yaml', 'README.md'])
  })
})
