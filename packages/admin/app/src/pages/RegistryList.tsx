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
import { editorOf } from '../editors.ts'
import { filesHref } from '../workspace/files.ts' // DAO-OS L6 Task 19: the source editor
import { Skeleton } from '../design/Skeleton.tsx'
import type { SectionDef } from '../sections.ts'
import { SectionPlate, brokenFileOf } from '../blocks/plate.tsx'
import { newRecordHref } from '../hrefs.ts'
import { labelOf } from '../record/form.ts'

type Row = { e: Entity; i: number }
const scalar = (v: unknown): string =>
  v == null ? '' : Array.isArray(v) ? v.map(x => (typeof x === 'object' ? '{…}' : String(x))).join(', ') : typeof v === 'object' ? '{…}' : String(v)

/** What a collection the store keeps says where a file would be named (walk M15). */
export const STORE_KEPT = 'kept in the private store'

/** The link from a document's page to the source editor (L6 Task 19). */
export const EDIT_SOURCE = 'Edit in the source editor'

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
  // Where it is read from (walk M15): the server names a file that is not data/<name>.yaml (a custom collection's), and
  // null for a collection the store keeps; until it has answered, no file is named.
  const file: string | null = reg.data ? (reg.data.file !== undefined ? reg.data.file : `data/${registry}.yaml`) : null
  const where = file ?? (reg.data ? STORE_KEPT : null)
  const head = where === null ? [] : [where]
  const failed = reg.error ?? schema.error
  if (reg.error instanceof ApiError && reg.error.status === 404 && !bare) return <UnknownRegistry registry={registry} />
  // a file the server could not read, as its plate when this list stands for a section (walk R-6)
  const broken = failed && section?.words ? brokenFileOf(failed.message) : null
  if (broken && section?.words) return <SectionPlate def={{ ...section, words: section.words }} level={bare ? 2 : 3} broken={broken} />
  if (failed) return <>{!bare && <PageHead title={title} meta={head} />}<Note state="error">{failed.message}</Note></>
  if (!reg.data || !schema.data) return <>{!bare && <PageHead title={title} meta={head} />}<Skeleton rows={4} shape="row" label={title} /></>
  const docFile = file ?? `data/${registry}.yaml`
  if (reg.data.kind === 'document') {
    return (
      <>
        {/* DAO-OS L6 Task 19: a document is edited whole in the source editor (F-L3-3); Edit is a write, so not drawn while
            previewing (C-23) */}
        {!bare && (
          <PageHead title={title} meta={[docFile, 'document']}>
            {canWrite && editorOf({ registry })?.path === 'source' && <ButtonLink href={filesHref(docFile)}>{EDIT_SOURCE}</ButtonLink>}
          </PageHead>
        )}
        <Section label="Source" note={docFile}><pre className="mono-well" aria-label={docFile}>{stringify(reg.data.document ?? {})}</pre></Section>
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
    if (!hasId(e)) return <Link href={entryHref(registry, positionKey(i))} title={`no id: entry ${i + 1}${file ? ` in ${file}` : ''}`}>{positionKey(i)}</Link>
    const n = counts.get(String(e.id)) ?? 1
    return <><Link href={entryHref(registry, String(e.id))}>{String(e.id)}</Link>{n > 1 && <> <Mark level="alert">appears {n} times</Mark></>}</>
  }
  const columns: Column<Row>[] = keys.map(k => ({
    key: k, label: labelOf(schema.data, k), mono: k !== 'id' && k !== 'title' && k !== 'name', sort: (r: Row) => scalar(r.e[k]),
    cell: (r: Row) => (k === 'id' ? idCell(r) : scalar(r.e[k])),
  }))
  return (
    <>
      {!bare && (
        <PageHead title={title} meta={[String(entries.length), ...head]}>
          {/* New is a write: not drawn while previewing (C-23) */}
          {canWrite && canCreate(registry, reg.data.kind, known) && <ButtonLink href={newRecordHref(registry)}>New</ButtonLink>}
        </PageHead>
      )}
      {rows.length === 0 && section?.words
        ? <SectionPlate def={{ ...section, words: section.words }} level={bare ? 2 : 3} />
        : <TableView label={title} rows={rows} rowKey={r => `${r.i}`} columns={columns} empty={{ title: empty ?? (file ? `No entries in ${file} yet.` : 'No entries yet.') }} />}
    </>
  )
}
