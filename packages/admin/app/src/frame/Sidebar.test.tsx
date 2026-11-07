// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { Sidebar } from './Sidebar.tsx'
import { TopBar } from './TopBar.tsx'
import { Shell } from '../design/Shell.tsx'
import { ViewAsBand, ViewAsControl, ViewAsProvider, useViewer } from '../viewAs/ViewAs.tsx'
import { renderAt } from '../test/render.tsx'
import type { HouseCounts, Identity, SideLink } from './sections.ts'

const ORG = { name: 'Example DAO', mark: null }
const WHO: Identity = { hatName: 'Council steward', address: '0x9c1f00000000000000000000000000000000a04e', hatId: '13.1', hats: ['Council steward', 'Ops'] }
const COUNTS: HouseCounts = { needs: 3, proposals: 1, systems: 9, changes: 1 }
const COLLECTIONS: SideLink[] = [
  { id: 'meetings', label: 'Meetings', href: '/b/meetings' }, { id: 'projects', label: 'Projects', href: '/b/projects' },
]
const INSTANCE: SideLink[] = [{ id: 'crew', label: 'Crew', href: '/b/crew' }, { id: 'activity', label: 'Activity', href: '/activity' }]

const side = (over: Partial<Parameters<typeof Sidebar>[0]> = {}) =>
  <Sidebar org={ORG} counts={COUNTS} identity={WHO} collections={COLLECTIONS} instance={INSTANCE} {...over} />
