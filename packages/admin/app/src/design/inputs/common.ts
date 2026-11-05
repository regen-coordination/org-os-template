import { createElement, type ReactNode } from 'react'
import { Icon } from '../Icon.tsx'

/** What every input carries: its id (the label's `for`), whether it is invalid and which error describes it, and
 *  whether it must be filled in before its form is sent (said to a screen reader before a failed send, WCAG 3.3.2). */
export type Common = { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string; 'aria-required'?: boolean; placeholder?: string
  /** The name of an input no label points at (a choice's Other…, a row's cell). */
  'aria-label'?: string }

/** What every input may be asked to show (§7.2): Mono for addresses, amounts and ids; a staged value's
 *  previous value, struck under it; an error, in clay with the alert glyph, under it. */
export interface Look { mono?: boolean; staged?: { was: string }; error?: string }

/** The attributes an input draws with, and what follows it. The old value and the error are linked to the
 *  input through aria-describedby, after any description the caller gave; with neither, nothing follows,
 *  and the input renders alone as in 0.6. */
export function look(common: Common, { mono, staged, error }: Look, base = 'input'): { attrs: Common & { className: string }; after: ReactNode } {
  const wasId = `${common.id}-was`, errId = `${common.id}-err`
  const describedby = [common['aria-describedby'], staged ? wasId : null, error ? errId : null].filter(Boolean).join(' ')
  const attrs = {
    ...common,
    className: mono ? `${base} mono-in` : base,
    'aria-describedby': describedby || undefined,
    'aria-invalid': error ? true : common['aria-invalid'],
  }
  if (!staged && !error) return { attrs, after: null }
  return {
    attrs,
    after: [
      staged && createElement('span', { key: 'was', id: wasId, className: 'was-line' },
        createElement('span', { className: 'sr-only' }, 'Was: '), createElement('s', { className: 'was' }, staged.was)),
      error && createElement('span', { key: 'err', id: errId, className: 'err-msg' }, createElement(Icon, { name: 'alert', size: 'xs' }), error),
    ],
  }
}
