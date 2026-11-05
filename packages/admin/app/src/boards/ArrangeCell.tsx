// packages/admin/app/src/boards/ArrangeCell.tsx
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { BlockEntry, BoardDef } from '../api.ts'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { Menu, type MenuEntry } from '../design/Menu.tsx'
import { arrangeStore } from './arrangeStore.ts'
import { keyDelta, moveBy, removeBlock, resizeBy } from './arrange.ts'
import { CELL } from './layout.ts'

/** One block in Arrange (spec §5.3, §14.2; §13 "every drag has a keyboard and single-pointer path"): a group you can
 *  Tab to, with a bar — its grip, its name, Move to…, Settings and Remove. On the group or its focused grip, Space
 *  picks it up and drops it, arrows move, Shift+arrows resize, Escape puts it back (ruling R-4, E-72), each step said;
 *  the grip and the corner do the same by pointer, and Move to… moves it a step (or, in a flow, to a place) with a
 *  single press. A picked block is the drop target, moss dashed on --accent-soft. Its content is inert, so arranging
 *  never edits a record. An Escape it handles is not the panel stack's: it stops there, so block settings open beside
 *  it stay open. `locked` (the review, staging) disables every edit, so nothing can change under a stage in flight. */
export function ArrangeCell({ entry, index, total, board, picked, locked = false, label, onSettings, say, children }: {
  entry: BlockEntry; index: number; total: number; board: BoardDef; picked: boolean; locked?: boolean; label: string
  onSettings: (opener: HTMLElement) => void; say: (s: string) => void; children: ReactNode
}) {
  const self = useRef<HTMLDivElement>(null)
  const grip = useRef<HTMLButtonElement>(null)
  const onGrip = useRef(false) // the keys came from the grip: focus goes back there, not to the group
  const before = useRef<BoardDef | null>(null)
  // A flow move reorders the cells, and React moves this node with insertBefore: Chrome and Firefox then drop
  // focus to the body, where the next arrow, Space or Escape would land (Escape on the panel stack). Take it back.
  const placeKey = `${index}:${JSON.stringify(entry.place ?? null)}`
  useLayoutEffect(() => {
    const to = onGrip.current ? grip.current : self.current
    if (picked && to && document.activeElement !== to) to.focus()
  }, [placeKey, picked])
  const drag = useRef<{ x: number; y: number; snap: BoardDef; resize: boolean; unit: number; pointerId: number } | null>(null)
  const where = (b: BoardDef) => {
    const p = b.blocks.find(x => x.id === entry.id)?.place as Record<string, number> | undefined
    if (b.layout === 'grid' && p) return `column ${p.col}, ${p.span} wide, row ${p.row}`
    if (b.layout === 'canvas' && p) return `${p.x}, ${p.y}, ${p.w} by ${p.h}`
    return `place ${b.blocks.findIndex(x => x.id === entry.id) + 1} of ${b.blocks.length}`
  }
  const key = (e: KeyboardEvent) => {
    const fromGrip = e.target === grip.current
    if ((e.target !== e.currentTarget && !fromGrip) || locked) return
    onGrip.current = fromGrip
    if (e.key === ' ') {
      e.preventDefault()
      if (picked) { arrangeStore.pick(null); before.current = null; say(`Dropped ${label} at ${where(board)}.`) }
      else { before.current = board; arrangeStore.pick(entry.id); say(`Picked up ${label}. Arrows move, Shift and arrows resize, Space drops, Escape puts it back.`) }
      return
    }
    if (!picked) return
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation()
      if (before.current) { const b = before.current; arrangeStore.update(() => b) }
      arrangeStore.pick(null); before.current = null
      say(`Put ${label} back.`)
      return
    }
    const d = keyDelta(e, board.layout)
    if (!d) return
    e.preventDefault()
    let next = board
    arrangeStore.update(b => (next = d.resize ? resizeBy(b, entry.id, d.dx, d.dy) : moveBy(b, entry.id, d.dx, d.dy)))
    say(`${label}: ${where(next)}.`)
  }

  // A drag that ends without a lift (pointercancel, lost capture, a lift outside, Escape) puts the block back.
  const putBack = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    arrangeStore.update(() => d.snap)
    say(`Put ${label} back.`)
  }
  useEffect(() => {
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && drag.current) { e.preventDefault(); e.stopPropagation(); putBack() } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  })
  const down = (resize: boolean) => (e: PointerEvent) => {
    if (locked || e.button > 0 || drag.current || (e.target as HTMLElement).closest('select, a, button:not(.arr-grip)')) return
    e.preventDefault()
    const grid = (e.currentTarget as HTMLElement).closest('.board') as HTMLElement | null
    // jsdom (and a board not laid out yet) measures 0: a column is then a canvas cell
    const unit = board.layout === 'grid' && grid && grid.clientWidth > 0 ? grid.clientWidth / 12 : CELL
    drag.current = { x: e.clientX, y: e.clientY, snap: board, resize, unit, pointerId: e.pointerId }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const move = (e: PointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    if (!e.buttons) { putBack(); return }
    const px = e.clientX - d.x
    const py = e.clientY - d.y
    const [dx, dy] = board.layout === 'grid' ? [Math.round(px / d.unit), Math.round(py / 136)] : [Math.round(px / 8) * 8, Math.round(py / 8) * 8]
    arrangeStore.update(() => (d.resize ? resizeBy(d.snap, entry.id, dx, dy) : moveBy(d.snap, entry.id, dx, dy)))
  }
  const up = (e: PointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    drag.current = null
    say(`${label}: ${where(arrangeStore.get()?.board ?? board)}.`)
  }
  const cancel = (e: PointerEvent) => { if (drag.current && e.pointerId === drag.current.pointerId) putBack() }
  const pointer = { onPointerMove: move, onPointerUp: up, onPointerCancel: cancel, onLostPointerCapture: cancel }
  // One press, one step (§13's single-pointer path): a flow's places, or a grid's and a canvas's four directions
  const step = (dx: number, dy: number) => {
    let next = board
    arrangeStore.update(b => (next = moveBy(b, entry.id, dx, dy)))
    say(`${label}: ${where(next)}.`)
  }
  const at = board.blocks.findIndex(x => x.id === entry.id)
  const big = board.layout === 'canvas' ? 64 : 1
  const moves: MenuEntry[] = board.layout === 'flow'
    ? board.blocks.map((_, i) => ({ type: 'radio', label: `Place ${i + 1}`, checked: i === at, onSelect: () => {
        let next = board
        arrangeStore.update(b => { let out = b; for (let k = 0; k < Math.abs(i - at); k++) out = moveBy(out, entry.id, 0, Math.sign(i - at)); return (next = out) })
        say(`${label}: ${where(next)}.`)
      } }))
    : [
        { type: 'item', label: board.layout === 'grid' ? 'One column left' : 'Left', hint: board.layout === 'canvas' ? '64\u00a0px' : undefined, onSelect: () => step(-big, 0) },
        { type: 'item', label: board.layout === 'grid' ? 'One column right' : 'Right', hint: board.layout === 'canvas' ? '64\u00a0px' : undefined, onSelect: () => step(big, 0) },
        { type: 'item', label: board.layout === 'grid' ? 'One row up' : 'Up', hint: board.layout === 'canvas' ? '64\u00a0px' : undefined, onSelect: () => step(0, -big) },
        { type: 'item', label: board.layout === 'grid' ? 'One row down' : 'Down', hint: board.layout === 'canvas' ? '64\u00a0px' : undefined, onSelect: () => step(0, big) },
      ]
  return (
    <div ref={self} className={picked ? 'arr picked' : 'arr'} tabIndex={0} role="group" aria-roledescription="block"
      aria-label={`${label}, block ${index + 1} of ${total}`} aria-describedby="arrange-help" onKeyDown={key}>
      <div className="arr-bar">
        <button ref={grip} type="button" className="arr-grip" aria-label={`Move ${label}`} aria-describedby="arrange-help" aria-pressed={picked}
          disabled={locked} onPointerDown={down(false)} {...pointer}><Icon name="grip" size="sm" /></button>
        <span className="arr-name">{label}</span>
        <span className="arr-acts">
          {!locked && <Menu label={`Move to… ${label}`} text={<span className="arr-mv">Move to…</span>} icon="more" items={moves} />}
          <Button small variant="ghost" disabled={locked} onClick={e => onSettings(e.currentTarget)}>Settings</Button>
          <Button small variant="ghost" disabled={locked} onClick={() => { arrangeStore.update(b => removeBlock(b, entry.id)); say(`Removed ${label}.`) }}>Remove</Button>
        </span>
      </div>
      <div className="arr-body" inert>{children}</div>
      {board.layout !== 'flow' && <span className="arr-size" onPointerDown={down(true)} {...pointer} aria-hidden="true" />}
    </div>
  )
}
