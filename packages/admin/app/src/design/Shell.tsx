import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { useLocation } from 'wouter'
import { recall, remember } from '../storage.ts'
import type { OrgMark } from '../frame/sections.ts'

/** The frame's three forms (§3.8): the frame reads its own width, not the device's. */
export type FrameMode = 'sidebar' | 'rail' | 'phone'

/** ≥1100 and not folded: the sidebar; ≥760: the rail (folded with ⌘\ or `[` at any width ≥760); else the phone. */
export function frameMode(width: number, folded: boolean): FrameMode {
  if (width >= 1100 && !folded) return 'sidebar'
  return width >= 760 ? 'rail' : 'phone'
}

/** The widths the frame's state changes at: the phone, the sidebar, and the inspector beside the page (§5.10). */
export const FRAME_BREAKS = [760, 1100, 1200] as const

/** The fold is kept for this browser (storage.ts: a refused store just forgets it). */
const RAIL = 'org-os-admin.rail'

export interface FrameState {
  mode: FrameMode
  /** The frame's own width (px), for the panels that break where the frame does not: the inspector is modal under
   *  1200 (§5.10). It is the width as of the last breakpoint crossed (760, 1100, 1200): the state is one object
   *  between them, so a resize does not re-render the house per pixel (L4a M-1). Read it for a side of a breakpoint. */
  width: number
  /** The sidebar draws its labels: the sidebar itself, or the rail expanded over the page. */
  expanded: boolean
  /** The sidebar is laid over the page (the rail expanded, 760–1099), with a scrim. */
  overlay: boolean
  /** The top bar's toggle: fold or unfold at ≥1100, else lay the sidebar over the page or take it away (the
   *  phone has no toggle: its bars are the bottom bar and the More sheet). */
  toggle(): void
  /** ⌘\ or `[` (§5.3, §5.8): fold the sidebar to the rail, or unfold it, at any width ≥760; kept for this browser. */
  fold(): void
  toggleLabel: string
  toggleRef: RefObject<HTMLButtonElement | null>
  /** The sidebar's id, for the toggle's aria-controls. */
  sideId: string | undefined
  org: OrgMark | null
}

/** Outside a Shell (tests, /parts cards) everything draws as the full sidebar, and the toggle does nothing. */
const FrameContext = createContext<FrameState>({
  mode: 'sidebar', width: 1440, expanded: true, overlay: false, toggle: () => {}, fold: () => {}, toggleLabel: 'Collapse sidebar',
  toggleRef: { current: null }, sideId: undefined, org: null,
})

export function useFrame(): FrameState {
  return useContext(FrameContext)
}

const viewport = () => (typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1440)

/** The house frame (§5.1): a grid of the sidebar and main; main is the top bar, the band (the *view as* band,
 *  and for now the read-only notice), the page in its own scroll area, the Changes tray docked under it, and —
 *  under 760px, on the phone (§5.4) — the bottom bar (`bottom`) under that. `top` draws the top bar or, on the
 *  phone, the phone bar: it reads the form from `useFrame()`. The skip link ("Skip to content") is the first
 *  thing focusable and targets `main`. The frame measures its own width (ResizeObserver), or takes `width` (a
 *  /parts specimen), and sets `data-mode`. `folded` given overrides the stored fold, so a specimen draws the same
 *  in every browser; a `specimen` is not the page's main landmark and has no skip link. `title` names a
 *  specimen; `org` is the frame's org, for whoever draws it. */
