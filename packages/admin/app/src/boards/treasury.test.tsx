// @vitest-environment jsdom
// Treasury in the house (C6, §14.1). Replaces 0.6's Treasury, a section list alone (ledger C6): the board is the main
// Safe's System header, its balances by chain, the prepared transactions that wait, and the decisions that moved
// money; the treasury's Systems stay listed under them. The fund flow (C12, Q59) is between the prepared cards and the
// decisions: blocks/fundflow.test.tsx draws it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { BoardPage } from './Board.tsx'
import { builtinBoard } from '../test/builtinBoards.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { SYSTEMS_UNREAD, baseRoutes, resource } from '../test/data.ts'
import { BlockFrame } from '../blocks/BlockFrame.tsx'
import { balancesBlock } from '../blocks/index.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { FIXED_NOW } from '../test/fixtures/parts.ts'
import { ACTOR, PAY_KIT, PROPOSAL_RESOURCES, RETURN_DECIDED, daysFrom } from '../test/fixtures/house/governance.ts'
import { SYSTEMS, TREASURY_SYSTEM } from '../test/fixtures/house/systems.ts'
import type { ProposalView } from '../api.ts'

const RETURNED = { ...RETURN_DECIDED, state: 'ratified', derived: 'ratified', closed: { at: daysFrom(-1), by: 'steward-a', decision: null } } as unknown as ProposalView
const routes = (over: Record<string, unknown> = {}) => fetchRoutes({
  ...baseRoutes({ 'GET /api/actor': { id: ACTOR, name: 'Council steward', kind: 'person' } }),
  'GET /api/resources': [...SYSTEMS, ...PROPOSAL_RESOURCES], 'GET /api/proposals': [PAY_KIT, RETURNED], 'GET /api/jobs': [],
  'GET /api/registries/systems': { name: 'systems', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'treasury', kind: 'safe', section: 'organization/treasury' }] },
  ...over,
})
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(FIXED_NOW) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Treasury', () => {
  it('is the balances, the prepared transactions, the fund flow, the decisions that moved money, and the treasury’s Systems', () => {
    expect(builtinBoard('treasury').blocks.map(b => b.type)).toEqual(['balances', 'prepared', 'fundflow', 'recently', 'list'])
  })

  it('heads the board with the main Safe’s System header and its read as the from mark', async () => {
    routes()
    renderAt(<BoardPage id="treasury" />, '/b/treasury')
    const head = await waitFor(() => { const h = document.querySelector('header.rh-sys'); expect(h).not.toBeNull(); return h as HTMLElement })
    expect(within(head).getByRole('heading', { level: 1, name: 'Treasury' })).toBeTruthy()
    expect(head.querySelector('.rh-eyebrow')!.textContent).toBe('Safe · System')
    expect(head.textContent).toContain('4 of 8 signers')
    expect(head.querySelector('.from')!.textContent).toMatch(/^from Treasury · read 4.min ago/)
    expect(within(head).getByRole('link', { name: /Open in Safe/ })).toBeTruthy()
  })

  it('draws the balances by chain in a table view, each amount an amount (§7.7)', async () => {
    routes()
    renderAt(<BoardPage id="treasury" />, '/b/treasury')
    const table = await screen.findByRole('table', { name: 'Balances' })
    const row = within(table).getAllByRole('row')[1]!
    expect([...row.querySelectorAll('td')].map(td => td.textContent)).toEqual(['Celo', 'USDGLO', '3,100.00 USDGLO'])
  })

  it('draws the prepared transaction that waits on signers as its card, saying the Hub never signs', async () => {
    routes()
    renderAt(<BoardPage id="treasury" />, '/b/treasury')
    const part = await screen.findByRole('region', { name: 'Waiting on signers · 1' })
    expect(within(part).getByText('The Hub never signs. Signers review and sign this in the Safe app.')).toBeTruthy()
    expect(part.textContent).toContain('2 of 4')
  })

  it('lists the decisions that moved money as data rows', async () => {
    routes()
    renderAt(<BoardPage id="treasury" />, '/b/treasury')
    const part = await screen.findByRole('region', { name: 'Decisions that moved money' })
    const row = await within(part).findByRole('link', { name: /Return the Gardens pools to the treasury/ })
    expect(row.getAttribute('href')).toBe(`/r/proposal/${RETURNED.id}`)
  })

  it('is about the Safe that was read when a Safe that could not be read ties with it (walk 2026-11-04, L4c-fix 1)', async () => {
    const reserve = { ...TREASURY_SYSTEM, id: 'system:reserve', name: 'Reserve', source: { ...TREASURY_SYSTEM.source!, entityId: 'reserve' },
      facts: { ...TREASURY_SYSTEM.facts, driver: { ok: false, state: 'failed', readAt: null, error: 'safe service answered 503', facts: {}, sections: [] } } }
    routes({ 'GET /api/resources': [reserve, TREASURY_SYSTEM], 'GET /api/proposals': [] })
    renderAt(<BoardPage id="treasury" />, '/b/treasury')
    const head = await waitFor(() => { const h = document.querySelector('header.rh-sys'); expect(h).not.toBeNull(); return h as HTMLElement })
    expect(within(head).getByRole('heading', { level: 1, name: 'Treasury' })).toBeTruthy()
    const table = await screen.findByRole('table', { name: 'Balances' })
    expect([...table.querySelectorAll('tbody td')].map(td => td.textContent)).toEqual(['Celo', 'USDGLO', '3,100.00 USDGLO'])
  })

  it('lists a transaction the Safe reads as waiting on signers, though no proposal prepared it (walk 2026-11-04, L4c-fix 1)', async () => {
    routes({ 'GET /api/resources': [...SYSTEMS], 'GET /api/proposals': [] })
    renderAt(<BoardPage id="treasury" />, '/b/treasury')
    const part = await screen.findByRole('region', { name: 'Waiting on signers · 1' })
    expect(part.textContent).toContain('nonce 18')
    expect(part.textContent).toContain('2 of 4 signatures')
    expect(within(part).getByText('The Hub never signs. Signers review and sign this in the Safe app.')).toBeTruthy()
    expect(screen.queryByText('No prepared transaction waits on signers.')).toBeNull()
  })

  it('draws a transaction the proposal prepared once, not again as the Safe’s read of it (walk 2026-11-04, L4c-fix 1)', async () => {
    routes()
    renderAt(<BoardPage id="treasury" />, '/b/treasury')
    const part = await screen.findByRole('region', { name: 'Waiting on signers · 1' })
    expect(part.querySelectorAll('.ptx').length).toBe(1)
    expect(part.querySelectorAll('.drow').length).toBe(0)
  })

  it('previewing as a hat that may not see the Safe, its prepared card is not drawn (E-39)', async () => {
    const hidden = { ...TREASURY_SYSTEM, facts: { ...TREASURY_SYSTEM.facts, visibility: 'hat:treasury' } }
    routes({ 'GET /api/resources': [...SYSTEMS.map(r => (r.id === TREASURY_SYSTEM.id ? hidden : r)), ...PROPOSAL_RESOURCES] })
    renderAt(<ViewAsProvider initial={{ as: 'hat', hat: 'ops', name: 'Ops' }}><BoardPage id="treasury" /></ViewAsProvider>, '/b/treasury')
    expect(await screen.findByText('No prepared transaction waits on signers.')).toBeTruthy()
    expect(screen.queryByText(/The Hub never signs/)).toBeNull()
  })
})

