import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { Button } from '../../design/Button.tsx'
import { FieldRow, FieldTable } from '../../design/FieldRow.tsx'
import { Icon, kindIcon } from '../../design/Icon.tsx'
import { KindTile } from '../../design/KindTile.tsx'
import { StatusMark } from '../../design/StatusMark.tsx'
import { edgeGeometry, relationSentence, type Box } from '../../map/HouseEdge.tsx'
import { HouseNode, type MapNodeData } from '../../map/HouseNode.tsx'
import { nearestInDirection, type Dir } from '../../map/mapKeys.ts'
import { announce } from '../../parts/live.tsx'
import { useCanWrite } from '../../viewAs/ViewAs.tsx'
import { chainName } from '../atoms/chain.ts'
import { kindWord } from '../records/RecordHeader.tsx'
import type { StageOp } from '../../api.ts'
import {
  COMPOSE, canConnect, moveBy, nextOrder, opsForConnect, opsForDelete, opsForMove, opsForPlace, opsForRename, preparedCount, relationOf,
  type ComposeEdge, type ComposeNode,
} from './compose.ts'

const DIRS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
const SIDES = ['n', 'e', 's', 'w'] as const
const KIND_DRAG = 'application/x-org-os-kind'
/** Room past the furthest node, so the plane always has somewhere to put the next one. */
const ROOM = 48

const boxOf = (n: ComposeNode): Box => ({ x: n.x - COMPOSE.nodeW / 2, y: n.y - COMPOSE.nodeH / 2, w: COMPOSE.nodeW, h: COMPOSE.nodeH })
const edgeKey = (e: Pick<ComposeEdge, 'from' | 'to'>) => `${e.from}>${e.to}`

/** A fresh id for a node of this kind: `<kind>-<n>`, the first n not taken. */
function freshId(kind: string, nodes: ComposeNode[]): string {
  const taken = new Set(nodes.map(n => n.id))
  let k = 1
  while (taken.has(`${kind}-${k}`)) k++
  return `${kind}-${k}`
}

/** The compose canvas (§8.7): the map, editable. Three columns — the Place shelf (the kinds the library offers), the
 *  canvas, and the selected node's inspector — over a foot that says what is staged and how many transactions
 *  deploying it prepares. Under 820px of its own width the shelf wraps above, the inspector goes below, and the
 *  refused connection's note leaves the edge for the canvas's foot (L4b B9 M-6, as the gallery draws it).
 *
 *  Nodes are composed, not deployed (dashed moss) with their deployment order badge; the selected one shows four
 *  connection handles. Placing: drag from the shelf, or a shelf item and Enter (at the canvas centre). Moving: drag,
 *  or arrows 8px, Shift+arrows 40px. Connecting: drag from a handle to a node, or `c` on the selected node, then
 *  arrows to pick the target and Enter (Esc stops). Delete removes. Every action stages ops through `onStage`;
 *  nothing writes (L7 wires it). A connection that cannot be draws a clay dashed edge and a note that says why and
 *  what fits, announced once (`role="alert"`), only the latest one; it is never staged. Previewing as someone else,
 *  the canvas is drawn without its write controls. Positions are the canvas's own (px); the drawn plane grows to hold
 *  every node. */
