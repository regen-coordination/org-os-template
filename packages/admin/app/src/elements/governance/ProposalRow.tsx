import type { ProposalView } from '../../api.ts'
import { Meter } from '../../design/Meter.tsx'
import type { Mark } from '../../design/StatusMark.tsx'
import { recordHref } from '../../hrefs.ts'
import { ageText } from '../../time.ts'
import { closingText } from '../needs/needs.ts'
import { record, str } from '../rows/systemState.ts'
import { DataRow } from '../rows/DataRow.tsx'
import { Icon } from '../../design/Icon.tsx'
import { preparedFromProposal } from './prepared.ts'
import { isRestricted } from './seen.ts'
import { Timeline } from './Timeline.tsx'
import { timelineOf } from './timeline.ts'

const CLOSED: ReadonlySet<string> = new Set(['rejected', 'withdrawn', 'expired'])

/** Its marks: needs you while it waits on the viewer; Decided once ratified; closed (and dimmed) otherwise. */
function marksOf(view: ProposalView): Mark[] {
  if (view.state === 'ratified') return ['done']
  if (CLOSED.has(String(view.state))) return ['closed']
  return view.needsYou ? ['needs'] : []
}

/** A proposal as a data row (§9.2, §14.1): the id in Mono, the title, the route (its rule), the compact timeline read
 *  from the ledger (`preparedFromProposal`) and the meter of the step under way; at the end its deadline ("Closes in
 *  5 days", clay once past) while open, or the day it closed. One link to the proposal. Under 760px of its list the
 *  end moves under the title. `actor` is the viewer: their own approval is the meter's moss segment, "you approved"
 *  (E-51). A proposal about restricted data (rule 8) draws its restricted form: the server's title ("A change to a
 *  restricted collection") and the rule beside a lock, its state and deadline, and nothing of what it changes. */
export function ProposalRow({ view, now, actor = null }: { view: ProposalView; now: Date; actor?: string | null }) {
  const id = String(view.id)
  const steps = timelineOf(view, preparedFromProposal(view), actor)
  const under = steps.find(s => s.state === 'current' || s.state === 'yours')
  const meter = under?.meter
  const route = view.rules[0]?.sentence
  const deadline = view.state === 'open' && view.evaluation.closesAt ? closingText(view.evaluation.closesAt, now) : null
  const closedAt = str(record(view.closed).at)
  const restricted = isRestricted(view)
  return (
    <DataRow
      kind="proposal" className={restricted ? 'prow prow-restricted' : 'prow'} title={String(view.title)} href={recordHref(`proposal:${id}`)} marks={marksOf(view)}
      second={<>
        <span className="prow-id">{id}</span>
        {restricted && <Icon name="lock" size="xs" />}
        {route && <span className="prow-route">{route}</span>}
        <Timeline steps={steps} compact />
        {meter && <span className={meter.yours ? 'prow-yours' : undefined}><Meter {...meter} words={under?.id === 'signed' ? `${meter.words} signed` : meter.words} /></span>}
      </>}
      trailing={deadline ? <span className={deadline.late ? 'prow-late' : undefined} data-volatile="">{deadline.text}</span>
        : view.state !== 'open' && closedAt ? <time dateTime={closedAt}>{ageText(closedAt, now)}</time> : undefined}
    />
  )
}
