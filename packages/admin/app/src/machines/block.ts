import { defineMachine, type Guards } from '../../../lib/machines/run.mjs'

const SETTLE = { LOADED: [{ to: 'ready', when: 'hasRows' }, 'empty'], FAILED: 'error', UNAVAILABLE: 'unavailable', NOT_YET: 'notYet' }

/** One block on a board (P4 spec §4.3; interfaces P4-C4). Loaded data settles it by its count; a
 *  reload goes back to loading from anywhere but loading. No state is final. Wired in P4b. */
export const block = defineMachine({
  id: 'block',
  initial: 'loading',
  events: ['LOADED', 'FAILED', 'UNAVAILABLE', 'NOT_YET', 'RELOAD'],
  guards: ['hasRows'],
  states: {
    loading: { shows: { mark: 'running', text: 'Loading.' }, on: { ...SETTLE } },
    ready: { shows: { mark: null, text: 'Ready.' }, on: { ...SETTLE, RELOAD: 'loading' } },
    empty: { shows: { mark: null, text: 'Nothing here yet.' }, on: { ...SETTLE, RELOAD: 'loading' } },
    error: { shows: { mark: 'failed', text: 'This block could not be loaded.' }, on: { ...SETTLE, RELOAD: 'loading' } },
    notYet: { shows: { mark: null, text: 'This block arrives with a later part of org-os.' }, on: { RELOAD: 'loading' } },
    unavailable: { shows: { mark: 'aged', text: 'The outside system is not answering: its last good read is shown.' }, on: { ...SETTLE, RELOAD: 'loading' } },
  },
})

export const blockGuards: Guards = {
  hasRows: (_c, e) => Number(e.count) > 0 || 'nothing to show',
}
