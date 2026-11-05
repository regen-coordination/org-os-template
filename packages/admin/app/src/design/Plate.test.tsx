// @vitest-environment jsdom
// The plate (design pass, spec 2026-11-04 §1): one test per variant.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderAt } from '../test/render.tsx'
import { sectionById } from '../sections.ts'
import { AddPlate, BrokenPlate, CannotPlate, ConnectPlate, FilteredPlate, RestrictedPlate } from './Plate.tsx'

const funding = sectionById('funding')!.words!

afterEach(() => vi.unstubAllGlobals())

describe('the plate', () => {
  it('empty and you can add: the why, the first steps, Add the first, the good entry, the example hidden from assistive tech, the file as a footnote', () => {
    renderAt(<AddPlate words={funding} file="data/funding-opportunities.yaml" addHref="/new/funding-opportunities" level={2} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Keep every grant, round and call in one place' })).toBeTruthy()
    expect(screen.getByText('Nothing tracked yet')).toBeTruthy()
    expect(screen.getByText(/One whose deadline is within 14 days is marked/)).toBeTruthy()
    // without an import to open, the import step and its button are not drawn: two steps, by hand and then
    const steps = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(steps.map(s => s.querySelector('.plate-s-t')!.textContent)).toEqual(['Add the first one by hand', 'Link them to projects'])
    expect(screen.queryByRole('button', { name: 'Import from a sheet' })).toBeNull()
    const add = screen.getByRole('link', { name: 'Add the first opportunity' })
    expect(add.getAttribute('href')).toBe('/new/funding-opportunities')
    expect(add.className).toContain('primary')
    // the example is seen, marked "example", and never read as data
    const ex = document.querySelector('.plate-ex')!
    expect(ex.getAttribute('aria-hidden')).toBe('true')
    expect(ex.textContent).toContain('example')
    expect(ex.textContent).toContain('Open source round, spring')
    // not in the accessible tree: every example word sits under the aria-hidden example
    for (const el of screen.getAllByText('Open source round, spring')) expect(el.closest('[aria-hidden="true"]')).toBe(ex)
    expect(document.querySelector('.plate-foot')!.textContent).toBe('Kept in data/funding-opportunities.yaml. Edit it here, or in the file. Both land as a staged change.')
    // What a good entry looks like: a disclosure of the first example as field rows, said to be an example
    const good = screen.getByRole('button', { name: 'What a good entry looks like' })
    expect(good.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(good)
    expect(good.getAttribute('aria-expanded')).toBe('true')
    const rows = screen.getByRole('group', { name: 'A good entry' })
    expect(document.getElementById(good.getAttribute('aria-controls')!)!.contains(rows)).toBe(true)
    expect(screen.getByText('An example, not a record:')).toBeTruthy()
    expect([...rows.querySelectorAll('dt')].map(d => d.textContent)).toEqual(['Name', 'Funder', 'Deadline'])
    expect([...rows.querySelectorAll('dd')].map(d => d.textContent)).toEqual(['Open source round, spring', 'Example Fund', 'in 24 days'])
  })

  it('draws Import from a sheet, and its step, only when there is an import to open', () => {
    const onImport = vi.fn()
    renderAt(<AddPlate words={funding} file="data/funding-opportunities.yaml" addHref="/new/funding-opportunities" onImport={onImport} level={3} />)
    expect(screen.getByRole('heading', { level: 3 })).toBeTruthy()
    const steps = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(steps).toHaveLength(3)
    expect(steps[1]!.textContent).toContain('Or bring a list you already keep')
    fireEvent.click(screen.getByRole('button', { name: 'Import from a sheet' }))
    expect(onImport).toHaveBeenCalledOnce()
  })

  it("you can't add: no records yet, who keeps the list, and Who decides? opening the rules", () => {
    renderAt(<CannotPlate nouns="funding opportunities" level={2} />)
    expect(screen.getByRole('heading', { level: 2, name: 'No funding opportunities yet' })).toBeTruthy()
    expect(screen.getByText(/Members who can write keep this list/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Who decides?' }).getAttribute('href')).toBe('/governance/rules')
    expect(document.querySelector('.btn.primary')).toBeNull()
  })

  it('filtered to nothing: what the filters hid and how many, and Clear filters', () => {
    const onClear = vi.fn()
    renderAt(<FilteredPlate nouns="funding opportunities" filters="Status is open" hidden="4 are closed and 2 are draft." onClear={onClear} level={2} />)
    expect(screen.getByRole('heading', { name: 'No funding opportunities match “Status is open”' })).toBeTruthy()
    expect(screen.getByText('4 are closed and 2 are draft.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('all restricted for you: a count and the hat, Ask for access opening Roles, and never a name (D-12)', () => {
    renderAt(<RestrictedPlate count={3} nouns="funding opportunities" noun="opportunity" hat="Ops" level={2} />)
    expect(screen.getByRole('heading', { name: '3 funding opportunities you can’t see' })).toBeTruthy()
    expect(document.querySelector('.plate-l')!.textContent).toBe('They’re marked Ops only. People wearing the Ops hat can open them.')
    expect(document.querySelector('.vis-field')).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Ask for access' }).getAttribute('href')).toBe('/roles')
  })

  it('the file is broken: the file, the line and the reason as an error note, and Copy for a fix', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    renderAt(<BrokenPlate title="Funding" file="data/funding-opportunities.yaml" line={12} reason="*a reuses a value marked &a." level={2} />)
    expect(screen.getByRole('heading', { name: 'Funding can’t be read' })).toBeTruthy()
    expect(document.querySelector('.note-error')!.textContent).toBe('Line 12 of data/funding-opportunities.yaml: *a reuses a value marked &a.')
    fireEvent.click(screen.getByRole('button', { name: 'Copy for a fix' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('data/funding-opportunities.yaml, line 12: *a reuses a value marked &a.'))
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('not connected yet: what connecting gives, read only where true, Connect for one who can, else Who decides?', () => {
    const treasury = sectionById('treasury')!.words!.connect!
    const page = renderAt(<ConnectPlate connect={treasury} href="/new/systems" level={3} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Treasury isn’t connected' })).toBeTruthy()
    expect(document.querySelector('.plate-l')!.textContent).toMatch(/balances .* Read only: the Hub never signs\.$/)
    expect(screen.getByRole('link', { name: 'Connect a Safe' }).getAttribute('href')).toBe('/new/systems')
    expect(screen.getByRole('link', { name: 'Other systems' }).getAttribute('href')).toBe('/systems')
    page.unmount()
    renderAt(<ConnectPlate connect={sectionById('sources')!.words!.connect!} level={3} />)
    expect(document.querySelector('.plate-l')!.textContent).not.toContain('Read only')
    expect(screen.queryByRole('link', { name: 'Connect a source' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Who decides?' })).toBeTruthy()
  })
})
