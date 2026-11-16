/** The model's own table: the lanes and their precedence, the checks, the ages, the read states, the provenance.
 *  No file, no clock, no kms — the same facts the fixture produces, written out. */
import { describe, expect, it } from 'vitest'
import { checksOf, daysSince, groupLanes, laneOf, laneCounts, provenanceOf, readState } from '../../../server/knowledge/model.ts'
import type { CanonRow } from '../../../server/knowledge/types.ts'

const base = { publicUse: 'reviewed-for-guidance', maturity: 'reviewed', awaiting: false, aiAssisted: false, publishable: true, selected: true, rejected: null, optedIn: true }

describe('laneOf — one predicate each, taken in order', () => {
  it('puts a published entry in Published, and says what put it there', () => {
    expect(laneOf(base)).toEqual({ lane: 'published', why: 'in the selection' })
  })

  it('puts kms’s review queue in Awaiting review, with the reason the queue gives', () => {
    expect(laneOf({ ...base, selected: false, awaiting: true, maturity: 'raw' })).toEqual({ lane: 'awaiting', why: 'raw' })
    expect(laneOf({ ...base, selected: false, awaiting: true, maturity: 'raw', aiAssisted: true })).toEqual({ lane: 'awaiting', why: 'raw · written with AI help' })
    expect(laneOf({ ...base, selected: false, awaiting: true, maturity: 'reviewed', aiAssisted: true })).toEqual({ lane: 'awaiting', why: 'written with AI help' })
  })

  it('says so when an entry in the review queue is in the selection all the same: a run publishes it unreviewed', () => {
    // kms's floor does not read the review queue: `raw` or `ai_assisted` with a publishable public use is selected.
    expect(laneOf({ ...base, selected: true, awaiting: true, maturity: 'raw', aiAssisted: true }))
      .toEqual({ lane: 'awaiting', why: 'raw · written with AI help · selected: a run publishes it unreviewed' })
  })

  it('treats a withdrawal as a decision, so `held` outranks the queue it would sit in', () => {
    expect(laneOf({ ...base, selected: false, awaiting: true, maturity: 'held' })).toEqual({ lane: 'internal', why: 'withdrawn · maturity held' })
  })

  it('puts an internal-only entry in Internal only, not in Draft: it is a decision, not a gap', () => {
    expect(laneOf({ ...base, selected: false, publishable: false, publicUse: 'internal-only' })).toEqual({ lane: 'internal', why: 'public use: internal only' })
  })

  it('puts what the org’s own rule withheld in Internal only, and quotes the rule', () => {
    expect(laneOf({ ...base, selected: false, rejected: 'not in the public scope' })).toEqual({ lane: 'internal', why: 'your rule: not in the public scope' })
  })

  it('leaves what the floor refuses for a fixable reason in Draft, saying which reason', () => {
    expect(laneOf({ ...base, selected: false, publishable: false, publicUse: 'not-public-yet' })).toEqual({ lane: 'draft', why: 'not public yet' })
    expect(laneOf({ ...base, selected: false, publishable: false, publicUse: null })).toEqual({ lane: 'draft', why: 'no public use yet' })
    expect(laneOf({ ...base, selected: false, optedIn: false, publishable: true })).toEqual({ lane: 'draft', why: 'this kind is opt-in, and this instance has not opted in' })
  })

  it('is exhaustive: every combination lands in exactly one lane', () => {
    const seen = new Set<string>()
    for (const publicUse of [null, 'reviewed-for-guidance', 'internal-only', 'not-public-yet'])
      for (const maturity of ['raw', 'reviewed', 'held'])
        for (const awaiting of [true, false])
          for (const aiAssisted of [true, false])
          for (const selected of [true, false])
            for (const rejected of [null, 'x'])
              seen.add(laneOf({ publicUse, maturity, awaiting, aiAssisted, publishable: publicUse === 'reviewed-for-guidance', selected, rejected, optedIn: true }).lane)
    expect([...seen].sort()).toEqual(['awaiting', 'draft', 'internal', 'published'])
  })
})

const row = (lane: CanonRow['lane'], title: string): CanonRow => ({
  type: 'encyclopedia-entry', slug: title.toLowerCase().replace(/\s+/g, '-'), id: `encyclopedia-entry/${title}`, title, lane,
  why: 'because', mark: null, maturity: null, publicUse: null, updated: null, updatedDays: null, summary: '', internal: false,
  awaiting: false, peer: null, readAge: null, readFailed: false, deprecated: null, pageHref: null, apiHref: null, atUri: null,
})

describe('groupLanes', () => {
  it('keeps the pipeline order and counts each lane, empty ones included', () => {
    const lanes = groupLanes([row('published', 'A'), row('published', 'B'), row('internal', 'C')])
    expect(lanes.map(l => [l.id, l.count])).toEqual([['draft', 0], ['awaiting', 0], ['published', 2], ['internal', 1]])
    expect(laneCounts(lanes)).toEqual({ published: 2, awaiting: 0, internal: 1, draft: 0 })
    expect(lanes[0]!.movesOn).toBe('Moves on: a field it still needs.')
  })
})

