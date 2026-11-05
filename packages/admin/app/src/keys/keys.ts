import { HOUSE_SECTIONS } from '../frame/sections.ts'

/** What a key does in the house (§5.8). `go` is a section's page; `open` the palette, the key map, the Changes
 *  tray (`g c`), the public door (`g d`, in a new tab) or a page's New (`n`: Boards' New board, design pass
 *  2026-11-04, DP-18); `fold` folds or unfolds the sidebar; `view` toggles List · Map on the focused list; `move` is
 *  the next or previous row in a list. */
export type KeyAction =
  | { go: string } | { open: 'palette' | 'keymap' | 'changes' | 'door' | 'new' } | { fold: true } | { view: 'toggle' } | { move: 1 | -1 } | null

export interface KeyState { pendingG: number | null }
export interface KeyPress { key: string; meta: boolean; ctrl: boolean; inField: boolean }

/** `g` waits this long for its second key (§5.8). */
export const G_WAIT = 900

/** The second key after `g`: a section's own key goes there (h n p s r t w l); `c` opens the tray; `d` the door. */
function afterG(key: string): KeyAction {
  if (key === 'c') return { open: 'changes' }
  if (key === 'd') return { open: 'door' }
  const s = HOUSE_SECTIONS.find(x => x.key === key && x.id !== 'changes')
  return s ? { go: s.href } : null
}

const IDLE: KeyState = { pendingG: null }

/** One key press, pure: the state after it (a `g` waiting, or not) and what it does. ⌘K / Ctrl-K and ⌘\ / Ctrl-\
 *  are chords and act anywhere, a field included; single keys never act inside a field — `g` then `p` typed in an
 *  input types "gp" (Review Focus 1). Any other chord is the browser's. */
export function keyStep(state: KeyState, e: KeyPress, now: number): { state: KeyState; action: KeyAction } {
  const done = (action: KeyAction) => ({ state: IDLE, action })
  if (e.meta || e.ctrl) {
    if (e.key.toLowerCase() === 'k') return done({ open: 'palette' })
    if (e.key === '\\') return done({ fold: true })
    return done(null)
  }
  if (e.inField) return done(null)
  if (state.pendingG !== null && now - state.pendingG <= G_WAIT) return done(afterG(e.key))
  switch (e.key) {
    case 'g': return { state: { pendingG: now }, action: null }
    case '?': return done({ open: 'keymap' })
    case '[': return done({ fold: true })
    case 'v': return done({ view: 'toggle' })
    case 'n': return done({ open: 'new' })
    case 'j': case 'ArrowDown': return done({ move: 1 })
    case 'k': case 'ArrowUp': return done({ move: -1 })
    default: return done(null)
  }
}

const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'

/** Is the key's target a field — where single keys are typing, not commands? */
export function inField(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches(FIELD)
}

/** A keyboard event as `keyStep` reads it. */
export function pressOf(e: KeyboardEvent | { key: string; metaKey: boolean; ctrlKey: boolean; target: EventTarget | null }): KeyPress {
  return { key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, inField: inField(e.target) }
}
