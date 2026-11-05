import { useEffect, useId, useImperativeHandle, useRef, type ReactNode, type Ref } from 'react'
import { Button } from './Button.tsx'

/** A modal confirmation (`<dialog>` opened with showModal): its title asks, its body says exactly what goes,
 *  and the confirm button names it ("Discard 3 changes") in ink, never clay (C-3). Cancel (or what `cancel`
 *  calls it: "Keep them") and Escape call onCancel; the caller removes the dialog. Focus starts on Cancel, the
 *  safe choice; when the caller removes it, focus goes back to what had it when it opened (L4a final review M-12).
 *  `ref` is the dialog, for a panel slot that closes it before focus goes back (panels.tsx);
 *  `inline` draws it open in place, not modal: a /parts specimen. `busy` ("Running…") holds the confirm button while
 *  what it started is in flight: it reads busy, stays focusable and swallows a press (C8 fix M-6).
 *  The same dialog is the house's sheet for a short form (design pass 2026-11-04: New board, Import from a sheet):
 *  `wide` gives it room and scrolls it within the viewport, `note` sits at the foot beside the buttons (where the
 *  result is saved), and `disabled` holds the confirm while there is nothing to confirm yet. */
export function ConfirmDialog({ title, body, confirm, cancel = 'Cancel', onConfirm, onCancel, inline = false, busy, ref, wide = false, note, disabled }:
  { title: string; body: ReactNode; confirm: string; cancel?: string; onConfirm: () => void; onCancel: () => void; inline?: boolean
    busy?: string; ref?: Ref<HTMLDialogElement>; wide?: boolean; note?: ReactNode; disabled?: boolean }) {
  const own = useRef<HTMLDialogElement>(null)
  useImperativeHandle(ref, () => own.current!, [])
  const titleId = useId()
  useEffect(() => {
    const d = own.current
    if (!d || inline) return
    // What had focus when it opened gets it back when the caller removes it, unless something else took it first
    // (a panel slot hands focus to its opener itself): a confirmation outside a slot must not drop focus on the body.
    const back = document.activeElement
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal() } else d.setAttribute('open', '')
    return () => {
      if (typeof d.close === 'function' && d.open) d.close()
      const at = document.activeElement
      if ((at === null || at === document.body) && back instanceof HTMLElement && back !== document.body && back.isConnected) back.focus()
    }
  }, [inline])
  return (
    <dialog ref={own} className={[inline ? 'dialog dialog-inline' : 'dialog popover', wide ? 'dialog-wide' : null].filter(Boolean).join(' ')}
      aria-labelledby={titleId} open={inline || undefined}
      onCancel={e => { e.preventDefault(); onCancel() }}>
      <h2 id={titleId} className="dialog-t">{title}</h2>
      <div className="dialog-b">{body}</div>
      <div className={note ? 'dialog-f dialog-f-note' : 'dialog-f'}>
        {note && <p className="dialog-note">{note}</p>}
        <Button onClick={onCancel}>{cancel}</Button>
        <Button primary busy={busy} disabled={disabled} onClick={onConfirm}>{confirm}</Button>
      </div>
    </dialog>
  )
}
