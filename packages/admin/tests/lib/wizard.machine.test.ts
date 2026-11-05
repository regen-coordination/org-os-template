// The wizard machine (wizards spec §5.3): intro → step ⇄ step → review → running → done | failed.
// Nothing is written before review is confirmed, and the machine itself says so.
import { describe, it, expect } from 'vitest'
import { sentence, transition, walk, enabled } from '../../lib/machines/run.mjs'
import { wizard, wizardGuards, type WizardContext } from '../../lib/machines/wizard.mjs'

const ctx = (over: Partial<WizardContext> = {}): WizardContext => ({ n: 1, total: 3, invalid: null, draft: false, ...over })
const go = (state: string, type: string, c: WizardContext = ctx()) => transition(wizard, wizardGuards, state, { type }, c)

describe('the wizard machine', () => {
  it('has no state nothing reaches and no state that is not final and leads nowhere', () => {
    const w = walk(wizard)
    expect(w.unreachable).toEqual([])
    expect(w.deadEnds).toEqual([])
  })

  it('reaches running only from review, by CONFIRM: nothing is written before the last step is confirmed', () => {
    const into = walk(wizard).edges.filter(e => e.to === 'running')
    expect(into).toEqual([{ from: 'review', to: 'running', event: 'CONFIRM', when: [] }])
  })

  it('starts at intro, and START enters the first step', () => {
    expect(wizard.initial).toBe('intro')
    expect(go('intro', 'START')).toEqual({ ok: true, state: 'step', effects: ['step:first'] })
  })

  it('moves on from a step only when the step is valid, and says why not in the step\'s own words', () => {
    expect(go('step', 'NEXT', ctx({ n: 1, total: 3, invalid: 'Choose who you are first.' }))).toEqual({ ok: false, reason: 'Choose who you are first.', guard: 'stepValid' })
    expect(go('step', 'NEXT', ctx({ n: 1, total: 3 }))).toEqual({ ok: true, state: 'step', effects: ['step:next'] })
  })

  it('goes from the last step to review, and from nowhere else', () => {
    expect(go('step', 'NEXT', ctx({ n: 3, total: 3 }))).toEqual({ ok: true, state: 'review', effects: ['step:review'] })
    expect(go('step', 'NEXT', ctx({ n: 3, total: 3, invalid: 'Not yet.' })).ok).toBe(false)
    expect(go('intro', 'NEXT').ok).toBe(false)
    expect(go('step', 'CONFIRM').ok).toBe(false)
    expect(go('intro', 'CONFIRM').ok).toBe(false)
  })

  it('BACK is always legal before anything is written: back a step, back to the intro, back from review', () => {
    expect(go('step', 'BACK', ctx({ n: 2 }))).toEqual({ ok: true, state: 'step', effects: ['step:back'] })
    expect(go('step', 'BACK', ctx({ n: 1 }))).toEqual({ ok: true, state: 'intro', effects: [] })
    expect(go('review', 'BACK')).toEqual({ ok: true, state: 'step', effects: ['step:last'] })
    expect(go('failed', 'BACK')).toEqual({ ok: true, state: 'review', effects: [] })
    expect(go('running', 'BACK').ok).toBe(false)
    expect(go('done', 'BACK').ok).toBe(false)
  })

  it('CANCEL closes from anywhere nothing is being written, and keeps the draft', () => {
    for (const s of ['intro', 'step', 'review', 'failed']) expect(go(s, 'CANCEL')).toMatchObject({ ok: true, state: 'closed' })
    expect(go('running', 'CANCEL').ok).toBe(false)
    expect(go('done', 'CANCEL').ok).toBe(false)
    expect(sentence(wizard, 'closed')).toMatch(/kept as a draft/)
  })

  it('resumes a draft from the intro only when there is one', () => {
    expect(go('intro', 'RESUME', ctx({ draft: false }))).toMatchObject({ ok: false, reason: 'There is no draft to continue.' })
    expect(go('intro', 'RESUME', ctx({ draft: true }))).toEqual({ ok: true, state: 'step', effects: ['step:resume'] })
  })

  it('writes, then ends: running → done | failed; a failure is retried only through review again', () => {
    expect(go('review', 'CONFIRM')).toMatchObject({ ok: true, state: 'running' })
    expect(go('running', 'DONE')).toMatchObject({ ok: true, state: 'done' })
    expect(go('running', 'FAIL')).toMatchObject({ ok: true, state: 'failed' })
    expect(go('failed', 'CONFIRM').ok).toBe(false)
    expect(go('failed', 'RETRY')).toMatchObject({ ok: true, state: 'review' })
  })

  it('says, in every state, whether anything has been written', () => {
    for (const s of ['intro', 'step', 'review']) expect(sentence(wizard, s, { n: 1, total: 2 })).toMatch(/nothing is written|Nothing is written|Nothing has been written/)
    expect(sentence(wizard, 'step', { n: 2, total: 5 })).toMatch(/Step 2 of 5/)
    expect(sentence(wizard, 'running')).toMatch(/Writing/)
  })

  it('offers only what can be done now', () => {
    expect([...enabled(wizard, wizardGuards, 'step', ctx({ n: 2 }))].sort()).toEqual(['BACK', 'CANCEL', 'NEXT'])
    expect([...enabled(wizard, wizardGuards, 'review', ctx())].sort()).toEqual(['BACK', 'CANCEL', 'CONFIRM'])
  })
})
