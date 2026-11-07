import { useRef, useState, type FormEvent } from 'react'
import { Button, ButtonLink } from '../../design/Button.tsx'
import { Icon, type IconName } from '../../design/Icon.tsx'
import { Menu, type MenuEntry } from '../../design/Menu.tsx'
import { Tabs } from '../../design/Tabs.tsx'
import { useCanWrite } from '../../viewAs/ViewAs.tsx'
import { FromMark, type From } from '../atoms/FromMark.tsx'
import { OP_WORD, fieldWord, filterText, type Filter, type ViewKind } from './filters.ts'

/** Each view's glyph; a saved view (any other id) has none. */
const VIEW_ICON: Record<ViewKind, IconName> = { table: 'table', board: 'board', calendar: 'calendar', list: 'list', map: 'map' }
const iconOf = (id: string): IconName | undefined => (Object.hasOwn(VIEW_ICON, id) ? VIEW_ICON[id as ViewKind] : undefined)

const OPS = Object.keys(OP_WORD) as Filter['op'][]

export interface ViewHeaderProps {
  /** The five views (Table, Board, Calendar, List, Map), then any saved views, which follow as tabs without a glyph. */
  views: { id: ViewKind | string; label: string }[]
  value: string
  onView: (v: string) => void
  filters: Filter[]
  onFilters: (f: Filter[]) => void
  sort?: { field: string; dir: 'asc' | 'desc' }
  onSort?: (s: { field: string; dir: 'asc' | 'desc' }) => void
  /** The one primary ("New task"), not drawn while previewing. */
  primary?: { label: string; href?: string; onClick?: () => void }
  /** What the collection is called: names the view tabs ("Views of Tasks"). */
  label?: string
  /** The fields a filter or the sort may name, with the words the chips say; without them there is no + Filter and
   *  no sort. */
  fields?: readonly { id: string; label: string }[]
  /** Where the collection was read from (E-2), in the meta line under the bar. */
  from?: From
  now?: Date
}

/** The form "+ Filter" opens: a field, how it compares, a value. Add puts the chip on; Esc or Cancel leaves it. */
function FilterForm({ fields, onAdd, onDone }: { fields: readonly { id: string; label: string }[]; onAdd(f: Filter): void; onDone(): void }) {
  const [field, setField] = useState(fields[0]?.id ?? '')
  // contains first: a fragment typed and Enter finds rows, as 0.6's quick find did
  const [op, setOp] = useState<Filter['op']>('contains')
  const [value, setValue] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value.trim() === '' || field === '') return
    onAdd({ field, op, value: value.trim() })
    onDone()
  }
  return (
    <form className="vfilter" aria-label="New filter" onSubmit={submit}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone() } }}>
      <label className="vfilter-f"><span className="vfilter-l">Field</span>
        <select className="input" value={field} onChange={e => setField(e.target.value)}>
          {fields.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </label>
      <label className="vfilter-f"><span className="vfilter-l">Condition</span>
        <select className="input" value={op} onChange={e => setOp(e.target.value as Filter['op'])}>
          {OPS.map(o => <option key={o} value={o}>{OP_WORD[o]}</option>)}
        </select>
      </label>
      <label className="vfilter-f vfilter-v"><span className="vfilter-l">Value</span>
        {/* autoFocus: the form opens on a press of + Filter, and the value is what is typed next */}
        <input className="input" value={value} autoFocus onChange={e => setValue(e.target.value)} />
      </label>
      <div className="vfilter-acts">
        <Button small type="submit">Add filter</Button>
        <Button small variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}

/** One header for every view of a collection (spec §10.2): the view tabs (Table, Board, Calendar, List, Map — glyph
 *  and label — then saved views; none for a collection seen one way only); the filter chips ("Status is not done ×", on --wash) and "+ Filter" (dashed); the
 *  sort; and the one primary. While previewing, the primary is not drawn (C-23). The from mark (E-2) sits in the
 *  meta line under the bar. A view never changes records. */
export function ViewHeader(p: ViewHeaderProps) {
  const canWrite = useCanWrite()
  const [adding, setAdding] = useState(false)
  const add = useRef<HTMLButtonElement>(null)
  const fields = p.fields ?? []
  const labelOf = (field: string) => fields.find(f => f.id === field)?.label
  const remove = (i: number) => p.onFilters(p.filters.filter((_, j) => j !== i))
  const done = () => { setAdding(false); add.current?.focus() }
  const sortItems: MenuEntry[] = p.sort && p.onSort ? [
    { type: 'header', label: 'Sort by' },
    ...fields.map((f): MenuEntry => ({ type: 'radio', label: f.label, checked: p.sort!.field === f.id, onSelect: () => p.onSort!({ field: f.id, dir: p.sort!.dir }) })),
    { type: 'separator' },
    { type: 'radio', label: 'Ascending', checked: p.sort.dir === 'asc', onSelect: () => p.onSort!({ field: p.sort!.field, dir: 'asc' }) },
    { type: 'radio', label: 'Descending', checked: p.sort.dir === 'desc', onSelect: () => p.onSort!({ field: p.sort!.field, dir: 'desc' }) },
  ] : []
  const primary = canWrite && p.primary
  return (
    <div className="vhead">
      <div className="vbar">
        {p.views.length > 1 && (
          <Tabs label={p.label ? `Views of ${p.label}` : 'Views'} value={p.value} onChange={p.onView}
            tabs={p.views.map(v => ({ id: v.id, label: v.label, icon: iconOf(v.id) }))} />
        )}
        <div className="vbar-end">
          {p.filters.map((f, i) => {
            const name = labelOf(f.field) ?? fieldWord(f.field)
            const text = filterText(f, name)
            return (
              <span className="fchip" key={`${f.field}-${f.op}-${f.value}-${i}`}>
                <span className="fchip-t"><span className="fchip-k">{name}</span> {OP_WORD[f.op]} {f.value}</span>
                <button type="button" className="fchip-x" aria-label={`Remove filter: ${text}`} onClick={() => remove(i)}><Icon name="x" size="xs" /></button>
              </span>
            )
          })}
          {fields.length > 0 && (
            <button ref={add} type="button" className="fchip fchip-add" aria-expanded={adding} onClick={() => setAdding(a => !a)}>
              <Icon name="plus" size="xs" />Filter
            </button>
          )}
          {sortItems.length > 0 && <Menu label="Sort" icon="sort" items={sortItems} />}
          {primary && (primary.href !== undefined
            ? <ButtonLink primary small href={primary.href}>{primary.label}</ButtonLink>
            : <Button primary small onClick={() => primary.onClick?.()}>{primary.label}</Button>)}
        </div>
      </div>
      {adding && <FilterForm fields={fields} onAdd={f => p.onFilters([...p.filters, f])} onDone={done} />}
      {p.from && <div className="vhead-meta"><FromMark from={p.from} now={p.now ?? new Date()} /></div>}
    </div>
  )
}