// review I-2's follow-up: the main Safe is the one data/systems.yaml places in the treasury; until it answered, none is
describe('the balances block before data/systems.yaml answered', () => {
  const read = (amount: string) => ({ ok: true, readAt: FIXED_NOW.toISOString(), facts: {}, open: null,
    sections: [{ title: 'Balances', rows: [{ cells: ['Celo', 'USDGLO', amount] }] }] })
  const safe = (id: string, name: string, amount: string) => resource({ id: `system:${id}`, kind: 'system', name, status: null,
    facts: { kind: 'safe', driver: read(amount) }, source: { path: 'data/systems.yaml', editable: true, registry: 'systems', entityId: id } })
  // the treasury's Safe is placed by its entry alone; the other Safe would be picked first by name without it
  const both = [safe('main', 'Main Safe', '3100'), safe('side', 'A side Safe', '5')]
  for (const [what, answer] of SYSTEMS_UNREAD) {
    it(`draws no Safe's balances while data/systems.yaml ${what}: loading, then the read's error`, async () => {
      const { calls } = fetchRoutes({ ...baseRoutes(), 'GET /api/resources': both, 'GET /api/registries/systems': answer })
      renderAt(<BlockFrame def={balancesBlock} id="b" cfg={{ title: 'Balances' }} />)
      await waitFor(() => expect(calls.some(c => c.path === '/api/resources')).toBe(true))
      await new Promise(r => setTimeout(r, 30))
      const block = document.querySelector('[data-block="b"]')!
      expect(block.querySelector('table')).toBeNull()
      expect(block.getAttribute('data-state')).toBe(what === 'could not be read' ? 'error' : 'loading')
      if (what === 'could not be read') expect(block.textContent).toContain('data/systems.yaml cannot be read')
    })
  }
})

