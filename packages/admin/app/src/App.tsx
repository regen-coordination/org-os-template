import { useEffect } from 'react'
import { Redirect, Route, Switch, useLocation } from 'wouter'
import { Shell, useFrame } from './design/Shell.tsx'
import Nav, { HouseBottom } from './Nav.tsx'
import ReadOnlyNotice from './ReadOnly.tsx'
import Inspector from './inspector/Inspector.tsx'
import { InspectorProvider } from './inspector/InspectorContext.tsx'
import { PanelProvider, usePanel } from './parts/panels.tsx'
import { LiveRegion } from './parts/live.tsx'
import { ProposalRedirect, RegistryRedirect, ToBoard } from './redirects.tsx'
import { BoardPage } from './boards/Board.tsx'
import { BlockSettings } from './boards/BlockSettings.tsx'
import { useArrangeDraft, arrangeStore } from './boards/arrangeStore.ts'
import NotFound from './pages/NotFound.tsx'
import Boards from './pages/Boards.tsx'
import Activity from './pages/Activity.tsx'
import Library from './pages/Library.tsx'
import RegistryList from './pages/RegistryList.tsx'
import AllRecords from './pages/AllRecords.tsx'
import RecordPage from './pages/Record.tsx'
import Governance from './pages/Governance.tsx'
import ProposalPage from './pages/Proposal.tsx'
import NewRecord from './pages/NewRecord.tsx'
import Changes from './pages/Changes.tsx'
import SignInPage from './pages/SignInPage.tsx'
import { SessionProvider } from './session/session.ts'
import { useHouseSource } from './session/houseSource.ts'
import Needs from './pages/Needs.tsx'
import Systems from './pages/Systems.tsx'
import Roles from './pages/Roles.tsx'
import Workspace from './pages/Workspace.tsx'
import Tray from './changes/Tray.tsx'
import ProposePanel from './changes/ProposePanel.tsx'
import { sectionById } from './sections.ts'
import { safeDecode } from './hrefs.ts'
import { sectionBoardId } from '../../lib/board-query.mjs'
import PartsPage, { PartsGroupPage } from './parts/PartsPage.tsx'
import WizardPage from './wizards/WizardPage.tsx'
import Palette from './palette/Palette.tsx'
import { KeyMap } from './keys/KeyMap.tsx'
import { HouseKeys } from './keys/useHouseKeys.ts'
import { useServerEvents } from './ws.ts'
import { useResources, useStatus } from './queries.ts'
import { applyTheme, storedTheme } from './theme.ts'
import { applySkin, chosenSkin } from './skin.ts'
import { ViewAsBand, ViewAsProvider, useCanWrite, useViewer, useVisibilitySource } from './viewAs/ViewAs.tsx'
import { TopBar } from './frame/TopBar.tsx'
import { PhoneBar } from './frame/PhoneBar.tsx'
import { namedIn, pathOf } from './frame/path.ts'
import { useEntryOfResources } from './blocks/entries.ts'
import { shownName } from './record/restricted.ts'
import { useRouteFocus } from './frame/useRouteFocus.ts'
import { useBoards } from './boards/queries.ts'
import { DoorPage } from './door/DoorPage.tsx'
import SignInLinkPage from './pages/SignInLinkPage.tsx'
import { DOOR_PUBLIC } from './test/fixtures/house/door.ts'
import { FIXED_NOW } from './test/fixtures/parts.ts'

/** The right slot: the proposal panel while proposing, block settings while arranging, else the inspector (contract: one panel per slot). A
 *  removed block, or a draft that ended (Done, Cancel, leaving the board), takes its settings with it, so
 *  the Escape stack never holds a hidden panel. A preview takes the proposal panel with it, as it takes the tray:
 *  no write form stays open under "Nothing can be changed here" (§5.9, C-23). */
