// @vitest-environment jsdom
// Walk fix wave 6b, I8: an embedded view of a collection in a page draws the collection's rows, in the view the embed
// names (a compact table when it names none), up to EMBED_LIMIT, with "Open <collection>" to its page. The rows come
// through the reads the collection page uses, as the viewer (View as included): a collection the viewer may not read
// draws nothing that names it, the same as one that is not there. The page's Markdown is untouched by the drawing.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { setPreviewAs } from '../api.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, refuse } from '../test/data.ts'
import { PAGE_NODES, pageReadOf } from '../test/fixtures/house/workspace.ts'
import PagePage from './PagePage.tsx'
import { editorOf } from './EditorHost.tsx'
import { EMBED_ABSENT, EMBED_LIMIT } from './EmbeddedView.tsx'
import { DRAFT_DEBOUNCE_MS } from './useSession.tsx'

const ID = 'treasury-3c4d'
const TASKS = [
  { id: 'write-onboarding', title: 'Write the onboarding page', status: 'To do', owner: 'ops-lead', visibility: 'members' },
  { id: 'ask-council', title: 'Ask the Council about the pool', status: 'To do', visibility: 'members' },
  { id: 'pool-report', title: 'Draft the pool report', status: 'Doing', owner: 'steward-a', visibility: 'members' },
  { id: 'old-signer', title: 'Remove the old signer', status: 'Done', visibility: 'members' },
]
const OPEN_VIEW = { id: 'open', name: 'Open', kind: 'list', filters: [{ field: 'status', op: 'is-not', value: 'Done' }] }
const COLLECTIONS = { collections: [{ id: 'tasks', name: 'Tasks', builtin: true, visibility: 'members', views: [OPEN_VIEW] }], problems: [] }
const OPEN_EMBED = '::view[Open tasks]{collection="tasks" view="open"}'
const HIDDEN_EMBED = '::view[Council pay]{collection="council-pay" view="table"}'
const GONE_EMBED = '::view[Old list]{collection="old-list" view="table"}'

beforeEach(() => { sessionStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); setPreviewAs(null) })

function routes(markdown: string, over: Record<string, unknown> = {}) {
  return fetchRoutes({
    ...baseRoutes(),
    'GET /api/pages': PAGE_NODES,
    [`GET /api/pages/${ID}`]: pageReadOf(ID, { markdown }),
    'GET /api/presence': {},
    [`POST /api/pages/${ID}/sessions`]: { session: 'ses_1', base: 'b0', markdown },
    'PUT /api/sessions/ses_1': { save: 'direct' },
    'POST /api/sessions/ses_1/close': { commit: 'c1' },
    'GET /api/collections': COLLECTIONS,
    'GET /api/registries/tasks': { name: 'tasks', kind: 'collection', schemaVersion: null, entries: TASKS },
    // a private collection this viewer is not admitted to answers as one that is not there (gateRegistry)
    'GET /api/registries/council-pay': refuse(404, { error: 'There is no registry council-pay.' }),
    'GET /api/registries/old-list': refuse(404, { error: 'There is no registry old-list.' }),
    ...over,
  })
}

async function editorView(): Promise<EditorView> {
  const box = await screen.findByRole('textbox', { name: 'How the treasury is run · page body' }, { timeout: 4000 })
  return editorOf(box)!.view
}
const embeds = (view: EditorView) => [...view.dom.querySelectorAll<HTMLElement>('.hub-embed[data-embed="view"]')]

