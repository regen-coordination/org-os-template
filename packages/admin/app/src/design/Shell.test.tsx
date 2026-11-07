// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { Shell, frameMode, useFrame } from './Shell.tsx'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.removeItem('org-os-admin.rail') })

const ui = (width?: number) => (
  <Shell title="example-os" width={width} top={<div>top bar</div>} band={<div>band</div>} notice={<p>Read-only</p>}
    aside={<aside aria-label="Inspector">i</aside>} foot={<div>tray</div>}
    nav={<nav aria-label="Sections"><a href="/" aria-current="page">Home</a><a href="/b/projects">Projects</a></nav>}>
    <h1>Home</h1>
  </Shell>
)

/** The frame's toggle, as the top bar draws it, from the frame's own context. */
function Toggle() {
  const f = useFrame()
  return <button type="button" ref={f.toggleRef} aria-expanded={f.expanded} onClick={f.toggle}>{f.toggleLabel}</button>
}

describe('frameMode (§3.8: the frame reads its own width)', () => {
  it('≥1100 unfolded is the sidebar, 760–1099 or folded the rail, under 760 the phone', () => {
    expect(frameMode(1440, false)).toBe('sidebar')
    expect(frameMode(1100, false)).toBe('sidebar')
    expect(frameMode(1099, false)).toBe('rail')
    expect(frameMode(760, false)).toBe('rail')
    expect(frameMode(759, false)).toBe('phone')
    expect(frameMode(1440, true)).toBe('rail')
    expect(frameMode(500, true)).toBe('phone')
  })
})

