import { useResources, useStatus } from '../queries.ts'
import { PageHead } from '../design/PageHead.tsx'
import { Note } from '../design/Note.tsx'
import { SystemsView, useSystems } from '../blocks/systems.tsx'
import { useBlockCtx } from '../blocks/context.ts'
import { Skeleton } from '../design/Skeleton.tsx'

/** Systems (section `/systems`, `g s`): every System — the outside systems, the sources' connectors, the treasury —
 *  as Systems rows under their column head, List · Map, the map the DAO map with the main Safe big (§8.2). A row
 *  opens its record; Space previews it in the inspector. The head carries the from mark (E-47). */
export default function Systems() {
  const ctx = useBlockCtx()
  const { systems, error } = useSystems()
  const resources = useResources()
  const org = useStatus().data?.org
  const readAt = resources.dataUpdatedAt > 0 ? new Date(resources.dataUpdatedAt).toISOString() : null
  return (
    <>
      <PageHead title="Systems" from={org ? { repo: org, readAt } : undefined} now={ctx.now} />
      {error !== undefined ? <Note state="error">{error}</Note>
        : systems === null ? <Skeleton rows={4} shape="row" label="Systems" />
        : <SystemsView systems={systems} now={ctx.now} marks={ctx.marks} />}
    </>
  )
}
