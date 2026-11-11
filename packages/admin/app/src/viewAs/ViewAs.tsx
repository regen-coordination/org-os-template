import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { setPreviewAs } from '../api.ts'
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

/** The viewer as a read names it to the server (`?as=`, the walk review's G1); null: you. */
export function asOf(v: Viewer): string | null {
  return v.as === 'you' ? null : v.as === 'hat' ? `hat:${v.hat}` : v.as
}
/** The reads that stay yours whoever is previewed (api.ts sends them without `as`): the session, who you are (the actor is
 *  never previewed, only the viewer), and the tree's hats the control offers. */
const READ_AS_YOU = new Set(['session', 'actor', 'visibility'])

/** `initial` starts a provider already previewing (a /parts specimen: the rail as Public); the house starts as you. */
export function ViewAsProvider({ source = FIXTURE_SOURCE, initial = YOU, children }: { source?: VisibilitySource; initial?: Viewer; children: ReactNode }) {
  const [viewer, set] = useState<Viewer>(initial)
  const qc = useContext(QueryClientContext)
  const chose = useRef(false)
  // A preview chosen here and still on when the provider goes is ended with it, so no later read is previewed.
  useEffect(() => () => { if (chose.current) setPreviewAs(null) }, [])
  // Entering a preview is said once, through the page's one polite region; leaving it too, as the band goes.
  // View as at the server (the walk review's G1): every read from now on names the viewer (api.ts), and every answer
  // already held is dropped and read again, in-flight ones cancelled, so nothing drawn was answered to another viewer.
  const setViewer = useCallback((v: Viewer) => {
    if (sameViewer(v, viewer)) return
    chose.current = true
    setPreviewAs(asOf(v))
    set(v)
    void qc?.resetQueries({ predicate: q => !READ_AS_YOU.has(String(q.queryKey[0])) })
    announce(v.as === 'you' ? 'Preview ended.' : bandWords(v).join(' '))
  }, [viewer, qc])
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
 *  hidden, not disabled (C-23). False too while the Hub's writes are off (Lane 3 Task 11, C1): the server refuses them
 *  all, so none is offered. */
export function useCanWrite(): boolean {
  const off = useWritesOff() // a hook, so called on every draw
  return useContext(ViewAsContext).viewer.as === 'you' && !off
}

/** False while previewing, true otherwise, whether or not the Hub's writes are off: what a read-only Hub still writes
 *  (plan D-6) — the private store's conversation and per-member state (comments, their resolve, reopen and delete,
 *  read marks, view state) — is offered as long as you are you. Turn into a task writes a task: it asks `useCanWrite`. */
export function useCanConverse(): boolean {
  return useContext(ViewAsContext).viewer.as === 'you'
}

/** The sentence a write refused while the Hub's writes are off says (server/hosted/instance-writes.ts READ_ONLY, the
 *  same words: a test holds them together), for a page that says it without asking. */
export const READ_ONLY = 'This Hub is read-only until writes are turned on. Nothing was written.'

/** Whether `GET /api/status`, as the client last read it, says the Hub's writes are off. It reads the cache only, so it
 *  asks the server nothing itself, and draws as on with no query client (/parts, element tests). */
export function useWritesOff(): boolean {
  const client = useContext(QueryClientContext)
  return useSyncExternalStore(
    useCallback((changed: () => void) => (client ? client.getQueryCache().subscribe(changed) : () => {}), [client]),
    () => client?.getQueryData<{ instanceWrites?: string }>(['status'])?.instanceWrites === 'off',
  )
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
