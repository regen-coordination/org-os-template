import type { KeyboardEvent, ReactNode } from 'react'
import { Link } from 'wouter'
import { KindTile } from '../../design/KindTile.tsx'
import { StatusMark, type Mark } from '../../design/StatusMark.tsx'
import { useViewer } from '../../viewAs/ViewAs.tsx'
import { Presence } from '../atoms/Presence.tsx'

/** Marks that are the row's treatment, not a glyph at its end: running takes the trailing facts' place, selected is
 *  the `selected` prop's, faint dims the row. */
const TREATMENT: ReadonlySet<Mark> = new Set<Mark>(['running', 'selected', 'faint'])

export interface DataRowProps {
  kind: string
  title: string
  /** The second line: kind, chips, facts (13 mute). */
  second?: ReactNode
  /** The trailing facts, at the row's end (a read age, a date). */
  trailing?: ReactNode
  /** The row's states (§6.1): each mark is drawn at the end, after the trailing facts, except running (the reading
   *  ring and "Reading…" in place of the trailing facts), faint (the row dimmed) and selected (see `selected`). Needs
   *  also turns the tile clay; closed also dims the row. */
  marks: Mark[]
  /** Where the row opens: the row is then one link. */
  href?: string
  /** The value a staged change replaces, struck in the second line (Mono faint). */
  was?: string
  /** The tile's tone; left out, clay when the row needs someone. */
  tone?: 'plain' | 'attn'
  /** Selected: the moss bar, and `aria-current` (valid on a link or a plain row, as `aria-selected` is not). */
  selected?: boolean
  /** Space on the row previews it in the inspector. */
  onPreview?(): void
  /** What the row stands for: a row the viewer may not see is not drawn (§6.3), no placeholder, no gap. */
  item?: unknown
  /** A layout of the row's own (the Systems row: `sysrow`). */
  className?: string
  /** Who else has this page open: the row ends in a 20px presence stack (§7.12). The caller passes only people who
   *  may see it. */
  presence?: { handle: string; role: string; editing?: boolean }[]
  /** Drawn in the kind tile's place: a picture of what the row stands for (a board's layout, Boards). Decoration. */
  lead?: ReactNode
  /** An action of the row's own (Copy to yours), beside the row and never inside its link: a control in a link is
   *  no control. */
  action?: ReactNode
}

/** The house's list row (§9.2): 56px at least, a hairline between rows inside a DataList's raised surface. The kind
 *  tile (28) · the main (the title 14/500, the second line 13 mute) · the trailing facts and the marks. A list item
 *  of its own, so a row not drawn leaves no gap; `data-row` for the list's roving keys. */
export function DataRow({ kind, title, second, trailing, marks, href, was, tone, selected = false, onPreview, item, className, presence, lead, action }: DataRowProps) {
  const { sees } = useViewer()
  if (item !== undefined && !sees(item)) return null
  const running = marks.includes('running')
  const dim = marks.includes('closed') || marks.includes('faint')
  const tile = tone ?? (marks.includes('needs') ? 'attn' : 'plain')
  const cls = ['drow', className, selected && 'drow-sel', dim && 'o-dim'].filter(Boolean).join(' ')
  const onKeyDown = onPreview
    ? (e: KeyboardEvent<HTMLElement>) => { if (e.key === ' ' && e.target === e.currentTarget && !e.defaultPrevented) { e.preventDefault(); onPreview() } }
    : undefined
  const body = (
    <>
      {lead ?? <KindTile kind={kind} tone={tile} />}
      <span className="drow-main">
        <span className="drow-t">{title}</span>
        {(second !== undefined || was !== undefined) && (
          <span className="drow-s">
            {was !== undefined && <span className="was"><span className="sr-only">was </span><s>{was}</s></span>}
            {second}
          </span>
        )}
      </span>
      <span className="drow-end">
        {running ? <StatusMark mark="running" label="Reading…" /> : trailing}
        {marks.filter(m => !TREATMENT.has(m)).map(m => <StatusMark key={m} mark={m} />)}
        {presence !== undefined && presence.length > 0 && <Presence people={presence} small />}
      </span>
    </>
  )
  const common = { className: cls, 'data-row': '', 'aria-current': selected ? ('true' as const) : undefined, onKeyDown }
  const row = href !== undefined ? <Link href={href} {...common}>{body}</Link> : <div {...common}>{body}</div>
  if (action === undefined || action === null || action === false) return <li className="drow-li">{row}</li>
  return <li className="drow-li drow-li-act">{row}<span className="drow-act">{action}</span></li>
}
