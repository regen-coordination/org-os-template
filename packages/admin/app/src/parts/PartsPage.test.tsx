// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, screen, within } from '@testing-library/react'
import PartsPage, { PartsGroupPage } from './PartsPage.tsx'
import { NotDrawn, PARTS_GROUPS } from './groups/index.ts'
import { GROUPS } from './groups/list.ts'
import { blockTypes } from '../blocks/index.ts'
import { FIXED_NOW } from '../test/fixtures/parts.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { flowEnv } from '../test/flowEnv.ts'
import Inspector from '../inspector/Inspector.tsx'

const IDS = ['tokens', 'frame', 'controls', 'atoms', 'rows', 'needs', 'views', 'map', 'map-compose', 'gov', 'gov-roles', 'work', 'lib', 'tray', 'door', 'blocks', 'machines']

describe('/parts, the index', () => {
  it('links every group in order', async () => {
    flowEnv()
    const { calls } = fetchRoutes({})
    renderAt(<PartsPage />, '/parts')
    expect(await screen.findByRole('heading', { level: 1, name: 'Parts' })).toBeTruthy()
    expect(PARTS_GROUPS.map(g => g.id)).toEqual(IDS)
    const links = within(screen.getByRole('navigation', { name: 'Part groups' })).getAllByRole('link')
    expect(links.map(a => a.getAttribute('href'))).toEqual(IDS.map(id => `/parts/${id}`))
    expect(links.map(a => a.textContent)).toEqual(PARTS_GROUPS.map(g => g.label))
    expect(calls).toEqual([])
  })

  it('marks drawn the groups that have a component, so the screen harness shoots exactly those', () => {
    expect(PARTS_GROUPS.filter(g => g.Component !== NotDrawn).map(g => g.id)).toEqual(GROUPS.filter(g => g.drawn).map(g => g.id))
    expect(GROUPS.map(g => [g.id, g.label])).toEqual(PARTS_GROUPS.map(g => [g.id, g.label]))
  })

  it('says its values are fixtures', async () => {
    renderAt(<PartsPage />, '/parts')
    await screen.findByRole('heading', { level: 1, name: 'Parts' })
    expect(document.body.textContent).toMatch(/Fixture values/)
    expect(document.body.textContent).toContain(FIXED_NOW.toISOString().slice(0, 16))
  })
})

