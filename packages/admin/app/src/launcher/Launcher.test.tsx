// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import Launcher from './Launcher.tsx'
import App from '../App.tsx'
import { renderAt } from '../test/render.tsx'
import * as api from './api.ts'

vi.mock('./api.ts', async orig => ({
  ...(await orig<typeof import('./api.ts')>()),
  launcherState: vi.fn(), inspectHub: vi.fn(), launcherWizard: vi.fn(), createInstance: vi.fn(), openInstance: vi.fn(), forgetRecent: vi.fn(), cloneInstance: vi.fn(), adoptPlan: vi.fn(), adoptApply: vi.fn(),
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
    { id: 'join', available: true },
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

  it('submitting Open does not say Cloning, and Clone does not say Opening', async () => {
    let finish!: (v: unknown) => void
    m.openInstance.mockReturnValue(new Promise(r => { finish = r }) as never)
    m.cloneInstance.mockReturnValue(new Promise(() => {}) as never)
    renderAt(<Launcher />, '/launch')
    fireEvent.change(await screen.findByLabelText("The folder it's in"), { target: { value: '~/orgs/alder' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await screen.findByText('Opening…')
    expect(screen.queryByText('Cloning…')).toBeNull()
    finish({ url: 'http://127.0.0.1:4680/' })
    await waitFor(() => expect(assign).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Or paste a git address'), { target: { value: 'https://github.com/o/alder.git' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clone and open' }))
    await screen.findByText('Cloning…')
    expect(screen.queryByText('Opening…')).toBeNull()
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

  const TOKEN = 'tok_SECRET_0123456789abcdef'
  const hubAnswer = (over: Record<string, unknown> = {}) => ({
    invite: false,
    hub: { name: 'Alder Hub', type: 'LocalNode', url: 'https://hub.alder.example', network: 'Alder Network', networks: ['Alder Network'], policy: 'invite', types: ['PersonalNode', 'LocalNode'], asks: [], ...over },
  })

  it('Join is available: a plain hub address is looked up and the hub sentence shows', async () => {
    m.inspectHub.mockResolvedValue(hubAnswer() as never)
    renderAt(<Launcher />, '/launch')
    fireEvent.change(await screen.findByLabelText("The hub's address, or an invite link"), { target: { value: 'https://hub.alder.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }))
    expect(await screen.findByText(/Alder Hub \(LocalNode\)\. This network joins by invite\./)).toBeTruthy()
    expect(m.inspectHub).toHaveBeenCalledWith('https://hub.alder.example')
    expect(screen.getByRole('button', { name: 'Create one to join' })).toBeTruthy()
  })

  it('a pasted invite link: the token never reaches the api, and opening hands it over in the URL fragment only', async () => {
    m.inspectHub.mockResolvedValue(hubAnswer({ invite: true }) as never)
    m.openInstance.mockResolvedValue({ url: 'http://127.0.0.1:4680/federation?hub=https%3A%2F%2Fhub.alder.example&network=Alder+Network' } as never)
    renderAt(<Launcher />, '/launch')
    fireEvent.change(await screen.findByLabelText("The hub's address, or an invite link"), { target: { value: `https://hub.alder.example/.well-known/federation.json#invite=${TOKEN}` } })
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }))
    await screen.findByText(/Your invite link will be used/)
    expect(m.inspectHub).toHaveBeenCalledWith('https://hub.alder.example/.well-known/federation.json')
    fireEvent.change(screen.getByLabelText("The folder it's in"), { target: { value: '~/orgs/alder' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(m.openInstance).toHaveBeenCalledWith('~/orgs/alder', { hub: 'https://hub.alder.example', network: 'Alder Network' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`http://127.0.0.1:4680/federation?hub=https%3A%2F%2Fhub.alder.example&network=Alder+Network#invite=${TOKEN}`))
    // nothing the api saw carries the token
    const seen = JSON.stringify([m.inspectHub.mock.calls, m.openInstance.mock.calls])
    expect(seen).not.toContain(TOKEN)
    expect(document.body.innerHTML).not.toContain(TOKEN)
  })

  const LANDING = { hub: 'https://hub.alder.example', network: 'Alder Network' }
  const TOKEN2 = 'a b/+=&x'
  const joinLink = async (tokenText: string, over: Record<string, unknown> = {}) => {
    const { parse } = await import('yaml')
    const source = (await import('../../../wizards/open-instance.yaml?raw')).default
    m.launcherWizard.mockResolvedValue(parse(source) as never)
    m.inspectHub.mockResolvedValue(hubAnswer({ invite: true, ...over }) as never)
    renderAt(<Launcher />, '/launch')
    fireEvent.change(await screen.findByLabelText("The hub's address, or an invite link"), { target: { value: `https://hub.alder.example/.well-known/federation.json#invite=${tokenText}` } })
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }))
    await screen.findByText(/Your invite link will be used/)
  }
  const fillAnswers = async () => {
    await screen.findByRole('heading', { level: 2, name: 'About the organization' })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alder Commons' } })
    fireEvent.change(screen.getByLabelText('One line'), { target: { value: 'Seed keepers.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByLabelText('Your name')
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Steward A' } })
    fireEvent.change(screen.getByLabelText('Git email'), { target: { value: 'a@alder.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  }

  it('the create flow presets the type, sends the landing without the token, and lands with the encoded fragment', async () => {
    m.createInstance.mockResolvedValue({ url: 'http://127.0.0.1:4682/federation?hub=x' } as never)
    await joinLink(TOKEN2, { types: ['LocalNode'] })
    fireEvent.click(screen.getByRole('button', { name: 'Create one to join' }))
    await screen.findByRole('heading', { level: 2, name: 'About the organization' })
    expect((screen.getByRole('radio', { name: /Local node/ }) as HTMLInputElement).checked).toBe(true)
    await fillAnswers()
    fireEvent.click(await screen.findByRole('button', { name: 'Create it' }))
    await waitFor(() => expect(m.createInstance).toHaveBeenCalled())
    const [answers, landing] = m.createInstance.mock.calls[0]!
    expect(answers).toMatchObject({ type: 'LocalNode' })
    expect(landing).toEqual(LANDING)
    expect(JSON.stringify(m.createInstance.mock.calls)).not.toContain('tok')
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`http://127.0.0.1:4682/federation?hub=x#invite=${encodeURIComponent(TOKEN2)}`))
  })

  it('the adopt flow sends the landing and lands with the fragment', async () => {
    m.adoptPlan.mockResolvedValue({ planId: 'p1', add: ['federation.yaml'], kept: [], ignored: [] } as never)
    m.adoptApply.mockResolvedValue({ url: 'http://127.0.0.1:4683/federation?hub=x', branch: 'org-os/adopt' } as never)
    await joinLink('tok_abc123', { types: ['LocalNode'] })
    fireEvent.click(screen.getByRole('button', { name: 'Adopt a repo to join' }))
    fireEvent.change(await screen.findByLabelText("The repo's folder"), { target: { value: '~/plain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await fillAnswers()
    fireEvent.click(await screen.findByRole('button', { name: 'See what it adds' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add them on org-os/adopt' }))
    await waitFor(() => expect(m.adoptApply).toHaveBeenCalledWith('p1', LANDING))
    expect(m.adoptPlan.mock.calls[0]![1]).toMatchObject({ type: 'LocalNode' })
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://127.0.0.1:4683/federation?hub=x#invite=tok_abc123'))
    expect(JSON.stringify([m.adoptPlan.mock.calls, m.adoptApply.mock.calls])).not.toContain('tok_abc123')
  })

  it('a type the framework does not name is not preset', async () => {
    m.createInstance.mockResolvedValue({ url: 'http://127.0.0.1:4682/' } as never)
    await joinLink('tok_abc123', { types: ['Weird'] })
    fireEvent.click(screen.getByRole('button', { name: 'Create one to join' }))
    await screen.findByRole('heading', { level: 2, name: 'About the organization' })
    for (const r of screen.getAllByRole('radio', { name: /Cooperative|DAO|node|Project/ })) expect((r as HTMLInputElement).checked).toBe(false)
  })

  it('pressing Look it up again on the same address keeps the invite; another address drops it', async () => {
    m.openInstance.mockResolvedValue({ url: 'http://127.0.0.1:4680/federation?hub=x' } as never)
    await joinLink('tok_abc123')
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }))
    await screen.findByText(/Your invite link will be used/)
    fireEvent.change(screen.getByLabelText("The folder it's in"), { target: { value: '~/orgs/alder' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://127.0.0.1:4680/federation?hub=x#invite=tok_abc123'))
    fireEvent.change(screen.getByLabelText("The hub's address, or an invite link"), { target: { value: 'https://other.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }))
    await waitFor(() => expect(screen.queryByText(/Your invite link will be used/)).toBeNull())
    assign.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://127.0.0.1:4680/federation?hub=x'))
  })

  it('a hub with several networks asks which; a closed hub offers no way in', async () => {
    m.inspectHub.mockResolvedValue(hubAnswer({ networks: ['A', 'B'], network: 'A' }) as never)
    renderAt(<Launcher />, '/launch')
    fireEvent.change(await screen.findByLabelText("The hub's address, or an invite link"), { target: { value: 'https://hub.alder.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }))
    const pick = await screen.findByLabelText('Which network') as HTMLSelectElement
    expect(pick.value).toBe('')
    m.inspectHub.mockResolvedValue(hubAnswer({ policy: 'closed' }) as never)
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }))
    expect(await screen.findByText(/This network isn't taking requests\./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create one to join' })).toBeNull()
  })

  it('a refused look-up says why in a plain sentence', async () => {
    m.inspectHub.mockRejectedValue(new Error("That isn't a public https address. Paste the hub's address, or the invite link it gave you."))
    renderAt(<Launcher />, '/launch')
    fireEvent.change(await screen.findByLabelText("The hub's address, or an invite link"), { target: { value: 'nonsense' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }))
    expect(await screen.findByText(/isn't a public https address/)).toBeTruthy()
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

describe('the Create door', () => {
  const assign = vi.fn()
  const real = window.location
  beforeEach(() => {
    vi.clearAllMocks()
    m.launcherState.mockResolvedValue(state() as never)
    Object.defineProperty(window, 'location', { configurable: true, value: { ...real, assign } })
  })
  afterEach(() => { Object.defineProperty(window, 'location', { configurable: true, value: real }) })

  it('opens the wizard and shows the review with Create it', async () => {
    const { parse } = await import('yaml')
    const source = (await import('../../../wizards/open-instance.yaml?raw')).default
    m.launcherWizard.mockResolvedValue(parse(source) as never)
    renderAt(<Launcher />, '/launch')
    await screen.findByText('Alder Commons')
    fireEvent.click(screen.getByRole('button', { name: 'Create a new one' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'About the organization' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  async function toReview() {
    const { parse } = await import('yaml')
    const source = (await import('../../../wizards/open-instance.yaml?raw')).default
    m.launcherWizard.mockResolvedValue(parse(source) as never)
    renderAt(<Launcher />, '/launch')
    await screen.findByText('Alder Commons')
    fireEvent.click(screen.getByRole('button', { name: 'Create a new one' }))
    await screen.findByRole('heading', { level: 2, name: 'About the organization' })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alder Commons' } })
    fireEvent.click(screen.getByRole('radio', { name: /Local node/ }))
    fireEvent.change(screen.getByLabelText('One line'), { target: { value: 'Seed keepers.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByLabelText('Your name')
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Steward A' } })
    fireEvent.change(screen.getByLabelText('Git email'), { target: { value: 'a@alder.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create it' }))
  }

  it('goes to the URL when the create works', async () => {
    m.createInstance.mockResolvedValue({ url: 'http://127.0.0.1:4682/' } as never)
    await toReview()
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://127.0.0.1:4682/'))
  })

  it('shows the command log when the create fails', async () => {
    m.createInstance.mockRejectedValue(Object.assign(new Error('The framework could not create the instance.'), { log: 'git: no identity\nboom' }))
    await toReview()
    expect(await screen.findByText('The framework could not create the instance.')).toBeTruthy()
    expect(screen.getByLabelText('What the command printed').textContent).toBe('git: no identity\nboom')
    expect(assign).not.toHaveBeenCalled()
  })

  it('closes back to the four doors', async () => {
    const { parse } = await import('yaml')
    const source = (await import('../../../wizards/open-instance.yaml?raw')).default
    m.launcherWizard.mockResolvedValue(parse(source) as never)
    renderAt(<Launcher />, '/launch')
    await screen.findByText('Alder Commons')
    fireEvent.click(screen.getByRole('button', { name: 'Create a new one' }))
    await screen.findByRole('heading', { level: 2, name: 'About the organization' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByRole('button', { name: 'Create a new one' })).toBeTruthy()
  })
})

describe('the Adopt door', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.launcherState.mockResolvedValue(state() as never)
  })

  it('opens from its own button with a folder field', async () => {
    renderAt(<Launcher />, '/launch')
    await screen.findByText('Alder Commons')
    const door = screen.getByRole('button', { name: 'Adopt a repo' }) as HTMLButtonElement
    expect(door.disabled).toBe(false)
    fireEvent.click(door)
    expect((await screen.findByLabelText("The repo's folder") as HTMLInputElement).value).toBe('')
  })

  it('Adopt it hands the path over and moves focus to the Adopt card', async () => {
    m.openInstance.mockRejectedValue(Object.assign(new Error('/x/plain is not an org-os instance yet.'), { adoptable: true, path: '/x/plain' }))
    renderAt(<Launcher />, '/launch')
    fireEvent.change(await screen.findByLabelText("The folder it's in"), { target: { value: '/x/plain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Adopt it' }))
    const field = await screen.findByLabelText("The repo's folder") as HTMLInputElement
    expect(field.value).toBe('/x/plain')
    const card = screen.getByRole('region', { name: 'Adopt a repo' })
    await waitFor(() => expect(card.contains(document.activeElement)).toBe(true))
  })
})
