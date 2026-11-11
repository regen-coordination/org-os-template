// @vitest-environment jsdom
// Walk fix wave 6b, I9: "Move to…" — from a page tree row's menu and from the page itself — picks a new parent (or the
// top level) among the pages the member may read and write (GET /api/pages?write), never the page itself or one of its
// subpages, and calls POST /api/pages/:id/move; the server's sentence is shown when it refuses, a staged move says so,
// and a move under a private page says, before it is made, that the page leaves the repository.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import type { PageNode } from '../api.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, refuse } from '../test/data.ts'
import { PAGE_NODES, pageReadOf } from '../test/fixtures/house/workspace.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { FIXTURE_SOURCE } from '../viewAs/visibility.ts'
import { PAGE_LEAVES_GIT } from '../../../lib/narrow.mjs'
import { PageTree } from './PageTree.tsx'
import PagePage from './PagePage.tsx'
import { MOVE_STAGED, MOVE_TOP, MOVED, moveTargets } from './MovePage.tsx'

const LOAD = { timeout: 4000 }
const WRITE: Record<string, PageNode['write']> = { 'handbook-1a2b': 'direct', 'treasury-3c4d': 'direct', 'welcome-5e6f': 'direct', 'orphan-7a8b': 'none' }
const WRITABLE: PageNode[] = PAGE_NODES.map(n => ({ ...n, write: WRITE[n.id] }))

beforeEach(() => { sessionStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

function routes(over: Record<string, unknown> = {}) {
  return fetchRoutes({
    ...baseRoutes(),
    'GET /api/pages?write': WRITABLE,
    'GET /api/pages': PAGE_NODES,
    'GET /api/presence': {},
    ...over,
  })
}
const posts = (calls: { method: string; path: string; body: unknown }[]) => calls.filter(c => c.method === 'POST' && c.path.endsWith('/move'))
const dialog = () => screen.findByRole('dialog', {}, LOAD)
const options = (d: HTMLElement) => [...within(d).getByRole('combobox', { name: 'Move under' }).querySelectorAll('option')].map(o => o.textContent!.trim())

async function openFromRow(title: string) {
  fireEvent.click(await screen.findByRole('button', { name: `More for ${title}` }, LOAD))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }))
  return dialog()
}

