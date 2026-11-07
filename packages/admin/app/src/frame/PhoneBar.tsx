import { Button } from '../design/Button.tsx'
import { ViewAsControl } from '../viewAs/ViewAs.tsx'
import { OrgSeal } from './OrgSwitcher.tsx'
import type { OrgMark } from './sections.ts'

/** The phone bar (§5.4), the top of the frame under 760px: the org's seal, the page's title (Sans 600 14,
 *  truncated), then View as — the eye — and Search, each a 44px target. Search asks the palette to open, as the
 *  sidebar's does. The page's own h1 stays the heading: the title here is a label, not a second one. */
export function PhoneBar({ org, title }: { org: OrgMark; title: string }) {
  const ask = () => window.dispatchEvent(new Event('open-palette'))
  return (
    <div className="ptop">
      <OrgSeal org={org} />
      <span className="ptop-t">{title}</span>
      <div className="ptop-tools">
        <ViewAsControl compact />
        <Button variant="ghost" icon="search" iconOnly label="Search or jump" onClick={ask} />
      </div>
    </div>
  )
}
