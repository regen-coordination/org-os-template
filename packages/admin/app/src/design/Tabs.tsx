import type { KeyboardEvent } from 'react'
import { Link, useLocation } from 'wouter'
import { Icon, type IconName } from './Icon.tsx'
import { stepOf } from './Seg.tsx'

export interface TabDef<T extends string> { id: T; label: string; count?: number; icon?: IconName; href?: string }

/** A tablist (§7.3; APG tabs, automatic activation): the chosen tab ink, underlined, and the only one in the
 *  Tab order; ← → move and choose and wrap, Home and End go to the ends. A count follows its label, faint, in
 *  its own span. A tab with `href` is a link (the Proposals tabs are three URLs), and the arrows follow it. The bar scrolls inside
 *  itself when the tabs do not fit; the caller shows the chosen tab's content. */
export function Tabs<T extends string>({ label, tabs, value, onChange }:
  { label: string; tabs: TabDef<T>[]; value: T; onChange: (id: T) => void }) {
  const [location, navigate] = useLocation()
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex(t => t.id === value)
    const step = stepOf(e.key, e.currentTarget)
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : step !== 0 && at >= 0 ? (at + step + tabs.length) % tabs.length : -1
    if (to < 0 || (step !== 0 && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) return
    e.preventDefault()
    const next = tabs[to]!
    // A tab that is a link is followed, as a click on it is: the page reads the chosen tab from its URL, so the next
    // arrow moves on from there (L4a final review M-14).
    if (next.href && next.href !== location) navigate(next.href)
    onChange(next.id)
    ;(e.currentTarget.querySelector(`[data-tab="${next.id}"]`) as HTMLElement | null)?.focus()
  }
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map(t => {
        const on = t.id === value
        const body = <>{t.icon && <Icon name={t.icon} size="sm" />}<span>{t.label}</span>{t.count !== undefined && <>{' '}<span className="cnt">{t.count}</span></>}</>
        const common = { role: 'tab', 'data-tab': t.id, 'aria-selected': on, tabIndex: on ? 0 : -1, onClick: () => onChange(t.id) } as const
        return t.href
          ? <Link key={t.id} href={t.href} {...common}>{body}</Link>
          : <button key={t.id} type="button" {...common}>{body}</button>
      })}
    </div>
  )
}
