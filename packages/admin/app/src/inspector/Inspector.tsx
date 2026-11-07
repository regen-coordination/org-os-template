import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type OperationInfo, type Resource } from '../api.ts'
import { useInspector, type InspectAt } from './InspectorContext.tsx'
import { useCanWrite, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { useCanEdit } from '../editable.ts'
import { useEntryOfResources, type EntryOf } from '../blocks/entries.ts'
import { FACT_COLUMNS } from '../kinds.ts'
import { opHref, recordHref } from '../hrefs.ts'
import { ago } from '../time.ts'
import { Mark } from '../design/Mark.tsx'
import { Button, ButtonLink } from '../design/Button.tsx'
import { Empty } from '../design/Empty.tsx'
import { Note } from '../design/Note.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { KindTile } from '../design/KindTile.tsx'
import { useFrame } from '../design/Shell.tsx'
import { kindWord } from '../elements/records/RecordHeader.tsx'
import { MiniMap } from '../record/MiniMap.tsx'
import { restrictedHat, restrictedOf, shownName } from '../record/restricted.ts'
import { RestrictedValue } from '../viewAs/VisibilityMarker.tsx'
import { closeDialog, usePanel } from '../parts/panels.tsx'
import { ReadAge } from '../elements/atoms/ReadAge.tsx'
import { readStateOf } from '../elements/atoms/FromMark.tsx'
import { AddressChip } from '../elements/atoms/AddressChip.tsx'
import { ChainChip } from '../elements/atoms/ChainChip.tsx'
import { StatusMark } from '../design/StatusMark.tsx'
import { systemFacts, systemState, type SystemFacts } from '../elements/rows/systemState.ts'

/** The inspector's three forms (§5.10), by the frame's own width: beside the list or the map at 1200 and over; an
 *  overlay sheet from the end over a scrim at 760–1199; a bottom sheet on the phone. Under 1200 it is modal. */
export type InspectorForm = 'aside' | 'side' | 'bottom'
export function inspectorForm(width: number): InspectorForm {
  return width >= 1200 ? 'aside' : width >= 760 ? 'side' : 'bottom'
}

/** The inspector's frame. The aside (`complementary`, its rule the column's height, its content one sticky inner
 *  column) is the inspector in every form; under 1200 it sits in a modal `<dialog>`, the right slot's: the slot shuts
 *  the dialog before it hands focus back to the row (A11 I-1, A13 I-2), so Esc and the close × return focus the
 *  same way beside the list and over it. A tap on the scrim closes it. `inline` draws a sheet open in place, not
 *  modal and in no slot: a /parts specimen. */
function InspectorFrame({ form, inline, label, titleId, onClose, children }: {
  form: InspectorForm; inline: boolean; label: string; titleId?: string; onClose(): void; children: ReactNode
}) {
  const aside = <aside className="insp" aria-label={label}><div className="insp-in">{children}</div></aside>
  if (form === 'aside') return aside
  return <InspectorSheet form={form} inline={inline} label={label} titleId={titleId} onClose={onClose}>{aside}</InspectorSheet>
}

function InspectorSheet({ form, inline, label, titleId, onClose, children }: {
  form: Exclude<InspectorForm, 'aside'>; inline: boolean; label: string; titleId?: string; onClose(): void; children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const right = usePanel('right')
  useEffect(() => {
    const d = ref.current
    if (!d || inline) return
    if (!d.open) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '') }
    // The context opened the slot; the sheet gives it the shut, keeping the opener (the row) it was opened from.
    if (right.openId === 'inspector') right.open('inspector', null, () => closeDialog(ref.current))
  }, [inline])
  // Focus goes in once there is something to hold it: the record's head, when it has been read.
  useEffect(() => { if (!inline && titleId) ref.current?.querySelector<HTMLElement>('button, a[href]')?.focus() }, [inline, titleId])
  return (
    <>
      {inline && <div className="insp-scrim" aria-hidden="true" />}
      <dialog ref={ref} className={`insp-sheet insp-${form}${inline ? ' insp-sheet-inline' : ''}`} open={inline || undefined}
        aria-labelledby={titleId} aria-label={titleId ? undefined : label}
        onCancel={e => { e.preventDefault(); onClose() }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        {children}
      </dialog>
    </>
  )
}

/** A System's kind is its driver's (a Safe, a hat); any other record's is its own. */
const kindOf = (r: Resource) => (r.kind === 'system' && typeof r.facts.kind === 'string' ? r.facts.kind : r.kind)

/** What a System's governing fact is called in its row: a Safe's signers, a tree's hats, a community's members. */
const GOVERNS: Record<string, string> = { safe: 'Signers', 'hats-tree': 'Hats', 'gardens-community': 'Members' }

/** A System's field rows (E-63, the gallery's inspector): what its driver read, as `systemFacts` gives it — its
 *  chains, its address (a chip; a Hats tree's Mono id; a space's host), the governing fact, its one state, and the
 *  read's age against `now`. */
function SystemRows({ r, f, now }: { r: Resource; f: SystemFacts; now: Date }) {
  const state = systemState(r)
  const a = f.address
  return (
    <>
      {f.chains.length > 0 && <FieldRow label="Chain"><ChainChip chains={f.chains} agree={f.agree} /></FieldRow>}
      {a && <FieldRow label="Address">
        {'chip' in a ? <AddressChip value={a.chip} chain={f.chains.length === 1 ? f.chains[0] : undefined} /> : <span className="mono">{'mono' in a ? a.mono : a.host}</span>}
      </FieldRow>}
      {f.governs && <FieldRow label={GOVERNS[f.kind] ?? 'Governs'}>{f.governs}</FieldRow>}
      <FieldRow label="State"><StatusMark mark={state.mark} label={state.words} /></FieldRow>
      {f.read && <FieldRow label="Read"><ReadAge state={readStateOf(f.read)} readAt={f.read.readAt} lastGood={f.read.ok ? undefined : f.read.readAt} now={now} /></FieldRow>}
    </>
  )
}

function InspectorContent({ resource: r, neighbours, ops, onClose, editable, entry, entryOf, now, titleId, at = {} }: {
  resource: Resource; neighbours: Resource[]; ops: OperationInfo[]; onClose(): void; editable: boolean
  entry?: Record<string, unknown>; entryOf?: EntryOf; now: Date; titleId: string; at?: InspectAt
}) {
  const canWrite = useCanWrite()
  const visibility = useVisibilitySource()
  const kind = kindOf(r)
  // A System's rows are what its driver read (E-63), the read's age told against `now` (§7.9); any other kind's are its columns.
  const sys = r.kind === 'system' ? systemFacts(r) : null
  // The gate's marker (R-L5-14.5): a name, a status or a column the viewer is not admitted to never prints its value
  // (rule 3, E-70) — it reads "<hat> only", as every restricted field does, and the name is not in the heading's title.
  const kept = restrictedOf(entry)
  const hat = (level: string | undefined) => (level === undefined ? undefined : restrictedHat(level, visibility))
  const nameKept = hat(kept.name)
  const statusKept = hat(kept.status)
  const facts = sys ? [] : (FACT_COLUMNS[r.kind] ?? []).map(c => ({ column: c, value: c.value(r, entry), hat: hat(c.field === undefined ? undefined : kept[c.field]) }))
    .filter(({ column: _c, value, hat: h }) => h !== undefined || value !== '')
  const isRecord = r.kind !== 'absent'
  // the small map reads the same entries: the record's own, and each neighbour's
  const mapEntryOf = (x: Resource) => (x.id === r.id ? entry : entryOf?.(x))
  return (
    <>
      <div className="insp-h">
        <KindTile kind={kind} />
        <div className="insp-hm">
          <div className="insp-k">{kindWord(kind)}</div>
          <h3 id={titleId} className="insp-t" title={nameKept === undefined ? r.name : undefined}>
            {nameKept === undefined ? r.name : <RestrictedValue hat={nameKept} />}
          </h3>
        </div>
        <Button iconOnly icon="x" variant="ghost" label="Close" onClick={onClose}>Close</Button>
      </div>
      <div className="insp-b">
        {/* opened at a need (E-46): the need comes first, in the record's own words */}
        {at.need !== undefined && <p className="insp-need" role="note"><Mark level="alert">{at.need}</Mark></p>}
        {isRecord && <MiniMap centre={r} neighbours={neighbours} size="inspector" entryOf={mapEntryOf} />}
        <FieldTable label={`${shownName(r, entry, visibility)} fields`}>
          {r.status && r.kind !== 'system' && <FieldRow label="status" restricted={statusKept === undefined ? undefined : { hat: statusKept }}>{r.status}</FieldRow>}
          {r.kind === 'absent' && typeof r.facts.why === 'string' && <FieldRow label="why">{r.facts.why}</FieldRow>}
          {r.attention && !sys && <FieldRow label="needs"><Mark level={r.attention.level}>{r.attention.text}</Mark></FieldRow>}
          {facts.map(({ column, value, hat: h }) => <FieldRow key={column.label} label={column.label} restricted={h === undefined ? undefined : { hat: h }}>{value}</FieldRow>)}
          {sys && <SystemRows r={r} f={sys} now={now} />}
          {r.changed && <FieldRow label="changed">{r.changed.by} · {ago(r.changed.at, now)}</FieldRow>}
          {r.source && <FieldRow label="file"><span className="mono">{r.source.path}</span></FieldRow>}
        </FieldTable>
        {isRecord && (
          <div className="insp-acts">
            {/* Edit, the operations and Move are writes: none is drawn while previewing (C-23) */}
            {canWrite && editable && <ButtonLink primary href={`${recordHref(r.id)}?edit=1`}>Edit</ButtonLink>}
            {canWrite && ops.filter(o => o.unavailable === null).map(o => <ButtonLink key={`${o.id}:${o.label}`} href={opHref(r.id, o)}>{o.label}</ButtonLink>)}
            {canWrite && at.move && <Button onClick={() => { const move = at.move!; onClose(); move() }}>Move on the map</Button>}
            <ButtonLink href={recordHref(r.id)}>Open record →</ButtonLink>
            {/* a System's own link-out, as on its header (E-63); a record gets none: the outside system it names is never linked */}
            {sys?.open && <ButtonLink href={sys.open.href} variant="ghost" external>{sys.open.label}</ButtonLink>}
          </div>
        )}
      </div>
    </>
  )
}

/** The inspector as drawn (§5.10), from what it is given — /parts draws it from fixtures, and `Inspector` from the
 *  record's reads. Head: kind tile, the kind as an eyebrow, the name, a close ×. Body: the small map (§8.6), the field
 *  rows (a System's from what its driver read, E-63), the actions (Edit for who may, the operations that can run, Open
 *  record, and a System's own link-out). It shows facts as text and never links the outside system a record names
 *  (`facts.url`). `form` defaults to the frame's (`inspectorForm`). */
export function InspectorView({ resource, neighbours, ops, onClose, form, inline = false, editable = false, entry, now }: {
  resource: Resource; neighbours: Resource[]; ops: OperationInfo[]; onClose(): void; form?: InspectorForm; inline?: boolean
  editable?: boolean; entry?: Record<string, unknown>; now?: Date
}) {
  const { width } = useFrame()
  const visibility = useVisibilitySource()
  const titleId = useId()
  return (
    <InspectorFrame form={form ?? inspectorForm(width)} inline={inline} label={`${shownName(resource, entry, visibility)} inspector`} titleId={titleId} onClose={onClose}>
      <InspectorContent resource={resource} neighbours={neighbours} ops={ops} onClose={onClose} editable={editable} entry={entry}
        now={now ?? new Date()} titleId={titleId} />
    </InspectorFrame>
  )
}

/** The inspector over lists and maps: the record's reads, drawn as `InspectorView` draws them. It sits in the right
 *  panel slot, whose Escape closes it. */
export default function Inspector() {
  const { id, at, close } = useInspector()
  if (!id) return null
  return <InspectorBody key={id} id={id} at={at} onClose={close} />
}

function InspectorBody({ id, at, onClose }: { id: string; at: InspectAt; onClose: () => void }) {
  const { width } = useFrame()
  const titleId = useId()
  const visibility = useVisibilitySource()
  const detail = useQuery({ queryKey: ['resource', id], queryFn: () => api.resource(id) })
  const ops = useQuery({ queryKey: ['operations', id], queryFn: () => api.operations(id), enabled: !id.startsWith('absent:') })
  // the entry of the record's own kind and id — every kind, not only a System's: the gate's marker lives there
  const entries = useEntryOfResources(detail.data ? [detail.data.resource, ...detail.data.neighbours] : [])
  const editable = useCanEdit({ resource: detail.data?.resource ?? null })
  const r = detail.data?.resource
  const shown = r === undefined || entries.pending ? undefined : shownName(r, entries.entryOf(r), visibility)
  // One frame, loading and loaded, so a sheet is opened once.
  return (
    <InspectorFrame form={inspectorForm(width)} inline={false} label={shown === undefined ? 'Inspector' : `${shown} inspector`} titleId={r && shown !== undefined ? titleId : undefined} onClose={onClose}>
      {!r
        ? detail.error ? <Note state="error">{detail.error.message}</Note> : <Empty>Loading…</Empty>
        : entries.pending
          ? <Empty>Loading…</Empty>
          : <InspectorContent resource={r} neighbours={detail.data!.neighbours} ops={ops.data ?? []} onClose={onClose} editable={editable}
              entry={entries.entryOf(r)} entryOf={entries.entryOf} now={new Date()} titleId={titleId} at={at} />}
    </InspectorFrame>
  )
}
