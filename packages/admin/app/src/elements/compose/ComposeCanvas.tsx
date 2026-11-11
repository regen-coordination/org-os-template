import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { Link } from 'wouter'
import { Button } from '../../design/Button.tsx'
import { FieldRow, FieldTable } from '../../design/FieldRow.tsx'
import { Icon, kindIcon } from '../../design/Icon.tsx'
import { KindTile } from '../../design/KindTile.tsx'
import { Note } from '../../design/Note.tsx'
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
  COMPOSE, DEPLOYED, DRAG_THRESHOLD_PX, HAT_HELD, ON_CHAIN, canConnect, contextOf, estimateSteps, isHat, keyOfHat, moveBy, nextOrder, opsForConnect, opsForDelete, opsForMove, opsForPlace,
  opsForRename, opsForText, opsForThreshold, preparedCount, relationOf, removedWith, treeOfHat,
  type ComposeCtx, type ComposeEdge, type ComposeNode,
} from './compose.ts'
import { CHAIN_HELD_SENTENCE } from '../../../../lib/chain-held.mjs'

const DIRS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
const SIDES = ['n', 'e', 's', 'w'] as const
const KIND_DRAG = 'application/x-org-os-kind'
/** Room past the furthest node, so the plane always has somewhere to put the next one. */
const ROOM = 48

const boxOf = (n: ComposeNode): Box => ({ x: n.x - COMPOSE.nodeW / 2, y: n.y - COMPOSE.nodeH / 2, w: COMPOSE.nodeW, h: COMPOSE.nodeH })
const edgeKey = (e: Pick<ComposeEdge, 'from' | 'to'>) => `${e.from}>${e.to}`

