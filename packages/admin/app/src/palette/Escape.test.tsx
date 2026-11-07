// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { Route, Switch } from 'wouter'
import Palette from './Palette.tsx'
import Inspector from '../inspector/Inspector.tsx'
import { useInspector } from '../inspector/InspectorContext.tsx'
import { Shell } from '../design/Shell.tsx'
import RecordPage from '../pages/Record.tsx'
import { safeDecode } from '../hrefs.ts'
import { renderAt } from '../test/render.tsx'
import { projectRoutes } from '../test/record.tsx'

const Opener = () => { const { open } = useInspector(); return <button type="button" onClick={() => open('project:p1')}>Open inspector</button> }
/** App.tsx's parts: the Shell with the inspector as its aside, and the palette (App.tsx draws it in the frame's top;
 *  the Escape stack is the panels', so where it sits does not change the order). The frame is 1440 wide, so the
 *  inspector sits beside the page, not modal (B9: under 1200 it is a sheet; jsdom's window is 1024). */
const app = () => renderAt(
  <>
    <Shell title="t" nav={<Opener />} aside={<Inspector />} width={1440}>
      <Switch><Route path="/r/:kind/:id">{p => <RecordPage kind={safeDecode(p.kind)} id={safeDecode(p.id)} />}</Route></Switch>
    </Shell>
    <Palette />
  </>, '/r/project/p1')
const inspector = () => screen.queryByRole('complementary', { name: 'Seed Library inspector' })
const openInspector = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Open inspector' }))
  await screen.findByRole('complementary', { name: 'Seed Library inspector' })
}
const lists = { 'GET /api/resources': [], 'GET /api/registries': [] }
const askForPalette = () => act(() => { window.dispatchEvent(new Event('open-palette')) })

describe('Escape, in the order App.tsx registers its listeners', () => {
  it('one Escape closes the palette and leaves the inspector open; a second closes the inspector', async () => {
    projectRoutes(lists)
    app()
    await screen.findByRole('heading', { level: 1, name: 'Seed Library' })
    await openInspector()
    askForPalette()
    await screen.findByRole('dialog', { name: 'Command palette' })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(inspector()).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(inspector()).toBeNull()
  })

  it('Escape in the record editor cancels the edit and does not close the inspector', async () => {
    projectRoutes()
    app()
    await screen.findByRole('heading', { level: 1, name: 'Seed Library' })
    await openInspector()
    fireEvent.keyDown(document.body, { key: 'e' })
    await screen.findByLabelText('Title')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByLabelText('Title')).toBeNull()
    expect(inspector()).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(inspector()).toBeNull()
  })

  it('an open palette takes the Escape before an open editor does', async () => {
    projectRoutes(lists)
    app()
    await screen.findByRole('heading', { level: 1, name: 'Seed Library' })
    fireEvent.keyDown(document.body, { key: 'e' })
    await screen.findByLabelText('Title')
    askForPalette()
    await screen.findByRole('dialog', { name: 'Command palette' })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByLabelText('Title')).toBeTruthy()
  })
})

describe('focus and the list', () => {
  it('returns focus to what had it, whichever way the palette closes, and Tab stays inside', async () => {
    projectRoutes(lists)
    app()
    const opener = await screen.findByRole('button', { name: 'Open inspector' })
    for (const close of [
      (input: HTMLElement) => fireEvent.keyDown(input, { key: 'Escape' }),
      (input: HTMLElement) => fireEvent.keyDown(input, { key: 'k', metaKey: true }),
      (input: HTMLElement) => { fireEvent.change(input, { target: { value: 'toggle dark' } }); fireEvent.keyDown(input, { key: 'Enter' }) },
      () => fireEvent.mouseDown(screen.getByRole('dialog', { name: 'Command palette' })), // the scrim: the dialog itself, around the panel
    ]) {
      opener.focus()
      askForPalette()
      const input = await screen.findByRole('combobox')
      expect(document.activeElement).toBe(input)
      expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false) // default prevented: focus does not leave
      expect(fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })).toBe(false)
      close(input)
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(document.activeElement).toBe(opener)
    }
    delete document.documentElement.dataset.theme
  })

  it('ArrowDown on an empty list stays at the first row, and the selection follows a shrinking list', async () => {
    projectRoutes(lists)
    app()
    askForPalette()
    const input = await screen.findByRole('combobox')
    expect(input.getAttribute('aria-autocomplete')).toBe('list')
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(3))
    for (let i = 0; i < 5; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.change(input, { target: { value: 'nothing like this' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.change(input, { target: { value: 'go to map' } })
    const options = screen.getAllByRole('option')
    expect(options.length).toBe(1)
    expect(options[0]!.getAttribute('aria-selected')).toBe('true')
  })
})
