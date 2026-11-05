import { defineMachine, type Guards } from '../../../lib/machines/run.mjs'

/** One library entry in view (design 2026-10-18, section 4.5): browsing the shelf, previewing an entry,
 *  viewing one that has nothing to add (a built-in board, the solo default), refused (its id is taken), or
 *  staged (added to the changes). Preview writes nothing. ADD is guarded by
 *  `addable`, which the page sets when the preview's `cannotAdd` is null; otherwise the guard's sentence
 *  (`whyNot`, the preview's own reason) is what the page says. */
export const libraryEntry = defineMachine({
  id: 'libraryEntry',
  initial: 'browsing',
  events: ['PREVIEW', 'VIEW', 'CLOSE', 'REFUSE', 'ADD'],
  guards: ['addable'],
  states: {
    browsing: { shows: { mark: null, text: 'Browsing the library.' }, on: { PREVIEW: 'previewing', VIEW: 'viewing' } },
    previewing: {
      shows: { mark: null, text: 'Previewing {title}. Nothing changes until it is added.' },
      on: { PREVIEW: 'previewing', VIEW: 'viewing', CLOSE: 'browsing', REFUSE: 'refused', ADD: { to: 'staged', when: 'addable' } },
    },
    viewing: {
      shows: { mark: null, text: 'Viewing {title}. It adds nothing to this organization.' },
      on: { PREVIEW: 'previewing', VIEW: 'viewing', CLOSE: 'browsing' },
    },
    refused: { shows: { mark: 'failed', text: '{reason}' }, on: { PREVIEW: 'previewing', VIEW: 'viewing', CLOSE: 'browsing' } },
    staged: { shows: { mark: 'staged', text: '{title} is staged in the changes.' }, on: { PREVIEW: 'previewing', VIEW: 'viewing', CLOSE: 'browsing' } },
  },
})

/** The guard's sentence when the page has no reason of its own to give (the preview has not loaded). */
export const ADD_WHY = 'Adding an entry is not available yet.'
interface Context { addable?: boolean; whyNot?: string }
export const libraryEntryGuards: Guards = {
  addable: (ctx: Context) => (ctx.addable === true ? true : ctx.whyNot ?? ADD_WHY),
}
