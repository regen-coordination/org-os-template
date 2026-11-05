// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { useEffect } from 'react'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { Router, useLocation } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useRouteFocus } from './useRouteFocus.ts'

const PAGES: Record<string, string> = { '/': 'Home', '/governance/proposals': 'Proposals', '/slow': 'Slow' }

/** A frame in small: the scroll area holding main, the page's h1 named after the route. `/slow` draws its h1 late. */
function Page({ late }: { late: boolean }) {
  const [path] = useLocation()
  const page = PAGES[path] ?? path
  useRouteFocus(page, 'Example DAO')
  return (
    <div className="frame-scroll" data-testid="scroll">
      <main id="main" tabIndex={-1}>{!(path === '/slow' && late) && <h1>{page}</h1>}<button type="button">x</button></main>
    </div>
  )
}

/** Drawn after the page, as the bottom bar is: on a route change it hands focus to its own button, as a sheet
 *  closing on a followed link hands focus back to More. Its effect runs after the page's. */
function Thief() {
  const [path] = useLocation()
  useEffect(() => { if (path !== '/') document.getElementById('more')?.focus() }, [path])
  return <button type="button" id="more">More</button>
}

/** Draws the page at `/`; then, unless `idle`, the reader presses a key, as a reader does before following a link. */
function setup(late = false, thief = false, idle = false) {
  const loc = memoryLocation({ path: '/', record: true })
  const utils = render(<Router hook={loc.hook}><Page late={late} />{thief && <Thief />}</Router>)
  if (!idle) fireEvent.keyDown(window, { key: 'Tab' })
  const scroll = utils.getByTestId('scroll')
  let top = 0
  Object.defineProperty(scroll, 'scrollTop', { configurable: true, get: () => top, set: v => { top = v } })
  return { ...utils, loc, scroll, rerenderLate: (l: boolean) => utils.rerender(<Router hook={loc.hook}><Page late={l} />{thief && <Thief />}</Router>) }
}

afterEach(() => { document.title = '' })

describe('useRouteFocus (§5.11)', () => {
  it('names the page in the title on the first draw, and does not move focus then', () => {
    const { getByRole } = setup()
    getByRole('button', { name: 'x' }).focus()
    expect(document.title).toBe('Home · Example DAO')
    expect(document.activeElement).toBe(getByRole('button', { name: 'x' }))
  })

  it('on a route change the title is "Proposals · Example DAO", the h1 (tabIndex −1) is focused, the scroll area is at the top', async () => {
    const { loc, scroll, getByRole } = setup(false, true)
    scroll.scrollTop = 640
    act(() => loc.navigate('/governance/proposals'))
    expect(document.title).toBe('Proposals · Example DAO')
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H1'))
    const h1 = getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe('Proposals')
    expect(h1.tabIndex).toBe(-1)
    expect(scroll.scrollTop).toBe(0)
  })

  it('waits for an h1 the page draws late, then focuses it', async () => {
    const { loc, rerenderLate, getByRole } = setup(true)
    act(() => loc.navigate('/slow'))
    await act(async () => {})
    expect(document.activeElement?.tagName).not.toBe('H1')
    rerenderLate(false)
    await waitFor(() => expect(document.activeElement).toBe(getByRole('heading', { level: 1 })))
  })

  it('leaves focus where the page put it inside main on its own route change (a preview’s heading, a tab)', async () => {
    const { loc, getByRole } = setup()
    act(() => { loc.navigate('/governance/proposals'); getByRole('button', { name: 'x' }).focus() })
    await act(async () => {})
    expect(document.activeElement).toBe(getByRole('button', { name: 'x' }))
  })

  it('a redirect before the reader has done anything (/ → /b/home on load) leaves the skip link first', async () => {
    const { loc, scroll } = setup(false, false, true)
    scroll.scrollTop = 640
    act(() => loc.navigate('/governance/proposals', { replace: true }))
    await act(async () => {})
    expect(document.activeElement).toBe(document.body)
    expect(document.title).toBe('Proposals · Example DAO')
  })

  it('takes focus after whatever else the route change did (a closing sheet handing focus back)', async () => {
    const { loc } = setup(false, true)
    act(() => loc.navigate('/governance/proposals'))
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H1'))
  })

  it('a reader who only clicks (a screen reader in browse mode follows a link with a bare click) lands on the h1 (L4a final review I-3)', async () => {
    const { loc, getByRole } = setup(false, false, true)
    fireEvent.click(getByRole('button', { name: 'x' }))
    act(() => loc.navigate('/governance/proposals'))
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H1'))
  })

  it('a late h1 does not take focus once the reader has moved elsewhere (L4a final review M-5)', async () => {
    const outside = document.createElement('button')
    outside.textContent = 'Sidebar link'
    document.body.append(outside)
    try {
      const { loc, rerenderLate } = setup(true)
      act(() => loc.navigate('/slow'))
      await act(async () => {})
      outside.focus()
      rerenderLate(false)
      await act(async () => {})
      expect(document.activeElement).toBe(outside)
    } finally { outside.remove() }
  })
})

describe('useRouteFocus: a first frame’s heading, then the page’s (walk 2026-11-04, L4c-fix 2)', () => {
  /** A page whose first frame draws its own h1, which the loaded page then replaces with another element. */
  function Loading({ loaded }: { loaded: boolean }) {
    const [path] = useLocation()
    useRouteFocus(path === '/' ? 'Home' : 'Treasury', 'Example DAO')
    return (
      <div className="frame-scroll">
        <main id="main" tabIndex={-1}>
          {path === '/' ? <h1>Home</h1> : loaded ? <header key="page"><h1>Treasury</h1><button type="button">Arrange</button></header> : <h1 key="first">Treasury</h1>}
        </main>
      </div>
    )
  }

  it('keeps focus on the page’s h1 when the loaded page draws it anew', async () => {
    const loc = memoryLocation({ path: '/', record: true })
    const { rerender } = render(<Router hook={loc.hook}><Loading loaded={false} /></Router>)
    fireEvent.keyDown(window, { key: 'Tab' })
    act(() => loc.navigate('/b/treasury'))
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H1'))
    const first = document.activeElement
    rerender(<Router hook={loc.hook}><Loading loaded /></Router>)
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H1'))
    expect(document.activeElement).not.toBe(first)
    expect(document.activeElement?.textContent).toBe('Treasury')
  })

  it('leaves alone focus the reader has moved before the page arrives', async () => {
    const loc = memoryLocation({ path: '/', record: true })
    const { rerender } = render(<Router hook={loc.hook}><Loading loaded={false} /><button type="button" id="side">Side</button></Router>)
    fireEvent.keyDown(window, { key: 'Tab' })
    act(() => loc.navigate('/b/treasury'))
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H1'))
    const side = document.getElementById('side')!
    side.focus()
    rerender(<Router hook={loc.hook}><Loading loaded /><button type="button" id="side">Side</button></Router>)
    await new Promise(r => setTimeout(r, 0))
    expect(document.activeElement).toBe(side)
  })
})
