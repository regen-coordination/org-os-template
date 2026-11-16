import { useEffect, useRef } from 'react'
import { useLocation } from 'wouter'
import { useFrame } from '../design/Shell.tsx'
import { usePortalOrigin } from '../session/session.ts'
import { keyStep, pressOf, type KeyState } from './keys.ts'

/** Asks the key map to open (KeyMap listens). */
export const OPEN_KEYMAP = 'house:open-keymap'
/** Asks the Changes tray to expand (`g c`; the tray listens). */
export const OPEN_CHANGES = 'house:open-changes'
/** Asks the Changes tray for its Propose panel (the compose canvas's Propose, DAO-OS L7 Task 17); a change that is applied,
 *  not proposed, opens the tray instead, where its Apply and its rule are said. */
export const OPEN_PROPOSE = 'house:open-propose'
/** Asks the page for its New (`n`): the Boards page opens New board; a page without one does nothing. */
export const OPEN_NEW_BOARD = 'house:new-board'
/** Dispatched on the focused element, bubbling: the nearest list with List · Map toggles (useViewToggle). */
export const TOGGLE_VIEW = 'house:toggle-view'

/** The house's keys (§5.8), heard on the window after the page has had them (a handled key — an editor's, a
 *  menu's — is left alone). `g` + a key goes to a section, `g c` expands the tray, `g d` opens the portal
 *  in a new tab (only when the Hub has a portal origin, at it: D-5; else it does nothing), `?` the key map, ⌘\ or `[` fold the sidebar (the frame's, so this is drawn inside the Shell),
 *  `v` toggles List · Map on the focused list. ⌘K is the palette's own (it hears it wherever it is mounted) and
 *  j / k / ↓ / ↑ are each list's (useRoving). While a dialog is open — the palette, the key map, the More sheet, a
 *  confirmation, all modal — focus is in it and its keys are its own. That is read from the key's target, not from
 *  the panels' state, so a key pressed in the same tick as an Esc that closed one is already the house's. */
export function useHouseKeys(): void {
  const [, navigate] = useLocation()
  const { fold } = useFrame()
  const portal = usePortalOrigin()
  const latest = useRef({ navigate, fold, portal })
  latest.current = { navigate, fold, portal }
  useEffect(() => {
    let state: KeyState = { pendingG: null }
    const onKey = (e: KeyboardEvent) => {
      // Every key moves the state — one the page handled too, so a `g` is not left waiting behind it.
      const step = keyStep(state, pressOf(e), performance.now())
      state = step.state
      if (e.defaultPrevented || e.altKey) return
      const a = step.action
      if (a === null || 'move' in a || ('open' in a && a.open === 'palette')) return
      if (e.target instanceof Element && e.target.closest('dialog[open]')) return
      const { navigate, fold, portal } = latest.current
      if ('open' in a && a.open === 'portal' && portal === null) return // no portal origin: the key is not the house's
      e.preventDefault()
      if ('go' in a) navigate(a.go)
      else if ('fold' in a) fold()
      else if ('view' in a) (document.activeElement ?? document.body).dispatchEvent(new Event(TOGGLE_VIEW, { bubbles: true }))
      else if (a.open === 'keymap') window.dispatchEvent(new Event(OPEN_KEYMAP))
      else if (a.open === 'changes') window.dispatchEvent(new Event(OPEN_CHANGES))
      else if (a.open === 'new') window.dispatchEvent(new Event(OPEN_NEW_BOARD))
      else if (portal !== null) window.open(portal, '_blank', 'noopener,noreferrer')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** The keys, drawn as nothing: placed inside the Shell (App.tsx puts it in the top), so the fold reaches the frame. */
export function HouseKeys(): null {
  useHouseKeys()
  return null
}
