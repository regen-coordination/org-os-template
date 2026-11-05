import { useId, useMemo, type ReactNode } from 'react'
import { Router, useLocation } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { Shell, useFrame } from '../../design/Shell.tsx'
import { StatusMark } from '../../design/StatusMark.tsx'
import { Sidebar } from '../../frame/Sidebar.tsx'
import { TopBar } from '../../frame/TopBar.tsx'
import { PhoneBar } from '../../frame/PhoneBar.tsx'
import { BottomBar } from '../../frame/BottomBar.tsx'
import { pathOf } from '../../frame/path.ts'
import { houseCounts, type Identity, type SideLink } from '../../frame/sections.ts'
import { ViewAsBand, ViewAsProvider, useCanWrite, useViewer } from '../../viewAs/ViewAs.tsx'
import { VisibilityMarker } from '../../viewAs/VisibilityMarker.tsx'
import { ORG, fakeAddress } from '../../test/fixtures/house/org.ts'
import { FIXED_NOW } from '../../test/fixtures/parts.ts'
import type { Viewer } from '../../viewAs/visibility.ts'
import { PaletteView } from '../../palette/Palette.tsx'
import type { PaletteItem } from '../../palette/palette.ts'
import { KeyTable } from '../../keys/KeyMap.tsx'

/** The fixture member (spec §17): a role, a generated address, a placeholder hat id. */
const WHO: Identity = { hatName: 'Council steward', address: fakeAddress(7), hatId: '13.1', hats: ['Council steward', 'Treasury signer'] }

/** Workspace's collections, as L6 will have them (Q-L4-3: Tasks and Knowledge are L6's); pinned open here, as the
 *  gallery draws it on Home. The Instance group has one board with records, so it is drawn (collapsed). */
const COLLECTIONS: SideLink[] = ['Meetings', 'Tasks', 'Projects', 'Knowledge'].map(label =>
  ({ id: label.toLowerCase(), label, href: `/b/${label.toLowerCase()}` }))
const INSTANCE: SideLink[] = [{ id: 'crew', label: 'Crew', href: '/b/crew' }, { id: 'activity', label: 'Activity', href: '/activity' }]

/** What the sidebar counts, with each item's visibility (L4-R7's `facts.visibility`): three things that need you,
 *  all members' business; one open proposal, public; nine Systems, seven of them Example DAO's public ones; one staged
 *  op. As you: 3 · 1 · 9 · 1. Previewing as Public: nothing needs you, 1, 7, and no staged change (rule 7). */
const pub = { visibility: 'public' }
const LISTS = {
  resources: [
    ...Array.from({ length: 7 }, () => ({ kind: 'system', facts: pub })),
    ...Array.from({ length: 2 }, () => ({ kind: 'system', facts: {} })),
  ],
  open: [{ needsYou: false, facts: pub }],
  // Needs you's items (E-34): a signature, an empty hat, a vote, each members' business
  needs: [{ kind: 'signature', facts: {} }, { kind: 'empty-hat', facts: {} }, { kind: 'proposal', facts: {} }],
  staged: 1,
}

/** The counts, with the viewer's eyes. */
function useFixtureCounts() {
  const { visible } = useViewer()
  return houseCounts(LISTS, visible, useCanWrite())
}

/** The sidebar, counting with the viewer's eyes. */
function FixtureSidebar({ pin }: { pin: boolean }) {
  return <Sidebar org={ORG} counts={useFixtureCounts()} identity={WHO} collections={COLLECTIONS} pinWorkspace={pin} instance={INSTANCE} />
}

const NAMES = { 'DR-2026-010': 'DR-2026-010' }

/** The top bar, or on the phone the phone bar titled with the path's last place. */
function FixtureTop({ unread }: { unread: boolean }) {
  const [path] = useLocation()
  return useFrame().mode === 'phone'
    ? <PhoneBar org={ORG} title={pathOf(path, NAMES).at(-1)?.label ?? ORG.name} />
    : <TopBar unread={unread} names={NAMES} />
}

/** The phone's width: a phone specimen's, and every specimen's when the page itself is on a phone. */
const PHONE = 390

/** One frame specimen: the house frame at a fixed width (so its form does not depend on the browser), at a fixed
 *  route (its own static location: links in it go nowhere), for a fixed viewer. On a phone — the /parts page's
 *  own frame under 760 — every specimen is the phone, as the gallery draws it at 390. `phone` draws one as the
 *  phone at any width, in a box as wide as one; `sheet` draws its More sheet open, in place. */
function Specimen({ title, width, path, viewer, short = false, unread = false, phone = false, sheet = false, children }:
  { title: string; width: number; path: string; viewer?: Viewer; short?: boolean; unread?: boolean; phone?: boolean; sheet?: boolean; children: ReactNode }) {
  const loc = useMemo(() => memoryLocation({ path, static: true }), [path])
  const outer = useFrame().mode
  const onPhone = phone || outer === 'phone'
  return (
    <div className={['pg-frame', short ? 'short' : null, phone ? 'pg-phone' : null].filter(Boolean).join(' ')}>
      <Router hook={loc.hook}>
        <ViewAsProvider initial={viewer}>
          <Shell title={title} org={ORG} width={onPhone ? PHONE : width} folded={false} specimen nav={<FixtureSidebar pin={!short} />}
            top={<FixtureTop unread={unread} />} band={<ViewAsBand />} bottom={<FixtureBottom shown={sheet} />}>
            {children}
          </Shell>
        </ViewAsProvider>
      </Router>
    </div>
  )
}