/** `0x00000000…00a1` for `eip155:11155111:0x…a1`: enough to tell owners apart. */
const shortAddress = (caip: string) => { const a = caip.slice(caip.lastIndexOf(':') + 1); return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a }
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'hat'

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
  /** The planner's count of prepared transactions (spec §8.2). Left out (a /parts specimen), the canvas estimates from
   *  its nodes; `null` is a page that has no plan read yet (/compose until Task 11's GET /api/deploy): no count is drawn. */
  prepared?: { steps: number } | null
  /** Whether the actor's change stages any of this composition. Without it (`false`) the foot says the composition is
   *  composed, and offers no Review order or Propose: there is nothing to review. */
  staged?: boolean
  /** Drawn without its write controls, as previewing draws it: an actor who may not write here (no member). */
  readOnly?: boolean
  /** Where the plan's steps are (/deploy, DAO-OS L7 Task 18): the foot links there beside the count. Left out (no plan
   *  read, a /parts specimen), no link. */
  deployHref?: string
  /** The composed Systems the chain holds: every step of theirs the plan prepares is done (GET /api/deploy), while the
   *  records still say composed until Read back records them (whole-platform walk I13). Such a node, and a hat of such a
   *  tree, reads "on chain", not "not deployed". */
  onChain?: ReadonlySet<string>
}) {
  const canWrite = useCanWrite() && !p.readOnly
  const [nodes, setNodes] = useState(p.nodes)
  const [edges, setEdges] = useState(p.edges)
  const [selected, setSelected] = useState<string | null>(p.selected ?? null)
  const [connecting, setConnecting] = useState<{ from: string; target: string | null } | null>(null)
  const [note, setNote] = useState<string | null>(() => { const bad = p.edges.filter(e => e.invalid).at(-1); return bad ? edgeKey(bad) : null })
  const [focusId, setFocusId] = useState<string | null>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const plane = useRef<HTMLDivElement>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null)
  /** Drops the listeners of the pointer gesture in progress, if any. */
  const letGo = useRef<(() => void) | null>(null)
  const pending = useRef<{ nodes: ComposeNode[]; edges: ComposeEdge[] } | null>(null)
  const nameId = useId()
  const descriptionId = useId()
  const notesId = useId()

  // New props re-seed the canvas, unless a drag is in progress: then they wait for its end (B9 M-2).
  const seeded = useRef({ nodes: p.nodes, edges: p.edges })
  useEffect(() => {
    if (seeded.current.nodes === p.nodes && seeded.current.edges === p.edges) return
    seeded.current = { nodes: p.nodes, edges: p.edges }
    if (drag.current) { pending.current = seeded.current; return }
    setNodes(p.nodes); setEdges(p.edges)
  }, [p.nodes, p.edges])
  const reseed = () => { const q = pending.current; pending.current = null; if (q) { setNodes(q.nodes); setEdges(q.edges) } }
  useEffect(() => () => letGo.current?.(), [])

  useEffect(() => {
    if (focusId === null) return
    ;[...(canvas.current?.querySelectorAll<HTMLElement>('[data-node-id]') ?? [])].find(el => el.dataset.nodeId === focusId)?.focus()
    setFocusId(null)
  }, [focusId])

  const byId = new Map(nodes.map(n => [n.id, n]))
  const nameOf = (id: string) => byId.get(id)?.name ?? id
  const stage = (ops: StageOp[]) => { if (ops.length > 0) p.onStage(ops) }
  const ctxFor = (es: ComposeEdge[], ns: ComposeNode[] = nodes): ComposeCtx => contextOf(ns, es, p.chain)

  const place = (kind: string, at?: { x: number; y: number }) => {
    const c = canvas.current
    const centre = c && c.clientWidth > 0
      ? { x: c.scrollLeft + c.clientWidth / 2, y: c.scrollTop + c.clientHeight / 2 }
      : { x: COMPOSE.canvasW / 2, y: COMPOSE.canvasH / 2 }
    const pos = at ?? centre
    const name = `New ${kindWord(kind)}`
    // A hat lives in a tree: the selected hat's or tree's (a deployed one refuses it), else the first composed one.
    const treeId = kind !== 'hat' ? undefined : [sel && (isHat(sel.id) ? treeOfHat(sel.id) : sel.kind === 'hats-tree' ? sel.id : undefined), nodes.find(m => m.kind === 'hats-tree' && !m.deployed)?.id].find(Boolean)
    const taken = new Set(nodes.map(m => m.id))
    let key = slug(name), k = 2
    while (treeId && taken.has(`${treeId}/${key}`)) key = `${slug(name)}-${k++}`
    const n: ComposeNode = {
      id: kind === 'hat' ? `${treeId ?? ''}/${key}` : freshId(kind, nodes), kind, name, x: Math.round(pos.x), y: Math.round(pos.y),
      order: kind === 'link' || kind === 'hat' ? 0 : nextOrder(nodes), ...(kind === 'hat' && treeId ? { tree: treeId, wearers: [] } : {}),
      // a placed System is composed (opsForPlace's record says so): a Safe may wear a new tree's top hat at once
      ...(kind === 'hat' ? {} : { deployment: { status: 'composed' } }),
    }
    const ops = opsForPlace(kind === 'hat' && !treeId ? { ...n, id: key } : n, ctxFor(edges))
    if (typeof ops === 'string') { setRefusal(ops); return } // the error note says it once (Note)
    setRefusal(null)
    setNodes(ns => [...ns, n])
    setSelected(n.id)
    setFocusId(n.id)
    stage(ops)
    announce(`${n.name} placed. Arrows move it.`)
  }

  const setThreshold = (n: ComposeNode, t: number) => {
    if (!n.owners || t < 1 || t > n.owners.length) return
    moveTo({ ...n, threshold: t })
    stage(opsForThreshold({ ...n, threshold: t }, t))
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
      const ops = opsForConnect(from, next, ctxFor(next))
      if (typeof ops === 'string') { setEdges([...rest, { from, to, label: '', invalid: ops }]); setNote(edgeKey({ from, to })); return }
      setEdges(next)
      if (note === edgeKey({ from, to })) setNote(null)
      stage(ops)
      announce(`${relationSentence(a.name, label, b.name)}. Staged.`)
    } else {
      setEdges([...rest, { from, to, label: '', invalid: ok }])
      setNote(edgeKey({ from, to }))
    }
  }

  const remove = (id: string) => {
    const ctx = ctxFor(edges)
    const ops = opsForDelete(id, edges, ctx)
    if (typeof ops === 'string') { announce(ops); return } // a deployed System is not removed here (L7 gap B1)
    const gone = removedWith(id, ctx)
    setNodes(ns => ns.filter(n => !gone.has(n.id)))
    setEdges(es => es.filter(e => !gone.has(e.from) && !gone.has(e.to)))
    if (note && note.split('>').some(x => gone.has(x))) setNote(null)
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
    // a deployed System moves and connects as any (L7 gap B1); what the chain holds of it is never staged here
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

  // A pointer drags a node (its position staged when it lands, once it has travelled DRAG_THRESHOLD_PX) or, from a
  // handle, a connection to the node it is let go on. pointercancel ends either with nothing staged.
  const grab = (e: PointerEvent, id: string) => {
    if (!canWrite || e.button !== 0) return
    const n = byId.get(id)
    const r = plane.current?.getBoundingClientRect()
    if (!n || !r) return
    letGo.current?.()
    const from = { x: e.clientX, y: e.clientY }
    const d = { id, dx: e.clientX - r.left - n.x, dy: e.clientY - r.top - n.y, moved: false }
    drag.current = d
    const at = (ev: globalThis.PointerEvent): ComposeNode => ({ ...n, x: Math.max(COMPOSE.nodeW / 2, Math.round(ev.clientX - r.left - d.dx)), y: Math.max(COMPOSE.nodeH / 2, Math.round(ev.clientY - r.top - d.dy)) })
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      drag.current = null
      letGo.current = null
      reseed()
    }
    const move = (ev: globalThis.PointerEvent) => {
      if (!d.moved && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < DRAG_THRESHOLD_PX) return
      d.moved = true
      moveTo(at(ev))
    }
    const up = (ev: globalThis.PointerEvent) => { const moved = d.moved; end(); if (moved) stage(opsForMove(at(ev))) }
    const cancel = () => { const moved = d.moved; end(); if (moved) moveTo(n) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    letGo.current = end
  }
  const pull = (e: PointerEvent, from: string) => {
    if (!canWrite || e.button !== 0) return
    e.stopPropagation()
    letGo.current?.()
    const end = () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', end); letGo.current = null }
    const up = (ev: globalThis.PointerEvent) => {
      end()
      const to = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.cmp-canvas [data-node-id]')?.dataset.nodeId
      if (to) connect(from, to)
    }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', end)
    letGo.current = end
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
  // L7 gap B1: what the chain holds of a deployed System is shown read only, with the sentence; a hat of a deployed tree is
  // all the chain's
  const held = (field: string) => (sel?.deployed ? CHAIN_HELD_SENTENCE(field) : undefined)
  const heldHat = !!sel?.deployed && isHat(sel.id)
  // the planner's count, else (a specimen) an estimate; none while a page has read no plan
  const count = p.prepared ? preparedCount(p.prepared) : p.prepared === null ? null : estimateSteps(nodes, edges)
  const staged = p.staged !== false
  /** A node still composed in the records whose System the chain holds (walk I13). */
  const chainHolds = (n: ComposeNode) => !n.deployed && !!p.onChain?.has(n.tree ?? n.id)
  const composedNodes = nodes.filter(n => !n.deployed)
  const allOnChain = composedNodes.length > 0 && composedNodes.every(chainHolds)

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
            {refusal && <Note state="error">{refusal}</Note>}
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
                states: chainHolds(n) ? (on ? ['selected'] : []) : on ? ['draft', 'selected'] : ['draft'],
                order: n.order > 0 && !chainHolds(n) ? n.order : undefined,
              }
              return (
                <div key={n.id} className="cmp-node" style={{ left: n.x, top: n.y }}
                  onClick={() => onNodeClick(n.id)} onKeyDown={e => onNodeKey(e, n.id)} onPointerDown={e => grab(e, n.id)}>
                  <HouseNode data={data} className={connecting?.target === n.id ? 'cmp-target' : undefined} tag={chainHolds(n) ? 'on chain' : undefined} />
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
                <div className="insp-hm"><div className="insp-k">{kindWord(sel.kind)} · {sel.deployed ? 'deployed' : chainHolds(sel) ? 'deployed on chain' : 'not deployed'}</div><h3 className="insp-t">{sel.name}</h3></div>
              </div>
              <div className="insp-b">
                {sel.deployed && <p className="cmp-hint">{DEPLOYED}</p>}
                {chainHolds(sel) && <p className="cmp-hint">{ON_CHAIN}</p>}
                <FieldTable label={`${sel.name} fields`}>
                  {/* L7 gap B1: a deployed System's name, description and notes are its record's; a deployed tree's hat's
                      name is its details, which the chain holds */}
                  <FieldRow label="Name" htmlFor={canWrite && !heldHat ? nameId : undefined} help={heldHat ? HAT_HELD : undefined}>
                    {canWrite && !heldHat
                      ? <input key={sel.id} id={nameId} className="input" defaultValue={sel.name} onBlur={e => {
                          const name = e.currentTarget.value.trim()
                          if (!name || name === sel.name) return
                          const ops = opsForRename(sel.id, name, ctxFor(edges, nodes))
                          if (typeof ops === 'string') { announce(ops); return }
                          moveTo({ ...sel, name }); stage(ops)
                        }} />
                      : sel.name}
                  </FieldRow>
                  {!isHat(sel.id) && (canWrite || sel.description) && (
                    <FieldRow label="Description" htmlFor={canWrite ? descriptionId : undefined}>
                      {canWrite
                        ? <input key={sel.id} id={descriptionId} className="input" defaultValue={sel.description ?? ''} onBlur={e => {
                            const value = e.currentTarget.value.trim()
                            if (value === (sel.description ?? '')) return
                            moveTo({ ...sel, description: value || undefined }); stage(opsForText(sel.id, 'description', value))
                          }} />
                        : sel.description}
                    </FieldRow>
                  )}
                  {!isHat(sel.id) && (canWrite || sel.notes) && (
                    <FieldRow label="Notes" htmlFor={canWrite ? notesId : undefined}>
                      {canWrite
                        ? <textarea key={sel.id} id={notesId} className="input" rows={2} defaultValue={sel.notes ?? ''} onBlur={e => {
                            const value = e.currentTarget.value.trim()
                            if (value === (sel.notes ?? '')) return
                            moveTo({ ...sel, notes: value || undefined }); stage(opsForText(sel.id, 'notes', value))
                          }} />
                        : sel.notes}
                    </FieldRow>
                  )}
                  <FieldRow label="Chain" help={held('chain')}>{chainName(p.chain)}</FieldRow>
                  {sel.deployed && sel.address && !isHat(sel.id) && (
                    <FieldRow label="Address" help={held('address')}><span className="mono">{shortAddress(sel.address)}</span></FieldRow>
                  )}
                  {sel.owners && (
                    <FieldRow label="Owners" help={held('deployment.owners')}>
                      <ul className="cmp-list" aria-label="Owners">{sel.owners.map(o => <li key={o} className="mono">{shortAddress(o)}</li>)}</ul>
                    </FieldRow>
                  )}
                  {sel.owners && sel.threshold !== undefined && (
                    <FieldRow label="Threshold" help={held('deployment.threshold')}>
                      {sel.deployed || !canWrite ? <span className="mono">{sel.threshold} of {sel.owners.length}</span> : <span className="stepper">
                        <Button small iconOnly label="Lower threshold" unavailable={sel.threshold <= 1 ? 'At least one owner must sign.' : undefined}
                          onClick={() => setThreshold(sel, sel.threshold! - 1)}>−</Button>
                        <span className="mono">{sel.threshold} of {sel.owners.length}</span>
                        <Button small iconOnly label="Raise threshold" unavailable={sel.threshold >= sel.owners.length ? 'No more than the number of owners.' : undefined}
                          onClick={() => setThreshold(sel, sel.threshold! + 1)}>+</Button>
                      </span>}
                    </FieldRow>
                  )}
                  {sel.wearers && (
                    <FieldRow label="Wearers" help={heldHat ? undefined : held('hats')}>
                      {sel.wearers.length === 0 ? <span className="faint">No one yet</span>
                        : <ul className="cmp-list" aria-label="Wearers">{sel.wearers.map(o => <li key={o} className="mono">{shortAddress(o)}</li>)}</ul>}
                    </FieldRow>
                  )}
                  {sel.order > 0 && <FieldRow label="Deploys"><span className="mono">{count === null ? `${sel.order}` : `${sel.order} of ${count}`}</span></FieldRow>}
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
        {/* an empty canvas has nothing composed to say or review (/compose before its first System) */}
        {nodes.length > 0 && (
          <div className="cmp-foot">
            {allOnChain && !staged
              ? <StatusMark mark="done" label="Deployed on chain · not yet read back" />
              : <StatusMark mark="draft" label={staged ? 'Staged · not yet deployed' : 'Composed · not yet deployed'} />}
            {count !== null ? <span>{plural(count)}, in order · {chainName(p.chain)}</span> : <span>{chainName(p.chain)}</span>}
            {p.deployHref && <Link href={p.deployHref}>Open the prepared steps</Link>}
            {canWrite && staged && <span className="cmp-acts"><Button onClick={p.onReview}>Review order</Button><Button primary onClick={p.onPropose}>Propose</Button></span>}
          </div>
        )}
      </div>
    </div>
  )
}

const plural = (n: number) => `${n} prepared transaction${n === 1 ? '' : 's'}`
