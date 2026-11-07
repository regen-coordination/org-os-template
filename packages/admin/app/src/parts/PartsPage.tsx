import { useMemo } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { Link } from 'wouter'
import { PageHead } from '../design/PageHead.tsx'
import NotFound from '../pages/NotFound.tsx'
import { FIXED_NOW, partsClient } from '../test/fixtures/parts.ts'
import { NotDrawn, PARTS_GROUPS } from './groups/index.ts'

/** Every value on /parts is a fixture, the clock included (spec §17): the head says so on every page. */
const FIXTURES = ['Fixture values', `now ${FIXED_NOW.toISOString().slice(0, 16)}Z`]

/** /parts: the element gallery in the app, by section (ruling L4-R1). It reads nothing from the
 *  instance; each group draws from fixtures. */
export default function PartsPage() {
  return (
    <>
      <PageHead title="Parts" meta={FIXTURES} />
      <p className="parts-lede">Every element in every state, drawn from fixtures: names are roles, addresses are generated, balances and dates are made up.</p>
      <nav aria-label="Part groups">
        <ol className="parts-index">
          {PARTS_GROUPS.map(g => (
            <li key={g.id}>
              <Link href={`/parts/${g.id}`}>{g.label}</Link>
              {g.Component === NotDrawn && <span className="parts-index-note"> · not drawn yet</span>}
            </li>
          ))}
        </ol>
      </nav>
    </>
  )
}

/** /parts/:group: one group, under its own title, inside a query client that holds every answer. Its page is the
 *  approved gallery's width (ruling R-12): `pg-page` takes main's whole width on a wide frame, up to --w-parts. */
export function PartsGroupPage({ id }: { id: string }) {
  const qc = useMemo(() => partsClient(), [])
  const group = PARTS_GROUPS.find(g => g.id === id)
  if (!group) return <NotFound />
  return (
    <QueryClientProvider client={qc}>
      <div className="pg-page">
        <PageHead title={group.label} meta={FIXTURES} />
        <group.Component />
      </div>
    </QueryClientProvider>
  )
}
