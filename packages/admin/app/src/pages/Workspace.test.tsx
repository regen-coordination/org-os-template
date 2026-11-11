// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import Workspace from './Workspace.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, resource } from '../test/data.ts'
import { TASK_PRESENCE } from '../test/fixtures/house/workspace.ts'

afterEach(() => vi.unstubAllGlobals())
const routes = () => fetchRoutes({ ...baseRoutes(),
  'GET /api/resources': [resource(), resource({ id: 'idea:i', kind: 'idea', name: 'An idea', source: { path: 'data/ideas.yaml', editable: true, registry: 'ideas', entityId: 'i' } })],
  'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 1 }, { name: 'meetings', kind: 'collection', count: 0 }] })

describe('/workspace', () => {
  it('lists the collections that hold a record you may see, in Workspace order, each opening its collection', async () => {
    routes()
    renderAt(<Workspace />, '/workspace')
    expect(await screen.findByRole('heading', { level: 1, name: 'Workspace' })).toBeTruthy()
    const list = await screen.findByRole('list', { name: 'Collections' })
    const links = await within(list).findAllByRole('link')
    expect(links.map(a => [a.querySelector('.drow-t')!.textContent, a.getAttribute('href')])).toEqual([['Projects', '/b/projects'], ['Ideas', '/b/ideas']])
  })

  // C9 (E-74, Q-L4-3): each collection says how many records it holds that you may see
  it('lists each collection with its count of what you may see', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/resources': [resource(), resource({ id: 'project:p2', name: 'Project two', source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'p2' } }),
        resource({ id: 'idea:i', kind: 'idea', name: 'An idea', source: { path: 'data/ideas.yaml', editable: true, registry: 'ideas', entityId: 'i' } })],
      'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 2 }, { name: 'meetings', kind: 'collection', count: 3 }] })
    renderAt(<Workspace />, '/workspace')
    const list = await screen.findByRole('list', { name: 'Collections' })
    await vi.waitFor(() => expect(within(list).getAllByRole('link')).toHaveLength(2))
    // DAO-OS L6 Task 17 fix round 1: Meetings is the Hub's row now (Collections in the Hub, /c/meetings), listed once
    expect(within(list).getAllByRole('link').map(a => [a.querySelector('.drow-t')!.textContent, a.querySelector('.drow-s')!.textContent]))
      .toEqual([['Projects', '2 records'], ['Ideas', '1 record']])
  })

  it('lists each collection once: Tasks and Meetings in the Hub’s rows, at /c/<id> (DAO-OS L6 Task 17)', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/resources': [resource()],
      'GET /api/collections': { collections: [], problems: [] },
      'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 1 }, { name: 'meetings', kind: 'collection', count: 3 }] })
    renderAt(<Workspace />, '/workspace')
    const hub = await screen.findByRole('list', { name: 'Collections in the Hub' })
    await vi.waitFor(() => expect(within(screen.getByRole('list', { name: 'Collections' })).getAllByRole('link')).toHaveLength(1))
    const rows = [...document.querySelectorAll('a.drow')].map(a => [a.querySelector('.drow-t')!.textContent, a.getAttribute('href')])
    expect(rows.filter(([t]) => t === 'Meetings')).toEqual([['Meetings', '/c/meetings']])
    expect(within(hub).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/c/tasks', '/c/meetings'])
  })

  // walk I15, D1: an imported collection named as a Hub collection ("Tasks") is told apart by its id
  it('a collection whose name another shares says its id', async () => {
    fetchRoutes({ ...baseRoutes(),
      'GET /api/resources': [resource()],
      'GET /api/collections': { collections: [{ id: 'imported-tasks', name: 'Tasks', builtin: false, fields: [] }], problems: [] },
      'GET /api/registries': [{ name: 'tasks', kind: 'collection', count: 4 }, { name: 'imported-tasks', kind: 'collection', count: 2 }] })
    renderAt(<Workspace />, '/workspace')
    const hub = await screen.findByRole('list', { name: 'Collections in the Hub' })
    await vi.waitFor(() => expect(within(hub).getAllByRole('link')).toHaveLength(3))
    expect(within(hub).getAllByRole('link').map(a => [a.querySelector('.drow-t')!.textContent, a.querySelector('.drow-s')!.textContent])).toEqual([
      ['Tasks', '4 records · tasks'], ['Meetings', '0 records'], ['Tasks', '2 records · imported-tasks'],
    ])
  })

  it('a row of a page others have open ends in a 20px presence stack (fixture)', async () => {
    routes()
    const people = [...Object.values(TASK_PRESENCE)[0]!]
    renderAt(<Workspace presenceOf={href => (href === '/b/projects' ? people : [])} />, '/workspace')
    const list = await screen.findByRole('list', { name: 'Collections' })
    const projects = (await within(list).findAllByRole('link'))[0]!
    const stack = projects.querySelector('.drow-end .pres.pres-sm')!
    expect(stack.getAttribute('role')).toBe('img')
    expect(stack.getAttribute('aria-label')).toBe(people.map(p => `${p.role} is ${p.editing ? 'editing' : 'reading'}`).join('; '))
    expect(within(list).getAllByRole('link')[1]!.querySelector('.pres')).toBeNull()
  })
})
