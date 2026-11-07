import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Icon } from '../../design/Icon.tsx'
import { MenuList, type MenuEntry } from '../../design/Menu.tsx'
import { announce } from '../../parts/live.tsx'
import { caip10, isAddress, shortAddress } from './chain.ts'

/** How long the copied check stays before the copy glyph comes back (§7.5). */
export const COPIED_MS = 1600
const REFUSED = 'Couldn’t copy. Select the address and copy it.'

/** The address chip (§7.5): `0x6AFF…343a` in Mono on --wash, a copy glyph after it. A click copies the plain
 *  address, what a signer pastes; the CAIP-10 id (`eip155:42220:0x…`, when the chain is known) is its title,
 *  and its context menu (right-click, a long press, Shift+F10) offers Copy CAIP-10. Copied: the glyph
 *  cross-fades to a moss check, "Copied 0x…" is said in the live region, and it reverts after 1.6 s. A
 *  clipboard that refuses (an insecure page, a denied permission) is said so, and what was to be copied — the
 *  address, or its CAIP-10 id — is shown whole, selected, for the person's own copy. A value that is not an address (an ENS name, `42220 / 13`, a typo) is
 *  shown and copied exactly as given. It is a button, never a link to an explorer.
 *  `name` shows a name (ENS, the System's own) in Sans instead of the hex; `full` the whole address, wrapping;
 *  `warn` is clay with the alert glyph, its reason in the title and the description. `copied` pins the copied
 *  state (for /parts). `still` draws the chip as plain text, no control of its own, its CAIP-10 id in the title: for
 *  a chip inside a link (a Systems row that opens its record, E-36), where a button is not allowed and the record
 *  page has the copy. An empty value draws nothing. */
export function AddressChip({ value, chain, name, full = false, warn, copied: pinned = false, still = false }:
  { value: string; chain?: string; name?: string; full?: boolean; warn?: string; copied?: boolean; still?: boolean }) {
  const [copied, setCopied] = useState(false)
  // What a refused copy was asked to copy (the address, or its CAIP-10 id): shown whole for the person's own copy.
  const [refused, setRefused] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chip = useRef<HTMLButtonElement>(null)
  const wrap = useRef<HTMLSpanElement>(null)
  const whole = useRef<HTMLSpanElement>(null)
  const descId = useId()
  const menuId = useId()

  const stop = () => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null } }
  useEffect(() => stop, [])
  useEffect(() => {
    if (refused === null || !whole.current) return
    try { window.getSelection()?.selectAllChildren(whole.current) } catch { /* nothing selectable: the value is still shown */ }
  }, [refused])
  useLayoutEffect(() => { if (menu) wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus() }, [menu])
  useEffect(() => {
    if (!menu) return
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setMenu(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [menu])

  if (value === '') return null

  const address = isAddress(value)
  const id = chain && address ? caip10(chain, value) : null
  const short = shortAddress(value)
  const shown = full ? value : name ?? short
  const label = address ? `Copy address ${shown}` : `Copy ${shown}`
  const described = warn ? `${warn}. ${value}` : value !== shown ? value : null
  const title = warn ? `${warn} · ${id ?? value}` : id ?? value

  async function copy(text: string, said: string) {
    try {
      const board = typeof navigator === 'undefined' ? undefined : navigator.clipboard
      if (!board?.writeText) throw new Error('no clipboard here')
      await board.writeText(text)
    } catch {
      stop()
      setCopied(false)
      setRefused(text)
      announce(REFUSED)
      return
    }
    setRefused(null)
    setCopied(true)
    announce(`Copied ${said}`)
    stop()
    timer.current = setTimeout(() => { timer.current = null; setCopied(false) }, COPIED_MS)
  }

  const close = (refocus: boolean) => { setMenu(false); if (refocus) chip.current?.focus() }
  const items: MenuEntry[] = id === null ? [] : [
    { type: 'item', label: 'Copy address', icon: 'copy', onSelect: () => { void copy(value, short) } },
    { type: 'item', label: 'Copy CAIP-10', icon: 'link', onSelect: () => { void copy(id, `CAIP-10 ${chain}:${short}`) } },
  ]
  const openMenu = (e: KeyboardEvent | ReactMouseEvent) => {
    if (id === null) return // nothing more to offer than the browser's own menu
    e.preventDefault()
    setMenu(true)
  }

  const cls = ['addr', warn !== undefined && 'addr-warn', full && 'addr-full'].filter(Boolean).join(' ')
  if (still) {
    return <span className={`${cls} addr-still`} title={title}>{name !== undefined && !full ? <span className="addr-name">{name}</span> : <span className="addr-t">{shown}</span>}</span>
  }
  return (
    <span className="addr-wrap" ref={wrap}
      onKeyDown={e => {
        if (!menu) return
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) }
        else if (e.key === 'Tab') setMenu(false)
      }}>
      <button ref={chip} type="button" className={cls} data-copied={pinned || copied ? '' : undefined} title={title}
        aria-label={label} aria-describedby={described === null ? undefined : descId}
        onClick={() => { void copy(value, short) }}
        onContextMenu={openMenu}
        onKeyDown={e => { if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') openMenu(e) }}>
        {name !== undefined && !full ? <span className="addr-name">{name}</span> : <span className="addr-t">{shown}</span>}
        {!full && (
          <span className="addr-ic" aria-hidden="true">
            <span className="addr-cp"><Icon name={warn !== undefined ? 'alert' : 'copy'} size="xs" /></span>
            <span className="addr-ok"><Icon name="check" size="xs" /></span>
          </span>
        )}
      </button>
      {described !== null && <span id={descId} className="sr-only">{described}</span>}
      {refused !== null && <span ref={whole} className="addr-sel">{refused}</span>}
      {menu && <MenuList id={menuId} label={`Address ${name ?? short}`} items={items} float done={() => close(true)} />}
    </span>
  )
}
