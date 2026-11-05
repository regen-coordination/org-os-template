import { describe, it, expect } from 'vitest'
import { applyOutcome, fmt, opFieldWords, opKind, opSummary, recordName, ruleWords, stagedWords, staleWords, trayRows, trunkNow } from './rows.ts'
import { ApiError } from '../api.ts'
import { changeView } from '../test/data.ts'

describe('trayRows', () => {
  it('makes one row per changed field, across ops, marking the stale and the current value', () => {
    const view = changeView({
      ops: [
        { op: 'update', record: 'projects:br', set: { stage: 'develop', partners: ['example-coop', 'example-network'] }, base: 'h', before: { stage: 'discovery', partners: ['example-coop'] } },
        { op: 'update', record: 'funding-opportunities:x', set: { status: 'submitted' }, base: 'h', before: { status: 'drafting' } },
        { op: 'create', record: 'ideas:new', value: { id: 'new', title: 'venture commune' }, base: null, before: null },
        { op: 'delete', record: 'partners:old', base: 'h', before: { id: 'old', partner: 'Old Partner' } },
        { op: 'replace', record: 'projects:site', value: { id: 'site', title: 'Site' }, base: 'h', before: { id: 'site', title: 'Old site', note: 'x' } },
      ],
      stale: [1], current: [null, { status: 'won' }, null, null, null],
    })
    const rows = trayRows(view)
    expect(rows.map(r => [r.record, r.field, fmt(r.was), fmt(r.now)])).toEqual([
      ['projects:br', 'stage', 'discovery', 'develop'],
      ['projects:br', 'partners', '[example-coop]', '[example-coop, example-network]'],
      ['funding-opportunities:x', 'status', 'drafting', 'submitted'],
      ['ideas:new', '(new record)', '—', 'venture commune'],
      ['partners:old', '(deleted)', 'Old Partner', '—'],
      ['projects:site', 'title', 'Old site', 'Site'],
      ['projects:site', 'note', 'x', '—'],
    ])
    expect(rows[2]).toMatchObject({ stale: true, current: 'won', first: true, alone: true })
    expect(rows[0]).toMatchObject({ first: true, alone: false })
    expect(rows[1]).toMatchObject({ first: false, alone: false })
  })
})

describe('the docked tray’s words (§5.6)', () => {
  const update = { op: 'update' as const, record: 'systems:treasury', set: { threshold: '4 of 8' }, base: 'h', before: { id: 'treasury', name: 'Treasury', kind: 'safe', threshold: '4 of 9' } }
  const two = { op: 'update' as const, record: 'projects:p1', set: { stage: 'develop', note: 'n' }, base: 'h', before: { id: 'p1' } }
  const create = { op: 'create' as const, record: 'ideas:new', value: { id: 'new', title: 'venture commune' }, base: null, before: null }
  const del = { op: 'delete' as const, record: 'partners:old', base: 'h', before: { id: 'old' } }

  it('names an op’s record by its entry’s name, else its key; its tile by the entry’s kind, else the registry', () => {
    expect([recordName(update), recordName(two), recordName(create), recordName(del)]).toEqual(['Treasury', 'projects:p1', 'venture commune', 'partners:old'])
    expect([opKind(update), opKind(two), opKind(create)]).toEqual(['safe', 'projects', 'ideas'])
  })

  it('says the last op in a line: one field and its new value, or the fields; a create or a delete in a word', () => {
    expect(opSummary(update)).toBe('Treasury · threshold: 4 of 8')
    expect(opSummary(two)).toBe('projects:p1 · stage, note')
    expect(opSummary(create)).toBe('venture commune · new record')
    expect(opSummary(del)).toBe('partners:old · deleted')
  })

  it('names the fields an op’s × removes, and what a stale op’s fields hold on the trunk', () => {
    expect([opFieldWords(update), opFieldWords(two), opFieldWords(create)]).toEqual(['threshold', 'stage, note', 'new record'])
    expect(trunkNow(update, { threshold: '4 of 7' })).toBe('4 of 7')
    expect(trunkNow(two, { stage: 'paused' })).toBe('stage: paused · note: —')
  })

  it('counts, says the stale line, and says the rule: the server’s sentence, a direct one after “Saves directly”', () => {
    expect([stagedWords(1), stagedWords(3), staleWords(1), staleWords(2)]).toEqual(
      ['1 staged change', '3 staged changes', '1 op changed on the trunk — choose what stands', '2 ops changed on the trunk — choose what stands'])
    expect(ruleWords({ direct: true, sentence: 'the maintainer decides alone', source: 's' })).toBe('Saves directly · the maintainer decides alone')
    expect(ruleWords({ direct: false, sentence: 'Council consent decides this · 4 of 8', source: 's' })).toBe('Council consent decides this · 4 of 8')
  })
})

