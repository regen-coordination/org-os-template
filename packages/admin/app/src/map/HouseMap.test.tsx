// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HouseMap } from './HouseMap.tsx'
import { HouseNode, type MapNodeData, type NodeState } from './HouseNode.tsx'
import { labelFits } from './HouseEdge.tsx'
import { FLOW_RUNS, FLOW_RUN_MS } from './valueFlow.ts'
import type { MapLink } from './layers.ts'
import { flowEnv } from '../test/flowEnv.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { PanelProvider, usePanel } from '../parts/panels.tsx'
import { FIXTURE_SOURCE, type VisibilitySource } from '../viewAs/visibility.ts'
import {
  DOOR_NODES, MAP_ANATOMY, MAP_FLOW, MAP_STARTER, MAP_LINKS, MAP_NETWORK, MAP_NODES, MAP_NODES_ROLES_RESTRICTED, MAP_SIGNER, MAP_TREASURY,
} from '../test/fixtures/house/map.ts'

// The view's geometry is not real in jsdom: the tests watch the map's fitView calls.
const fitView = vi.hoisted(() => vi.fn())
vi.mock('@xyflow/react', async importOriginal => {
  const m = await importOriginal<typeof import('@xyflow/react')>()
  return { ...m, useReactFlow: () => {
    const rf = m.useReactFlow()
    return { ...rf, fitView: (o?: Parameters<typeof rf.fitView>[0]) => { fitView(o); return Promise.resolve(true) } }
  } }
})

const css = readFileSync(join(process.cwd(), 'app/src/design/css/map.css'), 'utf8') // vitest runs from packages/admin
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')

