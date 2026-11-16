// @vitest-environment jsdom
// DAO-OS L7 Task 17: /compose — the compose canvas on the org's composed Systems, through the actor's change.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import Compose from './Compose.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, refuse } from '../test/data.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { houseSource } from '../session/houseSource.ts'
import { expectNoWriteControls } from '../test/publicPreview.tsx'
import { OPEN_CHANGES, OPEN_PROPOSE } from '../keys/useHouseKeys.ts'
import { COMPOSED_SAFE, COMPOSED_SYSTEMS } from '../test/fixtures/house/composed.ts'
import { DEPLOYED } from '../elements/compose/compose.ts'
import type { Op } from '../api.ts'

afterEach(() => vi.unstubAllGlobals())

const systems = (entries: Record<string, unknown>[] = COMPOSED_SYSTEMS) => ({ name: 'systems', kind: 'collection', schemaVersion: '1.0', entries })
const rename: Op = { op: 'update', record: 'systems:test-dao-safe', set: { name: 'Council Safe' }, base: 'h', before: COMPOSED_SAFE } as Op
const nodeIds = () => [...document.querySelectorAll<HTMLElement>('.cmp-canvas [data-node-id]')].map(n => n.dataset.nodeId)
const foot = () => document.querySelector<HTMLElement>('.cmp-foot')!