/** The bottom bar on the fixture counts; `shown` draws its More sheet open. */
function FixtureBottom({ shown }: { shown: boolean }) {
  return <BottomBar counts={useFixtureCounts()} identity={WHO} collections={COLLECTIONS} shown={shown} />
}

/** The palette searching "tre", as the gallery draws it: the Treasury section with its g-keys; the Treasury Safe, a
 *  hat and a Knowledge page; two actions. Placeholders: the hat id is the fixture tree's, not a chain's. */
const TRE: PaletteItem[] = [
  { key: 's:treasury', group: 'jump', label: 'Treasury', detail: 'section', keys: 'g t', icon: 'safe' },
  { key: 'r:safe', group: 'records', label: 'Treasury Safe', detail: 'System · 7 chains', icon: 'safe' },
  { key: 'r:hat', group: 'records', label: 'Treasury signer', detail: 'Hat 13.1.1', icon: 'hat' },
  { key: 'r:page', group: 'records', label: 'How the treasury is run', detail: 'Page · Knowledge', icon: 'doc' },
  { key: 'a:propose', group: 'actions', label: 'Propose a treasury transfer', detail: 'wizard', hint: 'wizard', icon: 'plus' },
  { key: 'a:map', group: 'actions', label: 'Open Treasury on the map', detail: 'action', icon: 'map' },
]

/** The palette and the key map drawn in place (no dialog): the palette on "tre" over the scrim; beside it, the one
 *  line of an empty search and the key map. */
function PaletteSpecimens() {
  const keysId = useId()
  return (
    <div className="pg-pal">
      <div className="pg-pal-scrim" role="group" aria-label="Palette, searching “tre”">
        <PaletteView specimen query="tre" items={TRE} active={0} scope="All" />
      </div>
      <div className="pg-pal-col">
        <div role="group" aria-label="Palette, nothing matches"><PaletteView specimen query="hatt" items={[]} active={0} scope="All" foot={false} /></div>
        <div className="pal" role="group" aria-label="Key map"><KeyTable headingId={keysId} /></div>
      </div>
    </div>
  )
}

const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(FIXED_NOW).replace(',', '')

/** /parts/frame: the gallery's frames — the sidebar at 1240 on Home, the rail at 900 previewing as Public on a
 *  proposal, and the phone with its More sheet open. On a phone the first two are drawn as the phone too. The
 *  pages inside are placeholders: Needs you, the Systems list, the record header and the tray are drawn in their
 *  own groups. */
export default function Frame() {
  return (
    <div className="pg">
      <p className="pg-lede">The nine sections in the sidebar, the top bar with the path and the view-as control, then the page. Under 1100&nbsp;px of frame width the sidebar folds to a rail; ⌘\ or [ folds it at any width; under 760&nbsp;px it becomes the phone bar, a bottom bar and the More sheet. Counts are of what the viewer may see. ⌘K opens the palette from anywhere, and ? the key map.</p>
      <Specimen title="Sidebar, on Home" width={1240} path="/" unread>
        <div className="pg-home">
          <span className="tk-eyebrow">{day}</span>
          <p className="tk-greet">Three things wait on you.</p>
          <p className="pg-home-s">Needs you, the Systems list and Recently are drawn in their own groups.</p>
        </div>
      </Specimen>
      <h2 className="pg-sub">Collapsed rail, viewing as Public <span>the band stays while previewing; nothing that needs you, and no staged change, is counted</span></h2>
      <Specimen title="Rail, previewing as Public" width={900} path="/governance/proposals/DR-2026-010" viewer={{ as: 'public' }} short>
        <div className="pg-rec">
          <div className="pg-rec-top"><span className="mono">DR-2026-010</span><StatusMark mark="open" /><VisibilityMarker value={{ level: 'public' }} /></div>
          <p className="pg-rec-t">Return the Gardens pools to the treasury</p>
          <p className="pg-home-s">Opened 28 Sep 2026 under the steward hat · Council consent</p>
        </div>
      </Specimen>
      <h2 className="pg-sub">On a phone, More open <span>the phone bar, the bottom bar and the More sheet, under 760&nbsp;px of frame width</span></h2>
      <Specimen title="Phone, More open" width={PHONE} path="/" phone sheet>
        <div className="pg-home">
          <span className="tk-eyebrow">{day}</span>
          <p className="tk-greet">Three things wait on you.</p>
        </div>
      </Specimen>
      <h2 className="pg-sub">⌘K palette and the key map <span>reaches every page, record, action and view the viewer may see — nothing else, not even a count</span></h2>
      <PaletteSpecimens />
    </div>
  )
}
