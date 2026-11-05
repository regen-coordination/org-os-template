import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useSearch } from 'wouter'
import { stringify } from 'yaml'
import type { Resource } from '../api.ts'
import { useActor } from '../actor.ts'
import { useCanEdit } from '../editable.ts'
import { useChanges } from '../changes/useChanges.ts'
import { useRecord } from '../record/useRecord.ts'
import { refusalErrors, useEditKeys, useEditor } from '../record/useEditor.ts'
import { entryName, staleOf, stagedView } from '../record/fields.ts'
import { useEntryOfResources } from '../blocks/entries.ts'
import { shownName } from '../record/restricted.ts'
import { FieldsEdit, FieldsRead, StaleCard } from '../record/SchemaFields.tsx'
import SourceEdit from '../record/SourceEdit.tsx'
import { DriverView } from '../systems/DriverView.tsx'
import { Links } from '../record/Links.tsx'
import { MiniMap } from '../record/MiniMap.tsx'
import Operations from '../record/Operations.tsx'
import { RecordVisibility, useProposedLevel } from '../record/RecordVisibility.tsx'
import { useVisibilityView } from '../session/houseSource.ts'
import OpButtons from '../record/OpButtons.tsx'
import { factText, kindLabel } from '../kinds.ts'
import { ageText } from '../time.ts'
import { Section } from '../design/Section.tsx'
import { Button } from '../design/Button.tsx'
import { Note } from '../design/Note.tsx'
import type { Mark } from '../design/StatusMark.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { Menu, type MenuEntry } from '../design/Menu.tsx'
import { RecordHeader, kindWord } from '../elements/records/RecordHeader.tsx'
import { systemFacts } from '../elements/rows/systemState.ts'
import { ListView } from '../elements/views/ListView.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { Refusal } from '../parts/SyncParts.tsx'
import { useCanWrite, useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import NotFound from './NotFound.tsx'
import { PageLoading } from '../frame/PageLoading.tsx'

const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

/** A line in clay with the alert glyph (§6.2 error): what holds the record read-only, what needs a person, what holds
 *  Save off. Said once through the polite region, as every error note is (C11 I-1); an act's refusal is a `Refusal`. */
function Warn({ children }: { children: ReactNode }) {
  return <Note state="error">{children}</Note>
}

/** Facts an adapter gives a resource that has no registry entry: read-only field rows, their source named. */
function StateFacts({ resource }: { resource: Resource }) {
  const facts = Object.entries(resource.facts).filter(([k, v]) => k !== 'driver' && !empty(v))
  if (facts.length === 0) return null
  return (
    <Section label="State" note={`from ${resource.source?.path ?? 'its adapter'}`}>
      <FieldTable label="State">
        {facts.map(([k, v]) => <FieldRow key={k} label={k}><span className="wrap">{factText(v)}</span></FieldRow>)}
      </FieldTable>
    </Section>
  )
}

/** The record's history as a list of events (§14.1): its last change, by whom and when. The full trail of changes
 *  arrives with Activity. */
function History({ resource, now }: { resource: Resource | null; now: Date }) {
  const changed = resource?.changed ? [resource.changed] : []
  return (
    <Section label="History">
      <ListView label="History" rows={changed} empty={{ title: 'No commit names this record yet.', line: 'The full trail of changes to a record arrives with Activity.' }}
        row={c => (
          <DataRow key={`${c.at}:${c.by}`} kind="history" title={`Last changed by ${c.by}`} marks={[]}
            trailing={<time className="age" dateTime={c.at} title={c.at}>{ageText(c.at, now)}</time>} />
        )} />
    </Section>
  )
}

/** A refused delete, in the server's words: the referrers it names (C-5), a 403's reason, or the sentence as written (C7). */
const refusal = (err: unknown, record: string): string => refusalErrors(err, record).map(e => e.message).join(' ')

/** A record page (spec §6.3, §6.4; L4 §14.1). It starts fresh for each record: an open editor or confirm dialog
 *  belongs to one record and must not follow the address to another. */
export default function RecordPage({ kind, id }: { kind: string; id: string }) {
  return <RecordBody key={`${kind}:${id}`} kind={kind} id={id} />
}

/** The record page, in the house (§14.1): the record header — a System's, or a record's with its id, state, title,
 *  kind and from mark (Q70) and its one primary — then its field rows (read, edit in place, staged, stale,
 *  restricted), a System's reads, its links as data rows, its operations, its history as events; the small map beside
 *  them as Touches. A record the viewer may not see is not here at all (E-62). */
function RecordBody({ kind, id }: { kind: string; id: string }) {
  const m = useRecord(kind, id)
  const { actor, error: actorError } = useActor()
  const changes = useChanges()
  const canWrite = useCanWrite()
  const { sees } = useViewer()
  const source = useVisibilitySource()
  const visibilityView = useVisibilityView() // L5 §9.7: who may change this record's visibility
  // the level in flight, beside the header's marker for a viewer who may not change it (L5 §11.4)
  const proposedLevel = useProposedLevel(m.changeKey, m.entry, m.staged)
  const [path, navigate] = useLocation()
  const search = useSearch()
  const [yaml, setYaml] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const r = m.detail?.resource ?? null
  // The small map names the record and each neighbour from their file entries, as the inspector does: the gate's
  // `restricted` marker lives there, so a name the viewer is not admitted to reads "<hat> only" and never its value.
  const mapEntries = useEntryOfResources(r === null ? [] : [r, ...(m.detail?.neighbours ?? [])])
  const view = stagedView(m.entry, m.staged)
  // The one predicate (C11, C17), shared with the inspector: read-only for an unknown actor, a source
  // that allows no changes, a document, a record staged for deletion, or an entry the platform can't
  // address (no id, or an id another entry shares: contract), which can never be staged against.
  // Previewing, nothing is written (C-23): no Edit, no e, no ?edit=1.
  const editable = useCanEdit({ resource: r, registry: m.registry, id: m.entityId })
  const writable = editable && canWrite
  const ed = useEditor({ registry: m.registry, entityId: m.entityId, latest: view.value, creating: false, stage: changes.stage })
  // Saving needs the record still writable: an entry that became unaddressable while open is never staged against.
  const save = () => { if (writable) void ed.save() }
  useEditKeys(ed, { canStart: writable && !m.loading, onSave: save, onCancel: ed.cancel })
  // Save and Cancel go with the form: when editing ends with focus on neither (it fell to the page), it goes to the Edit
  // that stands where they stood (2.4.3; C11's keyboard walk)
  const editButton = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(ed.editing)
  useEffect(() => {
    if (wasEditing.current && !ed.editing && (document.activeElement === null || document.activeElement === document.body)) editButton.current?.focus()
    wasEditing.current = ed.editing
  }, [ed.editing])

  // ?edit=1 (the inspector's and ⌘K's Edit) opens the editor once who you are is known, then leaves the address.
  const wantsEdit = new URLSearchParams(search).get('edit') === '1'
  const actorSettled = actor !== null || actorError !== null
  useEffect(() => {
    if (!wantsEdit || m.loading || !actorSettled) return
    if (writable && !ed.editing) ed.start()
    const params = new URLSearchParams(search)
    params.delete('edit')
    const rest = params.toString()
    navigate(rest ? `${path}?${rest}` : path, { replace: true })
  }, [wantsEdit, m.loading, actorSettled, writable])

  // Who you are decides the head's buttons, so the page waits for it too: no Edit appearing late. So do the entries
  // the small map's names come from: a restricted name is never drawn raw while they arrive.
  // The first frame is the head as far as the address knows it (the record's id) and field-row skeletons (§6.2).
  if (m.loading || !actorSettled || mapEntries.pending) return <PageLoading shape="row-1" rows={6} />
  // What the viewer may not see is absent (§6.3): the not-found page, never its header or a count (E-62).
  const item = r ?? m.entry ?? view.value
  if (item !== null && !sees(item)) return <NotFound />
  const now = new Date()
  const word = kindWord(kindLabel(kind))
  if (m.error) {
    return (
      <>
        <RecordHeader variant="record" kind={kind} id={id} title={id} meta={[word]} now={now} />
        <Warn>{m.error}</Warn>
      </>
    )
  }
  // The record's name as the viewer may read it (D-12, E-70): the heading and a System's from mark read "<hat> only"
  // when the gate marks the name restricted, never its value.
  const title = shownName({ name: r?.name ?? entryName(view.value) ?? id }, { restricted: m.restricted }, source)
  const file = r?.source?.path ?? (m.registry ? `data/${m.registry}.yaml` : null)
  const names = new Map((m.detail?.neighbours ?? []).map(n => [n.id, n.name]))
  const stale = staleOf(m.entry, m.staged)
  const del = async () => {
    setPageError(null)
    if (!writable || !m.changeKey) return
    try { await changes.stage([{ op: 'delete', record: m.changeKey }]) } catch (err) { setPageError(refusal(err, m.changeKey)) }
  }
  // Leaving source keeps the last entry that parsed; text that did not parse is dropped with its problem.
  // In source no field row shows: what holds Save off is said above the source instead (I3).
  const hiddenNotes = [
    ...Object.entries(ed.problems).filter(([k]) => k !== 'source').map(([k, p]) => `${k}: ${p}`),
    ...ed.errors.map(e => (e.field ? `${e.field}: ${e.message}` : e.message)),
  ]
  const toggleSource = () => { if (yaml) ed.problem('source', null); setYaml(s => !s) }

  // The header's actions: while editing, Save is the one primary; reading, Edit is, and the rest are secondary. A
  // preview ends the edit's drawing (C-23: hidden, never disabled): the read rows and only Cancel, which writes nothing.
  const sourceButton = <Button key="source" pressed={yaml} onClick={toggleSource}>source</Button>
  const primary = ed.editing
    ? canWrite ? <Button primary disabled={!ed.canSave || !writable} onClick={save}>Save to changes</Button> : undefined
    : writable ? <Button primary ref={editButton} onClick={ed.start}>Edit</Button> : undefined
  const secondary: ReactNode[] = ed.editing
    ? [...(canWrite ? [sourceButton] : []), <Button key="cancel" onClick={ed.cancel}>Cancel</Button>]
    : [...(view.value && m.registry ? [sourceButton] : []), ...(r ? [<OpButtons key="ops" resource={r} />] : [])]
  const more: MenuEntry[] = !ed.editing && writable && m.changeKey ? [{ type: 'item', label: 'Delete', onSelect: () => void del() }] : []

  // L5 (§9.7, §11.4, Q77): the record's visibility control among the header's actions, for a member who may write its
  // collection; the header's marker then gives way to it, so the level is drawn once. Anyone else reads the header's
  // marker, with the level in flight beside it.
  const visibilityControl = !ed.editing && canWrite && view.value !== null && m.registry !== null && m.changeKey !== null
    && (visibilityView?.writable.includes(m.registry) ?? false)
  if (visibilityControl && view.value && m.registry) {
    secondary.unshift(<RecordVisibility key="visibility" registry={m.registry} id={m.entityId} entry={view.value}
      staged={m.staged} stage={changes.stage} onError={setPageError} />)
  }

  const state: { mark: Mark; word: string } | null = view.created ? { mark: 'staged', word: 'Staged, new' }
    : view.deleted ? { mark: 'staged', word: 'Staged to delete' }
    // a staged field the trunk has since changed is said in clay, as its field row and the tray say it (walk 2026-11-04)
    : m.staged.length > 0 && Object.keys(stale).length > 0 ? { mark: 'stale', word: 'Changed since staged' }
    : m.staged.length > 0 ? { mark: 'staged', word: 'Staged' }
    : r?.attention ? { mark: 'needs', word: r.attention.text } : null

  // the header's marker, for a viewer the control is not drawn for (a System and a record alike: review I-1)
  const marker = item !== null && !visibilityControl
    ? { visibility: source.visibilityOf(item), visibilityProposed: proposedLevel } : {}
  const sys = r?.kind === 'system' ? systemFacts(r) : null
  const head = sys && r
    ? (
      <>
        <RecordHeader variant="system" kind={sys.kind} name={title} chain={sys.chains} address={sys.address && 'chip' in sys.address ? sys.address.chip : undefined}
          governs={sys.governs ?? undefined} read={sys.read} now={now} open={sys.open ?? undefined} from={{ system: title, read: sys.read }} {...marker} />
        {canWrite && (primary !== undefined || secondary.length > 0) && (
          <div className="rh-acts rp-acts">{primary}{secondary}{more.length > 0 && <Menu label="More actions" items={more} />}</div>
        )}
      </>
    )
    : (
      <RecordHeader variant="record" kind={r?.kind ?? kind} id={id} title={title}
        state={state?.mark} stateWord={state?.word} {...marker}
        meta={[word]} from={file ? { file, readAt: m.readAt } : undefined} now={now} primary={primary} secondary={secondary} more={more} />
    )

  return (
    <>
      {head}
      {/* A preview begun mid-edit draws no header actions (the head hides every write while previewing); Cancel writes
          nothing, so it stands here, alone, until the edit is put down (R7's page twin). */}
      {ed.editing && !canWrite && <div className="rh-acts rp-acts"><Button onClick={ed.cancel}>Cancel</Button></div>}
      <div className="rp">
        <div className="rp-main">
          {m.problem && <Warn>{m.problem}</Warn>}
          {/* the attention is the header's state mark, unless a staged state took the mark's place */}
          {r?.attention && !sys && state?.mark !== 'needs' && <Warn>{r.attention.text}</Warn>}
          {view.created && <Note state="notYet">Staged as a new record: it is not in {file} until the change is applied.</Note>}
          {view.deleted && <Note state="notYet">Staged for deletion: it leaves {file} when the change is applied.</Note>}
          {ed.editing && ed.heldProto && (
            <Warn>This entry holds a field named __proto__ in its file. The app does not store a field of that name, so saving this entry removes it.</Warn>
          )}
          {ed.gone && <Refusal>This entry is no longer in the file: it was removed while you were editing it.</Refusal>}
          {ed.stale && view.value && <StaleCard schema={m.schema} differing={ed.differing} draft={ed.draft} latest={view.value} onKeep={ed.keepMine} onTake={ed.takeTheirs} />}
          {pageError && <Refusal>{pageError}</Refusal>}
          {ed.editing && yaml && hiddenNotes.map((t, i) => <Warn key={i}>{t}</Warn>)}
          {ed.editing && canWrite && m.registry && m.schema
            ? (yaml
              ? <SourceEdit key={ed.epoch} draft={ed.draft} problem={ed.problems.source} onValue={ed.replaceDraft} onProblem={p => ed.problem('source', p)} />
              : <FieldsEdit key={ed.epoch} registry={m.registry} schema={m.schema} draft={ed.draft} file={m.entry} creating={false}
                  errors={ed.errors} problems={ed.problems} onChange={ed.set} onProblem={ed.problem} restricted={m.restricted} />)
            : view.value && m.registry && m.schema && (yaml
              ? <Section label="Source" note={file ?? undefined}><pre className="mono-well" aria-label="YAML">{stringify(view.value)}</pre></Section>
              : <FieldsRead registry={m.registry} schema={m.schema} value={view.value} was={view.was} names={names} restricted={m.restricted} stale={stale} />)}
          {r && !m.registry && <StateFacts resource={r} />}
          {sys && r && <DriverView resource={r} now={now} />}
          {m.detail && <Links detail={m.detail} />}
          {r && <Operations resource={r} />}
          <History resource={r} now={now} />
        </div>
        {m.detail && r && (
          <div className="rp-aside">
            <Section label="Touches">
              <MiniMap centre={r} neighbours={m.detail.neighbours} entryOf={mapEntries.entryOf} />
            </Section>
          </div>
        )}
      </div>
    </>
  )
}
