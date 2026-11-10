// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { SitesBar, SitesBarView } from './SitesBar.tsx'
import { renderAt } from '../test/render.tsx'

afterEach(() => vi.unstubAllGlobals())

const BAR = { label: 'Example Org', sites: [
  { label: 'Knowledge', href: 'https://knowledge.example.org', current: false, note: 'What we know' },
  { label: 'House', href: '/', current: true },
] }

describe('the sites bar', () => {
  it('names whose sites they are and lists them in order, the current one marked', () => {
    renderAt(<SitesBarView bar={BAR} />)
    const nav = screen.getByRole('navigation', { name: 'Example Org sites' })
    expect(nav.querySelector('.sites-org')!.textContent).toBe('Example Org')
    const links = within(nav).getAllByRole('link')
    expect(links.map(a => a.getAttribute('href'))).toEqual(['https://knowledge.example.org', '/'])
    expect(links[1]!.getAttribute('aria-current')).toBe('page')
    expect(links[0]!.hasAttribute('aria-current')).toBe(false)
  })
  it('opens a site elsewhere in its own tab and says so; a place in the house stays in it', () => {
    renderAt(<SitesBarView bar={BAR} />)
    const out = screen.getByRole('link', { name: 'Knowledge (opens in a new tab)' })
    expect(out.getAttribute('target')).toBe('_blank')
    expect(out.getAttribute('rel')).toBe('noopener noreferrer')
    expect(out.getAttribute('title')).toBe('What we know')
    expect(screen.getByRole('link', { name: 'House' }).hasAttribute('target')).toBe(false)
  })
  it('draws nothing with no sites, and is named plainly with no label', () => {
    const { container, rerender } = renderAt(<SitesBarView bar={{ label: null, sites: [] }} />)
    expect(container.querySelector('.sites')).toBeNull()
    rerender(<SitesBarView bar={{ label: null, sites: [BAR.sites[1]!] }} />)
    expect(screen.getByRole('navigation', { name: 'Sites' })).toBeTruthy()
  })
  it('reads the bar from the server, and draws nothing when the server has none to give', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(BAR), { status: 200, headers: { 'content-type': 'application/json' } })))
    const first = renderAt(<SitesBar />)
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Example Org sites' })).toBeTruthy())
    first.unmount()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } })))
    const { container } = renderAt(<SitesBar />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.querySelector('.sites')).toBeNull()
  })
})
