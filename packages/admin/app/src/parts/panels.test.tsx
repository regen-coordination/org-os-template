// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { PanelProvider, closeDialog, usePanel, useSlot, type Slot } from './panels.tsx'

function Opener({ slot, id }: { slot: Slot; id: string }) {
  const p = usePanel(slot)
  return <>
    <button type="button" onClick={e => p.open(id, e.currentTarget)}>open {slot}</button>
    <span data-testid={slot}>{p.openId ?? 'closed'}</span>
  </>
}
const app = () => render(<PanelProvider><Opener slot="bottom" id="tray" /><Opener slot="right" id="inspector" /><Opener slot="overlay" id="palette" /></PanelProvider>)
const state = (slot: Slot) => screen.getByTestId(slot).textContent

describe('panels', () => {
  it('holds one panel per slot; opening a slot again replaces what it shows', () => {
    render(<PanelProvider><Opener slot="right" id="a" /><Opener slot="right" id="b" /></PanelProvider>)
    fireEvent.click(screen.getAllByRole('button', { name: 'open right' })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: 'open right' })[1]!)
    expect(screen.getAllByTestId('right').map(e => e.textContent)).toEqual(['b', 'b'])
  })

  it('closes the top of the stack on each Escape: overlay, then right, then bottom (Review Focus 2)', () => {
    app()
    for (const s of ['bottom', 'right', 'overlay'] as Slot[]) fireEvent.click(screen.getByRole('button', { name: `open ${s}` }))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect([state('overlay'), state('right'), state('bottom')]).toEqual(['closed', 'inspector', 'tray'])
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect([state('right'), state('bottom')]).toEqual(['closed', 'tray'])
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(state('bottom')).toBe('closed')
  })

  it('leaves the right and bottom panels alone when something under them handled the Escape', () => {
    app()
    fireEvent.click(screen.getByRole('button', { name: 'open right' }))
    const editor = (e: KeyboardEvent) => { if (e.key === 'Escape') e.preventDefault() }
    document.addEventListener('keydown', editor, true)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    document.removeEventListener('keydown', editor, true)
    expect(state('right')).toBe('inspector')
  })

  it('returns focus to the opener, and does nothing when the opener has left the page (Review Focus 2)', () => {
    function Gone() {
      const p = usePanel('right')
      const [shown, setShown] = useState(true)
      return <>{shown && <button type="button" onClick={e => { p.open('x', e.currentTarget); setShown(false) }}>go</button>}<span>{p.openId ?? 'closed'}</span></>
    }
    const { unmount } = app()
    const opener = screen.getByRole('button', { name: 'open overlay' })
    fireEvent.click(opener)
    ;(document.body as HTMLElement).focus()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(document.activeElement).toBe(opener)
    unmount()
    render(<PanelProvider><Gone /></PanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    expect(() => fireEvent.keyDown(document.body, { key: 'Escape' })).not.toThrow()
    expect(screen.getByText('closed')).toBeTruthy()
  })

  it('useSlot keeps a component and its slot in step, and tells it when the slot was closed from outside', () => {
    let closedOutside = 0
    function Thing() {
      const [open, setOpen] = useState(false)
      useSlot('overlay', 'thing', open, () => { closedOutside++; setOpen(false) })
      const p = usePanel('overlay')
      return <><button type="button" onClick={() => setOpen(true)}>show</button><button type="button" onClick={() => setOpen(false)}>hide</button><span data-testid="slot">{p.openId ?? 'closed'}</span></>
    }
    render(<PanelProvider><Thing /></PanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'show' }))
    expect(screen.getByTestId('slot').textContent).toBe('thing')
    fireEvent.click(screen.getByRole('button', { name: 'hide' }))
    expect(screen.getByTestId('slot').textContent).toBe('closed')
    expect(closedOutside).toBe(0)
    fireEvent.click(screen.getByRole('button', { name: 'show' }))
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }) })
    expect(closedOutside).toBe(1)
  })

  // A11 review I-1: a modal dialog makes everything outside it inert, so a focus() on the opener while the dialog
  // is still modal does nothing (WebKit does not focus a tapped button, so nothing else puts it back). The slot
  // closes what it shows — `shut` — before it hands focus back, on every way of closing.
  it('useSlot shuts what the slot shows before focus returns to the opener, on Escape and when the component closes', () => {
    function Modal() {
      const [open, setOpen] = useState(false)
      const opener = useRef<HTMLButtonElement>(null)
      const dialog = useRef<HTMLDialogElement>(null)
      useSlot('overlay', 'modal', open, () => setOpen(false), () => opener.current, () => dialog.current?.removeAttribute('open'))
      return <>
        <button type="button" ref={opener} onClick={() => { dialog.current?.setAttribute('open', ''); setOpen(true) }}>open</button>
        <dialog ref={dialog} aria-label="Modal"><button type="button" onClick={() => setOpen(false)}>done</button></dialog>
      </>
    }
    render(<PanelProvider><Modal /></PanelProvider>)
    const opener = screen.getByRole('button', { name: 'open' })
    const dialog = screen.getByRole('dialog', { hidden: true })
    const openWhenFocused: boolean[] = []
    const focus = vi.spyOn(opener, 'focus').mockImplementation(function (this: HTMLElement) { openWhenFocused.push(dialog.hasAttribute('open')) })
    fireEvent.click(opener)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.click(opener)
    fireEvent.click(screen.getByRole('button', { name: 'done', hidden: true }))
    expect(focus).toHaveBeenCalledTimes(2)
    expect(openWhenFocused).toEqual([false, false])
  })

  it('closeDialog takes focus out of the dialog before closing it: a key that follows is not typed into it (A12 review)', () => {
    // A browser moves focus off a closed dialog's input only at its next rendering update; the palette's input kept
    // focus that long, and a `?` pressed after Esc was typing, not the key map.
    render(<dialog open aria-label="Palette"><input aria-label="Search" /></dialog>)
    const input = screen.getByLabelText('Search')
    input.focus()
    closeDialog(input.closest('dialog'))
    expect(input.closest('dialog')!.hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(document.body)
    // focus outside the dialog is left where it is
    render(<><button type="button">Outside</button><dialog open aria-label="Other"><input aria-label="Other field" /></dialog></>)
    const outside = screen.getByRole('button', { name: 'Outside' })
    outside.focus()
    closeDialog(screen.getByLabelText('Other field').closest('dialog'))
    expect(document.activeElement).toBe(outside)
  })

  it('closeIf closes a slot only while it shows that id (L4a final review I-1)', () => {
    function Both() {
      const p = usePanel('overlay')
      return <>
        <button type="button" onClick={e => p.open('more', e.currentTarget)}>more</button>
        <button type="button" onClick={() => p.closeIf('palette')}>not mine</button>
        <button type="button" onClick={() => p.closeIf('more')}>mine</button>
        <span data-testid="overlay">{p.openId ?? 'closed'}</span>
      </>
    }
    render(<PanelProvider><Both /></PanelProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'more' }))
    fireEvent.click(screen.getByRole('button', { name: 'not mine' }))
    expect(state('overlay')).toBe('more')
    fireEvent.click(screen.getByRole('button', { name: 'mine' }))
    expect(state('overlay')).toBe('closed')
  })

  it('a slot owner that unmounts while open leaves no ghost on the Escape stack (L4a final review I-1)', () => {
    function Sheet() { useSlot('overlay', 'more', true, () => {}); return <p>sheet</p> }
    function Host() {
      const [on, setOn] = useState(true)
      const p = usePanel('overlay')
      return <>{on && <Sheet />}<button type="button" onClick={() => setOn(false)}>widen</button><span data-testid="overlay">{p.openId ?? 'closed'}</span></>
    }
    render(<PanelProvider><Host /></PanelProvider>)
    expect(state('overlay')).toBe('more')
    fireEvent.click(screen.getByRole('button', { name: 'widen' }))
    expect(state('overlay')).toBe('closed')
    const heard = vi.fn()
    window.addEventListener('keydown', heard)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    window.removeEventListener('keydown', heard)
    expect(heard).toHaveBeenCalled()
  })

  it('an Escape inside an open menu is the menu’s, not the overlay’s (APG; L4a final review M-4)', () => {
    app()
    fireEvent.click(screen.getByRole('button', { name: 'open overlay' }))
    render(<div role="menu" aria-label="Signed in"><button type="button" role="menuitem">View as…</button></div>)
    const item = screen.getByRole('menuitem', { name: 'View as…' })
    fireEvent.keyDown(item, { key: 'Escape' })
    expect(state('overlay')).toBe('palette')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(state('overlay')).toBe('closed')
  })

  it('needs a provider', () => {
    function Bare() { usePanel('right'); return null }
    expect(() => render(<Bare />)).toThrow('usePanel needs a PanelProvider')
  })
})

describe('the live region and a modal dialog (E-92)', () => {
  it('is drawn inside the topmost open modal, where a screen reader can still reach it, and back in the page when it closes', async () => {
    const { announce } = await import('./live.tsx')
    render(<PanelProvider><p>page</p></PanelProvider>)
    const live = () => screen.getByTestId('live')
    expect(live().closest('dialog')).toBeNull()
    // a modal as the browser marks it (this DOM has no :modal): showModal sets `open`
    const dialog = document.createElement('dialog')
    dialog.matches = (s: string) => (s === ':modal' ? dialog.hasAttribute('open') : Element.prototype.matches.call(dialog, s))
    document.body.append(dialog)
    await act(async () => { dialog.setAttribute('open', '') })
    expect(live().closest('dialog')).toBe(dialog)
    act(() => announce('Said while the dialog is open.'))
    expect(live().textContent).toBe('Said while the dialog is open.')
    await act(async () => { dialog.removeAttribute('open') })
    expect(live().closest('dialog')).toBeNull()
    dialog.remove()
  })
})
