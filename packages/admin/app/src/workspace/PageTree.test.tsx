// @vitest-environment jsdom
// DAO-OS L6 Task 16: the pages on /workspace — root pages and their subpages, presence on rows, rule 7.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes } from '../test/data.ts'
import { PAGE_NODES } from '../test/fixtures/house/workspace.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { FIXTURE_SOURCE } from '../viewAs/visibility.ts'
import Workspace from '../pages/Workspace.tsx'
import { NEW_PAGE_STAGED, PageTree, treeRows } from './PageTree.tsx'

afterEach(() => vi.unstubAllGlobals())
/** The machine is shared: a first draw may take longer than the default second. */
const LOAD = { timeout: 4000 }

const PRESENCE = { 'page:treasury-3c4d': [{ handle: 'ops-lead', role: 'Ops lead', editing: true }] }
const routes = (over: Record<string, unknown> = {}) => fetchRoutes({ ...baseRoutes(), 'GET /api/pages': PAGE_NODES, 'GET /api/presence': PRESENCE, ...over })
const rowsOf = async () => {
  const list = await screen.findByRole('list', { name: 'Pages' })
  return within(list).getAllByRole('link').map(a => [a.querySelector('.drow-t')!.textContent, a.getAttribute('href'), a.querySelector('.drow-s')?.textContent ?? ''])
}

describe('the page tree', () => {
  it('lists root pages and, under each, its subpages; a page whose parent is missing is a root', async () => {
    routes()
    renderAt(<PageTree />, '/workspace')
    expect(await rowsOf()).toEqual([
      ['Handbook', '/p/handbook-1a2b', ''],
      ['How the treasury is run', '/p/treasury-3c4d', 'In Handbook'],
      ['Welcome', '/p/welcome-5e6f', ''],
      ['Old notes', '/p/orphan-7a8b', 'Its parent page is missing.'],
    ])
    const sub = screen.getByRole('link', { name: /How the treasury is run/ })
    expect(sub.className).toContain('pg-d1')
  })

  // walk I15, D1: two pages called Handbook (one imported under an archive page): "In Handbook" says which
  it('a subpage whose parent shares its title with another page says where that parent is', async () => {
    routes({ 'GET /api/pages': [
      { id: 'hb-1', title: 'Handbook', parent: null, order: 1000, visibility: 'members' },
      { id: 'ch-1', title: 'Chapter one', parent: 'hb-1', order: 1000, visibility: 'members' },
      { id: 'arch-1', title: 'Archive', parent: null, order: 2000, visibility: 'members' },
      { id: 'hb-2', title: 'Handbook', parent: 'arch-1', order: 1000, visibility: 'members' },
      { id: 'rh-1', title: 'Meeting rhythm', parent: 'hb-2', order: 1000, visibility: 'members' },
    ] })
    renderAt(<PageTree />, '/workspace')
    expect((await rowsOf()).map(([t, , s]) => [t, s])).toEqual([
      ['Handbook', ''],
      ['Chapter one', 'In Handbook, at the top'],
      ['Archive', ''],
      ['Handbook', 'In Archive'],
      ['Meeting rhythm', 'In Handbook, in Archive'],
    ])
  })

  it('ends a row others have open in a 20px presence stack, asked for the rows shown', async () => {
    const { calls } = routes()
    renderAt(<PageTree />, '/workspace')
    await rowsOf()
    const stack = await vi.waitFor(() => {
      const s = screen.getByRole('link', { name: /How the treasury is run/ }).querySelector('.pres.pres-sm')
      expect(s).toBeTruthy()
      return s!
    })
    expect(stack.getAttribute('aria-label')).toBe('Ops lead is editing')
    expect(screen.getByRole('link', { name: /^Handbook/ }).querySelector('.pres')).toBeNull()
    expect(calls.find(c => c.path.startsWith('/api/presence'))!.path).toContain('page%3Atreasury-3c4d')
  })

  it('a page the viewer may not see is absent: no row, no count, nothing asked of presence for it', async () => {
    const { calls } = routes()
    renderAt(<ViewAsProvider source={FIXTURE_SOURCE} initial={{ as: 'members' }}><PageTree /></ViewAsProvider>, '/workspace')
    expect((await rowsOf()).map(r => r[0])).toEqual(['Handbook', 'Welcome', 'Old notes'])
    await vi.waitFor(() => expect(calls.some(c => c.path.startsWith('/api/presence'))).toBe(true))
    expect(calls.filter(c => c.path.startsWith('/api/presence')).every(c => !c.path.includes('treasury'))).toBe(true)
    // previewing: no New page
    expect(screen.queryByRole('button', { name: 'New page' })).toBeNull()
  })

  it('New page creates a page and opens it; under a raised tree it says it is staged', async () => {
    const { calls } = routes({ 'POST /api/pages': { id: 'untitled-9f9f', commit: 'c1' } })
    const { loc } = renderAt(<PageTree />, '/workspace')
    fireEvent.click(await screen.findByRole('button', { name: 'New page' }, LOAD))
    await vi.waitFor(() => expect(loc.history!.at(-1)).toBe('/p/untitled-9f9f'), LOAD)
    expect(calls.find(c => c.method === 'POST' && c.path === '/api/pages')!.body).toEqual({ title: 'Untitled' })

    vi.unstubAllGlobals()
    routes({ 'POST /api/pages': { id: 'untitled-9f9e', staged: true } })
    renderAt(<PageTree />, '/workspace')
    fireEvent.click((await screen.findAllByRole('button', { name: 'New page' }, LOAD)).at(-1)!)
    expect(await screen.findByText(NEW_PAGE_STAGED, {}, LOAD)).toBeTruthy()
  })

  it('Workspace draws the tree above the collections', async () => {
    routes({ 'GET /api/resources': [], 'GET /api/registries': [] })
    renderAt(<Workspace />, '/workspace')
    expect(await screen.findByRole('heading', { level: 2, name: 'Pages' })).toBeTruthy()
    expect((await rowsOf()).length).toBe(4)
  })

  it('treeRows keeps reading order and never loops', () => {
    const loop = [
      { id: 'a', title: 'A', parent: 'b', order: 1, visibility: 'members' },
      { id: 'b', title: 'B', parent: 'a', order: 1, visibility: 'members' },
    ]
    expect(treeRows(loop, () => true).map(r => [r.node.id, r.depth])).toEqual([['a', 0], ['b', 1]])
    expect(treeRows([...PAGE_NODES], () => true).map(r => [r.node.id, r.depth])).toEqual([
      ['handbook-1a2b', 0], ['treasury-3c4d', 1], ['welcome-5e6f', 0], ['orphan-7a8b', 0]])
  })
})
