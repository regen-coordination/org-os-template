import { Icon, type IconName } from '../../design/Icon.tsx'
import { Listbox } from './Listbox.tsx'

export type InsertKind = 'view' | 'record' | 'callout' | 'task' | 'table' | 'divider'

/** What `/` inserts, in the gallery's order and words (§10.1). */
const KINDS: { kind: InsertKind; label: string; icon: IconName }[] = [
  { kind: 'view', label: 'A view of a collection', icon: 'table' },
  { kind: 'record', label: 'A record', icon: 'safe' },
  { kind: 'callout', label: 'Callout', icon: 'info' },
  { kind: 'task', label: 'Task', icon: 'check' },
  { kind: 'table', label: 'Table', icon: 'list' },
  { kind: 'divider', label: 'Divider', icon: 'minus' },
]

/** The slash menu (§10.1): a listbox headed "Insert · /" — a view of a collection, a record, a callout, a task, a
 *  table, a divider. The query typed after `/` narrows it to the kinds with a word starting with it. It draws and
 *  picks; inserting is the editor's (L6). */
export function SlashMenu({ query, onPick }: { query: string; onPick(kind: InsertKind): void }) {
  const q = query.trim().replace(/^\//, '').trim().toLowerCase()
  const shown = KINDS.filter(k => q === '' || k.kind.startsWith(q) || k.label.toLowerCase().split(/\s+/).some(w => w.startsWith(q)))
  return (
    <Listbox head="Insert · /" className="ed-slash" empty={`Nothing to insert called “${q}”.`}
      options={shown.map(k => ({ key: k.kind, content: <><Icon name={k.icon} />{k.label}</>, onPick: () => onPick(k.kind) }))} />
  )
}
