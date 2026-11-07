import { useQuery } from '@tanstack/react-query'
import { Link } from 'wouter'
import { stringify } from 'yaml'
import { api, ApiError, type Entity } from '../api.ts'
import { hasId, idCounts, positionKey } from '../record/addressing.ts'
import { Mark } from '../design/Mark.tsx'
import { useActor } from '../actor.ts'
import { canCreate } from '../editable.ts'
import { entryHref } from '../hrefs.ts'
import { PageHead } from '../design/PageHead.tsx'
import { Section } from '../design/Section.tsx'
import { Note, NoteBlock } from '../design/Note.tsx'
import { ButtonLink } from '../design/Button.tsx'
import { TableView, type Column } from '../elements/views/TableView.tsx'
import { useCanWrite } from '../viewAs/ViewAs.tsx'
import { READ_ONLY_HERE, editorOf } from '../editors.ts'
import { Skeleton } from '../design/Skeleton.tsx'
import type { SectionDef } from '../sections.ts'
import { SectionPlate, brokenFileOf } from '../blocks/plate.tsx'
import { newRecordHref } from '../hrefs.ts'

type Row = { e: Entity; i: number }
const scalar = (v: unknown): string =>
  v == null ? '' : Array.isArray(v) ? v.map(x => (typeof x === 'object' ? '{…}' : String(x))).join(', ') : typeof v === 'object' ? '{…}' : String(v)

/** A registry the server does not have, or will not show this viewer: a private collection is answered to anyone it
 *  does not admit exactly as one that is not there (R-L5-14.5, E-69), so the page says the same of both. */
function UnknownRegistry({ registry }: { registry: string }) {
  return <NoteBlock heading title={`No registry called “${registry}” here.`} line="All records lists every registry you may read."
    action={<Link href="/all">All records</Link>} />
}

/** A registry read straight from its file (§14.1, "RegistryList → table view"): entries of a collection in a table
 *  view, or a document's YAML in a Mono well under the sentence that it has no path in the Hub yet (F-L3-3, the
 *  editors table). For registries without a section (spec §5, All records) and for Meetings. */
export default function RegistryList({ registry, title, empty, section, bare = false }:
  { registry: string; title: string; empty?: string; section?: SectionDef; bare?: boolean }) {
  const reg = useQuery({ queryKey: ['registry', registry], queryFn: () => api.registry(registry) })
  const schema = useQuery({ queryKey: ['schema', registry], queryFn: () => api.schema(registry) })
  const { known } = useActor()
  const canWrite = useCanWrite()
  const file = `data/${registry}.yaml`
  const failed = reg.error ?? schema.error
  if (reg.error instanceof ApiError && reg.error.status === 404 && !bare) return <UnknownRegistry registry={registry} />
  // a file the server could not read, as its plate when this list stands for a section (walk R-6)
  const broken = failed && section?.words ? brokenFileOf(failed.message) : null
  if (broken && section?.words) return <SectionPlate def={{ ...section, words: section.words }} level={bare ? 2 : 3} broken={broken} />
  if (failed) return <>{!bare && <PageHead title={title} meta={[file]} />}<Note state="error">{failed.message}</Note></>
  if (!reg.data || !schema.data) return <>{!bare && <PageHead title={title} meta={[file]} />}<Skeleton rows={4} shape="row" label={title} /></>
  if (reg.data.kind === 'document') {
    return (
      <>
        {!bare && <PageHead title={title} meta={[file, 'document', 'read-only']} />}
        {editorOf({ registry })?.path === 'none-yet' && <Note state="notYet">{READ_ONLY_HERE}</Note>}
        <Section label="Source" note={file}><pre className="mono-well" aria-label={file}>{stringify(reg.data.document ?? {})}</pre></Section>
      </>
    )
  }
  const entries = reg.data.entries ?? []
  const counts = idCounts(entries)
  const rows = entries.map((e, i) => ({ e, i }))
  const keys = (schema.data['x-order'] ?? ['id']).slice(0, 5)
  // An entry with no id lists as #<position>, and one whose id is shared says so: both are read-only
  // (contract, "Entries the platform can't address").
  const idCell = ({ e, i }: Row) => {
    if (!hasId(e)) return <Link href={entryHref(registry, positionKey(i))} title={`no id: entry ${i + 1} in ${file}`}>{positionKey(i)}</Link>
    const n = counts.get(String(e.id)) ?? 1
    return <><Link href={entryHref(registry, String(e.id))}>{String(e.id)}</Link>{n > 1 && <> <Mark level="alert">appears {n} times</Mark></>}</>
  }
  const columns: Column<Row>[] = keys.map(k => ({
    key: k, label: k, mono: k !== 'id' && k !== 'title' && k !== 'name', sort: (r: Row) => scalar(r.e[k]),
    cell: (r: Row) => (k === 'id' ? idCell(r) : scalar(r.e[k])),
  }))
  return (
    <>
      {!bare && (
        <PageHead title={title} meta={[String(entries.length), file]}>
          {/* New is a write: not drawn while previewing (C-23) */}
          {canWrite && canCreate(registry, reg.data.kind, known) && <ButtonLink href={newRecordHref(registry)}>New</ButtonLink>}
        </PageHead>
      )}
      {rows.length === 0 && section?.words
        ? <SectionPlate def={{ ...section, words: section.words }} level={bare ? 2 : 3} />
        : <TableView label={title} rows={rows} rowKey={r => `${r.i}`} columns={columns} empty={{ title: empty ?? `No entries in ${file} yet.` }} />}
    </>
  )
}
