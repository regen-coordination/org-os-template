// @vitest-environment jsdom
// packages/admin/app/src/boards/Board.test.tsx
import { useState } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { defineBlock } from '../blocks/index.ts'
import { BoardPage, blockCfg, boardTitle } from './Board.tsx'
import { renderAt } from '../test/render.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { baseRoutes, boardRead, changeView } from '../test/data.ts'
import type { BlockEntry } from '../api.ts'

// A block type that only this test registers: it echoes its title, so the layout is what is tested.
defineBlock<{ title?: string }>({
  type: 'test-echo', label: 'Echo', config: [], title: c => c.title ?? 'Echo',
  useData: () => ({ state: 'ready', count: 1, data: null }),
  Body: ({ cfg }) => <p>echo {cfg.title}</p>,
})
// One with actions in its foot: a lone one is bare, so the page draws its foot (controller ruling 1).
defineBlock<{ title?: string }>({
  type: 'test-foot', label: 'Footed', config: [], title: c => c.title ?? 'Footed',
  useData: () => ({ state: 'ready', count: 1, data: null }),
  Body: ({ cfg }) => <p>footed {cfg.title}</p>,
  Foot: ({ cfg }) => <button type="button">New {cfg.title}</button>,
})
// One whose data hook calls hooks of its own, so a type change on the same id changes the hook count.
defineBlock<{ title?: string }>({
  type: 'test-hooks', label: 'Hooks', config: [], title: c => c.title ?? 'Hooks',
  useData: () => { const [a] = useState(1); const [b] = useState(2); return { state: 'ready', count: a + b, data: null } },
  Body: ({ cfg }) => <p>hooks {cfg.title}</p>,
})
// One whose foot throws: a lone block's foot is drawn by the page, inside the block's boundary (final review M-2).
defineBlock<{ title?: string }>({
  type: 'test-foot-throws', label: 'Foot throws', config: [], title: c => c.title ?? 'Foot throws',
  useData: () => ({ state: 'ready', count: 1, data: null }),
  Body: ({ cfg }) => <p>body {cfg.title}</p>,
  Foot: () => { throw new Error('foot boom') },
})
const echo = (id: string, place?: BlockEntry['place']): BlockEntry => ({ id, type: 'test-echo', title: id.toUpperCase(), ...(place ? { place } : {}) })
const cellOf = (text: string) => screen.getByText(`echo ${text}`).closest('.cell') as HTMLElement

const routes = (boards: unknown, over: Record<string, unknown> = {}) => fetchRoutes(baseRoutes({ 'GET /api/boards': boards, ...over }))
beforeEach(() => vi.unstubAllGlobals())

