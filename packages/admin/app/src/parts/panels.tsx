import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { transition } from '../../../lib/machines/run.mjs'
import { panels } from '../machines/panels.ts'
import { LiveRegion } from './live.tsx'

export type Slot = 'right' | 'bottom' | 'overlay'
/** `shut` closes what the slot shows at once (a modal dialog's close()), before focus goes back to the opener. */
interface SlotState { state: string; id: string | null; opener: HTMLElement | null; shut: (() => void) | null }
type Slots = Record<Slot, SlotState>
interface PanelApi {
  slots: Slots
  open: (slot: Slot, id: string, opener: HTMLElement | null, shut?: (() => void) | null) => void
  close: (slot: Slot) => void
  /** Closes the slot only while it shows `id`: an owner leaving the page takes its own panel, never another's. */
  closeIf: (slot: Slot, id: string) => void
}

const Ctx = createContext<PanelApi | null>(null)
const closed = (): SlotState => ({ state: panels.initial, id: null, opener: null, shut: null })

/** The panel slots (spec §4.5): right (inspector, block settings), bottom (the tray's diff), overlay
 *  (⌘K, confirmations). One panel per slot, each slot a `panels` machine. Escape closes the top of
 *  the stack: an overlay in the capture phase, before anything else hears the key; then the right
 *  panel, then the bottom one, in the bubble phase, only if nothing under them (an open editor)
 *  handled it. Closing first shuts what the slot shows (its `shut`: a modal dialog closes, so the page
 *  under it is no longer inert), then returns focus to the opener while it is still in the page. */
export function PanelProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Slots>({ right: closed(), bottom: closed(), overlay: closed() })
  // The slots live in a ref, as useMachine's state does, so open and close are synchronous: a close
  // in the same tick as an open sees it. The state only re-renders.
  const ref = useRef(slots)
  const put = (slot: Slot, s: SlotState) => { ref.current = { ...ref.current, [slot]: s }; setSlots(ref.current) }
  const open = useCallback((slot: Slot, id: string, opener: HTMLElement | null, shut: (() => void) | null = null) => {
    const was = ref.current[slot]
    const r = transition(panels, {}, was.state, { type: 'OPEN', id }, null)
    if (r.ok) put(slot, { state: r.state, id, opener: opener ?? was.opener, shut })
  }, [])
  const close = useCallback((slot: Slot) => {
    const { state, opener, shut } = ref.current[slot]
    const r = transition(panels, {}, state, { type: 'CLOSE' }, null)
    if (!r.ok) return
    put(slot, closed())
    // A modal dialog makes the opener inert: focus() on it would do nothing until the dialog is closed.
    shut?.()
    if (r.effects.includes('returnFocus') && opener && opener.isConnected) opener.focus()
  }, [])
  const closeIf = useCallback((slot: Slot, id: string) => { if (ref.current[slot].id === id) close(slot) }, [close])
  useEffect(() => {
    const capture = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || ref.current.overlay.id === null) return
      // An open menu (focus is on its item) closes itself first, as APG has it: the identity's menu in the More
      // sheet, a menu in the palette. The next Esc reaches the overlay.
      if (e.target instanceof Element && e.target.closest('[role="menu"]')) return
      e.preventDefault(); e.stopPropagation(); close('overlay')
    }
    const bubble = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const slot = (['right', 'bottom'] as const).find(s => ref.current[s].id !== null)
      if (!slot) return
      e.preventDefault(); close(slot)
    }
    window.addEventListener('keydown', capture, true)
    window.addEventListener('keydown', bubble)
    return () => { window.removeEventListener('keydown', capture, true); window.removeEventListener('keydown', bubble) }
  }, [close])
  const api = useMemo<PanelApi>(() => ({ slots, open, close, closeIf }), [slots, open, close, closeIf])
  return <Ctx.Provider value={api}>{children}<LiveRegion /></Ctx.Provider>
}

export function usePanel(slot: Slot): {
  open: (id: string, opener?: HTMLElement | null, shut?: (() => void) | null) => void; close: () => void
  closeIf: (id: string) => void; openId: string | null
} {
  const api = useContext(Ctx)
  if (!api) throw new Error('usePanel needs a PanelProvider')
  return {
    openId: api.slots[slot].id, open: (id, opener, shut) => api.open(slot, id, opener ?? null, shut ?? null),
    close: () => api.close(slot), closeIf: id => api.closeIf(slot, id),
  }
}

/** What a slot shows now, or null — also outside a PanelProvider (a map drawn on the door, a /parts specimen), where
 *  no slot is ever open. */
export function useSlotOpen(slot: Slot): string | null {
  return useContext(Ctx)?.slots[slot].id ?? null
}

/** Closes a dialog at once (jsdom has no close(): the attribute goes). The `shut` of a slot showing one. Focus inside
 *  it is taken out first: a browser moves focus off a closed dialog only at its next rendering update, and a key
 *  pressed before that (`?` after the Esc that closed the palette) would still be typed into its input. */
export function closeDialog(d: HTMLDialogElement | null): void {
  if (!d?.open) return
  const at = document.activeElement
  if (at instanceof HTMLElement && at !== d && d.contains(at)) at.blur()
  if (typeof d.close === 'function') d.close(); else d.removeAttribute('open')
}

/** Keeps a component that shows itself (the palette, the tray's diff) and its slot in step: the slot
 *  opens when the component opens and closes when it closes; when the slot is closed from outside
 *  (Escape), `onClosedOutside` tells the component to close itself. `opener` is read at opening.
 *  `shut` closes what it shows at once — a modal dialog's close() — and runs before focus goes back to
 *  the opener, whichever way the slot closes (A11 review I-1). A component that leaves the page while its slot is
 *  open (the More sheet when the frame widens past the phone) takes its panel with it, so no ghost is left on the
 *  Escape stack to swallow the next Esc (L4a final review I-1). */
export function useSlot(slot: Slot, id: string, isOpen: boolean, onClosedOutside: () => void, opener?: () => HTMLElement | null, shut?: () => void): void {
  const p = usePanel(slot)
  const mine = p.openId === id
  const was = useRef(false)
  const latest = useRef(onClosedOutside)
  latest.current = onClosedOutside
  const shutNow = useRef(shut)
  shutNow.current = shut
  useEffect(() => {
    if (isOpen && !mine) p.open(id, opener?.() ?? null, () => shutNow.current?.())
    if (!isOpen && mine) p.close()
  }, [isOpen])
  useEffect(() => {
    if (was.current && !mine && isOpen) latest.current()
    was.current = mine
  }, [mine])
  const closeIf = useRef(p.closeIf)
  closeIf.current = p.closeIf
  useEffect(() => () => closeIf.current(id), [])
}