describe('/compose (L7 Task 17)', () => {
  it('draws the canvas on the org’s composed Systems, under the page’s heading', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems() }))
    renderAt(<Compose />, '/compose')
    expect(await screen.findByRole('heading', { level: 1, name: 'Compose' })).toBeTruthy()
    await waitFor(() => expect(nodeIds()).toEqual(['test-dao-safe', 'test-dao-roles', 'test-dao-roles/council', 'test-dao-votes', 'test-dao-registration']))
    expect(screen.getByRole('group', { name: 'Place a System' })).toBeTruthy()
  })

  it('shows what your change stages at once: a staged rename is the node’s name', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(), 'GET /api/changes': changeView({ ops: [rename], classes: ['records'] }) }))
    renderAt(<Compose />, '/compose')
    await waitFor(() => expect(document.querySelector('.cmp-canvas [data-node-id="test-dao-safe"]')?.textContent).toContain('Council Safe'))
    expect(within(foot()).getByText('Staged · not yet deployed')).toBeTruthy()
  })

  it('stages what the canvas does through the actor’s change (POST /api/changes/ops)', async () => {
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(), 'POST /api/changes/ops': changeView({ ops: [rename], classes: ['records'] }) }))
    const { container } = renderAt(<Compose />, '/compose')
    await waitFor(() => expect(nodeIds().length).toBe(5))
    fireEvent.click(container.querySelector<HTMLElement>('.cmp-canvas [data-node-id="test-dao-safe"]')!)
    const name = within(screen.getByRole('region', { name: 'Test DAO Safe' })).getByLabelText('Name') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Council Safe' } })
    fireEvent.blur(name)
    await waitFor(() => expect(calls.filter(c => c.method === 'POST' && c.path === '/api/changes/ops').map(c => c.body))
      .toEqual([{ ops: [{ op: 'update', record: 'systems:test-dao-safe', set: { name: 'Council Safe' } }] }]))
  })

  it('says a refused stage in an error note, and draws the composition as it stands again', async () => {
    const sentence = 'threshold is 4, and the Safe has 3 owners; it is between 1 and the number of owners.'
    fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(),
      'POST /api/changes/ops': refuse(422, { errors: [{ record: 'systems:test-dao-safe', field: 'name', message: sentence }] }) }))
    const { container } = renderAt(<Compose />, '/compose')
    await waitFor(() => expect(nodeIds().length).toBe(5))
    fireEvent.click(container.querySelector<HTMLElement>('.cmp-canvas [data-node-id="test-dao-safe"]')!)
    const name = within(screen.getByRole('region', { name: 'Test DAO Safe' })).getByLabelText('Name') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Council Safe' } })
    fireEvent.blur(name)
    await waitFor(() => expect(document.querySelector('.note-error')?.textContent).toContain(sentence))
    await waitFor(() => expect(container.querySelector('.cmp-canvas [data-node-id="test-dao-safe"]')?.textContent).toContain('Test DAO Safe'))
  })

  it('says no count of prepared transactions while no plan is read', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(), 'GET /api/changes': changeView({ ops: [rename], classes: ['records'] }),
      'GET /api/deploy': () => new Promise(() => {}) }))
    renderAt(<Compose />, '/compose')
    await waitFor(() => expect(nodeIds().length).toBe(5))
    expect(foot().textContent).not.toMatch(/prepared transaction/)
  })

  // DAO-OS L7 Task 11 (PF-R156's seam): the count is GET /api/deploy's steps
  const PLAN = { chain: 'eip155:11155111', composed: ['test-dao-safe', 'test-dao-roles'], readAt: '2026-11-05T12:00:00.000Z', problems: [],
    steps: ['safe:create', 'tree:top', 'tree:hats', 'tree:wearers', 'gate:deploy', 'gate:wire', 'gate:claim'].map((id, i) => ({
      id, system: id.startsWith('tree') ? 'test-dao-roles' : 'test-dao-safe', title: id, status: i === 0 ? 'done' : 'waits', signer: { kind: 'account' }, predicts: [] })) }

  it('counts the planner’s steps in the foot: “7 prepared transactions, in order · Sepolia”', async () => {
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(), 'GET /api/deploy': PLAN }))
    renderAt(<Compose />, '/compose')
    await waitFor(() => expect(foot().textContent).toContain('7 prepared transactions, in order · Sepolia'))
    expect(calls.filter(c => c.path === '/api/deploy').map(c => c.method)).toEqual(['GET'])
  })

  // DAO-OS L7 Task 18: with a plan, the foot leads to its steps
  it('links the foot to /deploy when a plan is read, and not before', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(), 'GET /api/deploy': PLAN }))
    const { unmount } = renderAt(<Compose />, '/compose')
    await waitFor(() => expect(within(foot()).getByRole('link', { name: 'Open the prepared steps' }).getAttribute('href')).toBe('/deploy'))
    unmount()
    vi.unstubAllGlobals()
    fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(), 'GET /api/deploy': refuse(409, { code: 'STAGED_ONLY', error: 'Apply or propose the composition first; deployments are prepared from what was decided.' }) }))
    renderAt(<Compose />, '/compose')
    await waitFor(() => expect(nodeIds().length).toBe(5))
    await new Promise(r => setTimeout(r, 30))
    expect(within(foot()).queryByRole('link', { name: 'Open the prepared steps' })).toBeNull()
  })

  it('draws no count when the plan answers none: the composition only staged, nothing committed composed, a failed read', async () => {
    for (const answer of [refuse(409, { code: 'STAGED_ONLY', error: 'Apply or propose the composition first; deployments are prepared from what was decided.' }),
      refuse(409, { code: 'NOTHING_COMPOSED', error: 'Nothing is composed. Add a DAO template or compose on the canvas first.' }),
      refuse(502, { code: 'READ_FAILED', error: 'ethereum-sepolia-rpc.publicnode.com answered an error for lastTopHatId()' })]) {
      const { calls } = fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(), 'GET /api/deploy': answer }))
      const { unmount } = renderAt(<Compose />, '/compose')
      await waitFor(() => expect(calls.some(c => c.path === '/api/deploy')).toBe(true))
      await waitFor(() => expect(nodeIds().length).toBe(5))
      expect(foot().textContent).not.toMatch(/prepared transaction/)
      unmount()
    }
  })

  // Whole-platform walk I13 (/compose): every step done on the chain, the records still composed until Read back
  const ON_CHAIN = { ...PLAN, steps: PLAN.steps.map(st => ({ ...st, status: 'done' })) }
  it('a System whose steps are all done reads deployed on chain, and that Read back records it; the rest stays not deployed', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(), 'GET /api/deploy': ON_CHAIN }))
    const { container } = renderAt(<Compose />, '/compose')
    const node = (id: string) => container.querySelector<HTMLElement>(`.cmp-canvas [data-node-id="${id}"]`)!
    await waitFor(() => expect(node('test-dao-safe').getAttribute('aria-label')).toMatch(/on chain/))
    for (const id of ['test-dao-safe', 'test-dao-roles', 'test-dao-roles/council']) {
      expect(node(id).classList.contains('is-draft')).toBe(false)
      expect(node(id).getAttribute('aria-label')).not.toMatch(/not deployed/)
    }
    // the plan names no step of the space or the registration: they are still composed, not deployed
    expect(node('test-dao-votes').classList.contains('is-draft')).toBe(true)
    fireEvent.click(node('test-dao-safe'))
    const insp = screen.getByRole('region', { name: 'Test DAO Safe' })
    expect(insp.querySelector('.insp-k')!.textContent).toBe('Safe · deployed on chain')
    expect(insp.textContent).toContain('The chain holds this System as it was composed. Read back, on the prepared steps, records it as deployed.')
    expect(foot().textContent).toContain('Composed · not yet deployed')
  })

  it('with every composed System on the chain, the foot says so and that Read back records it', async () => {
    const only = COMPOSED_SYSTEMS.filter(s => s.id !== 'test-dao-votes' && s.id !== 'test-dao-registration')
    fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(only), 'GET /api/deploy': ON_CHAIN }))
    renderAt(<Compose />, '/compose')
    await waitFor(() => expect(foot().textContent).toContain('Deployed on chain · not yet read back'))
    expect(foot().textContent).not.toContain('not yet deployed')
  })

  it('previewing, the plan is not asked: the count is the member’s, not the audience’s', async () => {
    const open = { ...COMPOSED_SYSTEMS[2] as Record<string, unknown>, visibility: 'public' }
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(COMPOSED_SYSTEMS.map(s => (s.id === 'test-dao-votes' ? open : s))), 'GET /api/deploy': PLAN }))
    renderAt(<ViewAsProvider initial={{ as: 'public' }} source={houseSource({ tree: [], worn: [], levels: ['public', 'members'], config: { collections: {}, defaults: {} }, writable: [] })}><Compose /></ViewAsProvider>, '/compose')
    await waitFor(() => expect(nodeIds()).toEqual(['test-dao-votes']))
    await new Promise(r => setTimeout(r, 30))
    expect(calls.filter(c => c.path === '/api/deploy')).toEqual([])
    expect(document.body.textContent).not.toMatch(/prepared transaction/)
  })

  it('the foot’s Review opens the tray and Propose the propose panel; with nothing staged it offers neither', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(), 'GET /api/changes': changeView({ ops: [rename], classes: ['records'] }) }))
    const heard: string[] = []
    const hear = (e: Event) => heard.push(e.type)
    window.addEventListener(OPEN_CHANGES, hear); window.addEventListener(OPEN_PROPOSE, hear)
    try {
      renderAt(<Compose />, '/compose')
      fireEvent.click(await screen.findByRole('button', { name: 'Review order' }))
      fireEvent.click(screen.getByRole('button', { name: 'Propose' }))
      expect(heard).toEqual([OPEN_CHANGES, OPEN_PROPOSE])
    } finally { window.removeEventListener(OPEN_CHANGES, hear); window.removeEventListener(OPEN_PROPOSE, hear) }
  })

  it('with nothing staged, the foot says the composition is composed and offers no Review or Propose', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems() }))
    renderAt(<Compose />, '/compose')
    await waitFor(() => expect(nodeIds().length).toBe(5))
    expect(within(foot()).getByText('Composed · not yet deployed')).toBeTruthy()
    expect(within(foot()).queryByRole('button')).toBeNull()
  })

  it('with nothing composed, a member gets the canvas and its shelf, and a sentence that says so', async () => {
    fetchRoutes(baseRoutes())
    renderAt(<Compose />, '/compose')
    expect(await screen.findByText(/Nothing is composed yet/)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Place a System' })).toBeTruthy()
  })

  it('previewing as Public draws nothing the public may not read, and no control that writes', async () => {
    const open = { ...COMPOSED_SYSTEMS[2] as Record<string, unknown>, visibility: 'public' }
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(COMPOSED_SYSTEMS.map(s => (s.id === 'test-dao-votes' ? open : s))),
      'GET /api/changes': changeView({ ops: [rename], classes: ['records'] }) }))
    // the Hub's own source, which reads a record's `visibility` (L5 §11.2)
    renderAt(<ViewAsProvider initial={{ as: 'public' }} source={houseSource({ tree: [], worn: [], levels: ['public', 'members'], config: { collections: {}, defaults: {} }, writable: [] })}><Compose /></ViewAsProvider>, '/compose')
    await waitFor(() => expect(nodeIds()).toEqual(['test-dao-votes']))
    expect(document.body.textContent).not.toContain('Council Safe')
    expect(document.body.textContent).not.toContain('Test DAO Safe')
    expect(screen.queryByRole('group', { name: 'Place a System' })).toBeNull()
    expectNoWriteControls()
    expect(calls.filter(c => c.method !== 'GET')).toEqual([])
  })

  it('previewing as Public with nothing it may read draws no canvas at all', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems() }))
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><Compose /></ViewAsProvider>, '/compose')
    expect(await screen.findByText(/Nothing composed is shown/)).toBeTruthy()
    expect(document.querySelector('.cmp-canvas')).toBeNull()
  })

  it('says a failed read of data/systems.yaml, and draws no canvas', async () => {
    fetchRoutes(baseRoutes({ 'GET /api/registries/systems': refuse(500, { error: 'data/systems.yaml cannot be read' }) }))
    renderAt(<Compose />, '/compose')
    expect((await screen.findByText('data/systems.yaml cannot be read')).closest('.note-error')).toBeTruthy()
    expect(document.querySelector('.cmp-canvas')).toBeNull()
  })

  // the paired review of Tasks 19 and 17 (M4)
  it('an actor who is no member reads the canvas without its write controls, and stages nothing', async () => {
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(), 'GET /api/actor': { unknown: 'someone@example.invalid' } }))
    const { container } = renderAt(<Compose />, '/compose')
    await waitFor(() => expect(nodeIds().length).toBe(5))
    expect(screen.queryByRole('group', { name: 'Place a System' })).toBeNull()
    fireEvent.click(container.querySelector<HTMLElement>('.cmp-canvas [data-node-id="test-dao-safe"]')!)
    expect(within(screen.getByRole('region', { name: 'Test DAO Safe' })).queryByLabelText('Name')).toBeNull()
    fireEvent.keyDown(container.querySelector<HTMLElement>('.cmp-canvas [data-node-id="test-dao-safe"]')!, { key: 'Delete' })
    expectNoWriteControls()
    expect(calls.filter(c => c.method !== 'GET')).toEqual([])
  })

  it('waits for who you are before drawing the canvas', async () => {
    let answer: (v: unknown) => void = () => {}
    fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(), 'GET /api/actor': () => new Promise(r => { answer = r }) }))
    renderAt(<Compose />, '/compose')
    expect(await screen.findByRole('heading', { level: 1, name: 'Compose' })).toBeTruthy()
    await new Promise(r => setTimeout(r, 50))
    expect(document.querySelector('.cmp-canvas')).toBeNull()
    answer({ id: 'steward-a', name: 'Steward A', kind: 'person' })
    await waitFor(() => expect(nodeIds().length).toBe(5))
    expect(screen.getByRole('group', { name: 'Place a System' })).toBeTruthy()
  })

  it('a deployed System the composition names: its inspector says what is edited, Delete stages nothing, a move stages its place (L7 gap B1)', async () => {
    const votes = { ...COMPOSED_SYSTEMS[2] as Record<string, unknown>, relates: [{ to: 'forum', label: 'elects' }] }
    const { calls } = fetchRoutes(baseRoutes({ 'GET /api/registries/systems': systems(COMPOSED_SYSTEMS.map(s => (s.id === 'test-dao-votes' ? votes : s))) }))
    const { container } = renderAt(<Compose />, '/compose')
    await waitFor(() => expect(nodeIds()).toContain('forum'))
    const forum = container.querySelector<HTMLElement>('.cmp-canvas [data-node-id="forum"]')!
    fireEvent.click(forum)
    const insp = screen.getByRole('region', { name: 'Forum' })
    expect(insp.textContent).toContain(DEPLOYED)
    expect(within(insp).getByLabelText('Name')).toBeTruthy()
    fireEvent.keyDown(forum, { key: 'Delete' })
    await new Promise(r => setTimeout(r, 20))
    expect(nodeIds()).toContain('forum')
    expect(calls.filter(c => c.method === 'POST')).toEqual([])
    fireEvent.keyDown(forum, { key: 'ArrowRight' })
    await waitFor(() => expect(calls.filter(c => c.method === 'POST').map(c => c.path)).toEqual(['/api/changes/ops']))
  })
})

