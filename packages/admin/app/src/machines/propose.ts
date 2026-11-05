import { defineMachine, type Guards } from '../../../lib/machines/run.mjs'

/** The proposal panel's lifecycle (0.6 P2 spec 3.14): composing the form, submitting it, then opened or
 *  refused. A refusal is edited (back to composing) or sent again. `complete` is the one guard: it names
 *  what the form still lacks, and that sentence is what the panel says. The panel's flags (is it sending,
 *  did it fail) are this machine's state, not component state. */
export const propose = defineMachine({
  id: 'propose',
  initial: 'composing',
  events: ['SUBMIT', 'OPENED', 'REFUSE', 'EDIT'],
  guards: ['complete'],
  states: {
    composing: { shows: { mark: null, text: 'Write what you propose.' }, on: { SUBMIT: { to: 'submitting', when: 'complete' } } },
    submitting: { shows: { mark: 'running', text: 'Opening the proposal.' }, on: { OPENED: 'opened', REFUSE: 'refused' } },
    opened: { shows: { mark: 'done', text: 'Proposal opened.' }, final: true },
    refused: { shows: { mark: 'failed', text: '{reason}' }, on: { EDIT: 'composing', SUBMIT: { to: 'submitting', when: 'complete' } } },
  },
})

/** What the panel's form holds. `needsRationale` is true for the governance and identity classes, which also
 *  force the statement on. `reason` is the server's sentence for the state `refused`. */
export interface ProposeForm {
  title: string; rationale: string; needsRationale: boolean; statementOn: boolean; decision: string; why: string; reason: string
}

/** The first thing the form lacks: the field to mark and the sentence for it, or null when it is complete. */
export function firstMissing(f: ProposeForm): { field: 'title' | 'rationale' | 'statement.decision' | 'statement.why'; message: string } | null {
  if (f.title.trim() === '') return { field: 'title', message: 'Give the proposal a title.' }
  if (f.needsRationale && f.rationale.trim() === '') {
    return { field: 'rationale', message: 'Say why this is worth deciding: a rationale is required for governance and identity changes.' }
  }
  if (f.statementOn && f.decision.trim() === '') return { field: 'statement.decision', message: 'Write the decision, as it will stand in DECISIONS.md.' }
  if (f.statementOn && f.why.trim() === '') return { field: 'statement.why', message: 'Say why it was decided.' }
  return null
}

export const proposeGuards: Guards = {
  complete: (f: ProposeForm) => firstMissing(f)?.message ?? true,
}