const house = () => screen.getByRole('navigation', { name: 'Hub' })

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('the sidebar (§5.2)', () => {
  it('is a nav named House with the nine sections in order, each with its icon; the current one is aria-current', () => {
    renderAt(side(), '/b/home')
    const links = within(house()).getAllByRole('link').filter(a => !a.classList.contains('side-sub'))
    expect(links.map(a => a.querySelector('.side-l')?.textContent)).toEqual(
      ['Home', 'Needs you', 'Proposals', 'Systems', 'Roles', 'Treasury', 'Workspace', 'Library', 'Changes'])
    for (const a of links) expect(a.querySelector('svg.i'), a.textContent!).not.toBeNull()
    expect(within(house()).getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe('page')
    expect(links.filter(a => a.getAttribute('aria-current') === 'page')).toHaveLength(1)
  })

  it('marks the section of a record page current: a System’s in Systems, a project’s in Workspace (E-64)', () => {
    const sys = renderAt(side(), '/r/system/treasury')
    expect(within(house()).getByRole('link', { name: /^Systems/ }).getAttribute('aria-current')).toBe('page')
    sys.unmount()
    renderAt(side(), '/r/project/proj-001')
    expect(within(house()).getByRole('link', { name: 'Workspace' }).getAttribute('aria-current')).toBe('page')
  })

  it('Needs you’s count carries the attention class, Changes’ the accent class', () => {
    renderAt(side(), '/')
    expect(within(house()).getByRole('link', { name: 'Needs you, 3' }).querySelector('.n')!.className).toBe('n attn')
    expect(within(house()).getByRole('link', { name: 'Changes, 1' }).querySelector('.n')!.className).toBe('n accent')
    expect(within(house()).getByRole('link', { name: 'Systems, 9' }).querySelector('.n')!.className).toBe('n')
  })

  it('a zero count draws nothing', () => {
    renderAt(side({ counts: { needs: 0, proposals: 0, systems: 0, changes: 0 } }), '/')
    expect(house().querySelectorAll('.n')).toHaveLength(0)
    expect(within(house()).getByRole('link', { name: 'Needs you' })).toBeTruthy()
  })

  it('a count over 99 reads 99+ and its link’s name says the number', () => {
    renderAt(side({ counts: { ...COUNTS, needs: 120 } }), '/')
    const link = within(house()).getByRole('link', { name: 'Needs you, 120' })
    expect(link.querySelector('.n')!.textContent).toBe('99+')
  })

  it('a counted link draws its label and count as two words, in the order its name says them (2.5.3, axe label-content-name-mismatch)', () => {
    renderAt(side(), '/')
    const link = within(house()).getByRole('link', { name: 'Needs you, 3' })
    expect(link.textContent).toBe('Needs you 3')
  })

  it('Workspace lists its collections when Workspace or a child is current, else not', () => {
    const { unmount } = renderAt(side(), '/')
    expect(within(house()).queryByRole('link', { name: 'Projects' })).toBeNull()
    unmount()
    const at = renderAt(side(), '/workspace')
    expect(within(house()).getByRole('link', { name: 'Meetings' }).getAttribute('href')).toBe('/b/meetings')
    at.unmount()
    renderAt(side(), '/b/projects')
    const projects = within(house()).getByRole('link', { name: 'Projects' })
    expect(projects.getAttribute('aria-current')).toBe('page')
    expect(within(house()).getByRole('link', { name: 'Workspace' }).getAttribute('aria-current')).toBeNull()
    expect(within(house()).getByRole('link', { name: 'Workspace' }).classList.contains('on')).toBe(true)
    // the children follow Workspace, before Library
    const names = within(house()).getAllByRole('link').map(a => a.getAttribute('aria-label'))
    expect(names.slice(names.indexOf('Workspace'), names.indexOf('Library'))).toEqual(['Workspace', 'Meetings', 'Projects'])
  })

  // design pass 2026-11-04: what is unset shows without opening it
  it('draws a dashed dot beside an empty collection, with "empty" in its name, and no count', () => {
    renderAt(side({ collections: [...COLLECTIONS, { id: 'funding', label: 'Funding', href: '/b/funding', empty: true }] }), '/workspace')
    const funding = within(house()).getByRole('link', { name: 'Funding, empty' })
    expect(funding.getAttribute('href')).toBe('/b/funding')
    const dot = funding.querySelector('.side-dot')!
    expect(dot.getAttribute('aria-hidden')).toBe('true')
    expect(funding.querySelector('.n')).toBeNull()
    expect(funding.textContent).toBe('Funding')
    expect(within(house()).getByRole('link', { name: 'Meetings' }).querySelector('.side-dot')).toBeNull()
  })

  it('a member who pinned Workspace open sees its collections anywhere', () => {
    renderAt(side({ pinWorkspace: true }), '/')
    expect(within(house()).getByRole('link', { name: 'Meetings' })).toBeTruthy()
  })

  it('the Instance group is a collapsed disclosure at the bottom, absent when no instance board has records', () => {
    const { unmount } = renderAt(side(), '/')
    const toggle = within(house()).getByRole('button', { name: 'Instance' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(within(house()).queryByRole('link', { name: 'Crew' })).toBeNull()
    const all = [...house().querySelectorAll('a, button')]
    expect(all.at(-1)).toBe(toggle)
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(within(house()).getByRole('link', { name: 'Crew' }).getAttribute('href')).toBe('/b/crew')
    unmount()
    renderAt(side({ instance: [] }), '/')
    expect(within(house()).queryByRole('button', { name: 'Instance' })).toBeNull()
  })

  it('the foot has Public door, opening /door in a new tab, and the identity opening a menu: hats worn, Copy address, View as…', () => {
    renderAt(side(), '/')
    const door = screen.getByRole('link', { name: /^Public door/ })
    expect(door.getAttribute('href')).toBe('/door')
    expect(door.getAttribute('target')).toBe('_blank')
    expect(door.getAttribute('rel')).toContain('noopener')
    const who = screen.getByRole('button', { name: /Council steward/ })
    expect(who.textContent).toContain('0x9c1f…a04e')
    expect(who.textContent).toContain('hat 13.1')
    fireEvent.click(who)
    const menu = screen.getByRole('menu', { name: 'Signed in' })
    expect(within(menu).getByRole('group', { name: 'Hats worn' }).textContent).toContain('Ops')
    expect(within(menu).getByRole('menuitem', { name: 'Copy address' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'View as…' })).toBeTruthy()
  })

  it('Copy address copies the plain address and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderAt(side(), '/')
    fireEvent.click(screen.getByRole('button', { name: /Council steward/ }))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Copy address' })) })
    expect(writeText).toHaveBeenCalledWith(WHO.address)
  })

  it('a long org name truncates and keeps the full name in title', () => {
    const name = 'The Regenerative Finance Decentralised Autonomous Organisation'
    renderAt(side({ org: { name, mark: null } }), '/')
    const org = screen.getByRole('button', { name })
    const nm = org.querySelector('.side-org-nm')!
    expect(nm.getAttribute('title')).toBe(name)
    expect(nm.textContent).toBe(name)
  })

  it('Search or jump opens the palette', () => {
    const asked = vi.fn()
    window.addEventListener('open-palette', asked)
    renderAt(side(), '/')
    fireEvent.click(screen.getByRole('button', { name: /Search or jump/ }))
    expect(asked).toHaveBeenCalledTimes(1)
    window.removeEventListener('open-palette', asked)
  })
})

/** Sets the viewer from inside the provider, as the menu would. */
function PreviewPublic() {
  const { setViewer } = useViewer()
  return <button type="button" onClick={() => setViewer({ as: 'public' })}>preview</button>
}

const rail = (path = '/b/home') => renderAt(
  <ViewAsProvider>
    <Shell title="Example DAO" width={900} nav={side()} top={<TopBar />} band={<ViewAsBand />}><h1>Page</h1><PreviewPublic /></Shell>
  </ViewAsProvider>, path)

describe('the rail (§5.3)', () => {
  it('links are icon-only with their labels as names and as tooltips; counts as superscripts', () => {
    rail()
    const needs = within(house()).getByRole('link', { name: 'Needs you, 3' })
    expect(needs.querySelector('.side-l')).toBeNull()
    expect(needs.querySelector('.n')!.textContent).toBe('3')
    const tip = document.getElementById(needs.getAttribute('aria-describedby')!.split(' ').at(-1)!)!
    expect(tip.getAttribute('role')).toBe('tooltip')
    expect(tip.textContent).toBe('Needs you')
    expect(within(house()).getByRole('link', { name: 'Home' }).textContent).toBe('')
    expect(screen.getByRole('button', { name: 'Search or jump' }).textContent).not.toContain('Search or jump')
    expect(document.querySelector('[data-mode]')!.getAttribute('data-mode')).toBe('rail')
  })

  it('the toggle expands an overlay sidebar with a scrim; Esc closes it and focus returns to the toggle', () => {
    rail()
    fireEvent.click(screen.getByRole('button', { name: 'preview' }))
    const toggle = screen.getByRole('button', { name: 'Expand sidebar' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('.frame-scrim')).not.toBeNull()
    expect(document.querySelector('[data-overlay]')).not.toBeNull()
    expect(within(house()).getByRole('link', { name: 'Home' }).querySelector('.side-l')!.textContent).toBe('Home')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(document.querySelector('.frame-scrim')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
    // Esc closes panels, never the preview (§5.9)
    expect(screen.getByRole('status').textContent).toContain('Previewing as Public.')
  })

  it('clicking the scrim or following a link closes the overlay', () => {
    rail()
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    fireEvent.click(document.querySelector('.frame-scrim')!)
    expect(document.querySelector('[data-overlay]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    fireEvent.click(within(house()).getByRole('link', { name: 'Library' }))
    expect(document.querySelector('[data-overlay]')).toBeNull()
  })

  it('the identity is the hat glyph alone, still named', () => {
    rail()
    const who = screen.getByRole('button', { name: /Council steward/ })
    expect(who.querySelector('.who-w')!.className).toContain('sr-only')
  })
})

describe('the frame keeps working when storage throws (Review Focus 4)', () => {
  it('renders, unfolded, and the fold still toggles for the session', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    renderAt(<ViewAsProvider><Shell title="Example DAO" width={1440} nav={side()} top={<TopBar />}><h1>Page</h1><ViewAsControl /></Shell></ViewAsProvider>, '/')
    expect(document.querySelector('[data-mode]')!.getAttribute('data-mode')).toBe('sidebar')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(document.querySelector('[data-mode]')!.getAttribute('data-mode')).toBe('rail')
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(document.querySelector('[data-mode]')!.getAttribute('data-mode')).toBe('sidebar')
  })
})

describe('Changes in the sidebar and the rail (§5.6, ruling R-28)', () => {
  it('with something staged, a plain click opens the docked tray (house:open-changes) and stays on the page', () => {
    const asked = vi.fn()
    window.addEventListener('house:open-changes', asked)
    try {
      const { loc } = renderAt(side(), '/b/projects')
      const changes = within(house()).getByRole('link', { name: 'Changes, 1' })
      expect(changes.getAttribute('href')).toBe('/changes')
      fireEvent.click(changes)
      expect(asked).toHaveBeenCalledTimes(1)
      expect(loc.history).toEqual(['/b/projects'])
      // a modified click is the link's: a new tab or window, as any link
      expect(fireEvent.click(changes, { metaKey: true })).toBe(true)
      expect(asked).toHaveBeenCalledTimes(1)
    } finally { window.removeEventListener('house:open-changes', asked) }
  })

  it('with nothing staged (or previewing, which counts none) it is the page /changes', () => {
    const asked = vi.fn()
    window.addEventListener('house:open-changes', asked)
    try {
      const { loc } = renderAt(side({ counts: { ...COUNTS, changes: 0 } }), '/b/projects')
      fireEvent.click(within(house()).getByRole('link', { name: 'Changes' }))
      expect(asked).not.toHaveBeenCalled()
      expect(loc.history.at(-1)).toBe('/changes')
    } finally { window.removeEventListener('house:open-changes', asked) }
  })
})
