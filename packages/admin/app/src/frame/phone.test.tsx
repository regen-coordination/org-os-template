// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { PhoneBar } from './PhoneBar.tsx'
import { BottomBar } from './BottomBar.tsx'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { Shell } from '../design/Shell.tsx'
import { Menu } from '../design/Menu.tsx'
import { renderAt } from '../test/render.tsx'
import { fakeAddress } from '../test/fixtures/house/org.ts'
import type { HouseCounts, Identity } from './sections.ts'

const ORG = { name: 'Example DAO', mark: null }
const WHO: Identity = { hatName: 'Council steward', address: fakeAddress(7), hatId: '13.1', hats: ['Council steward'] }
const COUNTS: HouseCounts = { needs: 3, proposals: 1, systems: 9, changes: 1 }

// jsdom has no PointerEvent: a MouseEvent with a pointer id carries clientY as the browser's does.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventStub extends MouseEvent {
    pointerId: number
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0 }
  }
  window.PointerEvent = PointerEventStub as unknown as typeof PointerEvent
}

// jsdom has <dialog> but not showModal/close: draw them as the browser does, enough to see open and closed.
const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void }
const before = { showModal: proto.showModal, close: proto.close }
beforeEach(() => {
  proto.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
  proto.close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open') })
})
afterEach(() => { proto.showModal = before.showModal; proto.close = before.close; vi.restoreAllMocks() })

const bar = () => <ViewAsProvider><BottomBar counts={COUNTS} identity={WHO} /></ViewAsProvider>
const bottom = () => screen.getByRole('navigation', { name: 'Hub' })
const more = () => within(bottom()).getByRole('button', { name: 'More' })
const openMore = () => { more().focus(); fireEvent.click(more()) }

describe('the phone bar (§5.4)', () => {
  it('holds the seal, the page title, View as (eye) and Search, each a 44px target', () => {
    const { container } = renderAt(<ViewAsProvider><PhoneBar org={ORG} title="Proposals" /></ViewAsProvider>)
    const top = container.querySelector('.ptop')!
    expect(top.querySelector('.side-seal')).not.toBeNull()
    expect(top.querySelector('.ptop-t')!.textContent).toBe('Proposals')
    const buttons = within(top as HTMLElement).getAllByRole('button')
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['View as', 'Search or jump'])
    for (const b of buttons) {
      expect(b.closest('.ptop-tools'), b.getAttribute('aria-label')!).not.toBeNull()
      expect(b.className).toContain('btn')
      expect(b.className).toContain('icon')
    }
    expect(buttons[0]!.querySelector('svg')!.getAttribute('class')).toContain('i')
  })

  it('View as shows the eye while previewing, too (§5.9: "on phone the eye icon")', () => {
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><PhoneBar org={ORG} title="Home" /></ViewAsProvider>)
    const eye = screen.getByRole('button', { name: 'View as' })
    renderAt(<ViewAsProvider><PhoneBar org={ORG} title="Home" /></ViewAsProvider>)
    const plain = screen.getAllByRole('button', { name: 'View as' })[1]!
    expect(eye.querySelector('svg')!.outerHTML).toBe(plain.querySelector('svg')!.outerHTML)
  })

  it('Search asks the palette to open', () => {
    const asked = vi.fn()
    window.addEventListener('open-palette', asked)
    renderAt(<ViewAsProvider><PhoneBar org={ORG} title="Home" /></ViewAsProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Search or jump' }))
    window.removeEventListener('open-palette', asked)
    expect(asked).toHaveBeenCalledTimes(1)
  })
})