describe('applyOutcome (contract: refusals clients branch on by code)', () => {
  it("shows a refused rule's reason", () => {
    const sentence = 'example-os decides changes by consensus; it stays staged until it is proposed.'
    expect(applyOutcome(new ApiError(403, [], sentence, { reason: sentence, error: sentence }))).toEqual({ message: sentence, lines: [], refresh: false, rowErrors: [] })
  })

  it("on STALE, gives the server's sentence as written and asks for the change again, so the stale rows appear (C19)", () => {
    const sentence = 'Not applied: one op was staged against a record that has changed since. Nothing was written. Take theirs or keep mine on it, then apply again.'
    expect(applyOutcome(new ApiError(409, [], sentence, { stale: [0], error: sentence, code: 'STALE' })))
      .toEqual({ message: sentence, lines: [], refresh: true, rowErrors: [] })
  })

  it("on DIRTY, gives the server's sentence as written, plus every path (C4)", () => {
    const sentence = 'Not saved: data/projects.yaml has changes that are not committed yet, and this save would commit them along with yours.'
    expect(applyOutcome(new ApiError(409, [], sentence, { error: sentence, code: 'DIRTY', paths: ['data/projects.yaml', 'data/ideas.yaml'] })))
      .toEqual({ message: sentence, lines: ['Files: data/projects.yaml, data/ideas.yaml'], refresh: false, rowErrors: [] })
  })

  it('on EMPTY, gives the sentence and re-reads the change', () => {
    expect(applyOutcome(new ApiError(400, [], 'Nothing is staged.', { error: 'Nothing is staged.', code: 'EMPTY' }))).toEqual({ message: 'Nothing is staged.', lines: [], refresh: true, rowErrors: [] })
  })

  it('on 422, hands each error to its row, by record and field', () => {
    const errors = [{ record: 'projects:p', field: 'start', message: 'must match format "date"' }]
    expect(applyOutcome(new ApiError(422, errors, 'HTTP 422', { errors }))).toEqual({ message: 'Not applied: 1 field is refused; the marked row says why.', lines: [], refresh: false, rowErrors: errors })
  })

  it("on 422, a refusal of a whole op (field '') is a line of its own, not a row's", () => {
    const whole = { record: 'partners:old', field: '', message: 'Not deleted: partners "old" is still referred to by projects "p" (partners).' }
    const field = { record: 'projects:p', field: 'start', message: 'must match format "date"' }
    expect(applyOutcome(new ApiError(422, [whole], 'HTTP 422', { errors: [whole] })))
      .toEqual({ message: whole.message, lines: [], refresh: false, rowErrors: [] })
    expect(applyOutcome(new ApiError(422, [field, whole], 'HTTP 422', { errors: [field, whole] })))
      .toEqual({ message: 'Not applied: 1 field is refused; the marked row says why.', lines: [whole.message], refresh: false, rowErrors: [field] })
  })

  it('on 422, an error no row shows (a field a create holds) is a line naming its record and field, in the verb', () => {
    const view = changeView({ ops: [{ op: 'create', record: 'ideas:new', value: { id: 'new' }, base: null, before: null }] })
    const err = { record: 'ideas:new', field: 'title', message: "must have required property 'title'" }
    expect(applyOutcome(new ApiError(422, [err], 'HTTP 422', { errors: [err] }), 'apply', trayRows(view)))
      .toEqual({ message: "Not applied: ideas:new · title: must have required property 'title'", lines: [], refresh: false, rowErrors: [] })
  })

  it('words each action with its own verb, and re-reads after a refused unstage or rebase (C5)', () => {
    const errors = [{ record: 'ideas:new', field: '', message: 'projects "p" names ideas "new"' }]
    const both = [...errors, { record: 'projects:p', field: 'idea', message: 'no ideas "new"' }]
    expect(applyOutcome(new ApiError(422, both, 'HTTP 422', { errors: both }), 'unstage'))
      .toEqual({ message: 'Not removed: 1 field is refused; the marked row says why.', lines: ['projects "p" names ideas "new"'], refresh: true, rowErrors: [both[1]] })
    expect(applyOutcome(new ApiError(422, both, 'HTTP 422', { errors: both }), 'rebase').message)
      .toBe('Not resolved: 1 field is refused; the marked row says why.')
    expect(applyOutcome(new ApiError(422, both, 'HTTP 422', { errors: both }), 'apply').refresh).toBe(false)
  })

  it('on a 404 from unstage or rebase (another tab took the op), re-reads the change', () => {
    const gone = 'No op 1 in this change: it holds 1, numbered from 0.'
    expect(applyOutcome(new ApiError(404, [], gone, { error: gone }), 'unstage')).toEqual({ message: gone, lines: [], refresh: true, rowErrors: [] })
    expect(applyOutcome(new ApiError(404, [], gone, { error: gone }), 'rebase').refresh).toBe(true)
  })

  it('a 409 with no code is shown as written, and does not re-read (C7)', () => {
    const sentence = 'data/projects.yaml has YAML errors: bad indentation at line 4.'
    expect(applyOutcome(new ApiError(409, [], sentence, { error: sentence }))).toEqual({ message: sentence, lines: [], refresh: false, rowErrors: [] })
  })

  it("gives anything else in the server's words", () => {
    expect(applyOutcome(new ApiError(503, [], 'Not applied: git refused the commit (index.lock). Nothing was changed.')).message).toBe('Not applied: git refused the commit (index.lock). Nothing was changed.')
    expect(applyOutcome(new Error('Failed to fetch')).message).toBe('Failed to fetch')
  })
})
