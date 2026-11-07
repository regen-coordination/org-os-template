// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ComposeCanvas } from './ComposeCanvas.tsx'
import type { ComposeEdge, ComposeNode } from './compose.ts'
import { ViewAsProvider } from '../../viewAs/ViewAs.tsx'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SEPOLIA = 'eip155:11155111'
const SHELF = ['safe', 'hats-tree', 'hat', 'snapshot-space', 'link']
const NODES: ComposeNode[] = [
  { id: 'top', kind: 'hat', name: 'Top hat', x: 120, y: 60, order: 1 },
  { id: 'signers', kind: 'hat', name: 'Signers', x: 120, y: 200, order: 2 },
  { id: 'vault', kind: 'safe', name: 'Vault', x: 120, y: 340, order: 3 },
  { id: 'forum', kind: 'link', name: 'Forum', x: 420, y: 200, order: 0 },
]
const EDGES: ComposeEdge[] = [{ from: 'top', to: 'signers', label: 'appoints' }]

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
    expect(ops).toEqual([{ op: 'create', record: 'systems:safe-1', value: { id: 'safe-1', kind: 'safe', name: 'New Safe', position: { x: 300, y: 220 }, order: 4 } }])
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
    const n = select(container, 'signers')
    fireEvent.keyDown(n, { key: 'c' })
    fireEvent.keyDown(n, { key: 'ArrowDown' })
    expect(nodeEl(container, 'vault').className).toContain('cmp-target')
    fireEvent.keyDown(n, { key: 'Enter' })
    expect(onStage).toHaveBeenLastCalledWith([{ op: 'update', record: 'systems:signers', set: { relates: [{ to: 'vault', label: 'signs' }] } }])
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
    const { container } = draw({ edges: [...EDGES, bad('forum', 'vault', 'first refusal'), bad('forum', 'signers', 'A link can’t appoint a hat.')] })
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
    const n = select(container, 'signers')
    fireEvent.keyDown(n, { key: 'Delete' })
    expect(onStage).toHaveBeenLastCalledWith([{ op: 'delete', record: 'systems:signers' }, { op: 'update', record: 'systems:top', set: { relates: [] } }])
    expect(container.querySelector('[data-node-id="signers"]')).toBeNull()
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
    expect(drafts).toHaveLength(4)
    expect([...container.querySelectorAll('.cmp-canvas .hnode-order')].map(b => b.textContent)).toEqual(['1', '2', '3']) // a link is never deployed
    expect(nodeEl(container, 'top').getAttribute('aria-label')).toBe('Top hat, Sepolia, not deployed, 1, Hat') // the drawn words first, as drawn (C11, 2.5.3)
    expect(container.querySelectorAll('.cmp-handle')).toHaveLength(0)
    select(container, 'signers')
    const handles = container.querySelectorAll('.cmp-node .cmp-handle')
    expect(handles).toHaveLength(4)
    expect([...handles].map(h => h.getAttribute('data-side'))).toEqual(['n', 'e', 's', 'w'])
    expect(nodeEl(container, 'signers').closest('.cmp-node')!.contains(handles[0]!)).toBe(true)
  })

  it('the inspector shows the selected node: kind tile, "<Kind> · not deployed", its name and fields', () => {
    const { container, onStage } = draw()
    expect(screen.getByText('Select a System to see its fields.')).toBeTruthy()
    select(container, 'signers')
    const insp = screen.getByRole('region', { name: 'Signers' })
    expect(insp.querySelector('.ktile')).not.toBeNull()
    expect(within(insp).getByText('Hat · not deployed')).toBeTruthy()
    const name = within(insp).getByLabelText('Name') as HTMLInputElement
    expect(name.value).toBe('Signers')
    fireEvent.change(name, { target: { value: 'Signer hat' } })
    fireEvent.blur(name)
    expect(onStage).toHaveBeenLastCalledWith([{ op: 'update', record: 'systems:signers', set: { name: 'Signer hat' } }])
  })

  it('the foot reads "Staged · not yet deployed", the prepared transactions in order on the chain, Review order and Propose', () => {
    draw({ edges: [...EDGES, { from: 'signers', to: 'vault', label: 'signs' }] })
    const foot = document.querySelector<HTMLElement>('.cmp-foot')!
    expect(within(foot).getByText('Staged · not yet deployed')).toBeTruthy()
    expect(within(foot).getByText('4 prepared transactions, in order · Sepolia')).toBeTruthy()
    expect(within(foot).getByRole('button', { name: 'Review order' }).className).not.toContain('primary')
    expect(within(foot).getByRole('button', { name: 'Propose' }).className).toContain('primary')
  })

  it('previewing as another viewer draws the canvas without its write controls', () => {
    render(<ViewAsProvider initial={{ as: 'members' }}><ComposeCanvas shelf={SHELF} nodes={NODES} edges={EDGES} chain={SEPOLIA} onStage={() => {}} /></ViewAsProvider>)
    expect(screen.queryByRole('group', { name: 'Place a System' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Propose' })).toBeNull()
    expect(document.querySelectorAll('.cmp-canvas .hnode')).toHaveLength(4)
  })
})
