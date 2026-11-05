import { Link } from 'wouter'
import { Icon, kindIcon } from '../../design/Icon.tsx'

/** What a mention of something the reader may not see reads instead of its title (§7.11, §6.3). */
const RESTRICTED = { 'members-only': 'Members only', 'not-visible': 'Not visible to you' } as const

/** The link form of the shared interface, or the restricted form, which carries no text and nothing to follow.
 *  Each refuses the other's props, so a mention given both does not type-check (L4a final review M-7). */
export type MentionProps =
  | { kind: 'person' | 'you' | 'record' | 'page'; text: string; href: string; recordKind?: string; restricted?: never }
  | { restricted: keyof typeof RESTRICTED; kind?: never; text?: never; href?: never; recordKind?: never }

/** A mention (§7.11): inline, at the text's own size, a --wash pill. A person or **you** (moss on --accent-soft)
 *  after a faint "@" that assistive tech skips; a record with its kind's glyph; a page with the document glyph. Each is
 *  a link — person → member record, record → record page. One the reader may not see is the dashed inline form,
 *  with no title and nothing to follow ("Members only" on the door, "Not visible to you" on the members' side).
 *  A long title truncates with an ellipsis inside the pill; the whole of it stays in the DOM and in `title`. */
export function Mention(props: MentionProps) {
  if (props.restricted !== undefined) return <span className="mention mention-gone">{RESTRICTED[props.restricted]}</span>
  const { kind, text, href, recordKind } = props
  if (kind === 'person' || kind === 'you') {
    return (
      <Link href={href} className={kind === 'you' ? 'mention mention-you' : 'mention'} title={text}>
        <span className="mention-at" aria-hidden="true">@</span><span className="mention-t">{text}</span>
      </Link>
    )
  }
  return (
    <Link href={href} className="mention mention-rec" title={text}>
      <Icon name={kind === 'page' ? 'doc' : kindIcon(recordKind ?? 'page')} size="xs" /><span className="mention-t">{text}</span>
    </Link>
  )
}
