import { useEffect, useRef } from 'react'
import { useLocation } from 'wouter'

/** Lands on the page's h1: focusable from script (tabIndex −1) but not in the tab order, and focused without
 *  scrolling (the scroll area is reset to the top by the caller). True when focus is settled: on the h1, or left
 *  where the page itself put it inside main (a library preview's heading, the tab just chosen, a card a preview
 *  closed back to). False when the page has not drawn its h1 yet. */
function land(main: HTMLElement): boolean {
  const at = document.activeElement
  if (at instanceof HTMLElement && at !== main && main.contains(at)) return true
  const h1 = main.querySelector('h1')
  if (!h1) return false
  if (!h1.hasAttribute('tabindex')) h1.tabIndex = -1
  h1.focus({ preventScroll: true })
  return true
}

/** Route changes (§5.11): `document.title` is "<page> · <org>" on every draw; on every route change after the
 *  first, the frame's scroll area (the one holding `main`, never the window) returns to the top and focus moves
 *  to the page's `<h1>` — once the page draws one. Focus moves after everything else the change did (a sheet or
 *  the palette closing hands focus back to its opener in its own effect), so the h1 is where the reader lands —
 *  unless focus is then inside the page: a page that moves focus itself on its own route change (the library's
 *  preview, a tab) keeps it there. A redirect before the reader has done anything moves nothing, and a late h1
 *  leaves alone focus the reader has since moved out of the page. */
export function useRouteFocus(page: string, org: string): void {
  const [location] = useLocation()
  useEffect(() => { document.title = `${page} · ${org}` }, [page, org])

  // Has the reader done anything yet (pressed a key, put a pointer down, clicked)? A route change before that is
  // the page's own — a redirect on load, / → /b/home — and moves nothing, so the skip link stays the first Tab.
  // A click counts on its own: a screen reader in browse mode (NVDA, JAWS) or VoiceOver following a link reaches
  // the page as a bare click, with no key or pointer event (L4a final review I-3).
  // (navigator.userActivation would say the same, but a driven browser reports it set from the start.)
  const acted = useRef(false)
  useEffect(() => {
    const on = () => { acted.current = true }
    const kinds = ['keydown', 'pointerdown', 'click'] as const
    for (const k of kinds) window.addEventListener(k, on, true)
    return () => { for (const k of kinds) window.removeEventListener(k, on, true) }
  }, [])

  // The location the last move was made for: the first draw moves nothing (the skip link stays first), and a
  // re-run of the same location (StrictMode's second mount) does not move it again.
  const was = useRef(location)
  useEffect(() => {
    if (was.current === location) return
    was.current = location
    if (!acted.current) return
    let live = true
    let watch: MutationObserver | null = null
    let hold: MutationObserver | null = null
    const main = document.getElementById('main')
    if (!main) return
    const scroll = main.closest<HTMLElement>('.frame-scroll')
    if (scroll) scroll.scrollTop = 0
    // A page's first frame draws its heading (§6.2), and the loaded page may draw it anew: while focus is on the h1
    // it landed on, an h1 drawn in its place takes it, so focus never falls to the body (walk 2026-11-04). Focus
    // moved anywhere else ends this.
    const keep = () => {
      let held = document.activeElement
      if (!(held instanceof HTMLElement) || held.tagName !== 'H1') return
      hold = new MutationObserver(() => {
        const now = document.activeElement
        if (now === held) return
        if ((now && now !== document.body) || held!.isConnected) { hold?.disconnect(); return }
        if (main.querySelector('h1') && land(main)) held = document.activeElement
      })
      hold.observe(main, { childList: true, subtree: true })
    }
    queueMicrotask(() => {
      if (!live) return
      if (land(main)) { keep(); return }
      // The h1 is late. Where focus is now (after the change's own moves) is noted: if the reader moves it anywhere
      // else before the h1 comes (Tabs into the sidebar while the page loads), the h1 does not take it back
      // (L4a final review M-5). Focus that falls to the body (the followed link went with the old page) still waits.
      const at = document.activeElement
      watch = new MutationObserver(() => {
        const now = document.activeElement
        if (now && now !== at && now !== document.body && !main.contains(now)) { watch?.disconnect(); return }
        if (land(main)) { watch?.disconnect(); keep() }
      })
      watch.observe(main, { childList: true, subtree: true })
    })
    return () => { live = false; watch?.disconnect(); hold?.disconnect() }
  }, [location])
}
