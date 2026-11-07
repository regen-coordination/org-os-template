import { describe, it, expect } from 'vitest'
import { mergeLedgers, checkProposals, revOf } from '../../lib/proposals.mjs'
import { CHANGE_CLASSES, classOf } from '../../lib/change-classes.mjs'

// Two machines each kept a copy of data/proposals.yaml since the last Sync (`base`); Sync merges them by id.
const MEMBERS = [{ id: 'ana' }, { id: 'bruno' }, { id: 'carla' }]
const GOVERNANCE = { roles: { maintainer: { members: ['ana', 'bruno'] }, member: { all: true } } }
const RECORDS = { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } }
const OPS = [{ op: 'update', record: 'projects:alpha', set: { stage: 'develop' }, base: 'a'.repeat(64) }]
const OPS2 = [{ op: 'update', record: 'projects:alpha', set: { stage: 'closed' }, base: 'a'.repeat(64) }]
const OPS3 = [{ op: 'update', record: 'projects:alpha', set: { stage: 'idea' }, base: 'a'.repeat(64) }]
const at = (h: number, m = 0) => `2026-10-18T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'p-2026-10-18-001', title: 'Move one project', author: 'carla', classes: ['records'], rules: [RECORDS], state: 'open',
  opened: at(9), rev: revOf(OPS), base: 'c0ffee1', branch: 'proposal/p-2026-10-18-001', ops: OPS, events: [], closed: null, ...over,
})
const ev = (id: string, h: number, kind = 'comment', over: Record<string, unknown> = {}) =>
  ({ id, at: at(h), by: 'bruno', kind, ...(kind === 'comment' ? { text: 'ok' } : { rev: revOf(OPS) }), ...over })
const ids = (e: { events: { id: string }[] }) => e.events.map(x => x.id)
const merged = (base: unknown[], ours: unknown[], theirs: unknown[]) => {
  const r = mergeLedgers(base as never, ours as never, theirs as never)
  if (!r.ok) throw new Error(`refused: ${r.reason}`)
  return r.entries as ReturnType<typeof entry>[]
}
const refused = (base: unknown[], ours: unknown[], theirs: unknown[]) => {
  const r = mergeLedgers(base as never, ours as never, theirs as never)
  return r.ok ? null : r.reason
}

describe('mergeLedgers', () => {
  it('two sides each appending an event to one proposal: both kept, ordered by `at`, then id', () => {
    const base = [entry()]
    const ours = [entry({ events: [ev('e-o', 11, 'approve')] })]
    const theirs = [entry({ events: [ev('e-t', 10)] })]
    expect(ids(merged(base, ours, theirs)[0]!)).toEqual(['e-t', 'e-o'])
    expect(ids(merged(base, theirs, ours)[0]!)).toEqual(['e-t', 'e-o']) // the same whichever side is "ours"
  })
  it('orders by the instant, not the text: an event written on another offset', () => {
    const ours = [entry({ events: [ev('e-o', 11, 'comment', { at: '2026-10-18T10:30:00+00:00' })] })]
    const theirs = [entry({ events: [ev('e-t', 11, 'comment', { at: '2026-10-18T09:45:00-01:00' })] })]
    expect(ids(merged([entry()], ours, theirs)[0]!)).toEqual(['e-o', 'e-t'])
  })
  it('an event on both sides is one event', () => {
    const shared = ev('e-1', 10)
    const r = merged([entry({ events: [shared] })], [entry({ events: [shared, ev('e-o', 11)] })], [entry({ events: [shared, ev('e-t', 12)] })])
    expect(ids(r[0]!)).toEqual(['e-1', 'e-o', 'e-t'])
  })
  it('each side adding a different proposal: both are kept', () => {
    const a2 = entry({ id: 'p-2026-10-18-002', branch: 'proposal/p-2026-10-18-002' })
    const a3 = entry({ id: 'p-2026-10-19-001', branch: 'proposal/p-2026-10-19-001' })
    const r = merged([entry()], [entry(), a2], [entry(), a3])
    expect(r.map(e => e.id)).toEqual(['p-2026-10-18-001', 'p-2026-10-18-002', 'p-2026-10-19-001'])
  })
  it('one side ratified, the other still open with a new event: ratified wins and the event is kept', () => {
    const closed = { at: at(12), by: 'bruno', decision: 'gov-20261018-001' }
    const ours = [entry({ state: 'ratified', closed, events: [ev('e-a', 11, 'approve'), ev('e-r', 12, 'ratify', { rev: undefined })] })]
    const theirs = [entry({ events: [ev('e-c', 11, 'comment')] })]
    const [r] = merged([entry()], ours, theirs)
    expect(r).toMatchObject({ state: 'ratified', closed })
    expect(ids(r!)).toEqual(['e-a', 'e-c', 'e-r'])
    const [again] = merged([entry()], theirs, ours)
    expect(again).toEqual(r)
  })
  it('both closed, in different ways: refused, naming the proposal', () => {
    const ours = [entry({ state: 'ratified', closed: { at: at(12), by: 'bruno' } })]
    const theirs = [entry({ state: 'rejected', closed: { at: at(12), by: 'ana' } })]
    expect(refused([entry()], ours, theirs)).toMatch(/p-2026-10-18-001.*closed two ways: ratified on one side, rejected on the other/)
  })
  it('both closed the same way: one closing', () => {
    const closed = { at: at(12), by: 'bruno' }
    const side = [entry({ state: 'withdrawn', closed: { ...closed, by: 'carla' } })]
    expect(merged([entry()], side, side)[0]).toMatchObject({ state: 'withdrawn' })
  })
  it('the side with the later `revise` event wins `ops` and `rev`', () => {
    const r2 = revOf(OPS2)
    const r3 = revOf(OPS3)
    const ours = [entry({ ops: OPS2, rev: r2, events: [ev('e-v2', 12, 'revise', { rev: r2, ops: OPS2 })] })]
    const theirs = [entry({ ops: OPS3, rev: r3, events: [ev('e-v3', 13, 'revise', { rev: r3, ops: OPS3 })] })]
    const [r] = merged([entry()], ours, theirs)
    expect(r).toMatchObject({ rev: r3, ops: OPS3 })
    expect(ids(r!)).toEqual(['e-v2', 'e-v3'])
    expect(merged([entry()], theirs, ours)[0]).toMatchObject({ rev: r3, ops: OPS3 })
  })
  it('a side’s latest `revise` is the one that counts, not its first', () => {
    const [r1, r2, r3] = [revOf(OPS2), revOf(OPS3), revOf([{ ...OPS[0], set: { stage: 'x' } }])]
    const ours = [entry({ ops: OPS3, rev: r2, events: [ev('e-a', 11, 'revise', { rev: r1, ops: OPS2 }), ev('e-b', 14, 'revise', { rev: r2, ops: OPS3 })] })]
    const theirs = [entry({ ops: [{ ...OPS[0], set: { stage: 'x' } }], rev: r3, events: [ev('e-c', 12, 'revise', { rev: r3 })] })]
    expect(merged([entry()], ours, theirs)[0]).toMatchObject({ rev: r2, ops: OPS3 }) // ours revised last, at 14
    expect(merged([entry()], theirs, ours)[0]).toMatchObject({ rev: r2, ops: OPS3 })
  })
  it('a revise on one side and nothing on the other: the revise wins', () => {
    const r2 = revOf(OPS2)
    const ours = [entry({ ops: OPS2, rev: r2, events: [ev('e-v2', 12, 'revise', { rev: r2, ops: OPS2 })] })]
    const theirs = [entry({ events: [ev('e-c', 11)] })]
    expect(merged([entry()], ours, theirs)[0]).toMatchObject({ rev: r2, ops: OPS2 })
  })
  it('a re-base on both sides (a `replay`): the later one decides `base` and the ops’ bases', () => {
    const rebased = (base: string) => OPS.map(o => ({ ...o, base }))
    const ours = [entry({ base: 'aaa1111', ops: rebased('b'.repeat(64)), events: [ev('e-p1', 12, 'replay', { base: 'aaa1111', rev: undefined })] })]
    const theirs = [entry({ base: 'bbb2222', ops: rebased('c'.repeat(64)), events: [ev('e-p2', 13, 'replay', { base: 'bbb2222', rev: undefined })] })]
    expect(merged([entry()], ours, theirs)[0]).toMatchObject({ base: 'bbb2222', ops: rebased('c'.repeat(64)) })
  })
  it('a field both changed to different values that no rule decides: refused, naming the proposal and the field', () => {
    const reason = refused([entry()], [entry({ title: 'Mine' })], [entry({ title: 'Theirs' })])
    expect(reason).toMatch(/p-2026-10-18-001/)
    expect(reason).toMatch(/"title"/)
    expect(reason).toMatch(/both sides changed/)
  })
  it('identical changes on both sides: one', () => {
    expect(merged([entry()], [entry({ title: 'Same' })], [entry({ title: 'Same' })])[0]!.title).toBe('Same')
  })
  it('one side changed a field, the other left it: the change wins', () => {
    expect(merged([entry()], [entry({ title: 'Better' })], [entry({ events: [ev('e-c', 11)] })])[0]).toMatchObject({ title: 'Better' })
    expect(merged([entry()], [entry({ events: [ev('e-c', 11)] })], [entry({ title: 'Better' })])[0]).toMatchObject({ title: 'Better' }) // from either side
  })
  it('two machines that each opened "the first proposal of the day": refused, with the clash named', () => {
    const reason = refused([], [entry({ title: 'Mine' })], [entry({ title: 'Theirs' })])
    expect(reason).toMatch(/p-2026-10-18-001/)
    expect(reason).toMatch(/"title"/)
  })
  it('the same event id with different content on the two sides: refused, naming the event', () => {
    const reason = refused([entry()], [entry({ events: [ev('e-1', 11, 'comment', { text: 'mine' })] })], [entry({ events: [ev('e-1', 11, 'comment', { text: 'theirs' })] })])
    expect(reason).toMatch(/p-2026-10-18-001.*event e-1/)
  })
  it('an empty or missing file on one side is an empty ledger', () => {
    expect(merged([], [entry()], [])).toHaveLength(1)
    expect(mergeLedgers(undefined as never, null as never, [entry()] as never)).toMatchObject({ ok: true })
  })
  it('does not change what it was given', () => {
    const ours = [entry({ events: [ev('e-o', 11, 'approve')] })]
    const theirs = [entry({ events: [ev('e-t', 10)] })]
    const copy = JSON.stringify([ours, theirs])
    merged([entry()], ours, theirs)
    expect(JSON.stringify([ours, theirs])).toBe(copy)
  })

  // Review LOW-D: a ratified side merged with a revise on the other took the revise's ops and rev, so the decision
  // record named content that was never merged. A decided proposal is not merged with a revision it never saw.
  describe('a closing on one side and a revision on the other', () => {
    const closed = { at: at(12), by: 'bruno' }
    const OPEN_REVISED = (h: number) => entry({ rev: 'bbbbbbbbbbbb', ops: OPS2, events: [ev('e-v', h, 'revise', { rev: 'bbbbbbbbbbbb', ops: OPS2 })] })
    const RATIFIED = () => entry({ state: 'ratified', closed, events: [ev('e-r', 12, 'ratify', { rev: undefined })] })
    it.each([['before', 9], ['after', 13]])('ratified on one side and revised %s it on the other is refused, in words, whichever side is ours', (_w, h) => {
      for (const [a, b] of [[RATIFIED(), OPEN_REVISED(h)], [OPEN_REVISED(h), RATIFIED()]]) {
        const why = refused([entry()], [a], [b])
        expect(why).toMatch(/proposal p-2026-10-18-001: ratified on one side and revised on the other \(e-v\)/)
        expect(why).toMatch(/Sync again/)
      }
    })
    it.each(['rejected', 'withdrawn', 'expired'])('%s on one side and revised on the other is refused the same way', state => {
      expect(refused([entry()], [entry({ state, closed })], [OPEN_REVISED(11)])).toMatch(/closed on one side and revised on the other \(e-v\)|\w+ on one side and revised on the other \(e-v\)/)
    })
    it('a revise both sides already hold does not refuse (it was seen before the closing)', () => {
      const seen = ev('e-v', 10, 'revise', { rev: 'bbbbbbbbbbbb', ops: OPS2 })
      const base = [entry({ rev: 'bbbbbbbbbbbb', ops: OPS2, events: [seen] })]
      const ours = [entry({ rev: 'bbbbbbbbbbbb', ops: OPS2, events: [seen, ev('e-r', 12, 'ratify', { rev: undefined })], state: 'ratified', closed })]
      const theirs = [entry({ rev: 'bbbbbbbbbbbb', ops: OPS2, events: [seen, ev('e-c', 11)] })]
      expect(merged(base, ours, theirs)[0]).toMatchObject({ state: 'ratified', rev: 'bbbbbbbbbbbb' })
    })
    it('a comment on the open side still merges (the existing case)', () => {
      expect(merged([entry()], [RATIFIED()], [entry({ events: [ev('e-c', 11)] })])[0]).toMatchObject({ state: 'ratified' })
    })
  })

  describe('the result', () => {
    const cases: [string, unknown[], unknown[], unknown[]][] = [
      ['events on both sides', [entry()], [entry({ events: [ev('e-o', 11, 'approve')] })], [entry({ events: [ev('e-t', 10)] })]],
      ['a ratified side', [entry()], [entry({ state: 'ratified', closed: { at: at(12), by: 'bruno' }, events: [ev('e-r', 12, 'ratify', { rev: undefined })] })], [entry({ events: [ev('e-c', 11)] })]],
      ['new proposals on both sides', [entry()], [entry(), entry({ id: 'p-2026-10-18-002', branch: 'proposal/p-2026-10-18-002' })], [entry(), entry({ id: 'p-2026-10-19-001', branch: 'proposal/p-2026-10-19-001' })]],
    ]
    it.each(cases)('re-parses and passes checkProposals: %s', (_name, base, ours, theirs) => {
      const r = merged(base, ours, theirs)
      const reparsed = JSON.parse(JSON.stringify(r))
      expect(checkProposals(reparsed, { members: MEMBERS, governance: GOVERNANCE, systems: null, classes: CHANGE_CLASSES, classOf: x => classOf({ registry: x }) })).toEqual([])
    })
    it.each(cases)('is idempotent: merging it with either side changes nothing: %s', (_name, base, ours, theirs) => {
      const r = merged(base, ours, theirs)
      expect(merged(base, r, ours)).toEqual(r)
      expect(merged(base, r, theirs)).toEqual(r)
      expect(merged(base, ours, r)).toEqual(r)
      expect(merged(base, theirs, r)).toEqual(r)
      expect(merged(r, r, r)).toEqual(r)
    })
  })
})