let reduce = false
beforeEach(() => {
  flowEnv(); fitView.mockClear(); reduce = false
  // the map is 1200 wide, as on a desktop; the rest as flowEnv sizes it
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() {
    return (this as HTMLElement).classList.contains('hmap') ? 1200 : parseFloat((this as HTMLElement).style.width) || 1
  } })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('prefers-reduced-motion: reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

const nodeEl = (id: string) => document.querySelector<HTMLElement>(`[data-node-id="${id}"]`)
const edgeEl = (from: string, to: string) => document.querySelector<SVGPathElement>(`[data-testid="rf__edge-${from}>${to}"] path.hedge`)
const drawn = async () => { await waitFor(() => expect(document.querySelectorAll('.react-flow__edge').length).toBeGreaterThan(0)) }
const state = (name: string) => MAP_ANATOMY.find(a => a.state === name)!.node

describe('a node, in each state of §8.3', () => {
  const one = (d: MapNodeData, over: Partial<Parameters<typeof HouseNode>[0]> = {}) => {
    const { container } = render(<HouseNode data={d} {...over} />)
    return container.querySelector<HTMLElement>('.hnode')!
  }
  const has = (el: HTMLElement, s: NodeState) => el.classList.contains(`is-${s}`)

  it('default: name with its kind glyph, one line of facts', () => {
    const el = one(state('default'))
    expect(el.tagName).toBe('BUTTON')
    expect(el.querySelector('.hnode-n')!.textContent).toBe('Operations')
    expect(el.querySelector('.hnode-g')!.getAttribute('data-glyph')).toBe('hat')
    expect(el.querySelector('.hnode-f')!.textContent).toBe('hat 13.2 · 1 wears it')
    expect([...el.classList].filter(c => c.startsWith('is-'))).toEqual([])
  })

  it('selected, needs you (the clay dot), staged (the moss tag), dimmed', () => {
    expect(has(one(state('selected')), 'selected')).toBe(true)
    const needs = one(state('needs you'))
    expect(has(needs, 'needs')).toBe(true)
    expect(needs.querySelector('.hnode-dot')!.getAttribute('aria-hidden')).toBe('true')
    const staged = one(state('staged change'))
    expect(staged.querySelector('.hnode-tag')!.textContent).toBe('staged')
    expect(staged.querySelector('.hnode-dot')).toBeNull()
    expect(has(one(state('dimmed (off the path)')), 'dim')).toBe(true)
  })

  it('aged: the facts lead with the clock', () => {
    const f = one(state('old read')).querySelector('.hnode-f')!
    expect(f.firstElementChild!.getAttribute('data-glyph')).toBe('clock')
    expect(f.textContent).toBe('exampledao.eth · 38 min')
  })

  it('failed: clay facts with the alert glyph, "couldn’t read · 2 h", and the dot', () => {
    const el = one(state('failed read'))
    expect(has(el, 'failed')).toBe(true)
    expect(el.querySelector('.hnode-f')!.firstElementChild!.getAttribute('data-glyph')).toBe('alert')
    expect(el.querySelector('.hnode-f')!.textContent).toBe('couldn’t read · 2 h')
    expect(el.querySelector('.hnode-dot')).not.toBeNull()
  })

  it('reading: the spinner and "reading…" in place of the facts', () => {
    const el = one(state('reading'))
    expect(el.querySelector('.hnode-f .spin')).not.toBeNull()
    expect(el.querySelector('.hnode-f')!.textContent).toBe('reading…')
    expect(el.getAttribute('aria-busy')).toBe('true')
  })

  // A2 (fix wave): a node whose name the viewer is not admitted to reads "<hat> only", never the value.
  it('a restricted name: the node draws "<hat> only" with the lock, and its name says it', () => {
    const el = one({ item: { ...state('default').item, name: 'Ops only', nameKept: 'Ops' }, facts: 'hat 13.2 · 1 wears it', states: [] })
    const n = el.querySelector('.hnode-n')!
    expect(n.textContent).toBe('Ops only')
    expect(n.querySelector('.vis-field')).not.toBeNull()
    expect(n.querySelector('.vis-field svg')).not.toBeNull() // the lock
    expect(el.getAttribute('aria-label')).toMatch(/^Ops only, /)
  })

  // R2 (fix wave): the facts line printed the status the table masked; it reads "<hat> only" too.
  it('a restricted status: the facts line draws "<hat> only" with the lock, and the name says it', () => {
    const el = one({ item: { ...state('default').item, name: 'P' }, facts: '', factsKept: 'Ops', states: [] })
    const f = el.querySelector('.hnode-f')!
    expect(f.textContent).toBe('Ops only')
    expect(f.querySelector('.vis-field')).not.toBeNull()
    expect(f.querySelector('.vis-field svg')).not.toBeNull() // the lock
    expect(el.getAttribute('aria-label')).toContain('Ops only')
  })

  it('linked: dashed, the link glyph, the facts end "↗"', () => {
    const el = one(state('linked, not read'))
    expect(has(el, 'linked')).toBe(true)
    expect(el.querySelector('.hnode-g')!.getAttribute('data-glyph')).toBe('link')
    expect(el.querySelector('.hnode-f')!.textContent).toBe('impact reports ↗')
    // so is a wallet the map reads as linked
    expect(one(MAP_NODES.find(d => d.item.kind === 'wallet')!).querySelector('.hnode-g')!.getAttribute('data-glyph')).toBe('link')
  })

  it('empty hat: dashed, "no wearer", the dot', () => {
    const el = one(state('empty hat'))
    expect(has(el, 'empty-hat')).toBe(true)
    expect(el.querySelector('.hnode-f')!.textContent).toBe('hat 13.2.3 · no wearer')
    expect(el.querySelector('.hnode-dot')).not.toBeNull()
  })

  it('composed, not deployed: dashed moss, the "not deployed" tag and the order badge', () => {
    const el = one(state('composed, not deployed'))
    expect(has(el, 'draft')).toBe(true)
    expect(el.querySelector('.hnode-tag.hnode-tag-draft')!.textContent).toBe('not deployed')
    expect(el.querySelector('.hnode-order')!.textContent).toBe('3')
  })

  it('the big node has the "SAFE" eyebrow and the display face', () => {
    const safe = one({ item: MAP_TREASURY, facts: '4 of 8 · 7 chains', states: [] }, { big: true })
    expect(safe.classList.contains('hnode-big')).toBe(true)
    expect(safe.querySelector('.hnode-k')!.textContent).toBe('Safe')
    expect(safe.querySelector('.hnode-n')!.classList.contains('hnode-display')).toBe(true)
    expect(safe.querySelector('.hnode-g')).toBeNull() // the eyebrow names the kind: no glyph
    expect(noComments(css)).toMatch(/\.hnode-k \{[^}]*text-transform: uppercase;/)
  })

  it('is a button named by the words it draws, as it draws them, then its kind and what it needs (0.6 nodeName + cardName; 2.5.3)', () => {
    render(<>
      <HouseNode data={state('default')} />
      <HouseNode data={{ item: MAP_TREASURY, facts: '4 of 8 · 7 chains', states: ['needs', 'staged'], need: 'Sign nonce 18 on the Treasury' }} big />
      <HouseNode data={state('failed read')} />
      <HouseNode data={state('linked, not read')} />
    </>)
    const names = ['Operations, hat 13.2 · 1 wears it, Hat', 'Treasury, Safe, 4 of 8 · 7 chains, staged, needs you: Sign nonce 18 on the Treasury',
      'Example DAO Garden, couldn’t read · 2 h, Gardens community', 'Karma GAP, impact reports, Link']
    // the drawn words, as axe's label-content-name-mismatch reads them: letters and digits, any punctuation a space
    const words = (s: string) => s.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase()
    for (const name of names) {
      const node = screen.getByRole('button', { name })
      expect(` ${words(name)} `).toContain(` ${words(node.textContent!)} `)
    }
  })

})

describe('the DAO map', () => {
  it('draws one node per item and one edge per link, its labels in plain words (§8.3, §8.4)', async () => {
    render(<HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" />)
    await drawn()
    expect(document.querySelectorAll('.react-flow__node .hnode')).toHaveLength(MAP_NODES.length)
    expect(document.querySelectorAll('.react-flow__edge')).toHaveLength(MAP_LINKS.length)
    expect(edgeEl(MAP_SIGNER.id, MAP_TREASURY.id)).not.toBeNull()
    expect(nodeEl(MAP_TREASURY.id)!.classList.contains('hnode-big')).toBe(true)
    // the linked group, in a dashed frame labelled for the members' side
    expect(document.querySelector('.hmap-linked .hmap-linked-k')!.textContent).toBe('Linked')
  })

  it('selected: moss outline and ring on it, its path’s edges moss, the others dim (§8.3)', async () => {
    render(<HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" selected={MAP_TREASURY.id} />)
    await drawn()
    expect(nodeEl(MAP_TREASURY.id)!.classList.contains('is-selected')).toBe(true)
    expect(nodeEl(MAP_TREASURY.id)!.getAttribute('aria-current')).toBe('true')
    // up through the signer, the Council and the vote; down to the pools
    expect(edgeEl(MAP_SIGNER.id, MAP_TREASURY.id)!.classList.contains('is-on')).toBe(true)
    expect(edgeEl(MAP_TREASURY.id, MAP_NETWORK.id)!.classList.contains('is-on')).toBe(true)
    const off = MAP_LINKS.find(k => k.label === 'holds')!
    expect(edgeEl(off.from, off.to)!.classList.contains('is-dim')).toBe(true)
    expect(nodeEl(off.to)!.classList.contains('is-dim')).toBe(true)
    expect(nodeEl(MAP_SIGNER.id)!.classList.contains('is-dim')).toBe(false)
  })

  it('on the door, a node with no page is no control: not a button, not a link, not in the tab order (B8 review M-4)', () => {
    const { container } = render(<HouseNode data={{ ...DOOR_NODES[0]!, href: undefined }} variant="door" tabIndex={0} />)
    const el = container.querySelector<HTMLElement>('.hnode')!
    expect(el.tagName).toBe('DIV')
    expect(el.hasAttribute('tabindex')).toBe(false)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(el.textContent).toContain(DOOR_NODES[0]!.item.name)
  })

  it('the door variant draws links, with no needs, staged or draft state even if given (C-32), under "Also on"', async () => {
    const withDraft = DOOR_NODES.map((d, i) => (i === 0 ? { ...d, states: [...d.states, 'draft' as const], order: 1 } : d))
    render(<HouseMap items={withDraft} links={MAP_LINKS} variant="door" />)
    await drawn()
    const links = document.querySelectorAll('.react-flow__node a.hnode')
    expect(links).toHaveLength(DOOR_NODES.length)
    expect(links[0]!.getAttribute('href')).toMatch(/^\/door\//)
    expect(document.querySelectorAll('.hnode.is-needs, .hnode.is-staged, .hnode.is-draft, .hnode-dot, .hnode-tag, .hnode-order')).toHaveLength(0)
    expect(screen.queryByRole('link', { name: /needs you|staged/ })).toBeNull()
    expect(document.querySelector('.hmap-linked-k')!.textContent).toBe('Also on')
  })

  it('restricted nodes take their edges with them: no node, no edge touching it, the count counts what is drawn (§6.3)', async () => {
    render(<ViewAsProvider initial={{ as: 'members' }}><HouseMap items={MAP_NODES_ROLES_RESTRICTED} links={MAP_LINKS} variant="members" /></ViewAsProvider>)
    await drawn()
    const hats = MAP_NODES.filter(d => d.item.kind === 'hat').map(d => d.item.id)
    expect(hats).toHaveLength(3)
    for (const id of hats) expect(nodeEl(id)).toBeNull()
    const ids = [...document.querySelectorAll('.react-flow__edge')].map(e => e.getAttribute('data-testid')!)
    expect(ids.length).toBe(MAP_LINKS.filter(k => !hats.includes(k.from) && !hats.includes(k.to)).length)
    for (const id of ids) for (const h of hats) expect(id).not.toContain(h)
    expect(screen.getByRole('group', { name: '6 Systems, as a map' })).toBeTruthy()
  })

  it('follows the visibility source: when it changes, a node it now restricts goes, with its edges (B8 review I-1)', async () => {
    const hats = MAP_NODES.filter(d => d.item.kind === 'hat').map(d => d.item.id)
    const treasurerOnly: VisibilitySource = { ...FIXTURE_SOURCE, visibilityOf: item =>
      ((item as { kind?: string }).kind === 'hat' ? { level: 'hat', hat: 'treasury', name: 'Treasurer' } : FIXTURE_SOURCE.visibilityOf(item)) }
    const at = (source: VisibilitySource) =>
      <ViewAsProvider source={source} initial={{ as: 'members' }}><HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" /></ViewAsProvider>
    const { rerender } = render(at(FIXTURE_SOURCE))
    await drawn()
    expect(nodeEl(hats[0]!)).not.toBeNull()
    rerender(at(treasurerOnly))
    await waitFor(() => { for (const id of hats) expect(nodeEl(id)).toBeNull() })
    const ids = [...document.querySelectorAll('.react-flow__edge')].map(e => e.getAttribute('data-testid')!)
    for (const id of ids) for (const h of hats) expect(id).not.toContain(h)
    expect(screen.getByRole('group', { name: '6 Systems, as a map' })).toBeTruthy()
  })

  it('drops a label shorter than its edge allows (§8.4)', () => {
    expect(labelFits(80, 60)).toBe(true)
    expect(labelFits(76, 60)).toBe(true)
    expect(labelFits(70, 60)).toBe(false)
  })

  it('a dropped label leaves the relation in both nodes’ descriptions', async () => {
    // two Systems side by side in one layer, an edge between them too short for its words
    const signer: MapNodeData = { item: MAP_SIGNER, facts: 'hat 13.1.1', states: [] }
    const treasury: MapNodeData = { item: { id: 'system:t', kind: 'wallet', name: 'Treasury' }, facts: '', states: [] }
    const links: MapLink[] = [{ from: MAP_SIGNER.id, to: 'system:t', label: 'signs 4 of 8' }]
    render(<HouseMap items={[signer, treasury]} links={links} variant="members" />)
    await drawn()
    expect(document.querySelector('.hlabel')).toBeNull()
    for (const id of [MAP_SIGNER.id, 'system:t']) {
      const desc = document.getElementById(nodeEl(id)!.getAttribute('aria-describedby')!)!
      expect(desc.textContent).toContain('signs 4 of 8 for Treasury')
    }
  })

  it('draws a label that fits on a pill centred on its edge', async () => {
    render(<HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" />)
    await drawn()
    await waitFor(() => expect([...document.querySelectorAll('.hlabel')].map(l => l.textContent)).toContain('signs 4 of 8'))
  })
})

describe('the map’s keys (§8.5)', () => {
  const setup = async (over: Partial<Parameters<typeof HouseMap>[0]> = {}) => {
    const onOpen = vi.fn(), onInspect = vi.fn(), onSelect = vi.fn()
    render(<HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" selected={MAP_TREASURY.id} onOpen={onOpen} onInspect={onInspect} onSelect={onSelect} {...over} />)
    await drawn()
    return { onOpen, onInspect, onSelect, group: screen.getByRole('group', { name: '9 Systems, as a map' }) }
  }

  it('the canvas is a group named "9 Systems, as a map"; Tab enters at the selected node', async () => {
    const { group } = await setup()
    const tabbable = [...group.querySelectorAll<HTMLElement>('.hnode')].filter(n => n.tabIndex === 0)
    expect(tabbable.map(n => n.dataset.nodeId)).toEqual([MAP_TREASURY.id])
    expect(group.tabIndex).toBe(-1)
  })

  it('arrows move along edges to the nearest node that way; Enter opens; Space inspects; Esc leaves to the canvas', async () => {
    const { onOpen, onInspect, group } = await setup()
    act(() => nodeEl(MAP_TREASURY.id)!.focus())
    expect(fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })).toBe(false) // handled: the house's keys stay quiet
    expect((document.activeElement as HTMLElement).dataset.nodeId).toBe(MAP_SIGNER.id)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect((document.activeElement as HTMLElement).dataset.nodeId).toBe(MAP_TREASURY.id)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect([MAP_NETWORK.id, MAP_STARTER.id]).toContain((document.activeElement as HTMLElement).dataset.nodeId)
    // focus is roving: the node with focus is the one Tab comes back to
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0)
    const at = (document.activeElement as HTMLElement).dataset.nodeId
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Enter' })).toBe(false)
    expect(onOpen).toHaveBeenCalledWith(at)
    expect(fireEvent.keyDown(document.activeElement!, { key: ' ' })).toBe(false)
    expect(onInspect).toHaveBeenCalledWith(at, expect.any(Object)) // with the node's need and Move, when it has them (C6 fix)
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Escape' })).toBe(false)
    expect(document.activeElement).toBe(group)
  })

  it('with the inspector open beside it, Escape on a node is the panel’s: it closes, and focus comes back to the node, not the canvas (§5.10; C11 keyboard walk)', async () => {
    function Inspecting() {
      const right = usePanel('right')
      return <>
        <HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" selected={MAP_TREASURY.id}
          onInspect={() => right.open('inspector', document.activeElement as HTMLElement)} />
        {right.openId && <aside aria-label="inspector">open</aside>}
      </>
    }
    render(<PanelProvider><Inspecting /></PanelProvider>)
    await drawn()
    act(() => nodeEl(MAP_TREASURY.id)!.focus())
    fireEvent.keyDown(document.activeElement!, { key: ' ' })
    expect(screen.getByRole('complementary', { name: 'inspector' })).toBeTruthy()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: 'inspector' })).toBeNull()
    expect((document.activeElement as HTMLElement).dataset.nodeId).toBe(MAP_TREASURY.id)
  })

  it('leaves v, [ and ? to the house', async () => {
    await setup()
    act(() => nodeEl(MAP_TREASURY.id)!.focus())
    for (const key of ['v', '[', '?']) expect(fireEvent.keyDown(document.activeElement!, { key })).toBe(true)
  })

  it('a click selects; a click on the dot inspects (§8.5)', async () => {
    const { onSelect, onInspect } = await setup()
    fireEvent.click(nodeEl(MAP_NETWORK.id)!)
    expect(onSelect).toHaveBeenCalledWith(MAP_NETWORK.id, expect.any(Object))
    fireEvent.click(nodeEl(MAP_TREASURY.id)!.querySelector('.hnode-dot')!)
    expect(onInspect).toHaveBeenCalledWith(MAP_TREASURY.id, { need: expect.stringMatching(/^Sign/) }) // opened at the need (E-46)
  })

  it('Fit is ⌘0 and the Fit button; zoom stays within 50–200 %', async () => {
    const { group } = await setup()
    fitView.mockClear()
    expect(fireEvent.keyDown(group, { key: '0', metaKey: true })).toBe(false)
    expect(fitView).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Fit to view' }))
    expect(fitView).toHaveBeenCalledTimes(2)
    expect(fitView.mock.calls.every(([o]) => o.minZoom === 0.5 && o.maxZoom <= 2)).toBe(true)
    const scale = () => Number(/scale\(([\d.]+)\)/.exec(document.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform)![1])
    for (let i = 0; i < 8; i++) expect(fireEvent.keyDown(group, { key: '=', metaKey: true })).toBe(false)
    await waitFor(() => expect(scale()).toBe(2))
    for (let i = 0; i < 12; i++) fireEvent.keyDown(group, { key: '-', ctrlKey: true })
    await waitFor(() => expect(scale()).toBe(0.5))
  })
})