function RightSlot() {
  const right = usePanel('right')
  const draft = useArrangeDraft()
  const canWrite = useCanWrite()
  const blockId = right.openId?.startsWith('block-settings:') ? right.openId.slice('block-settings:'.length) : null
  const gone = blockId !== null && !draft?.board.blocks.some(b => b.id === blockId)
  useEffect(() => { if (gone) right.close() }, [gone])
  useEffect(() => { if (right.openId === 'propose' && !canWrite) right.close() }, [right.openId, canWrite])
  // A preview ends an arrange (C6, C-23): its draft is not edited under "Nothing can be changed here" — Done would
  // stage it — so the draft ends where the viewer becomes a preview, and an open Block settings (which writes the
  // draft on every keystroke) closes with it. One place, both symptoms.
  useEffect(() => {
    if (canWrite) return
    if (arrangeStore.get() !== null) arrangeStore.end()
    if (right.openId?.startsWith('block-settings:')) right.close()
  }, [canWrite, right.openId])
  if (right.openId === 'propose') return <ProposePanel />
  return blockId !== null ? <BlockSettings blockId={blockId} /> : <Inspector />
}

/** The top bar — or on the phone the phone bar — its path named from what the client already holds: a record's
 *  name, a board's name. The path's last place is the page: it titles the document and the phone bar, and a
 *  route change moves focus to the page's h1 (§5.11). */
function HouseTop() {
  const resources = useResources().data ?? []
  const boards = useBoards().data ?? []
  const [location] = useLocation()
  const { mode, org } = useFrame()
  const { visible } = useViewer()
  const source = useVisibilitySource()
  const names: Record<string, string> = {}
  for (const b of boards) names[b.id] = b.name
  // a record by its resource id, `<kind>:<id>` (E-64): two kinds' records may share a bare id. Only the records the
  // viewer may see lend their names: previewing as Public, a members' record is named by its id (C11: the route shots
  // showed a proposal's title in the path over "this proposal is not shown"). Only the record the path names lends
  // one, read through its file entry: a name the gate marks restricted is "<hat> only", and until the entry has
  // answered the record is named by its id, so the raw name never titles the document (D-12, E-70).
  const at = namedIn(location)
  const named = visible(resources).filter(r => r.id === at)
  const entries = useEntryOfResources(named)
  if (!entries.pending) for (const r of named) names[r.id] = shownName(r, entries.entryOf(r), source)
  const orgName = org?.name ?? 'org-os'
  const page = pathOf(location, names).at(-1)?.label ?? orgName
  useRouteFocus(page, orgName)
  return mode === 'phone' ? <PhoneBar org={org ?? { name: orgName, mark: null }} title={page} /> : <TopBar names={names} />
}

/** The Changes tray docked under every page but /changes, which draws it whole (the two would be one change twice). */
function Dock() {
  const [location] = useLocation()
  return location === '/changes' ? null : <Tray />
}

/** The public door at /door, outside the frame: no sidebar, no tray, nothing that needs a member (§12). Here it is
 *  drawn from fixtures and says so; L9 builds the real door from the org's public records. */
function DoorRoute() {
  useEffect(() => { document.title = DOOR_PUBLIC.org.name }, [])
  // /door is outside the Hub's frame (which mounts the page's live region in PanelProvider), so it carries its own:
  // the door's Copy says "Copied 0x…" to someone (4.1.3, B4). The two are never mounted at once.
  return <>
    <DoorPage model={DOOR_PUBLIC} now={FIXED_NOW}
      notice="Sample values: this door is drawn from fixtures. The real one is built from the org’s public records." />
    <LiveRegion />
  </>
}

/** /sign-in/link (Lane 3 Task 10): the emailed link's page, drawn alone like the door — before sign-in nothing of the
 *  frame would read. */
function SignInLinkRoute() {
  const org = useStatus().data?.org ?? 'org-os'
  useEffect(() => { document.title = `Sign in · ${org}` }, [org])
  return <SignInLinkPage org={org} />
}