export function ComposeCanvas(p: {
  shelf: string[]; nodes: ComposeNode[]; edges: ComposeEdge[]; chain: string; onStage(ops: StageOp[]): void
  /** The node selected at first (a /parts specimen's); the Review order and Propose actions, L7's to wire. */
  selected?: string; onReview?(): void; onPropose?(): void
}) {
  const canWrite = useCanWrite()
  const [nodes, setNodes] = useState(p.nodes)
  const [edges, setEdges] = useState(p.edges)
  const [selected, setSelected] = useState<string | null>(p.selected ?? null)
  const [connecting, setConnecting] = useState<{ from: string; target: string | null } | null>(null)
  const [note, setNote] = useState<string | null>(() => { const bad = p.edges.filter(e => e.invalid).at(-1); return bad ? edgeKey(bad) : null })
  const [focusId, setFocusId] = useState<string | null>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const plane = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null)
  const nameId = useId()

  useEffect(() => {
    if (focusId === null) return
    ;[...(canvas.current?.querySelectorAll<HTMLElement>('[data-node-id]') ?? [])].find(el => el.dataset.nodeId === focusId)?.focus()
    setFocusId(null)
  }, [focusId])

  const byId = new Map(nodes.map(n => [n.id, n]))
  const nameOf = (id: string) => byId.get(id)?.name ?? id
  const stage = (ops: StageOp[]) => p.onStage(ops)

  const place = (kind: string, at?: { x: number; y: number }) => {
    const c = canvas.current
    const centre = c && c.clientWidth > 0
      ? { x: c.scrollLeft + c.clientWidth / 2, y: c.scrollTop + c.clientHeight / 2 }
      : { x: COMPOSE.canvasW / 2, y: COMPOSE.canvasH / 2 }
    const pos = at ?? centre
    const n: ComposeNode = { id: freshId(kind, nodes), kind, name: `New ${kindWord(kind)}`, x: Math.round(pos.x), y: Math.round(pos.y), order: kind === 'link' ? 0 : nextOrder(nodes) }
    setNodes(ns => [...ns, n])
    setSelected(n.id)
    setFocusId(n.id)
    stage(opsForPlace(n))
    announce(`${n.name} placed. Arrows move it.`)
  }

  const moveTo = (next: ComposeNode) => setNodes(ns => ns.map(n => (n.id === next.id ? next : n)))

  const connect = (from: string, to: string) => {
    setConnecting(null)
    if (from === to || edges.some(e => e.from === from && e.to === to && !e.invalid)) return
    const a = byId.get(from), b = byId.get(to)
    if (!a || !b) return
    const ok = canConnect(a.kind, b.kind)
    const rest = edges.filter(e => !(e.from === from && e.to === to))
    if (ok === true) {
      const label = relationOf(a.kind, b.kind)!
      const next = [...rest, { from, to, label }]
      setEdges(next)
      if (note === edgeKey({ from, to })) setNote(null)
      stage(opsForConnect(from, next))
      announce(`${relationSentence(a.name, label, b.name)}. Staged.`)
    } else {
      setEdges([...rest, { from, to, label: '', invalid: ok }])
      setNote(edgeKey({ from, to }))
    }
  }

  const remove = (id: string) => {
    const ops = opsForDelete(id, edges)
    setNodes(ns => ns.filter(n => n.id !== id))
    setEdges(es => es.filter(e => e.from !== id && e.to !== id))
    if (note && note.split('>').includes(id)) setNote(null)
    setSelected(null)
    setConnecting(null)
    canvas.current?.focus()
    stage(ops)
    announce(`${nameOf(id)} removed. Staged.`)
  }

  const placed = (except?: string) => nodes.filter(n => n.id !== except).map(n => ({ ...boxOf(n), id: n.id, layer: 0 as const, big: false }))

  const onNodeKey = (e: KeyboardEvent, id: string) => {
    if (!canWrite) return
    if (connecting) {
      const dir = DIRS[e.key]
      if (dir) {
        e.preventDefault()
        const here = connecting.target ?? connecting.from
        const next = nearestInDirection(here, dir, placed(here === connecting.from ? undefined : connecting.from), [])
        if (next) { setConnecting({ ...connecting, target: next }); announce(`To ${nameOf(next)}, ${kindWord(byId.get(next)!.kind)}.`) }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (connecting.target) connect(connecting.from, connecting.target)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setConnecting(null)
        announce('Not connected.')
      }
      return
    }
    const n = byId.get(id)
    if (!n || e.altKey || e.metaKey || e.ctrlKey) return
    if (DIRS[e.key]) {
      e.preventDefault()
      const next = moveBy(n, e.key, e.shiftKey)
      setSelected(id)
      if (next !== n && (next.x !== n.x || next.y !== n.y)) { moveTo(next); stage(opsForMove(next)) }
    } else if (e.key === 'c' && !e.shiftKey) {
      e.preventDefault()
      setSelected(id)
      setConnecting({ from: id, target: null })
      announce(`Connecting from ${n.name}. Arrows pick a System, Enter connects, Esc stops.`)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      remove(id)
    }
  }

  const onNodeClick = (id: string) => {
    if (connecting && canWrite) { if (id !== connecting.from) connect(connecting.from, id); return }
    setSelected(id)
  }

  // A pointer drags a node (its position staged when it lands) or, from a handle, a connection to the node it is let go on.
  const grab = (e: PointerEvent, id: string) => {
    if (!canWrite || e.button !== 0) return
    const n = byId.get(id)
    const r = plane.current?.getBoundingClientRect()
    if (!n || !r) return
    drag.current = { id, dx: e.clientX - r.left - n.x, dy: e.clientY - r.top - n.y, moved: false }
    const move = (ev: globalThis.PointerEvent) => {
      const d = drag.current
      if (!d) return
      d.moved = true
      moveTo({ ...n, x: Math.max(COMPOSE.nodeW / 2, Math.round(ev.clientX - r.left - d.dx)), y: Math.max(COMPOSE.nodeH / 2, Math.round(ev.clientY - r.top - d.dy)) })
    }
    const up = (ev: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = drag.current
      drag.current = null
      if (d?.moved) stage(opsForMove({ ...n, x: Math.max(COMPOSE.nodeW / 2, Math.round(ev.clientX - r.left - d.dx)), y: Math.max(COMPOSE.nodeH / 2, Math.round(ev.clientY - r.top - d.dy)) }))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const pull = (e: PointerEvent, from: string) => {
    if (!canWrite || e.button !== 0) return
    e.stopPropagation()
    const up = (ev: globalThis.PointerEvent) => {
      window.removeEventListener('pointerup', up)
      const to = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.cmp-canvas [data-node-id]')?.dataset.nodeId
      if (to) connect(from, to)
    }
    window.addEventListener('pointerup', up)
  }

  const onDragOver = (e: DragEvent) => { if (canWrite && e.dataTransfer.types.includes(KIND_DRAG)) e.preventDefault() }
  const onDrop = (e: DragEvent) => {
    const kind = e.dataTransfer.getData(KIND_DRAG)
    const r = plane.current?.getBoundingClientRect()
    if (!canWrite || !kind || !r) return
    e.preventDefault()
    place(kind, { x: Math.max(COMPOSE.nodeW / 2, e.clientX - r.left), y: Math.max(COMPOSE.nodeH / 2, e.clientY - r.top) })
  }

  const w = Math.max(...nodes.map(n => n.x + COMPOSE.nodeW / 2 + ROOM), 0)
  const h = Math.max(...nodes.map(n => n.y + COMPOSE.nodeH / 2 + ROOM), 0)
  const bad = note ? edges.find(e => edgeKey(e) === note && e.invalid) : undefined
  const badAt = bad && byId.has(bad.from) && byId.has(bad.to) ? edgeGeometry(boxOf(byId.get(bad.from)!), boxOf(byId.get(bad.to)!)) : null
  const sel = selected ? byId.get(selected) : undefined

  return (
    <div className="cmp">
      <div className={canWrite ? 'cmp-shell' : 'cmp-shell cmp-read'}>
        {canWrite && (
          <div className="cmp-shelf" role="group" aria-label="Place a System">
            <span className="cmp-eyebrow" aria-hidden="true">Place</span>
            {p.shelf.map(kind => (
              <button key={kind} type="button" className="cmp-item" draggable
                onDragStart={e => { e.dataTransfer.setData(KIND_DRAG, kind); e.dataTransfer.effectAllowed = 'copy' }}
                onClick={() => place(kind)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); place(kind) } }}>
                <Icon name={kindIcon(kind)} size="sm" /><span className="cmp-item-l">{kindWord(kind)}</span><span className="cmp-grip"><Icon name="grip" size="xs" /></span>
              </button>
            ))}
          </div>
        )}
        <div ref={canvas} className="cmp-canvas" role="group" aria-label={`Compose canvas, ${nodes.length} Systems`} tabIndex={-1} onDragOver={onDragOver} onDrop={onDrop}>
          <div ref={plane} className="cmp-plane" style={{ width: w, height: h }}>
            <svg width={w} height={h} aria-hidden="true">
              {edges.filter(e => byId.has(e.from) && byId.has(e.to)).map(e => (
                <path key={edgeKey(e)} className={e.invalid ? 'hedge is-bad' : 'hedge'} d={edgeGeometry(boxOf(byId.get(e.from)!), boxOf(byId.get(e.to)!)).d} />
              ))}
            </svg>
            {nodes.map(n => {
              const on = n.id === selected
              const data: MapNodeData = {
                item: { id: n.id, kind: n.kind, name: n.name }, facts: n.kind === 'link' ? 'link' : chainName(p.chain),
                states: on ? ['draft', 'selected'] : ['draft'], order: n.order > 0 ? n.order : undefined,
              }
              return (
                <div key={n.id} className="cmp-node" style={{ left: n.x, top: n.y }}
                  onClick={() => onNodeClick(n.id)} onKeyDown={e => onNodeKey(e, n.id)} onPointerDown={e => grab(e, n.id)}>
                  <HouseNode data={data} className={connecting?.target === n.id ? 'cmp-target' : undefined} />
                  {on && canWrite && SIDES.map(s => <span key={s} className={`cmp-handle cmp-handle-${s}`} data-side={s} aria-hidden="true" onPointerDown={e => pull(e, n.id)} />)}
                </div>
              )
            })}
          </div>
          {/* the plane's sibling, at the plane's own coordinates (the plane starts at the canvas's corner); under 820px
              it falls to the canvas's foot, in the flow (map.css) */}
          {bad && badAt && (
            <div key={note!} className="cmp-bad" role="alert" style={{ left: badAt.x, top: badAt.y }}><Icon name="alert" size="sm" />{bad.invalid}</div>
          )}
        </div>
        <section className="cmp-insp" aria-label={sel ? sel.name : 'Selected System'}>
          {sel ? (
            <>
              <div className="insp-h">
                <KindTile kind={sel.kind} tone="moss" />
                <div className="insp-hm"><div className="insp-k">{kindWord(sel.kind)} · not deployed</div><h3 className="insp-t">{sel.name}</h3></div>
              </div>
              <div className="insp-b">
                <FieldTable label={`${sel.name} fields`}>
                  <FieldRow label="Name" htmlFor={canWrite ? nameId : undefined}>
                    {canWrite
                      ? <input key={sel.id} id={nameId} className="input" defaultValue={sel.name} onBlur={e => {
                          const name = e.currentTarget.value.trim()
                          if (name && name !== sel.name) { moveTo({ ...sel, name }); stage(opsForRename(sel.id, name)) }
                        }} />
                      : sel.name}
                  </FieldRow>
                  <FieldRow label="Chain">{chainName(p.chain)}</FieldRow>
                  {sel.order > 0 && <FieldRow label="Deploys"><span className="mono">{sel.order} of {preparedCount(nodes, edges)}</span></FieldRow>}
                  {edges.filter(e => !e.invalid && e.from === sel.id && e.label === 'signs').map(e => (
                    <FieldRow key={edgeKey(e)} label="Signs for">{nameOf(e.to)} <span className="faint">through Hats Signer Gate</span></FieldRow>
                  ))}
                  {edges.filter(e => !e.invalid && (e.from === sel.id || e.to === sel.id) && !(e.from === sel.id && e.label === 'signs')).map(e => (
                    <FieldRow key={edgeKey(e)} label="Connects">{relationSentence(nameOf(e.from), e.label, nameOf(e.to))}</FieldRow>
                  ))}
                </FieldTable>
              </div>
            </>
          ) : <p className="cmp-hint">Select a System to see its fields.</p>}
        </section>
        <div className="cmp-foot">
          <StatusMark mark="draft" label="Staged · not yet deployed" />
          <span>{plural(preparedCount(nodes, edges))}, in order · {chainName(p.chain)}</span>
          {canWrite && <span className="cmp-acts"><Button onClick={p.onReview}>Review order</Button><Button primary onClick={p.onPropose}>Propose</Button></span>}
        </div>
      </div>
    </div>
  )
}

const plural = (n: number) => `${n} prepared transaction${n === 1 ? '' : 's'}`
