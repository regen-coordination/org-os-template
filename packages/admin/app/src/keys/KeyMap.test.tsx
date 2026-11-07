// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useRef, useState } from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'wouter'
import { Shell } from '../design/Shell.tsx'
import { useRouteFocus } from '../frame/useRouteFocus.ts'
import { renderAt } from '../test/render.tsx'
import { KeyMap } from './KeyMap.tsx'
import { HouseKeys, OPEN_NEW_BOARD } from './useHouseKeys.ts'
import { useViewToggle } from './useViewToggle.ts'

afterEach(() => { vi.restoreAllMocks(); localStorage.removeItem('org-os-admin.rail') })

const PAGES: Record<string, string> = { '/': 'Home', '/governance/proposals': 'Proposals', '/b/treasury': 'Treasury' }

/** A page: its h1, and focus following the route (§5.11). */
function Page() {
  const [path] = useLocation()
  const page = PAGES[path] ?? path
  useRouteFocus(page, 'Org')
  return <><h1>{page}</h1><button type="button">On the page</button><input aria-label="A field" /></>
}

/** The house in small: the frame at 1440 with the keys inside it, then the key map, as App.tsx draws them. */
const house = (path = '/') => renderAt(
  <><Shell title="t" width={1440} nav={<button type="button">In the sidebar</button>} top={<HouseKeys />}><Page /></Shell><KeyMap /></>, path)
const press = (key: string, over: Record<string, unknown> = {}, at: Element = document.activeElement ?? document.body) =>
  fireEvent.keyDown(at, { key, ...over })

