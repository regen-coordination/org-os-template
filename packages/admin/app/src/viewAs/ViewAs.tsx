import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Button } from '../design/Button.tsx'
import { Icon, type IconName } from '../design/Icon.tsx'
import { Menu, type MenuEntry } from '../design/Menu.tsx'
import { announce } from '../parts/live.tsx'
import { FIXTURE_SOURCE, canSee, type Viewer, type VisibilitySource } from './visibility.ts'

/** *View as* (spec §5.9, C-23, L4-R13): whose eyes the house is drawn for. The viewer is per tab — React state,
 *  never storage — so a preview ends with the tab and never follows the member to another one. */

const YOU: Viewer = { as: 'you' }

interface ViewAsState { viewer: Viewer; setViewer(v: Viewer): void; source: VisibilitySource }

/** Outside a provider the viewer is you, on the fixture source: every element still draws (tests, /parts). */
const ViewAsContext = createContext<ViewAsState>({ viewer: YOU, setViewer: () => {}, source: FIXTURE_SOURCE })

function sameViewer(a: Viewer, b: Viewer): boolean {
  return a.as === b.as && (a.as !== 'hat' || a.hat === (b as { hat: string }).hat)
}

/** What the control reads after "View as: " (the More sheet's View as… row trails it too), and its glyph. */
export function viewerWord(v: Viewer): string {
  return v.as === 'you' ? 'you' : v.as === 'public' ? 'Public' : v.as === 'members' ? 'Members' : `${v.name} hat`
}
function viewerIcon(v: Viewer): IconName {
  return v.as === 'you' ? 'eye' : v.as === 'public' ? 'globe' : v.as === 'members' ? 'members' : 'hat'
}

/** The band's sentence (§5.9): what is previewed, what is shown, and that nothing can be changed. */
function bandWords(v: Exclude<Viewer, { as: 'you' }>): [string, string] {
  const [who, what] = v.as === 'public' ? ['Public', 'anyone'] : v.as === 'members' ? ['Members', 'members'] : [`the ${v.name} hat`, 'those who wear it']
  return [`Previewing as ${who}.`, `Only what ${what} can read is shown. Nothing can be changed here.`]
}

/** `initial` starts a provider already previewing (a /parts specimen: the rail as Public); the house starts as you. */
export function ViewAsProvider({ source = FIXTURE_SOURCE, initial = YOU, children }: { source?: VisibilitySource; initial?: Viewer; children: ReactNode }) {
  const [viewer, set] = useState<Viewer>(initial)
  // Entering a preview is said once, through the page's one polite region; leaving it too, as the band goes.
  const setViewer = useCallback((v: Viewer) => {
    if (sameViewer(v, viewer)) return
    set(v)
    announce(v.as === 'you' ? 'Preview ended.' : bandWords(v).join(' '))
  }, [viewer])
  const value = useMemo(() => ({ viewer, setViewer, source }), [viewer, setViewer, source])
  return <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>
}

/** The visibility source the house reads with (the fixtures until L5 passes its own). */
export function useVisibilitySource(): VisibilitySource {
  return useContext(ViewAsContext).source
}

/** The viewer, and the filter every list, count, palette, map and mention applies with it (§6.3: what the viewer
 *  may not see is absent — not drawn, not counted). `visible` keeps the items' order. */
export function useViewer(): { viewer: Viewer; previewing: boolean; setViewer(v: Viewer): void; visible<T>(items: T[]): T[]; sees(item: unknown): boolean } {
  const { viewer, setViewer, source } = useContext(ViewAsContext)
  const sees = (item: unknown) => canSee(viewer, source.visibilityOf(item), source)
  return { viewer, previewing: viewer.as !== 'you', setViewer, sees, visible: items => items.filter(sees) }
}

/** False while previewing: write actions (buttons, inline edit, the tray, the composer) are not rendered —
 *  hidden, not disabled (C-23). */
export function useCanWrite(): boolean {
  return useContext(ViewAsContext).viewer.as === 'you'
}

/** The control (§5.9): eye + "View as: you" + chevron, 28px outlined, in the top bar; `compact` is the phone's
 *  eye alone — the eye whoever is previewed (the band says who), named by what it does. The menu: You, Public,
 *  Members, then each hat in the tree by name, its id beside it. */
export function ViewAsControl({ compact = false }: { compact?: boolean }) {
  const { viewer, setViewer, source } = useContext(ViewAsContext)
  const radio = (v: Viewer, label: string, hint?: string): MenuEntry =>
    ({ type: 'radio', label, icon: viewerIcon(v), hint, checked: sameViewer(v, viewer), onSelect: () => setViewer(v) })
  const hats = source.hats()
  const items: MenuEntry[] = [
    radio(YOU, 'You'), radio({ as: 'public' }, 'Public'), radio({ as: 'members' }, 'Members'),
    ...(hats.length === 0 ? [] : [{ type: 'separator' } as const, { type: 'header', label: 'Hats' } as const,
      ...hats.map(h => radio({ as: 'hat', hat: h.hat, name: h.name }, h.name, h.hat))]),
  ]
  const reads = `View as: ${viewerWord(viewer)}`
  return (
    <span className="viewas-wrap" data-view-as="">
      {compact
        ? <Menu label="View as" icon="eye" items={items} />
        : <Menu label="View as" face="viewas" icon={viewerIcon(viewer)} text={reads} items={items} />}
    </span>
  )
}

/** The view-as control the member can see (the top bar's or the phone's). */
function shownControl(): HTMLElement | undefined {
  const all = [...document.querySelectorAll<HTMLElement>('[data-view-as] button[aria-haspopup]')]
  return all.find(b => b.getClientRects().length > 0) ?? all[0]
}

/** Focus it, so leaving a preview from the band does not drop focus on the page. */
function focusControl() {
  shownControl()?.focus()
}

/** Open it, from a menu or a sheet that offers "View as…" (the identity's menu, the phone's More sheet): after
 *  that menu or sheet has closed and handed focus back. */
export function openViewAs(): void {
  setTimeout(() => shownControl()?.click(), 0)
}

/** The band (§5.9): a full-width strip in --solid / --on-solid across the main column while previewing, with an
 *  outlined Exit preview. Esc does not end it (Esc closes panels). A `status`, said once on entry through the
 *  page's one polite region (`announce`), so its own live region is off and it never speaks twice. */
export function ViewAsBand() {
  const { viewer, setViewer } = useContext(ViewAsContext)
  if (viewer.as === 'you') return null
  const [lead, rest] = bandWords(viewer)
  return (
    <div className="band" role="status" aria-live="off">
      <Icon name="eye" />
      <span className="band-t"><b>{lead}</b> {rest}</span>
      <Button small onClick={() => { setViewer(YOU); focusControl() }}>Exit preview</Button>
    </div>
  )
}
