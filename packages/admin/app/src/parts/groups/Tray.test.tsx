// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import TrayGroup from './Tray.tsx'
import { Shell } from '../../design/Shell.tsx'
import { renderAt } from '../../test/render.tsx'

describe('/parts/tray', () => {
  it('draws the expanded change with a stale op, collapsed, stale, applying, and the discard question, from fixtures', () => {
    renderAt(<TrayGroup />, '/parts/tray')
    const x = screen.getByRole('group', { name: 'Changes, expanded' })
    const panel = within(x).getByRole('group', { name: 'Your change' })
    expect(within(panel).getByText('3 ops · 2 records')).toBeTruthy()
    expect(within(panel).getAllByRole('listitem')).toHaveLength(3)
    expect(within(panel).getByText('trunk now: 8')).toBeTruthy()
    expect(within(panel).getByText('Council consent decides this · 4 of 8')).toBeTruthy()
    const collapsed = screen.getByRole('group', { name: 'Changes, collapsed' })
    expect(within(collapsed).getByText('2 staged changes')).toBeTruthy()
    expect(within(collapsed).getAllByRole('button').map(b => b.textContent)).toEqual(['Review', 'Apply'])
    const stale = screen.getByRole('group', { name: 'Changes, stale' })
    expect(stale.querySelector('.tray-cnt.attn')!.textContent).toBe('!')
    expect(within(stale).getByText('1 op changed on the trunk — choose what stands')).toBeTruthy()
    const applying = screen.getByRole('group', { name: 'Changes, applying' })
    expect(within(applying).getByText('Applying…')).toBeTruthy()
    expect(within(applying).queryAllByRole('button')).toEqual([])
    const ask = screen.getByRole('dialog', { name: 'Discard 3 staged ops?' })
    expect(ask.hasAttribute('open')).toBe(true)
    expect(within(ask).getAllByRole('button').map(b => b.textContent)).toEqual(['Keep them', 'Discard'])
    // drawn in place: no region named Changes (the dock's own), no live tray
    expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull()
  })

  it('draws sign-in from fixtures: the idle card with the tree, then waiting, signed in, not a member and failed (§11.4)', () => {
    renderAt(<TrayGroup />, '/parts/tray')
    const idle = screen.getByRole('group', { name: 'Sign-in, idle' })
    const card = within(idle).getByRole('group', { name: 'Sign in with your wallet' })
    expect(card.querySelector('.signin-k')!.textContent).toBe('Example DAO · members')
    expect(card.querySelector('.signin-p')!.textContent).toContain('Your role is the hat you wear in tree #13.')
    expect(within(card).getAllByRole('button').map(b => b.textContent)).toEqual(['Sign in with Ethereum'])
    const state = (name: string) => screen.getByRole('group', { name: `Sign-in, ${name}` })
    expect(within(state('waiting')).getByText('Waiting for your wallet to sign…')).toBeTruthy()
    expect(within(state('waiting')).getAllByRole('button').map(b => b.textContent)).toEqual(['Cancel'])
    expect(state('signed in').querySelector('.who-t')!.textContent).toBe('Council steward · Treasury signer')
    expect(state('signed in').querySelector('.who-s')!.textContent).toMatch(/^0x[0-9a-f]{4}…[0-9a-f]{4} · 2 hats$/)
    expect(within(state('not a member')).getByRole('link', { name: 'Read the public door' }).getAttribute('href')).toBe('/door')
    expect(state('failed').querySelector('.note-error')!.textContent).toBe('Signing in did not work.')
    expect(within(state('failed')).getAllByRole('button').map(b => b.textContent)).toEqual(['Try again'])
  })

  it('on a phone, the bars are the phone’s cards: the count and "N staged" lead to /changes, then the primary only', () => {
    renderAt(<Shell title="Parts" nav={null} width={390}><TrayGroup /></Shell>, '/parts/tray')
    const collapsed = screen.getByRole('group', { name: 'Changes, collapsed' })
    expect(within(collapsed).getByRole('link', { name: 'Review 2 staged changes' }).getAttribute('href')).toBe('/changes')
    expect(within(collapsed).getAllByRole('button').map(b => b.textContent)).toEqual(['Apply'])
  })
})