/** /door is the public door, drawn alone, and so is /sign-in/link; every other route is the Hub, in its frame. */
export default function App() {
  const [location] = useLocation()
  return location === '/door' ? <DoorRoute /> : location === '/sign-in/link' ? <SignInLinkRoute /> : <HubApp />
}

function HubApp() {
  useServerEvents()
  useEffect(() => { applyTheme(storedTheme()); applySkin(chosenSkin()) }, [])
  const status = useStatus()
  const [location] = useLocation()
  // What may be seen is read from the session (L5 spec §11.2): the fixtures' source until GET /api/visibility answers.
  const source = useHouseSource()
  // /sign-in is the frame's blank layout (L5 spec §11.1): the card alone, none of the frame's places, which would read
  // what the public may not. The providers stay put around it, so the live region keeps what signing in said.
  // The keys, the palette and the key map live in the frame's top: the fold key reaches the frame, and the palette's
  // phone sheet reads the frame's width (frame.css).
  return (
    <ViewAsProvider source={source}><PanelProvider><InspectorProvider><SessionProvider>
      {location === '/sign-in' ? <SignInPage /> : <Shell title={status.data?.org ?? 'org-os'} org={{ name: status.data?.org ?? 'org-os', mark: null }} nav={<Nav />} top={<><HouseKeys /><HouseTop /><Palette /><KeyMap /></>}
        band={<><ViewAsBand /><ReadOnlyNotice /></>} aside={<RightSlot />} foot={<Dock />} bottom={<HouseBottom />}>
        <Switch>
          <Route path="/"><ToBoard id="home" /></Route>
          <Route path="/activity" component={Activity} />
          <Route path="/library"><Library /></Route>
          <Route path="/library/:id">{p => <Library id={safeDecode(p.id)} />}</Route>
          <Route path="/boards" component={Boards} />
          <Route path="/b/:id">{p => <BoardPage key={p.id} id={safeDecode(p.id)} />}</Route>
          <Route path="/new/:registry">{p => <NewRecord key={p.registry} registry={p.registry} />}</Route>
          <Route path="/r/proposal/:id">{p => <ProposalRedirect id={p.id} />}</Route>
          <Route path="/r/:kind/:id">{p => <RecordPage kind={safeDecode(p.kind)} id={safeDecode(p.id)} />}</Route>
          <Route path="/r/:registry">{p => <RegistryRedirect registry={p.registry} />}</Route>
          <Route path="/governance"><Redirect to="/governance/proposals" replace /></Route>
          <Route path="/governance/proposals/:id">{p => <ProposalPage id={safeDecode(p.id)} />}</Route>
          <Route path="/governance/:part">{p => (['rules', 'decisions', 'proposals'].includes(p.part) ? <Governance part={p.part} /> : <NotFound />)}</Route>
          <Route path="/maps/:map">{p => <ToBoard id={p.map} />}</Route>
          <Route path="/all" component={AllRecords} />
          <Route path="/changes" component={Changes} />
          <Route path="/all/:registry">{p => <RegistryList key={p.registry} registry={safeDecode(p.registry)} title={safeDecode(p.registry)} />}</Route>
          <Route path="/parts" component={PartsPage} />
          <Route path="/parts/:group">{p => <PartsGroupPage key={p.group} id={safeDecode(p.group)} />}</Route>
          <Route path="/wizards/:id">{p => <WizardPage key={p.id} id={safeDecode(p.id)} />}</Route>
          {/* The Hub's own sections (L4-R22, E-33): before /:section, which would send /systems to a board */}
          <Route path="/needs" component={Needs} />
          <Route path="/systems" component={Systems} />
          <Route path="/roles" component={Roles} />
          <Route path="/workspace"><Workspace /></Route>
          <Route path="/:section">{p => (sectionById(p.section) ? <ToBoard id={sectionBoardId(p.section)} /> : <NotFound />)}</Route>
          <Route><NotFound /></Route>
        </Switch>
      </Shell>}
    </SessionProvider></InspectorProvider></PanelProvider></ViewAsProvider>
  )
}
