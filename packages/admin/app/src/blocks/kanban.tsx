// packages/admin/app/src/blocks/kanban.tsx
import type { ChangeView, Resource, StageOp } from '../api.ts'
import type { Mark } from '../machines.ts'
import { useResources, useSystemsRead } from '../queries.ts'
import { CARD_FIELDS, FACT_COLUMNS, cardFacts, kindLabel } from '../kinds.ts'
import { changeKeyOf, recordHref } from '../hrefs.ts'
import { refusalErrors } from '../record/useEditor.ts'
import { marksOf } from '../parts/marks.ts'
import { BoardCard, BoardView } from '../elements/views/BoardView.tsx'
import { defineBlock } from './registry.ts'
import { fieldOf, runQuery, systemsWait } from './query.ts'
import { useEntryOf } from './entries.ts'
import { restrictedHat, restrictedOf } from '../record/restricted.ts'
import { useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { RestrictedValue } from '../viewAs/VisibilityMarker.tsx'
import type { BlockCtx, RecordSource } from './types.ts'
import { useRecordNames } from '../record/refNames.ts'

/** The overflow bucket's key: reserved, so a column the config names "other" keeps its own cards. */
export const OTHER = '@@other'
const labelOf = (column: string) => (column === OTHER ? 'other' : column)
type KanbanCfg = { title?: string; source: RecordSource; view: { group: string; columns: string[] } }

/** Cards by column, in the columns' order. A value no column holds goes in a trailing "other" column,
 *  which shows only when it holds something (Review Focus 3: no card disappears). */
export function groupCards(rows: Resource[], group: string, columns: string[], valueOf: (r: Resource) => unknown): Map<string, Resource[]> {
  const out = new Map<string, Resource[]>(columns.map(c => [c, []]))
  const other: Resource[] = []
  for (const r of rows) {
    const v = valueOf(r)
    const at = v === null || v === undefined ? undefined : out.get(String(v))
    if (at) at.push(r); else other.push(r)
  }
  if (other.length > 0) out.set(OTHER, other)
  return out
}

/** A move is the group field set on the record (spec §4.3). A record with no id cannot be addressed (C-6). */
export function moveOps(card: Resource, group: string, column: string): StageOp[] {
  const record = changeKeyOf(card)
  return record ? [{ op: 'update', record, set: { [group]: column } }] : []
}

/** The group field as your change will leave it, when the change touches it. */
export function stagedValue(card: Resource, group: string, change: ChangeView | null): unknown {
  const key = changeKeyOf(card)
  const op = key ? change?.ops.find(o => o.record === key) : undefined
  if (!op) return undefined
  if (op.op === 'update' && Object.hasOwn(op.set, group)) return op.set[group]
  if ((op.op === 'create' || op.op === 'replace') && Object.hasOwn(op.value, group)) return op.value[group]
  return undefined
}

const oneKind = (s: RecordSource | undefined): string | undefined => (typeof s?.kind === 'string' && s.kind !== '*' ? s.kind : undefined)

function useKanbanData(cfg: KanbanCfg) {
  const resources = useResources()
  const systemsRead = useSystemsRead()
  // Always the kind's entries: its cards show them, and its column may be any field of the file.
  const kind = oneKind(cfg.source)
  const { entryOf, pending } = useEntryOf(kind ? [kind] : [])
  if (resources.error) return { state: 'error' as const, error: resources.error.message }
  // a section that sorts systems by their data/systems.yaml entry waits for it, and says its failed read (I-2)
  const waiting = systemsWait(cfg.source, systemsRead)
  if (waiting?.state === 'error') return { state: 'error' as const, error: waiting.error }
  if (resources.isPending || pending || waiting) return { state: 'loading' as const }
  const rows = runQuery(cfg.source, resources.data, systemsRead.entries, entryOf)
  // The empty sentence is the view's (P4b's frame reads view.empty; ruling R-8).
  if (rows.length === 0) return { state: 'empty' as const, count: 0 }
  return { state: 'ready' as const, count: rows.length, data: { rows, entryOf } }
}

/** Why a card cannot be moved: a record with no id in its file cannot be addressed (C-6). */
const NO_ID = 'This record has no id in its file, so it cannot be moved here.'
const titleOf = (c: KanbanCfg) => c.title ?? `${kindLabel(oneKind(c.source) ?? 'record')} by ${c.view?.group ?? 'field'}`

/** The block as a board view (§10.2): a column per configured value and the trailing "other" (locked: nothing is
 *  moved into it), cards with their tile facts and marks, a staged move from your change. A move stages the group
 *  field (`moveOps`); a refusal is the server's sentence. */
function KanbanBody({ cfg, data, ctx }: { cfg: KanbanCfg; data: unknown; ctx: BlockCtx }) {
  const { rows, entryOf } = data as { rows: Resource[]; entryOf: (r: Resource) => Record<string, unknown> | undefined }
  const { group, columns } = cfg.view
  // A name the viewer is not admitted to never prints its value (rule 3, E-70): the card, and the Move to… menu that is
  // named by it, read "<hat> only" — the hat named by the house's visibility source.
  const visibility = useVisibilitySource()
  const { fieldText } = useRecordNames()
  const keptName = (r: Resource): string | undefined => {
    const level = restrictedOf(entryOf(r)).name
    return level === undefined ? undefined : restrictedHat(level, visibility)
  }
  // A group field the viewer is not admitted to is never read by where its card stands (D-12, rule 3, E-70): the card
  // goes to the locked "other" column, whatever its value, and is not moved — a move would set a field they cannot read.
  const keptGroup = (r: Resource): string | undefined => {
    const level = restrictedOf(entryOf(r))[group]
    return level === undefined ? undefined : restrictedHat(level, visibility)
  }
  const valueOf = (r: Resource) => (keptGroup(r) !== undefined ? null
    : stagedValue(r, group, ctx.marks.change) ?? fieldOf(r, group) ?? entryOf(r)?.[group] ?? null)
  const grouped = groupCards(rows, group, columns, valueOf)
  const columnOf = new Map<string, string>()
  for (const [column, cards] of grouped) for (const card of cards) columnOf.set(card.id, column)

  const onMove = async (card: Resource, column: string): Promise<true | string> => {
    const ops = moveOps(card, group, column)
    if (ops.length === 0) return NO_ID
    try {
      await ctx.stage(ops)
      return true
    } catch (err) {
      return refusalErrors(err, ops[0]!.record).map(e => e.message).join(' ')
    }
  }
  const card = (r: Resource) => {
    const entry = entryOf(r)
    // A fact the viewer is not admitted to never prints its value either (rule 3, E-70): the tile's facts come from the
    // same file entry the title does, so a restricted `role` (a person), `lead` (a project) or `author` reads "<hat>
    // only", as its cell in the table does.
    const cols = FACT_COLUMNS[r.kind] ?? []
    const facts = cardFacts(r, CARD_FIELDS[r.kind]?.tile ?? [], entry).map(f => {
      const field = cols.find(c => c.label === f.label)?.field
      const level = field === undefined ? undefined : restrictedOf(entry)[field]
      // a reference field names the records it holds, as the record page does (walk 2026-11-04)
      return level === undefined ? (field === undefined ? f.value : fieldText(r.kind, field, String(f.value))) : <RestrictedValue hat={restrictedHat(level, visibility)} />
    }).filter(v => v !== '')
    // A staged move has its own bar and words; a change to another field of the record is still said
    const moved = stagedValue(r, group, ctx.marks.change) !== undefined
    const marks = marksOf(r, ctx.marks).filter(m => SAID.has(m) || (m === 'staged' && !moved))
    const kept = keptName(r)
    return <BoardCard title={kept === undefined ? r.name : <RestrictedValue hat={kept} />} href={r.kind === 'absent' ? undefined : recordHref(r.id)} facts={facts} marks={marks} />
  }

  return (
    <BoardView label={titleOf(cfg)} columns={[...grouped.keys()].map(c => ({ id: c, name: labelOf(c), locked: c === OTHER || undefined }))}
      cards={rows} cardKey={r => r.id} cardName={r => keptName(r) === undefined ? r.name : `${keptName(r)} only`} columnOf={r => columnOf.get(r.id) ?? OTHER} card={card}
      staged={r => keptGroup(r) === undefined && stagedValue(r, group, ctx.marks.change) !== undefined} fixed={r => { const kept = keptGroup(r); return kept !== undefined ? `Its ${group} is ${kept} only, so it cannot be moved here.` : changeKeyOf(r) ? undefined : NO_ID }} onMove={onMove} />
  )
}

/** The marks a card says beside its facts (and "staged" when the change is not its move). */
const SAID: ReadonlySet<Mark> = new Set<Mark>(['needs', 'stale', 'draft', 'failed'])

export const kanbanBlock = defineBlock<KanbanCfg>({
  type: 'kanban',
  label: 'Kanban',
  config: [
    { key: 'source.kind', label: 'kind', input: 'kind' },
    { key: 'view.group', label: 'columns are', input: 'text' },
    { key: 'view.columns', label: 'columns', input: 'fields' },
    { key: 'source.where', label: 'where', input: 'yaml' },
  ],
  title: titleOf,
  useData: cfg => useKanbanData(cfg),
  Body: KanbanBody,
  actions: { move: moveOps as never },
})
