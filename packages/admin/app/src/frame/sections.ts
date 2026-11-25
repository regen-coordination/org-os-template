import type { IconName } from '../design/Icon.tsx'
import { SECTIONS } from '../sections.ts'
import { safeDecode } from '../hrefs.ts'
import type { InstanceNav, NavItem } from '../api.ts'

/** The house's nine sections (spec §5.2), in the house spec's order, with their g-key (§5.8). */
export type SectionId = 'home' | 'needs' | 'proposals' | 'systems' | 'roles' | 'treasury' | 'workspace' | 'library' | 'changes'
export interface HouseSection { id: SectionId; label: string; href: string; icon: IconName; key: string }

export const HOUSE_SECTIONS: readonly HouseSection[] = [
  { id: 'home', label: 'Home', href: '/', icon: 'home', key: 'h' },
  { id: 'needs', label: 'Needs you', href: '/needs', icon: 'needs', key: 'n' },
  { id: 'proposals', label: 'Proposals', href: '/governance/proposals', icon: 'proposal', key: 'p' },
  { id: 'systems', label: 'Systems', href: '/systems', icon: 'systems', key: 's' },
  { id: 'roles', label: 'Roles', href: '/roles', icon: 'roles', key: 'r' },
  { id: 'treasury', label: 'Treasury', href: '/b/treasury', icon: 'safe', key: 't' },
  { id: 'workspace', label: 'Workspace', href: '/workspace', icon: 'workspace', key: 'w' },
  { id: 'library', label: 'Library', href: '/library', icon: 'library', key: 'l' },
  { id: 'changes', label: 'Changes', href: '/changes', icon: 'changes', key: 'c' },
]

/** The Instance group (call C-8, §18 answer 5): 0.6's org-os boards that are not DAO sections. */
export const INSTANCE_LINKS: readonly { label: string; href: string }[] = [
  { label: 'Crew', href: '/b/crew' },
  { label: 'Fleet', href: '/b/fleet' },
  { label: 'Modules', href: '/b/modules' },
  // L6 carries K11 (PF-R79): told apart from the Hub's Sources page (`SOURCES_LINK`), which Workspace lists.
  { label: 'Sources board', href: '/b/sources' },
  { label: 'Activity', href: '/activity' },
  { label: 'All records', href: '/all' },
  { label: 'Boards', href: '/boards' },
]

/** Workspace's collections come in this order, then any other the viewer may see (§5.2 item 4). Tasks and
 *  Knowledge appear when L6 adds them (Q-L4-3). */
export const WORKSPACE_ORDER: readonly string[] = ['meetings', 'tasks', 'projects', 'knowledge']

/** A Workspace collection or an Instance board, as the sidebar lists it; `empty`, a collection with nothing in it the
 *  viewer may see (its dashed dot, design pass 2026-11-04). */
export interface SideLink { id: string; label: string; href: string; empty?: boolean }

/** DAO-OS L6 Task 19 (spec §15): the Sources page, listed under Workspace after its collections for a viewer the members'
 *  side admits. The source editor (`/files/…`) is Workspace's too, under Sources in the path. */
export const SOURCES_LINK: SideLink = { id: 'sources', label: 'Sources', href: '/sources' }

export const FILES_HREF = '/files'

/** The counts the sidebar shows: each of what the viewer may see (rule 7). */
export interface HouseCounts { needs: number; proposals: number; systems: number; changes: number }

/** A count as the sidebar draws it: nothing for zero, `99+` past 99. */
export function countText(n: number): string | null {
  if (!(n > 0)) return null
  return n > 99 ? '99+' : String(Math.floor(n))
}

/** The org as the switcher draws it: its name, and its mark from the instance's configuration — null is the
 *  neutral seal (§18 answer 4), never a DAO's logo by default. */
export interface OrgMark { name: string; mark: string | null }

/** Who is signed in, as the sidebar's foot draws them (L5 replaces where it comes from). */
/** Who is signed in. A wallet session names its hat, address and hats; an email session (Lane 3) names the person in
 *  `hatName`, has no address and no hats, and gives its Roles as words in `roles`. */
export interface Identity {
  hatName: string; address: string | null; hatId: string | null; hats: string[]; roles?: string[]
  /** The second line when there are no Roles to show (a ReFi DAO Network Guest: "Guest"). */
  note?: string
  /** Where the member manages their linked Bluesky or Certified account (network app B4); absent: not offered. */
  accountsHref?: string
}

/** What the counts are read from: the lists as the server gives them, filtered here by `visible` (the viewer's
 *  eyes, §6.3) — so a preview as Public counts only what the portal would show. Needs you's count is its items
 *  (`needsFrom`, E-34), so the sidebar, the list and the map agree. Staged changes are the member's own writes: while
 *  previewing (`canWrite` false) there are none to count, as the tray is hidden. */
export function houseCounts<R extends { kind: string }, P, N>(
  lists: { resources: R[]; open: P[]; needs: N[]; staged: number },
  visible: <T>(items: T[]) => T[], canWrite: boolean,
): HouseCounts {
  const resources = visible(lists.resources)
  const open = visible(lists.open)
  return {
    needs: visible(lists.needs).length,
    proposals: open.length,
    systems: resources.filter(r => r.kind === 'system').length,
    changes: canWrite ? lists.staged : 0,
  }
}

