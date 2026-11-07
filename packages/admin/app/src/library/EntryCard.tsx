import { useId } from 'react'
import { Link } from 'wouter'
import type { ListedEntry, Shelf } from '../api.ts'
import { StatusMark, type Mark } from '../design/StatusMark.tsx'

/** A shelf value: the server's, and the two L7 adds (`template`, `wizard`; E-A1) before its type learns them. */
export type ShelfName = Shelf | 'template' | 'wizard'

/** The shelf as a person reads it: one entry's kind (the card's eyebrow, §11.1), and the shelf's own name. */
export const SHELF_KIND: Partial<Record<ShelfName, string>> = {
  template: 'DAO template', system: 'System kind', rules: 'Rule set', board: 'Board', wizard: 'Wizard',
}
export const SHELF_NAME: Partial<Record<ShelfName, string>> = {
  template: 'DAO templates', system: 'Systems', rules: 'Rules', board: 'Boards', wizard: 'Wizards',
}
const capital = (s: string): string => `${s[0]!.toUpperCase()}${s.slice(1)}`
export const shelfKind = (s: ShelfName): string => SHELF_KIND[s] ?? capital(s)
export const shelfName = (s: ShelfName): string => SHELF_NAME[s] ?? `${capital(s)}s`

/** A library entry's address: its id has a colon (or a slash), so it is encoded. */
export const entryHref = (id: string): string => `/library/${encodeURIComponent(id)}`
/** A version as it is written: a number takes its v; a word ("built in") is said as it is. */
export const versionText = (v: string): string => (/^\d/.test(v) ? `v${v}` : v)

/** Where an entry stands for this org (§11.1): built in, added (a receipt still installed), needing what the org
 *  lacks, or not added. One mark, its shape and its word. */
export function entryState(e: ListedEntry): { mark: Mark; word: string } {
  if (e.builtin) return { mark: 'closed', word: 'Built in' }
  if (e.added.length > 0) return { mark: 'done', word: 'Added' }
  if (e.fits && !e.fits.met) return { mark: 'needs', word: `Needs ${e.fits.missing.join(', ')}` }
  return { mark: 'open', word: 'Not added' }
}

/** One entry on the shelf (§11.1): a raised card that is a link to its preview — the kind as its eyebrow, the title,
 *  the summary clamped to two lines (the preview has it whole), and the foot: the shelf it comes from, its version in
 *  Mono, and where it stands. Raw is said aloud: an untried entry looks untried. The open one (`selected`) wears the
 *  moss outline and ring, and is the current item. The article is the card's name in a list of cards; the link is
 *  the title, stretched over the card, and described by the rest. `href` sends the card elsewhere than its preview: Boards' built-ins
 *  open the board itself (§14.1). */
export function EntryCard({ entry, selected = false, href }: { entry: ListedEntry; selected?: boolean; href?: string }) {
  const id = useId()
  const state = entryState(entry)
  const builtin = entry.builtin || !/^\d/.test(entry.version)
  return (
    <article aria-label={entry.title} className="lib-item">
      {/* The card is drawn whole and the link is its title, stretched over it (::after): a link's visible words are its
          name (2.5.3), and the rest describes it. */}
      <div className={selected ? 'lib-card sel' : 'lib-card'}>
        <span className="lib-card-k" id={`${id}-k`}>{shelfKind(entry.shelf as ShelfName)}</span>
        <Link href={href ?? entryHref(entry.id)} className="lib-card-t lib-card-a" id={`${id}-t`} data-entry={entry.id}
          aria-current={selected ? 'true' : undefined} aria-describedby={`${id}-k ${id}-d ${id}-f`}>{entry.title}</Link>
        <span className="lib-card-d" id={`${id}-d`}>{entry.summary}</span>
        <span className="lib-card-f" id={`${id}-f`}>
          <span className="lib-card-src">{entry.source}</span>
          {!builtin && <span className="mono">{versionText(entry.version)}</span>}
          {entry.maturity === 'raw' && <span>raw</span>}
          <StatusMark mark={state.mark} label={state.word} />
        </span>
      </div>
    </article>
  )
}
