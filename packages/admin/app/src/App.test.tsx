// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import App from './App.tsx'
import { fetchRoutes } from './test/fetchRoutes.ts'
import { renderAt } from './test/render.tsx'
import { baseRoutes, changeView, resource } from './test/data.ts'
import { flowEnv } from './test/flowEnv.ts'

/** The order App.tsx's Switch tries its routes: the fixed paths before `/:section`, and a part or a
 *  board that does not exist reads as the not-found page, never as an empty page. */
const title = () => screen.findByRole('heading', { level: 1 })

beforeEach(() => {
  vi.stubGlobal('WebSocket', class { onmessage = null; close() {} })
  fetchRoutes({
    ...baseRoutes(),
    'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 0 }],
    'GET /api/resources': [],
  })
})

describe('the routes, in the order App.tsx tries them', () => {
  it('/all is All records, not a section called "all"', async () => {
    renderAt(<App />, '/all')
    expect((await title()).textContent).toBe('All records')
  })

  it('/ is the home board', async () => {
    const { loc } = renderAt(<App />, '/')
    await waitFor(() => expect(loc.history.at(-1)).toBe('/b/home'))
  })

  // C6 (E-33, ledger): the `/systems` half of this case is gone — /systems is the Hub's Systems page now, tried before
  // /:section, and no longer a redirect to /b/outside-systems.
  it('/:section goes to its board, keeping ?select=', async () => {
    const { loc } = renderAt(<App />, '/projects?select=project%3Ap1')
    await waitFor(() => expect(loc.history.at(-1)).toBe('/b/projects?select=project%3Ap1'))
  })

  it.each([['/needs', 'Needs you'], ['/systems', 'Systems'], ['/roles', 'Roles'], ['/workspace', 'Workspace']])('%s is the Hub’s own page, before /:section', async (path, name) => {
    const { loc } = renderAt(<App />, path)
    expect((await screen.findByRole('heading', { level: 1, name })).textContent).toBe(name)
    expect(loc.history.at(-1)).toBe(path)
  })

  // C9 (E-73, ledger): the not-found page is a note block, "No page at /x.", with the ⌘K hint; 0.6 said "Not here"
  it.each([['/nowhere', '/nowhere'], ['/governance/x', '/governance/x'], ['/maps/x', '/b/x']])('%s (an unknown section, part or map) is the not-found page', async (path, lands) => {
    renderAt(<App />, path)
    // a board's first frame draws its heading too (§6.2): wait for the not-found page's
    const h = await screen.findByRole('heading', { level: 1, name: `No page at ${lands}.` })
    expect(h.textContent).toBe(`No page at ${lands}.`)
    const block = h.closest('.note-block')!
    expect(block).not.toBeNull()
    expect(block.textContent).toContain('⌘K finds every page, record and command.')
    expect(block.querySelector('kbd')!.textContent).toBe('⌘K')
  })

  it('/changes is the Changes page, not a section (L4a-R22): the tray drawn whole, and no dock under it', async () => {
    fetchRoutes({ ...baseRoutes({ 'GET /api/changes': changeView({ ops: [{ op: 'update', record: 'projects:p1', set: { status: 'execute' }, base: 'h', before: { name: 'P one', status: 'develop' } }] }) }),
      'GET /api/registries': [], 'GET /api/resources': [] })
    renderAt(<App />, '/changes')
    expect((await title()).textContent).toBe('Changes')
    expect(await screen.findByRole('group', { name: 'Your change' })).toBeTruthy()
    expect(screen.getAllByRole('region', { name: 'Changes' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull()
  })

  // C7 (ledger, E-59): "/governance goes to its rules" — /governance is the Proposals section, its first tab Open.
  it('/governance goes to its proposals: the Proposals page, the Open tab chosen', async () => {
    const { loc } = renderAt(<App />, '/governance')
    await waitFor(() => expect(loc.history.at(-1)).toBe('/governance/proposals'))
    expect((await title()).textContent).toBe('Proposals')
    expect((await screen.findByRole('tab', { name: /^Open/ })).getAttribute('aria-selected')).toBe('true')
  })

  it('/b/systems?select=<id> opens the inspector on that record', async () => {
    flowEnv()
    const mod = resource({ id: 'module:a', kind: 'module', board: 'systems', name: 'org-os-buzz', source: null })
    fetchRoutes({ ...baseRoutes(), 'GET /api/registries': [], 'GET /api/resources': [mod],
      'GET /api/graph/systems': { board: 'systems', nodes: [mod], edges: [], portals: [] },
      'GET /api/layout/systems': {}, 'GET /api/jobs': [], 'GET /api/operations': [],
      'GET /api/resources/module%3Aa': { resource: mod, edges: [], neighbours: [] } })
    renderAt(<App />, '/b/systems?select=module%3Aa')
    expect(await screen.findByRole('complementary', { name: 'org-os-buzz inspector' })).toBeTruthy()
  })

  it('/maps/systems?select=<id>&op=<op> still goes to the record page (R-7)', async () => {
    const { loc } = renderAt(<App />, '/maps/systems?select=module%3Aa&op=module.checks&opLabel=Re-run+checks')
    await waitFor(() => expect(loc.history.at(-1)).toBe('/r/module/a?op=module.checks&opLabel=Re-run+checks'))
  })
})

describe('the right slot while previewing (L4a final review M-6)', () => {
  it('a Propose panel open when a preview starts closes: no write form under "Nothing can be changed here"', async () => {
    const op = { op: 'update' as const, record: 'projects:p1', set: { status: 'execute' }, base: 'h', before: { status: 'develop' } }
    fetchRoutes({
      ...baseRoutes({ 'GET /api/changes': changeView({ ops: [op], classes: ['records'], rule: { direct: false, proposable: true, sentence: 'Propose it.', source: 'data/governance.yaml: records' } }) }),
      'GET /api/registries': [], 'GET /api/resources': [],
    })
    renderAt(<App />, '/all')
    const tray = await screen.findByRole('region', { name: 'Changes' })
    fireEvent.click(within(tray).getByRole('button', { name: 'Propose' }))
    expect(await screen.findByRole('complementary', { name: 'Propose' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^View as/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Public' }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Propose' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Exit preview' }))
    expect(screen.queryByRole('complementary', { name: 'Propose' })).toBeNull()
  })
})

describe('the path while previewing (C11)', () => {
  it('names a record the viewer may not see by its id, never by its title', async () => {
    fetchRoutes({
      ...baseRoutes(), 'GET /api/registries': [],
      'GET /api/resources': [resource({ id: 'project:p1', kind: 'project', name: 'Seed Library', source: null })],
    })
    renderAt(<App />, '/r/project/p1')
    // the path's last place titles the document and the bar, in every frame (the top bar's path, the phone bar's title)
    const path = () => document.title
    await waitFor(() => expect(path()).toContain('Seed Library'))
    fireEvent.click(screen.getByRole('button', { name: /^View as/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Public' }))
    await waitFor(() => expect(path()).not.toContain('Seed Library'))
  })
})

// D-12 (operator, 2026-11-04): the path's last place titles the document and the bar; a name the gate marks restricted
// printed there raw, though the record's cells, cards and maps read "<hat> only" (rule 3, E-70).
describe('a restricted name in the path (D-12)', () => {
  it('titles the document and names the path’s last place "Ops only", never the name the gate keeps', async () => {
    fetchRoutes({
      ...baseRoutes(), 'GET /api/registries': [],
      'GET /api/resources': [resource({ id: 'project:p1', kind: 'project', name: 'Seed Library' })],
      'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'p1', restricted: { name: 'hat:ops' } }] },
    })
    renderAt(<App />, '/r/project/p1')
    await waitFor(() => expect(document.title).toContain('Ops only'))
    expect(document.title).not.toContain('Seed Library')
    // the bar's last place in whichever frame is drawn: the top bar's path, or the phone bar's title
    const bar = document.querySelector('.crumbs [aria-current="page"], .ptop-t')!
    expect(bar.textContent).toBe('Ops only')
    expect(document.querySelector('.frame-top, .tb, .ptop')?.textContent ?? '').not.toContain('Seed Library')
  })
})

// C9 (§14.1, E-75): the Skin select left the frame (Appearance is the org switcher's); while two skins ship, ⌘K still
// offers them, "Skin: Bare" among them. SkinPicker.tsx and its test are deleted (ledger).
describe('the skins', () => {
  it('are not a select in the frame, and ⌘K offers Skin: Bare and Skin: Hub', async () => {
    renderAt(<App />, '/all')
    await screen.findByRole('heading', { level: 1, name: 'All records' })
    expect(screen.queryByRole('combobox', { name: 'Skin' })).toBeNull()
    expect(document.querySelector('.nav-skin')).toBeNull()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    fireEvent.change(await screen.findByRole('combobox', { name: /^Search/ }), { target: { value: 'skin' } })
    await waitFor(() => expect([...document.querySelectorAll('.pal-o .pal-l')].map(l => l.textContent)).toEqual(['Skin: Bare', 'Skin: Hub']))
  })
})
