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

  // DAO-OS L6 Task 19: a document is edited whole in the source editor; it no longer says it has no path in the Hub
  it('shows a document registry as its YAML, and links to the source editor that edits it whole', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/registries/finances': { name: 'finances', kind: 'document', schemaVersion: '2.0', document: { treasury: { chain: 'optimism' } } },
      'GET /api/schemas/finances': { properties: {} },
      'GET /api/registries': [{ name: 'finances', kind: 'document', count: null }] })
    renderAt(<RegistryList registry="finances" title="finances" />)
    const well = await screen.findByLabelText('data/finances.yaml')
    expect(well.textContent).toBe('treasury:\n  chain: optimism\n')
    expect(well.className).toBe('mono-well') // C9: the YAML well (C8's), not 0.6's .yaml
    expect(screen.queryByRole('link', { name: 'New' })).toBeNull()
    // F-L3-3: a document's path through the Hub is the source editor (the editors table)
    expect(screen.getByRole('link', { name: 'Edit in the source editor' }).getAttribute('href')).toBe('/files/data/finances.yaml')
    expect(screen.queryByText(/no path in the Hub yet/)).toBeNull()
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

// Walk M15, M17: /all/<registry> named data/<registry>.yaml for a collection the store keeps; /b/meetings titled its
// columns by their raw keys ("duration_minutes").
describe('where a registry is read from, and its column titles (walk M15, M17)', () => {
  it('a collection the store keeps names no data file: not in the head, the empty line, nor a row', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/registries/payroll': { name: 'payroll', kind: 'collection', schemaVersion: null, file: null, entries: [{ id: 'p-1', name: 'One' }, { name: 'No id' }] },
      'GET /api/schemas/payroll': { 'x-order': ['id', 'name'], properties: {} } })
    renderAt(<RegistryList registry="payroll" title="payroll" />, '/all/payroll')
    await screen.findByRole('table', { name: 'payroll' })
    expect(document.body.innerHTML).not.toMatch(/data\/payroll\.yaml/)
    expect(screen.getByText(/kept in the private store/)).toBeTruthy()
  })

  it('a custom collection names the file it is read from', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/registries/circles': { name: 'circles', kind: 'collection', schemaVersion: null, file: 'data/collections/circles.yaml', entries: [] },
      'GET /api/schemas/circles': { 'x-order': ['id', 'name'], properties: {} } })
    renderAt(<RegistryList registry="circles" title="Circles" />, '/all/circles')
    expect(await screen.findByText('No entries in data/collections/circles.yaml yet.')).toBeTruthy()
    expect(document.body.innerHTML).not.toMatch(/data\/circles\.yaml/)
  })

  it('titles the columns as the schema names its fields', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/registries/meetings': { name: 'meetings', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'm-1', title: 'Kick-off', duration_minutes: 30 }] },
      'GET /api/schemas/meetings': { 'x-order': ['id', 'title', 'duration_minutes'], properties: { title: { title: 'Title' }, duration_minutes: { title: 'Length' } } } })
    renderAt(<RegistryList registry="meetings" title="Meetings" />)
    const table = await screen.findByRole('table', { name: 'Meetings' })
    const heads = [...table.querySelectorAll('th')].map(th => th.textContent ?? '')
    expect(heads.some(h => h.includes('Length'))).toBe(true)
    expect(heads.some(h => h.includes('duration_minutes'))).toBe(false)
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
