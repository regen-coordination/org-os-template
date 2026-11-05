import { Icon, kindIcon } from '../../design/Icon.tsx'
import { monogram } from '../atoms/Presence.tsx'
import { Listbox } from './Listbox.tsx'
import type { Mentionable } from './mentions.ts'

/** The trailing word of an option: a person's hat, a role's count, a record or a page as such; for a member who
 *  may not see the page, that (C-21). */
function sub(m: Mentionable): string {
  if (!m.canSee) return 'can’t see this page'
  if (m.kind === 'person') return m.hat ?? ''
  if (m.kind === 'role') return m.count === undefined ? 'Role' : `${m.count} ${m.count === 1 ? 'person' : 'people'}`
  return m.kind === 'page' ? 'Page' : 'Record'
}

/** The mention picker (§10.4): a listbox popover under the caret after `@`, headed "Mention". People with their
 *  monogram, name and hat; roles with the hat glyph and how many wear them; records and pages with their glyph. A
 *  member who may not see the page is listed `aria-disabled`, "can’t see this page" (C-21), and cannot be picked.
 *  `items` come from `mentionables`, which never offers what the author may not see. */
export function MentionPicker({ items, onPick }: { items: Mentionable[]; onPick(m: Mentionable): void }) {
  return (
    <Listbox head="Mention" className="mpop" empty="No one by that name can be mentioned here."
      options={items.map(m => ({
        key: `${m.kind}:${m.id}`,
        disabled: !m.canSee,
        onPick: () => onPick(m),
        content: (
          <>
            {m.kind === 'person' ? <span className="av" aria-hidden="true">{monogram(m.id)}</span>
              : <Icon name={m.kind === 'role' ? 'hat' : m.kind === 'page' ? 'doc' : kindIcon(m.id.split(':')[0] ?? 'record')} />}
            <span className="mpop-n">{m.label}</span>
            {sub(m) && <span className="mpop-sub">{sub(m)}</span>}
          </>
        ),
      }))} />
  )
}
