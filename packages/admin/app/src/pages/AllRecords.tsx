import type { RegistrySummary } from '../api.ts'
import { useRegistries } from '../queries.ts'
import { PageHead } from '../design/PageHead.tsx'
import { ListView } from '../elements/views/ListView.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'

/** A registry's second line: its kind, and a collection's count of entries. No file is named: a private collection
 *  the server lists for an admitted member has none (R-L5-14.5, E-69), and the rest are read at their own page. */
const secondOf = (g: RegistrySummary): string =>
  g.count === null ? g.kind : `${g.kind} · ${g.count} entr${g.count === 1 ? 'y' : 'ies'}`

/** Every registry the viewer may read (§14.1, "All records → a list of collections"), including those without a
 *  section (assets, relationships, knowledge-manifest) and the private collections the server lists for those it
 *  admits: a data row each, opening its list. */
export default function AllRecords() {
  const registries = useRegistries()
  return (
    <>
      <PageHead title="All records" meta={[registries.data ? `${registries.data.length} registries` : null]} />
      <ListView label="Registries" rows={registries.data ?? []} loading={registries.isPending ? 4 : undefined}
        error={registries.error?.message} onRetry={() => void registries.refetch()}
        empty={{ title: 'No registries here.', line: 'Each file in data/ is a registry, and lists here once it is read.' }}
        row={g => <DataRow key={g.name} kind="registry" title={g.name} second={secondOf(g)} href={`/all/${encodeURIComponent(g.name)}`} marks={[]} />} />
    </>
  )
}
