import type { Resource, ResourceDetail } from '../api.ts'
import { kindLabel } from '../kinds.ts'
import { recordHref } from '../hrefs.ts'
import { Section } from '../design/Section.tsx'
import { Note } from '../design/Note.tsx'
import { DataList } from '../elements/rows/DataList.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { useViewer } from '../viewAs/ViewAs.tsx'

/** A System's glyph is its driver's kind (a Safe, a hat); any other record's is its own. */
const glyphOf = (r: Resource) => (r.kind === 'system' && typeof r.facts.kind === 'string' ? r.facts.kind : r.kind)

/** The record's links as data rows (§14.2 `record/Links`): each the other record — its kind tile and name, the link's
 *  kind (lead, works-on, funds…) and the record's kind on the second line — opening that record. Grouped by the link's
 *  kind, in the order the edges come; an edge between two others has no end here and is left out. A record the viewer
 *  may not see is not drawn or counted (§6.3); one that is not here is named, with nothing to open. */
export function Links({ detail }: { detail: ResourceDetail }) {
  const { resource: r, edges, neighbours } = detail
  const { visible } = useViewer()
  const byId = new Map(neighbours.map(n => [n.id, n]))
  const groups = new Map<string, Resource[]>()
  for (const e of edges) {
    const other = byId.get(e.from === r.id ? e.to : e.from)
    if (!other || (e.from !== r.id && e.to !== r.id)) continue
    groups.set(e.kind, [...(groups.get(e.kind) ?? []), other])
  }
  const links = [...groups].flatMap(([kind, list]) => visible(list).map(n => ({ kind, n })))
  return (
    <Section label="Links" count={links.length > 0 ? links.length : undefined}>
      {links.length === 0 ? <Note state="empty">No links.</Note> : (
        <DataList label="Links">
          {links.map(({ kind, n }) => (
            <DataRow key={`${kind}:${n.id}`} kind={glyphOf(n)} title={n.name} second={`${kind} · ${kindLabel(n.kind)}`} marks={[]}
              href={n.kind === 'absent' ? undefined : recordHref(n.id)} />
          ))}
        </DataList>
      )}
    </Section>
  )
}
