import type { ReactNode } from 'react'
import type { ReadingState } from '../../../../server/systems/driver.ts'
import { Icon } from '../../design/Icon.tsx'
import { Spinner } from '../../design/Spinner.tsx'
import { ageText } from '../../time.ts'

export type { ReadingState }

const readable = (iso: string | null | undefined): string | null =>
  typeof iso === 'string' && !Number.isNaN(new Date(iso).getTime()) ? iso : null

/** How old a read is (§7.9, §6.2), in 12 faint: fresh "read 4 min ago"; aged, mute after a clock; failed, clay
 *  after the alert glyph, "couldn’t read · last 2 h ago" (or "not read yet · couldn’t read" with no last good
 *  read); reading, the ring and "reading…"; unknown, "not read yet". A `<time datetime>` with the full ISO in
 *  its title whenever there is a time to name. `lastGood` is the last good read of a failed one; left out, it is
 *  `readAt`, as 0.6's reads keep their last good time there. */
export function ReadAge({ state, readAt, lastGood, now }:
  { state: ReadingState; readAt: string | null; lastGood?: string | null; now: Date }) {
  let cls = 'age'
  let glyph: ReactNode = null
  let text = 'not read yet'
  let iso: string | null = null
  switch (state) {
    case 'fresh': case 'aged':
      iso = readable(readAt)
      if (iso !== null) {
        text = `read ${ageText(iso, now)}`
        if (state === 'aged') { cls = 'age age-aged'; glyph = <Icon name="clock" size="xs" /> }
      }
      break
    case 'failed': {
      cls = 'age age-failed'
      glyph = <Icon name="alert" size="xs" />
      const last = readable(lastGood === undefined ? readAt : lastGood)
      if (last !== null) { iso = last; text = `couldn’t read · last ${ageText(last, now)}` }
      else { iso = readable(readAt); text = 'not read yet · couldn’t read' }
      break
    }
    case 'reading':
      iso = readable(readAt)
      glyph = <Spinner />
      text = 'reading…'
      break
    default:
      break
  }
  return iso === null
    ? <span className={cls}>{glyph}{text}</span>
    : <time className={cls} dateTime={iso} title={iso}>{glyph}{text}</time>
}
