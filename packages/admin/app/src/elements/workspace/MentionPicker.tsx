import { Icon, kindIcon } from '../../design/Icon.tsx'
import { monogram } from '../atoms/Presence.tsx'
import { KIND_OF_REGISTRY } from '../../kinds.ts'
import { Listbox } from './Listbox.tsx'
import type { Mentionable } from './mentions.ts'

/** A record's glyph from its collection (`recordKind`, as the Hub serves it; L4c C3's carry): never from its id. A
 *  collection that backs a kind draws that kind's; another, its name as one record of it ("tasks" → "task"). */
const recordGlyph = (collection: string | undefined) => kindIcon(collection === undefined ? 'record' : KIND_OF_REGISTRY[collection] ?? collection.replace(/s$/, ''))

/** C-21's words for a member who may not see the page (the page editor's picker). */
export const CANNOT_SEE_PAGE = 'can’t see this page'
/** R4c 6: a comment's picker: a member a mention would not tell, for the target's level or (a reply) the talk above it. */
export const CANNOT_READ_TALK = 'can’t read this conversation'

/** The trailing word of an option: a person's hat, a role's count, a record or a page as such; for a member who
 *  may not see the page, that (C-21), in `cannot`'s words. */
function sub(m: Mentionable, cannot: string): string {
  if (!m.canSee) return cannot
  if (m.kind === 'person') return m.hat ?? ''
  if (m.kind === 'role') return m.count === undefined ? 'Role' : `${m.count} ${m.count === 1 ? 'person' : 'people'}`
  return m.kind === 'page' ? 'Page' : 'Record'
}

/** The mention picker (§10.4): a listbox popover under the caret after `@`, headed "Mention". People with their
 *  monogram, name and hat; roles with the hat glyph and how many wear them; records and pages with their glyph. A
 *  member who may not see the page is listed `aria-disabled`, "can’t see this page" (C-21; a comment's picker says
 *  `CANNOT_READ_TALK`, R4c 6), and cannot be picked.
 *  `items` come from `mentionables`, which never offers what the author may not see. */
export function MentionPicker({ items, onPick, cannot = CANNOT_SEE_PAGE }: { items: Mentionable[]; onPick(m: Mentionable): void; cannot?: string }) {
  return (
    <Listbox head="Mention" className="mpop" empty="No one by that name can be mentioned here."
      options={items.map(m => ({
        key: `${m.kind}:${m.id}`,
        disabled: !m.canSee,
        onPick: () => onPick(m),
        content: (
          <>
            {m.kind === 'person' ? <span className="av" aria-hidden="true">{monogram(m.label)}</span>
              : <Icon name={m.kind === 'role' ? 'hat' : m.kind === 'page' ? 'doc' : recordGlyph(m.recordKind)} />}
            <span className="mpop-n">{m.label}</span>
            {sub(m, cannot) && <span className="mpop-sub">{sub(m, cannot)}</span>}
          </>
        ),
      }))} />
  )
}
