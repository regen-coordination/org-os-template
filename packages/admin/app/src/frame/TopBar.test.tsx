// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { TopBar } from './TopBar.tsx'
import { OrgSwitcher } from './OrgSwitcher.tsx'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { renderAt } from '../test/render.tsx'

afterEach(() => {
  vi.restoreAllMocks()
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.themeSwitching
  localStorage.removeItem('org-os-admin.theme')
})

describe('the top bar (§5.5)', () => {
  it('draws the path: ancestors are links, the current item is the last and is not', () => {
    renderAt(<ViewAsProvider><TopBar names={{ 'DR-2026-010': 'DR-2026-010' }} /></ViewAsProvider>, '/governance/proposals/DR-2026-010')
    const path = screen.getByRole('navigation', { name: 'Path' })
    const items = within(path).getAllByRole('listitem')
    expect(items.map(i => i.textContent)).toEqual(['Proposals', 'DR-2026-010'])
    expect(within(items[0]!).getByRole('link', { name: 'Proposals' }).getAttribute('href')).toBe('/governance/proposals')
    expect(within(items[1]!).queryByRole('link')).toBeNull()
    expect(items[1]!.querySelector('[aria-current="page"]')!.textContent).toBe('DR-2026-010')
  })

  it('trails with View as and the notifications button', () => {
    renderAt(<ViewAsProvider><TopBar /></ViewAsProvider>, '/')
    expect(screen.getByRole('button', { name: 'View as: you' })).toBeTruthy()
    const bell = screen.getByRole('button', { name: 'Notifications' })
    expect(bell.querySelector('.tb-dot')).toBeNull()
  })

  it('a moss dot says there are unread mentions, when the fixture says so', () => {
    renderAt(<ViewAsProvider><TopBar unread /></ViewAsProvider>, '/')
    const bell = screen.getByRole('button', { name: 'Notifications', description: 'Unread mentions' })
    expect(bell.querySelector('.tb-dot')).not.toBeNull()
  })

  it('the rail toggle is outside a frame a plain ghost button (no Shell: nothing to fold)', () => {
    renderAt(<ViewAsProvider><TopBar /></ViewAsProvider>, '/')
    expect(screen.getByRole('button', { name: 'Collapse sidebar' }).className).toContain('ghost')
  })
})

describe('the org switcher (§5.2 item 1)', () => {
  it('draws the neutral seal on solid when mark is null, never an image', () => {
    renderAt(<OrgSwitcher org={{ name: 'Example DAO', mark: null }} />)
    const org = screen.getByRole('button', { name: 'Example DAO' })
    const seal = org.querySelector('.side-seal')!
    expect(seal.querySelector('svg')).not.toBeNull()
    expect(org.querySelector('img')).toBeNull()
  })

  it('its menu holds Public door ↗ and Appearance: System, Light, Dark', () => {
    renderAt(<OrgSwitcher org={{ name: 'Example DAO', mark: null }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Example DAO' }))
    const menu = screen.getByRole('menu', { name: 'Example DAO' })
    const door = within(menu).getByRole('menuitem', { name: /^Public door/ })
    expect(door.getAttribute('href')).toBe('/door')
    expect(door.getAttribute('target')).toBe('_blank')
    const appearance = within(menu).getByRole('group', { name: 'Appearance' })
    expect(within(appearance).getAllByRole('menuitemradio').map(r => r.textContent)).toEqual(['System', 'Light', 'Dark'])
    expect(within(appearance).getByRole('menuitemradio', { name: 'System' }).getAttribute('aria-checked')).toBe('true')
  })

  it('choosing Dark sets data-theme="dark"; System removes it; each switch suppresses transitions for one frame', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { frames.push(cb); return frames.length })
    renderAt(<OrgSwitcher org={{ name: 'Example DAO', mark: null }} />)
    const root = document.documentElement
    fireEvent.click(screen.getByRole('button', { name: 'Example DAO' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }))
    expect(root.dataset.theme).toBe('dark')
    expect(root.hasAttribute('data-theme-switching')).toBe(true)
    frames.splice(0).forEach(f => f(0))
    expect(root.hasAttribute('data-theme-switching')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Example DAO' }))
    expect(screen.getByRole('menuitemradio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'System' }))
    expect(root.dataset.theme).toBeUndefined()
    expect(localStorage.getItem('org-os-admin.theme')).toBeNull()
  })

  it('shows the appearance that applies, even when the browser refuses to keep it (Review Focus 4)', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    renderAt(<OrgSwitcher org={{ name: 'Example DAO', mark: null }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Example DAO' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Light' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    fireEvent.click(screen.getByRole('button', { name: 'Example DAO' }))
    expect(screen.getByRole('menuitemradio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true')
  })

  it('a configured mark is drawn as the instance gave it', () => {
    renderAt(<OrgSwitcher org={{ name: 'Example DAO', mark: '/mark.svg' }} />)
    const img = screen.getByRole('button', { name: 'Example DAO' }).querySelector('img')!
    expect(img.getAttribute('src')).toBe('/mark.svg')
    expect(img.getAttribute('alt')).toBe('')
  })
})
