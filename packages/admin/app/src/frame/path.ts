import { SECTIONS } from '../sections.ts'
import { safeDecode } from '../hrefs.ts'
import { HOUSE_SECTIONS, INSTANCE_LINKS } from './sections.ts'
import { GROUPS } from '../parts/groups/list.ts'

export interface Crumb { label: string; href: string }

/** The places the path knows by name, each under its parent: the house sections, the Proposals tabs, 0.6's
 *  collections under Workspace (Q-L4-3), the Instance group's boards and pages, and /parts with its groups. */
interface Place { href: string; label: string; parent?: string }
const WORKSPACE = '/workspace'
const PROPOSALS = '/governance/proposals'
const PLACES: Place[] = [
  ...HOUSE_SECTIONS.filter(s => s.id !== 'home').map(s => ({ href: s.href, label: s.label })),
  { href: '/governance/decisions', label: 'Decisions', parent: PROPOSALS },
  { href: '/governance/rules', label: 'Rules', parent: PROPOSALS },
  ...SECTIONS.filter(d => d.group === 'organization' && d.id !== 'treasury').map(d => ({ href: d.route, label: d.label, parent: WORKSPACE })),
  ...INSTANCE_LINKS.filter(l => !HOUSE_SECTIONS.some(s => s.href === l.href)),
  { href: '/parts', label: 'Parts' },
  ...GROUPS.map(g => ({ href: `/parts/${g.id}`, label: g.label, parent: '/parts' })),
]

const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`)

function chain(place: Place): Crumb[] {
  const parent = place.parent ? PLACES.find(p => p.href === place.parent) : undefined
  return [...(parent ? chain(parent) : []), { label: place.label, href: place.href }]
}

/** The resource the path's last place names (`<kind>:<id>` for a record, `proposal:<id>` for a proposal), else null:
 *  the one record whose name the path may print, so the caller reads that record's entry for the gate's marker
 *  (D-12, E-70). */
export function namedIn(location: string): string | null {
  const path = (location.split(/[?#]/)[0] ?? '/').replace(/(.)\/+$/, '$1') || '/'
  const record = /^\/r\/([^/]+)\/([^/]+)$/.exec(path)
  if (record) return `${safeDecode(record[1]!)}:${safeDecode(record[2]!)}`
  const proposal = /^\/governance\/proposals\/([^/]+)$/.exec(path)
  return proposal ? `proposal:${safeDecode(proposal[1]!)}` : null
}

/** The top bar's path (§5.5): the section and the places under it down to the current item, which is last.
 *  A record is placed under the collection of its kind (a System under Systems), and named by `names` under its
 *  resource id, `<kind>:<id>` (E-64: a bare id two kinds share names neither); a proposal by `proposal:<id>`; any other
 *  place by its own id (a board's). An id with no name is shown decoded. The query and the fragment are not part of
 *  the path. */
export function pathOf(location: string, names: Record<string, string>): Crumb[] {
  const path = (location.split(/[?#]/)[0] ?? '/').replace(/(.)\/+$/, '$1') || '/'
  const name = (seg: string) => { const id = safeDecode(seg); return names[id] ?? names[seg] ?? id }
  if (path === '/' || path === '/b/home') return [{ label: 'Home', href: '/' }]

  const record = /^\/r\/([^/]+)\/([^/]+)$/.exec(path)
  if (record) {
    const kind = safeDecode(record[1]!)
    const id = safeDecode(record[2]!)
    const home = SECTIONS.find(d => (d.kinds.includes(kind) || d.registry === kind) && d.id !== 'treasury' && d.group === 'organization')
    const place = kind === 'system' ? PLACES.find(p => p.href === '/systems') : home && PLACES.find(p => p.href === home.route)
    return [...(place ? chain(place) : []), { label: names[`${kind}:${id}`] ?? id, href: path }]
  }
  const proposal = /^\/governance\/proposals\/([^/]+)$/.exec(path)
  if (proposal) {
    const id = safeDecode(proposal[1]!)
    return [...chain(PLACES.find(p => p.href === PROPOSALS)!), { label: names[`proposal:${id}`] ?? name(proposal[1]!), href: path }]
  }

  const place = PLACES.filter(p => under(path, p.href)).sort((a, b) => b.href.length - a.href.length)[0]
  if (!place) {
    const last = path.split('/').filter(Boolean).at(-1) ?? ''
    return [{ label: name(last), href: path }]
  }
  const rest = path.slice(place.href.length).split('/').filter(Boolean)
  let href = place.href
  return [...chain(place), ...rest.map(seg => { href = `${href}/${seg}`; return { label: name(seg), href } })]
}
