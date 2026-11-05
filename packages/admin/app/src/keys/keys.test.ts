// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { G_WAIT, inField, keyStep, type KeyAction } from './keys.ts'

const NONE = { pendingG: null }
const key = (k: string, over: Partial<{ meta: boolean; ctrl: boolean; inField: boolean }> = {}) =>
  ({ key: k, meta: false, ctrl: false, inField: false, ...over })

/** `g`, then `second` after `wait` ms: the second step's action. */
function afterG(second: string, wait = 100): KeyAction {
  const one = keyStep(NONE, key('g'), 1000)
  expect(one.action).toBeNull()
  expect(one.state.pendingG).toBe(1000)
  return keyStep(one.state, key(second), 1000 + wait).action
}

describe('keyStep (§5.8)', () => {
  it('g then a section key within 900 ms goes to that section', () => {
    expect(afterG('h')).toEqual({ go: '/' })
    expect(afterG('n')).toEqual({ go: '/needs' })
    expect(afterG('p')).toEqual({ go: '/governance/proposals' })
    expect(afterG('s')).toEqual({ go: '/systems' })
    expect(afterG('r')).toEqual({ go: '/roles' })
    expect(afterG('t')).toEqual({ go: '/b/treasury' })
    expect(afterG('w')).toEqual({ go: '/workspace' })
    expect(afterG('l')).toEqual({ go: '/library' })
    expect(afterG('h', G_WAIT)).toEqual({ go: '/' }) // 900 ms is still within
  })

  it('g c opens the Changes tray, g d the public door', () => {
    expect(afterG('c')).toEqual({ open: 'changes' })
    expect(afterG('d')).toEqual({ open: 'door' })
  })

  it('g then a key at +901 ms does nothing', () => {
    expect(afterG('h', 901)).toBeNull()
    expect(afterG('p', 901)).toBeNull()
  })

  it('the second key ends the wait, whatever it was', () => {
    const one = keyStep(NONE, key('g'), 0)
    const two = keyStep(one.state, key('x'), 10)
    expect(two).toEqual({ state: NONE, action: null })
    expect(keyStep(two.state, key('h'), 20).action).toBeNull() // h alone is nothing
  })

  it('keys never fire inside a field', () => {
    for (const k of ['g', '?', '[', 'v', 'j', 'k', 'ArrowDown']) expect(keyStep(NONE, key(k, { inField: true }), 0).action).toBeNull()
    // g typed in a field starts no wait: "gp" in an input goes nowhere
    const one = keyStep(NONE, key('g', { inField: true }), 0)
    expect(one.state.pendingG).toBeNull()
    expect(keyStep(one.state, key('p', { inField: true }), 10).action).toBeNull()
    // nor does a wait begun outside finish inside one
    const out = keyStep(NONE, key('g'), 0)
    expect(keyStep(out.state, key('p', { inField: true }), 10).action).toBeNull()
  })

  it('⌘K and Ctrl-K open the palette, even in a field', () => {
    expect(keyStep(NONE, key('k', { meta: true }), 0).action).toEqual({ open: 'palette' })
    expect(keyStep(NONE, key('k', { ctrl: true }), 0).action).toEqual({ open: 'palette' })
    expect(keyStep(NONE, key('K', { meta: true, inField: true }), 0).action).toEqual({ open: 'palette' })
  })

  it('⌘\\ and [ fold the sidebar', () => {
    expect(keyStep(NONE, key('\\', { meta: true }), 0).action).toEqual({ fold: true })
    expect(keyStep(NONE, key('\\', { ctrl: true }), 0).action).toEqual({ fold: true })
    expect(keyStep(NONE, key('['), 0).action).toEqual({ fold: true })
  })

  it('? shows the key map, v toggles List · Map, j / k and ↓ / ↑ move', () => {
    expect(keyStep(NONE, key('?'), 0).action).toEqual({ open: 'keymap' })
    expect(keyStep(NONE, key('v'), 0).action).toEqual({ view: 'toggle' })
    expect(keyStep(NONE, key('j'), 0).action).toEqual({ move: 1 })
    expect(keyStep(NONE, key('k'), 0).action).toEqual({ move: -1 })
    expect(keyStep(NONE, key('ArrowDown'), 0).action).toEqual({ move: 1 })
    expect(keyStep(NONE, key('ArrowUp'), 0).action).toEqual({ move: -1 })
  })

  // design pass 2026-11-04 (DP-18): ⌘N is the browser's (a new window; Chrome never hands it to the page), so a page's
  // New is `n`, outside a field; `g n` stays Needs you
  it('n asks the page for its New, outside a field only', () => {
    expect(keyStep(NONE, key('n'), 0).action).toEqual({ open: 'new' })
    expect(keyStep(NONE, key('n', { inField: true }), 0).action).toBeNull()
    expect(keyStep(NONE, key('n', { meta: true }), 0).action).toBeNull()
    expect(afterG('n')).toEqual({ go: '/needs' })
  })

  it('a single letter held with ⌘ or Ctrl is the browser’s, not the house’s', () => {
    for (const k of ['g', 'v', 'j', '[']) expect(keyStep(NONE, key(k, { meta: true }), 0).action).toBeNull()
    expect(keyStep(NONE, key('g', { ctrl: true }), 0).state.pendingG).toBeNull()
  })
})

describe('inField', () => {
  it('is an input, a textarea, a select or an editable element', () => {
    const el = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild! }
    expect(inField(el('<input>'))).toBe(true)
    expect(inField(el('<textarea></textarea>'))).toBe(true)
    expect(inField(el('<select></select>'))).toBe(true)
    expect(inField(el('<div contenteditable=""></div>'))).toBe(true)
    expect(inField(el('<div contenteditable="true"></div>'))).toBe(true)
    expect(inField(el('<div contenteditable="false"></div>'))).toBe(false)
    expect(inField(el('<button>x</button>'))).toBe(false)
    expect(inField(null)).toBe(false)
    expect(inField(window)).toBe(false)
  })
})
