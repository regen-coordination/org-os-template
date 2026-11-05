import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { KindTile } from '../design/KindTile.tsx'
import { Note } from '../design/Note.tsx'
import { Spinner } from '../design/Spinner.tsx'

export type WizardView = 'intro' | 'step' | 'review' | 'running' | 'done' | 'failed' | 'closed'

export interface WizardAction { label: string; onClick: () => void; disabled?: boolean }

/** One line of a run's progress: a spinner while it runs, a check once done. */
export interface WizardLine { text: string; done?: boolean }

export interface WizardFrameProps {
  /** The wizard's name: the eyebrow's first words. */
  title: string
  /** The landmark's name when it differs from the title (/parts draws one frame per state). */
  label?: string
  /** The titles of the steps before the review; the review is added last. */
  steps: string[]
  /** The last step's name: "Review" unless the flow calls it otherwise (the stepped new-record form's "Check"). */
  last?: string
  view: WizardView
  /** The step shown, from 0, when `view` is `step`. */
  index: number
  /** Where this screen is in the rail, when the caller counts otherwise ("Compose a DAO · 3 of 5"); by default the
   *  current step of the steps and the review. */
  count?: { at: number; of: number }
  heading: string
  ask?: ReactNode
  /** What this screen writes. Said on every screen, even when the answer is "Nothing yet." */
  writes: ReactNode
  /** The machine's sentence for this state; spoken politely. Left out where the page says it through its one live
   *  region instead (`parts/live.tsx`, as the stepped new-record form does), so the frame draws no second one. */
  status?: string
  /** A guard's own sentence, when the person asked for something that cannot be done now; on `failed`, why. */
  refusal?: string | null
  /** A run's progress, on `running`. */
  lines?: WizardLine[]
  /** `cancel` is Save and leave (ghost, first); `back`, `skip` (a step a person may leave out) and `next` (primary)
   *  close the foot. */
  actions: { back?: WizardAction; cancel?: WizardAction; skip?: WizardAction; next?: WizardAction }
  children?: ReactNode
}

/** Which of the steps (and the review last) is current, and which are behind. */
function progress(view: WizardView, index: number, count: number): { current: number; done: number } {
  if (view === 'step') return { current: index, done: index }
  if (view === 'review' || view === 'running' || view === 'failed') return { current: count - 1, done: count - 1 }
  if (view === 'done') return { current: -1, done: count }
  return { current: -1, done: 0 }
}

/** The eyebrow's count: "3 of 5" on a screen of the rail, the steps on the intro, the end's word after it. */
function counted(view: WizardView, at: number, of: number): string {
  if (view === 'intro') return `${of} steps`
  if (view === 'done') return 'Done'
  if (view === 'closed') return 'Closed'
  return `${at} of ${of}`
}

/** The wizard part (§11.3; wizards spec §5.3): one decision per screen. A step rail (numbered circles: done an ink
 *  disc with a check, current an ink ring and its label in 500, ahead a --rule-strong ring); the body — the eyebrow
 *  "<wizard> · 3 of 5", the question as the screen's heading, one sentence of why, the choices or fields, the
 *  **This screen writes** well — and the foot: Save and leave (ghost) · Back · Continue (primary). Running is lines
 *  of progress; done is a moss tile beside what was done, failed a clay tile beside why. Under 560px of its own width
 *  the rail becomes a top line, "<step> · step 3 of 5", and the foot's buttons take the width. It draws whatever
 *  state the wizard machine is in and holds no state of its own, so /parts can show it in each. A refusal is a clay
 *  note; the machine's sentence is the polite announcement. */
export function WizardFrame({ title, label, steps, last = 'Review', view, index, count, heading, ask, writes, status, refusal, lines, actions, children }: WizardFrameProps) {
  const items = [...steps, last]
  const at = progress(view, index, items.length)
  const where = count ?? { at: at.current >= 0 ? at.current + 1 : view === 'done' ? items.length : 1, of: items.length }
  const name = items[where.at - 1] ?? title
  const heading2 = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)
  // A new screen starts at its heading, so a screen reader hears where it is. Not on the first draw:
  // the page has just been opened and its own title is where the reader already is.
  useEffect(() => {
    if (first.current) { first.current = false; return }
    heading2.current?.focus()
  }, [view, index])
  const out = view === 'done' || view === 'failed'
  const h = <h2 ref={heading2} tabIndex={-1} className="wiz-h">{heading}</h2>
  const note = refusal ? <Note state="error">{refusal}</Note> : null
  const foot = (actions.cancel || actions.back || actions.skip || actions.next) && (
    <div className="wiz-foot">
      {actions.cancel && <Button variant="ghost" onClick={actions.cancel.onClick} disabled={actions.cancel.disabled}>{actions.cancel.label}</Button>}
      <span className="wiz-end">
        {actions.back && <Button onClick={actions.back.onClick} disabled={actions.back.disabled}>{actions.back.label}</Button>}
        {actions.skip && <Button onClick={actions.skip.onClick} disabled={actions.skip.disabled}>{actions.skip.label}</Button>}
        {actions.next && <Button primary onClick={actions.next.onClick} disabled={actions.next.disabled}>{actions.next.label}</Button>}
      </span>
    </div>
  )
  return (
    <section className="wiz-c" aria-label={label ?? title}>
      <div className="wiz">
        <ol className="wiz-steps" aria-label="Steps">
          {items.map((step, i) => {
            const state = i < at.done ? 'done' : i === at.current ? 'current' : 'todo'
            return (
              <li key={i} className={state === 'todo' ? 'wiz-step' : `wiz-step ${state}`} aria-current={state === 'current' ? 'step' : undefined}
                aria-label={state === 'done' ? `${step}, done` : step}>
                <span className="wiz-dot" aria-hidden="true">{state === 'done' ? <Icon name="check" size="xs" /> : i + 1}</span>
                <span className="wiz-step-t">{step}</span>
              </li>
            )
          })}
        </ol>
        <div className="wiz-main">
          <p className="wiz-top">{view === 'intro' || view === 'closed' || view === 'done'
            ? <><b>{title}</b>{` · ${counted(view, where.at, where.of)}`}</>
            : <><b>{name}</b>{` · step ${where.at} of ${where.of}`}</>}</p>
          <div className="wiz-body">
            <p className="wiz-k">{`${title} · ${counted(view, where.at, where.of)}`}</p>
            {out
              ? (
                <div className="wiz-out">
                  <KindTile kind="" size="needs" tone={view === 'done' ? 'moss' : 'attn'} icon={view === 'done' ? 'check' : 'alert'} />
                  <div className="wiz-out-b">
                    {h}
                    {ask !== undefined && <p className="wiz-ask">{ask}</p>}
                    {note}
                    {children}
                    {foot}
                  </div>
                </div>
              )
              : (
                <>
                  {h}
                  {ask !== undefined && <p className="wiz-ask">{ask}</p>}
                  {lines && lines.length > 0 && (
                    <ul className="wiz-lines" aria-label="Progress">
                      {lines.map(l => <li key={l.text}>{l.done ? <Icon name="check" size="sm" /> : <Spinner />}<span>{l.text}</span></li>)}
                    </ul>
                  )}
                  {children}
                  {note}
                </>
              )}
            <div className="wiz-writes" role="group" aria-label="What this writes"><span className="wiz-writes-k">This screen writes</span><span className="wiz-writes-v">{writes}</span></div>
            {status !== undefined && <p className="sr-only" role="status">{status}</p>}
            {!out && foot}
          </div>
        </div>
      </div>
    </section>
  )
}
