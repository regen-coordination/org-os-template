// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import Launcher from './Launcher.tsx'
import App from '../App.tsx'
import { renderAt } from '../test/render.tsx'
import * as api from './api.ts'

vi.mock('./api.ts', async orig => ({
  ...(await orig<typeof import('./api.ts')>()),
  launcherState: vi.fn(), openInstance: vi.fn(), forgetRecent: vi.fn(), cloneInstance: vi.fn(),
}))
const m = vi.mocked(api)

const state = (over: Record<string, unknown> = {}) => ({
  base: '/home/me/orgs',
  recent: [
    { path: '/home/me/orgs/alder', name: 'Alder Commons', found: true, instance: true },
    { path: '/home/me/gone', name: null, found: false, instance: false },
  ],
  doors: [
    { id: 'open', available: true }, { id: 'create', available: true }, { id: 'adopt', available: true },
    { id: 'join', available: false, note: 'Comes with federation.' },
  ],
  ...over,
})

describe('the launcher page', () => {
  const assign = vi.fn()
  const real = window.location
  beforeEach(() => {
    vi.clearAllMocks()
    m.launcherState.mockResolvedValue(state() as never)
    Object.defineProperty(window, 'location', { configurable: true, value: { ...real, assign } })
  })
  afterEach(() => { Object.defineProperty(window, 'location', { configurable: true, value: real }) })

  it('renders the recent list and the four doors', async () => {
    renderAt(<Launcher />, '/launch')
    expect(await screen.findByText('Alder Commons')).toBeTruthy()
    expect(screen.getByText('/home/me/orgs/alder')).toBeTruthy()
    for (const label of ['Open an instance', 'Create a new one', 'Adopt a repo', 'Join a network']) expect(screen.getByRole('heading', { name: label })).toBeTruthy()
    expect((screen.getByLabelText("The folder it's in") as HTMLInputElement).placeholder).toBe('/home/me/orgs')
  })

  it('a row not found says so and can be removed from the list', async () => {
    m.forgetRecent.mockResolvedValue({ recent: [] } as never)
    renderAt(<Launcher />, '/launch')
    expect(await screen.findByText('Not found.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from the list' }))
    await waitFor(() => expect(m.forgetRecent).toHaveBeenCalledWith('/home/me/gone'))
    await waitFor(() => expect(screen.queryByText('Not found.')).toBeNull())
  })

  it('opening a folder asks for it and goes to the URL it answers', async () => {
    m.openInstance.mockResolvedValue({ url: 'http://127.0.0.1:4680/' } as never)
    renderAt(<Launcher />, '/launch')
    fireEvent.change(await screen.findByLabelText("The folder it's in"), { target: { value: '~/orgs/alder' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(m.openInstance).toHaveBeenCalledWith('~/orgs/alder'))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://127.0.0.1:4680/'))
  })

  it('a folder that is not an instance offers to adopt it', async () => {
    m.openInstance.mockRejectedValue(Object.assign(new Error('/x/y is not an org-os instance yet.'), { adoptable: true, path: '/x/y' }))
    renderAt(<Launcher />, '/launch')
    fireEvent.change(await screen.findByLabelText("The folder it's in"), { target: { value: '/x/y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByText("This folder isn't an org-os instance yet.")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Adopt it' })).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
  })

  it('any other refusal is said as it came', async () => {
    m.openInstance.mockRejectedValue(new Error('That instance is already open at http://127.0.0.1:4680/.'))
    renderAt(<Launcher />, '/launch')
    fireEvent.change(await screen.findByLabelText("The folder it's in"), { target: { value: '/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByText('That instance is already open at http://127.0.0.1:4680/.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Adopt it' })).toBeNull()
  })

  it('a pasted git address pre-fills an editable folder and clones it', async () => {
    m.cloneInstance.mockResolvedValue({ url: 'http://127.0.0.1:4681/' } as never)
    renderAt(<Launcher />, '/launch')
    await screen.findByText('Alder Commons')
    fireEvent.change(screen.getByLabelText('Or paste a git address'), { target: { value: 'https://github.com/o/alder.git' } })
    const folder = screen.getByLabelText('The folder to clone it into') as HTMLInputElement
    expect(folder.value).toBe('/home/me/orgs/alder')
    fireEvent.change(folder, { target: { value: '~/mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clone and open' }))
    await waitFor(() => expect(m.cloneInstance).toHaveBeenCalledWith('https://github.com/o/alder.git', '~/mine'))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://127.0.0.1:4681/'))
  })

  it('a clone that is not an instance offers to adopt it', async () => {
    m.cloneInstance.mockRejectedValue(Object.assign(new Error('x'), { adoptable: true, path: '/home/me/orgs/plain' }))
    renderAt(<Launcher />, '/launch')
    fireEvent.change(await screen.findByLabelText('Or paste a git address'), { target: { value: 'https://github.com/o/plain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clone and open' }))
    expect(await screen.findByText("This folder isn't an org-os instance yet.")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Adopt it' })).toBeTruthy()
  })

  it('Join is disabled and says why', async () => {
    renderAt(<Launcher />, '/launch')
    expect(await screen.findByText('Comes with federation.')).toBeTruthy()
    const join = screen.getByRole('button', { name: 'Join a network' }) as HTMLButtonElement
    expect(join.disabled).toBe(true)
  })

  it('/launch is drawn alone: no request goes outside /api/launcher/', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }))
    // the api module is mocked above; here the real one runs, so the requests are real fetches
    m.launcherState.mockImplementation((await vi.importActual<typeof api>('./api.ts')).launcherState)
    renderAt(<App />, '/launch')
    await screen.findByRole('heading', { name: 'Open an instance' })
    await new Promise(r => setTimeout(r, 50))
    const urls = spy.mock.calls.map(c => String(c[0] instanceof Request ? c[0].url : c[0]))
    spy.mockRestore()
    expect(urls).toContain('/api/launcher/state')
    expect(urls.filter(u => !u.includes('/api/launcher/'))).toEqual([])
  })
})
