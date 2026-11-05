// packages/admin/lib/machines/wizard.mjs
//
// A wizard's run (wizards spec §5.3): intro → step ⇄ step → review → running → done | failed.
// The wizard itself is data (packages/admin/wizards/*.yaml); this is the machine that walks it.
// The step the person is on is the host's `n` of `total`, moved by the named effects below, so one
// machine serves every wizard.
//
// Nothing is written before review is confirmed: `running` is entered from `review` by CONFIRM and
// from nowhere else, and a failed run comes back through review, never straight to a second write.
// The test pins both. BACK is legal in every state where nothing has been written yet.
//
// Context: { n: the step shown, 1-based · total: how many steps · invalid: why this step cannot be
// left yet, or null · draft: whether a saved draft is waiting }.

import { defineMachine } from './run.mjs'

/** @typedef {{ n: number, total: number, invalid: string | null, draft: boolean }} WizardContext */

export const wizard = defineMachine({
  id: 'wizard',
  initial: 'intro',
  events: ['START', 'RESUME', 'NEXT', 'BACK', 'CONFIRM', 'DONE', 'FAIL', 'RETRY', 'CANCEL'],
  guards: ['stepValid', 'isLastStep', 'notLastStep', 'hasPrevious', 'hasDraft'],
  states: {
    intro: {
      shows: { mark: null, text: 'Not started. Nothing is written until you confirm the last step.' },
      on: { START: { to: 'step', effects: ['step:first'] }, RESUME: { to: 'step', when: 'hasDraft', effects: ['step:resume'] }, CANCEL: 'closed' },
    },
    step: {
      shows: { mark: null, text: 'Step {n} of {total}, then the review. Nothing is written yet.' },
      on: {
        NEXT: [
          { to: 'review', when: ['stepValid', 'isLastStep'], effects: ['step:review'] },
          { to: 'step', when: ['stepValid', 'notLastStep'], effects: ['step:next'] },
        ],
        BACK: [{ to: 'step', when: 'hasPrevious', effects: ['step:back'] }, 'intro'],
        CANCEL: 'closed',
      },
    },
    review: {
      shows: { mark: 'needs', text: 'Review. This is exactly what will be written. Nothing is written until you confirm.' },
      on: { CONFIRM: 'running', BACK: { to: 'step', effects: ['step:last'] }, CANCEL: 'closed' },
    },
    running: { shows: { mark: 'running', text: 'Writing.' }, on: { DONE: 'done', FAIL: 'failed' } },
    done: { shows: { mark: 'done', text: 'Done.' }, final: true },
    failed: {
      shows: { mark: 'failed', text: 'Not done. Look at what it says, then review it again.' },
      on: { RETRY: 'review', BACK: 'review', CANCEL: 'closed' },
    },
    closed: { shows: { mark: null, text: 'Closed. Your answers are kept as a draft; nothing was written.' }, final: true },
  },
})

/** @type {import('./run.mjs').Guards} */
export const wizardGuards = {
  stepValid: (/** @type {WizardContext} */ c) => c.invalid === null || c.invalid === undefined || c.invalid,
  isLastStep: (/** @type {WizardContext} */ c) => c.n >= c.total || 'There are more steps first.',
  notLastStep: (/** @type {WizardContext} */ c) => c.n < c.total || 'This is the last step.',
  hasPrevious: (/** @type {WizardContext} */ c) => c.n > 1 || 'This is the first step.',
  hasDraft: (/** @type {WizardContext} */ c) => c.draft === true || 'There is no draft to continue.',
}
