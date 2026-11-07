import { useEffect, useRef } from 'react'
import { useLocation } from 'wouter'
import { useFrame } from '../design/Shell.tsx'
import { keyStep, pressOf, type KeyState } from './keys.ts'

/** Asks the key map to open (KeyMap listens). */
export const OPEN_KEYMAP = 'house:open-keymap'
/** Asks the Changes tray to expand (`g c`; the tray listens). */
export const OPEN_CHANGES = 'house:open-changes'
/** Asks the page for its New (`n`): the Boards page opens New board; a page without one does nothing. */
export const OPEN_NEW_BOARD = 'house:new-board'
/** Dispatched on the focused element, bubbling: the nearest list with List · Map toggles (useViewToggle). */
export const TOGGLE_VIEW = 'house:toggle-view'

/** The house's keys (§5.8), heard on the window after the page has had them (a handled key — an editor's, a
 *  menu's — is left alone). `g` + a key goes to a section, `g c` expands the tray, `g d` opens the public door
 *  in a new tab, `?` the key map, ⌘\ or `[` fold the sidebar (the frame's, so this is drawn inside the Shell),
 *  `v` toggles List · Map on the focused list. ⌘K is the palette's own (it hears it wherever it is mounted) and
 *  j / k / ↓ / ↑ are each list's (useRoving). While a dialog is open — the palette, the key map, the More sheet, a
 *  confirmation, all modal — focus is in it and its keys are its own. That is read from the key's target, not from
 *  the panels' state, so a key pressed in the same tick as an Esc that closed one is already the house's. */
export function useHouseKeys(): void {
  const [, navigate] = useLocation()
  const { fold } = useFrame()
  const latest = useRef({ navigate, fold })
  latest.current = { navigate, fold }
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
      const { navigate, fold } = latest.current
      e.preventDefault()
      if ('go' in a) navigate(a.go)
      else if ('fold' in a) fold()
      else if ('view' in a) (document.activeElement ?? document.body).dispatchEvent(new Event(TOGGLE_VIEW, { bubbles: true }))
      else if (a.open === 'keymap') window.dispatchEvent(new Event(OPEN_KEYMAP))
      else if (a.open === 'changes') window.dispatchEvent(new Event(OPEN_CHANGES))
      else if (a.open === 'new') window.dispatchEvent(new Event(OPEN_NEW_BOARD))
      else window.open('/door', '_blank', 'noopener,noreferrer')
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