describe('an embedded view in a page (walk I8)', () => {
  it('draws the view the embed names: its filtered rows, each opening its record, and "Open Tasks" to the view', async () => {
    routes(`Our list:\n\n${OPEN_EMBED}\n`)
    renderAt(<PagePage id={ID} />, `/p/${ID}`)
    const view = await editorView()
    const [embed] = embeds(view)
    const list = await within(embed!).findByRole('list', { name: 'Tasks' }, { timeout: 4000 })
    expect(within(list).getAllByRole('link').map(a => a.querySelector('.drow-t')!.textContent))
      .toEqual(['Write the onboarding page', 'Ask the Council about the pool', 'Draft the pool report'])
    expect(within(list).getByRole('link', { name: /Write the onboarding page/ }).getAttribute('href')).toBe('/r/tasks/write-onboarding')
    expect(within(embed!).getByRole('link', { name: 'Open Tasks' }).getAttribute('href')).toBe('/c/tasks/open')
    expect(embed!.textContent).toContain('Open') // the view's name beside the collection's
    expect(embed!.getAttribute('contenteditable')).toBe('false')
  })

  it('a view the collection does not hold is a compact table, up to EMBED_LIMIT rows, then how many more', async () => {
    const many = Array.from({ length: EMBED_LIMIT + 3 }, (_, i) => ({ id: `t-${i}`, title: `Task ${i}`, status: 'To do', visibility: 'members' }))
    routes(`${'::view[Tasks]{collection="tasks" view="table"}'}\n`, {
      'GET /api/registries/tasks': { name: 'tasks', kind: 'collection', schemaVersion: null, entries: many },
    })
    renderAt(<PagePage id={ID} />, `/p/${ID}`)
    const view = await editorView()
    const [embed] = embeds(view)
    const table = await within(embed!).findByRole('table', { name: 'Tasks' }, { timeout: 4000 })
    expect(within(table).getAllByRole('row').length - 1).toBe(EMBED_LIMIT) // the head row aside
    expect(embed!.textContent).toContain('3 more')
    expect(within(embed!).getByRole('link', { name: 'Open Tasks' }).getAttribute('href')).toBe('/c/tasks/table')
    // read-only: nothing to edit, no grid
    expect(within(embed!).queryByRole('grid')).toBeNull()
  })

  it('a collection the viewer may not read draws nothing that names it, the same as one that is not there', async () => {
    routes(`${HIDDEN_EMBED}\n\n${GONE_EMBED}\n`, {
      'GET /api/collections': { collections: [], problems: [] },
    })
    renderAt(<PagePage id={ID} />, `/p/${ID}`)
    const view = await editorView()
    await vi.waitFor(() => expect(embeds(view).map(e => e.textContent)).toEqual([EMBED_ABSENT, EMBED_ABSENT]), { timeout: 4000 })
    const [hidden, gone] = embeds(view)
    expect(hidden!.outerHTML).toBe(gone!.outerHTML)
    for (const word of ['council-pay', 'Council pay', 'old-list', 'Old list']) expect(view.dom.innerHTML).not.toContain(word)
    expect(within(hidden!).queryByRole('link')).toBeNull()
  })

  it('View as: the rows are read as the previewed viewer; one the preview may not read is absent', async () => {
    setPreviewAs('members')
    const { calls } = routes(`${OPEN_EMBED}\n`, {
      // the members' side has no such collection: the server answers it as one that is not there
      'GET /api/registries/tasks?as=members': refuse(404, { error: 'There is no registry tasks.' }),
      'GET /api/collections?as=members': { collections: [], problems: [] },
    })
    renderAt(<PagePage id={ID} />, `/p/${ID}`)
    const view = await editorView()
    await vi.waitFor(() => expect(embeds(view)[0]!.textContent).toBe(EMBED_ABSENT), { timeout: 4000 })
    expect(calls.some(c => c.path === '/api/registries/tasks?as=members')).toBe(true)
    expect(calls.some(c => c.path === '/api/registries/tasks')).toBe(false)
    expect(view.dom.innerHTML).not.toContain('Open tasks')
  })

  it('the page’s Markdown keeps the embed as written: a save after typing elsewhere holds the line byte for byte', async () => {
    const { calls } = routes(`Our list:\n\n${OPEN_EMBED}\n\nEnd.\n`)
    renderAt(<PagePage id={ID} />, `/p/${ID}`)
    const view = await editorView()
    await within(embeds(view)[0]!).findByRole('list', { name: 'Tasks' }, { timeout: 4000 })
    act(() => { view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc))) })
    act(() => { view.dispatch(view.state.tr.insertText(' More.')) })
    await vi.waitFor(() => expect(calls.some(c => c.method === 'PUT' && c.path === '/api/sessions/ses_1')).toBe(true), { timeout: DRAFT_DEBOUNCE_MS + 2500 })
    const put = calls.find(c => c.method === 'PUT' && c.path === '/api/sessions/ses_1')!
    expect(put.body).toEqual({ markdown: `Our list:\n\n${OPEN_EMBED}\n\nEnd. More.\n` })
  })
})