describe('the bottom bar (§5.4, C-7)', () => {
  it('has five equal items: Home, Needs you, Proposals, Workspace, More', () => {
    renderAt(bar())
    const items = [...bottom().children]
    expect(items).toHaveLength(5)
    expect(items.map(i => i.querySelector('.bbar-l')!.textContent)).toEqual(['Home', 'Needs you', 'Proposals', 'Workspace', 'More'])
    for (const i of items) {
      expect(i.className.split(' ')).toContain('bbar-a')
      expect(i.querySelector('svg.i-lg')).not.toBeNull()
    }
    expect(within(bottom()).getAllByRole('link').map(a => a.getAttribute('href'))).toEqual(['/', '/needs', '/governance/proposals', '/workspace'])
  })

  it('Needs you’s badge shows the count, and its name carries it whole', () => {
    renderAt(<ViewAsProvider><BottomBar counts={{ ...COUNTS, needs: 120 }} identity={WHO} /></ViewAsProvider>)
    const needs = within(bottom()).getByRole('link', { name: 'Needs you, 120' })
    expect(needs.querySelector('.bbar-n')!.textContent).toBe('99+')
    expect(needs.querySelector('.bbar-n')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('the badge follows the label in the text, a word apart, so the visible words read as the name does (2.5.3)', () => {
    renderAt(<ViewAsProvider><BottomBar counts={{ ...COUNTS, needs: 3 }} identity={WHO} /></ViewAsProvider>)
    expect(within(bottom()).getByRole('link', { name: 'Needs you, 3' }).textContent).toBe('Needs you 3')
  })

  it('a zero count draws no badge', () => {
    renderAt(<ViewAsProvider><BottomBar counts={{ ...COUNTS, needs: 0 }} identity={WHO} /></ViewAsProvider>)
    expect(within(bottom()).getByRole('link', { name: 'Needs you' }).querySelector('.bbar-n')).toBeNull()
  })

  it('the current one has aria-current; on a page under More, More is drawn current', () => {
    renderAt(bar(), '/governance/decisions')
    const current = within(bottom()).getAllByRole('link').filter(a => a.getAttribute('aria-current') === 'page')
    expect(current.map(a => a.textContent)).toEqual(['Proposals'])
    expect(more().getAttribute('aria-current')).toBeNull()
    renderAt(bar(), '/library')
    const second = screen.getAllByRole('navigation', { name: 'Hub' })[1]!
    expect(within(second).getAllByRole('link').filter(a => a.getAttribute('aria-current'))).toEqual([])
    expect(within(second).getByRole('button', { name: 'More' }).getAttribute('aria-current')).toBe('true')
  })
})

describe('the More sheet (§5.4)', () => {
  it('is a modal dialog (showModal) listing Systems, Roles, Treasury, Library, Changes, Public door, View as…, then the identity', () => {
    renderAt(bar())
    expect(more().getAttribute('aria-haspopup')).toBe('dialog')
    openMore()
    const sheet = screen.getByRole('dialog', { name: 'More' })
    expect(sheet.tagName).toBe('DIALOG')
    expect(proto.showModal).toHaveBeenCalledTimes(1)
    expect(more().getAttribute('aria-expanded')).toBe('true')
    const rows = [...sheet.querySelectorAll('.sheet-a')].map(r => r.querySelector('.sheet-l')!.textContent)
    expect(rows).toEqual(['Systems', 'Roles', 'Treasury', 'Library', 'Changes', 'Public door', 'View as…'])
    expect(within(sheet).getByRole('link', { name: 'Systems, 9' }).getAttribute('href')).toBe('/systems')
    expect(within(sheet).getByRole('link', { name: 'Changes, 1' }).querySelector('.n')!.className).toBe('n accent')
    expect(within(sheet).getByRole('link', { name: /^Public door/ }).getAttribute('target')).toBe('_blank')
    expect(within(sheet).getByRole('button', { name: 'View as…, you' })).toBeTruthy()
    // each row's words apart, in the order its name says them (2.5.3)
    expect(within(sheet).getByRole('link', { name: 'Systems, 9' }).textContent).toBe('Systems 9')
    expect(within(sheet).getByRole('button', { name: 'View as…, you' }).textContent).toBe('View as… you')
    const who = sheet.querySelector('.sheet-who')!
    expect(who.compareDocumentPosition(sheet.querySelector('nav')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(who.textContent).toContain('Council steward')
    expect(who.querySelector('.who-w')!.className).toBe('who-w')
  })

  it('moves focus in; Esc closes it and focus returns to More', () => {
    renderAt(bar())
    openMore()
    const sheet = screen.getByRole('dialog', { name: 'More' })
    expect(sheet.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(sheet.hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(more())
    expect(more().getAttribute('aria-expanded')).toBe('false')
  })

  // A11 review I-1: while the sheet is modal, More is inert and focus() on it does nothing; the sheet must be
  // closed first on every way of closing, or a tapped More (WebKit does not focus it) never gets focus back.
  it('the sheet is closed before focus returns to More: Esc, the scrim, a drag', () => {
    renderAt(bar())
    const sheet = () => screen.getByRole('dialog', { hidden: true })
    const openWhenFocused: boolean[] = []
    const real = HTMLElement.prototype.focus
    vi.spyOn(more(), 'focus').mockImplementation(function (this: HTMLElement) { openWhenFocused.push(sheet().hasAttribute('open')); real.call(this) })
    fireEvent.click(more())
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.click(more())
    fireEvent.click(sheet())
    fireEvent.click(more())
    const grab = sheet().querySelector('.sheet-grab')!
    fireEvent.pointerDown(grab, { clientY: 500, pointerId: 1 })
    fireEvent.pointerUp(grab, { clientY: 600, pointerId: 1 })
    expect(openWhenFocused).toEqual([false, false, false])
    expect(document.activeElement).toBe(more())
  })

  it('the browser’s own cancel (Esc on the dialog) closes it the same way', () => {
    renderAt(bar())
    openMore()
    const sheet = screen.getByRole('dialog', { name: 'More' })
    fireEvent(sheet, new Event('cancel', { cancelable: true }))
    expect(sheet.hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(more())
  })

  it('a drag down past 80px closes it; a shorter one does not', () => {
    renderAt(bar())
    openMore()
    const sheet = screen.getByRole('dialog', { name: 'More' })
    const grab = sheet.querySelector('.sheet-grab')!
    fireEvent.pointerDown(grab, { clientY: 500, pointerId: 1 })
    fireEvent.pointerMove(grab, { clientY: 560, pointerId: 1 })
    fireEvent.pointerUp(grab, { clientY: 560, pointerId: 1 })
    expect(sheet.hasAttribute('open')).toBe(true)
    fireEvent.pointerDown(grab, { clientY: 500, pointerId: 1 })
    fireEvent.pointerMove(grab, { clientY: 590, pointerId: 1 })
    fireEvent.pointerUp(grab, { clientY: 590, pointerId: 1 })
    expect(sheet.hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(more())
  })

  it('a tap on the scrim (the dialog itself, outside its sheet) closes it', () => {
    renderAt(bar())
    openMore()
    const sheet = screen.getByRole('dialog', { name: 'More' })
    fireEvent.click(sheet.querySelector('.sheet-in')!)
    expect(sheet.hasAttribute('open')).toBe(true)
    fireEvent.click(sheet)
    expect(sheet.hasAttribute('open')).toBe(false)
  })

  it('following a link closes it', () => {
    const { loc } = renderAt(bar())
    openMore()
    const sheet = screen.getByRole('dialog', { name: 'More' })
    fireEvent.click(within(sheet).getByRole('link', { name: 'Library' }))
    expect(loc.history!.at(-1)).toBe('/library')
    expect(sheet.hasAttribute('open')).toBe(false)
  })

  it('View as… closes the sheet and opens the view-as menu', async () => {
    vi.useFakeTimers()
    try {
      renderAt(<ViewAsProvider><span data-view-as=""><button type="button" aria-haspopup="menu" onClick={() => { document.title = 'asked' }}>v</button></span><BottomBar counts={COUNTS} identity={WHO} /></ViewAsProvider>)
      openMore()
      fireEvent.click(screen.getByRole('button', { name: 'View as…, you' }))
      expect(screen.getByRole('dialog', { hidden: true }).hasAttribute('open')).toBe(false)
      act(() => { vi.runAllTimers() })
      expect(document.title).toBe('asked')
    } finally { vi.useRealTimers() }
  })

  it('the identity’s own View as… closes the sheet first, too', () => {
    vi.useFakeTimers()
    try {
      renderAt(bar())
      openMore()
      const sheet = screen.getByRole('dialog', { name: 'More' })
      fireEvent.click(within(sheet).getByRole('button', { name: /^Council steward/ }))
      fireEvent.click(within(sheet).getByRole('menuitem', { name: 'View as…' }))
      expect(sheet.hasAttribute('open')).toBe(false)
    } finally { vi.useRealTimers() }
  })

  it('is registered in the overlay slot: the panel stack’s Escape closes it before any other panel', () => {
    renderAt(bar())
    openMore()
    const heard = vi.fn()
    window.addEventListener('keydown', heard)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    window.removeEventListener('keydown', heard)
    expect(heard).not.toHaveBeenCalled() // the overlay slot took it in the capture phase
    expect(screen.getByRole('dialog', { hidden: true }).hasAttribute('open')).toBe(false)
  })

  it('a /parts specimen draws it open in place: not modal, and no slot', () => {
    renderAt(<ViewAsProvider><BottomBar counts={COUNTS} identity={WHO} shown /></ViewAsProvider>)
    const sheet = screen.getByRole('dialog', { name: 'More' })
    expect(sheet.hasAttribute('open')).toBe(true)
    expect(proto.showModal).not.toHaveBeenCalled()
    expect(more().getAttribute('aria-expanded')).toBe('true')
    const heard = vi.fn()
    window.addEventListener('keydown', heard)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    window.removeEventListener('keydown', heard)
    expect(heard).toHaveBeenCalled()
  })
})

describe('the More sheet at the edges (L4a final review)', () => {
  const frame = (width: number) => (
    <ViewAsProvider>
      <Shell title="Example DAO" width={width} nav={null} bottom={<BottomBar counts={COUNTS} identity={WHO} />}>
        <h1>Page</h1><Menu label="Page actions" text="Actions" items={[{ type: 'item', label: 'Rename', onSelect: () => {} }]} />
      </Shell>
    </ViewAsProvider>
  )

  it('I-1: widened past 760 with More open, the sheet leaves the slot: the next Esc closes an open menu', () => {
    const { rerender } = renderAt(frame(390))
    openMore()
    expect(screen.getByRole('dialog', { hidden: true }).hasAttribute('open')).toBe(true)
    rerender(frame(900))
    expect(screen.queryByRole('navigation', { name: 'Hub' })).toBeNull()
    const actions = screen.getByRole('button', { name: /actions/i })
    fireEvent.click(actions)
    const item = screen.getByRole('menuitem', { name: 'Rename' })
    expect(document.activeElement).toBe(item)
    fireEvent.keyDown(item, { key: 'Escape' })
    expect(screen.getByRole('menu', { hidden: true }).hasAttribute('hidden')).toBe(true)
    expect(document.activeElement).toBe(actions)
  })

  it('M-4: Esc in the identity’s menu inside the sheet closes the menu, not the sheet', () => {
    renderAt(bar())
    openMore()
    const sheet = screen.getByRole('dialog', { hidden: true })
    const who = within(sheet).getByRole('button', { name: /Council steward/ })
    fireEvent.click(who)
    const item = within(sheet).getAllByRole('menuitem')[0]!
    expect(document.activeElement).toBe(item)
    fireEvent.keyDown(item, { key: 'Escape' })
    expect(sheet.hasAttribute('open')).toBe(true)
    expect(document.activeElement).toBe(who)
    fireEvent.keyDown(who, { key: 'Escape' })
    expect(sheet.hasAttribute('open')).toBe(false)
  })
})
