import { useQuery } from '@tanstack/react-query'
import { useLocation, useSearch } from 'wouter'
import { api, type Entity } from '../api.ts'
import { useActor } from '../actor.ts'
import { canCreate } from '../editable.ts'
import { useChanges } from '../changes/useChanges.ts'
import { useRegistries } from '../queries.ts'
import { useEditKeys, useEditor } from '../record/useEditor.ts'
import { NewRecordForm } from '../record/NewForm.tsx'
import { SteppedForm } from '../record/SteppedForm.tsx'
import { useNarrow } from '../boards/useNarrow.ts'
import { KIND_OF_REGISTRY, kindLabel } from '../kinds.ts'
import { entryHref, safeDecode } from '../hrefs.ts'
import { routeOfRegistry } from '../sections.ts'
import { Note } from '../design/Note.tsx'
import { RecordHeader } from '../elements/records/RecordHeader.tsx'
import { Refusal } from '../parts/SyncParts.tsx'
import { Skeleton } from '../design/Skeleton.tsx'
import { useCanWrite } from '../viewAs/ViewAs.tsx'

const NONE: Entity[] = []

/** *New* on a list (§14.1): the record header "New <kind>" with its from mark, then the new-record form (spec 2026-11-04
 *  §3): Option A (the schema's groups on one page, the preview, who decides, Save to changes), or Option B, the same
 *  groups one a step, on a narrow screen and wherever the address asks for it (`?steps=1`: the setup
 *  checklist). Either way saving stages a create into the tray (spec §6.4), and the keys and notes are the same. */
export default function NewRecord({ registry: raw }: { registry: string }) {
  const registry = safeDecode(raw)
  const { actor, known, error: actorError } = useActor()
  const canWrite = useCanWrite() // New is a write: never while previewing as someone else, typed address or not (C-23)
  const changes = useChanges()
  const [, navigate] = useLocation()
  const narrow = useNarrow()
  const stepped = narrow || new URLSearchParams(useSearch()).get('steps') === '1'
  const schema = useQuery({ queryKey: ['schema', registry], queryFn: () => api.schema(registry) })
  // The registry's entries: the ids a new one may not take, the fields they use, the words their statuses use. A file
  // not made yet holds none (its read is refused, and the form draws without them).
  const file = useQuery({ queryKey: ['registry', registry], queryFn: () => api.registry(registry), retry: false })
  const registries = useRegistries()
  const summary = registries.data?.find(g => g.name === registry)
  const ed = useEditor({ registry, entityId: '', latest: null, creating: true, stage: changes.stage })
  const back = () => navigate(routeOfRegistry(registry))
  const save = async () => { const id = await ed.save(); if (id) navigate(entryHref(registry, id)) }
  const offered = canWrite && canCreate(registry, summary?.kind, known) && schema.data !== undefined
  useEditKeys(ed, { canStart: false, onSave: () => { if (offered) void save() }, onCancel: back })
  const kind = KIND_OF_REGISTRY[registry]
  const title = `New ${kind ? kindLabel(kind) : `${registry} entry`}`
  const path = `data/${registry}.yaml`
  const head = () => <RecordHeader variant="record" kind={kind ?? registry} id="new" title={title} meta={[]} from={{ file: path }} />
  // While anything is still being read the head is drawn as it will be, without its actions, over field-row skeletons (§6.2).
  if (actor === null && actorError === null) return <>{head()}<Skeleton rows={5} shape="row-1" label={title} /></>
  if (!known || !canWrite) return <>{head()}<Note state="unavailable">Editing is off: the notice above says why.</Note></>
  const failed = registries.error ?? schema.error
  if (failed) return <>{head()}<Refusal>{failed.message}</Refusal></>
  if (!registries.data || !schema.data || file.isPending) return <>{head()}<Skeleton rows={5} shape="row-1" label={title} /></>
  if (summary && summary.kind !== 'collection') return <>{head()}<Note state="unavailable">{path} is a document, so it has no entries to add.</Note></>
  // The one predicate (C11): New is offered where a section adds records, and a typed address is held to it too.
  if (!offered) return <>{head()}<Note state="unavailable">New is not offered for {path}: no section adds to it.</Note></>
  return (
    <>
      {head()}
      {stepped
        ? <SteppedForm registry={registry} schema={schema.data} entries={file.data?.entries ?? NONE} ed={ed} title={title} onSave={() => void save()} onCancel={back} />
        : <NewRecordForm registry={registry} schema={schema.data} entries={file.data?.entries ?? NONE} ed={ed} onSave={() => void save()} onCancel={back} />}
    </>
  )
}
