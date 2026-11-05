import { defineMachine } from '../../../lib/machines/run.mjs'

/** One panel slot (right, bottom or overlay), one instance each (P4 spec §4.5; interfaces P4-C5).
 *  OPEN carries the panel's `id`; opening an open slot replaces what it shows. Closing returns focus
 *  to whoever opened it. There is no ESCAPE event: the panel stack sends CLOSE to the top slot.
 *  Wired in P4b. */
export const panels = defineMachine({
  id: 'panels',
  initial: 'closed',
  events: ['OPEN', 'CLOSE'],
  guards: [],
  states: {
    closed: { shows: { mark: null, text: 'Closed.' }, on: { OPEN: 'open' } },
    open: { shows: { mark: null, text: 'Open.' }, on: { OPEN: 'open', CLOSE: { to: 'closed', effects: ['returnFocus'] } } },
  },
})