describe('attention and value on the map (§8.5)', () => {
  it('the dot’s ring runs twice, and not under reduced motion', () => {
    const rules = noComments(css)
    const motion = rules.indexOf('@media (prefers-reduced-motion: no-preference)')
    expect(motion).toBeGreaterThanOrEqual(0)
    expect(rules.slice(motion, rules.indexOf('\n}', motion))).toMatch(/\.hnode-dot::after \{[^}]*animation-iteration-count: 2;/)
    expect(rules.slice(0, motion)).not.toMatch(/animation/)
    expect(rules).not.toMatch(/\binfinite\b/)
  })

  const flowEdges = () => MAP_FLOW.edges.map(([from, to]) => edgeEl(to, from)!) // the flow runs against the admin edges

  it('a flow adds the travelling class to its edges for three runs, then leaves them moss (the path)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    render(<HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" flow={MAP_FLOW} />)
    await act(async () => { await Promise.resolve() })
    expect(document.querySelectorAll('.react-flow__edge')).toHaveLength(MAP_LINKS.length)
    for (const e of flowEdges()) expect(e.classList.contains('is-travelling')).toBe(true)
    expect(document.querySelectorAll('.hedge-dash.is-against')).toHaveLength(2)
    act(() => { vi.advanceTimersByTime(FLOW_RUNS * FLOW_RUN_MS - 1) })
    expect(flowEdges()[0]!.classList.contains('is-travelling')).toBe(true)
    act(() => { vi.advanceTimersByTime(1) })
    for (const e of flowEdges()) {
      expect(e.classList.contains('is-travelling')).toBe(false)
      expect(e.classList.contains('is-path')).toBe(true)
    }
    expect(document.querySelectorAll('.hedge-dash')).toHaveLength(0)
  })

  /** The skin's --dur-flow, as the map reads it from its own box. */
  const durFlow = (value: string) => {
    const real = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const cs = real(el, pseudo)
      return new Proxy(cs, { get: (t, k) => (k === 'getPropertyValue' ? (n: string) => (n === '--dur-flow' ? value : t.getPropertyValue(n))
        : Reflect.get(t, k)) })
    })
  }

  it('runs as long as the skin says: three runs of its --dur-flow (B8 review M-1)', async () => {
    durFlow('500ms')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    render(<HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" flow={MAP_FLOW} />)
    await act(async () => { await Promise.resolve() })
    expect(flowEdges()[0]!.classList.contains('is-travelling')).toBe(true)
    act(() => { vi.advanceTimersByTime(3 * 500) })
    expect(flowEdges()[0]!.classList.contains('is-path')).toBe(true)
  })

  it('a skin with no flow motion (bare: --dur-flow 0s) draws no dash: the path at once (B8 review M-1)', async () => {
    durFlow('0s')
    render(<HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" flow={MAP_FLOW} />)
    await drawn()
    for (const e of flowEdges()) {
      expect(e.classList.contains('is-travelling')).toBe(false)
      expect(e.classList.contains('is-path')).toBe(true)
    }
    expect(document.querySelectorAll('.hedge-dash')).toHaveLength(0)
  })

  it('under reduced motion: no travelling class, the path at once', async () => {
    reduce = true
    render(<HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" flow={MAP_FLOW} />)
    await drawn()
    for (const e of flowEdges()) {
      expect(e.classList.contains('is-travelling')).toBe(false)
      expect(e.classList.contains('is-path')).toBe(true)
    }
    expect(document.querySelectorAll('.hedge-dash')).toHaveLength(0)
  })

  it('the sentence is announced once', async () => {
    const said: string[] = []
    const hear = (e: Event) => said.push(String((e as CustomEvent).detail))
    window.addEventListener('org-os-announce', hear)
    const { rerender } = render(<HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" flow={MAP_FLOW} />)
    await drawn()
    rerender(<HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" flow={MAP_FLOW} selected={MAP_TREASURY.id} />)
    rerender(<HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" flow={{ ...MAP_FLOW }} />)
    window.removeEventListener('org-os-announce', hear)
    expect(said).toEqual(['Transaction 18 prepared. It moves 3,100 USDGLO from the two pools to the Treasury.'])
  })
})

describe('the caption (§8.5)', () => {
  it('kind tile, name, Mono facts and one sentence about the selected node; not a live region, the node says it on focus (C11 I-2)', async () => {
    render(<HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" selected={MAP_TREASURY.id} caption />)
    await drawn()
    const cap = document.querySelector<HTMLElement>('.hcap')!
    expect(cap.hasAttribute('aria-live')).toBe(false)
    expect(cap.querySelector('.ktile')).not.toBeNull()
    expect(within(cap).getByText('Treasury').tagName).toBe('B')
    expect(cap.querySelector('.hcap-f')!.textContent).toBe('Safe · 4 of 8 · 7 chains')
    const sentence = cap.querySelector('p')!.textContent!
    expect(sentence).toMatch(/^Needs you: .+\.$/)
    expect(sentence.split('. ').length).toBeLessThanOrEqual(2)
  })

  it('without a selection, says how to get one', async () => {
    render(<HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" caption />)
    await drawn()
    expect(document.querySelector('.hcap')!.textContent).toBe('Select a node to read about it here.')
  })
})

describe('map.css (§8.3, §8.4)', () => {
  const rule = (sel: string) => {
    const m = new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(noComments(css))
    expect(m, `${sel} has no rule`).not.toBeNull()
    return m![2]!
  }
  it('the canvas is --sunken with the --map-dot grid, its own map container', () => {
    expect(rule('.hmap')).toContain('container: map / inline-size;')
    expect(rule('.hmap-canvas')).toContain('background-color: var(--sunken);')
    expect(rule('.hmap-canvas')).toContain('radial-gradient(var(--map-dot)')
  })
  it('a node: raised, 1px --rule-strong, radius 10, the raise shadow, its laid-out height', () => {
    const n = rule('.hnode')
    for (const d of ['background: var(--raised);', 'border: var(--rule-w) solid var(--rule-strong);', 'border-radius: var(--radius);', 'box-shadow: var(--shadow-raise);', 'block-size: var(--h-node);'])
      expect(n).toContain(d)
    expect(rule('.hnode.hnode-big')).toContain('block-size: var(--h-node-big);')
    // one line each: a long name or facts line is cut, never wrapped past the height the layout gave it
    expect(rule('.hnode-n')).toContain('white-space: nowrap;')
    expect(rule('.hnode-f')).toContain('white-space: nowrap;')
  })
  it('edges: 1.25 --edge; moss 1.75 on the path; dim off it; clay dashed when invalid', () => {
    expect(rule('.hedge')).toContain('stroke: var(--edge);')
    expect(rule('.hedge')).toContain('stroke-width: var(--stroke-edge);')
    expect(rule('.hedge.is-on, .hedge.is-path')).toContain('stroke-width: var(--stroke-edge-on);')
    expect(rule('.hedge.is-dim')).toContain('opacity: var(--o-edge-dim);')
    // a node off the path keeps its words at 4.5:1: --faint, the glyphs and tags dimmed, never opacity over the words
    // (1.4.3; C11, axe color-contrast)
    expect(rule('.hnode.is-dim :is(.hnode-n, .hnode-f, .hnode-k, .hnode-more)')).toContain('color: var(--faint);')
    expect(css).not.toMatch(/\.hnode\.is-dim \{[^}]*opacity/)
    expect(rule('.hedge.is-bad')).toContain('stroke-dasharray: var(--dash-bad);')
    expect(rule('.hedge-dash')).toContain('stroke-dasharray: var(--dash-flow);')
    // the dash's run moves it two periods of the skin's own dash, whatever the skin sets (B8 review M-1)
    expect(noComments(css)).toMatch(/@keyframes hflow \{ from \{ stroke-dashoffset: 0; \} to \{ stroke-dashoffset: calc\(-2 \* \(var\(--dash-flow-dot\) \+ var\(--dash-flow-gap\)\)\); \} \}/)
  })
  it('hover only for a pointer that hovers', () => {
    expect(noComments(css).replace(/@media \(hover: hover\) \{[^\n]*\}\s*\}/g, '')).not.toMatch(/:hover/)
  })
})
