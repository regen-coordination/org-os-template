// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderAt } from '../test/render.tsx'
import { STARTED_AT } from '../session/accountSignIn.ts'
import AtmospherePage, { atmosphereNext } from './AtmospherePage.tsx'

// Certified's sign-in page offers "Sign in with Atmosphere" (ePDS `epds_handle_login_url`): the Bluesky handle typed
// there comes to /sign-in/atmosphere?handle=. That page never starts a round-trip (a round-trip starts by a click on a
// Hub page, final review of B8): it goes back to the Hub page the round-trip started from, the handle filled in, and
// the person clicks once more.

const NET = '/network-account?purpose=add-node&node=refi-x&return=https%3A%2F%2Fnetwork.example.org%2Frefi-x%2F'

beforeEach(() => { vi.stubGlobal('WebSocket', class { onmessage = null; close() {} }); sessionStorage.clear() })
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear() })

describe('atmosphereNext: where a handle typed on Certified\'s page goes', () => {
  it('back to the page the round-trip started from, with the handle', () => {
    const next = new URL(atmosphereNext(NET, 'refi-x.bsky.social'), 'https://hub.invalid')
    expect(next.pathname).toBe('/network-account')
    expect(Object.fromEntries(next.searchParams)).toEqual({ purpose: 'add-node', node: 'refi-x', return: 'https://network.example.org/refi-x/', handle: 'refi-x.bsky.social' })
  })

  it('a handle already on that page is replaced; an @ and spaces are dropped', () => {
    const next = new URL(atmosphereNext('/sign-in?handle=old.bsky.social', ' @new.bsky.social '), 'https://hub.invalid')
    expect(next.searchParams.getAll('handle')).toEqual(['new.bsky.social'])
  })

  it('only the three pages that start one: /sign-in, /network-account, /account-links; anything else is /sign-in', () => {
    expect(atmosphereNext('/account-links', 'a.bsky.social')).toBe('/account-links?handle=a.bsky.social')
    for (const stored of [null, '', '//evil.example/sign-in', 'https://evil.example/sign-in', '/sign-in/atmosphere?handle=x', '/proposals', '/sign-in\\x', 'javascript:alert(1)'])
      expect(atmosphereNext(stored, 'a.bsky.social')).toBe('/sign-in?handle=a.bsky.social')
  })

  it('no handle, or one too long to be one: the page alone', () => {
    expect(atmosphereNext('/account-links', null)).toBe('/account-links')
    expect(atmosphereNext(null, 'a'.repeat(300))).toBe('/sign-in')
  })
})

describe('/sign-in/atmosphere', () => {
  it('goes back to the Hub page the round-trip started from, the handle filled in, and starts nothing', async () => {
    sessionStorage.setItem(STARTED_AT, NET)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { loc } = renderAt(<AtmospherePage />, '/sign-in/atmosphere?handle=refi-x.bsky.social')
    expect(screen.getByText('Taking you back…')).toBeTruthy()
    await waitFor(() => expect(loc.history.at(-1)).toBe(atmosphereNext(NET, 'refi-x.bsky.social')))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('with nothing remembered (another tab, or storage off): the sign-in page with the handle', async () => {
    const { loc } = renderAt(<AtmospherePage />, '/sign-in/atmosphere?handle=me.bsky.social')
    await waitFor(() => expect(loc.history.at(-1)).toBe('/sign-in?handle=me.bsky.social'))
  })
})
