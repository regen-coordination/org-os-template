import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import {
  Handle, Position, ReactFlow, ReactFlowProvider, ViewportPortal, useReactFlow,
  type Edge, type FitViewOptions, type Node, type NodeChange, type NodeProps,
} from '@xyflow/react'
import { Button } from '../design/Button.tsx'
import { NoteBlock } from '../design/Note.tsx'
import { announce } from '../parts/live.tsx'
import { useSlotOpen } from '../parts/panels.tsx'
import { useCanWrite, useViewer, useVisibilitySource } from '../viewAs/ViewAs.tsx'
import { HouseEdge, edgeGeometry, edgeId, labelAlong, labelFits, labelSize, relationSentence, selectedPath, type Box, type HouseEdgeData } from './HouseEdge.tsx'
import { HouseNode, statesFor, type MapNodeData, type NodeState } from './HouseNode.tsx'
import { LAYOUT, layoutMap, type MapLayout, type MapLink, type Placed } from './layers.ts'
import { MapCaption } from './MapCaption.tsx'
import { ZOOM, clampZoom, mapKeyOf, nearestInDirection } from './mapKeys.ts'
import { FLOW_RUNS, FLOW_RUN_MS, flowDirection, type ValueFlow } from './valueFlow.ts'

export type { MapNodeData, NodeState } from './HouseNode.tsx'
export type { ValueFlow } from './valueFlow.ts'

export interface HouseMapProps {
  items: MapNodeData[]
  links: MapLink[]
  /** The members' map, or the door's: read-only, its nodes links, nothing that needs or was staged by a member. */
  variant: 'members' | 'door'
  selected?: string | null
  /** A click on a node. `act.move` starts its move mode, when this viewer may move it (for the inspector's Move). */
  onSelect?(id: string, act?: NodeActs): void
  /** Enter on a node: its record. */
  onOpen?(id: string): void
  /** Space on a node, or a click on its dot: the inspector, at the need (the node's `need`, when it is lit). */
  onInspect?(id: string, act?: NodeActs): void
  /** A transaction's value moving (§8.5). */
  flow?: ValueFlow | null
  /** The caption under the map, about the selected node. */
  caption?: boolean
  /** Where each node sits, top-left, for a map that keeps its own layout (the Organization map, a collection's map:
   *  §14.2 "Organization keeps its graph layout"). Without it the map is laid out by authority (§8.2). */
  positions?: Record<string, { x: number; y: number }>
  /** A node dragged to a new place (only with `positions`): the map draws it there, and this keeps it. */
  onMove?(id: string, at: { x: number; y: number }): void
  /** Auto-layout (only with `positions`): forgets the places kept, back to the graph's own. */
  onReset?(): void
  /** The canvas's name, for a map that is not of Systems ("Organization map, 12 records"). */
  label?: string
}

/** What the map hands its caller with a node: the need the node is lit for, and its move mode (C6 fix I-1). */
export interface NodeActs { need?: string; move?: () => void }

/** One step of a node's move mode, and a large one with Shift (C6 fix I-1, WCAG 2.1.1, 2.5.7): the layout's column gap. */
export const MOVE_STEP = LAYOUT.colGap
export const MOVE_STEP_LARGE = LAYOUT.colGap * 4

/** Room around the layout on the canvas: above for the tools, at the sides and below for the linked group's frame.
 *  Wide, then narrow (under 680px of map). Geometry, in code like the layout's (L4-R2). */
const PAD = { wide: { top: 64, side: 24, bottom: 32 }, narrow: { top: 56, side: 8, bottom: 24 } } as const
/** The linked group's dashed frame: its padding round the nodes (less on a narrow map, whose grid fills its width),
 *  and the line its eyebrow takes above them. */
const FRAME = { pad: 12, padNarrow: 6, head: 20 } as const
/** An arrow on the canvas pans it this far. */
const PAN = 40

const heightOf = (p: Placed) => (p.big ? LAYOUT.bigH : LAYOUT.nodeH)

/** A layout kept by the caller: each node where `positions` puts it (at 0, 0 when it names none), every node one
 *  width, none big, no linked group. */