describe('/parts/:group', () => {
  it('every group of the gallery is drawn now; one not drawn would be a note, so the index stays complete (C3)', async () => {
    expect(GROUPS.filter(g => !g.drawn)).toEqual([])
    renderAt(<PartsGroupPage id="work" />, '/parts/work')
    expect(await screen.findByRole('heading', { level: 1, name: 'Workspace' })).toBeTruthy()
    expect(document.body.textContent).toMatch(/Fixture values/)
    renderAt(<NotDrawn />)
    expect(screen.getByRole('note').textContent).toBe('Not drawn yet.')
  })

  it('a group page is the gallery’s width: its head and group inside pg-page, capped by --w-parts in both skins (R-12)', async () => {
    renderAt(<PartsGroupPage id="atoms" />, '/parts/atoms')
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Data atoms' })
    expect(h1.closest('.pg-page')).not.toBeNull()
    expect(document.querySelector('.pg-page .pg-grid')).not.toBeNull()
    const design = join(dirname(fileURLToPath(import.meta.url)), '..', 'design')
    expect(readFileSync(join(design, 'css', 'parts.css'), 'utf8')).toContain('var(--w-parts)')
    for (const skin of ['house', 'bare']) expect(readFileSync(join(design, 'skins', `${skin}.css`), 'utf8'), skin).toMatch(/--w-parts: 1272px;/)
  })

  it('an unknown group is the not-found note', async () => {
    renderAt(<PartsGroupPage id="nope" />, '/parts/nope')
    expect(await screen.findByRole('heading', { level: 1, name: 'No page at /parts/nope.' })).toBeTruthy()
  })

  // The 0.6 case "shows every part from fixtures, and sends no request at all" drew one long /parts; the
  // same parts now live under /parts/blocks and /parts/machines (ledgered, A4).
  it('blocks: every 0.6 part from fixtures, and no request at all', async () => {
    flowEnv()
    const { calls } = fetchRoutes({})
    renderAt(<PartsGroupPage id="blocks" />, '/parts/blocks')
    expect(await screen.findByRole('heading', { level: 1, name: 'Blocks' })).toBeTruthy()
    // The library and wizard specimens moved to /parts/lib (C4b, E-25; ledgered): Blocks no longer draws them.
    for (const label of ['Primitives', 'Marks', 'Cards', 'Proposals', 'Block states', 'Block contracts']) expect(screen.getByRole('region', { name: label })).toBeTruthy()
    for (const label of ['Library', 'Wizard']) expect(screen.queryByRole('region', { name: label })).toBeNull()
    for (const def of blockTypes()) {
      for (const state of ['loading', 'ready', 'empty', 'error', 'notYet', 'unavailable']) {
        expect(document.querySelector(`[data-block="${def.type}-${state}"]`)).toBeTruthy()
      }
    }
    // the proposal parts, in every state a person meets
    const proposals = screen.getByRole('region', { name: 'Proposals' })
    expect([...proposals.querySelectorAll('.rst')].map(e => e.className.replace('rst rst-', ''))).toEqual(['met', 'waiting', 'waiting', 'held', 'failed', 'expired'])
    expect(proposals.querySelectorAll('.evt').length).toBe(15)
    expect(proposals.querySelector('[data-event="e-c"] .evt-d')!.textContent).toMatch(/harms the aim/)
    // C10 (ledger; E-84): the row and tile densities are gone with their callers; each proposal is its fields card
    expect(proposals.querySelectorAll('.card.full').length).toBe(3)
    expect(screen.getByRole('region', { name: 'Cards' }).querySelectorAll('.card.full').length).toBe(3)
    await new Promise(r => setTimeout(r, 50))
    expect(calls).toEqual([])
  })

  it('machines: every machine drawn, and no request', async () => {
    flowEnv()
    const { calls } = fetchRoutes({})
    renderAt(<PartsGroupPage id="machines" />, '/parts/machines')
    expect(await screen.findByRole('heading', { level: 1, name: 'Machines' })).toBeTruthy()
    for (const m of ['change', 'proposal', 'job', 'reading', 'board', 'editor', 'block', 'arrange', 'drop', 'panels', 'tray', 'palette', 'libraryEntry', 'wizard']) {
      expect(screen.getByRole('table', { name: `${m} transitions` })).toBeTruthy()
    }
    await new Promise(r => setTimeout(r, 50))
    expect(calls).toEqual([])
  })

  it('keeps a click on a map node or a list row on the page: nothing selected, nowhere gone, nothing read (M-7)', async () => {
    flowEnv()
    const { calls } = fetchRoutes({})
    const { loc } = renderAt(<><PartsGroupPage id="blocks" /><Inspector /></>, '/parts/blocks')
    await screen.findByRole('heading', { level: 1, name: 'Blocks' })
    const list = document.querySelector('[data-block="list-ready"]') as HTMLElement
    const row = list.querySelector('tbody tr') as HTMLElement
    fireEvent.click(row.querySelector('td:nth-child(2)')!)
    fireEvent.keyDown(list.querySelector('table')!, { key: 'Enter' })
    const map = document.querySelector('[data-block="map-ready"]') as HTMLElement
    await waitFor(() => expect(map.querySelector('[data-node-id="project:site"]')).not.toBeNull())
    const node = map.querySelector('[data-node-id="project:site"]')!.closest('.react-flow__node') as HTMLElement
    fireEvent.click(node)
    fireEvent.keyDown(node, { key: 'Enter' })
    await new Promise(r => setTimeout(r, 50))
    expect(loc.history).toEqual(['/parts/blocks'])
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(calls).toEqual([])
  })
})

// walk 2026-11-04, L4c-fix 14: /parts/work, /tray and /door drew 3, 6 and 2 h1 — the elements' page headings, drawn
// inside the gallery's cards. A group page has one h1, its own; a specimen's page heading sits under its card's cap.
describe('/parts/:group has one h1', () => {
  for (const id of ['work', 'tray', 'door']) {
    it(`/parts/${id}`, async () => {
      flowEnv()
      fetchRoutes({})
      renderAt(<PartsGroupPage id={id} />, `/parts/${id}`)
      await screen.findByRole('heading', { level: 1, name: GROUPS.find(g => g.id === id)!.label })
      await waitFor(() => expect(document.querySelectorAll('.pg-card').length).toBeGreaterThan(0))
      expect(document.querySelectorAll('h1').length).toBe(1)
    })
  }
})

