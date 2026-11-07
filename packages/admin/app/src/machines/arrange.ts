import { defineMachine, type Guards } from '../../../lib/machines/run.mjs'

/** Arranging a board (P4 spec §5.3): move, resize, add and remove blocks, review, then stage the
 *  whole board as one change. Done with nothing moved stages nothing. Wired in P4c. */
export const arrange = defineMachine({
  id: 'arrange',
  initial: 'off',
  events: ['START', 'MOVE', 'RESIZE', 'ADD', 'REMOVE', 'DONE', 'BACK', 'CONFIRM', 'STAGED', 'REFUSED', 'CANCEL'],
  guards: ['changed'],
  states: {
    off: { shows: { mark: null, text: 'Not arranging.' }, on: { START: 'arranging' } },
    arranging: {
      shows: { mark: null, text: 'Arranging: move, resize, add or remove blocks.' },
      on: { MOVE: 'arranging', RESIZE: 'arranging', ADD: 'arranging', REMOVE: 'arranging', DONE: [{ to: 'review', when: 'changed' }, 'off'], CANCEL: 'off' },
    },
    review: { shows: { mark: 'staged', text: 'Check the new arrangement, then stage it.' }, on: { CONFIRM: 'staging', BACK: 'arranging', CANCEL: 'off' } },
    staging: { shows: { mark: 'running', text: 'Staging the board.' }, on: { STAGED: 'off', REFUSED: 'arranging' } },
  },
})

export const arrangeGuards: Guards = {
  changed: (ctx: { changed: boolean }) => ctx.changed || 'nothing was moved',
}