describe('Shell (§5.1)', () => {
  it('is a grid of sidebar and main; main holds top, band, the scroll area and the tray', () => {
    const { container } = render(ui(1440))
    const frame = container.querySelector('.frame')!
    expect(frame.getAttribute('data-mode')).toBe('sidebar')
    const areas = [...frame.querySelector('.frame-main')!.children].map(c => c.className)
    expect(areas).toEqual(['frame-top', 'frame-band', 'frame-scroll', 'frame-tray'])
    expect(container.querySelector('.frame-top')!.textContent).toBe('top bar')
    expect(container.querySelector('.frame-band')!.textContent).toBe('bandRead-only')
    expect(container.querySelector('.frame-tray')!.textContent).toBe('tray')
    const main = screen.getByRole('main')
    expect(main.id).toBe('main')
    expect(main.closest('.frame-scroll')).not.toBeNull()
    expect(screen.getByRole('complementary', { name: 'Inspector' }).closest('.frame-scroll')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe('#main')
  })

  // C10 (ledger): 0.6's NavItem and NavGroup are gone with their callers (the sidebar draws the sections, frame/Sidebar).
  it('draws the nav it is given in the sidebar', () => {
    render(ui(1440))
    expect(screen.getByRole('link', { name: 'Projects' }).closest('.frame-side')).not.toBeNull()
  })

  it('measures its own width (ResizeObserver) when no width is given', () => {
    let seen: ResizeObserverCallback = () => {}
    vi.stubGlobal('ResizeObserver', class { constructor(cb: ResizeObserverCallback) { seen = cb } observe() {} disconnect() {} })
    const { container } = render(ui())
    act(() => seen([{ contentRect: { width: 800 } } as ResizeObserverEntry], {} as ResizeObserver))
    expect(container.querySelector('.frame')!.getAttribute('data-mode')).toBe('rail')
    act(() => seen([{ contentRect: { width: 500 } } as ResizeObserverEntry], {} as ResizeObserver))
    expect(container.querySelector('.frame')!.getAttribute('data-mode')).toBe('phone')
  })

  it('folds and unfolds at ≥1100, and keeps the fold for this browser under org-os-admin.rail', () => {
    const { container, unmount } = render(<Shell title="t" width={1440} nav={null} top={<Toggle />}><h1>x</h1></Shell>)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(container.querySelector('.frame')!.getAttribute('data-mode')).toBe('rail')
    expect(localStorage.getItem('org-os-admin.rail')).toBe('folded')
    unmount()
    const again = render(<Shell title="t" width={1440} nav={null} top={<Toggle />}><h1>x</h1></Shell>)
    expect(again.container.querySelector('.frame')!.getAttribute('data-mode')).toBe('rail')
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(again.container.querySelector('.frame')!.getAttribute('data-mode')).toBe('sidebar')
    expect(localStorage.getItem('org-os-admin.rail')).toBeNull()
  })

  it('a given fold wins over the stored one (a /parts specimen draws the same everywhere)', () => {
    localStorage.setItem('org-os-admin.rail', 'folded')
    const { container } = render(<Shell title="t" width={1240} folded={false} nav={null}><h1>x</h1></Shell>)
    expect(container.querySelector('.frame')!.getAttribute('data-mode')).toBe('sidebar')
  })

  // A11 replaces A10's "under 760 the sidebar is not in the grid; the toggle lays it over the page until a link is
  // followed" (ledger): the phone has its own bars, and nothing lays the sidebar over it.
  it('under 760 the bottom bar is drawn under the tray, and nothing lays the sidebar over the page', () => {
    const { container } = render(<Shell title="t" width={390} nav={<a href="/x">X</a>} top={<Toggle />}
      foot={<div>tray</div>} bottom={<nav aria-label="Bottom">b</nav>}><h1>x</h1></Shell>)
    expect(container.querySelector('.frame')!.getAttribute('data-mode')).toBe('phone')
    const areas = [...container.querySelector('.frame-main')!.children].map(c => c.className)
    expect(areas).toEqual(['frame-top', 'frame-band', 'frame-scroll', 'frame-tray', 'frame-bbar'])
    expect(screen.getByRole('navigation', { name: 'Bottom' }).parentElement!.className).toBe('frame-bbar')
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(container.querySelector('[data-overlay]')).toBeNull()
  })

  it('at 760 and over the bottom bar is not drawn', () => {
    render(<Shell title="t" width={800} nav={null} bottom={<nav aria-label="Bottom">b</nav>}><h1>x</h1></Shell>)
    expect(screen.queryByRole('navigation', { name: 'Bottom' })).toBeNull()
  })

  it('the skip link "Skip to content" is the first focusable and targets main', () => {
    const { container } = render(ui(1440))
    const first = container.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')!
    expect(first.textContent).toBe('Skip to content')
    expect(first.getAttribute('href')).toBe('#main')
    expect(document.getElementById('main')!.tagName).toBe('MAIN')
  })

  it('a /parts specimen (width given) is not the page’s main landmark', () => {
    render(<Shell title="t" width={900} specimen nav={null}><h2>x</h2></Shell>)
    expect(screen.queryByRole('main')).toBeNull()
    expect(document.querySelector('[data-specimen]')).not.toBeNull()
  })
})

describe('the frame’s lifecycles at the edges (L4a final review)', () => {
  const rail = (width: number) => (
    <Shell title="t" width={width} nav={<a href="/x">X</a>} top={<Toggle />}><h1>x</h1><button type="button">page</button></Shell>
  )

  it('I-1: the rail overlay ends with its mode — widen and narrow again, and it does not reopen or take focus', () => {
    const { container, rerender } = render(rail(900))
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(container.querySelector('[data-overlay]')).not.toBeNull()
    const page = screen.getByRole('button', { name: 'page' })
    page.focus()
    rerender(rail(1300))
    rerender(rail(900))
    expect(container.querySelector('[data-overlay]')).toBeNull()
    expect(document.activeElement).toBe(page)
  })

  it('M-1: the frame’s state is the same object across widths of one form (no re-render per resized pixel)', () => {
    const seen: unknown[] = []
    function Watch() { seen.push(useFrame()); return null }
    const at = (width: number) => <Shell title="t" width={width} nav={null} top={<Watch />}><h1>x</h1></Shell>
    const { rerender } = render(at(1440))
    rerender(at(1500))
    rerender(at(1600))
    expect(new Set(seen).size).toBe(1)
  })

  it('B9 (CC-13): the frame’s state carries its width, and changes when the width crosses 1200, where the inspector stops being modal', () => {
    const seen: { width: number; mode: string }[] = []
    function Watch() { const f = useFrame(); seen.push(f); return null }
    const at = (width: number) => <Shell title="t" width={width} nav={null} top={<Watch />}><h1>x</h1></Shell>
    const { rerender } = render(at(1150))
    rerender(at(1199))
    rerender(at(1200))
    expect(new Set(seen).size).toBe(2)
    expect(seen.at(0)).toMatchObject({ width: 1150, mode: 'sidebar' })
    expect(seen.at(-1)).toMatchObject({ width: 1200, mode: 'sidebar' })
  })

  it('M-2: the open overlay makes the band, the page and the tray inert, not the top bar (its toggle closes it)', () => {
    const { container } = render(<Shell title="t" width={900} nav={<a href="/x">X</a>} top={<Toggle />} band={<p>band</p>} foot={<p>tray</p>}><h1>x</h1></Shell>)
    const inert = () => ['.frame-top', '.frame-band', '.frame-scroll', '.frame-tray'].map(s => container.querySelector(s)!.hasAttribute('inert'))
    expect(inert()).toEqual([false, false, false, false])
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(inert()).toEqual([false, true, true, true])
    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }))
    expect(inert()).toEqual([false, false, false, false])
  })

  it('M-2: a route change that is not a click in the overlay (g-keys, the palette) closes it', () => {
    const loc = memoryLocation({ path: '/', record: true })
    const { container } = render(<Router hook={loc.hook}>{rail(900)}</Router>)
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(container.querySelector('[data-overlay]')).not.toBeNull()
    act(() => loc.navigate('/governance/proposals'))
    expect(container.querySelector('[data-overlay]')).toBeNull()
  })

  it('M-3: the fold key does nothing on a phone (§5.3: ≥760)', () => {
    function Fold() { const f = useFrame(); return <button type="button" onClick={f.fold}>fold</button> }
    const at = (width: number) => <Shell title="t" width={width} nav={null} top={<Fold />}><h1>x</h1></Shell>
    const { container, rerender } = render(at(390))
    fireEvent.click(screen.getByRole('button', { name: 'fold' }))
    expect(localStorage.getItem('org-os-admin.rail')).toBeNull()
    rerender(at(1440))
    expect(container.querySelector('.frame')!.getAttribute('data-mode')).toBe('sidebar')
    fireEvent.click(screen.getByRole('button', { name: 'fold' }))
    expect(localStorage.getItem('org-os-admin.rail')).toBe('folded')
  })

  it('M-22: the top bar is the page’s header landmark; a specimen’s is not', () => {
    const { unmount } = render(ui(1440))
    expect(screen.getByRole('banner').className).toBe('frame-top')
    unmount()
    render(<Shell title="t" width={900} specimen nav={null} top={<div>top</div>}><h2>x</h2></Shell>)
    expect(screen.queryByRole('banner')).toBeNull()
    expect(document.querySelector('.frame-top')!.tagName).toBe('DIV')
  })
})
