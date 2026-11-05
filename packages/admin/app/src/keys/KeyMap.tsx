import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Button } from '../design/Button.tsx'
import { Kbd } from '../design/Kbd.tsx'
import { closeDialog, useSlot } from '../parts/panels.tsx'
import { OPEN_KEYMAP } from './useHouseKeys.ts'

/** The key map's rows: §5.8's table, one row a key (or its alternatives, each a list of key caps). */
export const KEY_ROWS: readonly { does: string; keys: readonly (readonly string[])[] }[] = [
  { does: 'Home', keys: [['g', 'h']] },
  { does: 'Needs you', keys: [['g', 'n']] },
  { does: 'Proposals', keys: [['g', 'p']] },
  { does: 'Systems', keys: [['g', 's']] },
  { does: 'Roles', keys: [['g', 'r']] },
  { does: 'Treasury', keys: [['g', 't']] },
  { does: 'Workspace', keys: [['g', 'w']] },
  { does: 'Library', keys: [['g', 'l']] },
  { does: 'Changes', keys: [['g', 'c']] },
  { does: 'Public door, in a new tab', keys: [['g', 'd']] },
  { does: 'Palette', keys: [['⌘', 'K'], ['Ctrl', 'K']] },
  { does: 'Fold or unfold the sidebar', keys: [['⌘', '\\'], ['[']] },
  { does: 'Next or previous row', keys: [['j', 'k'], ['↓', '↑']] },
  { does: 'List · Map', keys: [['v']] },
  { does: 'New board, on Boards', keys: [['n']] },
  { does: 'Open the row', keys: [['↵']] },
  { does: 'Preview in the inspector', keys: [['space']] },
  { does: 'Close the top panel', keys: [['esc']] },
  { does: 'Comment on this page', keys: [['c']] },
]

/** The key map's head and table (§5.8), as the dialog draws it and as /parts draws it in place. A table: each row
 *  what it does, then its keys; alternatives are parted by a faint slash (read "or"). `close` ends the head. */
export function KeyTable({ headingId, close }: { headingId: string; close?: ReactNode }) {
  return (
    <>
      <div className="keymap-h">
        <h2 id={headingId} className="keymap-t">Keys</h2>
        <span className="keymap-hint"><Kbd>?</Kbd> shows this anywhere</span>
        {close}
      </div>
      {/* The roles are said outright: the stylesheet draws the table, its groups and rows as block, grid and flex,
          and WebKit drops a table's semantics for that (L4a final review M-15). */}
      <table className="keymap" role="table">
        <thead className="sr-only" role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Does</th><th scope="col" role="columnheader">Keys</th></tr></thead>
        <tbody role="rowgroup">
          {KEY_ROWS.map(r => (
            <tr key={r.does} role="row">
              <th scope="row" role="rowheader">{r.does}</th>
              <td role="cell">
                {r.keys.map((alt, i) => (
                  <Fragment key={i}>
                    {i > 0 && <><span className="keymap-or" aria-hidden="true">/</span><span className="sr-only"> or </span></>}
                    {alt.map(k => <Kbd key={k}>{k}</Kbd>)}
                  </Fragment>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/** The key map (§5.8): a modal `<dialog>` titled "Keys", opened by `?` (useHouseKeys) anywhere a field does not
 *  have focus; focus moves to its Close button. It is the panels' overlay slot, so the one Escape stack closes it
 *  and hands focus back to where it was; Close and a click on the scrim close it too. */
export function KeyMap() {
  const [open, setOpen] = useState(false)
  const opener = useRef<Element | null>(null)
  const ref = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  useSlot('overlay', 'keymap', open, () => setOpen(false), () => (opener.current instanceof HTMLElement ? opener.current : null),
    () => closeDialog(ref.current)) // closed before focus goes back: while modal, the opener is inert
  useEffect(() => {
    const ask = () => { opener.current = document.activeElement; setOpen(true) }
    window.addEventListener(OPEN_KEYMAP, ask)
    return () => window.removeEventListener(OPEN_KEYMAP, ask)
  }, [])
  useLayoutEffect(() => {
    const d = ref.current
    if (!open || !d) return
    if (!d.open) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '') }
    d.querySelector<HTMLElement>('button')?.focus()
  }, [open])
  if (!open) return null
  const scrim = (e: MouseEvent) => { if (e.target === e.currentTarget) setOpen(false) }
  return (
    <dialog ref={ref} className="pal-dialog" aria-labelledby={headingId} aria-modal="true"
      onCancel={e => { e.preventDefault(); setOpen(false) }} onMouseDown={scrim}>
      <div className="pal keymap-pop">
        <KeyTable headingId={headingId} close={<Button variant="ghost" icon="x" iconOnly label="Close" small onClick={() => setOpen(false)} />} />
      </div>
    </dialog>
  )
}
