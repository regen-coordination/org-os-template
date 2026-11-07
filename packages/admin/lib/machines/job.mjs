// packages/admin/lib/machines/job.mjs
//
// An operation's run (executor). The states are exactly server/state.ts's JobStatus. FINISH carries
// the status the run ended with; a queued job is cancelled or interrupted, never finished.

import { defineMachine } from './run.mjs'

export const job = defineMachine({
  id: 'job',
  initial: 'queued',
  events: ['START', 'FINISH', 'CANCEL', 'INTERRUPT'],
  guards: ['endedOk', 'endedFailed', 'endedTimedOut', 'endedCancelled', 'endedWithSurprises'],
  states: {
    queued: { shows: { mark: null, text: 'Waiting to run.' }, on: { START: 'running', CANCEL: 'cancelled', INTERRUPT: 'interrupted' } },
    running: {
      shows: { mark: 'running', text: 'Running.' },
      on: {
        FINISH: [
          { to: 'ok', when: 'endedOk' }, { to: 'failed', when: 'endedFailed' }, { to: 'timed-out', when: 'endedTimedOut' },
          { to: 'cancelled', when: 'endedCancelled' }, { to: 'finished-with-surprises', when: 'endedWithSurprises' },
        ],
        INTERRUPT: 'interrupted',
      },
    },
    ok: { shows: { mark: 'done', text: 'Done.' }, final: true },
    failed: { shows: { mark: 'failed', text: 'Failed.' }, final: true },
    'timed-out': { shows: { mark: 'failed', text: 'Stopped: it ran out of time.' }, final: true },
    cancelled: { shows: { mark: null, text: 'Cancelled.' }, final: true },
    'finished-with-surprises': { shows: { mark: 'needs', text: 'Done, and it changed files it did not say it would.' }, final: true },
    interrupted: { shows: { mark: 'failed', text: 'Cut short: the server stopped.' }, final: true },
  },
})

/** @param {string} status @returns {import('./run.mjs').Guard} */
const endedAs = status => (_ctx, e) => e.status === status || `the run did not end ${status}`

/** @type {import('./run.mjs').Guards} */
export const jobGuards = {
  endedOk: endedAs('ok'),
  endedFailed: endedAs('failed'),
  endedTimedOut: endedAs('timed-out'),
  endedCancelled: endedAs('cancelled'),
  endedWithSurprises: endedAs('finished-with-surprises'),
}