describe('the key map (§5.8)', () => {
  // 19 rows: the design pass's `n`, New board on Boards (DP-18), joined §5.8's 18
  it('is a dialog titled "Keys" with the table of §5.8 (19 rows), opened by ? and closed by Esc', () => {
    house()
    const opener = screen.getByRole('button', { name: 'In the sidebar' })
    opener.focus()
    press('?')
    const dialog = screen.getByRole('dialog', { name: 'Keys' })
    const table = within(dialog).getByRole('table')
    const rows = within(table).getAllByRole('row').filter(r => r.parentElement?.tagName === 'TBODY')
    expect(rows.length).toBe(19)
    const does = rows.map(r => within(r).getByRole('rowheader').textContent)
    expect(does.slice(0, 10)).toEqual(['Home', 'Needs you', 'Proposals', 'Systems', 'Roles', 'Treasury', 'Workspace', 'Library', 'Changes', 'Public door, in a new tab'])
    expect(does).toEqual(expect.arrayContaining(['Palette', 'Fold or unfold the sidebar', 'Next or previous row', 'List · Map', 'Open the row', 'Preview in the inspector', 'Close the top panel']))
    const keysOf = (name: string) => [...rows.find(r => within(r).getByRole('rowheader').textContent === name)!.querySelectorAll('kbd')].map(k => k.textContent)
    expect(keysOf('Treasury')).toEqual(['g', 't'])
    expect(keysOf('Palette')).toEqual(['⌘', 'K', 'Ctrl', 'K'])
    expect(keysOf('Fold or unfold the sidebar')).toEqual(['⌘', '\\', '['])
    expect(keysOf('New board, on Boards')).toEqual(['n'])
    press('Escape')
    expect(screen.queryByRole('dialog', { name: 'Keys' })).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('moves focus to its Close button, which closes it and hands focus back', () => {
    house()
    const opener = screen.getByRole('button', { name: 'On the page' })
    opener.focus()
    press('?')
    const close = within(screen.getByRole('dialog', { name: 'Keys' })).getByRole('button', { name: 'Close' })
    expect(document.activeElement).toBe(close)
    fireEvent.click(close)
    expect(screen.queryByRole('dialog', { name: 'Keys' })).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('? typed in a field is a question mark', () => {
    house()
    screen.getByLabelText('A field').focus()
    press('?')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('the house keys', () => {
  it('g p goes to Proposals, and focus lands on the new page’s h1', async () => {
    const { loc } = house()
    screen.getByRole('button', { name: 'In the sidebar' }).focus()
    press('g'); press('p')
    expect(loc.history.at(-1)).toBe('/governance/proposals')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Proposals' })))
  })

  it('g then p typed in a field types "gp" and goes nowhere', () => {
    const { loc } = house()
    const field = screen.getByLabelText('A field')
    field.focus()
    press('g'); press('p')
    expect(loc.history).toEqual(['/'])
  })

  it('g c asks the tray to open; g d opens the public door in a new tab', () => {
    house()
    const asked = vi.fn()
    window.addEventListener('house:open-changes', asked)
    press('g'); press('c')
    expect(asked).toHaveBeenCalledTimes(1)
    window.removeEventListener('house:open-changes', asked)
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    press('g'); press('d')
    expect(opened).toHaveBeenCalledWith('/door', '_blank', 'noopener,noreferrer')
  })

  it('n asks the page for its New (Boards listens), and typed in a field it is typing', () => {
    house()
    const asked = vi.fn()
    window.addEventListener(OPEN_NEW_BOARD, asked)
    press('n', {}, document.body)
    expect(asked).toHaveBeenCalledOnce()
    press('n', {}, screen.getByLabelText('A field'))
    expect(asked).toHaveBeenCalledOnce()
    window.removeEventListener(OPEN_NEW_BOARD, asked)
  })

  it('[ and ⌘\\ fold and unfold the sidebar, and the fold is kept for this browser', () => {
    const { container } = house()
    const mode = () => container.querySelector('.frame')!.getAttribute('data-mode')
    expect(mode()).toBe('sidebar')
    press('[')
    expect(mode()).toBe('rail')
    expect(localStorage.getItem('org-os-admin.rail')).toBe('folded')
    press('\\', { metaKey: true })
    expect(mode()).toBe('sidebar')
    expect(localStorage.getItem('org-os-admin.rail')).toBeNull()
    press('\\', { ctrlKey: true }, screen.getByLabelText('A field')) // a chord, so it folds from a field too
    expect(mode()).toBe('rail')
  })

  it('wait while a dialog is open: its keys are its own', () => {
    const { loc } = house()
    press('?')
    expect(screen.getByRole('dialog', { name: 'Keys' })).toBeTruthy()
    press('g'); press('p')
    expect(loc.history).toEqual(['/'])
  })
})

/** A list with List · Map: `v` toggles the view of the list that holds focus. */
function Views({ name }: { name: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [view] = useViewToggle('list', box)
  return <div ref={box} aria-label={name} role="group"><span data-testid={name}>{view}</span><button type="button">{`Row in ${name}`}</button><input aria-label={`Filter ${name}`} /></div>
}

describe('v and useViewToggle', () => {
  it('v toggles List · Map on the focused list’s container, and only there', () => {
    renderAt(<><HouseKeys /><Views name="one" /><Views name="two" /></>)
    screen.getByRole('button', { name: 'Row in one' }).focus()
    press('v')
    expect(screen.getByTestId('one').textContent).toBe('map')
    expect(screen.getByTestId('two').textContent).toBe('list')
    press('v')
    expect(screen.getByTestId('one').textContent).toBe('list')
    screen.getByLabelText('Filter two').focus()
    press('v') // typed in a field
    expect(screen.getByTestId('two').textContent).toBe('list')
  })

  it('reaches a list drawn after a loading state: the listener follows the container (L4a final review M-18)', () => {
    function Late() {
      const box = useRef<HTMLDivElement>(null)
      const [loaded, setLoaded] = useState(false)
      const [view] = useViewToggle('list', box)
      return loaded
        ? <div ref={box} role="group" aria-label="late"><span data-testid="late">{view}</span><button type="button">Row in late</button></div>
        : <button type="button" onClick={() => setLoaded(true)}>Load</button>
    }
    renderAt(<><HouseKeys /><Late /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    screen.getByRole('button', { name: 'Row in late' }).focus()
    press('v')
    expect(screen.getByTestId('late').textContent).toBe('map')
  })
})

describe('the key map’s table semantics (L4a final review M-15)', () => {
  it('says its roles outright, so a table drawn as grid and flex keeps them in WebKit', () => {
    house()
    press('?')
    const table = within(screen.getByRole('dialog', { name: 'Keys' })).getByRole('table')
    expect(table.getAttribute('role')).toBe('table')
    expect([...table.querySelectorAll('thead, tbody')].map(g => g.getAttribute('role'))).toEqual(['rowgroup', 'rowgroup'])
    expect([...table.querySelectorAll('tr')].every(r => r.getAttribute('role') === 'row')).toBe(true)
    expect([...table.querySelectorAll('thead th')].map(h => h.getAttribute('role'))).toEqual(['columnheader', 'columnheader'])
    expect([...table.querySelectorAll('tbody th')].every(h => h.getAttribute('role') === 'rowheader')).toBe(true)
    expect([...table.querySelectorAll('td')].every(d => d.getAttribute('role') === 'cell')).toBe(true)
  })
})
