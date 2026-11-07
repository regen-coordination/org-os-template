import type { ReactNode } from 'react'
import { FromMark, type From } from '../elements/atoms/FromMark.tsx'
import { ageText } from '../time.ts'
import type { SystemsRead } from '../blocks/needs.tsx'

const WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']

/** Home's line (§14.1, `--fs-greet`): how many things wait on you, in words up to nine. 0 "Nothing waits on you.",
 *  1 "One thing waits on you.", 2–9 "Three things wait on you.", from 10 the number: "12 things wait on you." */
export function homeLine(n: number): string {
  const count = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0))
  if (count === 0) return 'Nothing waits on you.'
  if (count === 1) return 'One thing waits on you.'
  return `${count < 10 ? WORDS[count] : String(count)} things wait on you.`
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** Today as Home's eyebrow says it: "Thursday 29 October", in the viewer's own day. */
export function dayLine(now: Date): string {
  return `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`
}

/** The line under Home's: "Everything else is as it was read 4 min ago · 9 Systems, none failing". */
export function homeSub(s: SystemsRead, now: Date): ReactNode[] {
  if (s.count === 0) return ['No Systems are read here yet']
  const systems = `${s.count} ${s.count === 1 ? 'System' : 'Systems'}, ${s.failing === 0 ? 'none failing' : `${s.failing} failing`}`
  if (s.readAt === null) return [`${s.count} ${s.count === 1 ? 'System' : 'Systems'}, none read yet`]
  return [<>Everything else is as it was read <time className="age" dateTime={s.readAt} title={s.readAt} data-volatile="">{ageText(s.readAt, now)}</time></>, systems]
}

/** Home's head (§14.1, the gallery's `greet`): the day as an eyebrow, the line in the display face (the page's h1:
 *  what waits on you; `needs` null while it is read; `failed` when the reads did not answer), and under it how the Systems were read, then the from mark (the
 *  instance and its read age, E-47). `children` are the board's own actions (Arrange). */
export function HomeHead({ needs, systems, now, from, failed = false, children }:
  { needs: number | null; systems: SystemsRead; now: Date; from?: From; failed?: boolean; children?: ReactNode }) {
  // while the reads are on their way the sub-line says nothing of the Systems, which are not read yet (review M-9)
  const sub = needs === null ? [] : homeSub(systems, now)
  // the line says how the Systems were read and when: the from mark then names the instance without a second age
  // (walk 2026-11-04)
  const aged = needs !== null && systems.count > 0 && systems.readAt !== null
  const mark: From | undefined = from && aged && 'repo' in from ? { ...from, readAt: null } : from
  return (
    <header className="greet">
      <span className="greet-day">{dayLine(now)}</span>
      <h1 className="greet-t">{failed ? 'What waits on you couldn’t be read.' : needs === null ? 'Reading what waits on you…' : homeLine(needs)}</h1>
      <p className="greet-s">
        {[...sub, ...(mark ? [<FromMark key="from" from={mark} now={now} />] : [])].map((part, i) => (
          <span key={i}>{i > 0 && <span className="greet-sep" aria-hidden="true"> · </span>}{part}</span>
        ))}
      </p>
      {children && <div className="rh-acts">{children}</div>}
    </header>
  )
}
