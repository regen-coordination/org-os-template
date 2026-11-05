import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Link } from 'wouter'
import { Button } from '../../design/Button.tsx'
import { Icon } from '../../design/Icon.tsx'
import { Menu, type MenuEntry } from '../../design/Menu.tsx'
import { StatusMark, type Mark } from '../../design/StatusMark.tsx'
import { announce } from '../../parts/live.tsx'
import { useCanWrite, useViewer } from '../../viewAs/ViewAs.tsx'
import { Presence } from '../atoms/Presence.tsx'

export interface BoardColumn {
  id: string
  name: string
  /** The mark before its name (§6.1): the shape alone, the name says the rest. */
  mark?: Mark
  /** Cards are not moved into it (0.6's overflow "other"); a card in it moves out. */
  locked?: boolean
}

export interface BoardViewProps<T> {
  label: string
  columns: BoardColumn[]
  cards: T[]
  cardKey(c: T): string
  /** The card's name, as moves are announced and its Move to… menu is named. */
  cardName(c: T): string
  /** The id of the column the card is in; a card in no listed column is not drawn. */
  columnOf(c: T): string
  /** The card's body (`BoardCard`). */
  card(c: T): ReactNode
  /** Move a card: true once it is moved (staged, for a governed collection), or the sentence that says why not. */
  onMove(c: T, to: string): Promise<true | string>
  /** A staged move: the moss bar and "Staged move". */
  staged?(c: T): boolean
  /** Why a card cannot be moved at all (a record with no id in its file), or undefined. */
  fixed?(c: T): string | undefined
  /** "+ New" in a column's head. */
  onNew?(column: string): void
}

/** A board card's body (§10.2): its title (a link when it opens somewhere, or a restricted field's words), two facts
 *  and who has it open. */
export function BoardCard({ title, href, facts = [], presence = [], marks = [] }:
  { title: ReactNode; href?: string; facts?: ReactNode[]; presence?: { handle: string; role: string; editing?: boolean }[]; marks?: Mark[] }) {
  const shown = facts.filter(f => f !== '' && f !== null && f !== undefined).slice(0, 2)
  return (
    <>
      <span className="kcard-t">{href !== undefined ? <Link href={href}>{title}</Link> : title}</span>
      {(shown.length > 0 || presence.length > 0 || marks.length > 0) && (
        <span className="kcard-f">
          {shown.map((f, i) => <span key={i} className="kcard-fact">{f}</span>)}
          {marks.map(m => <StatusMark key={m} mark={m} />)}
          <Presence people={presence} />
        </span>
      )}
    </>
  )
}

/** A lift in progress: the card, where it came from, and where it would land (a position in the column without it). */
type Lift = { key: string; from: string; fromAt: number; to: string; at: number; by: 'keys' | 'pointer' }
/** A pointer press on a card, until it travels far enough to be a drag. */
type Press = { key: string; pointerId: number; x: number; y: number; offX: number; offY: number; w: number; moved: boolean; from: string; fromAt: number; to: string }

/** How far a press travels before it lifts the card. */
const SLOP = 4

/** A collection as columns (spec §10.2): columns 240–280 wide on --sunken, radius 10, each headed by its mark, name,
 *  count and + New; cards raised, radius 8 — their title, two facts and presence. A staged move is the moss bar and
 *  "Staged move". Cards the viewer may not see are not drawn or counted (§6.3). The columns wrap; the board never
 *  scrolls sideways (§13).
 *
 *  Every move has three paths (§13, WCAG 2.5.7): the keyboard — Space lifts the focused card, the arrows move it
 *  between columns and positions, Space drops it, Esc (or leaving the card) puts it back, each step announced; the
 *  pointer — the lifted card pops and tilts (−1°, none under reduced motion) and follows it, its origin a dashed
 *  ghost, the column under it a moss dashed slot on --accent-soft (a touch scrolls instead); and the card's
 *  "Move to…" menu, at every width (E-9). A drop on another column calls `onMove`; a refusal is said, politely
 *  (E-11), and the card stays where it was. While previewing nothing is lifted and there is no + New and no Move
 *  to… (E-10, C-23). Under 600px of its own width (the `kb` container) the board is a grouped list. */
