import { defineMachine, transition, type Guards, type Target } from '../../../lib/machines/run.mjs'

/** What the record says about an open editor (useEditor works it out on every render). */
export interface EditorFacts { gone: boolean; stale: boolean; blocked: boolean }

const FACTS: Target[] = [{ to: 'gone', when: 'isGone' }, { to: 'changedUnder', when: 'isChanged' }, { to: 'invalid', when: 'isBlocked' }, 'editing']

/** Editing one record (P4 spec §3.4). Only viewing, editing and saving are ever stored; invalid,
 *  changedUnder and gone are what an editing editor settles into by FACTS (P4a ruling 4). */
export const editor = defineMachine({
  id: 'editor',
  initial: 'viewing',
  events: ['START', 'CANCEL', 'CLOSE', 'SAVE', 'STAGED', 'REFUSED', 'FACTS'],
  guards: ['isGone', 'isChanged', 'isBlocked'],
  states: {
    viewing: { shows: { mark: null, text: 'Viewing.' }, on: { START: 'editing' } },
    editing: { group: 'open', shows: { mark: null, text: 'Editing.' }, on: { START: 'editing', CANCEL: 'viewing', CLOSE: 'viewing', SAVE: 'saving', FACTS } },
    invalid: { group: 'open', shows: { mark: 'failed', text: 'Fix the marked fields, then save.' }, on: { CANCEL: 'viewing', FACTS } },
    changedUnder: { group: 'open', shows: { mark: 'stale', text: 'This record changed while you were editing it: keep yours or take theirs.' }, on: { CANCEL: 'viewing', FACTS } },
    gone: { group: 'open', shows: { mark: 'stale', text: 'This record is no longer in its file.' }, on: { CANCEL: 'viewing', FACTS } },
    saving: { shows: { mark: 'running', text: 'Staging.' }, on: { STAGED: 'viewing', REFUSED: 'editing', CANCEL: 'viewing' } },
  },
})

export const editorGuards: Guards = {
  isGone: (f: EditorFacts) => f.gone || 'the record is still in its file',
  isChanged: (f: EditorFacts) => f.stale || 'the record has not changed under you',
  isBlocked: (f: EditorFacts) => f.blocked || 'nothing is marked',
}

/** An editing editor as the record has it now; any other state as it is. */
export function settleEditor(state: string, facts: EditorFacts): string {
  if (state !== 'editing') return state
  const r = transition(editor, editorGuards, state, { type: 'FACTS' }, facts)
  return r.ok ? r.state : state
}
