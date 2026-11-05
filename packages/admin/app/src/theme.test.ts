// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { applyTheme, setTheme, storedTheme, toggleTheme } from './theme.ts'

afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks()
  delete document.documentElement.dataset.theme; delete document.documentElement.dataset.themeSwitching
})

describe('theme', () => {
  it('toggles to the opposite of what shows, and keeps it for this browser', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark'), media: q }))
    expect(storedTheme()).toBeNull()
    expect(toggleTheme()).toBe('light') // the system shows dark
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(storedTheme()).toBe('light')
    expect(toggleTheme()).toBe('dark')
  })

  it('still toggles when storage is refused and matchMedia is missing (Review Focus 5)', () => {
    const no = () => { throw new Error('denied') }
    vi.stubGlobal('localStorage', { getItem: no, setItem: no, removeItem: no })
    vi.stubGlobal('matchMedia', undefined)
    expect(toggleTheme()).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('applyTheme(null) hands the choice back to the system', () => {
    applyTheme('dark')
    applyTheme(null)
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('setTheme keeps the choice; null is System, kept as no choice at all', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
    setTheme('dark')
    expect(store.get('org-os-admin.theme')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    setTheme(null)
    expect(store.has('org-os-admin.theme')).toBe(false)
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('a switch suppresses every transition for one frame: data-theme-switching, gone on the next animation frame', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.push(cb); return frames.length })
    setTheme('light')
    expect(document.documentElement.hasAttribute('data-theme-switching')).toBe(true)
    expect(frames).toHaveLength(1)
    frames[0]!(0)
    expect(document.documentElement.hasAttribute('data-theme-switching')).toBe(false)
  })

  it('toggleTheme switches the same way', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    toggleTheme()
    expect(document.documentElement.hasAttribute('data-theme-switching')).toBe(true)
  })
})