export function BoardView<T>(p: BoardViewProps<T>) {
  const { visible } = useViewer()
  const canWrite = useCanWrite()
  const hint = useId()
  const [lift, setLift] = useState<Lift | null>(null)
  const [float, setFloat] = useState<{ x: number; y: number; w: number } | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const press = useRef<Press | null>(null)
  const busy = useRef(false)
  const relocating = useRef(false)
  const refocus = useRef<string | null>(null)

  const seen = visible(p.cards)
  const byCol = new Map<string, T[]>(p.columns.map(c => [c.id, []]))
  for (const c of seen) byCol.get(p.columnOf(c))?.push(c)
  const cardBy = new Map(seen.map(c => [p.cardKey(c), c]))
  const nameOf = (id: string) => p.columns.find(c => c.id === id)?.name ?? id
  /** Where a card from `from` may go: every column that is not locked, and its own. */
  const targets = (from: string) => p.columns.filter(c => !c.locked || c.id === from)
  const rest = (col: string, key: string) => (byCol.get(col) ?? []).filter(c => p.cardKey(c) !== key)

  // The lifted card moves between lists, so React draws it anew: focus follows it, and the blur its move causes is
  // not the person leaving it.
  useLayoutEffect(() => {
    relocating.current = false
    const key = refocus.current
    if (key === null) return
    refocus.current = null
    for (const el of root.current?.querySelectorAll<HTMLElement>('li[data-card]') ?? []) if (el.dataset.card === key) el.focus()
  })

  const endPress = () => {
    if (!press.current) return
    press.current = null
    setLift(null)
    setFloat(null)
  }
  useEffect(() => {
    if (lift?.by !== 'pointer') return
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') endPress() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [lift?.by])

  const commit = async (c: T, to: string) => {
    if (busy.current) return
    busy.current = true
    const key = p.cardKey(c), name = p.cardName(c)
    setMoving(key)
    setRefused(null)
    let out: true | string
    try { out = await p.onMove(c, to) } catch (err) { out = err instanceof Error ? err.message : String(err) }
    busy.current = false
    setMoving(null)
    if (out === true) { announce(`Moved ${name} to ${nameOf(to)}.`); return }
    setRefused(`Not moved: ${out}`)
    announce(`Not moved: ${out}`)
  }

  const place = (next: Lift, name: string) => {
    relocating.current = true
    refocus.current = next.key
    setLift(next)
    announce(`${name}: ${nameOf(next.to)}, ${next.at + 1} of ${rest(next.to, next.key).length + 1}.`)
  }
  const putBack = (l: Lift, name: string, keepFocus: boolean) => {
    if (keepFocus) { relocating.current = true; refocus.current = l.key }
    setLift(null)
    announce(`Not moved: ${name} is back in ${nameOf(l.from)}.`)
  }

  const onCardKey = (c: T) => (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.metaKey || e.ctrlKey) return
    const key = p.cardKey(c), name = p.cardName(c)
    if (lift === null) {
      if (e.key !== ' ') return
      e.preventDefault()
      const why = p.fixed?.(c)
      if (why !== undefined) { announce(`${name} can’t be moved: ${why}`); return }
      if (busy.current) return
      const from = p.columnOf(c)
      const fromAt = (byCol.get(from) ?? []).indexOf(c)
      setRefused(null)
      setLift({ key, from, fromAt, to: from, at: fromAt, by: 'keys' })
      announce(`Lifted ${name}: ${nameOf(from)}, ${fromAt + 1} of ${byCol.get(from)!.length}. Arrows move it, Space drops it, Escape cancels.`)
      return
    }
    if (lift.key !== key || lift.by !== 'keys') return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); putBack(lift, name, true); return }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      relocating.current = true
      refocus.current = key
      setLift(null)
      if (lift.to === lift.from) announce(`${name} stays in ${nameOf(lift.from)}.`)
      else void commit(c, lift.to)
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
      const ts = targets(lift.from)
      const i = ts.findIndex(t => t.id === lift.to) + ((e.key === 'ArrowRight') !== rtl ? 1 : -1)
      const to = ts[Math.max(0, Math.min(ts.length - 1, i))]!.id
      place({ ...lift, to, at: Math.min(lift.at, rest(to, key).length) }, name)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const at = Math.max(0, Math.min(rest(lift.to, key).length, lift.at + (e.key === 'ArrowDown' ? 1 : -1)))
      place({ ...lift, at }, name)
    }
  }

  const columnAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest('[data-column]') as HTMLElement | null)?.dataset.column ?? null
  const onDown = (c: T) => (e: PointerEvent<HTMLLIElement>) => {
    if (e.pointerType === 'touch' || lift !== null || busy.current || p.fixed?.(c) !== undefined) return
    if ((e.target as HTMLElement).closest('a, button, input, select, textarea')) return
    const r = e.currentTarget.getBoundingClientRect()
    const from = p.columnOf(c)
    press.current = { key: p.cardKey(c), pointerId: e.pointerId, x: e.clientX, y: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top,
      w: r.width, moved: false, from, fromAt: (byCol.get(from) ?? []).indexOf(c), to: from }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onMoveP = (e: PointerEvent<HTMLDivElement>) => {
    const d = press.current
    if (!d || e.pointerId !== d.pointerId) return
    if (!e.buttons) { endPress(); return }
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < SLOP) return
    d.moved = true
    setRefused(null)
    const over = columnAt(e.clientX, e.clientY)
    d.to = over !== null && targets(d.from).some(t => t.id === over) ? over : d.from
    setLift({ key: d.key, from: d.from, fromAt: d.fromAt, to: d.to, at: rest(d.to, d.key).length, by: 'pointer' })
    const box = root.current?.getBoundingClientRect()
    setFloat({ x: e.clientX - d.offX - (box?.left ?? 0), y: e.clientY - d.offY - (box?.top ?? 0), w: d.w })
  }
  const onUpP = (e: PointerEvent<HTMLDivElement>) => {
    const d = press.current
    if (!d || e.pointerId !== d.pointerId) return
    endPress()
    if (!d.moved) return
    const over = columnAt(e.clientX, e.clientY) ?? d.to
    const to = targets(d.from).some(t => t.id === over) ? over : d.from
    const c = cardBy.get(d.key)
    if (c !== undefined && to !== d.from) void commit(c, to)
  }

  const cardItem = (c: T) => {
    const key = p.cardKey(c)
    const staged = p.staged?.(c) ?? false
    const lifted = lift?.key === key
    const cls = ['kcard', staged && 'kcard-staged', lifted && (lift.by === 'keys' ? 'kcard-lift' : 'kcard-ghost'), moving === key && 'kcard-moving']
      .filter(Boolean).join(' ')
    const why = p.fixed?.(c)
    const from = p.columnOf(c)
    const items: MenuEntry[] = targets(from).map(t => ({
      type: 'radio', label: t.name, checked: t.id === from,
      unavailable: why ?? (moving !== null ? 'Moving…' : undefined),
      onSelect: () => { if (t.id !== from) void commit(c, t.id) },
    }))
    return (
      <li key={key} className={cls} data-card={key} tabIndex={canWrite ? 0 : undefined} aria-describedby={canWrite ? hint : undefined}
        aria-busy={moving === key ? true : undefined}
        onKeyDown={canWrite ? onCardKey(c) : undefined} onPointerDown={canWrite ? onDown(c) : undefined}
        onBlur={e => { if (lifted && lift.by === 'keys' && e.target === e.currentTarget && !relocating.current) putBack(lift, p.cardName(c), false) }}>
        {p.card(c)}
        {staged && <span><StatusMark mark="staged" label="Staged move" /></span>}
        {canWrite && (
          <span className="kmv">
            <Menu label={`Move to… ${p.cardName(c)}`} text={<span className="kmv-t">Move to…</span>} icon="more" items={items} />
          </span>
        )}
      </li>
    )
  }

  const liftedCard = lift ? cardBy.get(lift.key) : undefined
  const listOf = (col: BoardColumn): ReactNode[] => {
    const cards = byCol.get(col.id) ?? []
    if (!lift || !liftedCard) return cards.map(cardItem)
    if (lift.by === 'pointer') {
      const out = cards.map(cardItem)
      if (col.id === lift.to && lift.to !== lift.from) out.push(<li key="@drop" className="kdrop" aria-hidden="true" />)
      return out
    }
    if (lift.to === lift.from && lift.at === lift.fromAt) return cards.map(cardItem)
    const out = rest(col.id, lift.key).map(cardItem)
    const ghostHere = col.id === lift.from
    if (ghostHere) out.splice(lift.fromAt, 0, <li key="@ghost" className="kcard kcard-ghost" aria-hidden="true" inert>{p.card(liftedCard)}</li>)
    if (col.id === lift.to) out.splice(lift.at + (ghostHere && lift.fromAt <= lift.at ? 1 : 0), 0, cardItem(liftedCard))
    return out
  }

  return (
    <div className="kb" ref={root} role="group" aria-label={p.label}
      onPointerMove={onMoveP} onPointerUp={onUpP} onPointerCancel={endPress} onLostPointerCapture={endPress}>
      {canWrite && <p id={hint} className="sr-only">Space lifts the card, the arrows move it, Space drops it, Escape puts it back.</p>}
      <div className="kb-cols">
        {p.columns.map(col => (
          <div key={col.id} className="kcol" data-column={col.id}>
            <div className="kcol-h">
              {col.mark && <span className={`smark smark-${col.mark}`} aria-hidden="true"><span className="smark-shape" /></span>}
              <span className="kcol-n">{col.name}</span>
              <span className="kcol-c">{byCol.get(col.id)?.length ?? 0}</span>
              {canWrite && p.onNew && !col.locked && (
                <span className="kcol-new"><Button iconOnly small variant="ghost" icon="plus" label={`New in ${col.name}`} onClick={() => p.onNew!(col.id)} /></span>
              )}
            </div>
            <ul className="kcol-l" aria-label={col.name}>{listOf(col)}</ul>
          </div>
        ))}
      </div>
      {lift?.by === 'pointer' && float && liftedCard !== undefined && (
        <div className="kcard kcard-lift kcard-float" aria-hidden="true" inert style={{ left: float.x, top: float.y, inlineSize: float.w }}>
          {p.card(liftedCard)}
        </div>
      )}
      {refused !== null && <p className="note note-error kb-refused"><Icon name="alert" size="sm" /><span className="note-t">{refused}</span></p>}
    </div>
  )
}
