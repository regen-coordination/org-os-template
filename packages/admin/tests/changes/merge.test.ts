import { describe, it, expect } from 'vitest'
import { mergeOp, isStale, rebaseOp } from '../../server/changes/merge.ts'
import { StageError, projectOp, commitMessage, notDeleted } from '../../server/changes/records.ts'
import { baseOf, canonicalYaml, sameValue } from '../../server/changes/canonical.ts'
import type { Entity } from '../../server/registry.ts'

const P = { id: 'p1', title: 'One', status: 'idea', lead: 'steward-a' }
const R = 'projects:p1'
const up = (set: Record<string, unknown>) => ({ op: 'update' as const, record: R, set })
/** The field a StageError names, or 'other' for any other error, or null when nothing was thrown. */
const refused = (fn: () => unknown): string | null => {
  try { fn(); return null } catch (e) { return e instanceof StageError ? e.field : 'other' }
}

describe('canonical serialisation and base hashes', () => {
  it('ignores key order and keeps every value', () => {
    expect(baseOf({ a: 1, b: [1, 2] })).toBe(baseOf({ b: [1, 2], a: 1 }))
    expect(baseOf({ a: 1 })).not.toBe(baseOf({ a: '1' }))
    expect(baseOf({ a: 1 })).toMatch(/^[0-9a-f]{64}$/)
    expect(baseOf(null)).toBeNull()
    expect(canonicalYaml({ b: 1, a: { d: 2, c: 'x: y' } })).toBe('a:\n  c: "x: y"\n  d: 2\nb: 1\n')
  })
  it('an absent field is not a field holding null', () => {
    expect(sameValue(undefined, null)).toBe(false)
    expect(sameValue(undefined, undefined)).toBe(true)
    expect(sameValue({ x: [1], y: 2 }, { y: 2, x: [1] })).toBe(true)
  })
})

describe('records (the parse and the projection moved to tests/lib/ops.test.ts)', () => {
  it('the commit message: the reviewed subject for one op, a list for more', () => {
    expect(commitMessage([up({ status: 'develop' })])).toBe('admin(projects): update p1')
    expect(commitMessage([up({ status: 'develop' }), { op: 'create', record: 'ideas:i1', value: { id: 'i1' } }]))
      .toBe('admin(projects, ideas): apply 2 changes\n\n- update projects:p1 (status)\n- create ideas:i1')
  })
})

describe('ops for the same record merge', () => {
  it('an update records its base and the entry it was staged against', () => {
    expect(mergeOp([], up({ status: 'develop' }), P)).toEqual([
      { op: 'update', record: R, set: { status: 'develop' }, base: baseOf(P), before: P },
    ])
  })
  it('update set fields combine', () => {
    const ops = mergeOp(mergeOp([], up({ status: 'develop' }), P), up({ title: 'Two' }), P)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'update', set: { status: 'develop', title: 'Two' }, base: baseOf(P) })
  })
  it('a field set back to its value leaves the op; an op with nothing left disappears', () => {
    let ops = mergeOp(mergeOp([], up({ status: 'develop' }), P), up({ title: 'Two' }), P)
    ops = mergeOp(ops, up({ status: 'idea' }), P)
    expect(ops[0]).toMatchObject({ set: { title: 'Two' } })
    expect(mergeOp(ops, up({ title: 'One' }), P)).toEqual([])
    expect(mergeOp([], up({ status: 'idea' }), P)).toEqual([])
  })
  it('a create takes its id from the record; an update after it folds in', () => {
    const created = mergeOp([], { op: 'create', record: 'projects:p2', value: { title: 'New' } }, null)
    expect(mergeOp(created, { op: 'update', record: 'projects:p2', set: { status: 'idea' } }, null)).toEqual([
      { op: 'create', record: 'projects:p2', value: { id: 'p2', title: 'New', status: 'idea' }, base: null, before: null },
    ])
  })
  it('a delete replaces earlier ops on the record and keeps their base', () => {
    expect(mergeOp(mergeOp([], up({ status: 'develop' }), P), { op: 'delete', record: R }, P)).toEqual([
      { op: 'delete', record: R, base: baseOf(P), before: P },
    ])
  })
  it('create then delete leaves nothing; delete then create is a replace', () => {
    const created = mergeOp([], { op: 'create', record: 'projects:p2', value: { id: 'p2' } }, null)
    expect(mergeOp(created, { op: 'delete', record: 'projects:p2' }, null)).toEqual([])
    const deleted = mergeOp([], { op: 'delete', record: R }, P)
    expect(mergeOp(deleted, { op: 'create', record: R, value: { ...P, title: 'Back' } }, P)).toEqual([
      { op: 'replace', record: R, value: { ...P, title: 'Back' }, base: baseOf(P), before: P },
    ])
  })
  it('replace is the whole entry; a replace holding the same data is no op', () => {
    expect(mergeOp([], { op: 'replace', record: R, value: { lead: 'steward-a', status: 'idea', title: 'One', id: 'p1' } }, P)).toEqual([])
    expect(mergeOp([], { op: 'replace', record: R, value: { id: 'p1', title: 'Only' } }, P)[0])
      .toMatchObject({ op: 'replace', value: { id: 'p1', title: 'Only' }, base: baseOf(P) })
  })
  it('keeps the position of the first op on a record', () => {
    let ops = mergeOp([], up({ status: 'develop' }), P)
    ops = mergeOp(ops, { op: 'create', record: 'ideas:i1', value: {} }, null)
    ops = mergeOp(ops, up({ title: 'Two' }), P)
    expect(ops.map(o => o.record)).toEqual([R, 'ideas:i1'])
  })
  it('refuses what cannot be staged, naming the field', () => {
    expect(refused(() => mergeOp([], up({ status: 'x' }), null))).toBe('')                       // no such entry
    expect(refused(() => mergeOp([], { op: 'create', record: R, value: {} }, P))).toBe('id')      // already there
    expect(refused(() => mergeOp([], { op: 'replace', record: R, value: { id: 'p9' } }, P))).toBe('id')
    expect(refused(() => mergeOp([], up({ id: 'p9' }), P))).toBe('id')
    expect(refused(() => mergeOp([], { op: 'create', record: 'projects:', value: {} }, null))).toBe('id')
    expect(refused(() => mergeOp(mergeOp([], { op: 'delete', record: R }, P), up({ title: 'x' }), P))).toBe('')
  })
})

