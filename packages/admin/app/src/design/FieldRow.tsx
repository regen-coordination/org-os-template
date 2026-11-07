import type { ReactNode } from 'react'
import { Icon } from './Icon.tsx'
import { StatusMark } from './StatusMark.tsx'
import { RestrictedValue } from '../viewAs/VisibilityMarker.tsx'

/** A field row (§9.3): the label (13 mute) and its value (14), a `dt`/`dd` pair of a `FieldTable`. Read, or edit in
 *  place with an input as the value. Staged: the moss bar, the old value struck (Mono faint) before the new, and the
 *  staged mark. Stale: the clay bar and "now <value> on the trunk". Restricted: a lock in the label and "<hat> only"
 *  in faint in place of the value, which is never drawn (§6.3 rendering 2; `hat` is the hat's name). An error is a
 *  clay note under the value, its id `<htmlFor>-err` for the input's aria-describedby, as 0.6's was. The value (the
 *  struck old one with it) is one inline run, `.fields-v`: text and links in it flow as text ("A, B"), and only
 *  the marks and the note are laid out beside it. `help` is a line under the value in mute (a schema's description on
 *  the new-record form), its id `<describe>-help`; `describe` names the ids when the value is no labelled input (a
 *  segmented choice, a group of rows), else they follow `htmlFor`. */
export function FieldRow({ label, htmlFor, describe, staged = false, was, stale, restricted, error, help, children }:
  { label: string; htmlFor?: string; describe?: string; staged?: boolean; was?: ReactNode; stale?: string; restricted?: { hat: string }; error?: string; help?: ReactNode; children: ReactNode }) {
  const ids = htmlFor ?? describe
  // a restricted value is absent (§6.3), and so is any change pending on it
  const bar = restricted ? undefined : staged ? 'staged' : stale !== undefined ? 'stale' : undefined
  const struck = staged && was !== undefined
  const shown = struck || (children !== undefined && children !== null && children !== false && children !== '')
  return (
    <>
      <dt>
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
        {restricted && <Icon name="lock" size="xs" />}
      </dt>
      <dd className={bar}>
        {restricted
          ? <RestrictedValue hat={restricted.hat} />
          : <>
              {shown && (
                <span className="fields-v">
                  {struck && <span className="was"><span className="sr-only">was </span><s>{was}</s></span>}
                  {children}
                </span>
              )}
              {staged && <StatusMark mark="staged" />}
              {!staged && stale !== undefined && <StatusMark mark="stale" label={`now ${stale} on the trunk`} />}
            </>}
        {help && !restricted && <span className="fields-help" id={ids ? `${ids}-help` : undefined}>{help}</span>}
        {error && <span className="note note-error" id={ids ? `${ids}-err` : undefined}><Icon name="alert" size="sm" />{error}</span>}
      </dd>
    </>
  )
}

/** The field rows of a record (§9.3): a two-column `<dl>`, named as a group by its label. Its wrapper is the
 *  `field` container, so the labels stack above the values under 420px of it. */
export function FieldTable({ label, children }: { label: string; children: ReactNode }) {
  return <div className="fields-w" role="group" aria-label={label}><dl className="fields">{children}</dl></div>
}