describe('checksOf — six rows, each a predicate already computed', () => {
  const facts = {
    validating: { ok: true, errors: [] }, requiredFields: { missing: [] as string[] }, references: { resolved: 3, total: 4 },
    publicUse: 'reviewed-for-guidance', publishable: true, selected: true, rejected: null, id: 'encyclopedia-entry/living-mulch', atUri: 'at://x',
  }
  it('names the failing reference and says what to do about it', () => {
    const rows = checksOf(facts)
    expect(rows.map(r => r.field)).toEqual(['schema', 'required', 'references', 'public use', 'your rule', 'record'])
    expect(rows[2]!.mark).toEqual({ shape: 'needs', word: '3 of 4 resolve' })
    expect(rows[2]!.note).toBe('1 points at nothing')
  })
  it('says a record with no id waits for a run', () => {
    const rows = checksOf({ ...facts, id: null, atUri: null })
    expect(rows[5]!.mark).toEqual({ shape: 'open', word: 'None yet' })
    expect(rows[5]!.note).toBe('a run mints ids')
  })
  it('says its public use alone selected an entry only when no rule of its own ran', () => {
    expect(checksOf(facts)[4]).toMatchObject({ mark: { shape: 'done', word: 'Selected' }, note: 'no rule of its own here: its public use decides' })
    expect(checksOf({ ...facts, gated: true })[4]).toMatchObject({ mark: { shape: 'done', word: 'Selected' }, note: 'its public use and your rule both let it through' })
  })
  // walk D5: an entry not in the selection says why, in words (no "floor")
  it('says why an entry is not in the selection', () => {
    const out = { ...facts, selected: false, publishable: false }
    expect(checksOf({ ...out, publicUse: 'not-public-yet' })[4]).toMatchObject({ mark: { shape: 'closed', word: 'Not selected' }, note: 'not in the selection: its public use is not public yet' })
    expect(checksOf({ ...out, publicUse: 'internal-only' })[4]!.note).toBe('not in the selection: its public use is internal only')
    expect(checksOf({ ...out, publicUse: null })[4]!.note).toBe('not in the selection: it has no public use yet')
    expect(checksOf({ ...out, publicUse: 'public-reference' })[4]!.note).toBe('not in the selection: its public use, public-reference, is not one that is published')
    expect(checksOf({ ...facts, selected: false, optedIn: false })[4]!.note).toBe('not in the selection: entries of this kind are not published here')
    expect(checksOf({ ...facts, selected: false })[4]!.note).toBe('not in the selection yet: the next run’s selection decides')
  })

  // walk W7, D3: the entry's checks are read by members: no "floor"
  it('says the checks in words, never "the floor"', () => {
    const words = (rows: ReturnType<typeof checksOf>) => rows.map(r => `${r.mark.word} ${r.note ?? ''}`).join(' | ')
    for (const f of [facts, { ...facts, gated: true }, { ...facts, publishable: false, selected: false, publicUse: 'not-public-yet' }]) {
      expect(words(checksOf(f))).not.toMatch(/floor/i)
    }
    expect(checksOf(facts)[3]).toMatchObject({ mark: { shape: 'done', word: 'Its public use is published' }, note: 'its public use is one that is published' })
    expect(laneOf({ ...base, selected: false, publishable: false, publicUse: 'public-reference' }).why).toBe('its public use, public-reference, is not one that is published')
    expect(groupLanes([]).find(l => l.id === 'draft')!.movesOn).toBe('Moves on: a field it still needs.')
  })

  it('quotes the rule that withheld an entry', () => {
    const rows = checksOf({ ...facts, selected: false, rejected: 'out of scope' })
    expect(rows[4]).toMatchObject({ mark: { shape: 'needs', word: 'Withheld' }, note: 'out of scope' })
  })
})

describe('daysSince / readState — one clock vocabulary', () => {
  const now = '2026-10-29T12:00:00Z'
  it('floors whole days and survives a missing date', () => {
    expect(daysSince('2026-10-20T00:00:00Z', now)).toBe(9)
    expect(daysSince(null, now)).toBeNull()
    expect(daysSince('not a date', now)).toBeNull()
  })
  it('reads fresh, aged, failed and never, and keeps the last good age on a failure', () => {
    expect(readState({ ok_at: '2026-10-29T09:00:00Z' }, now)).toEqual({ state: 'fresh', ageDays: 0, error: null })
    expect(readState({ ok_at: '2026-10-10T09:00:00Z' }, now)).toMatchObject({ state: 'aged', ageDays: 19 })
    expect(readState({ ok_at: '2026-10-20T12:00:00Z', error: 'timeout' }, now)).toEqual({ state: 'failed', ageDays: 9, error: 'timeout' })
    expect(readState(null, now)).toEqual({ state: 'never', ageDays: null, error: null })
  })
})

describe('provenanceOf — the projection’s edge', () => {
  it('lists what is published and what is dropped, and keeps the dropped ones apart', () => {
    const rows = provenanceOf({ source_system: 'Seed Library', notes: 'private', review_needs: ['a', 'b'] }, ['notes', 'review_needs', 'ai_assisted'])
    expect(rows).toEqual([
      { field: 'source_system', value: 'Seed Library', published: true },
      { field: 'notes', value: 'private', published: false },
      { field: 'review_needs', value: 'a, b', published: false },
    ])
  })
})
