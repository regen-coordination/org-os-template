import { useRegistries, useResources, useStatus, useSystemEntries } from '../queries.ts'
import { useWorkspaceCollections } from '../Nav.tsx'
import { sectionRows, type SectionDef } from '../sections.ts'
import { useViewer } from '../viewAs/ViewAs.tsx'
import { PageHead } from '../design/PageHead.tsx'
import { NoteBlock } from '../design/Note.tsx'
import { DataList } from '../elements/rows/DataList.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { useNow } from '../time.ts'
import { Skeleton } from '../design/Skeleton.tsx'

/** Who has a page open, by its address: the workspace lane (L6) fills it; until then a fixture may (§7.12). */
export type PresenceOf = (href: string) => { handle: string; role: string; editing?: boolean }[]

/** Workspace (section `/workspace`, `g w`): the collections the viewer may see a record of, in the sidebar's order,
 *  each a data row that opens its collection, ending in who else has it open (a 20px presence stack). The head
 *  carries the from mark: the instance and its read age (E-47). Each row says its count of what the viewer may see
 *  (E-74): the records drawn for them, or a registry-only collection's entries (meetings: members-only, like the file). */
export default function Workspace({ presenceOf }: { presenceOf?: PresenceOf }) {
  const now = useNow(false)
  const { collections } = useWorkspaceCollections()
  const resources = useResources()
  const org = useStatus().data?.org
  const regs = useRegistries()
  const registries = regs.data ?? []
  // no absence is said before the reads that would fill the list have answered (walk 2026-11-04)
  const pending = resources.isPending || regs.isPending
  const systems = useSystemEntries()
  const { visible } = useViewer()
  const countOf = (def: SectionDef): number => def.registry
    ? registries.find(g => g.name === def.registry)?.count ?? 0
    : visible(sectionRows(def, resources.data ?? [], systems)).length
  const readAt = resources.dataUpdatedAt > 0 ? new Date(resources.dataUpdatedAt).toISOString() : null
  return (
    <>
      <PageHead title="Workspace" from={org ? { repo: org, readAt } : undefined} now={now} />
      {pending ? <Skeleton rows={4} shape="row" label="Collections" />
        : collections.length === 0
        ? <NoteBlock title="Nothing in the Workspace yet." line="Its collections appear here once they hold a record you may see." />
        : (
          <DataList label="Collections">
            {collections.map(c => {
              const n = countOf(c.def)
              return <DataRow key={c.id} kind="page" title={c.label} second={`${n} record${n === 1 ? '' : 's'}`} href={c.href} marks={[]} presence={presenceOf?.(c.href)} />
            })}
          </DataList>
        )}
    </>
  )
}
