import { Icon } from '../design/Icon.tsx'

/** What stands on the door in place of something that is not public (§6.3, rule 6): a lock glyph and "Members only".
 *  It takes nothing, so it can say nothing about what it hides: no title, no kind, no count. L9 draws it for every
 *  embed in a published page that does not resolve to a public record. */
export function MembersOnly() {
  return <p className="door-mo"><Icon name="lock" size="sm" />Members only</p>
}
