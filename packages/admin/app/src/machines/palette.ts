import { defineMachine } from '../../../lib/machines/run.mjs'

/** ⌘K (spec §6.8 of P1). ⌘K toggles; Escape and a click outside close, from any open state
 *  (interfaces P4-C6); choosing an item runs it, then the palette closes. */
export const palette = defineMachine({
  id: 'palette',
  initial: 'closed',
  events: ['OPEN', 'TOGGLE', 'CLOSE', 'RUN', 'DONE'],
  guards: [],
  states: {
    closed: { shows: { mark: null, text: 'Closed.' }, on: { OPEN: 'searching', TOGGLE: 'searching' } },
    searching: { shows: { mark: null, text: 'Searching.' }, on: { TOGGLE: 'closed', CLOSE: 'closed', RUN: 'running' } },
    running: { shows: { mark: 'running', text: 'Running the chosen item.' }, on: { DONE: 'closed', CLOSE: 'closed' } },
  },
})
