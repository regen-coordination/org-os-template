// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/react'
import RegistryList from './RegistryList.tsx'
import AllRecords from './AllRecords.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, refuse } from '../test/data.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'

describe('RegistryList', () => {
  it('lists a collection by its schema order, each entry linking to its record page', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/registries/meetings': { name: 'meetings', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'm-1', title: 'Kick-off', date: '2026-10-01', participants: ['steward-a', 'ana'] }] },
      'GET /api/schemas/meetings': { 'x-order': ['id', 'title', 'date', 'participants'], properties: {} },
      'GET /api/registries': [{ name: 'meetings', kind: 'collection', count: 1 }] })
    renderAt(<RegistryList registry="meetings" title="Meetings" />)
    const table = await screen.findByRole('table', { name: 'Meetings' })
    // C9 (§14.1): a registry is a table view
    expect(table.className).toBe('tv-table')
    expect(within(table).getByRole('link', { name: 'm-1' }).getAttribute('href')).toBe('/r/meetings/m-1')
    expect(within(table).getByText('steward-a, ana')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'New' }).getAttribute('href')).toBe('/new/meetings')
  })

  it('draws no New while previewing (C-23)', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/registries/meetings': { name: 'meetings', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'm-1', title: 'Kick-off' }] },
      'GET /api/schemas/meetings': { 'x-order': ['id', 'title'], properties: {} },
      'GET /api/registries': [{ name: 'meetings', kind: 'collection', count: 1 }] })
    renderAt(<ViewAsProvider initial={{ as: 'members' }}><RegistryList registry="meetings" title="Meetings" /></ViewAsProvider>)
    await screen.findByRole('table', { name: 'Meetings' })
    expect(screen.queryByRole('link', { name: 'New' })).toBeNull()
  })

  it('offers New only where a section adds to the registry, not on every collection (C11)', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/registries/events': { name: 'events', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'e1', title: 'Launch' }] },
      'GET /api/schemas/events': { 'x-order': ['id', 'title'], properties: {} } })
    renderAt(<RegistryList registry="events" title="events" />)
    await screen.findByRole('table', { name: 'events' })
    expect(screen.queryByRole('link', { name: 'New' })).toBeNull()
  })

  it('shows a document registry as its YAML, read-only', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/registries/finances': { name: 'finances', kind: 'document', schemaVersion: '2.0', document: { treasury: { chain: 'optimism' } } },
      'GET /api/schemas/finances': { properties: {} },
      'GET /api/registries': [{ name: 'finances', kind: 'document', count: null }] })
    renderAt(<RegistryList registry="finances" title="finances" />)
    const well = await screen.findByLabelText('data/finances.yaml')
    expect(well.textContent).toBe('treasury:\n  chain: optimism\n')
    expect(well.className).toBe('mono-well') // C9: the YAML well (C8's), not 0.6's .yaml
    expect(screen.queryByRole('link', { name: 'New' })).toBeNull()
    // F-L3-3: a document has no path in the Hub yet, and says so (the editors table)
    expect(screen.getByRole('note').textContent).toBe('Read only here: a change to this file has no path in the Hub yet.')
  })

  it('says no such thing over a collection the Hub edits', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/registries/events': { name: 'events', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'e1', title: 'Launch' }] },
      'GET /api/schemas/events': { 'x-order': ['id', 'title'], properties: {} } })
    renderAt(<RegistryList registry="events" title="events" />)
    await screen.findByRole('table', { name: 'events' })
    expect(screen.queryByText(/no path in the Hub yet/)).toBeNull()
  })

  it("says why when the registry can't be read", async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/registries/nope': refuse(500, { error: 'unknown registry: nope' }), 'GET /api/schemas/nope': { properties: {} }, 'GET /api/registries': [] })
    renderAt(<RegistryList registry="nope" title="nope" />)
    expect(await screen.findByText('unknown registry: nope')).toBeTruthy()
  })

  it('lists an entry with no id as #<position>, and marks an id two entries share; both read-only', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/registries/meetings': { name: 'meetings', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'm-1' }, { title: 'Untitled' }, { id: 'm-2' }, { id: 'm-2' }] },
      'GET /api/schemas/meetings': { 'x-order': ['id', 'title'], properties: {} },
      'GET /api/registries': [{ name: 'meetings', kind: 'collection', count: 4 }] })
    renderAt(<RegistryList registry="meetings" title="Meetings" />)
    const table = await screen.findByRole('table', { name: 'Meetings' })
    expect(within(table).getByRole('link', { name: '#2' }).getAttribute('href')).toBe('/r/meetings/%232')
    expect(within(table).getAllByText('appears 2 times')).toHaveLength(2)
  })
})

describe('AllRecords', () => {
  // C9 (§14.1): a list of collections — a data row each, its kind and count in the second line
  it('lists every registry with its kind and count', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/registries': [{ name: 'assets', kind: 'collection', count: 3 }, { name: 'knowledge-manifest', kind: 'document', count: null }] })
    renderAt(<AllRecords />)
    const list = await screen.findByRole('list', { name: 'Registries' })
    const assets = within(list).getByRole('link', { name: /^assets/ })
    expect(assets.getAttribute('href')).toBe('/all/assets')
    expect(assets.querySelector('.drow-s')!.textContent).toBe('collection · 3 entries')
    expect(within(list).getByRole('link', { name: /^knowledge-manifest/ }).querySelector('.drow-s')!.textContent).toBe('document')
  })

  it('lists a private collection the server gives an admitted member, by name and count, naming no file (E-69, R-L5-14.5)', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 2 }, { name: 'payroll', kind: 'collection', count: 4 }] })
    renderAt(<AllRecords />)
    const list = await screen.findByRole('list', { name: 'Registries' })
    const payroll = within(list).getByRole('link', { name: /^payroll/ })
    expect(payroll.getAttribute('href')).toBe('/all/payroll')
    expect(payroll.querySelector('.drow-s')!.textContent).toBe('collection · 4 entries')
    expect(list.textContent).not.toMatch(/data\/|\.yaml/)
  })
})

describe('/all/<private> for anyone it does not admit', () => {
  it('is the unknown-registry page: the server answers it as no registry at all (E-69)', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/registries/payroll': refuse(404, { error: 'unknown registry: payroll' }), 'GET /api/schemas/payroll': refuse(404, { error: 'unknown registry: payroll' }),
      'GET /api/registries': [] })
    renderAt(<RegistryList registry="payroll" title="payroll" />, '/all/payroll')
    expect(await screen.findByRole('heading', { level: 1, name: 'No registry called “payroll” here.' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'All records' }).getAttribute('href')).toBe('/all')
    expect(document.body.textContent).not.toContain('unknown registry')
  })
})
