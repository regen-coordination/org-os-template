// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { away } from '../session/accountSignIn.ts'
import SignOutPage from './SignOutPage.tsx'

// refi-dao-os network app (final review of B8): signing out from another of the org's sites. The Hub's page ends the
// session (DELETE /api/session, which judges the return by I6) and goes where the Hub says.

beforeEach(() => { vi.stubGlobal('WebSocket', class { onmessage = null; close() {} }) })
afterEach(() => { vi.restoreAllMocks() })

describe('/sign-out', () => {
  it('ends the session and goes back where the Hub says', async () => {
    const go = vi.spyOn(away, 'go').mockImplementation(() => {})
    const back = 'https://network.example.org/refi-x/'
    const { calls } = fetchRoutes({
      'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': { mode: 'hosted', signIn: null, signedIn: false },
      [`DELETE /api/session?return=${encodeURIComponent(back)}`]: { next: back },
    })
    renderAt(<SignOutPage />, `/sign-out?return=${encodeURIComponent(back)}`)
    expect(await screen.findByText('Signing you out…')).toBeTruthy()
    await waitFor(() => expect(go).toHaveBeenCalledWith(back))
    expect(calls.some(c => c.method === 'DELETE')).toBe(true)
  })

  it('with no return: signed out, to the Hub\'s home', async () => {
    const go = vi.spyOn(away, 'go').mockImplementation(() => {})
    fetchRoutes({
      'GET /api/status': { org: 'Fixture Org' }, 'GET /api/session': { mode: 'hosted', signIn: null, signedIn: false },
      'DELETE /api/session': new Response(null, { status: 204 }),
    })
    renderAt(<SignOutPage />, '/sign-out')
    await waitFor(() => expect(go).toHaveBeenCalledWith('/'))
  })
})
