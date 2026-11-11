// @vitest-environment jsdom
// DAO-OS L6 Task 19: the record, page and view headers pass the server's from mark (spec §10, Q70; R-L6-T14-5:
// `fromMark` on GET /api/registries/:name?from=1 and GET /api/pages/:id) to L4c's mark — and draw none it does not send.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Switch } from 'wouter'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes } from '../test/data.ts'
import { page, projectRoutes } from '../test/record.tsx'
import { pageReadOf } from '../test/fixtures/house/workspace.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { FIXTURE_SOURCE } from '../viewAs/visibility.ts'
import PagePage from './PagePage.tsx'
import CollectionPage from './CollectionPage.tsx'

const AGO = new Date(Date.now() - 3 * 3_600_000).toISOString()
const ENTRY = { id: 'p1', title: 'Seed Library', status: 'develop', lead: 'steward-a' }

beforeEach(() => { sessionStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

describe('the from mark on the headers, as the server sends it', () => {
  it('a record header draws its record’s mark: its file and that file’s last commit', async () => {
    projectRoutes({
      'GET /api/registries/projects?from=1': { name: 'projects', kind: 'collection', schemaVersion: '2.0', fromMark: { file: 'data/projects.yaml', readAt: AGO },
        entries: [{ ...ENTRY, fromMark: { file: 'data/projects.yaml', readAt: AGO } }] },
    })
    const { container } = page('/r/project/p1')
    await screen.findByRole('heading', { level: 1, name: 'Seed Library' })
    const from = container.querySelector('header.rh .from')!
    expect(from.textContent).toBe('from the repository · read 3 h ago')
    expect(from.querySelector('time')!.getAttribute('datetime')).toBe(AGO)
  })

  it('an imported record’s header reads where it was imported from', async () => {
    projectRoutes({
      'GET /api/registries/projects?from=1': { name: 'projects', kind: 'collection', schemaVersion: '2.0',
        entries: [{ ...ENTRY, fromMark: { import: 'Notion', exportedAt: '2026-08-12' } }] },
    })
    const { container } = page('/r/project/p1')
    await screen.findByRole('heading', { level: 1, name: 'Seed Library' })
    expect(container.querySelector('header.rh .from')!.textContent).toMatch(/^from Notion · exported 12 Aug( 2026)?$/)
  })

  it('a record the server sends no mark for has none: nothing the client makes up', async () => {
    projectRoutes({ 'GET /api/registries/projects?from=1': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [ENTRY] } })
    const { container } = page('/r/project/p1')
    await screen.findByRole('heading', { level: 1, name: 'Seed Library' })
    expect(container.querySelector('header.rh .rh-meta')!.textContent).toBe('Project')
    expect(container.querySelector('.from')).toBeNull()
  })

  it('a page’s body draws the page’s mark after its meta line', async () => {
    const read = pageReadOf('treasury-3c4d')
    fetchRoutes({ ...baseRoutes(),
      'GET /api/pages': [], 'GET /api/presence': {},
      'GET /api/pages/treasury-3c4d': { ...read, page: { ...read.page, fromMark: { instance: 'Fixture Org', readAt: AGO } } },
      'POST /api/pages/treasury-3c4d/sessions': { session: 'ses_1', base: 'b0', markdown: read.page.markdown },
      'POST /api/sessions/ses_1/close': { commit: null },
    })
    renderAt(<PagePage id="treasury-3c4d" />, '/p/treasury-3c4d')
    const meta = await screen.findByText((_, el) => el?.classList.contains('ed-meta') === true && el.querySelector('.from') !== null)
    expect(meta.querySelector('.from')!.textContent).toBe('from Fixture Org · read 3 h ago')
  })

  it('a collection’s view header draws the collection’s mark; previewed as the public, none', async () => {
    const routes = {
      ...baseRoutes(),
      'GET /api/registries': [{ name: 'tasks', kind: 'collection', count: 1 }],
      'GET /api/collections': { collections: [{ id: 'tasks', builtin: true, visibility: 'members', views: [] }], problems: [] },
      'GET /api/registries/tasks': { name: 'tasks', kind: 'collection', schemaVersion: null, entries: [{ id: 't1', title: 'Write it down', status: 'To do', visibility: 'public' }] },
      'GET /api/registries/tasks?from=1': { name: 'tasks', kind: 'collection', schemaVersion: null, fromMark: { file: 'data/tasks.yaml', readAt: AGO }, entries: [] },
      'GET /api/view-state/tasks': { collection: 'tasks', state: null },
      'PUT /api/view-state/tasks': { collection: 'tasks', state: null },
    }
    const ui = <Switch><Route path="/c/:collection">{p => <CollectionPage key={p.collection} collection={p.collection} />}</Route></Switch>
    fetchRoutes(routes)
    const first = renderAt(ui, '/c/tasks')
    expect((await screen.findByText((_, el) => el?.classList.contains('vhead-meta') === true)).textContent).toBe('from the repository · read 3 h ago')
    first.unmount()
    const { calls } = fetchRoutes(routes)
    renderAt(<ViewAsProvider source={FIXTURE_SOURCE} initial={{ as: 'public' }}>{ui}</ViewAsProvider>, '/c/tasks')
    await screen.findByRole('tab', { name: 'Table' })
    expect(document.querySelector('.vhead-meta')).toBeNull()
    expect(calls.some(c => c.path === '/api/registries/tasks?from=1')).toBe(false)
  })
})
