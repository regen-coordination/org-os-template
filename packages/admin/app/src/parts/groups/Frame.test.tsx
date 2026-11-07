// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import { Shell } from '../../design/Shell.tsx'
import Frame from './Frame.tsx'
import { renderAt } from '../../test/render.tsx'

describe('/parts/frame', () => {
  it('draws the sidebar at 1240 on Home and the rail at 900 previewing as Public, neither as the page’s main', () => {
    renderAt(<Frame />, '/parts/frame')
    const home = screen.getByRole('group', { name: 'Sidebar, on Home' })
    const rail = screen.getByRole('group', { name: 'Rail, previewing as Public' })
    expect(home.getAttribute('data-mode')).toBe('sidebar')
    expect(rail.getAttribute('data-mode')).toBe('rail')
    expect(screen.queryByRole('main')).toBeNull()
    // Home is current in its own location, not the page's
    expect(within(home).getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe('page')
    expect(within(home).getByRole('link', { name: 'Needs you, 3' })).toBeTruthy()
    expect(within(home).getByRole('link', { name: 'Meetings' })).toBeTruthy()
    // as Public: the band, the path to the proposal, and only what anyone may read counted
    expect(within(rail).getByRole('status').textContent).toContain('Previewing as Public.')
    expect(within(rail).getByRole('navigation', { name: 'Path' }).textContent).toBe('ProposalsDR-2026-010')
    expect(within(rail).getByRole('link', { name: 'Needs you' })).toBeTruthy()
    expect(within(rail).getByRole('link', { name: 'Systems, 7' })).toBeTruthy()
    expect(within(rail).getByRole('link', { name: 'Changes' })).toBeTruthy()
  })

  it('draws the phone with its More sheet open, in place: the phone bar, the bottom bar, the sheet', () => {
    renderAt(<Frame />, '/parts/frame')
    const phone = screen.getByRole('group', { name: 'Phone, More open' })
    expect(phone.getAttribute('data-mode')).toBe('phone')
    expect(phone.querySelector('.ptop-t')!.textContent).toBe('Home')
    const bottom = phone.querySelector('.bbar')!
    expect([...bottom.children].map(c => c.querySelector('.bbar-l')!.textContent)).toEqual(['Home', 'Needs you', 'Proposals', 'Workspace', 'More'])
    expect(within(bottom as HTMLElement).getByRole('link', { name: 'Needs you, 3' })).toBeTruthy()
    const sheet = within(phone).getByRole('dialog', { name: 'More' })
    expect(sheet.hasAttribute('open')).toBe(true)
    expect(within(sheet).getByRole('link', { name: 'Systems, 9' })).toBeTruthy()
    // the wider specimens have no bottom bar
    expect(screen.getByRole('group', { name: 'Sidebar, on Home' }).querySelector('.bbar')).toBeNull()
  })

  it('draws the palette searching “tre”, its empty line on “hatt”, and the key map, in place', () => {
    renderAt(<Frame />, '/parts/frame')
    const tre = screen.getByRole('group', { name: 'Palette, searching “tre”' })
    expect((within(tre).getByRole('combobox') as HTMLInputElement).value).toBe('tre')
    const groups = within(tre).getAllByRole('group').map(g => document.getElementById(g.getAttribute('aria-labelledby')!)!.textContent)
    expect(groups).toEqual(['Jump to', 'Records', 'Actions'])
    const first = within(tre).getAllByRole('option')[0]!
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(first.querySelector('mark')!.textContent).toBe('Tre')
    expect([...first.querySelectorAll('kbd')].map(k => k.textContent)).toEqual(['g', 't'])
    const hatt = screen.getByRole('group', { name: 'Palette, nothing matches' })
    expect(within(hatt).getByText('Nothing matches “hatt”. Try a section name, a record id or an address.')).toBeTruthy()
    const keys = screen.getByRole('group', { name: 'Key map' })
    expect(within(keys).getAllByRole('row').filter(r => r.parentElement?.tagName === 'TBODY').length).toBe(19) // with n, New board on Boards (DP-18)
    // in place: no modal, and the page's own palette is not opened
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
  })

  it('on a phone (the page’s own frame under 760) every specimen is drawn as the phone', () => {
    renderAt(<Shell title="Parts" width={390} nav={null}><Frame /></Shell>, '/parts/frame')
    for (const name of ['Sidebar, on Home', 'Rail, previewing as Public', 'Phone, More open'])
      expect(screen.getByRole('group', { name }).getAttribute('data-mode'), name).toBe('phone')
    const rail = screen.getByRole('group', { name: 'Rail, previewing as Public' })
    expect(rail.querySelector('.ptop-t')!.textContent).toBe('DR-2026-010')
    expect(within(rail).getByRole('status').textContent).toContain('Previewing as Public.')
  })
})
