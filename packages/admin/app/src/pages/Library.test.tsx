// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Switch } from 'wouter'
import Library from './Library.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, refuse } from '../test/data.ts'
import { ENTRIES, libraryList, preview, RECEIPTS, removal, TEST_DESK, testDeskPreview } from '../test/fixtures/library.ts'

const ADD = 'Add — stage a change'
const routes = (over: Record<string, unknown> = {}) => ({
  ...baseRoutes(), 'GET /api/library': libraryList(),
  'GET /api/library/board%3Atreasury-council/preview': preview({ needs: [{ text: 'a system of kind safe', met: false }],
    cannotAdd: 'It needs a system of kind safe, which this organization does not have yet. Add it first.' }), ...over,
})

describe('Library', () => {
  it('lists the framework shelf as cards, with where it is from and how many', async () => {
    fetchRoutes(routes())
    renderAt(<Library />, '/library')
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeTruthy()
    expect(await screen.findByRole('article', { name: 'Treasury & council' })).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(5)
    expect(screen.getByText('from: framework · 5 entries')).toBeTruthy()
  })

  it('draws the shelf as a segmented control, a search field and a grid of cards (§11.1, §14.1)', async () => {
    fetchRoutes(routes())
    renderAt(<Library />, '/library')
    await screen.findByRole('article', { name: 'Onboarding' })
    const tools = screen.getByRole('group', { name: 'Shelf' }).closest('.lib-tools')!
    expect(tools.querySelector('input[type=search].input')).toBe(screen.getByRole('searchbox', { name: 'Search the library' }))
    const grid = screen.getByRole('article', { name: 'Onboarding' }).parentElement!
    expect(grid.className).toBe('lib-grid')
    expect(screen.getByRole('article', { name: 'Onboarding' }).querySelector('.lib-card a.lib-card-a')).toBeTruthy()
  })

  it('has a shelf for what it holds and for nothing else: no toolkit shelf, and no promise of one', async () => {
    fetchRoutes(routes())
    renderAt(<Library />, '/library')
    await screen.findByRole('article', { name: 'Onboarding' })
    const shelf = screen.getByRole('group', { name: 'Shelf' })
    expect(within(shelf).getAllByRole('button').map(b => b.textContent)).toEqual(['All 5', 'Boards 3', 'Rules 1', 'Systems 1'])
    expect(document.body.textContent).not.toMatch(/toolkit|pattern|practice/i)
  })

  it('puts the boards every instance already has last, under their own heading, so they do not bury what is new', async () => {
    fetchRoutes(routes())
    renderAt(<Library />, '/library')
    await screen.findByRole('article', { name: 'Onboarding' })
    const built = screen.getByRole('region', { name: 'Built in' })
    expect(within(built).getAllByRole('article').map(a => a.getAttribute('aria-label'))).toEqual(['Treasury'])
    expect(within(built).getByText('1')).toBeTruthy()
    const titles = screen.getAllByRole('article').map(a => a.getAttribute('aria-label'))
    expect(titles.at(-1)).toBe('Treasury')
    expect(screen.queryByRole('region', { name: 'Built in' })!.contains(screen.getByRole('article', { name: 'Onboarding' }))).toBe(false)
  })

  it('shows no heading when only built-in boards are in view', async () => {
    fetchRoutes(routes())
    renderAt(<Library />, '/library')
    await screen.findByRole('article', { name: 'Onboarding' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the library' }), { target: { value: 'switch to its map' } })
    expect(screen.getAllByRole('article').map(a => a.getAttribute('aria-label'))).toEqual(['Treasury'])
    expect(screen.queryByRole('region', { name: 'Built in' })).toBeNull()
  })

  it('shows one shelf when it is chosen, and all of them again on All', async () => {
    fetchRoutes(routes())
    renderAt(<Library />, '/library')
    await screen.findByRole('article', { name: 'Onboarding' })
    fireEvent.click(screen.getByRole('button', { name: 'Rules 1' }))
    expect(screen.getAllByRole('article').map(a => a.getAttribute('aria-label'))).toEqual(['Consent among maintainers'])
    expect(screen.getByRole('button', { name: 'Rules 1' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'All 5' }))
    expect(screen.getAllByRole('article')).toHaveLength(5)
  })

  it('searches titles, summaries and tags, and says so when nothing matches', async () => {
    fetchRoutes(routes())
    renderAt(<Library />, '/library')
    await screen.findByRole('article', { name: 'Onboarding' })
    const search = screen.getByRole('searchbox', { name: 'Search the library' })
    fireEvent.change(search, { target: { value: 'runway' } })
    expect(screen.getAllByRole('article').map(a => a.getAttribute('aria-label'))).toEqual(['Treasury & council'])
    fireEvent.change(search, { target: { value: 'treasury' } }) // the tag function: treasury, and the titles
    expect(screen.getAllByRole('article').map(a => a.getAttribute('aria-label'))).toEqual(['Treasury & council', 'Safe multisig', 'Treasury'])
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.queryByRole('article')).toBeNull()
    expect(screen.getByText('Nothing in the library matches “zzz”. Clear the search to see all 5 entries.')).toBeTruthy()
  })

  it('searches inside the chosen shelf only', async () => {
    fetchRoutes(routes())
    renderAt(<Library />, '/library')
    await screen.findByRole('article', { name: 'Onboarding' })
    fireEvent.click(screen.getByRole('button', { name: 'Systems 1' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the library' }), { target: { value: 'treasury' } })
    expect(screen.getAllByRole('article').map(a => a.getAttribute('aria-label'))).toEqual(['Safe multisig'])
  })

  it('opens an entry beside the list: its preview, the state sentence, and an Add that cannot be pressed', async () => {
    const { calls } = fetchRoutes(routes())
    renderAt(<Library id="board:treasury-council" />, '/library/board%3Atreasury-council')
    expect(await screen.findByText('Previewing Treasury & council. Nothing changes until it is added.')).toBeTruthy()
    const p = screen.getByRole('region', { name: 'Treasury & council preview' })
    expect(within(p).getByText('a system of kind safe').closest('li')!.className).toContain('miss')
    expect((within(p).getByRole('button', { name: ADD }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('link', { name: 'Treasury & council' }).getAttribute('aria-current')).toBe('true')
    expect(calls.every(c => c.method === 'GET')).toBe(true) // reading the library sends nothing but reads
  })

  it('closes the preview with a link back to the list', async () => {
    fetchRoutes(routes())
    renderAt(<Library id="board:treasury-council" />, '/library/board%3Atreasury-council')
    const close = await screen.findByRole('link', { name: 'Close preview' })
    expect(close.getAttribute('href')).toBe('/library')
    expect(close.closest('section')!.getAttribute('aria-label')).toBe('Treasury & council preview')
  })

  it('can be closed while the preview is still loading', async () => {
    fetchRoutes(routes({ 'GET /api/library/board%3Atreasury-council/preview': () => new Promise<never>(() => {}) }))
    renderAt(<Library id="board:treasury-council" />, '/library/board%3Atreasury-council')
    expect((await screen.findByRole('link', { name: 'Close preview' })).getAttribute('href')).toBe('/library')
    expect(document.querySelector('.skel[aria-busy="true"]')).not.toBeNull()
  })

  it('says a refusal in the server\'s own sentence, with the next free id', async () => {
    fetchRoutes(routes({ 'GET /api/library/board%3Atreasury-council/preview': preview({
      refusal: { sentence: 'A board with the id `treasury-council` already exists. Add it under another id.', nextFreeId: 'treasury-council-2' } }) }))
    renderAt(<Library id="board:treasury-council" />, '/library/board%3Atreasury-council')
    const sentence = await screen.findByText('A board with the id `treasury-council` already exists. Add it under another id.')
    expect(sentence.closest('.smark-failed')).toBeTruthy() // the machine is in its refused state
    expect(screen.getByText('id taken · would be treasury-council-2')).toBeTruthy()
  })

  it('says so when the entry in the address is not in the library, and where to go', async () => {
    fetchRoutes(routes())
    renderAt(<Library id="board:nope" />, '/library/board%3Anope')
    expect(await screen.findByText('No library entry “board:nope”. Choose one from the list.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: /preview$/ })).toBeNull()
    expect(screen.getAllByRole('article')).toHaveLength(5)
  })

  it('says why a preview could not be read, in the words the server gave', async () => {
    fetchRoutes(routes({ 'GET /api/library/board%3Atreasury-council/preview': refuse(409, { error: 'data/boards.yaml cannot be read: unexpected end.' }) }))
    renderAt(<Library id="board:treasury-council" />, '/library/board%3Atreasury-council')
    expect(await screen.findByText('data/boards.yaml cannot be read: unexpected end.')).toBeTruthy()
  })

  it('says Loading… until the list answers, and why when it cannot', async () => {
    fetchRoutes(routes({ 'GET /api/library': refuse(500, { error: 'packages/admin/library/board/x/entry.yaml: summary must have required property.' }) }))
    renderAt(<Library />, '/library')
    expect(await screen.findByText('packages/admin/library/board/x/entry.yaml: summary must have required property.')).toBeTruthy()
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  it("says a list or a preview that failed to load once through the page's polite region: its note is no alert (§13, C11)", async () => {
    fetchRoutes(routes({ 'GET /api/library': refuse(500, { error: 'The library could not be read.' }) }))
    const { unmount } = renderAt(<Library />, '/library')
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('The library could not be read.'))
    unmount()
    fetchRoutes(routes({ 'GET /api/library/board%3Atreasury-council/preview': refuse(409, { error: 'data/boards.yaml cannot be read: unexpected end.' }) }))
    renderAt(<Library id="board:treasury-council" />, '/library/board%3Atreasury-council')
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('data/boards.yaml cannot be read: unexpected end.'))
  })

  describe('a preview reaches a person who cannot see it', () => {
    const live = () => screen.getByTestId('live').textContent
    // The app's own routes for the library: the list at /library, an entry at /library/:id.
    const App = () => (
      <Switch>
        <Route path="/library"><Library /></Route>
        <Route path="/library/:id">{p => <Library id={decodeURIComponent(p.id)} />}</Route>
      </Switch>
    )

    it('says through the live region that a preview opened, and what it is', async () => {
      fetchRoutes(routes())
      renderAt(<Library id="board:treasury-council" />, '/library/board%3Atreasury-council')
      await screen.findByRole('region', { name: 'Treasury & council preview' })
      await waitFor(() => expect(live()).toBe('Previewing Treasury & council. Nothing changes until it is added.'))
    })

    it('says a refusal through the live region, once and in the server\'s own sentence', async () => {
      const sentence = 'A board with the id `treasury-council` already exists. Add it under another id.'
      fetchRoutes(routes({ 'GET /api/library/board%3Atreasury-council/preview': preview({ refusal: { sentence, nextFreeId: 'treasury-council-2' } }) }))
      renderAt(<Library id="board:treasury-council" />, '/library/board%3Atreasury-council')
      await screen.findByText(sentence)
      await waitFor(() => expect(live()).toBe(sentence))
    })

    it('says nothing while the preview is still loading: there is nothing to say yet', async () => {
      fetchRoutes(routes({ 'GET /api/library/board%3Atreasury-council/preview': () => new Promise<never>(() => {}) }))
      renderAt(<Library id="board:treasury-council" />, '/library/board%3Atreasury-council')
      await waitFor(() => expect(document.querySelector('.skel[aria-busy="true"]')).not.toBeNull())
      expect(live()).toBe('')
    })

    it('moves focus to the preview heading when it opens, so the keyboard is where the new content is', async () => {
      fetchRoutes(routes())
      renderAt(<Library id="board:treasury-council" />, '/library/board%3Atreasury-council')
      await screen.findByText('a system of kind safe') // the preview has arrived and drawn its own frame
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Treasury & council' })))
    })

    it('opens from a card: focus goes to the heading and the sentence is announced', async () => {
      fetchRoutes(routes())
      const { loc } = renderAt(<App />, '/library')
      fireEvent.click(await screen.findByRole('link', { name: 'Treasury & council' }))
      await screen.findByText('a system of kind safe')
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Treasury & council' })))
      expect(loc.history!.at(-1)).toBe('/library/board%3Atreasury-council')
      await waitFor(() => expect(live()).toBe('Previewing Treasury & council. Nothing changes until it is added.'))
    })

    it('Close returns focus to the card that opened the preview', async () => {
      fetchRoutes(routes())
      renderAt(<App />, '/library')
      fireEvent.click(await screen.findByRole('link', { name: 'Treasury & council' }))
      fireEvent.click(await screen.findByRole('link', { name: 'Close preview' }))
      await waitFor(() => expect(screen.queryByRole('region', { name: /preview$/ })).toBeNull())
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Treasury & council' })))
    })

    it('says, when it closes, that it did, so opening the same entry again is heard again', async () => {
      fetchRoutes(routes())
      renderAt(<App />, '/library')
      fireEvent.click(await screen.findByRole('link', { name: 'Treasury & council' }))
      await waitFor(() => expect(live()).toMatch(/^Previewing/))
      fireEvent.click(await screen.findByRole('link', { name: 'Close preview' }))
      await waitFor(() => expect(live()).toBe(''))
      fireEvent.click(screen.getByRole('link', { name: 'Treasury & council' }))
      await waitFor(() => expect(live()).toMatch(/^Previewing/))
    })

    it('does not promise a change for an entry that cannot be added: a built-in board, or the solo default', async () => {
      fetchRoutes(routes({ 'GET /api/library/board%3Atreasury/preview': preview({ id: 'board:treasury', builtin: true }) }))
      renderAt(<Library id="board:treasury" />, '/library/board%3Atreasury')
      await screen.findByRole('region', { name: 'Treasury preview' })
      await waitFor(() => expect(live()).toBe('Viewing Treasury. It adds nothing to this organization.'))
      expect(document.body.textContent).not.toMatch(/until it is added/)
    })
  })

  describe('Add and Remove', () => {
    afterEach(() => { vi.restoreAllMocks() })
    const live = () => screen.getByTestId('live').textContent
    const ADD_ROUTE = 'POST /api/library/board%3Atest-desk/add'
    // The change once the test desk's add is staged in it: its board and its receipt.
    const STAGED_OPS = [
      { op: 'create' as const, record: 'boards:test-desk', value: { id: 'test-desk' }, base: null, before: null },
      { op: 'create' as const, record: 'library:board-test-desk', value: { id: 'board-test-desk', entry: 'board:test-desk' }, base: null, before: null },
    ]
    const desk = (over: Record<string, unknown> = {}) => routes({
      'GET /api/library': libraryList([...ENTRIES, TEST_DESK]),
      'GET /api/library/board%3Atest-desk/preview': testDeskPreview(), ...over,
    })
    const open = async () => {
      renderAt(<Library id="board:test-desk" />, '/library/board%3Atest-desk')
      // The frame is drawn while the preview loads ("Loading…"), and drawn again with it: wait for the form, not the frame.
      await screen.findByRole('button', { name: ADD })
    }

    it('stages the entry with what was typed: the machine says it is staged, and the tray reads its change again', async () => {
      let posted = false // the server's change holds the add once it is posted
      const { calls } = fetchRoutes(desk({ [ADD_ROUTE]: () => { posted = true; return changeView({ ops: STAGED_OPS }) }, 'GET /api/changes': () => changeView({ ops: posted ? STAGED_OPS : [] }) }))
      const { QueryClient } = await import('@tanstack/react-query')
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      qc.setQueryData(['changes'], changeView())
      renderAt(<Library id="board:test-desk" />, '/library/board%3Atest-desk', { queryClient: qc })
      fireEvent.change(await screen.findByLabelText('name'), { target: { value: 'Front desk' } })
      fireEvent.click(screen.getByRole('button', { name: ADD }))
      const region = screen.getByRole('region', { name: 'Test desk preview' })
      expect(await within(region).findByText('Test desk is staged in the changes.')).toBeTruthy()
      await waitFor(() => expect(live()).toBe('Test desk is staged in the changes.'))
      expect(calls.find(c => c.method === 'POST')).toEqual({ method: 'POST', path: '/api/library/board%3Atest-desk/add', body: { config: { id: 'test-desk', name: 'Front desk' } } })
      // The page reads the change itself now (E-22), so the invalidated change is read again at once, after the add.
      const post = calls.findIndex(c => c.method === 'POST')
      await waitFor(() => expect(calls.slice(post + 1).some(c => c.method === 'GET' && c.path === '/api/changes')).toBe(true))
    })

    it('says each config error beside its field, and stages nothing', async () => {
      fetchRoutes(desk({ [ADD_ROUTE]: refuse(422, { errors: [
        { record: 'board:test-desk', field: 'config.name', message: 'name is required.' },
        { record: 'board:test-desk', field: 'config.url', message: 'url must match format "uri"' },
      ] }) }))
      await open()
      fireEvent.click(screen.getByRole('button', { name: ADD }))
      const err = await screen.findByText('name is required.')
      const name = screen.getByLabelText('name')
      expect(name.getAttribute('aria-invalid')).toBe('true')
      expect(name.getAttribute('aria-describedby')).toContain(err.id)
      expect(screen.getByLabelText('url').getAttribute('aria-describedby')).toContain(screen.getByText('url must match format "uri"').id)
      expect(screen.queryByText('Test desk is staged in the changes.')).toBeNull()
      await waitFor(() => expect(document.activeElement).toBe(name)) // the keyboard is on the first field that failed
    })

    it('says a refusal in the server\'s own sentence', async () => {
      const taken = 'A board with the id `test-desk` already exists. Add it under another id.'
      fetchRoutes(desk({ [ADD_ROUTE]: refuse(409, { code: 'TAKEN', error: taken, nextFreeId: 'test-desk-2' }) }))
      await open()
      fireEvent.click(screen.getByRole('button', { name: ADD }))
      expect((await screen.findByText(taken)).closest('.smark-failed')).toBeTruthy()
      await waitFor(() => expect(live()).toBe(taken))
    })

    it('adds again after a refusal, once the id is changed', async () => {
      const taken = 'A board with the id `test-desk` already exists. Add it under another id.'
      let n = 0
      let posted = false
      fetchRoutes(desk({
        [ADD_ROUTE]: () => (n++ === 0 ? new Response(JSON.stringify({ code: 'TAKEN', error: taken, nextFreeId: 'test-desk-2' }), { status: 409 }) : (posted = true, changeView({ ops: STAGED_OPS }))),
        'GET /api/changes': () => changeView({ ops: posted ? STAGED_OPS : [] }),
      }))
      await open()
      fireEvent.click(screen.getByRole('button', { name: ADD }))
      await screen.findByText(taken)
      fireEvent.change(screen.getByLabelText('id'), { target: { value: 'test-desk-2' } })
      fireEvent.click(screen.getByRole('button', { name: ADD }))
      expect(await within(screen.getByRole('region', { name: 'Test desk preview' })).findByText('Test desk is staged in the changes.')).toBeTruthy()
    })

    it('after a 409 TAKEN, the id field takes the next free id and the keyboard (E-22)', async () => {
      const taken = 'A board with the id `test-desk` already exists. Add it under another id.'
      fetchRoutes(desk({ [ADD_ROUTE]: refuse(409, { code: 'TAKEN', error: taken, nextFreeId: 'test-desk-2' }) }))
      await open()
      fireEvent.click(screen.getByRole('button', { name: ADD }))
      await screen.findByText(taken)
      await waitFor(() => expect((screen.getByLabelText('id') as HTMLInputElement).value).toBe('test-desk-2'))
      await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('id')))
    })

    it('reopening an entry whose add is in your changes says Staged in your changes, never the taken id (E-22)', async () => {
      const taken = 'A board with the id `test-desk` already exists. Add it under another id.'
      const staged = changeView({ ops: [
        { op: 'create', record: 'boards:test-desk', value: { id: 'test-desk' }, base: null, before: null },
        { op: 'create', record: 'library:board-test-desk', value: { id: 'board-test-desk', entry: 'board:test-desk' }, base: null, before: null },
      ] })
      fetchRoutes(desk({ 'GET /api/changes': staged, 'GET /api/library/board%3Atest-desk/preview': testDeskPreview({ refusal: { sentence: taken, nextFreeId: 'test-desk-2' } }) }))
      renderAt(<Library id="board:test-desk" />, '/library/board%3Atest-desk')
      expect((await screen.findByText('Staged in your changes')).closest('.smark-staged')).toBeTruthy()
      await waitFor(() => expect(live()).toBe('Test desk is staged in the changes.'))
      expect(screen.queryByText(taken)).toBeNull()
      expect(screen.queryByRole('button', { name: ADD })).toBeNull()
    })

    it('a change discarded in the tray un-stages the open preview: its form is back, and no taken id (E-22)', async () => {
      const taken = 'A board with the id `test-desk` already exists. Add it under another id.'
      let ops: typeof STAGED_OPS = []
      fetchRoutes(desk({
        [ADD_ROUTE]: () => { ops = STAGED_OPS; return changeView({ ops }) },
        'GET /api/changes': () => changeView({ ops }),
        // read through the change, the desk's own id is taken while its add is staged
        'GET /api/library/board%3Atest-desk/preview': () => testDeskPreview(ops.length > 0 ? { refusal: { sentence: taken, nextFreeId: 'test-desk-2' } } : {}),
      }))
      const { QueryClient } = await import('@tanstack/react-query')
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      renderAt(<Library id="board:test-desk" />, '/library/board%3Atest-desk', { queryClient: qc })
      fireEvent.click(await screen.findByRole('button', { name: ADD }))
      expect(await screen.findByText('Staged in your changes')).toBeTruthy()
      await new Promise(r => setTimeout(r, 30)) // the change and the preview are read again after the add
      expect(screen.getByText('Staged in your changes')).toBeTruthy()
      ops = [] // Discard in the tray: the change is gone, and the tray reads it again
      await act(async () => { await qc.invalidateQueries({ queryKey: ['changes'] }) })
      await waitFor(() => expect(screen.queryByText('Staged in your changes')).toBeNull())
      expect((await screen.findByRole('button', { name: ADD }) as HTMLButtonElement).disabled).toBe(false)
      await waitFor(() => expect(within(screen.getByRole('region', { name: 'Test desk preview' })).getByText('Previewing Test desk. Nothing changes until it is added.')).toBeTruthy())
      expect(screen.queryByText(taken)).toBeNull()
      expect((screen.getByLabelText('id') as HTMLInputElement).value).toBe('test-desk')
    })

    it('says Removal staged for a receipt whose removal is in your changes (E-22)', async () => {
      const staged = changeView({ ops: [{ op: 'update', record: 'library:board-test-desk', set: { status: 'removed' }, base: 'b', before: null }] })
      fetchRoutes(desk({
        'GET /api/changes': staged, 'GET /api/library/receipts': RECEIPTS,
        'GET /api/library/board%3Atest-desk/preview': testDeskPreview({ receipts: [{ id: 'board-test-desk', at: '2026-10-29', by: 'steward-a' }] }),
      }))
      renderAt(<Library id="board:test-desk" />, '/library/board%3Atest-desk')
      expect((await screen.findByText('Removal staged')).closest('.smark-staged')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    })

    it('opens what removing would do from the preview, and comes back from it', async () => {
      fetchRoutes(desk({
        'GET /api/library/board%3Atest-desk/preview': testDeskPreview({ receipts: [{ id: 'board-test-desk', at: '2026-10-29', by: 'steward-a' }] }),
        'GET /api/library/receipts': RECEIPTS,
        'GET /api/library/receipts/board-test-desk/removal': removal(),
      }))
      await open()
      fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
      const r = await screen.findByRole('region', { name: 'Remove Test desk' })
      expect(within(r).getByText('boards:test-desk')).toBeTruthy()
      fireEvent.click(within(r).getByRole('button', { name: 'Back' }))
      expect(await screen.findByText('Added by steward-a on 2026-10-29 · created 2 records')).toBeTruthy()
      expect(screen.queryByRole('region', { name: 'Remove Test desk' })).toBeNull()
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove' }))) // back where it was opened
    })

    it('stages a removal and says so', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const { calls } = fetchRoutes(desk({
        'GET /api/library/board%3Atest-desk/preview': testDeskPreview({ receipts: [{ id: 'board-test-desk', at: '2026-10-29', by: 'steward-a' }] }),
        'GET /api/library/receipts': RECEIPTS,
        'GET /api/library/receipts/board-test-desk/removal': removal(),
        'POST /api/library/receipts/board-test-desk/remove': changeView(),
      }))
      await open()
      fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
      fireEvent.click(await within(await screen.findByRole('region', { name: 'Remove Test desk' })).findByRole('button', { name: 'Remove' }))
      await waitFor(() => expect(live()).toBe('The removal of Test desk is staged in the changes.'))
      expect(calls.find(c => c.method === 'POST')?.body).toEqual({ take: ['boards:test-desk'] })
      expect(screen.queryByRole('region', { name: 'Remove Test desk' })).toBeNull()
    })
  })
})
