// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ComposeCanvas } from './ComposeCanvas.tsx'
import { DEPLOYED, DEPLOYED_REMOVE, DEPLOYED_TREE, type ComposeEdge, type ComposeNode } from './compose.ts'
import { CHAIN_HELD_SENTENCE } from '../../../../lib/chain-held.mjs'
import { ViewAsProvider } from '../../viewAs/ViewAs.tsx'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const A1 = 'eip155:11155111:0x00000000000000000000000000000000000000a1'
const A2 = 'eip155:11155111:0x00000000000000000000000000000000000000a2'
const A3 = 'eip155:11155111:0x00000000000000000000000000000000000000a3'
const SEPOLIA = 'eip155:11155111'
const SHELF = ['safe', 'hats-tree', 'hat', 'snapshot-space', 'link']
const NODES: ComposeNode[] = [
  { id: 'roles/top', kind: 'hat', tree: 'roles', name: 'Top hat', x: 120, y: 60, order: 0, wearers: [A1] },
  { id: 'roles/signers', kind: 'hat', tree: 'roles', name: 'Signers', x: 120, y: 200, order: 0, wearers: [A1, A2] },
  { id: 'roles', kind: 'hats-tree', name: 'Roles', x: 420, y: 60, order: 1 },
  { id: 'vault', kind: 'safe', name: 'Vault', x: 120, y: 340, order: 3, owners: [A1, A2, A3], threshold: 2 },
  { id: 'forum', kind: 'link', name: 'Forum', x: 420, y: 200, order: 0 },
]
const EDGES: ComposeEdge[] = [{ from: 'roles/top', to: 'roles/signers', label: 'appoints' }]

let fetchSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
  // the canvas's visible box, as a browser would measure it
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).classList.contains('cmp-canvas') ? 600 : 0 } })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return (this as HTMLElement).classList.contains('cmp-canvas') ? 440 : 0 } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
})

const draw = (over: { nodes?: ComposeNode[]; edges?: ComposeEdge[] } = {}) => {
  const onStage = vi.fn()
  const r = render(<ComposeCanvas shelf={SHELF} nodes={over.nodes ?? NODES} edges={over.edges ?? EDGES} chain={SEPOLIA} onStage={onStage} />)
  return { ...r, onStage }
}
const nodeEl = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`.cmp-canvas [data-node-id="${id}"]`)!
const select = (c: HTMLElement, id: string) => { const n = nodeEl(c, id); fireEvent.click(n); n.focus(); return n }

