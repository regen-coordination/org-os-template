// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import Palette from './Palette.tsx'
import { storedSkin } from '../skin.ts'
import Inspector from '../inspector/Inspector.tsx'
import { ViewAsBand, ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { fakeAddress } from '../elements/atoms/chain.ts'
import { Shell } from '../design/Shell.tsx'
import { useRouteFocus } from '../frame/useRouteFocus.ts'
import { useLocation } from 'wouter'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { SYSTEMS_UNREAD, baseRoutes, changeView, entryPlacedSafe, refuse, resource } from '../test/data.ts'
import { findErrorNote, heard } from '../test/notes.ts'

afterEach(() => { vi.unstubAllGlobals(); delete document.documentElement.dataset.theme; delete document.documentElement.dataset.skin; localStorage.removeItem('org-os-admin.skin') })
const buzz = resource({ id: 'module:a', kind: 'module', board: 'systems', name: 'org-os-buzz', source: null })
const routes = (over: Record<string, unknown> = {}) => fetchRoutes({
  ...baseRoutes(), 'GET /api/resources': [buzz, resource()], 'GET /api/registries': [], 'GET /api/operations': [],
  'GET /api/resources/module%3Aa': { resource: buzz, edges: [], neighbours: [] }, ...over,
})
const projects = { 'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'p1', title: 'Project one' }] } }
const open = async () => {
  fireEvent.keyDown(window, { key: 'k', metaKey: true })
  return screen.findByRole('combobox')
}
/** The empty line (§5.7), for a query. */
const nothing = (q: string) => `Nothing matches “${q}”. Try a section name, a record id or an address.`
const options = () => screen.queryAllByRole('option')
const labels = () => options().map(o => o.querySelector('.pal-l')!.textContent)
/** Waits until an option is labelled so (its matched letters are marked, so the label is no single text node). */
const listed = (label: string) => waitFor(() => expect(labels()).toContain(label))

describe('Palette', () => {
  it('opens on ⌘K, filters as you type, and Enter goes to the record', async () => {
    routes()
    const { loc } = renderAt(<Palette />, '/')
    expect(screen.queryByRole('dialog')).toBeNull()
    const input = await open()
    fireEvent.change(input, { target: { value: 'buzz' } })
    await listed('org-os-buzz')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(loc.history.at(-1)).toBe('/r/module/a')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens on Ctrl-K too, and from inside a field', async () => {
    routes()
    renderAt(<><input aria-label="Somewhere" /><Palette /></>, '/')
    const field = screen.getByLabelText('Somewhere')
    field.focus()
    fireEvent.keyDown(field, { key: 'k', ctrlKey: true })
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy()
  })

  it('is a modal dialog with the input focused', async () => {
    routes()
    renderAt(<Palette />, '/')
    const input = await open()
    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    expect(dialog.tagName).toBe('DIALOG')
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(input)
  })

  it('draws its results as a listbox driven by aria-activedescendant: focus stays in the input', async () => {
    routes()
    renderAt(<Palette />, '/')
    const input = await open()
    const list = screen.getByRole('listbox', { name: 'Results' })
    expect(input.getAttribute('aria-controls')).toBe(list.id)
    const active = () => document.getElementById(input.getAttribute('aria-activedescendant')!)!
    expect(active().getAttribute('aria-selected')).toBe('true')
    expect(active().textContent).toContain('Home')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(active().textContent).toContain('Needs you')
    expect(options().filter(o => o.getAttribute('aria-selected') === 'true')).toEqual([active()])
    expect(document.activeElement).toBe(input)
  })

  it('its scrolling list holds focusable content: each option is focusable from script, out of the tab order (axe scrollable-region-focusable; walk 2026-11-04, L4c-fix 6)', async () => {
    routes()
    renderAt(<Palette />, '/')
    const input = await open()
    expect(options().length).toBeGreaterThan(0)
    expect(options().every(o => o.getAttribute('tabindex') === '-1')).toBe(true)
    // ↑↓ still move the active option, scrolled into view, while focus stays in the input
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(input)
  })

  it('groups appear in the order Jump to, Records, Actions, Views', async () => {
    routes()
    renderAt(<Palette />, '/')
    await open()
    await listed('org-os-buzz')
    const groups = within(screen.getByRole('listbox')).getAllByRole('group')
    expect(groups.map(g => g.getAttribute('aria-label') ?? document.getElementById(g.getAttribute('aria-labelledby')!)!.textContent))
      .toEqual(['Jump to', 'Records', 'Actions', 'Views'])
  })

  it('wraps the matched letters in <mark>, and shows a section’s g-keys', async () => {
    routes()
    renderAt(<Palette />, '/')
    const input = await open()
    fireEvent.change(input, { target: { value: 'tre' } })
    const treasury = options().find(o => o.querySelector('.pal-l')!.textContent === 'Treasury')!
    expect([...treasury.querySelectorAll('mark')].map(m => m.textContent)).toEqual(['Tre'])
    expect([...treasury.querySelectorAll('kbd')].map(k => k.textContent)).toEqual(['g', 't'])
  })

  it('Tab cycles the scope chip: All → the current section → In this page', async () => {
    routes()
    renderAt(<Palette />, '/governance/proposals')
    const input = await open()
    const chip = () => screen.getByTestId('pal-scope').textContent
    expect(chip()).toContain('All')
    expect(labels()).toContain('Home')
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false)
    expect(chip()).toContain('Proposals')
    await waitFor(() => expect(labels()).toEqual(expect.arrayContaining(['Proposals', 'Rules', 'Decisions'])))
    expect(labels()).not.toContain('Home')
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(chip()).toContain('In this page')
    expect(labels()).toEqual(['Proposals'])
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(chip()).toContain('All')
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
    expect(chip()).toContain('In this page')
  })

  it('says the scope it moves to when Tab cycles it (L4a final review M-19)', async () => {
    routes()
    renderAt(<Palette />, '/governance/proposals')
    const input = await open()
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(screen.getByTestId('live').textContent).toBe('Scope: Proposals')
    expect(screen.getByTestId('pal-scope').textContent).toBe('Scope: Proposals')
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(screen.getByTestId('live').textContent).toBe('Scope: In this page')
  })

  it('⌘Enter opens the record in the inspector without leaving the page', async () => {
    routes()
    const { loc } = renderAt(<><Palette /><Inspector /></>, '/b/projects')
    const input = await open()
    fireEvent.change(input, { target: { value: 'buzz' } })
    await listed('org-os-buzz')
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
    expect(await screen.findByRole('complementary', { name: 'org-os-buzz inspector' })).toBeTruthy()
    expect(loc.history).toEqual(['/b/projects'])
  })

  it('closes on Escape, and the page under it does not act on that Escape (Review Focus 1)', async () => {
    routes()
    renderAt(<Palette />)
    await open()
    const seen = vi.fn()
    document.addEventListener('keydown', seen)
    window.addEventListener('keydown', seen) // bubble: what the inspector and the editor listen with
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(false) // marked handled
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(seen).not.toHaveBeenCalled() // and stopped before anything under it
    document.removeEventListener('keydown', seen)
    window.removeEventListener('keydown', seen)
  })

  // A11 review I-1: while the palette is modal its opener is inert; Escape closes the dialog before focus goes back.
  it('on Escape the dialog is closed before focus returns to where it was', async () => {
    routes()
    renderAt(<><button type="button">Before</button><Palette /></>)
    const before = screen.getByRole('button', { name: 'Before' })
    before.focus()
    await open()
    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    const openWhenFocused: boolean[] = []
    vi.spyOn(before, 'focus').mockImplementation(() => { openWhenFocused.push(dialog.hasAttribute('open')) })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(openWhenFocused).toEqual([false])
  })

  it('opens when Home asks, through the open-palette event', async () => {
    routes()
    renderAt(<Palette />)
    act(() => { window.dispatchEvent(new Event('open-palette')) })
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy()
  })

  it('Toggle dark switches the theme for this browser', async () => {
    routes()
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    renderAt(<Palette />)
    const input = await open()
    fireEvent.change(input, { target: { value: 'toggle dark' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  // C9 (E-75, ledger): the house skin's label is the Hub's; its id stays house
  it('Skin: Hub switches the skin for this browser', async () => {
    routes()
    renderAt(<Palette />)
    const input = await open()
    fireEvent.change(input, { target: { value: 'skin hub' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(document.documentElement.dataset.skin).toBe('house')
    expect(storedSkin()).toBe('house')
  })

  it('"View as Public" is an action: it starts the preview', async () => {
    routes()
    renderAt(<ViewAsProvider><ViewAsBand /><Palette /></ViewAsProvider>)
    const input = await open()
    fireEvent.change(input, { target: { value: 'view as public' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('status').textContent).toContain('Previewing as Public.')
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull()
  })

  it('previewing as Public, records the viewer may not see are not listed and not counted; no "hidden" line', async () => {
    const open1 = resource({ id: 'project:open', name: 'Open garden', facts: { visibility: 'public' } })
    const closed = resource({ id: 'project:closed', name: 'Council garden', facts: {} })
    routes({ 'GET /api/resources': [open1, closed], 'GET /api/operations': [{ op: 'p.run', label: 'Run', resource: 'project:open', resourceName: 'Open garden', board: 'organization', confirm: false, preset: null }] })
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><Palette /></ViewAsProvider>)
    const input = await open()
    fireEvent.change(input, { target: { value: 'garden' } })
    await waitFor(() => expect(labels()).toEqual(['Open garden']))
    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    expect(dialog.textContent).not.toMatch(/hidden|Council garden/i)
    // and nothing that writes: no operation, while previewing (C-23)
    fireEvent.change(input, { target: { value: 'run' } })
    expect(labels()).not.toContain('Run on Open garden')
  })

  it('a full address pasted finds the System that holds it', async () => {
    const safe = resource({ id: 'system:treasury-safe', kind: 'system', name: 'Treasury Safe', source: null, facts: { driver: 'safe', address: fakeAddress(3) } })
    routes({ 'GET /api/resources': [buzz, safe] })
    renderAt(<Palette />)
    const input = await open()
    fireEvent.change(input, { target: { value: fakeAddress(3) } })
    await waitFor(() => expect(labels()).toEqual(['Treasury Safe']))
  })

  it('Edit this record and Go to map act on the record you are on', async () => {
    routes({ 'GET /api/resources': [resource()], ...projects })
    const { loc } = renderAt(<Palette />, '/r/project/p1')
    let input = await open()
    fireEvent.change(input, { target: { value: 'edit this' } })
    await listed('Edit this record') // offered once the registry and the actor have loaded
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(loc.history.at(-1)).toBe('/r/project/p1?edit=1')
    input = await open()
    fireEvent.change(input, { target: { value: 'go to map' } })
    await listed('Go to map')
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(1))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(loc.history.at(-1)).toBe('/b/organization?select=project%3Ap1')
  })

  it('Apply changes hands the apply to the tray', async () => {
    routes(baseRoutes({ 'GET /api/changes': changeView({ ops: [{ op: 'update', record: 'projects:p1', set: { title: 'x' }, base: 'h', before: { title: 'y' } }] }) }))
    const asked = vi.fn()
    window.addEventListener('apply-changes', asked)
    renderAt(<Palette />)
    const input = await open()
    fireEvent.change(input, { target: { value: 'apply changes' } })
    await listed('Apply changes') // offered once the staged change has loaded
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(asked).toHaveBeenCalled()
    window.removeEventListener('apply-changes', asked)
  })

  // design pass 2026-11-04: "new" lists New <kind> for each section you can add to, then New board; none previewing
  it('typing "new" lists New <kind> for each section you can add to, then New board, which opens its sheet', async () => {
    routes({ 'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 1 }, { name: 'ideas', kind: 'collection', count: 0 }] })
    const { loc } = renderAt(<Palette />, '/')
    const input = await open()
    fireEvent.change(input, { target: { value: 'new' } })
    await listed('New board')
    expect(labels()).toEqual(['New project', 'New idea', 'New board'])
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(loc.history.at(-1)).toBe('/boards?new=1')
  })

  it('previewing, lists nothing to make', async () => {
    routes({ 'GET /api/registries': [{ name: 'projects', kind: 'collection', count: 1 }] })
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><Palette /></ViewAsProvider>, '/')
    const input = await open()
    fireEvent.change(input, { target: { value: 'new' } })
    await waitFor(() => expect(screen.getByText(nothing('new'))).toBeTruthy())
  })

  it('says so when nothing matches, in one line', async () => {
    routes()
    renderAt(<Palette />)
    const input = await open()
    fireEvent.change(input, { target: { value: 'hatt' } })
    expect(await screen.findByText(nothing('hatt'))).toBeTruthy() // not before the lists have arrived (C16)
    expect(options()).toEqual([])
  })

  it('says Loading rather than Nothing matches while the lists are on their way (C16)', async () => {
    routes({ 'GET /api/resources': () => new Promise<Response>(() => {}) })
    renderAt(<Palette />)
    const input = await open()
    fireEvent.change(input, { target: { value: 'nothing like this' } })
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByText(nothing('nothing like this'))).toBeNull()
  })

  it('shows the error, not an empty line, when a list fails (C16)', async () => {
    routes({ 'GET /api/operations': refuse(500, { error: 'operations are down' }) })
    renderAt(<Palette />)
    const input = await open()
    fireEvent.change(input, { target: { value: 'nothing like this' } })
    expect(await findErrorNote()).toBeTruthy()
    expect(screen.queryByText(nothing('nothing like this'))).toBeNull()
  })

  it("says a list that failed once through the page's polite region while it is open: its note is no alert (§13, C11)", async () => {
    routes({ 'GET /api/operations': refuse(500, { error: 'operations are down' }) })
    const ear = heard()
    try {
      renderAt(<Palette />)
      await open()
      await waitFor(() => expect(ear.said).toEqual(['operations are down']))
      expect(document.querySelector('.note-error')!.closest('[role="alert"]')).toBeNull()
    } finally { ear.stop() }
  })

  it('does not offer Edit this record where the record page would not (C11)', async () => {
    routes({ 'GET /api/resources': [resource()], 'GET /api/actor': { unknown: 'me@x.org' }, ...projects })
    renderAt(<Palette />, '/r/project/p1')
    const input = await open()
    fireEvent.change(input, { target: { value: 'edit' } })
    await waitFor(() => expect(screen.getByText(nothing('edit'))).toBeTruthy())
  })

  it('does not offer Edit on a page that is not a record', async () => {
    routes({ 'GET /api/resources': [resource()], ...projects })
    renderAt(<Palette />, '/b/projects')
    const input = await open()
    fireEvent.change(input, { target: { value: 'edit this' } })
    await screen.findByText(nothing('edit this'))
  })

  it('an operation opens on its record page through the ?op= deep link', async () => {
    routes({ 'GET /api/operations': [{ op: 'role.seat', label: 'Seat platform', resource: 'role:platform', resourceName: 'platform', board: 'systems', confirm: true, preset: null }] })
    const { loc } = renderAt(<Palette />)
    const input = await open()
    fireEvent.change(input, { target: { value: 'seat plat' } })
    await listed('Seat platform on platform')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(loc.history.at(-1)).toBe('/r/role/platform?op=role.seat&opLabel=Seat+platform')
  })

  it('Discard changes hands the discard to the tray', async () => {
    routes(baseRoutes({ 'GET /api/changes': changeView({ ops: [{ op: 'update', record: 'projects:p1', set: { title: 'x' }, base: 'h', before: { title: 'y' } }] }) }))
    const asked = vi.fn()
    window.addEventListener('discard-changes', asked)
    renderAt(<Palette />)
    const input = await open()
    fireEvent.change(input, { target: { value: 'discard changes' } })
    await listed('Discard changes')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(asked).toHaveBeenCalled()
    window.removeEventListener('discard-changes', asked)
  })

  it('the foot shows ↑↓ move · ↵ open · ⌘↵ in inspector · esc close', async () => {
    routes()
    renderAt(<Palette />)
    await open()
    const foot = screen.getByRole('dialog').querySelector('.pal-foot')!
    expect([...foot.children].map(s => s.textContent).join(' · ')).toBe('↑↓ move · ↵ open · ⌘↵ in inspector · esc close')
  })

  it('a jump is a real navigation: focus lands on the new page’s h1 (§5.11, R-23)', async () => {
    routes()
    function Page() {
      const [path] = useLocation()
      useRouteFocus(path, 'Org')
      return <h1>{path === '/' ? 'Home' : 'Proposals'}</h1>
    }
    const { loc } = renderAt(<Shell title="t" width={1440} nav={<button type="button">In the sidebar</button>} top={<Palette />}><Page /></Shell>, '/')
    screen.getByRole('button', { name: 'In the sidebar' }).focus()
    const input = await open()
    fireEvent.change(input, { target: { value: 'proposals' } })
    await listed('Proposals')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(loc.history.at(-1)).toBe('/governance/proposals')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Proposals' })))
  })

  it('⌘K twice ends where it began: closed', async () => {
    routes()
    renderAt(<Palette />, '/')
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

// D-12 (operator, 2026-11-04): ⌘K listed a record by a name the gate marks restricted, and found it by that name, though
// its cells, cards and maps read "<hat> only" (rule 3, E-70). The palette reads each record's file entry, as they do.
describe('a restricted name in the palette (D-12)', () => {
  const seed = resource({ id: 'project:p1', name: 'Seed Library' })
  const kept = { 'GET /api/registries/projects': { name: 'projects', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'p1', restricted: { name: 'hat:ops' } }] } }
  const dialog = () => screen.getByRole('dialog', { name: 'Command palette' })

  it('lists the record under "Ops only", and typing its hidden name finds nothing', async () => {
    routes({ 'GET /api/resources': [seed], ...kept })
    renderAt(<Palette />)
    const input = await open()
    fireEvent.change(input, { target: { value: 'ops only' } })
    await listed('Ops only')
    expect(dialog().textContent).not.toContain('Seed Library')
    fireEvent.change(input, { target: { value: 'seed' } })
    await screen.findByText(nothing('seed'))
    expect(labels()).toEqual([])
  })

  it('names an operation on it "… on Ops only", and its hidden name does not find the operation', async () => {
    routes({ 'GET /api/resources': [seed], ...kept,
      'GET /api/operations': [{ op: 'p.run', label: 'Run', resource: 'project:p1', resourceName: 'Seed Library', board: 'organization', confirm: false, preset: null }] })
    renderAt(<Palette />)
    const input = await open()
    fireEvent.change(input, { target: { value: 'run' } })
    await listed('Run on Ops only')
    expect(dialog().textContent).not.toContain('Seed Library')
    fireEvent.change(input, { target: { value: 'run seed' } })
    await screen.findByText(nothing('run seed'))
  })

  it('lists no record by its raw name while its entry is on its way', async () => {
    const { calls } = routes({ 'GET /api/resources': [seed], 'GET /api/registries/projects': () => new Promise(() => {}) })
    renderAt(<Palette />)
    const input = await open()
    fireEvent.change(input, { target: { value: 'seed' } })
    await waitFor(() => expect(calls.some(c => c.path === '/api/registries/projects')).toBe(true))
    await waitFor(() => expect(calls.some(c => c.path === '/api/resources')).toBe(true))
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    expect(labels()).toEqual([])
    expect(dialog().textContent).not.toContain('Seed Library')
  })
})

// review I-2's follow-up: a system is placed in Treasury, Sources or Outside systems by its data/systems.yaml entry
describe('Palette before data/systems.yaml answered', () => {
  for (const [what, answer] of SYSTEMS_UNREAD) {
    it(`lists no section by a system while data/systems.yaml ${what}: the treasury's Safe is not taken for an outside system`, async () => {
      routes({ 'GET /api/resources': [entryPlacedSafe, resource()], 'GET /api/registries/systems': answer })
      renderAt(<Palette />, '/')
      await open()
      await listed('Projects')
      expect(labels()).not.toContain('Outside systems')
    })
  }
})