describe('every pair of ops on one record (final review)', () => {
  const ONLY = { id: 'p1', title: 'Only' }
  const replace = (value: Record<string, unknown>) => ({ op: 'replace' as const, record: R, value })
  const del = { op: 'delete' as const, record: R }
  const fromP = { base: baseOf(P), before: P }

  it('update then replace: the replace\'s whole entry, on the first op\'s base', () => {
    expect(mergeOp(mergeOp([], up({ status: 'develop' }), P), replace(ONLY), P)).toEqual([{ op: 'replace', record: R, value: ONLY, ...fromP }])
  })
  it('replace then update: the replaced entry with the update folded in; back to the file\'s entry, nothing', () => {
    const replaced = mergeOp([], replace(ONLY), P)
    expect(mergeOp(replaced, up({ status: 'develop' }), P)).toEqual([{ op: 'replace', record: R, value: { ...ONLY, status: 'develop' }, ...fromP }])
    expect(mergeOp(mergeOp([], replace({ ...P, title: 'Two' }), P), up({ title: 'One' }), P)).toEqual([])
  })
  it('create then replace: still a create, holding the replace\'s entry with the record\'s id', () => {
    const created = mergeOp([], { op: 'create', record: 'projects:p2', value: { id: 'p2', title: 'New' } }, null)
    expect(mergeOp(created, { op: 'replace', record: 'projects:p2', value: { title: 'Other' } }, null)).toEqual([
      { op: 'create', record: 'projects:p2', value: { id: 'p2', title: 'Other' }, base: null, before: null },
    ])
  })
  it('replace then delete: a delete on the first op\'s base', () => {
    expect(mergeOp(mergeOp([], replace(ONLY), P), del, P)).toEqual([{ op: 'delete', record: R, ...fromP }])
  })
  it('delete then delete, and delete then replace, are refused', () => {
    const deleted = mergeOp([], del, P)
    expect(refused(() => mergeOp(deleted, del, P))).toBe('')
    expect(refused(() => mergeOp(deleted, replace(ONLY), P))).toBe('')
    expect(() => mergeOp(deleted, replace(ONLY), P)).toThrow('projects "p1" is staged to be deleted: take that op out of the change first.')
  })
  it('delete then create of the same entry leaves nothing', () => {
    expect(mergeOp(mergeOp([], del, P), { op: 'create', record: R, value: { ...P } }, P)).toEqual([])
  })
})

