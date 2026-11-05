import { DoorPage } from '../../door/DoorPage.tsx'
import { MembersOnly } from '../../door/MembersOnly.tsx'
import { doorSections, publicOnly, type DoorModel } from '../../door/door.ts'
import { DOOR_PUBLIC, DOOR_RECORDS } from '../../test/fixtures/house/door.ts'
import { FIXED_NOW } from '../../test/fixtures/parts.ts'
import { Card } from './spec.tsx'
import { SpecimenHeadings } from '../../design/PageHeading.tsx'

/** A door with little public content (review focus 5): no public pool, no decision, no writing — those sections are
 *  absent and the rest close up, 01 and 02; the hero keeps only the facts it can compute. */
const SPARSE: DoorModel = publicOnly({ ...DOOR_PUBLIC, pools: [], decisions: [], writing: [], openNote: undefined }, DOOR_RECORDS)

/** /parts/door (§12): the public door, built from public fixtures only — the top, the hero, the map plate, the five
 *  numbered sections and the foot — then a door with little public content, renumbered, and the slot that stands in
 *  for what is not public. Read against FIXED_NOW. */
export default function Door() {
  return (
    <div className="pg">
      <p className="pg-lede">The DAO’s website, built only from public records. Editorial: Fraunces, numbered sections, generous space, plain words (“Who holds what”, “What we fund”). It leads with the map. Hats, never the people who wear them. Balances and dates here are fixture values.</p>
      <div className="pg-door" role="group" aria-label="The public door"><SpecimenHeadings level={2}><DoorPage model={DOOR_PUBLIC} now={FIXED_NOW} specimen /></SpecimenHeadings></div>
      <Card cap="little public content · the sections close up">
        <ol className="pg-door-secs" aria-label="Its sections">
          {doorSections(SPARSE).map(s => <li key={s.id}><span className="door-sec-no">{s.no}</span> <span className="door-sec-t">{s.name}</span></li>)}
        </ol>
        <ul className="door-facts" aria-label="Its facts">
          {SPARSE.facts.map(f => <li key={f.label} className="door-fact"><span className="door-fact-f">{f.figure}</span> <span className="door-fact-l">{f.label}</span></li>)}
        </ul>
      </Card>
      <Card cap="not public · in its place">
        <MembersOnly />
      </Card>
    </div>
  )
}