function keptLayout(ids: string[], positions: Record<string, { x: number; y: number }>): MapLayout {
  const nodes: Placed[] = ids.map(id => ({ id, layer: 3, x: positions[id]?.x ?? 0, y: positions[id]?.y ?? 0, w: LAYOUT.nodeMax, big: false }))
  if (!nodes.length) return { nodes, width: 0, height: 0, mainSafe: null, narrow: false }
  const minX = Math.min(0, ...nodes.map(n => n.x))
  const minY = Math.min(0, ...nodes.map(n => n.y))
  const shifted = nodes.map(n => ({ ...n, x: n.x - minX, y: n.y - minY }))
  return { nodes: shifted, width: Math.max(...shifted.map(n => n.x + n.w)), height: Math.max(...shifted.map(n => n.y + LAYOUT.nodeH)), mainSafe: null, narrow: false }
}
const boxOf = (p: Placed): Box => ({ x: p.x, y: p.y, w: p.w, h: heightOf(p) })

/** The canvas's width, as it is drawn. */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e?.contentRect.width ?? 0)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** One run of the dash as the skin draws it: its `--dur-flow` read from the map's box (house 1100ms; bare 0s, no
 *  motion), else FLOW_RUN_MS when the box cannot say. */
function flowRunMs(el: HTMLElement | null): number {
  const v = el ? getComputedStyle(el).getPropertyValue('--dur-flow').trim() : ''
  const m = /^(-?[\d.]+)(ms|s)$/.exec(v)
  if (!m) return FLOW_RUN_MS
  const n = Number(m[1]) * (m[2] === 's' ? 1000 : 1)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** A flow's phase: travelling for three runs of the skin's dash, then the path; the path at once under reduced motion
 *  or in a skin with no flow motion (B8 review M-1). Decided before paint, so no still dash is ever drawn. */
function useFlowRun(flow: ValueFlow | null | undefined, box: RefObject<HTMLElement | null>): 'travelling' | 'path' | null {
  const id = flow?.id ?? null
  const [run, setRun] = useState<{ id: string; phase: 'travelling' | 'path' } | null>(null)
  useLayoutEffect(() => {
    if (id === null) { setRun(null); return }
    const ms = reducedMotion() ? 0 : flowRunMs(box.current)
    if (ms === 0) { setRun({ id, phase: 'path' }); return }
    setRun(r => (r?.id === id ? r : { id, phase: 'travelling' }))
    const t = setTimeout(() => setRun({ id, phase: 'path' }), FLOW_RUNS * ms)
    return () => clearTimeout(t)
  }, [id, box])
  return run !== null && run.id === id ? run.phase : null
}

interface NodeData extends Record<string, unknown> {
  node: MapNodeData; big: boolean; variant: 'members' | 'door'; tabIndex: number; describedBy?: string; onFocus(id: string): void
}

function FlowNode({ data }: NodeProps<Node<NodeData>>) {
  // React Flow draws an edge only between handles; the house's edges are drawn from the layout, so these stay unseen.
  return <>
    <Handle type="target" position={Position.Top} isConnectable={false} />
    <HouseNode data={data.node} big={data.big} variant={data.variant} tabIndex={data.tabIndex} describedBy={data.describedBy}
      onFocus={() => data.onFocus(data.node.item.id)} />
    <Handle type="source" position={Position.Bottom} isConnectable={false} />
  </>
}
const nodeTypes = { house: FlowNode }
const edgeTypes = { house: HouseEdge }

/** The DAO map (spec §8): the layered layout (layers.ts) drawn on React Flow, each node in its states, each edge
 *  labelled when it fits, attention from Needs you, value moving along a prepared transaction's edges. What the viewer
 *  may not see is not drawn, nor any edge that touches it, and the layout closes up (§6.3). The canvas is a group
 *  named by what it draws; Tab enters at the selected node, arrows move along edges, Enter opens, Space inspects,
 *  Esc leaves to the canvas; ⌘0 fits, ⌘+ and ⌘− zoom within 50–200 %. */
export function HouseMap(p: HouseMapProps) {
  return <ReactFlowProvider><MapView {...p} /></ReactFlowProvider>
}

function MapView(p: HouseMapProps) {
  const { viewer, sees } = useViewer()
  const source = useVisibilitySource()
  const rf = useReactFlow()
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const width = useWidth(box)
  const [rtl, setRtl] = useState(false)
  useLayoutEffect(() => { if (box.current) setRtl(getComputedStyle(box.current).direction === 'rtl') }, [])
  const uid = useId()
  const members = p.variant === 'members'

  // What the viewer may see, and only the edges between two of those.
  // `sees` reads the viewer and the visibility source: either changing redraws what is absent (B8 review I-1)
  const shown = useMemo(() => p.items.filter(d => sees(d.item)), [p.items, viewer, source])
  const byId = useMemo(() => new Map(shown.map(d => [d.item.id, d])), [shown])
  const links = useMemo(() => p.links.filter(k => k.from !== k.to && byId.has(k.from) && byId.has(k.to)), [p.links, byId])

  const narrow = width < LAYOUT.narrowAt
  const pad = narrow ? PAD.narrow : PAD.wide
  const kept = p.positions
  // A node being dragged, where the pointer has it: drawn there until the caller keeps it (onMove).
  const [dragging, setDragging] = useState<Record<string, { x: number; y: number }>>({})
  useEffect(() => { setDragging({}) }, [kept])
  const layout = useMemo(() => (kept
    ? keptLayout(shown.map(d => d.item.id), kept)
    : layoutMap(shown.map(d => d.item), links, { width: Math.max(0, width - 2 * pad.side) })), [shown, links, width, pad.side, kept])
  // Laid out left to right; mirrored on a right-to-left page.
  const placed = useMemo(() => {
    const ns = rtl ? layout.nodes.map(n => ({ ...n, x: layout.width - n.x - n.w })) : layout.nodes
    return Object.keys(dragging).length ? ns.map(n => (dragging[n.id] ? { ...n, ...dragging[n.id]! } : n)) : ns
  }, [layout, rtl, dragging])
  const at = useMemo(() => new Map(placed.map(n => [n.id, n])), [placed])
  const counted = placed.filter(n => n.layer !== 'linked').length
  const label = p.label ?? `${counted} ${counted === 1 ? 'System' : 'Systems'}, as a map`
  // a node is moved only on a map that keeps its layout, by a viewer who may write it (never while previewing, C-23)
  const canWrite = useCanWrite()
  const movable = kept !== undefined && p.onMove !== undefined && members && canWrite
  // Move mode (C6 fix I-1): a node picked up by `m` or the inspector's Move, carried by the arrows or the nudge
  // buttons a step at a time, put down with Enter or Done (kept through onMove), put back with Escape or Cancel.
  const [moving, setMoving] = useState<{ id: string; from: { x: number; y: number }; at: { x: number; y: number } } | null>(null)
  useEffect(() => { if (!movable) setMoving(null) }, [movable])
  const onNodesChange = (changes: NodeChange[]) => {
    if (!movable) return
    for (const c of changes) {
      if (c.type !== 'position' || !c.position) continue
      const pos = c.position
      setDragging(d => ({ ...d, [c.id]: pos }))
      if (c.dragging === false) {
        const n = layout.nodes.find(x => x.id === c.id)
        // kept left to right: a move on a mirrored page is mirrored back before it is kept
        p.onMove!(c.id, { x: rtl && n ? layout.width - pos.x - n.w : pos.x, y: pos.y })
      }
    }
  }

  const selected = p.selected && byId.has(p.selected) ? p.selected : null
  const path = useMemo(() => (selected ? selectedPath(selected, links) : null), [selected, links])
  const phase = useFlowRun(p.flow, box)
  const said = useRef(new Set<string>())
  useEffect(() => {
    if (!p.flow || said.current.has(p.flow.id)) return
    said.current.add(p.flow.id)
    announce(p.flow.sentence)
  }, [p.flow])

  // Each node's relations, said in its description.
  const relations = useMemo(() => {
    const out = new Map<string, string[]>()
    for (const k of links) {
      const s = relationSentence(byId.get(k.from)!.item.name, k.label, byId.get(k.to)!.item.name)
      for (const id of [k.from, k.to]) out.set(id, [...(out.get(id) ?? []), s])
    }
    return out
  }, [links, byId])
  const descId = (i: number) => `${uid}-d${i}`

  // Roving focus: the node Tab lands on is the one focus last stood on, else the selected one, else the main Safe.
  const [focused, setFocused] = useState<string | null>(null)
  // On the door only a node with a page is a link to land on.
  const reachable = members ? placed : placed.filter(n => byId.get(n.id)?.href)
  const can = (id: string | null | undefined) => (id && reachable.some(n => n.id === id) ? id : null)
  const stop = can(focused) ?? can(selected) ?? can(layout.mainSafe) ?? reachable[0]?.id ?? null

  const states = (d: MapNodeData): NodeState[] => {
    const own = statesFor(d, p.variant).filter(s => s !== 'selected' && s !== 'dim')
    const id = d.item.id
    return [...own, ...(id === selected || d.states.includes('selected') ? ['selected' as const] : []),
      ...((path && !path.nodes.has(id)) || d.states.includes('dim') ? ['dim' as const] : [])]
  }

  const nodes: Node<NodeData>[] = shown.flatMap((d, i) => {
    const n = at.get(d.item.id)
    if (!n) return []
    return [{
      id: n.id, type: 'house', position: { x: n.x, y: n.y }, width: n.w, height: heightOf(n), draggable: movable, selectable: false, focusable: false,
      data: {
        node: { ...d, states: states(d) }, big: n.big, variant: p.variant, tabIndex: n.id === stop ? 0 : -1,
        describedBy: relations.has(n.id) ? descId(i) : undefined, onFocus: setFocused,
      },
    }]
  })

  const edges: Edge<HouseEdgeData>[] = links.map(k => {
    const g = edgeGeometry(boxOf(at.get(k.from)!), boxOf(at.get(k.to)!))
    const dir = flowDirection(p.flow, k.from, k.to)
    const on = path?.edges.has(edgeId(k)) ?? false
    const fits = labelFits(g.length, labelAlong(g, labelSize(k.label)))
    return {
      id: edgeId(k), source: k.from, target: k.to, type: 'house', focusable: false, selectable: false,
      data: { d: g.d, label: fits ? k.label : null, labelX: g.x, labelY: g.y, on, dim: path !== null && !on && dir === null, flow: dir && phase ? { dir, phase } : null },
    }
  })

  // The linked group's dashed frame, round its nodes.
  const linked = placed.filter(n => n.layer === 'linked')
  const fp = narrow ? FRAME.padNarrow : FRAME.pad
  const frame = linked.length === 0 ? null : (() => {
    const x = Math.min(...linked.map(n => n.x)) - fp, y = Math.min(...linked.map(n => n.y)) - fp - FRAME.head
    return { x, y, w: Math.max(...linked.map(n => n.x + n.w)) + fp - x, h: Math.max(...linked.map(n => n.y + heightOf(n))) + fp - y }
  })()
  const height = layout.height + pad.top + pad.bottom + (frame ? fp : 0)

  const fitOptions: FitViewOptions = useMemo(() => ({
    padding: { top: `${pad.top}px`, bottom: `${pad.bottom + (frame ? fp : 0)}px`, left: `${pad.side}px`, right: `${pad.side}px` },
    minZoom: ZOOM.min, maxZoom: 1,
  }), [pad, fp, frame !== null])
  const fit = () => { void rf.fitView(fitOptions) }
  // Fit on first paint and whenever what is drawn, or the width it is drawn at, changes; a kept layout only when its
  // nodes change, so a node dragged or dropped never moves the view (0.6 C15).
  const drawnKey = kept
    ? `${width}|${layout.nodes.map(n => n.id).sort().join(';')}`
    : `${width}|${placed.map(n => `${n.id}@${n.x},${n.y}`).join(';')}`
  useEffect(() => { if (nodes.length) fit() }, [drawnKey])

  const focusNode = (id: string) => {
    setFocused(id)
    const el = [...(box.current?.querySelectorAll<HTMLElement>('[data-node-id]') ?? [])].find(e => e.dataset.nodeId === id)
    el?.focus({ preventScroll: true })
  }

  const nameOf = (id: string) => byId.get(id)?.item.name ?? id
  const where = (x: number, y: number) => `${Math.round(x)} across, ${Math.round(y)} down`
  const startMove = (id: string) => {
    const n = at.get(id)
    if (!movable || !n) return
    const from = { x: n.x, y: n.y }
    setMoving({ id, from, at: from })
    setDragging(d => ({ ...d, [id]: from }))
    announce(`Moving ${nameOf(id)}. The arrows move it, Enter puts it there, Escape puts it back.`)
    setTimeout(() => focusNode(id), 0)
  }
  const nudge = (dx: number, dy: number) => {
    if (!moving) return
    const next = { x: moving.at.x + dx, y: Math.max(0, moving.at.y + dy) }
    setMoving({ ...moving, at: next })
    setDragging(d => ({ ...d, [moving.id]: next }))
    announce(`${nameOf(moving.id)}: ${where(next.x, next.y)}.`)
  }
  const endMove = (keep: boolean) => {
    if (!moving) return
    const { id, from, at: to } = moving
    setMoving(null)
    if (keep) {
      const n = layout.nodes.find(x => x.id === id)
      // kept left to right: a move on a mirrored page is mirrored back before it is kept
      p.onMove?.(id, { x: rtl && n ? layout.width - to.x - n.w : to.x, y: to.y })
      announce(`${nameOf(id)} moved to ${where(to.x, to.y)}. Its place is kept.`)
    } else {
      setDragging(d => { const { [id]: _gone, ...rest } = d; return rest })
      announce(`Move cancelled. ${nameOf(id)} is back at ${where(from.x, from.y)}.`)
    }
    setTimeout(() => focusNode(id), 0)
  }
  /** What a node hands its caller: the need it is lit for, and Move when this viewer may move it. */
  const actsOf = (id: string): NodeActs => {
    const d = byId.get(id)
    const lit = d && members && d.need && statesFor(d, p.variant).includes('needs') ? d.need : undefined
    return { ...(lit ? { need: lit } : {}), ...(movable ? { move: () => startMove(id) } : {}) }
  }

  const panelOpen = useSlotOpen('right') !== null
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // in the nudge toolbar the buttons keep their own keys (Enter and Space press them); Escape still cancels
    const inBar = (e.target as Element).closest?.('.hmap-move') != null
    if (moving && inBar && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endMove(false); return }
    if (inBar) return
    if (moving) {
      const step = e.shiftKey ? MOVE_STEP_LARGE : MOVE_STEP
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      if (e.key in d) { e.preventDefault(); e.stopPropagation(); nudge(...d[e.key]!); return }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); endMove(true); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endMove(false); return }
    }
    const on = (e.target as Element).closest?.<HTMLElement>('[data-node-id]')
    if (on && movable && e.key === 'm' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      startMove(on.dataset.nodeId!)
      return
    }
    const k = mapKeyOf(e)
    if (k === null) return
    if ('act' in k && (k.act === 'fit' || k.act === 'zoom-in' || k.act === 'zoom-out')) {
      e.preventDefault()
      if (k.act === 'fit') fit()
      else void rf.zoomTo(clampZoom(rf.getZoom() * (k.act === 'zoom-in' ? ZOOM.step : 1 / ZOOM.step)))
      return
    }
    const node = (e.target as Element).closest?.<HTMLElement>('[data-node-id]')
    if (node) {
      const id = node.dataset.nodeId!
      if ('move' in k) {
        e.preventDefault()
        const next = nearestInDirection(id, k.move, reachable, links)
        if (next) focusNode(next)
      } else if (k.act === 'leave') {
        // with the inspector (or a panel) open beside the map, Escape is the panel's: it closes and focus comes back to
        // this node (§5.10's Escape stack; C11 keyboard walk)
        if (panelOpen) return
        e.preventDefault()
        canvas.current?.focus({ preventScroll: true })
      } else if (members && k.act === 'open') {
        e.preventDefault()
        p.onOpen?.(id)
      } else if (members && k.act === 'inspect') {
        e.preventDefault()
        p.onInspect?.(id, actsOf(id))
      }
      return
    }
    if (e.target === canvas.current && 'move' in k) {
      e.preventDefault()
      const v = rf.getViewport()
      const [dx, dy] = k.move === 'left' ? [PAN, 0] : k.move === 'right' ? [-PAN, 0] : k.move === 'up' ? [0, PAN] : [0, -PAN]
      void rf.setViewport({ x: v.x + dx, y: v.y + dy, zoom: v.zoom })
    }
  }

  const caption = (() => {
    const d = selected ? byId.get(selected)! : null
    if (!d) return { node: null, sentence: '' }
    const rel = relations.get(d.item.id) ?? []
    const sentence = members && d.need && statesFor(d, p.variant).includes('needs') ? `Needs you: ${d.need}.`
      : rel.length ? `${rel.join('; ')}.` : `${d.item.name} has no relation on the map.`
    return { node: d, sentence }
  })()

  return (
    <div className={`hmap hmap-${p.variant}`} ref={box}>
      <div className="hmap-canvas" ref={canvas} role="group" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}
        style={{ height: shown.length ? height : undefined }}>
        {shown.length === 0
          ? <NoteBlock title="Nothing on the map yet." line="Systems appear here once they are added." />
          : width > 0 && (
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
              nodesDraggable={movable} onNodesChange={onNodesChange} nodesConnectable={false} nodesFocusable={false} edgesFocusable={false} elementsSelectable={false}
              deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null} panActivationKeyCode={null} zoomActivationKeyCode={null}
              disableKeyboardA11y minZoom={ZOOM.min} maxZoom={ZOOM.max} zoomOnScroll={false} zoomOnDoubleClick={false} panOnScroll={false}
              preventScrolling={false} proOptions={{ hideAttribution: true }}
              onNodeClick={(e, n) => {
                if (!members) return
                if ((e.target as Element).closest('.hnode-dot')) p.onInspect?.(n.id, actsOf(n.id))
                else p.onSelect?.(n.id, actsOf(n.id))
              }}>
              {frame && (
                <ViewportPortal>
                  <div className="hmap-linked" aria-hidden="true"
                    style={{ transform: `translate(${frame.x}px, ${frame.y}px)`, width: frame.w, height: frame.h }}>
                    <span className="hmap-linked-k">{members ? 'Linked' : 'Also on'}</span>
                  </div>
                </ViewportPortal>
              )}
            </ReactFlow>
          )}
        <div className="hmap-tools">
          <Button icon="fit" iconOnly label="Fit to view" onClick={fit} />
          {movable && p.onReset && !moving && <Button small onClick={p.onReset}>Auto-layout</Button>}
        </div>
        {moving && (
          // the single-pointer way to move a node (WCAG 2.5.7): a step at a time, then Done or Cancel
          <div className="hmap-move" role="toolbar" aria-label={`Move ${nameOf(moving.id)}`}>
            <Button small label="Move left" onClick={() => nudge(-MOVE_STEP, 0)}>←</Button>
            <Button small label="Move up" onClick={() => nudge(0, -MOVE_STEP)}>↑</Button>
            <Button small label="Move down" onClick={() => nudge(0, MOVE_STEP)}>↓</Button>
            <Button small label="Move right" onClick={() => nudge(MOVE_STEP, 0)}>→</Button>
            <Button small primary onClick={() => endMove(true)}>Done</Button>
            <Button small variant="ghost" onClick={() => endMove(false)}>Cancel</Button>
          </div>
        )}
      </div>
      <div hidden>{shown.map((d, i) => (relations.has(d.item.id) ? <span key={d.item.id} id={descId(i)}>{relations.get(d.item.id)!.join('. ')}.</span> : null))}</div>
      {p.caption && <MapCaption node={caption.node} sentence={caption.sentence} />}
    </div>
  )
}
