import { useEffect, useState, type RefObject } from 'react'
import { TOGGLE_VIEW } from './useHouseKeys.ts'

export type ListView = 'list' | 'map'

/** A list's List · Map (§5.8): the view, and its setter for the segmented control. `v` (useHouseKeys) dispatches
 *  `house:toggle-view` on the focused element; it bubbles to the nearest `container` that holds focus, which
 *  toggles and stops it there, so one press turns one list. */
export function useViewToggle(initial: ListView, container?: RefObject<HTMLElement | null>): [ListView, (v: ListView) => void] {
  const [view, setView] = useState<ListView>(initial)
  // Re-attached after every draw, so a container drawn after a loading state (a list block that waits for its data)
  // gets the listener too: the ref object never changes, only what it holds (L4a final review M-18).
  useEffect(() => {
    const el = container?.current
    if (!el) return
    const onToggle = (e: Event) => { e.stopPropagation(); setView(v => (v === 'list' ? 'map' : 'list')) }
    el.addEventListener(TOGGLE_VIEW, onToggle)
    return () => el.removeEventListener(TOGGLE_VIEW, onToggle)
  })
  return [view, setView]
}