export function Shell({ title, org, nav, top, band, notice, aside, foot, bottom, width, folded: given, specimen = false, children }: {
  title: string; org?: OrgMark; nav: ReactNode; top?: ReactNode; band?: ReactNode; notice?: ReactNode; aside?: ReactNode
  foot?: ReactNode; bottom?: ReactNode; width?: number; folded?: boolean; specimen?: boolean; children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const side = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const sideId = useId()
  const [measured, setMeasured] = useState(viewport)
  const [folded, setFolded] = useState(() => given ?? recall(RAIL) === 'folded')
  const [overlay, setOverlay] = useState(false)

  useEffect(() => {
    if (width !== undefined || typeof ResizeObserver === 'undefined' || !root.current) return
    const watch = new ResizeObserver(entries => { const w = entries[0]?.contentRect.width; if (w !== undefined && w > 0) setMeasured(w) })
    watch.observe(root.current)
    return () => watch.disconnect()
  }, [width])

  const w = width ?? measured
  const mode = frameMode(w, folded)
  const shown = overlay && mode === 'rail'
  const wide = w >= 1100
  const modeNow = useRef(mode)
  modeNow.current = mode
  // The overlay belongs to the rail: widened to the sidebar or narrowed to the phone, it ends, so coming back to the
  // rail's widths does not lay it over the page again and pull focus into it (L4a final review I-1).
  useEffect(() => { if (mode !== 'rail') setOverlay(false) }, [mode])
  // A route change takes it away too, however it came (a g-key, a jump from the palette): the page changed under it.
  const [location] = useLocation()
  useEffect(() => { setOverlay(false) }, [location])

  const close = useCallback((refocus: boolean) => { setOverlay(false); if (refocus) toggleRef.current?.focus() }, [])
  // Esc closes the overlay and hands focus back to the toggle. A menu inside it handles its own Esc first (and
  // stops it), and Esc never ends a *view as* preview (§5.9): only the overlay is closed here.
  useEffect(() => {
    if (!shown) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close(true) } }
    document.addEventListener('keydown', onKey)
    side.current?.querySelector<HTMLElement>('a[href], button')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [shown, close])

  const toggle = useCallback(() => {
    if (mode === 'sidebar') { setFolded(true); remember(RAIL, 'folded') }
    else if (wide) { setFolded(false); remember(RAIL, null) }
    else if (mode === 'rail') setOverlay(o => !o)
  }, [mode, wide])
  // The fold key: flips the stored fold at any width ≥760 (under 1100 the rail is drawn either way, and the fold
  // is there when the frame widens). The overlay goes with it. On a phone it does nothing (§5.3).
  const fold = useCallback(() => {
    if (modeNow.current === 'phone') return
    setOverlay(false)
    setFolded(f => { remember(RAIL, f ? null : 'folded'); return !f }) // storing is idempotent, so a replayed updater is harmless
  }, [])
  const expanded = mode === 'sidebar' || shown
  const toggleLabel = mode === 'sidebar' ? 'Collapse sidebar' : shown ? 'Close sidebar' : 'Expand sidebar'
  // The width changes the state only across a breakpoint (FrameState.width).
  const breaksCrossed = FRAME_BREAKS.filter(b => w >= b).length
  const state = useMemo<FrameState>(() => ({ mode, width: w, expanded, overlay: shown, toggle, fold, toggleLabel, toggleRef, sideId, org: org ?? null }),
    [mode, breaksCrossed, expanded, shown, toggle, fold, toggleLabel, sideId, org])

  // Following a link from the overlay closes it: the page changes under it.
  const followed = (e: MouseEvent) => { if (shown && (e.target as HTMLElement).closest('a')) close(false) }
  const Main = specimen ? 'div' : 'main'
  // The top bar is the page's banner (§13); a specimen's is not, so /parts does not multiply landmarks.
  const Top = specimen ? 'div' : 'header'
  // While the overlay is open, what lies under its scrim is inert, so Tab stays in the sidebar (§13: overlays trap
  // focus). Not the top bar: its toggle is the overlay's own Close.
  const under = shown || undefined
  return (
    <FrameContext.Provider value={state}>
      <div ref={root} className="frame" data-mode={mode} data-overlay={shown ? '' : undefined}
        data-specimen={specimen ? '' : undefined} role={specimen ? 'group' : undefined} aria-label={specimen ? title : undefined}>
        {!specimen && <a className="skip" href="#main">Skip to content</a>}
        <div ref={side} className="frame-side" id={sideId} onClick={followed}>{nav}</div>
        {shown && <div className="frame-scrim" aria-hidden="true" onClick={() => close(false)} />}
        <div className="frame-main">
          <Top className="frame-top">{top}</Top>
          <div className="frame-band" inert={under}>{band}{notice}</div>
          <div className="frame-scroll" inert={under}>
            <div className="frame-row">
              <Main id={specimen ? undefined : 'main'} className="main" tabIndex={specimen ? undefined : -1}>{children}</Main>
              {aside}
            </div>
          </div>
          <div className="frame-tray" inert={under}>{foot}</div>
          {mode === 'phone' && bottom !== undefined && <div className="frame-bbar">{bottom}</div>}
        </div>
      </div>
    </FrameContext.Provider>
  )
}