describe('BoardPage', () => {
  it('places grid blocks by col, span and row', async () => {
    routes([boardRead({ id: 'g', name: 'Grid', layout: 'grid', blocks: [echo('a', { col: 1, span: 4, row: 1 }), echo('b', { col: 5, span: 8, row: 2 })] })])
    renderAt(<BoardPage id="g" />, '/b/g')
    expect((await screen.findByRole('heading', { level: 1, name: 'Grid' })).textContent).toBe('Grid')
    await screen.findByText('echo A')
    expect(cellOf('B').style.gridColumn).toBe('5 / span 8')
    expect(cellOf('B').style.gridRow).toBe('2')
  })

  it('places canvas blocks at x, y, w, h', async () => {
    routes([boardRead({ id: 'c', layout: 'canvas', blocks: [echo('a', { x: 40, y: 80, w: 300, h: 200 })] })])
    renderAt(<BoardPage id="c" />, '/b/c')
    await screen.findByText('echo A')
    expect(cellOf('A').style).toMatchObject({ left: '40px', top: '80px', width: '300px', height: '200px' })
  })

  it('reads a grid as a flow, by row then column, on a phone (Review Focus 2)', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('759px'), addEventListener() {}, removeEventListener() {} }))
    routes([boardRead({ id: 'g', layout: 'grid', blocks: [echo('second', { col: 7, span: 6, row: 1 }), echo('first', { col: 1, span: 6, row: 1 })] })])
    renderAt(<BoardPage id="g" />, '/b/g')
    await screen.findByText('echo FIRST')
    expect(document.querySelector('.board')!.className).toContain('flow')
    expect([...document.querySelectorAll('.cell')].map(c => c.querySelector('[data-type="test-echo"] p')!.textContent)).toEqual(['echo FIRST', 'echo SECOND'])
  })

  it('renders the other blocks when one has a type this platform lacks, and says why (Review Focus 1)', async () => {
    routes([boardRead({ id: 'f', blocks: [echo('ok'), { id: 'odd', type: 'chart' }] })])
    renderAt(<BoardPage id="f" />, '/b/f')
    await screen.findByText('echo OK')
    expect(screen.getByRole('region', { name: 'odd' }).textContent).toContain('Block “odd” has type “chart”, which this platform does not have.')
  })

  it("says in a block's own frame why its source cannot be read, and the board draws the rest (final review M-5)", async () => {
    routes([boardRead({ id: 'f', blocks: [echo('ok'),
      { id: 'typo', type: 'list', title: 'Typo', sorce: { kind: 'project' } } as BlockEntry,
      { id: 'cond', type: 'list', title: 'Cond', source: { kind: 'project', where: { status: { nott: 'done' } } } },
      { id: 'key', type: 'list', title: 'Key', source: { knd: 'project' } }] })])
    renderAt(<BoardPage id="f" />, '/b/f')
    await screen.findByText('echo OK')
    expect(screen.getByRole('region', { name: 'Typo' }).textContent).toBe(
      'Block “typo” cannot be read: "sorce" is not part of a block (id, type, title, source, view, text, place); Arrange can change its settings, or npm run validate:data names the fix.')
    expect(screen.getByRole('region', { name: 'Cond' }).textContent).toBe(
      'Block “cond” cannot be read: where.status: "nott" is not a condition (not, in, before, after, has); Arrange can change its settings, or npm run validate:data names the fix.')
    expect(screen.getByRole('region', { name: 'Key' }).textContent).toContain('"knd" is not part of a source (kind, section, where, sort, limit)')
    for (const name of ['Typo', 'Cond', 'Key']) expect(screen.getByRole('region', { name }).querySelector('.note-error')).not.toBeNull()
  })

  it('leaves the field names to validate:data: a field the kind may lack still draws (final review M-5)', async () => {
    routes([boardRead({ id: 'f', blocks: [echo('ok'), { id: 'l', type: 'list', title: 'Mine', source: { kind: 'project', where: { colour: 'red' } }, view: { empty: 'None red.' } }] })],
      { 'GET /api/resources': [] })
    renderAt(<BoardPage id="f" />, '/b/f')
    expect(await screen.findByText('None red.')).toBeTruthy()
  })

  it('says a board with no blocks is empty, and an unknown id is the not-found page', async () => {
    routes([boardRead({ id: 'e', blocks: [] })])
    renderAt(<BoardPage id="e" />, '/b/e')
    expect(await screen.findByText('This board has no blocks yet. Arrange adds them.')).toBeTruthy()
    routes([])
    renderAt(<BoardPage id="gone" />, '/b/gone')
    expect(await screen.findByRole('heading', { level: 1, name: 'No page at /b/gone.' })).toBeTruthy()
  })

  it('shows a staged board with the staged meta', async () => {
    routes([], { 'GET /api/changes': changeView({ ops: [{ op: 'create', record: 'boards:new', base: null, before: null,
      value: { id: 'new', name: 'New one', layout: 'flow', blocks: [] } }] }) })
    renderAt(<BoardPage id="new" />, '/b/new')
    expect((await screen.findByRole('heading', { level: 1, name: 'New one' })).textContent).toBe('New one')
    expect(screen.getByText(/staged/)).toBeTruthy()
  })

  it('previews a staged delete of an override as the built-in that returns, with a sentence (final review M-3)', async () => {
    routes([boardRead({ id: 'treasury', name: 'Ours', origin: 'instance', overrides: true, blocks: [echo('mine')] })], {
      'GET /api/boards/treasury/builtin': boardRead({ id: 'treasury', name: 'Treasury', origin: 'builtin', overrides: false, blocks: [echo('shipped'), echo('too')] }),
      'GET /api/changes': changeView({ ops: [{ op: 'delete', record: 'boards:treasury', base: 'h', before: null }] }),
    })
    renderAt(<BoardPage id="treasury" />, '/b/treasury')
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Treasury')
    expect(await screen.findByText('echo SHIPPED')).toBeTruthy()
    expect(screen.getByText(/Your change deletes this board; after Apply the built-in returns\./)).toBeTruthy()
    expect(screen.queryByText(/No page at/)).toBeNull()
  })

  it('draws a lone block bare under the page head, so the page is not named twice (R-7)', async () => {
    routes([boardRead({ id: 'one', name: 'One', blocks: [echo('only')] })])
    renderAt(<BoardPage id="one" />, '/b/one')
    await screen.findByText('echo ONLY')
    expect(screen.queryByRole('region')).toBeNull()
  })

  it("draws a lone bare block's foot itself, under the page head and outside the block (controller ruling 1)", async () => {
    routes([boardRead({ id: 'one', name: 'One', blocks: [{ id: 'only', type: 'test-foot', title: 'Only' }] })])
    renderAt(<BoardPage id="one" />, '/b/one')
    await screen.findByText('footed Only')
    const action = screen.getByRole('button', { name: 'New Only' })
    expect(screen.queryByRole('region')).toBeNull()
    expect(action.closest('[data-block]')).toBeNull()
    const head = screen.getByRole('heading', { level: 1 })
    expect(head.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("names a lone block whose page-drawn foot throws in an error note, and the page stays (final review M-2)", async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    routes([boardRead({ id: 'one', name: 'One', blocks: [{ id: 'only', type: 'test-foot-throws', title: 'Only' }] })])
    renderAt(<BoardPage id="one" />, '/b/one')
    expect(await screen.findByText('Block “Only” could not be drawn (foot boom); Arrange can remove it.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'One' })).toBeTruthy()
    expect(screen.getByText('body Only')).toBeTruthy()
    quiet.mockRestore()
  })

  it('leaves a foot in its own frame when the block shares the board', async () => {
    routes([boardRead({ id: 'two', blocks: [{ id: 'f', type: 'test-foot', title: 'Mine' }, echo('other')] })])
    renderAt(<BoardPage id="two" />, '/b/two')
    await screen.findByText('footed Mine')
    expect(screen.getAllByRole('button', { name: 'New Mine' })).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Mine' }).contains(screen.getByRole('button', { name: 'New Mine' }))).toBe(true)
  })

  it("keys a block by id and type, so a type change on the same id redraws it rather than breaking the hooks' order (controller ruling 2)", async () => {
    routes([boardRead({ id: 'k', blocks: [echo('a'), echo('b')] })])
    const { qc } = renderAt(<BoardPage id="k" />, '/b/k')
    await screen.findByText('echo A')
    await act(async () => { qc.setQueryData(['boards'], [boardRead({ id: 'k', blocks: [{ id: 'a', type: 'test-hooks', title: 'A' }, echo('b')] })]) })
    expect(await screen.findByText('hooks A')).toBeTruthy()
    expect(screen.getByText('echo B')).toBeTruthy()
  })

  // Replaces 0.6's "heads home with the org's name, the branch and clean, and ⌘K": Home is headed by its line now
  // (§14.1); ⌘K is the top bar's, the branch the tray's (ledger C6).
  it("heads home with Home's line and no ⌘K button; another board with its audience (R-5)", async () => {
    routes([boardRead({ id: 'home', name: '{org}', blocks: [echo('a'), echo('b')] }), boardRead({ id: 'pub', name: 'Public', audience: 'public', blocks: [] })],
      { 'GET /api/resources': [], 'GET /api/proposals': [], 'GET /api/jobs': [] })
    const home = renderAt(<BoardPage id="home" />, '/b/home')
    expect(await screen.findByRole('heading', { level: 1, name: 'Nothing waits on you.' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Search and run (⌘K)' })).toBeNull()
    home.unmount()
    routes([boardRead({ id: 'pub', name: 'Public', audience: 'public', blocks: [] })])
    const other = renderAt(<BoardPage id="pub" />, '/b/pub')
    await other.findByRole('heading', { level: 1, name: 'Public' })
    // C9 (E-77, ledger): a board's page head carries its from mark after its meta
    expect(other.container.querySelector('.rh .rh-meta')!.textContent).toMatch(/^public · from Fixture Org/)
  })

  it("keeps the map page's ?select=…&op=… redirect to the record page (⌘K's old address)", async () => {
    routes([boardRead({ id: 'organization', blocks: [echo('m')] })])
    const { loc } = renderAt(<BoardPage id="organization" />, '/b/organization?select=project%3Ap1&op=site%3Abuild&opLabel=Build')
    expect(loc.history.at(-1)).toBe('/r/project/p1?op=site%3Abuild&opLabel=Build')
  })

  // design pass 2026-11-04: the broken-file plate, with the file, the line and the reason the server gave
  it('shows an unreadable boards file as its plate: the file, the line and the reason (ruling R-6)', async () => {
    routes(() => new Response(JSON.stringify({ error: 'Not saved: data/boards.yaml is not valid YAML, so this app will not rewrite it: at line 3, column 1, a tab is used to indent, and YAML allows only spaces there. Nothing was written. Correct the file by hand, then try again.' }), { status: 409 }))
    renderAt(<BoardPage id="home" />, '/b/home')
    expect(await screen.findByRole('heading', { level: 2, name: 'Boards can’t be read' })).toBeTruthy()
    expect(document.querySelector('.note-error')!.textContent).toBe('Line 3 of data/boards.yaml: a tab is used to indent, and YAML allows only spaces there. Correct the file by hand, then try again.')
    expect(screen.getByRole('button', { name: 'Copy for a fix' })).toBeTruthy()
  })

  it('shows a refusal that names no file it could not read as its sentence', async () => {
    routes(() => new Response(JSON.stringify({ error: 'the boards could not be listed' }), { status: 500 }))
    renderAt(<BoardPage id="home" />, '/b/home')
    expect(await screen.findByText('the boards could not be listed')).toBeTruthy()
  })
})

describe('helpers', () => {
  it('blockCfg hands the frame title, source, view and text, never id or place', () => {
    expect(blockCfg({ id: 'x', type: 'note', text: 't', place: { col: 1, span: 3, row: 1 } })).toEqual({ title: undefined, source: undefined, view: undefined, text: 't' })
  })
  it("blockCfg fills a section's title, empty sentence, absent adapter and map, and the board's view wins (R-7)", () => {
    expect(blockCfg({ id: 'l', type: 'list', source: { section: 'crew' }, view: { switch: true, empty: 'Ours.' } })).toEqual({
      title: 'Crew', source: { section: 'crew' }, text: undefined,
      view: { empty: 'Ours.', absent: 'crew', map: 'systems', mapKey: 'crew', switch: true },
    })
  })
  it('boardTitle puts the org in {org}', () => expect(boardTitle(boardRead({ name: '{org}' }), 'Fixture Org')).toBe('Fixture Org'))
})
