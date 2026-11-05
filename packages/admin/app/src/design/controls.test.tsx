// @vitest-environment jsdom
// The controls of spec §7.1–7.4: buttons, inputs, segmented, tabs, menu, tooltip, kbd, notes, and the
// confirm dialog — their roles, keys and states — and the stylesheet rules that draw them (controls.css).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRef, useState } from 'react'
import { useLocation } from 'wouter'
import { renderAt } from '../test/render.tsx'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Button, ButtonLink } from './Button.tsx'
import { Tabs } from './Tabs.tsx'
import { Seg } from './Seg.tsx'
import { Menu, type MenuEntry } from './Menu.tsx'
import { Tooltip } from './Tooltip.tsx'
import { Kbd } from './Kbd.tsx'
import { NoteBlock } from './Note.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { NumberInput, SelectInput, TextInput, DateInput } from './inputs/index.ts'
import { Stepper } from './inputs/Stepper.tsx'
import { Choice } from './inputs/Choice.tsx'

afterEach(() => { vi.useRealTimers() })

describe('Button (§7.1)', () => {
  it('`primary` and `variant="primary"` draw the same', () => {
    render(<><Button primary>Propose</Button><Button variant="primary">Approve</Button></>)
    expect(screen.getByRole('button', { name: 'Propose' }).className).toBe(screen.getByRole('button', { name: 'Approve' }).className)
    expect(screen.getByRole('button', { name: 'Propose' }).classList.contains('primary')).toBe(true)
  })

  it('secondary and ghost carry their class; secondary is the default', () => {
    render(<><Button>Review</Button><Button variant="secondary">Back</Button><Button variant="ghost">Show payload</Button></>)
    expect(screen.getByRole('button', { name: 'Review' }).className).toBe('btn secondary')
    expect(screen.getByRole('button', { name: 'Back' }).className).toBe('btn secondary')
    expect(screen.getByRole('button', { name: 'Show payload' }).className).toBe('btn ghost')
  })

  it('a leading icon is 14px and aria-hidden, and the button says so in its class', () => {
    render(<Button icon="external">Open in Safe</Button>)
    const b = screen.getByRole('button', { name: 'Open in Safe' })
    expect(b.classList.contains('has-ico')).toBe(true)
    expect(b.querySelector('svg.i.i-sm[aria-hidden="true"]')).not.toBeNull()
  })

  it('busy keeps focus, shows the -ing label and aria-busy, and ignores clicks', () => {
    const onClick = vi.fn()
    const { rerender } = render(<Button primary icon="check" onClick={onClick}>Propose</Button>)
    const b = screen.getByRole('button', { name: 'Propose' })
    b.focus()
    rerender(<Button primary icon="check" busy="Proposing…" onClick={onClick}>Propose</Button>)
    expect(document.activeElement).toBe(b)
    expect(b.getAttribute('aria-busy')).toBe('true')
    expect(b.hasAttribute('disabled')).toBe(false)
    expect(b.textContent).toBe('Proposing…')
    expect(b.querySelector('.spin[aria-hidden="true"]')).not.toBeNull()
    expect(b.querySelector('svg.i')).toBeNull() // the spinner replaces the leading icon
    fireEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('unavailable is aria-disabled with its reason as description, and ignores clicks', () => {
    const onClick = vi.fn()
    render(<Button unavailable="Only the author can withdraw" onClick={onClick}>Withdraw</Button>)
    const b = screen.getByRole('button', { name: 'Withdraw' })
    expect(b.getAttribute('aria-disabled')).toBe('true')
    expect(b.hasAttribute('disabled')).toBe(false)
    const ids = (b.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
    expect(ids.map(id => document.getElementById(id)?.textContent)).toContain('Only the author can withdraw')
    fireEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps a caller’s describedby beside the reason', () => {
    render(<><p id="why">why</p><Button unavailable="Not yours" describedby="why">Withdraw</Button></>)
    const ids = screen.getByRole('button', { name: 'Withdraw' }).getAttribute('aria-describedby')!.split(' ')
    expect(ids[0]).toBe('why')
    expect(ids).toHaveLength(2)
  })

  it('icon-only has its label as name and draws no text', () => {
    render(<><Button icon="copy" iconOnly label="Copy" /><Button icon="more" iconOnly variant="ghost">More</Button></>)
    const copy = screen.getByRole('button', { name: 'Copy' })
    expect(copy.className).toBe('btn secondary icon')
    expect(copy.textContent).toBe('')
    expect(screen.getByRole('button', { name: 'More' }).textContent).toBe('')
  })

  it('small carries its class', () => {
    render(<Button small>Remove</Button>)
    expect(screen.getByRole('button', { name: 'Remove' }).classList.contains('sm')).toBe(true)
  })

  it('ButtonLink external opens a new tab and says "(opens in a new tab)" in its name', () => {
    render(<><ButtonLink href="https://app.safe.global/x" external>Open in Safe</ButtonLink><ButtonLink href="/r/project/p1" variant="ghost">Open record</ButtonLink></>)
    const a = screen.getByRole('link', { name: 'Open in Safe (opens in a new tab)' })
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.className).toBe('btn secondary has-ico')
    expect(screen.getByRole('link', { name: 'Open record' }).className).toBe('btn ghost')
  })
})

describe('Tabs (§7.3)', () => {
  const tabs = [{ id: 'open', label: 'Open', count: 1 }, { id: 'decided', label: 'Decided', count: 14 }, { id: 'rules', label: 'Rules' }] as const
  const Harness = ({ onChange }: { onChange: (t: string) => void }) => {
    return <Tabs label="Proposals" tabs={[...tabs]} value="open" onChange={onChange} />
  }

  it('is a tablist; the count follows the label in its own span', () => {
    render(<Harness onChange={() => {}} />)
    expect(screen.getByRole('tablist', { name: 'Proposals' })).toBeTruthy()
    const open = screen.getByRole('tab', { name: 'Open 1' })
    expect(open.getAttribute('aria-selected')).toBe('true')
    expect(open.querySelector('.cnt')!.textContent).toBe('1')
    expect(open.firstChild!.textContent).toBe('Open')
    expect(screen.getByRole('tab', { name: 'Rules' }).querySelector('.cnt')).toBeNull()
  })

  it('ArrowRight/ArrowLeft move and select (automatic activation), Home/End, and wrap', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const open = screen.getByRole('tab', { name: 'Open 1' })
    fireEvent.keyDown(open, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('decided')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Decided 14' }))
    fireEvent.keyDown(open, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('rules') // wraps
    fireEvent.keyDown(open, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('rules')
    fireEvent.keyDown(open, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('open')
    expect(open.getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('tab', { name: 'Rules' }).getAttribute('tabindex')).toBe('-1')
  })
})

describe('Tabs with href (L4a final review M-14)', () => {
  const LINKS = [
    { id: 'proposals', label: 'Proposals', href: '/governance/proposals' }, { id: 'decisions', label: 'Decisions', href: '/governance/decisions' },
    { id: 'rules', label: 'Rules', href: '/governance/rules' },
  ] as const
  /** As the Proposals page does: the chosen tab is the one at the location; onChange does not navigate. */
  function Linked() {
    const [path] = useLocation()
    const value = LINKS.find(t => t.href === path)?.id ?? 'proposals'
    return <Tabs label="Governance" tabs={[...LINKS]} value={value} onChange={() => {}} />
  }

  it('the arrows follow the tab’s link, so the next arrow moves on from the new tab', () => {
    const { loc } = renderAt(<Linked />, '/governance/proposals')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Proposals' }), { key: 'ArrowRight' })
    expect(loc.history.at(-1)).toBe('/governance/decisions')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Decisions' }))
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Decisions' }), { key: 'ArrowRight' })
    expect(loc.history.at(-1)).toBe('/governance/rules')
    expect(screen.getByRole('tab', { name: 'Rules' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('Seg (§7.3)', () => {
  it('is a group of aria-pressed buttons; arrows move within', () => {
    const onChange = vi.fn()
    render(<Seg label="View" value="list" onChange={onChange} icons={{ list: 'list', map: 'map' }}
      options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} />)
    const group = screen.getByRole('group', { name: 'View' })
    const list = screen.getByRole('button', { name: 'List' })
    const map = screen.getByRole('button', { name: 'Map' })
    expect(list.getAttribute('aria-pressed')).toBe('true')
    expect(map.getAttribute('aria-pressed')).toBe('false')
    expect(group.querySelectorAll('svg.i.i-sm')).toHaveLength(2)
    expect(group.querySelector('.seg-sep')).toBeNull()
    list.focus()
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(map)
    fireEvent.keyDown(map, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(list)
    fireEvent.keyDown(list, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(map)
    fireEvent.click(map)
    expect(onChange).toHaveBeenCalledWith('map')
  })
})

describe('Menu (§7.3)', () => {
  const items = (spy: (what: string) => void): MenuEntry[] => [
    { type: 'header', label: 'Who can see this page' },
    { type: 'radio', label: 'Public', checked: false, icon: 'globe', hint: 'propose', onSelect: () => spy('public') },
    { type: 'radio', label: 'Members', checked: true, icon: 'members', onSelect: () => spy('members') },
    { type: 'separator' },
    { type: 'item', label: 'Hat: Treasurer', icon: 'lock', unavailable: 'you don’t wear it', onSelect: () => spy('treasurer') },
    { type: 'link', label: 'About visibility', href: 'https://example.org/visibility', external: true },
  ]

  it('a face with no text is named by its label (L4a final review M-8)', () => {
    render(<Menu label="View as" face="viewas" icon="eye" items={items(() => {})} />)
    expect(screen.getByRole('button', { name: 'View as' }).className).toBe('viewas')
  })

  it('a button opens a menu; ArrowDown moves; Esc closes and returns focus to the button', () => {
    render(<Menu label="Visibility" text="Members" items={items(() => {})} />)
    const btn = screen.getByRole('button', { name: 'Visibility' })
    expect(btn.getAttribute('aria-haspopup')).toBe('menu')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    const menu = screen.getByRole('menu', { name: 'Visibility' })
    expect(btn.getAttribute('aria-controls')).toBe(menu.id)
    // focus starts on the checked radio
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Members' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Hat: Treasurer/ }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /About visibility/ }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /Public/ })) // wraps
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /About visibility/ }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(btn)
  })

  it('radio items are menuitemradio with aria-checked; choosing one fires, closes and returns focus', () => {
    const spy = vi.fn()
    render(<Menu label="Visibility" items={items(spy)} />)
    const btn = screen.getByRole('button', { name: 'Visibility' })
    fireEvent.click(btn)
    expect(screen.getByRole('menuitemradio', { name: 'Members' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: /Public/ }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Public/ }))
    expect(spy).toHaveBeenCalledWith('public')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  it('an unavailable item stays visible, aria-disabled, shows its reason, and does not fire', () => {
    const spy = vi.fn()
    render(<Menu label="Visibility" items={items(spy)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Visibility' }))
    const t = screen.getByRole('menuitem', { name: /Hat: Treasurer/ })
    expect(t.getAttribute('aria-disabled')).toBe('true')
    expect(t.textContent).toContain('you don’t wear it')
    const desc = document.getElementById(t.getAttribute('aria-describedby')!)
    expect(desc?.textContent).toBe('you don’t wear it')
    fireEvent.click(t)
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('groups the items under a header, draws separators, and links open in a new tab when external', () => {
    render(<Menu label="Visibility" items={items(() => {})} />)
    fireEvent.click(screen.getByRole('button', { name: 'Visibility' }))
    expect(screen.getByRole('group', { name: 'Who can see this page' })).toBeTruthy()
    expect(screen.getByRole('separator')).toBeTruthy()
    const link = screen.getByRole('menuitem', { name: 'About visibility (opens in a new tab)' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('draws the more glyph when it has no text, and an icon with its text when it has both', () => {
    render(<><Menu label="More actions" items={[]} /><Menu label="View as" icon="eye" text="You" items={[]} /></>)
    const more = screen.getByRole('button', { name: 'More actions' })
    expect(more.textContent).toBe('')
    expect(more.querySelector('svg.i')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'View as' }).textContent).toBe('You')
  })

  it('with a face, its trigger is a plain button of that class — glyph, text, chevron — named by its text, the menu by its label', () => {
    render(<Menu label="View as" face="viewas" icon="eye" text="View as: you" items={items(() => {})} />)
    const b = screen.getByRole('button', { name: 'View as: you' })
    expect(b.className).toBe('viewas')
    expect(b.querySelectorAll('svg.i')).toHaveLength(2)
    expect(b.querySelector('svg.i-xs')).toBe(b.lastElementChild) // the chevron trails
    expect(b.getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.click(b)
    expect(b.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menu', { name: 'View as' })).toBeTruthy()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(b)
  })

  it('children still render as in 0.6 (L4-R4): a labelled group, closed by a choice', () => {
    const pick = vi.fn()
    render(<Menu label="More actions"><Button onClick={pick}>Delete</Button></Menu>)
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('group', { name: 'More actions' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(pick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })
})

describe('Tooltip (§7.3)', () => {
  it('shows after 400 ms on hover and on focus, Esc hides it, aria-describedby links it', () => {
    vi.useFakeTimers()
    render(<Tooltip text="eip155:42220:0x5D0B…8a5C · click to copy"><button type="button">0x5D0B…8a5C</button></Tooltip>)
    const b = screen.getByRole('button', { name: '0x5D0B…8a5C' })
    const tip = document.getElementById(b.getAttribute('aria-describedby')!)!
    expect(tip.getAttribute('role')).toBe('tooltip')
    expect(tip.textContent).toBe('eip155:42220:0x5D0B…8a5C · click to copy')
    expect(tip.hidden).toBe(true)
    fireEvent.mouseEnter(b)
    act(() => { vi.advanceTimersByTime(399) })
    expect(tip.hidden).toBe(true)
    act(() => { vi.advanceTimersByTime(1) })
    expect(tip.hidden).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(tip.hidden).toBe(true)
    fireEvent.mouseLeave(b)
    fireEvent.focus(b)
    act(() => { vi.advanceTimersByTime(400) })
    expect(tip.hidden).toBe(false)
    fireEvent.blur(b)
    expect(tip.hidden).toBe(true)
  })

  it('keeps the child’s own handlers and description', () => {
    vi.useFakeTimers()
    const onFocus = vi.fn()
    render(<><p id="own">own</p><Tooltip text="tip"><button type="button" aria-describedby="own" onFocus={onFocus}>b</button></Tooltip></>)
    const b = screen.getByRole('button', { name: 'b' })
    fireEvent.focus(b)
    expect(onFocus).toHaveBeenCalled()
    expect(b.getAttribute('aria-describedby')!.split(' ')[0]).toBe('own')
  })
})

describe('Kbd', () => {
  it('renders <kbd>', () => {
    const { container } = render(<Kbd>⌘</Kbd>)
    expect(container.querySelector('kbd')!.textContent).toBe('⌘')
  })
})

describe('Inputs (§7.2)', () => {
  it('every input carries the house class, and mono when asked', () => {
    const { container } = render(<>
      <TextInput common={{ id: 'a' }} prose={false} value="x" readOnly={false} onChange={() => {}} />
      <NumberInput common={{ id: 'b' }} value={4} onChange={() => {}} mono />
      <SelectInput common={{ id: 'c' }} options={['a']} value="a" onChange={() => {}} />
      <DateInput common={{ id: 'd' }} value={null} onChange={() => {}} onProblem={() => {}} />
    </>)
    for (const id of ['a', 'b', 'c', 'd']) expect(container.querySelector(`#${id}`)!.classList.contains('input')).toBe(true)
    expect(container.querySelector('#b')!.classList.contains('mono-in')).toBe(true)
    expect(container.querySelector('#a')!.classList.contains('mono-in')).toBe(false)
  })

  it('invalid input has aria-invalid and aria-describedby to a message with the alert glyph', () => {
    render(<TextInput common={{ id: 'amt' }} prose={false} value="1.271,00" readOnly={false} onChange={() => {}} mono error="Use a dot for decimals: 1271.00" />)
    const input = screen.getByRole('textbox')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const msg = document.getElementById(input.getAttribute('aria-describedby')!)!
    expect(msg.textContent).toBe('Use a dot for decimals: 1271.00')
    expect(msg.className).toBe('err-msg')
    expect(msg.querySelector('svg.i[aria-hidden="true"]')).not.toBeNull()
  })

  it('keeps a caller’s describedby, and the error after it', () => {
    render(<><p id="hint">hint</p><NumberInput common={{ id: 'n', 'aria-describedby': 'hint' }} value={4} onChange={() => {}} error="Too many" /></>)
    const ids = screen.getByRole('spinbutton').getAttribute('aria-describedby')!.split(' ')
    expect(ids[0]).toBe('hint')
    expect(document.getElementById(ids[1]!)!.textContent).toBe('Too many')
  })

  it('a staged field shows the old value struck under the input', () => {
    const { container } = render(<TextInput common={{ id: 't' }} prose={false} value="Return the pools to the treasury" readOnly={false} onChange={() => {}} staged={{ was: 'Return the Gardens pools' }} />)
    const was = container.querySelector('s.was')!
    expect(was.textContent).toBe('Return the Gardens pools')
    expect(container.querySelector('#t')!.compareDocumentPosition(was) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('an input with none of the new props renders alone, as in 0.6', () => {
    const { container } = render(<NumberInput common={{ id: 'n' }} value={3} onChange={() => {}} />)
    expect(container.children).toHaveLength(1)
    expect(container.firstElementChild!.tagName).toBe('INPUT')
  })

  it('Stepper clamps within min..max and reads "of 8"', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Stepper value={4} min={1} max={8} of={8} label="Threshold" onChange={onChange} />)
    expect(screen.getByRole('group', { name: 'Threshold' }).textContent).toContain('of 8')
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(onChange).toHaveBeenLastCalledWith(5)
    fireEvent.click(screen.getByRole('button', { name: 'Fewer' }))
    expect(onChange).toHaveBeenLastCalledWith(3)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Threshold' }), { target: { value: '12' } })
    expect(onChange).toHaveBeenLastCalledWith(8)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Threshold' }), { target: { value: '0' } })
    expect(onChange).toHaveBeenLastCalledWith(1)
    rerender(<Stepper value={8} min={1} max={8} of={8} label="Threshold" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-disabled')).toBe('true')
    rerender(<Stepper value={1} min={1} max={8} label="Threshold" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Fewer' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('Stepper keeps focus on + at its limit and says why it stops; the input is described by "of N" (L4a final review M-13)', () => {
    function Held() {
      const [n, setN] = useState(7)
      return <Stepper value={n} min={1} max={8} of={8} label="Threshold" onChange={setN} />
    }
    render(<Held />)
    const more = screen.getByRole('button', { name: 'More' })
    more.focus()
    fireEvent.click(more)
    expect((screen.getByRole('spinbutton', { name: 'Threshold' }) as HTMLInputElement).value).toBe('8')
    expect(document.activeElement).toBe(more)
    expect(more.getAttribute('aria-disabled')).toBe('true')
    expect((more as HTMLButtonElement).disabled).toBe(false)
    const described = (el: HTMLElement) => el.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)!.textContent).join(' ')
    expect(described(more)).toBe('No more than 8')
    fireEvent.click(more)
    expect((screen.getByRole('spinbutton', { name: 'Threshold' }) as HTMLInputElement).value).toBe('8')
    expect(described(screen.getByRole('spinbutton', { name: 'Threshold' }))).toBe('of 8')
    expect(screen.getByRole('button', { name: 'Fewer' }).getAttribute('aria-disabled')).toBeNull()
  })

  it('Choice card is a radio input inside a label; checkbox and radio are native inputs', () => {
    const onChange = vi.fn()
    const { container } = render(<>
      <Choice type="card" name="signers" checked label="A new “Signers” hat" hint="Three wearers to start" onChange={onChange} />
      <Choice type="checkbox" checked={false} label="Remember this browser" onChange={onChange} />
      <Choice type="radio" name="r" checked={false} label="Fixed addresses" onChange={onChange} />
    </>)
    const card = screen.getByRole('radio', { name: /A new “Signers” hat/ }) as HTMLInputElement
    expect(card.tagName).toBe('INPUT')
    expect(card.checked).toBe(true)
    expect(card.closest('label')!.classList.contains('choice-card')).toBe(true)
    expect(card.closest('label')!.textContent).toContain('Three wearers to start')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remember this browser' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('radio', { name: 'Fixed addresses' }) as HTMLInputElement).type).toBe('radio')
    expect(container.querySelectorAll('label')).toHaveLength(3)
  })
})

describe('NoteBlock and ConfirmDialog', () => {
  it('NoteBlock: one ink line, one faint line, at most one action', () => {
    const { container } = render(<NoteBlock title="Nothing waits on you." line="9 Systems read 4 min ago, none failing." action={<a href="/systems">See Systems</a>} />)
    const block = container.querySelector('.note-block')!
    expect(block.querySelector('.note-block-t')!.textContent).toBe('Nothing waits on you.')
    expect(block.querySelector('.note-block-l')!.textContent).toBe('9 Systems read 4 min ago, none failing.')
    expect(block.querySelectorAll('a')).toHaveLength(1)
  })

  it('ConfirmDialog: a <dialog> opened with showModal; Cancel and Esc call onCancel; the confirm button names what goes', () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
    const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void }
    const before = proto.showModal
    proto.showModal = showModal
    try {
      const onCancel = vi.fn(), onConfirm = vi.fn()
      const { container } = render(<ConfirmDialog title="Discard 3 changes?" body="The three staged edits to the treasury go; nothing on the trunk changes." confirm="Discard 3 changes" onConfirm={onConfirm} onCancel={onCancel} />)
      const dialog = container.querySelector('dialog')!
      expect(showModal).toHaveBeenCalledTimes(1)
      expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
      expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('Discard 3 changes?')
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onCancel).toHaveBeenCalledTimes(1)
      fireEvent(dialog, new Event('cancel', { cancelable: true }))
      expect(onCancel).toHaveBeenCalledTimes(2)
      const confirm = screen.getByRole('button', { name: 'Discard 3 changes' })
      expect(confirm.classList.contains('primary')).toBe(true)
      fireEvent.click(confirm)
      expect(onConfirm).toHaveBeenCalledTimes(1)
    } finally { proto.showModal = before }
  })

  it('ConfirmDialog gives focus back to what was focused when it opened, when its caller removes it (L4a final review M-12)', () => {
    const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void }
    const before = { showModal: proto.showModal, close: proto.close }
    proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', '') }
    proto.close = function (this: HTMLDialogElement) { this.removeAttribute('open') }
    try {
      function Caller() {
        const [asking, setAsking] = useState(false)
        return <>
          <button type="button" onClick={() => setAsking(true)}>Remove signer</button>
          {asking && <ConfirmDialog title="Remove this signer?" body="The signer leaves the Safe." confirm="Remove signer" onConfirm={() => setAsking(false)} onCancel={() => setAsking(false)} />}
        </>
      }
      render(<Caller />)
      const opener = screen.getByRole('button', { name: 'Remove signer' })
      opener.focus()
      fireEvent.click(opener)
      const cancel = screen.getByRole('button', { name: 'Cancel' })
      cancel.focus()
      act(() => { fireEvent.click(cancel) })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(opener)
    } finally { proto.showModal = before.showModal; proto.close = before.close }
  })

  it('ConfirmDialog: names its cancel ("Keep them"), hands its dialog to a ref, and `inline` draws it open in place, not modal', () => {
    const showModal = vi.fn()
    const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void }
    const before = proto.showModal
    proto.showModal = showModal
    try {
      const ref = createRef<HTMLDialogElement>()
      const { container } = render(<ConfirmDialog ref={ref} inline title="Discard 3 staged ops?" body="They exist only in your change." confirm="Discard" cancel="Keep them" onConfirm={() => {}} onCancel={() => {}} />)
      const dialog = container.querySelector('dialog')!
      expect(ref.current).toBe(dialog)
      expect(showModal).not.toHaveBeenCalled()
      expect(dialog.hasAttribute('open')).toBe(true)
      expect(dialog.className).toBe('dialog dialog-inline')
      expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Keep them', 'Discard'])
    } finally { proto.showModal = before }
  })
})

/* ---------------------------------------------------------------- the stylesheet */

const here = (f: string) => fileURLToPath(new URL(f, import.meta.url))
const controls = readFileSync(here('./css/controls.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
/** Every rule as [selector, body, the at-rule conditions around it]. Nesting is one or two levels deep. */
function rules(css: string): { sel: string; body: string; at: string[] }[] {
  const out: { sel: string; body: string; at: string[] }[] = []
  const walk = (text: string, at: string[]) => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      if (open < 0) break
      const head = text.slice(i, open).trim()
      let depth = 1, j = open + 1
      while (j < text.length && depth > 0) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++ }
      const inner = text.slice(open + 1, j - 1)
      if (head.startsWith('@')) walk(inner, [...at, head])
      else out.push({ sel: head, body: inner.trim(), at })
      i = j
    }
  }
  walk(css, [])
  return out
}
const all = rules(controls)

describe('controls.css', () => {
  it('hover fills sit under @media (hover: hover)', () => {
    const hovers = all.filter(r => r.sel.includes(':hover'))
    expect(hovers.length).toBeGreaterThan(3)
    for (const r of hovers) expect(r.at, r.sel).toContain('@media (hover: hover)')
  })

  it('press scale uses var(--press-scale) and excludes :disabled and [aria-disabled=true]', () => {
    const press = all.filter(r => /scale:\s*var\(--press-scale\)/.test(r.body) && r.sel.includes(':active'))
    expect(press.length).toBeGreaterThan(0)
    for (const r of press) {
      expect(r.sel).toContain(':not(:disabled)')
      expect(r.sel).toContain(':not([aria-disabled="true"])')
      expect(r.body).toContain('var(--dur-press)')
      expect(r.at, `${r.sel} scales only when motion is welcome`).toEqual(['@media (prefers-reduced-motion: no-preference)'])
    }
    // the only other scale is the right-to-left mirror of an arrow
    expect(all.filter(r => /\bscale:\s*(?![\s]|var\(--press-scale\)|-1 1\b|none)/.test(r.body)).map(r => r.sel)).toEqual([])
  })

  it('no rule in any stylesheet transitions `all`', () => {
    const src = here('../')
    const sheets: string[] = []
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${d}${e.name}/`)
      else if (e.name.endsWith('.css')) sheets.push(`${d}${e.name}`)
    } }
    walk(src)
    expect(sheets.length).toBeGreaterThan(3)
    for (const f of sheets) {
      const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(css, f).not.toMatch(/transition(-property)?\s*:[^;}]*\ball\b/)
    }
  })

  it('coarse pointers get --h-ctl-touch', () => {
    const coarse = all.filter(r => r.at.includes('@media (pointer: coarse)'))
    // the stepper's − and + are sized to the input on a fine pointer; on a coarse one they grow to the target too
    expect(coarse.some(r => r.sel.includes('.stepper .btn.icon') && r.body.includes('height: var(--h-ctl-touch)') && r.body.includes('width: var(--h-ctl-touch)'))).toBe(true)
    expect(coarse.some(r => r.sel.includes('.btn') && r.body.includes('height: var(--h-ctl-touch)'))).toBe(true)
    expect(coarse.some(r => r.sel.includes('.btn.icon') && r.body.includes('width: var(--h-ctl-touch)'))).toBe(true)
    // the tabs and the menu items the phone uses most: view as, the identity menu, Appearance, the Proposals tabs
    // (L4a final review I-2)
    expect(coarse.some(r => r.sel.split(',').map(s => s.trim()).includes('.tabs [role="tab"]') && r.body.includes('block-size: var(--h-ctl-touch)'))).toBe(true)
    expect(coarse.some(r => r.sel.split(',').map(s => s.trim()).includes('.menu .mi') && r.body.includes('block-size: var(--h-ctl-touch)'))).toBe(true)
  })

  it('menus and popovers enter with opacity and a --sp-4 translate over --dur-2, and leave with opacity only', () => {
    const base = all.find(r => r.sel === '.popover' && r.at.length === 0)!
    expect(base.body).toMatch(/transition:[^;]*opacity var\(--dur-2\)[^;]*translate var\(--dur-2\)/)
    const start = all.find(r => r.sel === '.popover' && r.at.includes('@starting-style') && !r.at.some(a => a.includes('reduce')))!
    expect(start.body).toContain('opacity: 0')
    expect(start.body).toContain('translate: 0 calc(-1 * var(--sp-4))') // drops 4px into place, as the gallery's pop-in
    const leave = all.find(r => r.sel.startsWith('.popover[hidden]') && r.at.length === 0)!
    expect(leave.body).toContain('opacity: 0')
    expect(leave.body).toMatch(/transition:[^;]*opacity var\(--dur-out\)/)
    expect(leave.body).not.toMatch(/transition:[^;]*translate/)
    expect(leave.body).not.toMatch(/translate:/)
  })

  it('under reduced motion menus and popovers only cross-fade over --dur-1', () => {
    const reduce = all.filter(r => r.sel.startsWith('.popover') && r.at.includes('@media (prefers-reduced-motion: reduce)'))
    expect(reduce.length).toBeGreaterThan(0)
    for (const r of reduce) {
      expect(r.body).toMatch(/transition:[^;]*opacity var\(--dur-1\)/)
      expect(r.body).not.toMatch(/transition:[^;]*translate/)
    }
    // and the sheet-wide reduced-motion rule leaves the popovers their cross-fade (C10: base.css, with the motion rule)
    const base = readFileSync(here('./base.css'), 'utf8')
    expect(base).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \*:not\(\.popover\) \{ transition-duration: 0s !important; \} \}/)
  })

  it('draws a primary button in ink, never moss (C-2)', () => {
    const primary = all.find(r => r.sel === '.btn.primary')!
    expect(primary.body).toContain('background: var(--solid)')
    expect(controls).not.toMatch(/\.btn[^{]*\{[^}]*background(-color)?:\s*var\(--accent\)/)
  })
})
