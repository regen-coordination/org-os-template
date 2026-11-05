// packages/admin/lib/machines/board.mjs
//
// A board's lifecycle (P4 spec §3.3). In P4 a board is shared and nothing moves it; `shared` is
// final until spec §5.5 adds draft → promoted (P4a ruling 10).

import { defineMachine } from './run.mjs'

export const board = defineMachine({
  id: 'board',
  initial: 'shared',
  events: [],
  guards: [],
  states: {
    shared: { shows: { mark: null, text: 'Shared with the org.' }, final: true },
  },
})
