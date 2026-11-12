import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'wouter'
import { api, type InstanceBar, type InstanceTheme } from '../api.ts'
import { Menu, type MenuEntry } from '../design/Menu.tsx'
import { setOrgTheme, shownOrgTheme, shownTheme, watchAppearance } from '../orgTheme.ts'
import { setTheme, systemTheme } from '../theme.ts'

/** The site switcher: the bar shows only the site this house is, as part of the lockup ("Org / House ▾"), so it never
 *  reads as the page's own navigation. Opened, it lists the instance's sites in its order, each with its one-line
 *  note; the current one carries the lit dot and `aria-current`, a site elsewhere opens in its own tab and says so,
 *  a rooted path is a place in the house. A `<details>` disclosure; Escape or a click outside closes it. */
function SiteSwitch({ bar }: { bar: InstanceBar }) {
  const box = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const d = box.current
    if (!d) return
    const away = (e: MouseEvent) => { if (d.open && !d.contains(e.target as Node)) d.open = false }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && d.open) { e.stopPropagation(); d.open = false; d.querySelector('summary')?.focus() } }
    document.addEventListener('click', away)
    d.addEventListener('keydown', esc)
    return () => { document.removeEventListener('click', away); d.removeEventListener('keydown', esc) }
  }, [])
  const here = bar.sites.find(s => s.current)
  const whose = bar.label ? `${bar.label} sites` : 'Sites'
  return (
    <details ref={box} className="sites-switch">
      <summary aria-label={here ? `${whose}: you are on ${here.label}` : whose}>
        <span className="sites-here">{here ? here.label : 'Sites'}</span>
        <svg className="sites-chev" aria-hidden="true" width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
      </summary>
      <div className="sites-panel">
        <ul className="sites-l">
          {bar.sites.map(s => {
            const inside = <>
              <i className={s.current ? 'sites-dot lit' : 'sites-dot'} aria-hidden="true" />
              <span className="sites-text"><span className="sites-label">{s.label}</span>{s.note && <span className="sites-note">{s.note}</span>}</span>
            </>
            return (
              <li key={`${s.label} ${s.href}`}>
                {s.href.startsWith('/')
                  ? <Link className="sites-a" href={s.href} aria-current={s.current ? 'page' : undefined} onClick={() => { if (box.current) box.current.open = false }}>{inside}</Link>
                  : <a className="sites-a" href={s.href} aria-current={s.current ? 'page' : undefined} target="_blank" rel="noopener noreferrer">
                      {inside}<span className="sites-out" aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span>
                    </a>}
              </li>
            )
          })}
        </ul>
      </div>
    </details>
  )
}

/** The bar's theme control. With the themes an instance offers (server/instanceThemes.ts): a menu of them, each with
 *  its note, under Auto (the instance's own look, light or dark as the device says); its face names what shows now.
 *  With none: one button that turns the house light or dark. Either way the choice is the same one the org menu and
 *  ⌘K make (orgTheme.ts, theme.ts), so the three never disagree. */
function ThemeControl({ themes }: { themes: InstanceTheme[] }) {
  const theme = useSyncExternalStore(watchAppearance, shownTheme, () => null)
  const picked = useSyncExternalStore(watchAppearance, shownOrgTheme, () => null)
  if (themes.length === 0) {
    const to = (theme ?? systemTheme()) === 'dark' ? 'light' : 'dark'
    return <button type="button" className="sites-theme" aria-label={`Switch to the ${to} theme`} onClick={() => { setOrgTheme(null); setTheme(to) }}>{to === 'light' ? 'Light' : 'Dark'}</button>
  }
  const on = themes.find(t => t.id === picked)
  const items: MenuEntry[] = [
    { type: 'radio', label: 'Auto', hint: 'Light or dark, as this device says', checked: !on && theme === null, onSelect: () => { setOrgTheme(null); setTheme(null) } },
    { type: 'separator' },
    ...themes.map(t => ({ type: 'radio' as const, label: t.label, ...(t.note ? { hint: t.note } : {}), checked: on?.id === t.id,
      onSelect: () => setOrgTheme({ id: t.id, scheme: t.scheme }) })),
  ]
  const face = <><i className="sites-swatch" aria-hidden="true" /><span className="sr-only">Theme: </span><span className="sites-theme-nm">{on ? on.label : theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'Auto'}</span></>
  return <Menu label="Theme" face="sites-theme" text={face} items={items} trail={null} />
}

/** The instance's sites bar, drawn: the lockup (whose sites these are, a way home, then the site switcher), and at
 *  the far end the theme control. The mark beside the name is an empty box a skin may fill with the org's own; the
 *  framework draws none. No sites, no bar. */
export function SitesBarView({ bar, themes = [] }: { bar: InstanceBar; themes?: InstanceTheme[] }) {
  if (bar.sites.length === 0) return null
  return (
    <nav className="sites" aria-label={bar.label ? `${bar.label} sites` : 'Sites'}>
      <div className="sites-lockup">
        {bar.label && <>
          <Link className="sites-home" href="/" aria-label={`${bar.label}: home`}><span className="sites-mark" aria-hidden="true" /><span className="sites-org">{bar.label}</span></Link>
          <span className="sites-slash" aria-hidden="true">/</span>
        </>}
        <SiteSwitch bar={bar} />
      </div>
      <div className="sites-tools"><ThemeControl themes={themes} /></div>
    </nav>
  )
}

/** The bar as the frame reads it (server/instanceBar.ts): asked once; while it has not answered, or when the
 *  server has none to give (an older server, an instance without `house/bar.yaml`), nothing is drawn. The themes
 *  are the ones the org menu offers (the same query), none while they have not answered. */
export function SitesBar() {
  const q = useQuery({ queryKey: ['instance', 'bar'], queryFn: api.instanceBar, retry: false, staleTime: Infinity })
  const themes = useQuery({ queryKey: ['instance', 'themes'], queryFn: api.instanceThemes, retry: false, staleTime: Infinity }).data?.themes
  return q.data && Array.isArray(q.data.sites) ? <SitesBarView bar={q.data} themes={Array.isArray(themes) ? themes : []} /> : null
}
