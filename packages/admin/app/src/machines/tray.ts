import { defineMachine } from '../../../lib/machines/run.mjs'

/** The Changes tray's action lifecycle (P4a ruling 3): one action at a time (apply, discard,
 *  unstage, rebase), then applied, failed or idle again. Whether the diff is shown is not here:
 *  it is the tray's own until P4b puts it in the bottom panel slot. */
export const tray = defineMachine({
  id: 'tray',
  initial: 'idle',
  events: ['ACT', 'DONE', 'APPLIED', 'FAIL', 'CLEAR', 'TIMEOUT'],
  guards: [],
  states: {
    idle: { shows: { mark: null, text: 'Ready.' }, on: { ACT: 'busy' } },
    busy: { shows: { mark: 'running', text: 'Working.' }, on: { DONE: 'idle', APPLIED: 'applied', FAIL: 'failed' } },
    applied: { shows: { mark: 'done', text: 'Applied.' }, on: { TIMEOUT: 'idle', ACT: 'busy' } },
    failed: { shows: { mark: 'failed', text: 'Not done: every staged change is kept.' }, on: { ACT: 'busy', CLEAR: 'idle' } },
  },
})