describe('Move to… (walk I9)', () => {
  it('moveTargets: never the page or its subpages, never a page the member may not write, never where it is', () => {
    expect(moveTargets('handbook-1a2b', WRITABLE).map(t => t.node.id)).toEqual(['welcome-5e6f'])
    expect(moveTargets('treasury-3c4d', WRITABLE).map(t => t.node.id)).toEqual(['welcome-5e6f'])
    expect(moveTargets('welcome-5e6f', WRITABLE).map(t => t.node.id)).toEqual(['handbook-1a2b', 'treasury-3c4d'])
    // the list without `write` (another reader's answer) offers nothing
    expect(moveTargets('welcome-5e6f', PAGE_NODES)).toEqual([])
  })

  it('a tree row’s menu moves the page under another one: the server is asked, the tree read again, the move said', async () => {
    const { calls } = routes({ 'POST /api/pages/welcome-5e6f/move': { id: 'welcome-5e6f', commit: 'c1' } })
    renderAt(<PageTree />, '/workspace')
    const d = await openFromRow('Welcome')
    expect(within(d).getByRole('heading', { name: 'Move Welcome' })).toBeTruthy()
    expect(options(d)).toEqual(['Handbook', 'How the treasury is run'])
    fireEvent.click(within(d).getByRole('button', { name: 'Move' }))
    await vi.waitFor(() => expect(posts(calls)).toHaveLength(1), LOAD)
    expect(posts(calls)[0]!.body).toEqual({ parent: 'handbook-1a2b' })
    await vi.waitFor(() => expect(screen.getByTestId('live').textContent).toBe(MOVED('Welcome', 'Handbook')), LOAD)
    expect(screen.queryByRole('dialog')).toBeNull()
    await vi.waitFor(() => expect(calls.filter(c => c.path === '/api/pages?write').length).toBeGreaterThan(1), LOAD)
  })

  it('a subpage can go to the top level; the select is keyboard-reachable and named', async () => {
    const { calls } = routes({ 'POST /api/pages/treasury-3c4d/move': { id: 'treasury-3c4d', commit: 'c1' } })
    renderAt(<PageTree />, '/workspace')
    const d = await openFromRow('How the treasury is run')
    expect(options(d)).toEqual([MOVE_TOP, 'Welcome'])
    const select = within(d).getByRole('combobox', { name: 'Move under' })
    select.focus()
    expect(document.activeElement).toBe(select)
    fireEvent.click(within(d).getByRole('button', { name: 'Move' }))
    await vi.waitFor(() => expect(posts(calls)[0]?.body).toEqual({ parent: null }), LOAD)
  })

  it('no menu where the member may not write the page, and none while previewing', async () => {
    routes()
    renderAt(<PageTree />, '/workspace')
    await screen.findByRole('button', { name: 'More for Welcome' }, LOAD)
    expect(screen.queryByRole('button', { name: 'More for Old notes' })).toBeNull()

    cleanup()
    vi.unstubAllGlobals()
    const { calls } = routes()
    renderAt(<ViewAsProvider source={FIXTURE_SOURCE} initial={{ as: 'members' }}><PageTree /></ViewAsProvider>, '/workspace')
    await screen.findByRole('list', { name: 'Pages' }, LOAD)
    expect(screen.queryAllByRole('button', { name: /^More for/ })).toEqual([])
    expect(calls.some(c => c.path === '/api/pages?write')).toBe(false)
  })

  it('a refusal is said in the server’s words, in the dialog; a staged move says it needs approval', async () => {
    const LOOSER = 'A page cannot be looser than its parent (members). Nothing was written.'
    routes({ 'POST /api/pages/welcome-5e6f/move': refuse(409, { code: 'LOOSER_THAN_PARENT', error: LOOSER }) })
    renderAt(<PageTree />, '/workspace')
    let d = await openFromRow('Welcome')
    fireEvent.click(within(d).getByRole('button', { name: 'Move' }))
    expect(await within(d).findByText(LOOSER, {}, LOAD)).toBeTruthy()
    expect(within(d).queryByRole('alert')).toBeNull()

    cleanup()
    vi.unstubAllGlobals()
    routes({ 'POST /api/pages/welcome-5e6f/move': { id: 'welcome-5e6f', staged: true } })
    renderAt(<PageTree />, '/workspace')
    d = await openFromRow('Welcome')
    fireEvent.click(within(d).getByRole('button', { name: 'Move' }))
    expect(await screen.findByText(MOVE_STAGED, {}, LOAD)).toBeTruthy()
  })

  it('under a private page, a page in the repository is told first that it leaves the repository', async () => {
    routes()
    renderAt(<PageTree />, '/workspace')
    const d = await openFromRow('Welcome')
    fireEvent.change(within(d).getByRole('combobox', { name: 'Move under' }), { target: { value: 'treasury-3c4d' } })
    expect(within(d).getByText(PAGE_LEAVES_GIT(0))).toBeTruthy()
  })

  it('the page itself offers Move to… where the member may write it, and reads the page again after', async () => {
    const ID = 'welcome-5e6f'
    const { calls } = routes({
      [`GET /api/pages/${ID}`]: pageReadOf(ID),
      [`POST /api/pages/${ID}/sessions`]: { session: 'ses_1', base: 'b0', markdown: 'Hello.\n' },
      'POST /api/sessions/ses_1/close': { commit: null },
      [`POST /api/pages/${ID}/move`]: { id: ID, commit: 'c1' },
    })
    renderAt(<PagePage id={ID} />, `/p/${ID}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Move to…' }, LOAD))
    const d = await dialog()
    await within(d).findByRole('combobox', { name: 'Move under' }, LOAD) // the list with your writes, read as it opens
    expect(options(d)).toEqual(['Handbook', 'How the treasury is run'])
    fireEvent.click(within(d).getByRole('button', { name: 'Move' }))
    await vi.waitFor(() => expect(posts(calls)[0]?.body).toEqual({ parent: 'handbook-1a2b' }), LOAD)
    await vi.waitFor(() => expect(calls.filter(c => c.method === 'GET' && c.path === `/api/pages/${ID}`).length).toBeGreaterThan(1), LOAD)
  })

  it('a page the member may not write offers no Move to…', async () => {
    const ID = 'welcome-5e6f'
    routes({ [`GET /api/pages/${ID}`]: pageReadOf(ID, { mode: 'none' }) })
    renderAt(<PagePage id={ID} />, `/p/${ID}`)
    await screen.findByRole('button', { name: 'Copy link' }, LOAD)
    expect(screen.queryByRole('button', { name: 'Move to…' })).toBeNull()
  })
})
