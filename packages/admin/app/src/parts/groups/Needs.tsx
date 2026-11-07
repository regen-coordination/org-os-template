import { NeedsList } from '../../elements/needs/NeedsList.tsx'
import { needsFrom } from '../../elements/needs/needs.ts'
import { ACTOR, NEEDS_SYSTEMS, PROPOSALS, PROPOSAL_RESOURCES } from '../../test/fixtures/house/governance.ts'
import { FIXED_NOW } from '../../test/fixtures/parts.ts'

const noop = () => {}

/** Needs you as the house reads it: from the Systems' Resources and the open proposals, for the member /parts is
 *  drawn for — one of each kind of need, in Needs you's order. */
const ITEMS = needsFrom([...NEEDS_SYSTEMS, ...PROPOSAL_RESOURCES], PROPOSALS, ACTOR, FIXED_NOW)

/** /parts/needs (§9.4): the list in every kind of need — overdue, waiting on your approval, empty hats, a signature
 *  (the link-out), chains that disagree, a failed read, and one you approved that waits on others — and beside it
 *  the list's other states: nothing waits, the first load, and an error. Fixtures, read against FIXED_NOW. */
export default function Needs() {
  return (
    <div className="pg">
      <p className="pg-lede">One row per thing waiting on this member, clay tile first. The same items light the nodes on the map. When you have acted and others haven’t, the row stays with a neutral tile until it leaves for Recently.</p>
      <div className="pg-side">
        <NeedsList items={ITEMS} systemsLine="9 Systems read 4 min ago, none failing." now={FIXED_NOW} />
        <div className="pg-side-col">
          <NeedsList items={[]} systemsLine="9 Systems read 4 min ago, none failing." now={FIXED_NOW} />
          <NeedsList items={null} systemsLine="9 Systems read 4 min ago, none failing." now={FIXED_NOW} />
          <NeedsList items={null} error="Couldn’t work out what needs you." onRetry={noop} systemsLine="9 Systems read 4 min ago, none failing." now={FIXED_NOW} />
        </div>
      </div>
    </div>
  )
}
