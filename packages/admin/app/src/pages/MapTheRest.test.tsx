// @vitest-environment jsdom
// Network N1 Task 8: /systems/map — paste links, review the recognised Systems, tick them, stage the additions.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import MapTheRest from './MapTheRest.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, refuse } from '../test/data.ts'

afterEach(() => vi.unstubAllGlobals())

const EXISTING = { name: 'systems', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'site', kind: 'repo', name: 'site', url: 'https://github.com/acme/site' }] }
const sysResource = { id: 'system:site', kind: 'system', board: 'systems', name: 'site', status: 'repo', attention: null, changed: null,
  facts: { kind: 'repo', url: 'https://github.com/acme/site' }, source: { path: 'data/systems.yaml', editable: true, registry: 'systems', entityId: 'site' } }

const routes = (over: Record<string, unknown> = {}) => baseRoutes({
  'GET /api/resources': [sysResource],
  'GET /api/registries/systems': EXISTING,
  'GET /api/systems/map/manifest': { imports: [] },
  'POST /api/changes/ops': changeView(),
  ...over,
})
const paste = (text: string) => {
  fireEvent.change(screen.getByLabelText('One link per line'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Recognise' }))
}
const ticks = () => screen.getAllByRole('checkbox').filter(c => c.getAttribute('aria-label')?.startsWith('Add '))
const stageBody = (calls: { method: string; path: string; body: unknown }[]) => calls.filter(c => c.method === 'POST' && c.path === '/api/changes/ops').map(c => c.body as { ops: { op: string; record: string; value: Record<string, unknown> }[] })

describe('/systems/map (N1 Task 8)', () => {
  it('opens with the first-run line only after an instance has just opened', async () => {
    fetchRoutes(routes())
    const first = renderAt(<MapTheRest />, '/systems/map?first=1')
    expect(await screen.findByText('Opened. Now list everything else the org runs: repos, docs, accounts, Safes.')).toBeTruthy()
    first.unmount()
    fetchRoutes(routes())
    renderAt(<MapTheRest />, '/systems/map')
    await screen.findByLabelText('One link per line')
    expect(screen.queryByText(/Opened\. Now list/)).toBeNull()
  })

  it('shows the manifest rows ticked', async () => {
    fetchRoutes(routes({ 'GET /api/systems/map/manifest': { imports: [{ id: 'old', kind: 'repo', name: 'old', url: 'https://github.com/acme/old', mount: 'repos/old' }] } }))
    renderAt(<MapTheRest />, '/systems/map')
    expect(await screen.findByText('Already in repos.manifest.json')).toBeTruthy()
    const [box] = await waitFor(() => { const t = ticks(); expect(t.length).toBe(1); return t })
    expect((box as HTMLInputElement).checked).toBe(true)
  })

  it('pasting three lines (a repo, a duplicate, a bad one) gives three statuses', async () => {
    fetchRoutes(routes())
    renderAt(<MapTheRest />, '/systems/map')
    await screen.findByLabelText('One link per line')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recognise' })).toBeTruthy())
    paste('https://github.com/acme/new\nhttps://github.com/acme/site\nnot a link')
    expect(await screen.findByText('New')).toBeTruthy()
    expect(screen.getByText('Already listed as site')).toBeTruthy()
    expect(screen.getByText(/Not a link this page knows/)).toBeTruthy()
    const dup = screen.getByRole('checkbox', { name: 'Add site' }) as HTMLInputElement
    expect(dup.checked).toBe(false)
    expect(dup.disabled).toBe(true)
  })

  it('lists a GitHub owner’s repos unticked, and says when there are more', async () => {
    fetchRoutes(routes({ 'GET /api/systems/map/github/acme': { repos: [
      { name: 'alpha', url: 'https://github.com/acme/alpha', archived: false, fork: false },
      { name: 'beta', url: 'https://github.com/acme/beta', archived: true, fork: false },
    ], more: true } }))
    renderAt(<MapTheRest />, '/systems/map')
    await screen.findByLabelText('One link per line')
    paste('https://github.com/acme')
    expect(await screen.findByText('Showing the first 100.')).toBeTruthy()
    await waitFor(() => expect(ticks().length).toBe(2))
    expect(ticks().every(c => !(c as HTMLInputElement).checked)).toBe(true)
  })

  it('ticking Clone into repos/x later puts the mount in the staged value, and stages one create op per tick', async () => {
    const { calls } = fetchRoutes(routes({ 'GET /api/systems/map/github/acme': { repos: [
      { name: 'x', url: 'https://github.com/acme/x', archived: false, fork: false },
      { name: 'y', url: 'https://github.com/acme/y', archived: false, fork: false },
    ], more: false } }))
    renderAt(<MapTheRest />, '/systems/map')
    await screen.findByLabelText('One link per line')
    paste('https://github.com/acme\nhttps://github.com/acme/z')
    await waitFor(() => expect(ticks().length).toBe(3))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add x' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clone into repos/x later' }))
    fireEvent.change(screen.getAllByLabelText('Purpose')[0]!, { target: { value: 'website' } })
    fireEvent.click(screen.getByRole('button', { name: 'Stage 2 additions' }))
    expect(await screen.findByText('Staged. Review them in Changes.')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Changes/ }).getAttribute('href')).toBe('/changes')
    const [body] = stageBody(calls)
    expect(body!.ops.map(o => o.op)).toEqual(['create', 'create'])
    expect(body!.ops.map(o => o.record).sort()).toEqual(['systems:x', 'systems:z'])
    // the first Purpose select is the pasted repo's (z), which comes before the owner's list
    const x = body!.ops.find(o => o.record === 'systems:x')!.value
    expect(x.mount).toBe('repos/x')
    expect(x.id).toBe('x')
    expect(body!.ops.find(o => o.record === 'systems:z')!.value.purpose).toBe('website')
  })

  it('never offers one repo twice: a manifest import and a pasted line for it give one stageable row', async () => {
    const { calls } = fetchRoutes(routes({ 'GET /api/systems/map/manifest': { imports: [{ id: 'old', kind: 'repo', name: 'old', url: 'https://github.com/acme/old', mount: 'repos/old' }] } }))
    renderAt(<MapTheRest />, '/systems/map')
    await waitFor(() => expect(ticks().length).toBe(1))
    paste('https://github.com/acme/old')
    expect(await screen.findByText('Already listed as old')).toBeTruthy()
    const boxes = screen.getAllByRole('checkbox', { name: 'Add old' }) as HTMLInputElement[]
    expect(boxes.length).toBe(2)
    expect(boxes.filter(b => !b.disabled).length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Stage 1 additions' }))
    await screen.findByText('Staged. Review them in Changes.')
    expect(stageBody(calls)[0]!.ops.map(o => o.record)).toEqual(['systems:old'])
  })

  it('does not give a GitHub repo the id or the address of a System shown elsewhere on the page', async () => {
    fetchRoutes(routes({
      'GET /api/systems/map/manifest': { imports: [{ id: 'old', kind: 'repo', name: 'old', url: 'https://github.com/acme/old', mount: 'repos/old' }] },
      'GET /api/systems/map/github/acme': { repos: [
        { name: 'old', url: 'https://github.com/acme/old', archived: false, fork: false },
        { name: 'new', url: 'https://github.com/acme/new', archived: false, fork: false },
      ], more: false },
    }))
    renderAt(<MapTheRest />, '/systems/map')
    await waitFor(() => expect(ticks().length).toBe(1))
    paste('https://github.com/acme')
    await waitFor(() => expect(ticks().length).toBe(2))
    expect(screen.getAllByRole('checkbox', { name: 'Add old' }).length).toBe(1)
  })

  it('shows the server’s own sentence when staging is refused', async () => {
    fetchRoutes(routes({ 'POST /api/changes/ops': refuse(403, { error: 'steward-a@alder.example is not a member of this organization.' }) }))
    renderAt(<MapTheRest />, '/systems/map')
    await screen.findByLabelText('One link per line')
    paste('https://github.com/acme/new')
    await screen.findByText('New')
    fireEvent.click(screen.getByRole('button', { name: 'Stage 1 additions' }))
    const note = await screen.findByText('steward-a@alder.example is not a member of this organization.')
    expect(within(note.closest('.note') ?? note.parentElement!).queryByText('Staged. Review them in Changes.')).toBeNull()
    expect(screen.queryByText('Staged. Review them in Changes.')).toBeNull()
  })

  it('builds the mount from the repo, not from the edited name; an empty name cannot be staged', async () => {
    const { calls } = fetchRoutes(routes())
    renderAt(<MapTheRest />, '/systems/map')
    await screen.findByLabelText('One link per line')
    paste('https://github.com/acme/real\nhttps://github.com/acme/other')
    await waitFor(() => expect(ticks().length).toBe(2))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clone into repos/real later' }))
    fireEvent.change(screen.getByLabelText('Name of real'), { target: { value: '../../x a/b' } })
    expect(screen.getByRole('checkbox', { name: 'Clone into repos/real later' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name of other'), { target: { value: '   ' } })
    expect((screen.getByRole('checkbox', { name: 'Add other' }) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Stage 1 additions' }))
    await screen.findByText('Staged. Review them in Changes.')
    const [{ ops }] = stageBody(calls)
    expect(ops.length).toBe(1)
    expect(ops[0]!.value.mount).toBe('repos/real')
    expect(ops[0]!.value.name).toBe('../../x a/b')
  })

  it('keeps ticks, name edits and clone flags with the thing they were set on when Recognise runs again', async () => {
    fetchRoutes(routes())
    renderAt(<MapTheRest />, '/systems/map')
    await screen.findByLabelText('One link per line')
    paste('https://github.com/acme/a\nhttps://github.com/acme/b')
    await waitFor(() => expect(ticks().length).toBe(2))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add a' }))
    fireEvent.change(screen.getByLabelText('Name of b'), { target: { value: 'Bee' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clone into repos/b later' }))
    paste('https://github.com/acme/b')
    await waitFor(() => expect(ticks().length).toBe(1))
    expect((screen.getByLabelText('Name of b') as HTMLInputElement).value).toBe('Bee')
    expect((screen.getByRole('checkbox', { name: 'Clone into repos/b later' }) as HTMLInputElement).checked).toBe(true)
    // a different thing arriving takes none of it
    paste('https://github.com/acme/c\nhttps://github.com/acme/a')
    await waitFor(() => expect(ticks().length).toBe(2))
    const a = screen.getByRole('checkbox', { name: 'Add a' }) as HTMLInputElement
    expect(a.checked).toBe(false)
    const c = screen.getByRole('checkbox', { name: 'Add c' }) as HTMLInputElement
    expect(c.checked).toBe(true)
    expect((screen.getByLabelText('Name of c') as HTMLInputElement).value).toBe('c')
    expect((screen.getAllByRole('checkbox').filter(x => x.parentElement?.textContent?.startsWith(' Clone into')) as HTMLInputElement[]).every(x => !x.checked)).toBe(true)
  })
})
