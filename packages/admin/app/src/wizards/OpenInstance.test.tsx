// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import OpenInstance from './OpenInstance.tsx'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { refuse } from '../test/data.ts'
import { parse } from 'yaml'
import source from '../../../wizards/open-instance.yaml?raw'
import { validateWizard } from '../../../lib/wizards.mjs'
import type { WizardDef } from '../api.ts'
import { errorNote } from '../test/notes.ts'

// The wizard as the platform ships it: the screens are drawn from this file, not from a copy.
const def = parse(source) as WizardDef
const routes = (over: Record<string, unknown> = {}) => ({
  'GET /api/wizards/open-instance/draft': null,
  'PUT /api/wizards/open-instance/draft': (init?: RequestInit) => ({ ...JSON.parse(String(init?.body)), saved: 'now' }),
  'DELETE /api/wizards/open-instance/draft': { discarded: true },
  'GET /api/actor': { unknown: 'steward-a@alder.example' },
  ...over,
})
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const writes = () => screen.getByRole('group', { name: 'What this writes' }).textContent

async function toOrg() {
  fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
  fireEvent.click(screen.getByRole('radio', { name: /Open a new organization/ }))
  click('Continue')
  await screen.findByRole('heading', { level: 2, name: 'About the organization' })
}
const fillOrg = () => {
  type('Name', 'Alder Commons')
  fireEvent.click(screen.getByRole('radio', { name: /Local node/ }))
  type('One line', 'A cooperative of seed keepers in the Alder valley.')
}