describe('stale ops, and the two ways back', () => {
  const staged = mergeOp([], up({ status: 'develop', title: 'Mine' }), P)[0]!
  const theirs = { ...P, title: 'Theirs' }
  it('an op is stale when its record changed since it was staged', () => {
    expect(isStale(staged, P)).toBe(false)
    expect(isStale(staged, theirs)).toBe(true)
    expect(isStale(staged, null)).toBe(true)
    expect(isStale({ op: 'create', record: 'projects:p2', value: { id: 'p2' }, base: null, before: null }, { id: 'p2' })).toBe(true)
  })
  it('take theirs drops the fields both sides changed and re-bases the rest', () => {
    expect(rebaseOp(staged, theirs, 'theirs')).toEqual({ op: 'update', record: R, set: { status: 'develop' }, base: baseOf(theirs), before: theirs })
  })
  it('keep mine re-bases every field on the current entry', () => {
    expect(rebaseOp(staged, theirs, 'mine')).toEqual({ op: 'update', record: R, set: { status: 'develop', title: 'Mine' }, base: baseOf(theirs), before: theirs })
  })
  it('a record deleted elsewhere: theirs drops the op, mine stages it again as a create', () => {
    expect(rebaseOp(staged, null, 'theirs')).toBeNull()
    expect(rebaseOp(staged, null, 'mine')).toEqual({ op: 'create', record: R, value: { ...P, status: 'develop', title: 'Mine' }, base: null, before: null })
  })
  it('a stale create: theirs drops it, mine makes it a replace', () => {
    const create = { op: 'create' as const, record: 'projects:p2', value: { id: 'p2', title: 'Mine' }, base: null, before: null }
    expect(rebaseOp(create, { id: 'p2' }, 'theirs')).toBeNull()
    expect(rebaseOp(create, { id: 'p2' }, 'mine')).toEqual({ op: 'replace', record: 'projects:p2', value: { id: 'p2', title: 'Mine' }, base: baseOf({ id: 'p2' }), before: { id: 'p2' } })
  })
  it('a stale delete: theirs drops it, mine deletes the entry as it is now', () => {
    const deleted = mergeOp([], { op: 'delete', record: R }, P)[0]!
    expect(rebaseOp(deleted, theirs, 'theirs')).toBeNull()
    expect(rebaseOp(deleted, theirs, 'mine')).toEqual({ op: 'delete', record: R, base: baseOf(theirs), before: theirs })
    expect(rebaseOp(deleted, null, 'mine')).toBeNull() // deleted elsewhere too: nothing left to do
  })
  it('a stale replace: theirs drops it, mine replaces the entry as it is now', () => {
    const replaced = mergeOp([], { op: 'replace', record: R, value: { id: 'p1', title: 'Mine' } }, P)[0]!
    expect(rebaseOp(replaced, theirs, 'theirs')).toBeNull()
    expect(rebaseOp(replaced, theirs, 'mine')).toEqual({ op: 'replace', record: R, value: { id: 'p1', title: 'Mine' }, base: baseOf(theirs), before: theirs })
    expect(rebaseOp(replaced, null, 'mine')).toEqual({ op: 'create', record: R, value: { id: 'p1', title: 'Mine' }, base: null, before: null })
  })
  it('a stale create the file now holds exactly: nothing is left of it either way', () => {
    const create = { op: 'create' as const, record: 'projects:p2', value: { id: 'p2', title: 'Mine' }, base: null, before: null }
    expect(rebaseOp(create, { id: 'p2', title: 'Mine' }, 'mine')).toBeNull()
    expect(rebaseOp(create, { id: 'p2', title: 'Mine' }, 'theirs')).toBeNull()
  })
  it('an op that is not stale is left as it is', () => {
    expect(rebaseOp(staged, P, 'theirs')).toBe(staged)
  })
})

describe('ids the platform reads as strings, and entries with none (S11, S12)', () => {
  it('a numeric id is addressable: projected, merged and rebased like a string id', () => {
    const entries = new Map<string, Entity[]>([['projects', [{ id: 42, title: 'N' }]]])
    projectOp(entries, { op: 'update', record: 'projects:42', set: { title: 'M' } })
    projectOp(entries, { op: 'delete', record: 'ideas:42' })
    expect(entries.get('projects')).toEqual([{ id: 42, title: 'M' }])
    projectOp(entries, { op: 'delete', record: 'projects:42' })
    expect(entries.get('projects')).toEqual([])
    const current = { id: 42, title: 'N' }
    expect(mergeOp([], { op: 'update', record: 'projects:42', set: { title: 'M' } }, current)[0])
      .toMatchObject({ op: 'update', set: { title: 'M' }, base: baseOf(current) })
    expect(mergeOp([], { op: 'update', record: 'projects:42', set: { id: 42, title: 'M' } }, current)[0]).toMatchObject({ set: { title: 'M' } })
    expect(mergeOp([], { op: 'replace', record: 'projects:42', value: { id: 42, title: 'M' } }, current)[0]).toMatchObject({ op: 'replace' })
  })
  it('a delete refusal names a referrer with no id by its position', () => {
    const text = notDeleted('members', 'ana', [{ registry: 'projects', id: '#2', field: 'contributors' }, { registry: 'projects', id: 'p1', field: 'lead' }])
    expect(text).toContain('projects "#2" (contributors), projects "p1" (lead)')
    expect(text).not.toContain('undefined')
  })
  it('a record with no id is refused in one sentence, from merge and from records alike', () => {
    expect(() => mergeOp([], { op: 'create', record: 'projects:', value: {} }, null)).toThrow(/"projects:" has no id after the colon/)
  })
})
