import { PortalPage } from '../../portal/PortalPage.tsx'
import { MembersOnly } from '../../portal/MembersOnly.tsx'
import { portalSections, publicOnly, type PortalModel } from '../../portal/portal.ts'
import { PORTAL_PUBLIC, PORTAL_RECORDS } from '../../test/fixtures/house/portal.ts'
import { FIXED_NOW } from '../../test/fixtures/parts.ts'
import { Card } from './spec.tsx'
import { SpecimenHeadings } from '../../design/PageHeading.tsx'

/** A portal with little public content (review focus 5): no public pool, no decision, no writing — those sections are
 *  absent and the rest close up, 01 and 02; the hero keeps only the facts it can compute. */
const SPARSE: PortalModel = publicOnly({ ...PORTAL_PUBLIC, pools: [], decisions: [], writing: [], openNote: undefined }, PORTAL_RECORDS)

/** /parts/portal (§12): the portal, built from public fixtures only — the top, the hero, the map plate, the five
 *  numbered sections and the foot — then a portal with little public content, renumbered, and the slot that stands in
 *  for what is not public. Read against FIXED_NOW. */
export default function Portal() {
  return (
    <div className="pg">
      <p className="pg-lede">The DAO’s website, built only from public records. Editorial: Fraunces, numbered sections, generous space, plain words (“Who holds what”, “What we fund”). It leads with the map. Hats, never the people who wear them. Balances and dates here are fixture values.</p>
      <div className="pg-portal" role="group" aria-label="The portal"><SpecimenHeadings level={2}><PortalPage model={PORTAL_PUBLIC} now={FIXED_NOW} specimen /></SpecimenHeadings></div>
      <Card cap="little public content · the sections close up">
        <ol className="pg-portal-secs" aria-label="Its sections">
          {portalSections(SPARSE).map(s => <li key={s.id}><span className="portal-sec-no">{s.no}</span> <span className="portal-sec-t">{s.name}</span></li>)}
        </ol>
        <ul className="portal-facts" aria-label="Its facts">
          {SPARSE.facts.map(f => <li key={f.label} className="portal-fact"><span className="portal-fact-f">{f.figure}</span> <span className="portal-fact-l">{f.label}</span></li>)}
        </ul>
      </Card>
      <Card cap="not public · in its place">
        <MembersOnly />
      </Card>
    </div>
  )
}
