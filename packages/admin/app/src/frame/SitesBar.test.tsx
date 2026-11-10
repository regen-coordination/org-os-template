// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { SitesBar, SitesBarView } from './SitesBar.tsx'
import { renderAt } from '../test/render.tsx'

afterEach(() => vi.unstubAllGlobals())

const BAR = { label: 'Example Org', sites: [
  { label: 'Knowledge', href: 'https://knowledge.example.org', current: false, note: 'What we know' },
  { label: 'House', href: '/', current: true },
] }

const THEMES = [
  { id: 'dawn', label: 'Dawn', scheme: 'light' as const, note: 'Soft morning light' },
  { id: 'deep', label: 'Deep', scheme: 'dark' as const },
]
const root = document.documentElement
afterEach(() => { delete root.dataset.theme; delete root.dataset.orgTheme; localStorage.clear() })

describe('the sites bar', () => {
  it('draws the lockup: whose sites they are with a way home, then the site this house is', () => {
    renderAt(<SitesBarView bar={BAR} />)
    const nav = screen.getByRole('navigation', { name: 'Example Org sites' })
    const home = within(nav).getByRole('link', { name: 'Example Org: home' })
    expect(home.getAttribute('href')).toBe('/')
    expect(home.querySelector('.sites-org')!.textContent).toBe('Example Org')
    expect(home.querySelector('.sites-mark')!.getAttribute('aria-hidden')).toBe('true')
    const summary = nav.querySelector('.sites-switch > summary')!
    expect(summary.getAttribute('aria-label')).toBe('Example Org sites: you are on House')
    expect(summary.querySelector('.sites-here')!.textContent).toBe('House')
  })
  it('lists the sites in order in the switcher, the current one marked and lit, each with its note', () => {
    renderAt(<SitesBarView bar={BAR} />)
    const links = [...document.querySelectorAll<HTMLAnchorElement>('.sites-panel .sites-a')]
    expect(links.map(a => a.getAttribute('href'))).toEqual(['https://knowledge.example.org', '/'])
    expect(links[1]!.getAttribute('aria-current')).toBe('page')
    expect(links[0]!.hasAttribute('aria-current')).toBe(false)
    expect(links[1]!.querySelector('.sites-dot')!.classList.contains('lit')).toBe(true)
    expect(links[0]!.querySelector('.sites-dot')!.classList.contains('lit')).toBe(false)
    expect(links[0]!.querySelector('.sites-note')!.textContent).toBe('What we know')
    expect(links[1]!.querySelector('.sites-note')).toBeNull()
  })
  it('opens a site elsewhere in its own tab and says so; a place in the house stays in it', () => {
    renderAt(<SitesBarView bar={BAR} />)
    const out = screen.getByRole('link', { name: /^Knowledge\s*What we know \(opens in a new tab\)$/ })
    expect(out.getAttribute('target')).toBe('_blank')
    expect(out.getAttribute('rel')).toBe('noopener noreferrer')
    expect(out.querySelector('.sites-out')!.getAttribute('aria-hidden')).toBe('true')
    expect(document.querySelector('.sites-panel .sites-a[aria-current]')!.hasAttribute('target')).toBe(false)
  })
  it('closes the switcher on Escape and on a click outside it', () => {
    renderAt(<SitesBarView bar={BAR} />)
    const d = document.querySelector<HTMLDetailsElement>('.sites-switch')!
    d.open = true
    fireEvent.keyDown(d, { key: 'Escape' })
    expect(d.open).toBe(false)
    d.open = true
    fireEvent.click(document.body)
    expect(d.open).toBe(false)
  })
  it('draws nothing with no sites; with no label it is named plainly, has no way home, and no current site says Sites', () => {
    const { container, rerender } = renderAt(<SitesBarView bar={{ label: null, sites: [] }} />)
    expect(container.querySelector('.sites')).toBeNull()
    rerender(<SitesBarView bar={{ label: null, sites: [{ ...BAR.sites[1]!, current: false }] }} />)
    const nav = screen.getByRole('navigation', { name: 'Sites' })
    expect(nav.querySelector('.sites-home')).toBeNull()
    expect(nav.querySelector('.sites-here')!.textContent).toBe('Sites')
    expect(nav.querySelector('.sites-switch > summary')!.getAttribute('aria-label')).toBe('Sites')
  })
  it('with no instance themes, one button turns the house light or dark', () => {
    root.dataset.theme = 'dark'
    renderAt(<SitesBarView bar={BAR} />)
    const b = screen.getByRole('button', { name: 'Switch to the light theme' })
    expect(b.textContent).toBe('Light')
    fireEvent.click(b)
    expect(root.dataset.theme).toBe('light')
    expect(root.dataset.orgTheme).toBeUndefined()
  })
  it('with instance themes, offers them under Auto; a pick sets the theme and its scheme, and Auto hands back', async () => {
    renderAt(<SitesBarView bar={BAR} themes={THEMES} />)
    const face = document.querySelector<HTMLButtonElement>('button.sites-theme')!
    expect(face.querySelector('.sites-theme-nm')!.textContent).toBe('Auto')
    fireEvent.click(face)
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map(i => i.querySelector('span')!.textContent)).toEqual(['Auto', 'Dawn', 'Deep'])
    expect(items[0]!.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(items[1]!)
    expect(root.dataset.orgTheme).toBe('dawn')
    expect(root.dataset.theme).toBe('light')
    expect(localStorage.getItem('org-os-admin.org-theme')).toBe('dawn:light')
    await waitFor(() => expect(document.querySelector('.sites-theme-nm')!.textContent).toBe('Dawn'))
    fireEvent.click(document.querySelector<HTMLButtonElement>('button.sites-theme')!)
    fireEvent.click(screen.getAllByRole('menuitemradio')[0]!)
    expect(root.dataset.orgTheme).toBeUndefined()
    expect(root.dataset.theme).toBeUndefined()
    expect(localStorage.getItem('org-os-admin.org-theme')).toBeNull()
    await waitFor(() => expect(document.querySelector('.sites-theme-nm')!.textContent).toBe('Auto'))
  })
  it('reads the bar and the themes from the server, and draws nothing when the server has no bar to give', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes('/themes') ? { themes: THEMES } : BAR), { status: 200, headers: { 'content-type': 'application/json' } })))
    const first = renderAt(<SitesBar />)
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Example Org sites' })).toBeTruthy())
    await waitFor(() => expect(document.querySelector('.sites-theme-nm')).not.toBeNull())
    first.unmount()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } })))
    const { container } = renderAt(<SitesBar />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.querySelector('.sites')).toBeNull()
  })
})