// The balances block from the Safe driver's reads. A Safe read from the chain, because the Safe Transaction Service did
// not answer (L7-D15): the chain says nothing of its balances, so they are not known, never none (review I-2; L7's rule
// for signatures, as the fund flow's TRANSFERS_UNREAD says of transfers).
describe('the balances block, as the Safe driver reads a Safe', () => {
  const safe = (driver: Record<string, unknown>) => resource({ id: 'system:main', kind: 'system', name: 'Main Safe', status: null,
    facts: { kind: 'safe', driver: { ok: true, readAt: FIXED_NOW.toISOString(), open: null, ...driver } },
    source: { path: 'data/systems.yaml', editable: true, registry: 'systems', entityId: 'main' } })
  const draw = (main: ReturnType<typeof safe>) => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/resources': [main],
      'GET /api/registries/systems': { name: 'systems', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'main', kind: 'safe', section: 'organization/treasury' }] } })
    renderAt(<BlockFrame def={balancesBlock} id="b" cfg={{ title: 'Balances' }} />)
  }
  const block = () => document.querySelector('[data-block="b"]')!
  const signers = { title: 'Signers', note: '2 of 3 needed', rows: [] }

  // a single-chain read writes [token, amount] (safe.ts readOne); its chain is the read's network, as the several-chain
  // rows name theirs (review I-3)
  it('one chain read from the service: each row in its columns, its chain the read\'s network', async () => {
    draw(safe({ facts: { chain: 'eip155:42220', network: 'Celo' },
      sections: [{ title: 'Balances', note: '2 tokens', rows: [{ cells: ['USDGLO', '3100'] }, { cells: ['CELO', '12.5'] }] }, signers] }))
    const table = await screen.findByRole('table', { name: 'Balances' })
    const rows = [...table.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent))
    expect(rows).toEqual([['Celo', 'USDGLO', '3,100.00\u00a0USDGLO'], ['Celo', 'CELO', '12.50\u00a0CELO']])
  })

  it('one chain: says its balances are not known, and draws no table', async () => {
    draw(safe({ facts: { chain: 'eip155:42220', network: 'Celo', source: 'chain' }, sections: [signers] }))
    await waitFor(() => expect(block().getAttribute('data-state')).toBe('unavailable'))
    expect(block().textContent).toContain('Balances on Celo are not known: the Safe Transaction Service did not answer, so the Safe was read from the chain.')
    expect(block().querySelector('table')).toBeNull()
  })

  it('several chains: keeps the other chains’ balances, and says which chains’ are not known', async () => {
    draw(safe({
      facts: { chain: 'eip155:1', network: 'Ethereum', chains: [
        { chain: 'eip155:1', network: 'Ethereum', ok: true, pending: 0 },
        { chain: 'eip155:100', network: 'Gnosis', ok: true, source: 'chain' },
        { chain: 'eip155:42220', network: 'Celo', ok: true, source: 'chain' },
      ] },
      sections: [{ title: 'Balances', rows: [{ cells: ['Ethereum', 'ETH', '1.5'] }] }, signers],
    }))
    const table = await screen.findByRole('table', { name: 'Balances' })
    expect([...table.querySelectorAll('tbody td')].map(td => td.textContent)).toEqual(['Ethereum', 'ETH', '1.50\u00a0ETH'])
    expect(block().textContent).toContain('Balances on Gnosis and Celo are not known: the Safe Transaction Service did not answer, so the Safe was read from the chain.')
  })

  it('several chains, each read from the chain: not known, not "Nothing here yet."', async () => {
    draw(safe({
      facts: { chain: 'eip155:1', network: 'Ethereum', chains: [
        { chain: 'eip155:1', network: 'Ethereum', ok: true, source: 'chain' },
        { chain: 'eip155:42220', network: 'Celo', ok: true, source: 'chain' },
      ] },
      sections: [{ title: 'Balances', rows: [] }, signers],
    }))
    await waitFor(() => expect(block().getAttribute('data-state')).toBe('unavailable'))
    expect(block().textContent).toContain('Balances on Ethereum and Celo are not known')
    expect(block().textContent).not.toContain('Nothing here yet.')
  })
})
