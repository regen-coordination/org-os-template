import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import { Link } from 'wouter'
import { Icon } from '../design/Icon.tsx'
import { closeDialog, useSlot } from '../parts/panels.tsx'
import { openViewAs, useViewer, viewerWord } from '../viewAs/ViewAs.tsx'
import { Identity } from './Identity.tsx'
import { HOUSE_SECTIONS, countText, type HouseCounts, type Identity as Who, type SectionId } from './sections.ts'

/** The sections the bottom bar leaves to More (§5.4, C-7), in the house's order. */
export const UNDER_MORE: readonly SectionId[] = ['systems', 'roles', 'treasury', 'library', 'changes']

/** A drag down on the grab handle further than this closes the sheet (§5.4). */
const DRAG_CLOSE = 80

/** The More sheet (§5.4): a bottom sheet over the scrim, with a grab handle, listing Systems, Roles, Treasury,
 *  Library, Changes (with their counts), Public door ↗, View as… (who is viewed trailing it), then the signed-in
 *  identity, drawn whole. 44px rows, 16px labels. It is a modal `<dialog>` (showModal): focus moves in; Esc, a
 *  tap on the scrim, a followed link or a drag down past 80px closes it, and focus returns to More. It is the
 *  panels' `overlay` slot, so the Escape stack closes it first and hands focus back. `inline` draws it open in
 *  place, not modal and in no slot: a /parts specimen. */
export function MoreSheet({ id, open, onClose, opener, counts, identity, current, inline = false }: {
  id: string; open: boolean; onClose(): void; opener: RefObject<HTMLElement | null>; counts: HouseCounts; identity: Who
  current: SectionId | null; inline?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const { viewer } = useViewer()
  // The slot shuts the dialog before it hands focus back to More: while the sheet is modal More is inert.
  useSlot('overlay', 'more', open && !inline, onClose, () => opener.current, () => closeDialog(ref.current))

  useEffect(() => {
    const d = ref.current
    if (!d || inline) return
    if (open) {
      if (!d.open) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '') }
      d.querySelector<HTMLElement>('a[href], button')?.focus()
    } else closeDialog(d)
  }, [open, inline])

  // The drag (§5.4): the sheet follows the pointer down from the grab handle; let go past 80px and it closes. The
  // keyboard's way is Esc, a single pointer's a tap on the scrim.
  const from = useRef<number | null>(null)
  const [dy, setDy] = useState(0)
  const grab = (e: PointerEvent<HTMLDivElement>) => { from.current = e.clientY; e.currentTarget.setPointerCapture?.(e.pointerId) }
  const drag = (e: PointerEvent<HTMLDivElement>) => { if (from.current !== null) setDy(Math.max(0, e.clientY - from.current)) }
  const drop = (e: PointerEvent<HTMLDivElement>) => {
    if (from.current === null) return
    const moved = e.clientY - from.current
    from.current = null
    setDy(0)
    if (moved > DRAG_CLOSE) onClose()
  }

  // A tap on the dialog itself is a tap on its backdrop: the sheet's content fills the dialog.
  const scrim = (e: MouseEvent) => { if (e.target === e.currentTarget) onClose() }
  const followed = (e: MouseEvent) => { if ((e.target as HTMLElement).closest('a')) onClose() }
  // View as… (the row, or the identity's menu): the sheet closes, then the phone bar's eye opens its menu.
  const viewAs = () => { onClose(); openViewAs() }

  return (
    <>
      {inline && <div className="sheet-scrim" aria-hidden="true" />}
      <dialog ref={ref} id={id} className={inline ? 'sheet sheet-inline' : 'sheet'} aria-label="More" open={inline || undefined}
        onCancel={e => { e.preventDefault(); onClose() }} onClick={scrim}
        style={dy > 0 ? { transform: `translateY(${dy}px)` } : undefined}>
        <div className="sheet-in">
          <div className="sheet-grab" aria-hidden="true" onPointerDown={grab} onPointerMove={drag} onPointerUp={drop} onPointerCancel={drop} />
          <nav className="sheet-nav" aria-label="More" onClick={followed}>
            {UNDER_MORE.map(sid => {
              const s = HOUSE_SECTIONS.find(x => x.id === sid)!
              const n = sid === 'systems' ? counts.systems : sid === 'changes' ? counts.changes : 0
              const text = countText(n)
              return (
                <Link key={sid} href={s.href} className="sheet-a" aria-current={current === sid ? 'page' : undefined}
                  aria-label={text ? `${s.label}, ${n}` : undefined}>
                  <Icon name={s.icon} /><span className="sheet-l">{s.label}</span>
                  {/* a space the flex row does not draw: the visible words read "Systems 9", as the name (2.5.3) */}
                  {text && <>{' '}<span className={sid === 'changes' ? 'n accent' : 'n'}>{text}</span></>}
                </Link>
              )
            })}
            <a className="sheet-a" href="/door" target="_blank" rel="noopener noreferrer">
              <Icon name="globe" /><span className="sheet-l">Public door</span><span className="sr-only"> (opens in a new tab)</span>
              <Icon name="external" size="xs" />
            </a>
            <button type="button" className="sheet-a" aria-label={`View as…, ${viewerWord(viewer)}`} onClick={viewAs}>
              <Icon name="eye" /><span className="sheet-l">View as…</span>{' '}<span className="n">{viewerWord(viewer)}</span>
            </button>
          </nav>
          <div className="sheet-who"><Identity who={identity} full onViewAs={viewAs} /></div>
        </div>
      </dialog>
    </>
  )
}
