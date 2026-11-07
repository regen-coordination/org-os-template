// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import ReadOnlyNotice from './ReadOnly.tsx'
import { fetchRoutes } from './test/fetchRoutes.ts'
import { renderAt } from './test/render.tsx'
import { knownActor, refuse } from './test/data.ts'

// C9 (§14.1, ledger): the read-only notice is the band (§5.9 style, --solid): "Read only: your git address is not a
// member’s. Claim your handle →". 0.6 wrote a warn mark in a paragraph, "Read-only: your git email … matches no member's
// handles.git in data/members.yaml.", and its claim link was "Claim your handle".
const band = () => document.querySelector('.band.band-ro') as HTMLElement | null

describe('ReadOnlyNotice', () => {
  it('is the band, in plain words: your git address is not a member’s, and the claim', async () => {
    fetchRoutes({ 'GET /api/actor': { unknown: 'someone@example.org' } })
    renderAt(<ReadOnlyNotice />)
    await waitFor(() => expect(band()).not.toBeNull())
    expect(band()!.getAttribute('role')).toBe('status')
    expect(band()!.querySelector('.band-t')!.textContent).toBe('Read only: your git address is not a member’s. Claim your handle →')
    expect(band()!.querySelector('b')!.textContent).toBe('Read only:')
    // the address itself is the band's title (a hover, and said by nothing else), never in the sentence
    expect(band()!.getAttribute('title')).toBe('git: someone@example.org')
  })

  it('offers the claim wizard when git has an address no member holds, and not otherwise', async () => {
    fetchRoutes({ 'GET /api/actor': { unknown: 'someone@example.org' } })
    renderAt(<ReadOnlyNotice />)
    const claim = await screen.findByRole('link', { name: 'Claim your handle' })
    expect(claim.getAttribute('href')).toBe('/wizards/claim-handle')
    expect(claim.textContent).toBe('Claim your handle →')
  })

  it('offers no claim when git has no address to claim, and says what to set', async () => {
    fetchRoutes({ 'GET /api/actor': { unknown: '' } })
    const { qc } = renderAt(<ReadOnlyNotice />)
    await waitFor(() => expect(band()).not.toBeNull())
    expect(band()!.querySelector('.band-t')!.textContent).toBe('Read only: git has no address set here. Set user.email to one a member’s handles.git holds.')
    expect(band()!.querySelector('a')).toBeNull()
    expect(qc.getQueryData(['actor'])).toEqual({ unknown: '' })
  })

  it('says nothing for a member', async () => {
    fetchRoutes({ 'GET /api/actor': knownActor })
    const { container, qc } = renderAt(<ReadOnlyNotice />)
    await waitFor(() => expect(qc.getQueryData(['actor'])).toEqual(knownActor))
    expect(container.textContent).toBe('')
  })

  it('counts a failed answer as read-only, with the reason', async () => {
    fetchRoutes({ 'GET /api/actor': refuse(500, { error: 'git config failed' }) })
    renderAt(<ReadOnlyNotice />)
    await waitFor(() => expect(band()).not.toBeNull())
    expect(band()!.querySelector('.band-t')!.textContent).toBe('Read only: the server could not say who you are (git config failed).')
  })

  it('a signed-in member who wears no hat now reads the ruling\'s sentence (L9-O1), not the server\'s refusal wrapped in read-only', async () => {
    const ACCOUNT = 'eip155:42220:0x00000000000000000000000000000000000000a1'
    fetchRoutes({
      'GET /api/session': { mode: 'hosted', signedIn: true, actor: ACCOUNT, account: ACCOUNT, expiresAt: '2026-10-31T10:00:00.000Z', hats: [] },
      'GET /api/actor': refuse(401, { error: 'Sign in to see this: it is for members only.', code: 'SIGN_IN' }),
    })
    renderAt(<ReadOnlyNotice />)
    await waitFor(() => expect(band()?.querySelector('.band-t')?.textContent).toBe('You are signed in, but you wear no hat in this DAO now.'))
  })

  it('a session whose hats were never read (a restart, the tree down) reads the band, not NO_HAT (final review I1)', async () => {
    const ACCOUNT = 'eip155:42220:0x00000000000000000000000000000000000000a1'
    const said = 'Your hats could not be read for an hour; you see what anyone sees until they can be.'
    fetchRoutes({
      'GET /api/session': { mode: 'hosted', signedIn: true, actor: ACCOUNT, account: ACCOUNT, expiresAt: '2026-10-31T10:00:00.000Z', hats: [], unread: true, band: said },
      'GET /api/actor': refuse(401, { error: 'Sign in to see this: it is for members only.', code: 'SIGN_IN' }),
    })
    renderAt(<ReadOnlyNotice />)
    await waitFor(() => expect(band()?.querySelector('.band-t')?.textContent).toBe(said))
  })

  it('a session past the grace reads the §5.2 band, from the session', async () => {
    const ACCOUNT = 'eip155:42220:0x00000000000000000000000000000000000000a1'
    const said = 'Your hats could not be read for an hour; you see what anyone sees until they can be.'
    fetchRoutes({
      'GET /api/session': { mode: 'hosted', signedIn: true, actor: ACCOUNT, account: ACCOUNT, expiresAt: '2026-10-31T10:00:00.000Z', hats: [], stale: true, band: said },
      'GET /api/actor': refuse(401, { error: 'Sign in to see this: it is for members only.', code: 'SIGN_IN' }),
    })
    renderAt(<ReadOnlyNotice />)
    await waitFor(() => expect(band()?.querySelector('.band-t')?.textContent).toBe(said))
  })
})
