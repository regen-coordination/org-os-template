// @vitest-environment jsdom
// The Treasury's fund flow (C12; rulings Q59, E-85; spec §9.8): where the main Safe's value went in the last 90 days,
// from the Safe driver's transfers read and the prepared calls that wait, on the Treasury board.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { BoardPage } from '../boards/Board.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, refuse } from '../test/data.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { FIXED_NOW } from '../test/fixtures/parts.ts'
import { ACTOR, PAY_KIT, PROPOSAL_RESOURCES } from '../test/fixtures/house/governance.ts'
import { NETWORK_PROJECTS, SYSTEMS, TREASURY_SYSTEM } from '../test/fixtures/house/systems.ts'
import { fakeAddress } from '../test/fixtures/house/org.ts'
import { TRANSFER_WINDOW_DAYS } from '../../../server/systems/safe-transfers.ts'
import type { Resource } from '../api.ts'
import { FLOW_WINDOW_WORDS, TRANSFERS_UNREAD } from './fundflow.tsx'

const plain = (s: string | null | undefined) => (s ?? '').replace(/ /g, ' ')
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const withTransfers = (transfers: unknown): Resource => {
  const driver = TREASURY_SYSTEM.facts.driver as { facts: Record<string, unknown> }
  return { ...TREASURY_SYSTEM, facts: { ...TREASURY_SYSTEM.facts, driver: { ...driver, facts: { ...driver.facts, transfers } } } }
}
const routes = (systems: Resource[] = SYSTEMS, over: Record<string, unknown> = {}) => fetchRoutes({
  ...baseRoutes({ 'GET /api/actor': { id: ACTOR, name: 'Council steward', kind: 'person' } }),
  'GET /api/resources': [...systems, ...PROPOSAL_RESOURCES], 'GET /api/proposals': [PAY_KIT], 'GET /api/jobs': [],
  'GET /api/registries/systems': { name: 'systems', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'treasury', kind: 'safe', section: 'organization/treasury' }] },
  ...over,
})
const swap = (r: Resource) => SYSTEMS.map(s => (s.id === r.id ? r : s))
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(FIXED_NOW) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('the fund flow block', () => {
  it('says its window as the Safe driver reads it', () => {
    expect(FLOW_WINDOW_WORDS).toBe(`the last ${TRANSFER_WINDOW_DAYS} days`)
  })

  it("draws the Treasury's transfers in and out, named by the Systems at their addresses, and the prepared call that waits", async () => {
    routes()
    renderAt(<BoardPage id="treasury" />, '/b/treasury')
    const part = await screen.findByRole('region', { name: /^Fund flow/ })
    const rows = within(within(part).getByRole('list', { name: 'Fund flow, the last 90 days' })).getAllByRole('listitem').map(li => plain(li.textContent))
    expect(rows).toEqual([
      'Ops wallet → Treasury · 2,500.00 USDGLO · Executed',
      'Treasury → Network Projects · 1,271.00 USDGLO · Executed',
      `${short(fakeAddress(61))} → Treasury · 412.00 USDGLO · Executed`,
      `Treasury → ${short(fakeAddress(19))} · 1,271.00 CELO · Prepared`,
    ])
    const img = within(part).getByRole('img')
    expect(plain(img.querySelector('title')!.textContent)).toMatch(/^In the last 90 days: 2,500\.00 USDGLO from Ops wallet to Treasury, executed; /)
    expect(part.textContent).toContain('the last 90 days')
  })

  it('a counterparty System the viewer may not see is not named: its address is', async () => {
    const hidden = { ...NETWORK_PROJECTS, facts: { ...NETWORK_PROJECTS.facts, visibility: 'hat:treasury' } }
    routes(swap(hidden))
    renderAt(<ViewAsProvider initial={{ as: 'hat', hat: 'ops', name: 'Ops' }}><BoardPage id="treasury" /></ViewAsProvider>, '/b/treasury')
    const part = await screen.findByRole('region', { name: /^Fund flow/ })
    expect(part.textContent).not.toContain('Network Projects')
    expect(part.textContent).toContain(`Treasury → ${short(fakeAddress(72))}`)
  })

  it('is not drawn for a viewer who may not see the Safe (E-39)', async () => {
    routes(swap({ ...TREASURY_SYSTEM, facts: { ...TREASURY_SYSTEM.facts, visibility: 'hat:treasury' } }))
    renderAt(<ViewAsProvider initial={{ as: 'hat', hat: 'ops', name: 'Ops' }}><BoardPage id="treasury" /></ViewAsProvider>, '/b/treasury')
    await screen.findByText('No prepared transaction waits on signers.')
    expect(screen.queryByRole('region', { name: /^Fund flow/ })).toBeNull()
    expect(document.querySelector('.ff')).toBeNull()
  })

  it('says no error to a viewer who may not see the Safe: the gate comes first (M-2)', async () => {
    routes(swap({ ...TREASURY_SYSTEM, facts: { ...TREASURY_SYSTEM.facts, visibility: 'hat:treasury' } }),
      { 'GET /api/proposals': refuse(500, { error: 'the ledger cannot be read' }) })
    renderAt(<ViewAsProvider initial={{ as: 'hat', hat: 'ops', name: 'Ops' }}><BoardPage id="treasury" /></ViewAsProvider>, '/b/treasury')
    await waitFor(() => expect(document.querySelector('[data-block="balances"]')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('[data-block="prepared"]')?.getAttribute('data-state')).toBe('error'))
    expect(document.querySelector('[data-block="flow"]')).toBeNull()
  })

  it('is no block when nothing moved in the window, not even with a prepared call waiting', async () => {
    routes(swap(withTransfers([])))
    renderAt(<BoardPage id="treasury" />, '/b/treasury')
    await screen.findByRole('region', { name: 'Waiting on signers · 1' })
    await waitFor(() => expect(document.querySelector('[data-block="balances"]')).not.toBeNull())
    expect(document.querySelector('[data-block="flow"]')).toBeNull()
  })

  it('transfers the read could not give are said, not drawn', async () => {
    routes(swap(withTransfers(null)))
    renderAt(<BoardPage id="treasury" />, '/b/treasury')
    const part = await screen.findByRole('region', { name: /^Fund flow/ })
    expect(part.textContent).toContain(TRANSFERS_UNREAD)
    expect(part.querySelector('.ff')).toBeNull()
  })
})
