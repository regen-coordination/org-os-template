import { describe, it, expect } from 'vitest'
import { transition, sentence } from '../../../lib/machines/run.mjs'
import { firstMissing, propose, proposeGuards, type ProposeForm } from './propose.ts'

const form = (over: Partial<ProposeForm> = {}): ProposeForm => ({
  title: 'Move one project', rationale: '', needsRationale: false, statementOn: false, decision: '', why: '', reason: '', ...over,
})
const go = (state: string, type: string, ctx: ProposeForm) => transition(propose, proposeGuards, state, { type }, ctx)

describe('propose', () => {
  it('submits from composing when the form is complete, and says what is missing when not', () => {
    expect(go('composing', 'SUBMIT', form())).toMatchObject({ ok: true, state: 'submitting' })
    expect(go('composing', 'SUBMIT', form({ title: '  ' }))).toMatchObject({ ok: false, reason: 'Give the proposal a title.' })
    expect(go('composing', 'SUBMIT', form({ needsRationale: true })))
      .toMatchObject({ ok: false, reason: 'Say why this is worth deciding: a rationale is required for governance and identity changes.' })
    expect(go('composing', 'SUBMIT', form({ needsRationale: true, rationale: 'because' }))).toMatchObject({ ok: true })
  })

  it('asks for the decision and its why once the proposal is recorded as a decision', () => {
    expect(go('composing', 'SUBMIT', form({ statementOn: true }))).toMatchObject({ ok: false, reason: 'Write the decision, as it will stand in DECISIONS.md.' })
    expect(go('composing', 'SUBMIT', form({ statementOn: true, decision: 'D' }))).toMatchObject({ ok: false, reason: 'Say why it was decided.' })
    expect(go('composing', 'SUBMIT', form({ statementOn: true, decision: 'D', why: 'W' }))).toMatchObject({ ok: true })
  })

  it('submitting ends in opened or refused; a refusal is edited or sent again', () => {
    expect(go('submitting', 'OPENED', form())).toMatchObject({ ok: true, state: 'opened' })
    expect(go('submitting', 'REFUSE', form())).toMatchObject({ ok: true, state: 'refused' })
    expect(go('submitting', 'SUBMIT', form()).ok).toBe(false) // a second click in flight sends nothing
    expect(go('refused', 'EDIT', form())).toMatchObject({ ok: true, state: 'composing' })
    expect(go('refused', 'SUBMIT', form())).toMatchObject({ ok: true, state: 'submitting' })
    expect(go('opened', 'EDIT', form()).ok).toBe(false)
  })

  it('says the server sentence when refused', () => {
    expect(sentence(propose, 'refused', { reason: 'No rule covers the class treasury.' })).toBe('No rule covers the class treasury.')
  })

  it('names the field that is missing, with the sentence the guard gives', () => {
    expect(firstMissing(form())).toBeNull()
    expect(firstMissing(form({ needsRationale: true, statementOn: true }))?.field).toBe('rationale')
    expect(firstMissing(form({ statementOn: true, decision: 'D' }))).toEqual({ field: 'statement.why', message: 'Say why it was decided.' })
  })
})
