import { useReducer, useSyncExternalStore } from 'react'
import { Icon } from '../design/Icon.tsx'
import { Menu, type MenuEntry } from '../design/Menu.tsx'
import { useFrame } from '../design/Shell.tsx'
import { setTheme, type Theme } from '../theme.ts'
import type { OrgMark } from './sections.ts'

/** The org's mark on --solid: the instance's own when its configuration gives one, else the neutral seal (§18
 *  answer 4) — never a DAO's logo by default. Decorative: the org's name says who it is. */
export function OrgSeal({ org }: { org: OrgMark }) {
  return <span className="side-seal">{org.mark ? <img src={org.mark} alt="" /> : <Icon name="seal" size="xs" />}</span>
}

/** The appearance that shows, read from <html data-theme>: a choice made in ⌘K shows here too, and a choice the
 *  browser could not store still shows for the session. */
function subscribe(onChange: () => void): () => void {
  const watch = new MutationObserver(onChange)
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => watch.disconnect()
}
const shown = (): Theme | null => { const t = document.documentElement.dataset.theme; return t === 'light' || t === 'dark' ? t : null }

/** The org switcher (§5.2 item 1): the seal, the name in Sans 600 (truncated, whole in `title`) and an up-down
 *  chevron. Its menu: the org's public door ↗, then Appearance — System, Light, Dark. (Switching org comes when
 *  a server hosts several.) On the rail it is the seal alone, still named. */
export function OrgSwitcher({ org }: { org: OrgMark }) {
  const { expanded } = useFrame()
  const theme = useSyncExternalStore(subscribe, shown, () => null)
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const choose = (t: Theme | null) => () => { setTheme(t); redraw() } // at once; the observer is for ⌘K's toggle
  const items: MenuEntry[] = [
    { type: 'link', label: 'Public door', href: '/door', external: true, icon: 'globe' },
    { type: 'separator' },
    { type: 'header', label: 'Appearance' },
    { type: 'radio', label: 'System', checked: theme === null, onSelect: choose(null) },
    { type: 'radio', label: 'Light', checked: theme === 'light', onSelect: choose('light') },
    { type: 'radio', label: 'Dark', checked: theme === 'dark', onSelect: choose('dark') },
  ]
  const face = <><OrgSeal org={org} /><span className={expanded ? 'side-org-nm' : 'side-org-nm sr-only'} title={org.name}>{org.name}</span></>
  return <Menu label={org.name} face="side-org" text={face} items={items} trail={expanded ? 'up-down' : null} />
}