describe('W1, first screens: open an organization', () => {
  it('is a wizard the checker accepts', () => { expect(validateWizard(def)).toEqual([]) })

  it('says on the intro that nothing is touched', async () => {
    const { calls } = fetchRoutes(routes())
    renderAt(<OpenInstance def={def} />)
    expect(await screen.findByRole('heading', { level: 2, name: 'Open an organization' })).toBeTruthy()
    expect(writes()).toMatch(/Nothing/)
    expect(calls.filter(c => c.method !== 'GET')).toEqual([])
  })

  it('offers one door that works, and shows the others as not built yet', async () => {
    fetchRoutes(routes())
    renderAt(<OpenInstance def={def} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    expect((screen.getByRole('radio', { name: /Open a new organization/ }) as HTMLInputElement).disabled).toBe(false)
    for (const name of [/Adopt a repository/, /Join a federation/]) {
      expect((screen.getByRole('radio', { name })as HTMLInputElement).disabled).toBe(true)
    }
    expect(screen.getAllByText(/Not built yet/)).toHaveLength(2)
    click('Continue')
    expect(errorNote().textContent).toContain('Choose one.')
  })

  it('will not leave the organization step without a name, a kind and a line, and says which', async () => {
    fetchRoutes(routes())
    renderAt(<OpenInstance def={def} />)
    await toOrg()
    click('Continue')
    expect(errorNote().textContent).toBe('Write the organization\'s name.')
    type('Name', 'Alder Commons'); click('Continue')
    expect(errorNote().textContent).toBe('Choose what kind of organization it is.')
    fireEvent.click(screen.getByRole('radio', { name: /Local node/ })); click('Continue')
    expect(errorNote().textContent).toBe('Write one line about it.')
  })

  it('suggests a folder from the name until the person writes their own', async () => {
    fetchRoutes(routes())
    renderAt(<OpenInstance def={def} />)
    await toOrg()
    type('Name', 'Alder Commons')
    expect((screen.getByLabelText('Folder to create') as HTMLInputElement).value).toBe('../alder-commons')
    type('Folder to create', '../my-own')
    type('Name', 'Alder Commons Two')
    expect((screen.getByLabelText('Folder to create') as HTMLInputElement).value).toBe('../my-own')
  })

  it('walks to a review that shows the command and the config, offers to copy, and writes nothing anywhere', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { calls } = fetchRoutes(routes())
    renderAt(<OpenInstance def={def} />)
    await toOrg(); fillOrg(); click('Continue')
    await screen.findByRole('heading', { level: 2, name: 'Who is setting this up?' })
    expect((screen.getByLabelText('Git email') as HTMLInputElement).value).toBe('steward-a@alder.example') // the address git reports, as a default
    click('Continue')
    expect(errorNote().textContent).toBe('Write your name.')
    type('Your name', 'Steward A'); click('Continue')
    expect(await screen.findByRole('heading', { level: 2, name: 'The command, and the file it reads' })).toBeTruthy()
    expect(writes()).toMatch(/shows the command and runs none of it/)
    expect(screen.getByRole('status').textContent).toMatch(/writes nothing and runs nothing/)
    expect(screen.queryByText(/Nothing is written until you confirm/)).toBeNull()
    const log = screen.getByText(/npm run clone:framework/).closest('.wiz-log')!
    expect(log.textContent).toBe('npm run clone:framework -- --target ../alder-commons --config draft.yaml')
    const draft = screen.getByText(/short_description/).closest('.wiz-log')!
    expect(draft.textContent).toContain('name: Alder Commons')
    expect(draft.textContent).toContain('type: LocalNode')
    expect(draft.textContent).toContain('email: steward-a@alder.example')
    // nothing to run, nothing to confirm
    expect(screen.queryByRole('button', { name: /Create|This is me|Confirm|Run/ })).toBeNull()
    click('Copy the command')
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('npm run clone:framework -- --target ../alder-commons --config draft.yaml'))
    expect(await screen.findByText('Copied.')).toBeTruthy()
    // the only writes were the draft, outside any repository
    expect(calls.filter(c => c.method !== 'GET').every(c => c.path === '/api/wizards/open-instance/draft')).toBe(true)
    expect(calls.map(c => c.path).filter(p => p.includes('operations') || p.includes('jobs') || p.includes('bootstrap'))).toEqual([])
  })

  it('goes back with every answer kept', async () => {
    fetchRoutes(routes())
    renderAt(<OpenInstance def={def} />)
    await toOrg(); fillOrg(); click('Continue')
    await screen.findByRole('heading', { level: 2, name: 'Who is setting this up?' })
    click('Back')
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Alder Commons')
    expect((screen.getByRole('radio', { name: /Local node/ }) as HTMLInputElement).checked).toBe(true)
  })

  // R1 (fix wave): the draft is kept by a PUT, which writes `<state>/wizards/open-instance-1.json` on the server.
  // Previewing draws no "Save and leave" and makes no such write, so a preview leaves no draft behind — not on the
  // last step, and not on any keystroke before it (C6, C-23).
  it('writes no draft while previewing, so no draft file is written', async () => {
    const { calls } = fetchRoutes(routes())
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><OpenInstance def={def} /></ViewAsProvider>)
    await toOrg()
    type('Name', 'Alder Commons')
    fireEvent.click(screen.getByRole('radio', { name: /Local node/ }))
    type('One line', 'A cooperative of seed keepers in the Alder valley.')
    click('Continue')
    await screen.findByLabelText('Your name')
    type('Your name', 'Steward A')
    expect(calls.filter(c => c.method === 'PUT' && c.path === '/api/wizards/open-instance/draft')).toEqual([])
    expect(calls.filter(c => c.method !== 'GET')).toEqual([])
  })

  it('keeps the answers as a draft as you go, and continues from it', async () => {
    const first = fetchRoutes(routes())
    const one = renderAt(<OpenInstance def={def} />)
    await toOrg(); type('Name', 'Alder Commons')
    await waitFor(() => expect(first.calls.some(c => c.method === 'PUT' && (c.body as { answers: { name?: string } }).answers.name === 'Alder Commons')).toBe(true))
    click('Save and leave')
    expect(first.calls.some(c => c.method === 'DELETE')).toBe(false)
    one.unmount()
    fetchRoutes(routes({ 'GET /api/wizards/open-instance/draft': { index: 1, answers: { start: 'open', name: 'Alder Commons' }, saved: 'earlier' } }))
    renderAt(<OpenInstance def={def} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue where you left off' }))
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Alder Commons')
    expect(screen.getByRole('heading', { level: 2, name: 'About the organization' })).toBeTruthy()
  })

  it('says, on the review, where this stops', async () => {
    fetchRoutes(routes())
    renderAt(<OpenInstance def={def} />)
    await toOrg(); fillOrg(); click('Continue')
    await screen.findByLabelText('Your name'); type('Your name', 'Steward A'); click('Continue')
    const stop = await screen.findByText(/does not create the folder/i)
    expect(within(stop.closest('.wiz-body')!).getByText(/how it decides|starting set/i)).toBeTruthy()
  })
})
