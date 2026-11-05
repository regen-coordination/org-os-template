// packages/admin/lib/machines/reading.mjs
//
// One outside system's read (server/systems/reader.ts). Fresh ages past the TTL; a failed read keeps
// the last good one and its age on the page, and is tried again like any other.

import { defineMachine } from './run.mjs'

export const reading = defineMachine({
  id: 'reading',
  initial: 'unknown',
  events: ['READ', 'GOT', 'FAILED', 'TTL_PASSED'],
  guards: [],
  states: {
    unknown: { shows: { mark: null, text: 'Not read yet.' }, on: { READ: 'reading' } },
    reading: { shows: { mark: 'running', text: 'Reading.' }, on: { READ: 'reading', GOT: 'fresh', FAILED: 'failed' } },
    fresh: { shows: { mark: null, text: 'Read recently.' }, on: { READ: 'reading', TTL_PASSED: 'aged' } },
    aged: { shows: { mark: 'aged', text: 'Last read a while ago; it is read again soon.' }, on: { READ: 'reading' } },
    failed: { shows: { mark: 'failed', text: 'The last read failed; the last good read is shown with its age.' }, on: { READ: 'reading' } },
  },
})
