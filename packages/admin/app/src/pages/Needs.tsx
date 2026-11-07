import { useResources, useStatus } from '../queries.ts'
import { PageHead } from '../design/PageHead.tsx'
import { NeedsList } from '../elements/needs/NeedsList.tsx'
import { systemsLine, systemsRead, useNeeds } from '../blocks/needs.tsx'
import { useNow } from '../time.ts'

/** Needs you (§9.4, section `/needs`, `g n`): every item that waits on this member, overdue first, live from the
 *  same items the sidebar counts and the map lights (E-34). The head carries the from mark: the instance, and when its
 *  records were read (E-47). */
export default function Needs() {
  const now = useNow(false)
  const needs = useNeeds(now)
  const resources = useResources()
  const org = useStatus().data?.org
  const readAt = resources.dataUpdatedAt > 0 ? new Date(resources.dataUpdatedAt).toISOString() : null
  return (
    <>
      <PageHead title="Needs you" from={org ? { repo: org, readAt } : undefined} now={now} />
      <NeedsList items={needs.items} error={needs.error} onRetry={needs.retry} systemsLine={systemsLine(systemsRead(needs.systems), now)} now={now} />
    </>
  )
}