const strip = (path: string) => (path.split(/[?#]/)[0] ?? '/').replace(/(.)\/+$/, '$1') || '/'
const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`)

/** The section a record page (`/r/<kind>/<id>`) belongs to, by its kind (E-64): a System is Systems', a proposal
 *  Proposals', a record of one of 0.6's organization collections (a project, a person, a meeting…) Workspace's. A kind
 *  of the Instance group's boards (a module, a crew seat) is no section of the Hub. */
function recordSection(kind: string): SectionId | null {
  if (kind === 'system') return 'systems'
  if (kind === 'proposal') return 'proposals'
  const home = SECTIONS.find(d => d.group === 'organization' && d.id !== 'treasury' && (d.kinds.includes(kind) || d.registry === kind))
  return home ? 'workspace' : null
}

/** The section a path belongs to, if any. Home is `/` and its board; the Proposals tabs (decisions, rules) are
 *  Proposals (L4-R10); a Workspace collection is Workspace; a record page is its kind's (E-64). */
export function sectionOf(path: string, collections: readonly SideLink[] = []): SectionId | null {
  const p = strip(path)
  if (p === '/' || p === '/b/home') return 'home'
  const record = /^\/r\/([^/]+)\/[^/]+$/.exec(p)
  if (record) return recordSection(safeDecode(record[1]!))
  if (under(p, '/governance')) return 'proposals'
  if (under(p, FILES_HREF)) return 'workspace' // DAO-OS L6 Task 19: the source editor is under Sources
  if (collections.some(c => under(p, c.href))) return 'workspace'
  const found = HOUSE_SECTIONS.filter(s => s.href !== '/' && under(p, s.href))
  return found[0]?.id ?? null
}

/** Is this link the page you are on, or an ancestor of it? */
export function isCurrent(path: string, href: string): boolean {
  return under(strip(path), href)
}

/** An instance's sidebar item as the sidebar draws it: one of the house's sections (its icon, count and key, the label
 *  the instance gave it or its own), or a link — to a place in the house, or to another site (`external`). */
export type NavLink =
  | { kind: 'section'; section: HouseSection; label: string }
  | { kind: 'link'; label: string; href: string; external: boolean; icon: IconName | null }
export interface NavShown { label: string | null; items: NavLink[] }
/** The instance's groups as this viewer sees them, and the house's sections it did not name, under `more`. */
export interface ResolvedNav { groups: NavShown[]; more: { label: string; sections: HouseSection[] } }

/** The instance's nav (server/instanceNav.ts) for one viewer. `roles` are the Roles of a person signed in with an emailed
 *  link; an item with an audience is drawn for them only when they hold one of its Roles. Anyone else (a member by git
 *  or by wallet, who has no Roles) is drawn every item. A group left with nothing is not drawn. The sections the file
 *  does not name go under `more`, so the house loses none — one named for an audience the viewer is not in stays out.
 *  Null when the instance carries no nav: the house draws its own sections. The sidebar's arrangement only; what a
 *  person may open is the server's gate. */
export function resolveNav(nav: InstanceNav | null | undefined, roles: readonly string[] | null, isIcon: (name: string) => name is IconName): ResolvedNav | null {
  if (!nav || nav.groups.length === 0) return null
  const named = new Set(nav.groups.flatMap(g => g.items.map(i => i.section).filter(Boolean)))
  const forViewer = (i: NavItem) => !i.audience || roles === null || i.audience.some(r => roles.includes(r))
  const groups: NavShown[] = []
  for (const g of nav.groups) {
    const items: NavLink[] = []
    for (const i of g.items.filter(forViewer)) {
      if (i.section) {
        const section = HOUSE_SECTIONS.find(s => s.id === i.section)
        if (section) items.push({ kind: 'section', section, label: i.label ?? section.label })
      } else if (i.label && i.href) {
        items.push({ kind: 'link', label: i.label, href: i.href, external: /^https?:/i.test(i.href), icon: i.icon && isIcon(i.icon) ? i.icon : null })
      }
    }
    if (items.length > 0) groups.push({ label: g.label, items })
  }
  return { groups, more: { label: nav.more ?? 'More', sections: HOUSE_SECTIONS.filter(s => !named.has(s.id)) } }
}

/** The one item of a resolved nav that is the page you are on: a link in the house the path is at or under, the
 *  longest (so /governance/decisions is "Decided", not the Proposals section at /governance); else the section the path
 *  belongs to (sectionOf). Another site is never current. */
export function currentNavItem(path: string, nav: ResolvedNav, collections: readonly SideLink[] = []): NavLink | null {
  const items = nav.groups.flatMap(g => g.items)
  let best: NavLink | null = null, len = -1
  for (const i of items) {
    if (i.kind === 'link' && !i.external && isCurrent(path, i.href) && i.href.length > len) { best = i; len = i.href.length }
  }
  if (best) return best
  const at = sectionOf(path, collections)
  return items.find(i => i.kind === 'section' && i.section.id === at) ?? null
}