describe('ComposeCanvas (§8.7)', () => {
  it('selecting a shelf item and pressing Enter places it at the canvas centre, selected and focused', () => {
    const { container, onStage } = draw()
    const safe = within(screen.getByRole('group', { name: 'Place a System' })).getByRole('button', { name: /^Safe/ })
    safe.focus()
    fireEvent.keyDown(safe, { key: 'Enter' })
    expect(onStage).toHaveBeenCalledTimes(1)
    const [ops] = onStage.mock.calls[0]!
    expect(ops).toEqual([{ op: 'create', record: 'systems:safe-1', value: { id: 'safe-1', kind: 'safe', driver: 'safe', name: 'New Safe', chain: SEPOLIA, position: { x: 300, y: 220 }, order: 4, deployment: { status: 'composed' } } }])
    const placed = nodeEl(container, 'safe-1')
    expect(document.activeElement).toBe(placed)
    expect(placed.className).toContain('is-selected')
    expect(placed.closest<HTMLElement>('.cmp-node')!.style.left).toBe('300px')
  })

  it('arrows move the selected node 8px, Shift+arrows 40px, each move staged', () => {
    const { container, onStage } = draw()
    const n = select(container, 'vault')
    fireEvent.keyDown(n, { key: 'ArrowRight' })
    expect(onStage).toHaveBeenLastCalledWith([{ op: 'update', record: 'systems:vault', set: { position: { x: 128, y: 340 } } }])
    fireEvent.keyDown(n, { key: 'ArrowDown', shiftKey: true })
    expect(onStage).toHaveBeenLastCalledWith([{ op: 'update', record: 'systems:vault', set: { position: { x: 128, y: 380 } } }])
    expect(nodeEl(container, 'vault').closest<HTMLElement>('.cmp-node')!.style.top).toBe('380px')
  })

  it('c on the selected node, then arrows to pick the target, then Enter connects', () => {
    const { container, onStage } = draw()
    const n = select(container, 'roles/signers')
    fireEvent.keyDown(n, { key: 'c' })
    fireEvent.keyDown(n, { key: 'ArrowDown' })
    expect(nodeEl(container, 'vault').className).toContain('cmp-target')
    fireEvent.keyDown(n, { key: 'Enter' })
    expect(onStage).toHaveBeenLastCalledWith([{ op: 'update', record: 'systems:vault', set: { signer_gate: { threshold: { type: 'absolute', min: 1, target: 1 }, claimable_for: false, hats: ['roles/signers'] } } }])
    expect(container.querySelectorAll('.cmp-canvas svg .hedge:not(.is-bad)')).toHaveLength(2)
    expect(container.querySelector('.cmp-target')).toBeNull()
  })

  it('an invalid connection draws the clay dashed edge and an alert note, announced once', () => {
    const { container, onStage } = draw()
    const n = select(container, 'forum')
    fireEvent.keyDown(n, { key: 'c' })
    fireEvent.keyDown(n, { key: 'ArrowLeft' }) // the nearest that way: Signers, a hat; then down to the Safe
    fireEvent.keyDown(n, { key: 'ArrowDown' })
    fireEvent.keyDown(n, { key: 'Enter' })
    expect(onStage).not.toHaveBeenCalled() // a refused relation is not staged
    expect(container.querySelectorAll('.cmp-canvas svg .hedge.is-bad')).toHaveLength(1)
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.textContent).toBe('A link can’t sign for a Safe. Connect a hat or addresses.')
    expect(alerts[0]!.querySelector('[data-glyph="alert"], .i')).not.toBeNull()
    // another action re-renders the canvas; the note is the same element, so it is not announced again
    fireEvent.keyDown(nodeEl(container, 'forum'), { key: 'ArrowUp' })
    expect(screen.getAllByRole('alert')).toEqual(alerts)
  })

  it('the note is the canvas\'s, beside the plane, at the edge it refuses; only the latest note shows (E-88)', () => {
    const bad = (from: string, to: string, invalid: string): ComposeEdge => ({ from, to, label: '', invalid })
    const { container } = draw({ edges: [...EDGES, bad('forum', 'vault', 'first refusal'), bad('forum', 'roles/signers', 'A link can’t appoint a hat.')] })
    const alerts = screen.getAllByRole('alert')
    expect(alerts.map(a => a.textContent)).toEqual(['A link can’t appoint a hat.'])
    const note = alerts[0]!
    expect(note.parentElement!.classList.contains('cmp-canvas')).toBe(true)
    expect(note.closest('.cmp-plane')).toBeNull()
    // at the midpoint of the edge it refuses, in the plane's own coordinates
    expect(note.style.left).toMatch(/^\d+(\.\d+)?px$/)
    expect(note.style.top).toMatch(/^\d+(\.\d+)?px$/)
    expect(container.querySelectorAll('.cmp-canvas svg .hedge.is-bad')).toHaveLength(2)
  })

  it('under 820px of the canvas, the note falls to the canvas\'s foot in the flow, its edge position unread (E-88, the gallery)', () => {
    const css = readFileSync(join(process.cwd(), 'app/src/design/css/map.css'), 'utf8')
    const narrow = css.slice(css.indexOf('@container compose (max-width: 819px)'))
    const block = narrow.slice(0, narrow.indexOf('\n}') + 2)
    expect(block).toMatch(/\.cmp-canvas \{ display: flex; flex-direction: column; \}/)
    expect(block).toMatch(/\.cmp-plane \{ flex: none; \}/)
    expect(block).toMatch(/\.cmp-bad \{ position: static; max-inline-size: none; margin: auto var\(--sp-6\) var\(--sp-6\); \}/)
  })

  it('Delete stages a removal, and the node and its edges go', () => {
    const { container, onStage } = draw()
    const n = select(container, 'roles/signers')
    fireEvent.keyDown(n, { key: 'Delete' })
    expect(onStage).toHaveBeenLastCalledWith([{ op: 'update', record: 'systems:roles', set: { hats: [{ key: 'top', details: 'Top hat', admin: 'top', max_supply: 1, mutable: true, wearers: [A1], role: 'acts', hat: null }] } }])
    expect(container.querySelector('[data-node-id="roles/signers"]')).toBeNull()
    expect(container.querySelectorAll('.cmp-canvas svg .hedge')).toHaveLength(0)
  })

  it('every action calls onStage and nothing else: no request is made', () => {
    const { container, onStage } = draw()
    fireEvent.click(within(screen.getByRole('group', { name: 'Place a System' })).getByRole('button', { name: /^Hat\b/ }))
    const n = select(container, 'vault')
    fireEvent.keyDown(n, { key: 'ArrowLeft' })
    fireEvent.keyDown(n, { key: 'Delete' })
    fireEvent.click(screen.getByRole('button', { name: 'Review order' }))
    fireEvent.click(screen.getByRole('button', { name: 'Propose' }))
    expect(onStage).toHaveBeenCalledTimes(3)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('draws nodes as drafts with their deployment order badge; the selected node shows four handles', () => {
    const { container } = draw()
    const drafts = container.querySelectorAll('.cmp-canvas .hnode.is-draft')
    expect(drafts).toHaveLength(5)
    expect([...container.querySelectorAll('.cmp-canvas .hnode-order')].map(b => b.textContent)).toEqual(['1', '3']) // a link is never deployed, nor a hat on its own
    expect(nodeEl(container, 'roles/top').getAttribute('aria-label')).toBe('Top hat, Sepolia, not deployed, Hat') // the drawn words first, as drawn (C11, 2.5.3)
    expect(container.querySelectorAll('.cmp-handle')).toHaveLength(0)
    select(container, 'roles/signers')
    const handles = container.querySelectorAll('.cmp-node .cmp-handle')
    expect(handles).toHaveLength(4)
    expect([...handles].map(h => h.getAttribute('data-side'))).toEqual(['n', 'e', 's', 'w'])
    expect(nodeEl(container, 'roles/signers').closest('.cmp-node')!.contains(handles[0]!)).toBe(true)
  })

  it('the inspector shows the selected node: kind tile, "<Kind> · not deployed", its name and fields', () => {
    const { container, onStage } = draw()
    expect(screen.getByText('Select a System to see its fields.')).toBeTruthy()
    select(container, 'roles/signers')
    const insp = screen.getByRole('region', { name: 'Signers' })
    expect(insp.querySelector('.ktile')).not.toBeNull()
    expect(within(insp).getByText('Hat · not deployed')).toBeTruthy()
    const name = within(insp).getByLabelText('Name') as HTMLInputElement
    expect(name.value).toBe('Signers')
    fireEvent.change(name, { target: { value: 'Signer hat' } })
    fireEvent.blur(name)
    const hats = (onStage.mock.lastCall![0][0] as { set: { hats: { key: string; details: string }[] } }).set.hats
    expect(hats.map(h => [h.key, h.details])).toEqual([['top', 'Top hat'], ['signers', 'Signer hat']])
  })

  it('the foot reads "Staged · not yet deployed", the prepared transactions in order on the chain, Review order and Propose', () => {
    draw({ edges: [...EDGES, { from: 'roles/signers', to: 'vault', label: 'signs' }] })
    const foot = document.querySelector<HTMLElement>('.cmp-foot')!
    expect(within(foot).getByText('Staged · not yet deployed')).toBeTruthy()
    expect(within(foot).getByText('3 prepared transactions, in order · Sepolia')).toBeTruthy()
    expect(within(foot).getByRole('button', { name: 'Review order' }).className).not.toContain('primary')
    expect(within(foot).getByRole('button', { name: 'Propose' }).className).toContain('primary')
  })

  // DAO-OS L7 Task 17: the count is the planner's (Task 11's GET /api/deploy); /compose passes `prepared={null}` until
  // it is read, and no line is drawn. A composition with nothing staged is composed, not staged, and has nothing to review.
  it('draws no count while no plan is read (prepared null), and with nothing staged says composed and offers no Review or Propose', () => {
    render(<ComposeCanvas shelf={SHELF} nodes={NODES} edges={EDGES} chain={SEPOLIA} onStage={() => {}} prepared={null} staged={false} />)
    const foot = document.querySelector<HTMLElement>('.cmp-foot')!
    expect(foot.textContent).not.toMatch(/prepared transaction/)
    expect(within(foot).getByText('Composed · not yet deployed')).toBeTruthy()
    expect(within(foot).queryByRole('button')).toBeNull()
  })

  it('draws the planner’s count when it is given', () => {
    render(<ComposeCanvas shelf={SHELF} nodes={NODES} edges={EDGES} chain={SEPOLIA} onStage={() => {}} prepared={{ steps: 9 }} />)
    expect(within(document.querySelector<HTMLElement>('.cmp-foot')!).getByText('9 prepared transactions, in order · Sepolia')).toBeTruthy()
  })

  it('previewing as another viewer draws the canvas without its write controls', () => {
    render(<ViewAsProvider initial={{ as: 'members' }}><ComposeCanvas shelf={SHELF} nodes={NODES} edges={EDGES} chain={SEPOLIA} onStage={() => {}} /></ViewAsProvider>)
    expect(screen.queryByRole('group', { name: 'Place a System' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Propose' })).toBeNull()
    expect(document.querySelectorAll('.cmp-canvas .hnode')).toHaveLength(5)
  })

  it('the Safe’s inspector shows its owners, and a threshold stepper bounded 1…owners that stages the new threshold', () => {
    const { container, onStage } = draw()
    select(container, 'vault')
    const insp = screen.getByRole('region', { name: 'Vault' })
    expect(within(insp).getByRole('list', { name: 'Owners' }).textContent).toBe('0x0000…00a10x0000…00a20x0000…00a3')
    expect(within(insp).getByText('2 of 3')).toBeTruthy()
    fireEvent.click(within(insp).getByRole('button', { name: 'Raise threshold' }))
    expect(onStage).toHaveBeenLastCalledWith([{ op: 'update', record: 'systems:vault', set: { deployment: { status: 'composed', owners: [A1, A2, A3], threshold: 3 } } }])
    expect(within(insp).getByText('3 of 3')).toBeTruthy()
    expect(within(insp).getByRole('button', { name: 'Raise threshold' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(within(insp).getByRole('button', { name: 'Lower threshold' }))
    fireEvent.click(within(insp).getByRole('button', { name: 'Lower threshold' }))
    expect(within(insp).getByText('1 of 3')).toBeTruthy()
    expect(within(insp).getByRole('button', { name: 'Lower threshold' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('a hat’s inspector shows its wearers', () => {
    const { container } = draw()
    select(container, 'roles/signers')
    const insp = screen.getByRole('region', { name: 'Signers' })
    expect(within(insp).getByText('Wearers')).toBeTruthy()
    expect(insp.textContent).toContain('0x0000…00a1')
    expect(insp.textContent).toContain('0x0000…00a2')
  })

  it('placing a hat with no Hats tree on the canvas is refused in words and stages nothing', () => {
    const { onStage } = draw({ nodes: NODES.filter(n => n.kind !== 'hats-tree' && n.kind !== 'hat'), edges: [] })
    fireEvent.click(within(screen.getByRole('group', { name: 'Place a System' })).getByRole('button', { name: /^Hat\b/ }))
    expect(onStage).not.toHaveBeenCalled()
    // A refusal is an error note, said once through the polite region, never a second alert (C11 I-2, the platform merge).
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.querySelector('.cmp-shelf .note-error')?.textContent).toBe('A hat lives in a Hats tree. Place a Hats tree first.')
  })

  it('placing a hat with a tree stages the tree’s whole hats list', () => {
    const { container, onStage } = draw()
    fireEvent.click(within(screen.getByRole('group', { name: 'Place a System' })).getByRole('button', { name: /^Hat\b/ }))
    const set = (onStage.mock.lastCall![0][0] as { record: string; set: { hats: { key: string }[] } })
    expect(set.record).toBe('systems:roles')
    expect(set.set.hats.map(h => h.key)).toEqual(['top', 'signers', 'new-hat'])
    expect(nodeEl(container, 'roles/new-hat')).not.toBeNull()
  })
})

describe('ComposeCanvas carries (L4b B9 M-2, M-4; final M-1, B9 M-3)', () => {
  /** pointer events with coordinates, whether or not jsdom has PointerEvent */
  const ptr = (type: string, target: Element | Window, x: number, y: number) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })
    fireEvent(target, e)
  }
  const wrapper = (c: HTMLElement, id: string) => nodeEl(c, id).closest<HTMLElement>('.cmp-node')!

  it('a drag under 4px stages nothing', () => {
    const { container, onStage } = draw()
    ptr('pointerdown', wrapper(container, 'vault'), 200, 200)
    ptr('pointermove', window, 202, 201)
    ptr('pointerup', window, 202, 201)
    expect(onStage).not.toHaveBeenCalled()
    expect(wrapper(container, 'vault').style.left).toBe('120px')
  })

  it('a drag over 4px stages one move', () => {
    const { container, onStage } = draw()
    ptr('pointerdown', wrapper(container, 'vault'), 200, 200)
    ptr('pointermove', window, 210, 200)
    ptr('pointermove', window, 230, 220)
    ptr('pointerup', window, 230, 220)
    expect(onStage).toHaveBeenCalledTimes(1)
    expect(onStage).toHaveBeenCalledWith([{ op: 'update', record: 'systems:vault', set: { position: { x: 150, y: 360 } } }])
  })

  it('pointercancel stages nothing and leaves no listener', () => {
    const adds = vi.spyOn(window, 'addEventListener')
    const removes = vi.spyOn(window, 'removeEventListener')
    const pointer = (spy: typeof adds) => spy.mock.calls.filter(([t]) => String(t).startsWith('pointer')).length
    const { container, onStage } = draw()
    const before = pointer(adds) - pointer(removes)
    ptr('pointerdown', wrapper(container, 'vault'), 200, 200)
    expect(pointer(adds) - pointer(removes)).toBeGreaterThan(before)
    ptr('pointermove', window, 240, 240)
    ptr('pointercancel', window, 240, 240)
    expect(pointer(adds) - pointer(removes)).toBe(before)
    expect(onStage).not.toHaveBeenCalled()
    expect(wrapper(container, 'vault').style.left).toBe('120px') // back where it was
    adds.mockRestore(); removes.mockRestore()
  })

  it('a handle drag onto a node connects', () => {
    const { container, onStage } = draw()
    select(container, 'roles/signers')
    const handle = wrapper(container, 'roles/signers').querySelector('.cmp-handle')!
    const target = nodeEl(container, 'vault')
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target })
    const at = { mockRestore: () => { delete (document as { elementFromPoint?: unknown }).elementFromPoint } }
    ptr('pointerdown', handle, 10, 10)
    ptr('pointerup', window, 120, 340)
    at.mockRestore()
    expect(onStage).toHaveBeenCalledTimes(1)
    expect(onStage.mock.lastCall![0][0]).toMatchObject({ record: 'systems:vault', set: { signer_gate: { hats: ['roles/signers'] } } })
  })

  it('a shelf item dropped places a node', () => {
    const { container, onStage } = draw()
    const canvas = container.querySelector('.cmp-canvas')!
    const dt = { types: ['application/x-org-os-kind'], getData: () => 'safe', setData() {} }
    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 300, clientY: 250 })
    Object.defineProperty(drop, 'dataTransfer', { value: dt })
    fireEvent(canvas, drop)
    expect(onStage).toHaveBeenCalledTimes(1)
    expect(onStage.mock.lastCall![0][0]).toMatchObject({ op: 'create', record: 'systems:safe-1', value: { kind: 'safe', position: { x: 300, y: 250 } } })
  })

  it('Esc stops connecting', () => {
    const { container, onStage } = draw()
    const n = select(container, 'roles/signers')
    fireEvent.keyDown(n, { key: 'c' })
    fireEvent.keyDown(n, { key: 'ArrowDown' })
    expect(container.querySelector('.cmp-target')).not.toBeNull()
    fireEvent.keyDown(n, { key: 'Escape' })
    expect(container.querySelector('.cmp-target')).toBeNull()
    fireEvent.keyDown(n, { key: 'Enter' })
    expect(onStage).not.toHaveBeenCalled()
  })

  it('rename stages on blur, and only when the name changed', () => {
    const { container, onStage } = draw()
    select(container, 'vault')
    const name = within(screen.getByRole('region', { name: 'Vault' })).getByLabelText('Name') as HTMLInputElement
    fireEvent.blur(name)
    expect(onStage).not.toHaveBeenCalled()
    fireEvent.change(name, { target: { value: 'Treasury' } })
    fireEvent.blur(name)
    expect(onStage).toHaveBeenCalledWith([{ op: 'update', record: 'systems:vault', set: { name: 'Treasury' } }])
  })

  it('new props re-seed the nodes when no drag is in progress', () => {
    const onStage = vi.fn()
    const { container, rerender } = render(<ComposeCanvas shelf={SHELF} nodes={NODES} edges={EDGES} chain={SEPOLIA} onStage={onStage} />)
    const next = NODES.filter(n => n.id !== 'forum')
    rerender(<ComposeCanvas shelf={SHELF} nodes={next} edges={EDGES} chain={SEPOLIA} onStage={onStage} />)
    expect(nodeEl(container, 'forum')).toBeNull()
    expect(container.querySelectorAll('.cmp-canvas .hnode')).toHaveLength(4)
  })

  it('new props wait for a drag in progress, then arrive when it ends', () => {
    const onStage = vi.fn()
    const { container, rerender } = render(<ComposeCanvas shelf={SHELF} nodes={NODES} edges={EDGES} chain={SEPOLIA} onStage={onStage} />)
    ptr('pointerdown', wrapper(container, 'vault'), 200, 200)
    ptr('pointermove', window, 230, 230)
    rerender(<ComposeCanvas shelf={SHELF} nodes={NODES.filter(n => n.id !== 'forum')} edges={EDGES} chain={SEPOLIA} onStage={onStage} />)
    expect(nodeEl(container, 'forum')).not.toBeNull()
    ptr('pointercancel', window, 230, 230)
    expect(nodeEl(container, 'forum')).toBeNull()
  })

  it('a hat appointing a hat of another tree draws the refusal and stages nothing', () => {
    const nodes = [...NODES, { id: 'other', kind: 'hats-tree', name: 'Other', x: 420, y: 400, order: 4 }, { id: 'other/x', kind: 'hat', tree: 'other', name: 'X', x: 120, y: 440, order: 0 }]
    const { container, onStage } = draw({ nodes })
    const n = select(container, 'roles/signers')
    fireEvent.keyDown(n, { key: 'c' })
    for (let i = 0; i < 4 && !container.querySelector('[data-node-id="other/x"].cmp-target'); i++) fireEvent.keyDown(n, { key: 'ArrowDown' })
    expect(container.querySelector('[data-node-id="other/x"].cmp-target')).not.toBeNull()
    fireEvent.keyDown(n, { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toBe('A hat’s admin is a hat of the same tree.')
    expect(onStage).not.toHaveBeenCalled()
  })
})

describe('a deployed node: what the chain holds is shown, the rest is edited (L7 gap B1; was read only, I1)', () => {
  const DEPLOYED_NODES: ComposeNode[] = [
    ...NODES,
    { id: 'treasury', kind: 'safe', name: 'Treasury', x: 420, y: 340, order: 0, deployed: true, owners: [A1, A2], threshold: 1,
      address: '0x1111111111111111111111111111111111111111', notes: 'The council signs here.' },
    { id: 'dao-hats', kind: 'hats-tree', name: 'DAO hats', x: 720, y: 60, order: 0, deployed: true },
    { id: 'dao-hats/member', kind: 'hat', tree: 'dao-hats', name: 'Member', x: 720, y: 200, order: 0, deployed: true, wearers: [] },
  ]
  const drawD = () => draw({ nodes: DEPLOYED_NODES })

  it('Delete on a deployed Safe stages nothing, says why, and the node stays', () => {
    const said: string[] = []
    const hear = (e: Event) => said.push(String((e as CustomEvent).detail))
    window.addEventListener('org-os-announce', hear)
    const { container, onStage } = drawD()
    fireEvent.keyDown(select(container, 'treasury'), { key: 'Delete' })
    window.removeEventListener('org-os-announce', hear)
    expect(onStage).not.toHaveBeenCalled()
    expect(nodeEl(container, 'treasury')).not.toBeNull()
    expect(said).toContain(DEPLOYED_REMOVE)
  })

  it('arrows and a drag move a deployed Safe and stage its place; selected, it shows its handles; c connects from it', () => {
    const { container, onStage } = drawD()
    const n = select(container, 'treasury')
    expect(container.querySelectorAll('.cmp-handle')).toHaveLength(4)
    fireEvent.keyDown(n, { key: 'ArrowRight' })
    expect(onStage).toHaveBeenLastCalledWith([{ op: 'update', record: 'systems:treasury', set: { position: { x: 428, y: 340 } } }])
    const wrap = n.closest<HTMLElement>('.cmp-node')!
    fireEvent(wrap, new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }))
    fireEvent(window, new MouseEvent('pointermove', { bubbles: true, clientX: 90, clientY: 90 }))
    fireEvent(window, new MouseEvent('pointerup', { bubbles: true, clientX: 90, clientY: 90 }))
    expect(onStage).toHaveBeenCalledTimes(2)
    expect((onStage.mock.lastCall![0][0] as { set: Record<string, unknown> }).set).toHaveProperty('position')
  })

  it('its inspector edits its name, description and notes, and shows what the chain holds read only, with the sentence', () => {
    const { container, onStage } = drawD()
    select(container, 'treasury')
    const insp = screen.getByRole('region', { name: 'Treasury' })
    expect(within(insp).getByText('Safe · deployed')).toBeTruthy()
    expect(insp.textContent).toContain(DEPLOYED)
    const name = within(insp).getByLabelText('Name') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Council treasury' } })
    fireEvent.blur(name)
    expect(onStage).toHaveBeenLastCalledWith([{ op: 'update', record: 'systems:treasury', set: { name: 'Council treasury' } }])
    const notes = within(insp).getByLabelText('Notes') as HTMLTextAreaElement
    expect(notes.value).toBe('The council signs here.')
    fireEvent.change(notes, { target: { value: 'Signs the treasury.' } })
    fireEvent.blur(notes)
    expect(onStage).toHaveBeenLastCalledWith([{ op: 'update', record: 'systems:treasury', set: { notes: 'Signs the treasury.' } }])
    const description = within(insp).getByLabelText('Description') as HTMLInputElement
    fireEvent.change(description, { target: { value: 'Where the council signs.' } })
    fireEvent.blur(description)
    expect(onStage).toHaveBeenLastCalledWith([{ op: 'update', record: 'systems:treasury', set: { description: 'Where the council signs.' } }])
    // what the chain holds: read only, each with the sentence, and no stepper
    for (const field of ['chain', 'address', 'deployment.owners', 'deployment.threshold']) expect(insp.textContent, field).toContain(CHAIN_HELD_SENTENCE(field))
    expect(within(insp).getByText('0x1111…1111')).toBeTruthy()
    expect(within(insp).getByText('1 of 2')).toBeTruthy()
    expect(within(insp).queryByRole('button')).toBeNull()
  })

  it('a deployed tree’s hat is the chain’s: its name is read only, with the sentence', () => {
    const { container } = drawD()
    select(container, 'dao-hats/member')
    const insp = screen.getByRole('region', { name: 'Member' })
    expect(within(insp).queryByLabelText('Name')).toBeNull()
    expect(insp.textContent).toContain(CHAIN_HELD_SENTENCE('hats'))
  })

  it('a hat placed with a deployed tree (or its hat) selected is refused in words, and nothing is staged', () => {
    const { container, onStage } = drawD()
    for (const id of ['dao-hats', 'dao-hats/member']) {
      select(container, id)
      fireEvent.click(within(screen.getByRole('group', { name: 'Place a System' })).getByRole('button', { name: /^Hat\b/ }))
      expect(document.querySelector('.cmp-shelf .note-error')?.textContent).toBe(DEPLOYED_TREE)
    }
    expect(onStage).not.toHaveBeenCalled()
    expect(container.querySelectorAll('[data-node-id^="dao-hats/new"]')).toHaveLength(0)
  })

  it('with nothing selected, a hat goes into the first composed tree, never a deployed one', () => {
    const { onStage } = draw({ nodes: [DEPLOYED_NODES.at(-2)!, ...NODES] })
    fireEvent.click(within(screen.getByRole('group', { name: 'Place a System' })).getByRole('button', { name: /^Hat\b/ }))
    expect((onStage.mock.lastCall![0][0] as { record: string }).record).toBe('systems:roles')
  })

  it('a connection from a composed hat into a deployed Safe is refused in words, and stages nothing', () => {
    const { container, onStage } = drawD()
    const n = select(container, 'roles/signers')
    fireEvent.keyDown(n, { key: 'c' })
    for (let i = 0; i < 6 && !container.querySelector('[data-node-id="treasury"].cmp-target'); i++) fireEvent.keyDown(n, { key: i < 3 ? 'ArrowRight' : 'ArrowDown' })
    expect(container.querySelector('[data-node-id="treasury"].cmp-target')).not.toBeNull()
    fireEvent.keyDown(n, { key: 'Enter' })
    expect(onStage).not.toHaveBeenCalled()
    expect(document.querySelector('.cmp-bad')?.textContent).toMatch(/deployed/)
  })
})

