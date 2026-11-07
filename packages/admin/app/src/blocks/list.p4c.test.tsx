// @vitest-environment jsdom
// packages/admin/app/src/blocks/list.p4c.test.tsx
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { BlockFrame, listBlock } from './index.ts'
import { Layout } from '../boards/Board.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, resource } from '../test/data.ts'

const job = { id: 'j1', op: 'site:build', resource: 'project:p1', label: 'Build the site', cmd: null, args: [], writes: [], status: 'ok',
  created: '2026-10-17T10:00:00Z', started: null, ended: null, exitCode: 0, changed: [], surprises: [], sentence: 'Done.' }

const projects = (entries: unknown[]) => baseRoutes({
  'GET /api/resources': [resource({ id: 'project:p1', name: 'Alpha' })],
  'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 3 }],
  'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: null, entries },
})
const listEntry = (view?: Record<string, unknown>) => ({ id: 'list', type: 'list', title: 'Projects', source: { section: 'projects' }, ...(view ? { view } : {}) })

describe('the list block, for boards (P4c)', () => {
  it('reads the latest jobs for { jobs: recent }, as Home did', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/resources': [resource()], 'GET /api/jobs': [job] }))
    renderAt(<BlockFrame def={listBlock} id="ops" cfg={{ title: 'Recent operations', source: { jobs: 'recent', limit: 8 }, view: { empty: 'No operations have run yet.' } }} />)
    expect(await screen.findByRole('table', { name: 'Recent operations' })).toBeTruthy()
    expect(screen.getByText('Build the site')).toBeTruthy()
  })

  it("says the view's empty sentence when no job has run", async () => {
    fetchRoutes(baseRoutes({ 'GET /api/resources': [], 'GET /api/jobs': [] }))
    renderAt(<BlockFrame def={listBlock} id="ops" cfg={{ title: 'Recent operations', source: { jobs: 'recent' }, view: { empty: 'No operations have run yet.' } }} />)
    expect(await screen.findByText('No operations have run yet.')).toBeTruthy()
  })

  it("draws a registry-only section (Meetings) as its file's list, without a second head", async () => {
    fetchRoutes(baseRoutes({ 'GET /api/resources': [],
      'GET /api/registries/meetings': { name: 'meetings', kind: 'collection', schemaVersion: null, entries: [{ id: 'm1', title: 'Council' }] },
      'GET /api/schemas/meetings': { type: 'object', 'x-order': ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' } } } }))
    renderAt(<BlockFrame bare def={listBlock} id="list" cfg={{ title: 'Meetings', source: { section: 'meetings' } }} />)
    expect(await screen.findByText('Council')).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('draws no List · Map and no + Filter over a registry-only section, which reads neither (walk 2026-11-04, L4c-fix 5)', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/resources': [],
      'GET /api/registries/meetings': { name: 'meetings', kind: 'collection', schemaVersion: null, entries: [{ id: 'm1', title: 'Council' }] },
      'GET /api/schemas/meetings': { type: 'object', 'x-order': ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' } } } }))
    renderAt(<BlockFrame bare def={listBlock} id="list" cfg={{ title: 'Meetings', source: { section: 'meetings' }, view: { switch: true, filter: true, new: true } }} />)
    expect(await screen.findByText('Council')).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('button', { name: /Filter/ })).toBeNull()
  })

  // C9 fix round 1 (ruling I-1, ledger): New is the view header's primary; the foot keeps the unaddressable line
  // design pass 2026-11-04: a lone section list leaves its Add to the page head (BoardPage: collection.test.tsx)
  it("leaves a lone section list's Add to the page head: no New in its view header, the file's unaddressable line in the foot", async () => {
    fetchRoutes(projects([{ id: 'p1' }, { title: 'no id' }]))
    renderAt(<Layout layout="flow" blocks={[listEntry({ new: true })]} />)
    expect(await screen.findByText(/1 entry in data\/projects.yaml cannot be addressed/)).toBeTruthy()
    await screen.findByRole('link', { name: 'Alpha' })
    expect(document.querySelector('.vhead')).not.toBeNull()
    expect(screen.queryByRole('link', { name: 'New' })).toBeNull()
  })

  it('offers New once in a framed list block on a board of several blocks, in that block’s view header', async () => {
    fetchRoutes(projects([{ id: 'p1' }]))
    renderAt(<Layout layout="flow" blocks={[listEntry({ new: true }), { id: 'other', type: 'list', title: 'Everything', source: {} }]} />)
    expect((await screen.findByRole('link', { name: 'New' })).getAttribute('href')).toBe('/new/projects')
    expect(screen.getByRole('link', { name: 'New' }).closest('.vhead')).not.toBeNull()
    expect(screen.getAllByRole('link', { name: 'New' })).toHaveLength(1)
  })

  it('offers no New without view.new, so a page that has its own keeps one', async () => {
    fetchRoutes(projects([{ id: 'p1' }]))
    renderAt(<Layout layout="flow" blocks={[listEntry()]} />)
    await screen.findByRole('link', { name: 'Alpha' })
    expect(screen.queryByRole('link', { name: 'New' })).toBeNull()
  })
})
