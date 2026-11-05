import { Fragment } from 'react'
import { Icon } from '../../design/Icon.tsx'
import { Meter } from '../../design/Meter.tsx'
import { compactPhrase, type Step, type StepState } from './timeline.ts'

/** Each state in words (§9.5): what the marker's shape shows, said before the step's title. */
const WORD: Record<StepState, string> = { done: 'Done', current: 'Now', waiting: 'Waiting', yours: 'Yours', failed: 'Failed', 'not-needed': 'Not needed' }
/** The compact dot's class per state: ink (done), ink ring with centre (now), moss (yours), clay (failed), dashed. */
const DOT: Record<StepState, string> = { done: 'd', current: 'n', waiting: '', yours: 'y', failed: 'f', 'not-needed': 's' }

/** A step's second line: its meter, then its words, the line after them ("2 of 4 · signers sign in the Safe app"). */
function Line({ step }: { step: Step }) {
  const { meter, line } = step
  if (!meter && (line === undefined || line === null || line === '')) return null
  if (meter && typeof line === 'string') return <div className="tl-s"><Meter {...meter} words={`${meter.words} · ${line}`} /></div>
  return <div className="tl-s">{meter && <Meter {...meter} />}{line}</div>
}

/** The proposal's path (§9.5): vertical, 22px markers joined by a 1px line (ink once passed), an `<ol>` whose items
 *  say their state in words. `compact` is the form for rows and the door: 10px dots joined by 14px lines and one
 *  phrase ("Signing · 2 of 4"); the dots are decoration, the phrase says it. */
export function Timeline({ steps, compact = false, label = 'Path' }: { steps: Step[]; compact?: boolean; label?: string }) {
  if (compact) {
    return (
      <span className="tlc">
        <span className="tlc-dots" aria-hidden="true">
          {steps.map((s, i) => (
            <Fragment key={s.id}>
              {i > 0 && <b className={steps[i - 1]!.state === 'done' ? 'd' : ''} />}
              <i className={DOT[s.state]} />
            </Fragment>
          ))}
        </span>
        <span className="tlc-l">{compactPhrase(steps)}</span>
      </span>
    )
  }
  return (
    <ol className="tl" aria-label={label}>
      {steps.map(s => (
        <li key={s.id} className={`tl-step tl-${s.state}`}>
          <span className="tl-mk" aria-hidden="true">
            {(s.state === 'done' || s.state === 'yours') && <Icon name="check" size="xs" />}
            {s.state === 'failed' && <Icon name="x" size="xs" />}
          </span>
          <div className="tl-b">
            <span className="sr-only">{WORD[s.state]}: </span>
            <div className="tl-t">{s.title}</div>
            <Line step={s} />
          </div>
        </li>
      ))}
    </ol>
  )
}
