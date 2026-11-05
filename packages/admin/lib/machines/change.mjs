// packages/admin/lib/machines/change.mjs
//
// An actor's staged change (architecture §4.3, P4 spec §3.3). Its state is derived from the change
// and never stored: empty with no ops, applying inside the apply lock, stale with any stale op,
// staged otherwise. Only Apply consults it on the server (P4a ruling 5).

import { defineMachine } from './run.mjs'

/** What the guards read. For APPLY: the change as it stands. For every other event: the change
 *  as it is after the event.
 *  @typedef {{ ops: unknown[], stale: number[], rule?: { direct: boolean, sentence: string } | null }} ChangeContext */

export const change = defineMachine({
  id: 'change',
  initial: 'empty',
  events: ['STAGE', 'UNSTAGE', 'BASE_MOVED', 'TAKE_THEIRS', 'KEEP_MINE', 'APPLY', 'APPLIED', 'REFUSED', 'DISCARD'],
  guards: ['nowEmpty', 'stillStale', 'directRule'],
  states: {
    empty: { shows: { mark: null, text: 'Nothing is staged.' }, on: { STAGE: 'staged' } },
    staged: {
      shows: { mark: 'staged', text: 'Changes are staged.' },
      on: {
        STAGE: 'staged',
        UNSTAGE: [{ to: 'empty', when: 'nowEmpty' }, 'staged'],
        BASE_MOVED: 'stale',
        DISCARD: 'empty',
        APPLY: { to: 'applying', when: 'directRule', effects: ['commit'] },
      },
    },
    stale: {
      shows: { mark: 'stale', text: 'A record changed since you staged it: Take theirs or Keep mine first.' },
      on: {
        STAGE: 'stale',
        BASE_MOVED: 'stale',
        DISCARD: 'empty',
        UNSTAGE: [{ to: 'empty', when: 'nowEmpty' }, { to: 'stale', when: 'stillStale' }, 'staged'],
        TAKE_THEIRS: [{ to: 'empty', when: 'nowEmpty' }, { to: 'stale', when: 'stillStale' }, 'staged'],
        KEEP_MINE: [{ to: 'stale', when: 'stillStale' }, 'staged'],
      },
    },
    applying: {
      shows: { mark: 'running', text: 'Applying.' },
      on: { APPLIED: 'empty', REFUSED: [{ to: 'stale', when: 'stillStale' }, 'staged'] },
    },
  },
})

/** @type {import('./run.mjs').Guards} */
export const changeGuards = {
  nowEmpty: (/** @type {ChangeContext} */ ctx) => ctx.ops.length === 0 || 'other ops are still staged',
  stillStale: (/** @type {ChangeContext} */ ctx) => ctx.stale.length > 0 || 'no op is stale',
  directRule: (/** @type {ChangeContext} */ ctx) => (ctx.rule?.direct === true) || (ctx.rule?.sentence ?? 'no rule lets this actor apply directly'),
}

/** @param {{ ops: unknown[], stale: number[] }} view @param {{ applying?: boolean }} [o]
 *  @returns {'empty' | 'staged' | 'stale' | 'applying'} */
export function deriveChangeState(view, o = {}) {
  if (view.ops.length === 0) return 'empty'
  if (o.applying) return 'applying'
  return view.stale.length > 0 ? 'stale' : 'staged'
}
