// @vitest-environment jsdom
// The walk review's G1 (C1–C3): View as is made true at the server. While previewing, every read carries `?as=` and is
// read again; what /workspace counts, what /all and /all/:registry list, and what the top bar titles a page are the
// server's answers to that viewer, never what it answered you. The stubs answer `?as=` with what the server answers that
// viewer (tests/server/preview-as.test.ts holds the server to it), and you with what you may read.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import App from '../App.tsx'
import { setPreviewAs } from '../api.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, refuse } from '../test/data.ts'

const MEMBERS_ONLY = refuse(401, { error: 'Sign in to see this: it is for members only.', code: 'SIGN_IN' })
const reg = (name: string, count: number) => ({ name, kind: 'collection', count })
const circles = { id: 'circles', name: 'Circles', builtin: false, visibility: 'hat:ops', fields: [] }
const OPS_PAGE = { id: 'p-00000000c0de', title: 'Ops room', parent: null, order: 9000, visibility: 'hat:ops' }

beforeEach(() => { vi.stubGlobal('WebSocket', class { onmessage = null; close() {} }) })
afterEach(() => { setPreviewAs(null) })

function preview(as: 'Public' | 'Members') {
  fireEvent.click(screen.getByRole('button', { name: /^View as/ }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: as }))
}

describe('C1: /workspace\'s collections and counts are the server\'s answer to the previewed viewer', () => {
  it('as Members: the counts and collections a member with no hat is answered; you again after the preview', async () => {
    const { calls } = fetchRoutes({
      ...baseRoutes(), 'GET /api/resources': [], 'GET /api/pages': [],
      'GET /api/registries': [reg('tasks', 3), reg('meetings', 0), reg('circles', 2)],
      'GET /api/registries?as=members': [reg('tasks', 2), reg('meetings', 0)],
      'GET /api/collections': { collections: [circles] },
      'GET /api/collections?as=members': { collections: [] },
    })
    renderAt(<App />, '/workspace')
    const list = () => screen.getByRole('list', { name: 'Collections in the Hub' })
    await waitFor(() => expect(list().textContent).toContain('Circles'))
    expect(list().textContent).toContain('3 records')
    preview('Members')
    await waitFor(() => expect(list().textContent).toContain('2 records'))
    expect(list().textContent).not.toContain('Circles')
    expect(list().textContent).not.toContain('3 records')
    expect(calls.some(c => c.path === '/api/collections?as=members')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Exit preview' }))
    await waitFor(() => expect(list().textContent).toContain('Circles'))
  })
})

describe('C2: /all and /all/:registry list what the server answers the previewed viewer', () => {
  it('as Public: /all counts the registries the public is answered', async () => {
    fetchRoutes({
      ...baseRoutes(), 'GET /api/resources': [],
      'GET /api/registries': [reg('tasks', 3), reg('meetings', 0), reg('circles', 2)],
      'GET /api/registries?as=public': [reg('tasks', 1)],
    })
    renderAt(<App />, '/all')
    await screen.findByText('3 registries')
    preview('Public')
    await screen.findByText('1 registries')
    expect(screen.queryByRole('link', { name: /circles/ })).toBeNull()
  })

  it('as Members: /all/tasks lists the rows a member with no hat is answered, no id of the rest', async () => {
    const entries = [{ id: 't-agenda', title: 'Write the agenda', status: 'todo' }, { id: 't-room', title: 'Book the room', status: 'doing' }]
    fetchRoutes({
      ...baseRoutes(), 'GET /api/resources': [], 'GET /api/registries': [reg('tasks', 3)],
      'GET /api/schemas/tasks': { properties: { id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' } } },
      'GET /api/registries/tasks': { name: 'tasks', kind: 'collection', schemaVersion: '2.0', entries: [...entries, { id: 't-payroll', title: 'Review the payroll', status: 'todo' }] },
      'GET /api/registries/tasks?as=members': { name: 'tasks', kind: 'collection', schemaVersion: '2.0', entries },
    })
    renderAt(<App />, '/all/tasks')
    const main = () => document.querySelector('main')!
    await waitFor(() => expect(main().textContent).toContain('t-payroll'))
    expect(main().textContent).toContain('3 · data/tasks.yaml')
    preview('Members')
    await waitFor(() => expect(main().textContent).not.toContain('t-payroll'))
    expect(main().textContent).toContain('t-room')
  })
})

describe('C3: the top bar titles a page from the server\'s answer to the previewed viewer', () => {
  it('as Public: a page kept at Ops is not titled by its title', async () => {
    fetchRoutes({
      ...baseRoutes(), 'GET /api/resources': [], 'GET /api/registries': [],
      'GET /api/pages': [OPS_PAGE], 'GET /api/pages?as=public': MEMBERS_ONLY,
      [`GET /api/pages/${OPS_PAGE.id}`]: { page: { ...OPS_PAGE, path: null, markdown: 'Where Ops works.\n', edited: null }, write: { mode: 'none', rule: null }, backlinks: [] },
      [`GET /api/pages/${OPS_PAGE.id}?as=public`]: refuse(404, { error: `There is no page ${OPS_PAGE.id}.` }),
    })
    renderAt(<App />, `/p/${OPS_PAGE.id}`)
    await waitFor(() => expect(document.title).toContain('Ops room'))
    preview('Public')
    await waitFor(() => expect(document.title).not.toContain('Ops room'))
    const bar = document.querySelector('.frame-top, .tb, .ptop')
    expect(bar?.textContent ?? '').not.toContain('Ops room')
    expect(within(document.querySelector('main')!).queryByText(/Where Ops works/)).toBeNull()
  })
})
