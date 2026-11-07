import { walk, type Machine } from '../../../lib/machines/run.mjs'
import { Scroll } from '../design/Scroll.tsx'
import { HouseNode } from '../map/HouseNode.tsx'

/** A state's box, and the room between columns and rows (the labels sit in the column gap). */
const W = 200, H = 80, GX = 96, GY = 36

/** Columns by first way in: the initial state in column 0, each other one a column past the nearest
 *  state that leads to it; states nothing reaches go last. Rows in the order the machine lists them. */
export function layoutMachine(m: Machine): { boxes: { state: string; col: number; row: number }[]; cols: number; rows: number } {
  const w = walk(m)
  const depth = new Map<string, number>([[m.initial, 0]])
  const queue = [m.initial]
  while (queue.length > 0) {
    const s = queue.shift()!
    for (const e of w.edges) if (e.from === s && e.to !== s && !depth.has(e.to)) { depth.set(e.to, depth.get(s)! + 1); queue.push(e.to) }
  }
  const last = Math.max(0, ...depth.values()) + 1
  const perCol = new Map<number, number>()
  const boxes = Object.keys(m.states).map(state => {
    const col = depth.get(state) ?? last
    const row = perCol.get(col) ?? 0
    perCol.set(col, row + 1)
    return { state, col, row }
  })
  return { boxes, cols: Math.max(...boxes.map(b => b.col)) + 1, rows: Math.max(...boxes.map(b => b.row)) + 1 }
}

/** A machine drawn from its data (spec §6), with the map's nodes and edges (§14.2): each state a house node with its
 *  sentence, the initial one heavier-ruled and the final ones double-ruled, each also saying so on a tag; each
 *  transition a house edge labelled with the event and the guards; a state's own loops listed in it. The picture is
 *  hidden from screen readers; the transitions table says it all. */
export function MachineDiagram({ machine: m }: { machine: Machine }) {
  const w = walk(m)
  const l = layoutMachine(m)
  const pos = new Map(l.boxes.map(b => [b.state, { x: b.col * (W + GX), y: b.row * (H + GY) }]))
  const width = l.cols * (W + GX) - GX, height = l.rows * (H + GY) - GY
  const arrows = w.edges.filter(e => e.from !== e.to)
  const loops = (s: string) => w.edges.filter(e => e.from === s && e.to === s).map(e => e.event)
  const label = (e: { event: string; when: string[] }) => (e.when.length ? `${e.event} [${e.when.join(', ')}]` : e.event)
  // A transition forward runs from the right side to the next column's left side; one back or within a column loops
  // under, from bottom centre to bottom centre.
  const drawn = arrows.map(e => {
    const a = pos.get(e.from)!, b = pos.get(e.to)!
    const forward = b.x > a.x
    const x0 = forward ? a.x + W : a.x + W / 2, y0 = forward ? a.y + H / 2 : a.y + H
    const x1 = forward ? b.x : b.x + W / 2, y1 = forward ? b.y + H / 2 : b.y + H
    const mx = (x0 + x1) / 2, my = forward ? (y0 + y1) / 2 : Math.max(y0, y1) + GY * 0.8
    const d = forward ? `M${x0} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}` : `M${x0} ${y0} C ${x0} ${my}, ${x1} ${my}, ${x1} ${y1}`
    return { d, x: mx, y: my, text: label(e) }
  })
  return (
    // the picture scrolls inside the figure when it is wider than the page: the figure is in the tab order and named,
    // so a keyboard can scroll it (2.1.1, axe scrollable-region-focusable)
    <figure className="hdiag" tabIndex={0} aria-label={`${m.id}: its states and transitions`}>
      <div className="hdiag-pic" style={{ width, height }} aria-hidden="true">
        <svg width={width} height={height}>
          <defs><marker id={`mh-${m.id}`} viewBox="0 0 6 6" refX="6" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L6 3 L0 6 z" className="hdiag-head" /></marker></defs>
          {drawn.map((e, i) => <path key={i} d={e.d} className="hedge" markerEnd={`url(#mh-${m.id})`} />)}
        </svg>
        {drawn.map((e, i) => <span key={i} className="hlabel" style={{ left: e.x, top: e.y, transform: 'translate(-50%, -50%)' }}>{e.text}</span>)}
        {l.boxes.map(b => {
          const p = pos.get(b.state)!
          const s = m.states[b.state]!
          const end = s.final ? 'final' : b.state === m.initial ? 'initial' : undefined
          const name = s.group && s.group !== b.state ? `${b.state} · ${s.group}` : b.state
          const own = loops(b.state)
          return (
            <HouseNode key={b.state} still dataState={b.state} tag={end} className={end ? `hnode-${end}` : undefined}
              data={{ item: { id: `${m.id}:${b.state}`, kind: 'state', name }, facts: s.shows.text, states: [] }}
              more={own.length > 0 ? `↺ ${own.join(', ')}` : undefined}
              style={{ left: p.x, top: p.y, width: W, height: H }} />
          )
        })}
      </div>
      <Scroll label={`${m.id} transitions`}><table className="rows" aria-label={`${m.id} transitions`}>
        <thead><tr><th scope="col">from</th><th scope="col">event</th><th scope="col">guards</th><th scope="col">to</th></tr></thead>
        <tbody>{w.edges.map((e, i) => <tr key={i}><td className="n">{e.from}</td><td className="n">{e.event}</td><td className="n">{e.when.join(', ')}</td><td className="n">{e.to}</td></tr>)}</tbody>
      </table></Scroll>
      {w.unreachable.length > 0 && <p className="err">Not reachable: {w.unreachable.join(', ')}</p>}
    </figure>
  )
}
