import { defineMachine } from '../../../lib/machines/run.mjs'

/** Moving a card to another kanban column (P4 spec §3.4; interfaces P4-C7). A drop stages a change;
 *  the keyboard's *Move to…* drops straight from idle; a refused drop snaps back, says why, and is
 *  reset. A card let go on its own column is a CANCEL, not a DROP. Wired in P4c. */
export const drop = defineMachine({
  id: 'drop',
  initial: 'idle',
  events: ['PICK', 'DROP', 'CANCEL', 'STAGED', 'REFUSED', 'RESET'],
  guards: [],
  states: {
    idle: { shows: { mark: null, text: 'Ready.' }, on: { PICK: 'dragging', DROP: 'staging' } },
    dragging: { shows: { mark: 'selected', text: 'Moving a card.' }, on: { DROP: 'staging', CANCEL: 'idle' } },
    staging: { shows: { mark: 'running', text: 'Staging the move.' }, on: { STAGED: 'idle', REFUSED: 'refused' } },
    refused: { shows: { mark: 'failed', text: 'Not moved: {reason}.' }, on: { RESET: 'idle' } },
  },
})
