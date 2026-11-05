import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'wouter'
import { Button } from './Button.tsx'
import { Icon, type IconName } from './Icon.tsx'

export type MenuEntry =
  | { type: 'item'; label: string; icon?: IconName; hint?: string; onSelect: () => void; unavailable?: string }
  | { type: 'radio'; label: string; checked: boolean; onSelect: () => void; unavailable?: string; icon?: IconName; hint?: string }
  | { type: 'link'; label: string; href: string; external?: boolean; icon?: IconName }
  | { type: 'separator' } | { type: 'header'; label: string }

const ITEMS = '[role="menuitem"], [role="menuitemradio"]'

/** ↓ ↑ move through the items and wrap, Home and End go to the ends. */
function rove(e: KeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEMS)]
  if (items.length === 0) return
  const at = items.indexOf(document.activeElement as HTMLElement)
  const to = e.key === 'ArrowDown' ? (at + 1) % items.length : e.key === 'ArrowUp' ? (at - 1 + items.length) % items.length
    : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1
  if (to < 0) return
  e.preventDefault()
  items[to]!.focus()
}

type Leaf = Exclude<MenuEntry, { type: 'separator' } | { type: 'header' }>

function Item({ entry, on, done }: { entry: Leaf; on: boolean; done: () => void }) {
  const endId = useId()
  const cls = on ? 'mi on' : 'mi'
  const glyph = entry.icon && <Icon name={entry.icon} />
  if (entry.type === 'link') {
    if (entry.external) {
      return (
        <a role="menuitem" tabIndex={-1} className={cls} href={entry.href} target="_blank" rel="noopener noreferrer" onClick={done}>
          {glyph}<span>{entry.label}</span><span className="sr-only"> (opens in a new tab)</span>
          <span className="end" aria-hidden="true"><Icon name="external" size="xs" /></span>
        </a>
      )
    }
    return <Link role="menuitem" tabIndex={-1} className={cls} href={entry.href} onClick={done}>{glyph}<span>{entry.label}</span></Link>
  }
  const radio = entry.type === 'radio'
  const off = entry.unavailable !== undefined
  const words = off ? entry.unavailable : entry.hint
  const check = radio && entry.checked && !off
  return (
    <button type="button" role={radio ? 'menuitemradio' : 'menuitem'} tabIndex={-1} className={cls}
      aria-checked={radio ? entry.checked : undefined} aria-disabled={off ? true : undefined} aria-describedby={words ? endId : undefined}
      onClick={() => { if (off) return; entry.onSelect(); done() }}>
      {glyph}<span>{entry.label}</span>
      {(words || check) && (
        <span className="end">
          {words && <span id={endId} aria-hidden="true">{words}</span>}
          {check && <Icon name="check" />}
        </span>
      )}
    </button>
  )
}

/** The entries in groups: a header opens a labelled group that runs to the next separator or header. */
type Group = { kind: 'group'; header: string | null; at: number; leaves: { entry: Leaf; at: number }[] }
type Block = { kind: 'sep'; at: number } | Group
function blocksOf(items: MenuEntry[]): Block[] {
  const out: Block[] = []
  let group: Group | null = null
  items.forEach((entry, at) => {
    if (entry.type === 'separator') { out.push({ kind: 'sep', at }); group = null }
    else if (entry.type === 'header') { group = { kind: 'group', header: entry.label, at, leaves: [] }; out.push(group) }
    else {
      if (!group) { group = { kind: 'group', header: null, at, leaves: [] }; out.push(group) }
      group.leaves.push({ entry, at })
    }
  })
  return out
}

function Labelled({ header, children }: { header: string; children: ReactNode }) {
  const id = useId()
  return <div role="group" aria-labelledby={id}><div id={id} role="presentation" className="mh">{header}</div>{children}</div>
}

/** The menu itself (§7.3): a `menu` on the pop surface, its items 32px with a glyph, a label and a trailing
 *  hint, reason or moss check. An unavailable item stays, aria-disabled, its reason where a hint would be.
 *  Menu draws it under its button; /parts draws it on its own, `current` being the highlighted item. */
export function MenuList({ id, label, items, current, hidden, float = false, done = () => {} }:
  { id?: string; label: string; items: MenuEntry[]; current?: number; hidden?: boolean; float?: boolean; done?: () => void }) {
  return (
    <div id={id} role="menu" aria-label={label} className={float ? 'menu popover' : 'menu'} hidden={hidden} onKeyDown={rove}>
      {blocksOf(items).map(b => {
        if (b.kind === 'sep') return <div key={b.at} role="separator" className="sep" />
        const leaves = b.leaves.map(l => <Item key={l.at} entry={l.entry} on={l.at === current} done={done} />)
        return b.header === null ? leaves : <Labelled key={b.at} header={b.header}>{leaves}</Labelled>
      })}
    </div>
  )
}

/** A button that opens a menu. With `items`, a real `menu`: focus goes to the checked item (else the first),
 *  ↓ ↑ Home End move, a choice or Escape closes it and focus returns to the button, Tab closes it. With
 *  `children` (0.6, L4-R4), a labelled group of whatever it is given, closed by a click on one of them.
 *  Escape is handled here, on itself, and marked handled; a click outside closes it too. With no text the
 *  button is the ghost "more" glyph; `icon` leads the text when there is one. With a `face` (the view-as and
 *  visibility controls, §5.9, §7.10) the trigger is a plain button of that class: the glyph, the text and a
 *  trailing chevron, named by its text (by `label` when it has none); `label` then names the menu. `trail` is that chevron's glyph — the
 *  org switcher's up-down, or null for none (the frame's identity). */
export function Menu({ label, text, icon, items, children, face, trail = 'chevron-down' }:
  { label: string; text?: ReactNode; icon?: IconName; items?: MenuEntry[]; children?: ReactNode; face?: string; trail?: IconName | null }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()
  const close = (refocus: boolean) => { setOpen(false); if (refocus) button.current?.focus() }
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  useLayoutEffect(() => {
    if (!open || !items) return
    const all = [...(wrap.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])]
    ;(all.find(el => el.getAttribute('aria-checked') === 'true') ?? all[0])?.focus()
  }, [open])
  const iconOnly = text === undefined
  return (
    <span className="menu-wrap" ref={wrap}
      onKeyDown={e => {
        if (!open) return
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) }
        else if (e.key === 'Tab' && items) setOpen(false)
      }}
      onClick={e => { if (!items && (e.target as HTMLElement).closest('.menu-children button, .menu-children a')) close(true) }}>
      {face !== undefined
        ? <button ref={button} type="button" className={face} aria-expanded={open} aria-haspopup={items ? 'menu' : undefined}
            aria-controls={id} aria-label={text === undefined ? label : undefined} onClick={() => setOpen(o => !o)}>
            {icon && <Icon name={icon} size="sm" />}{text}{trail && <Icon name={trail} size="xs" />}
          </button>
        : <Button ref={button} label={label} expanded={open} haspopup={items ? 'menu' : undefined} controls={id}
            icon={icon ?? (iconOnly ? 'more' : undefined)} iconOnly={iconOnly} variant={iconOnly ? 'ghost' : undefined}
            onClick={() => setOpen(o => !o)}>{text}</Button>}
      {items
        ? <MenuList id={id} label={label} items={items} hidden={!open} float done={() => close(true)} />
        : <div id={id} role="group" aria-label={label} className="menu menu-children popover" hidden={!open}>{children}</div>}
    </span>
  )
}
